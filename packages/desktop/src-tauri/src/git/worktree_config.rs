//! Worktree setup loading and command execution.
//!
//! The primary source of truth is the project-scoped `.acepe.json` file.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;

use crate::commands::observability::{
    expected_command_result, unexpected_command_result, CommandResult,
};
use crate::db::repository::ProjectRepository;
use crate::path_safety;
use crate::storage::acepe_config;
use sea_orm::DbConn;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::mpsc;

/// Timeout for the whole setup script (5 minutes).
const COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
const WORKTREE_SETUP_EVENT: &str = "git:worktree-setup";
const OUTPUT_BUFFER_SIZE: usize = 4096;
const SCRIPT_PREVIEW_MAX_CHARS: usize = 120;

/// Environment variables to pass to setup commands (allowlist approach).
/// Unknown variables are excluded by default — safer than a denylist.
const ENV_ALLOWLIST: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    // Package managers
    "NPM_CONFIG_REGISTRY",
    "BUN_INSTALL",
    "NVM_DIR",
    "NVM_BIN",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "GOPATH",
    "GOROOT",
    "PYENV_ROOT",
    "VIRTUAL_ENV",
    "CONDA_PREFIX",
    // CI detection (so scripts can detect automated runs)
    "CI",
];

/// Worktree configuration as exposed to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeConfig {
    /// Full shell script to run after creating a worktree.
    #[serde(default)]
    pub setup_script: String,
}

/// Result of running setup commands
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetupResult {
    pub success: bool,
    pub commands_run: usize,
    pub error: Option<String>,
    pub output: Vec<CommandOutput>,
}

/// Output from a single command
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub command: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum WorktreeSetupEventKind {
    Started,
    CommandStarted,
    Output,
    Finished,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum WorktreeSetupOutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSetupEventPayload {
    pub kind: WorktreeSetupEventKind,
    pub project_path: String,
    pub worktree_path: String,
    pub command: Option<String>,
    pub command_count: Option<usize>,
    pub command_index: Option<usize>,
    pub stream: Option<WorktreeSetupOutputStream>,
    pub chunk: Option<String>,
    pub success: Option<bool>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

impl WorktreeSetupEventPayload {
    fn started(project_path: &Path, worktree_path: &Path, command_count: usize) -> Self {
        Self {
            kind: WorktreeSetupEventKind::Started,
            project_path: project_path.to_string_lossy().into_owned(),
            worktree_path: worktree_path.to_string_lossy().into_owned(),
            command: None,
            command_count: Some(command_count),
            command_index: None,
            stream: None,
            chunk: None,
            success: None,
            exit_code: None,
            error: None,
        }
    }

    fn command_started(
        project_path: &Path,
        worktree_path: &Path,
        command: &str,
        command_count: usize,
        command_index: usize,
    ) -> Self {
        Self {
            kind: WorktreeSetupEventKind::CommandStarted,
            project_path: project_path.to_string_lossy().into_owned(),
            worktree_path: worktree_path.to_string_lossy().into_owned(),
            command: Some(command.to_string()),
            command_count: Some(command_count),
            command_index: Some(command_index),
            stream: None,
            chunk: None,
            success: None,
            exit_code: None,
            error: None,
        }
    }

    fn output(
        project_path: &Path,
        worktree_path: &Path,
        command: &str,
        command_count: usize,
        command_index: usize,
        stream: WorktreeSetupOutputStream,
        chunk: String,
    ) -> Self {
        Self {
            kind: WorktreeSetupEventKind::Output,
            project_path: project_path.to_string_lossy().into_owned(),
            worktree_path: worktree_path.to_string_lossy().into_owned(),
            command: Some(command.to_string()),
            command_count: Some(command_count),
            command_index: Some(command_index),
            stream: Some(stream),
            chunk: Some(chunk),
            success: None,
            exit_code: None,
            error: None,
        }
    }

    fn finished(
        project_path: &Path,
        worktree_path: &Path,
        command_context: Option<(&str, usize)>,
        command_count: usize,
        success: bool,
        exit_code: Option<i32>,
        error: Option<String>,
    ) -> Self {
        Self {
            kind: WorktreeSetupEventKind::Finished,
            project_path: project_path.to_string_lossy().into_owned(),
            worktree_path: worktree_path.to_string_lossy().into_owned(),
            command: command_context.map(|(value, _)| value.to_string()),
            command_count: Some(command_count),
            command_index: command_context.map(|(_, index)| index),
            stream: None,
            chunk: None,
            success: Some(success),
            exit_code,
            error,
        }
    }
}

fn emit_worktree_setup_event(app: &AppHandle, payload: WorktreeSetupEventPayload) {
    if let Err(error) = app.emit(WORKTREE_SETUP_EVENT, &payload) {
        tracing::warn!(event = WORKTREE_SETUP_EVENT, error = %error, "Failed to emit worktree setup event");
    }
}

async fn read_command_stream<R>(
    mut reader: R,
    stream: WorktreeSetupOutputStream,
    sender: mpsc::UnboundedSender<(WorktreeSetupOutputStream, String)>,
) -> String
where
    R: AsyncRead + Unpin,
{
    let mut buffer = [0u8; OUTPUT_BUFFER_SIZE];
    let mut collected = String::new();

    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => {
                let chunk = String::from_utf8_lossy(&buffer[..read]).to_string();
                collected.push_str(&chunk);
                if sender.send((stream, chunk)).is_err() {
                    break;
                }
            }
            Err(error) => {
                tracing::warn!(stream = ?stream, error = %error, "Failed to read setup command output");
                break;
            }
        }
    }

    collected
}

/// Get the worktrees root directory (~/.acepe/worktrees/).
fn get_worktrees_root() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".acepe").join("worktrees"))
}

/// Validate that a path is inside the worktrees root directory.
/// Used by worktree_config and worktree modules.
///
/// Uses a two-tier strategy:
/// 1. Fast path: `canonicalize()` when the path exists on disk (resolves symlinks + `..`).
/// 2. Slow path: canonicalize the *parent* and validate the leaf component, so that
///    a worktree directory that hasn't been fully created yet can still be validated
///    without weakening security (no raw string-prefix checks on unresolved paths).
pub(crate) fn validate_worktree_path(path: &Path) -> Result<std::path::PathBuf, String> {
    let worktrees_root = get_worktrees_root()?;

    // Ensure the worktrees root exists (it's always under our control).
    std::fs::create_dir_all(&worktrees_root)
        .map_err(|e| format!("Failed to create worktrees root: {}", e))?;

    let canonical_root = worktrees_root
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize worktrees root: {}", e))?;

    // Fast path: full canonicalize works when the path already exists on disk.
    if let Ok(canonical) = path.canonicalize() {
        if !canonical.starts_with(&canonical_root) {
            return Err(format!(
                "Path '{}' is outside the worktrees directory",
                path.display()
            ));
        }
        return Ok(canonical);
    }

    // Slow path: path doesn't exist yet — canonicalize the PARENT (which must exist),
    // then append the validated leaf component.
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path '{}' has no parent", path.display()))?;

    let canonical_parent = parent.canonicalize().map_err(|e| {
        format!(
            "Parent directory '{}' must exist before validation: {}",
            parent.display(),
            e
        )
    })?;

    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Path '{}' has no file name component", path.display()))?;

    // Reject traversal characters in the leaf component.
    let name_str = file_name.to_string_lossy();
    if name_str == ".." || name_str == "." || name_str.contains('/') || name_str.contains('\\') {
        return Err(format!("Invalid path component: {}", name_str));
    }

    let resolved = canonical_parent.join(file_name);

    if !resolved.starts_with(&canonical_root) {
        return Err(format!(
            "Path '{}' resolves outside the worktrees directory",
            path.display()
        ));
    }

    Ok(resolved)
}

fn script_preview(script: &str) -> Option<String> {
    let first_line = script
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let preview = first_line
        .chars()
        .take(SCRIPT_PREVIEW_MAX_CHARS)
        .collect::<String>();
    if first_line.chars().count() > SCRIPT_PREVIEW_MAX_CHARS {
        return Some(format!("{}...", preview));
    }
    Some(preview)
}

async fn load_config_from_project_root(
    db: &DbConn,
    project_path: &Path,
) -> Result<Option<WorktreeConfig>, String> {
    let project_path_str = project_path.to_string_lossy().to_string();
    ProjectRepository::get_by_path(db, &project_path_str)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Project not found: {}", project_path_str))?;

    let config = acepe_config::read(project_path).map_err(|error| error.to_string())?;
    Ok(Some(WorktreeConfig {
        setup_script: config.scripts.setup,
    }))
}

fn build_setup_command(
    worktree_path: &Path,
    sanitised_env: &[(String, String)],
    script: &str,
    shell: &str,
) -> Command {
    let mut command = match shell {
        "bash" => {
            let mut command = Command::new("/usr/bin/env");
            command.arg("bash");
            command
        }
        _ => Command::new("/bin/sh"),
    };

    command
        .arg("-c")
        .arg("eval \"$1\"")
        .arg("acepe-setup")
        .arg(script)
        .current_dir(worktree_path)
        .env_clear()
        .envs(
            sanitised_env
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    command
}

fn spawn_setup_script(
    worktree_path: &Path,
    sanitised_env: &[(String, String)],
    script: &str,
) -> Result<tokio::process::Child, std::io::Error> {
    match build_setup_command(worktree_path, sanitised_env, script, "bash").spawn() {
        Ok(child) => Ok(child),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            build_setup_command(worktree_path, sanitised_env, script, "sh").spawn()
        }
        Err(error) => Err(error),
    }
}

/// Run a setup script in a worktree directory.
pub async fn run_setup_script(
    app: &AppHandle,
    project_path: &Path,
    worktree_path: &Path,
    script: &str,
) -> Result<SetupResult, String> {
    let preview = script_preview(script).unwrap_or_else(|| "<setup script>".to_string());
    let command_count = 1;
    let command_index = 0;

    tracing::info!(
        worktree_path = %worktree_path.display(),
        preview = %preview,
        "Starting worktree setup script"
    );
    emit_worktree_setup_event(
        app,
        WorktreeSetupEventPayload::started(project_path, worktree_path, command_count),
    );
    emit_worktree_setup_event(
        app,
        WorktreeSetupEventPayload::command_started(
            project_path,
            worktree_path,
            &preview,
            command_count,
            command_index,
        ),
    );

    let sanitised_env: Vec<(String, String)> = std::env::vars()
        .filter(|(key, _)| ENV_ALLOWLIST.contains(&key.as_str()))
        .collect();
    if let Some((_, path_value)) = sanitised_env.iter().find(|(key, _)| key == "PATH") {
        tracing::debug!(path = %path_value, "Sanitised PATH for setup script");
    } else {
        tracing::warn!("PATH not found in sanitised environment");
    }

    let mut child = spawn_setup_script(worktree_path, &sanitised_env, script)
        .map_err(|error| format!("Failed to execute setup script '{}': {}", preview, error))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("Failed to capture stdout for setup script '{}'", preview))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("Failed to capture stderr for setup script '{}'", preview))?;

    let (stream_sender, mut stream_receiver) =
        mpsc::unbounded_channel::<(WorktreeSetupOutputStream, String)>();
    let stdout_task = tokio::spawn(read_command_stream(
        stdout,
        WorktreeSetupOutputStream::Stdout,
        stream_sender.clone(),
    ));
    let stderr_task = tokio::spawn(read_command_stream(
        stderr,
        WorktreeSetupOutputStream::Stderr,
        stream_sender,
    ));

    let mut wait_future = Box::pin(tokio::time::timeout(COMMAND_TIMEOUT, child.wait()));
    let wait_result = loop {
        tokio::select! {
            maybe_chunk = stream_receiver.recv() => {
                if let Some((stream, chunk)) = maybe_chunk {
                    emit_worktree_setup_event(
                        app,
                        WorktreeSetupEventPayload::output(
                            project_path,
                            worktree_path,
                            &preview,
                            command_count,
                            command_index,
                            stream,
                            chunk,
                        ),
                    );
                }
            }
            result = &mut wait_future => {
                break result;
            }
        }
    };
    drop(wait_future);

    if wait_result.is_err() {
        if let Err(error) = child.kill().await {
            tracing::warn!(preview = %preview, error = %error, "Failed to kill timed out setup script");
        }
        let _ = child.wait().await;
    }

    while let Some((stream, chunk)) = stream_receiver.recv().await {
        emit_worktree_setup_event(
            app,
            WorktreeSetupEventPayload::output(
                project_path,
                worktree_path,
                &preview,
                command_count,
                command_index,
                stream,
                chunk,
            ),
        );
    }

    let stdout_text = match stdout_task.await {
        Ok(output) => output,
        Err(error) => {
            tracing::warn!(error = %error, "stdout reader task failed");
            String::new()
        }
    };
    let stderr_text = match stderr_task.await {
        Ok(output) => output,
        Err(error) => {
            tracing::warn!(error = %error, "stderr reader task failed");
            String::new()
        }
    };

    match wait_result {
        Ok(Ok(status)) => {
            let success = status.success();
            let exit_code = status.code();
            let command_output = CommandOutput {
                command: preview.clone(),
                success,
                stdout: stdout_text,
                stderr: stderr_text.clone(),
                exit_code,
            };

            if success {
                emit_worktree_setup_event(
                    app,
                    WorktreeSetupEventPayload::finished(
                        project_path,
                        worktree_path,
                        Some((&preview, command_index)),
                        command_count,
                        true,
                        exit_code,
                        None,
                    ),
                );
                return Ok(SetupResult {
                    success: true,
                    commands_run: 1,
                    error: None,
                    output: vec![command_output],
                });
            }

            let error = format!(
                "Setup script '{}' failed with exit code {:?}: {}",
                preview, exit_code, stderr_text
            );
            emit_worktree_setup_event(
                app,
                WorktreeSetupEventPayload::finished(
                    project_path,
                    worktree_path,
                    Some((&preview, command_index)),
                    command_count,
                    false,
                    exit_code,
                    Some(error.clone()),
                ),
            );
            Ok(SetupResult {
                success: false,
                commands_run: 1,
                error: Some(error),
                output: vec![command_output],
            })
        }
        Ok(Err(error)) => {
            let message = format!(
                "Failed while waiting for setup script '{}': {}",
                preview, error
            );
            emit_worktree_setup_event(
                app,
                WorktreeSetupEventPayload::finished(
                    project_path,
                    worktree_path,
                    Some((&preview, command_index)),
                    command_count,
                    false,
                    None,
                    Some(message.clone()),
                ),
            );
            Ok(SetupResult {
                success: false,
                commands_run: 1,
                error: Some(message.clone()),
                output: vec![CommandOutput {
                    command: preview,
                    success: false,
                    stdout: stdout_text,
                    stderr: if stderr_text.is_empty() {
                        error.to_string()
                    } else {
                        stderr_text
                    },
                    exit_code: None,
                }],
            })
        }
        Err(_elapsed) => {
            let message = format!(
                "Setup script '{}' timed out after {} seconds",
                preview,
                COMMAND_TIMEOUT.as_secs()
            );
            emit_worktree_setup_event(
                app,
                WorktreeSetupEventPayload::finished(
                    project_path,
                    worktree_path,
                    Some((&preview, command_index)),
                    command_count,
                    false,
                    None,
                    Some(message.clone()),
                ),
            );
            Ok(SetupResult {
                success: false,
                commands_run: 1,
                error: Some(message.clone()),
                output: vec![CommandOutput {
                    command: preview,
                    success: false,
                    stdout: stdout_text,
                    stderr: if stderr_text.is_empty() {
                        message
                    } else {
                        stderr_text
                    },
                    exit_code: None,
                }],
            })
        }
    }
}

/// Load worktree config from project path.
/// Restricts to allowed project roots (path_safety validation).
#[tauri::command]
#[specta::specta]
pub async fn load_worktree_config(
    app: AppHandle,
    project_path: String,
) -> CommandResult<Option<WorktreeConfig>> {
    unexpected_command_result(
        "load_worktree_config",
        "Failed to load worktree config",
        async {
            let canonical = path_safety::validate_project_directory_from_str(&project_path)
                .map_err(|e| e.message_for(Path::new(project_path.trim())))?;
            let db = app.state::<DbConn>();

            load_config_from_project_root(&db, &canonical).await
        }
        .await,
    )
}

/// Validate project path using path_safety (restricts to allowed roots).
fn validate_project_path(project_path: &str) -> Result<std::path::PathBuf, String> {
    path_safety::validate_project_directory_from_str(project_path)
        .map_err(|e| e.message_for(Path::new(project_path.trim())))
}

/// Run the project's setup script in a worktree.
#[tauri::command]
#[specta::specta]
pub async fn run_worktree_setup(
    app: AppHandle,
    worktree_path: String,
    project_path: String,
) -> CommandResult<SetupResult> {
    unexpected_command_result(
        "run_worktree_setup",
        "Failed to run worktree setup",
        async {
            tracing::info!(
                worktree_path = %worktree_path,
                project_path = %project_path,
                "run_worktree_setup called"
            );

            // Validate worktree path is inside ~/.acepe/worktrees/
            let canonical = validate_worktree_path(Path::new(&worktree_path))?;

            // Validate project path and load the setup script from .acepe.json.
            let project_canonical = validate_project_path(&project_path)?;
            let db = app.state::<DbConn>();
            let config = load_config_from_project_root(&db, &project_canonical).await?;
            let setup_script = match config {
                Some(c) if !c.setup_script.trim().is_empty() => c.setup_script,
                _ => {
                    tracing::info!("No setup script found in config, skipping setup");
                    return Ok(SetupResult {
                        success: true,
                        commands_run: 0,
                        error: None,
                        output: vec![],
                    });
                }
            };

            tracing::info!(
                preview = %script_preview(&setup_script).unwrap_or_else(|| "<setup script>".to_string()),
                "Found setup script in config, executing"
            );

            let result = run_setup_script(&app, &project_canonical, &canonical, &setup_script).await;

            match &result {
                Ok(r) => tracing::info!(
                    success = r.success,
                    commands_run = r.commands_run,
                    error = ?r.error,
                    "run_worktree_setup completed"
                ),
                Err(e) => tracing::error!(error = %e, "run_worktree_setup returned error"),
            }

            result
        }
        .await,
    )
}

/// Maximum length (in bytes) of a setup script.
const MAX_SETUP_SCRIPT_LENGTH: usize = 65_536;

fn validate_setup_script(script: &str) -> Result<(), String> {
    if script.len() > MAX_SETUP_SCRIPT_LENGTH {
        return Err(format!(
            "Setup script exceeds max length of {} bytes",
            MAX_SETUP_SCRIPT_LENGTH
        ));
    }
    if script
        .bytes()
        .any(|byte| byte < 0x20 && byte != b'\t' && byte != b'\n' && byte != b'\r')
    {
        return Err("Setup script must not contain null bytes or control characters".into());
    }
    Ok(())
}

/// Save the setup script to the project's config file.
#[tauri::command]
#[specta::specta]
pub async fn save_worktree_config(
    app: AppHandle,
    project_path: String,
    setup_script: String,
) -> CommandResult<()> {
    let canonical =
        expected_command_result("save_worktree_config", validate_project_path(&project_path))?;
    expected_command_result("save_worktree_config", validate_setup_script(&setup_script))?;

    unexpected_command_result(
        "save_worktree_config",
        "Failed to save worktree config",
        async {
            let db = app.state::<DbConn>();
            let canonical_path_str = canonical.to_string_lossy().to_string();
            ProjectRepository::get_by_path(&db, &canonical_path_str)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("Project not found: {}", canonical_path_str))?;
            let next_setup_script = setup_script;
            acepe_config::update(&canonical, |config| {
                config.version = 1;
                config.scripts.setup = next_setup_script.clone();
            })
            .map_err(|error| error.to_string())?;

            Ok(())
        }
        .await,
    )
}

#[cfg(test)]
mod tests {
    use super::spawn_setup_script;
    use tempfile::tempdir;

    #[tokio::test]
    async fn spawn_setup_script_executes_script_body_instead_of_placeholder_arg() {
        let directory = tempdir().expect("tempdir");
        let child = spawn_setup_script(
            directory.path(),
            &[("PATH".to_string(), std::env::var("PATH").expect("PATH"))],
            "printf 'hello\\n'",
        )
        .expect("spawn script");

        let output = child.wait_with_output().await.expect("wait for script");
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), "hello\n");
        assert_eq!(String::from_utf8_lossy(&output.stderr), "");
    }
}
