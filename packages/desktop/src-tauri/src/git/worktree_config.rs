//! Worktree configuration loading and setup command execution.
//!
//! Supports `.acepe.json` or `acepe.config.json` in project root with:
//! ```json
//! {
//!   "worktree": {
//!     "setupCommands": ["bun install", "bun run build"]
//!   }
//! }
//! ```

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;

use crate::path_safety;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::mpsc;
use crate::commands::observability::{CommandResult, unexpected_command_result};

/// Timeout for individual setup commands (5 minutes).
const COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
const WORKTREE_SETUP_EVENT: &str = "git:worktree-setup";
const OUTPUT_BUFFER_SIZE: usize = 4096;

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

/// Worktree configuration section from .acepe.json
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeConfig {
    /// Commands to run after creating a worktree
    #[serde(default)]
    pub setup_commands: Vec<String>,
}

/// Root configuration file structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AcepeConfig {
    #[serde(default)]
    worktree: WorktreeConfig,
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

/// Config file candidates in priority order.
fn config_candidates(project_path: &Path) -> [std::path::PathBuf; 2] {
    [
        project_path.join(".acepe.json"),
        project_path.join("acepe.config.json"),
    ]
}

/// Load worktree configuration from project directory.
///
/// Looks for `.acepe.json` or `acepe.config.json` in the project root.
pub fn load_config(project_path: &Path) -> Option<WorktreeConfig> {
    for config_path in &config_candidates(project_path) {
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(config_path) {
                if let Ok(config) = serde_json::from_str::<AcepeConfig>(&content) {
                    if !config.worktree.setup_commands.is_empty() {
                        return Some(config.worktree);
                    }
                }
            }
        }
    }

    None
}

/// Run setup commands in a worktree directory.
pub async fn run_setup_commands(
    app: &AppHandle,
    project_path: &Path,
    worktree_path: &Path,
    commands: &[String],
) -> Result<SetupResult, String> {
    let mut outputs = Vec::new();
    let mut commands_run = 0;

    tracing::info!(
        worktree_path = %worktree_path.display(),
        command_count = commands.len(),
        "Starting worktree setup commands"
    );
    emit_worktree_setup_event(
        app,
        WorktreeSetupEventPayload::started(project_path, worktree_path, commands.len()),
    );

    // Build sanitised environment from allowlist
    let sanitised_env: Vec<(String, String)> = std::env::vars()
        .filter(|(k, _)| ENV_ALLOWLIST.contains(&k.as_str()))
        .collect();

    // Log the resolved PATH for debugging (bun/node resolution)
    if let Some((_, path_val)) = sanitised_env.iter().find(|(k, _)| k == "PATH") {
        tracing::debug!(path = %path_val, "Sanitised PATH for setup commands");
    } else {
        tracing::warn!("PATH not found in sanitised environment");
    }

    for cmd_str in commands {
        commands_run += 1;

        // Parse command - split on whitespace, first part is the command, rest are args
        let parts: Vec<&str> = cmd_str.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let program = parts[0];
        let args = &parts[1..];

        tracing::info!(
            command = cmd_str,
            program = program,
            worktree_path = %worktree_path.display(),
            command_index = commands_run,
            "Executing setup command"
        );
        emit_worktree_setup_event(
            app,
            WorktreeSetupEventPayload::command_started(
                project_path,
                worktree_path,
                cmd_str,
                commands.len(),
                commands_run,
            ),
        );

        let mut cmd = Command::new(program);
        cmd.args(args)
            .current_dir(worktree_path)
            .env_clear()
            .envs(sanitised_env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Ensure child is killed if the future is dropped (e.g. on timeout).
            .kill_on_drop(true);

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(error) => {
                tracing::error!(
                    command = cmd_str,
                    error = %error,
                    "Failed to execute setup command (spawn error)"
                );
                let error_msg = format!("Failed to execute command '{}': {}", cmd_str, error);
                outputs.push(CommandOutput {
                    command: cmd_str.clone(),
                    success: false,
                    stdout: String::new(),
                    stderr: error.to_string(),
                    exit_code: None,
                });
                emit_worktree_setup_event(
                    app,
                    WorktreeSetupEventPayload::finished(
                        project_path,
                        worktree_path,
                        Some((cmd_str, commands_run)),
                        commands.len(),
                        false,
                        None,
                        Some(error_msg.clone()),
                    ),
                );
                return Ok(SetupResult {
                    success: false,
                    commands_run,
                    error: Some(error_msg),
                    output: outputs,
                });
            }
        };

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("Failed to capture stdout for command '{}'", cmd_str))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| format!("Failed to capture stderr for command '{}'", cmd_str))?;

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
                                cmd_str,
                                commands.len(),
                                commands_run,
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
                tracing::warn!(command = cmd_str, error = %error, "Failed to kill timed out setup command");
            }
            let _ = child.wait().await;
        }

        while let Some((stream, chunk)) = stream_receiver.recv().await {
            emit_worktree_setup_event(
                app,
                WorktreeSetupEventPayload::output(
                    project_path,
                    worktree_path,
                    cmd_str,
                    commands.len(),
                    commands_run,
                    stream,
                    chunk,
                ),
            );
        }

        let stdout_str = match stdout_task.await {
            Ok(output) => output,
            Err(error) => {
                tracing::warn!(error = %error, "stdout reader task failed");
                String::new()
            }
        };
        let stderr_str = match stderr_task.await {
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

                if success {
                    tracing::info!(
                        command = cmd_str,
                        exit_code = ?exit_code,
                        stdout_len = stdout_str.len(),
                        stderr_len = stderr_str.len(),
                        "Setup command succeeded"
                    );
                } else {
                    tracing::warn!(
                        command = cmd_str,
                        exit_code = ?exit_code,
                        stderr = %stderr_str,
                        "Setup command failed"
                    );
                }

                let cmd_output = CommandOutput {
                    command: cmd_str.clone(),
                    success,
                    stdout: stdout_str,
                    stderr: stderr_str.clone(),
                    exit_code,
                };

                if !success {
                    let error_msg = format!(
                        "Command '{}' failed with exit code {:?}: {}",
                        cmd_str, exit_code, stderr_str
                    );
                    outputs.push(cmd_output);
                    emit_worktree_setup_event(
                        app,
                        WorktreeSetupEventPayload::finished(
                            project_path,
                            worktree_path,
                            Some((cmd_str, commands_run)),
                            commands.len(),
                            false,
                            exit_code,
                            Some(error_msg.clone()),
                        ),
                    );
                    return Ok(SetupResult {
                        success: false,
                        commands_run,
                        error: Some(error_msg),
                        output: outputs,
                    });
                }

                outputs.push(cmd_output);
            }
            Ok(Err(error)) => {
                tracing::error!(
                    command = cmd_str,
                    error = %error,
                    "Failed to execute setup command (spawn error)"
                );
                let error_msg =
                    format!("Failed while waiting for command '{}': {}", cmd_str, error);
                outputs.push(CommandOutput {
                    command: cmd_str.clone(),
                    success: false,
                    stdout: stdout_str,
                    stderr: if stderr_str.is_empty() {
                        error.to_string()
                    } else {
                        stderr_str
                    },
                    exit_code: None,
                });
                emit_worktree_setup_event(
                    app,
                    WorktreeSetupEventPayload::finished(
                        project_path,
                        worktree_path,
                        Some((cmd_str, commands_run)),
                        commands.len(),
                        false,
                        None,
                        Some(error_msg.clone()),
                    ),
                );
                return Ok(SetupResult {
                    success: false,
                    commands_run,
                    error: Some(error_msg),
                    output: outputs,
                });
            }
            Err(_elapsed) => {
                tracing::error!(
                    command = cmd_str,
                    timeout_secs = COMMAND_TIMEOUT.as_secs(),
                    "Setup command timed out"
                );
                let error_msg = format!(
                    "Command '{}' timed out after {} seconds",
                    cmd_str,
                    COMMAND_TIMEOUT.as_secs()
                );
                outputs.push(CommandOutput {
                    command: cmd_str.clone(),
                    success: false,
                    stdout: stdout_str,
                    stderr: if stderr_str.is_empty() {
                        error_msg.clone()
                    } else {
                        stderr_str
                    },
                    exit_code: None,
                });
                emit_worktree_setup_event(
                    app,
                    WorktreeSetupEventPayload::finished(
                        project_path,
                        worktree_path,
                        Some((cmd_str, commands_run)),
                        commands.len(),
                        false,
                        None,
                        Some(error_msg.clone()),
                    ),
                );
                return Ok(SetupResult {
                    success: false,
                    commands_run,
                    error: Some(error_msg),
                    output: outputs,
                });
            }
        }
    }

    tracing::info!(
        commands_run = commands_run,
        "All worktree setup commands completed successfully"
    );
    emit_worktree_setup_event(
        app,
        WorktreeSetupEventPayload::finished(
            project_path,
            worktree_path,
            None,
            commands.len(),
            true,
            Some(0),
            None,
        ),
    );

    Ok(SetupResult {
        success: true,
        commands_run,
        error: None,
        output: outputs,
    })
}

/// Load worktree config from project path.
/// Restricts to allowed project roots (path_safety validation).
#[tauri::command]
#[specta::specta]
pub async fn load_worktree_config(project_path: String) -> CommandResult<Option<WorktreeConfig>>  {
    unexpected_command_result("load_worktree_config", "Failed to load worktree config", async {

        let canonical = path_safety::validate_project_directory_from_str(&project_path)
            .map_err(|e| e.message_for(Path::new(project_path.trim())))?;

        Ok(load_config(&canonical))

    }.await)
}

/// Validate project path using path_safety (restricts to allowed roots).
fn validate_project_path(project_path: &str) -> Result<std::path::PathBuf, String> {
    path_safety::validate_project_directory_from_str(project_path)
        .map_err(|e| e.message_for(Path::new(project_path.trim())))
}

/// Run setup commands in a worktree.
/// Commands are loaded from the project's `.acepe.json` config file (not from IPC).
#[tauri::command]
#[specta::specta]
pub async fn run_worktree_setup(
    app: AppHandle,
    worktree_path: String,
    project_path: String,
) -> CommandResult<SetupResult>  {
    unexpected_command_result("run_worktree_setup", "Failed to run worktree setup", async {

        tracing::info!(
            worktree_path = %worktree_path,
            project_path = %project_path,
            "run_worktree_setup called"
        );

        // Validate worktree path is inside ~/.acepe/worktrees/
        let canonical = validate_worktree_path(Path::new(&worktree_path))?;

        // Validate project path and load commands from config file (not from IPC)
        let project_canonical = validate_project_path(&project_path)?;
        let config = load_config(&project_canonical);
        let commands = match config {
            Some(c) if !c.setup_commands.is_empty() => c.setup_commands,
            _ => {
                tracing::info!("No setup commands found in config, skipping setup");
                return Ok(SetupResult {
                    success: true,
                    commands_run: 0,
                    error: None,
                    output: vec![],
                });
            }
        };

        tracing::info!(
            commands = ?commands,
            "Found setup commands in config, executing"
        );

        let result = run_setup_commands(&app, &project_canonical, &canonical, &commands).await;

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

    }.await)
}

/// Maximum number of setup commands allowed.
const MAX_SETUP_COMMANDS: usize = 50;

/// Maximum length (in bytes) of a single setup command.
const MAX_COMMAND_LENGTH: usize = 4096;

/// Resolve which config file to write to, mirroring the read order from `load_config`.
/// Returns the path of the first existing config file, or `.acepe.json` as default.
fn resolve_config_write_path(project_path: &Path) -> std::path::PathBuf {
    let candidates = config_candidates(project_path);
    for path in &candidates {
        if path.exists() {
            return path.clone();
        }
    }
    candidates[0].clone()
}

/// Validate a single setup command string.
fn validate_command(cmd: &str) -> Result<(), String> {
    if cmd.trim().is_empty() {
        return Err("Setup command must not be empty or whitespace-only".into());
    }
    if cmd.len() > MAX_COMMAND_LENGTH {
        return Err(format!(
            "Setup command exceeds max length of {} bytes",
            MAX_COMMAND_LENGTH
        ));
    }
    if cmd.bytes().any(|b| b < 0x20 && b != b'\t') {
        return Err("Setup command must not contain null bytes or control characters".into());
    }
    Ok(())
}

/// Save worktree setup commands to the project's config file.
/// Preserves any non-worktree fields in the JSON.
#[tauri::command]
#[specta::specta]
pub async fn save_worktree_config(
    project_path: String,
    setup_commands: Vec<String>,
) -> CommandResult<()>  {
    unexpected_command_result("save_worktree_config", "Failed to save worktree config", async {

        let canonical = validate_project_path(&project_path)?;

        // Validate input
        if setup_commands.len() > MAX_SETUP_COMMANDS {
            return Err(format!(
                "Too many setup commands (max {})",
                MAX_SETUP_COMMANDS
            ));
        }
        for cmd in &setup_commands {
            validate_command(cmd)?;
        }

        let config_path = resolve_config_write_path(&canonical);

        // Read existing config to preserve non-worktree fields
        let mut config: serde_json::Value = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read config: {}", e))?;
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?
        } else {
            serde_json::json!({})
        };

        if !config.is_object() {
            return Err("Config file must contain a JSON object at the root level".into());
        }

        // Ensure intermediate "worktree" object exists (Value::Null indexing is a silent no-op)
        if !config.get("worktree").is_some_and(|v| v.is_object()) {
            config["worktree"] = serde_json::json!({});
        }
        config["worktree"]["setupCommands"] = serde_json::json!(setup_commands);

        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&config_path, content).map_err(|e| format!("Failed to write config: {}", e))?;

        Ok(())

    }.await)
}
