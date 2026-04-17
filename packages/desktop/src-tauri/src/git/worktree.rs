//! Git worktree management for isolated agent sessions.
//!
//! This module provides functionality to create, manage, and cleanup git worktrees
//! that isolate agent work from the main repository. Each worktree gets a fun
//! adjective-noun name like "clever-falcon" or "cosmic-harbor".

use crate::db::repository::SessionMetadataRepository;
use crate::git::worktree_config;
use crate::path_safety;
use chrono::{Datelike, Utc};
use rand::seq::SliceRandom;
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command as AsyncCommand;
use crate::commands::observability::{
    CommandResult, SerializableCommandError, unexpected_command_result,
};

// Word lists for generating fun branch names (from opencode pattern)
const ADJECTIVES: &[&str] = &[
    "brave", "calm", "clever", "cosmic", "crisp", "curious", "eager", "gentle", "golden", "happy",
    "keen", "lively", "merry", "noble", "proud", "quick", "quiet", "rapid", "sharp", "silent",
    "smooth", "steady", "swift", "vivid", "warm", "wise", "witty", "zesty", "bold", "bright",
    "clear", "cool",
];

const NOUNS: &[&str] = &[
    "cabin", "canyon", "comet", "eagle", "falcon", "forest", "harbor", "island", "meadow",
    "mountain", "ocean", "panther", "phoenix", "planet", "river", "shadow", "spark", "stream",
    "summit", "thunder", "tiger", "valley", "wave", "willow", "breeze", "cloud", "crystal", "dawn",
    "ember", "frost", "garden", "horizon",
];

/// Whether a worktree was created by Acepe or externally
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub enum WorktreeOrigin {
    #[serde(rename = "acepe")]
    Acepe,
    #[serde(rename = "external")]
    External,
}

/// Information about a git worktree
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct WorktreeInfo {
    /// The worktree name (e.g., "clever-falcon")
    pub name: String,
    /// The git branch name (matches the worktree name, e.g., "clever-falcon")
    pub branch: String,
    /// The full path to the worktree directory
    pub directory: String,
    /// Whether this worktree was created by Acepe or externally
    pub origin: WorktreeOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PreparedWorktreeLaunch {
    pub launch_token: String,
    pub sequence_id: i32,
    pub worktree: WorktreeInfo,
}

/// Extended worktree information for management UI
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct WorktreeListItem {
    /// The worktree name (e.g., "clever-falcon")
    pub name: String,
    /// The git branch name (matches the worktree name, e.g., "clever-falcon")
    pub branch: String,
    /// The full path to the worktree directory
    pub path: String,
    /// The original project path this worktree was created from
    pub project_path: String,
    /// The project name (folder name)
    pub project_name: String,
    /// Session ID if this worktree is associated with a session, null if orphaned
    pub session_id: Option<String>,
    /// Disk size in bytes
    pub disk_size: u64,
}

/// Result of worktree cleanup operation
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CleanupResult {
    /// Number of worktrees successfully removed
    pub removed_count: u32,
    /// Paths that failed to remove
    pub failed_paths: Vec<String>,
}

/// Result of worktree setup commands
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SetupResult {
    /// Whether all commands succeeded
    pub success: bool,
    /// Output from each command
    pub outputs: Vec<CommandOutput>,
    /// Error message if failed
    pub error: Option<String>,
}

/// Output from a single setup command
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CommandOutput {
    /// The command that was run
    pub command: String,
    /// stdout output
    pub stdout: String,
    /// stderr output
    pub stderr: String,
    /// Exit code
    pub exit_code: i32,
}

/// Generate a random worktree name using adjective-noun pattern
fn generate_name() -> String {
    let mut rng = rand::thread_rng();
    let adjective = ADJECTIVES.choose(&mut rng).unwrap_or(&"cosmic");
    let noun = NOUNS.choose(&mut rng).unwrap_or(&"falcon");
    format!("{}-{}", adjective, noun)
}

fn slugify_project_name(project_path: &Path) -> String {
    let raw = project_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("project")
        .to_ascii_lowercase();
    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in raw.chars() {
        let normalized = if ch.is_ascii_alphanumeric() {
            Some(ch)
        } else {
            None
        };
        if let Some(value) = normalized {
            slug.push(value);
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed.to_string()
    }
}

fn month_name(month: u32) -> &'static str {
    match month {
        1 => "january",
        2 => "february",
        3 => "march",
        4 => "april",
        5 => "may",
        6 => "june",
        7 => "july",
        8 => "august",
        9 => "september",
        10 => "october",
        11 => "november",
        12 => "december",
        _ => "unknown",
    }
}

fn slugify_text(value: &str, fallback: &str) -> String {
    let mut slug = String::with_capacity(value.len());
    let mut last_was_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn format_reserved_worktree_relative_path_at(
    now: chrono::DateTime<Utc>,
    project_path: &Path,
    sequence_id: i32,
    agent_id: &str,
) -> String {
    let day = now.day();
    let month = month_name(now.month());
    let year = now.year();
    let hour = now.format("%H");
    let minute = now.format("%M");
    let project_slug = slugify_project_name(project_path);
    let agent_slug = slugify_text(agent_id, "agent");
    format!("{day}-{month}-{year}-{hour}:{minute}/{project_slug}/{sequence_id}/{agent_slug}")
}

fn format_reserved_worktree_relative_path(
    project_path: &Path,
    sequence_id: i32,
    agent_id: &str,
) -> String {
    format_reserved_worktree_relative_path_at(Utc::now(), project_path, sequence_id, agent_id)
}

fn worktree_branch_name(name: &str) -> String {
    name.replace(':', "-")
}

fn worktree_relative_name(worktree_path: &Path) -> Result<String, String> {
    let root = get_worktrees_root()?;
    let within_root = worktree_path
        .strip_prefix(&root)
        .map_err(|_| "Worktree path does not belong to the Acepe worktrees root".to_string())?;
    let mut components = within_root.components();
    let _project_id = components
        .next()
        .ok_or("Could not determine project worktrees directory")?;
    let relative = components.as_path();
    if relative.as_os_str().is_empty() {
        return Err("Could not determine worktree relative name".to_string());
    }

    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn managed_worktree_branch_name(worktree_path: &Path) -> Result<String, String> {
    let relative_name = worktree_relative_name(worktree_path)?;
    Ok(worktree_branch_name(&relative_name))
}

fn legacy_managed_worktree_branch_name(worktree_path: &Path) -> Result<String, String> {
    let relative_name = worktree_relative_name(worktree_path)?;
    Ok(format!("acepe/{}", worktree_branch_name(&relative_name)))
}

fn resolve_existing_managed_worktree_branch_name(
    repo_path: &Path,
    worktree_path: &Path,
) -> Result<Option<String>, String> {
    let managed_branch = managed_worktree_branch_name(worktree_path)?;
    if branch_exists(repo_path, &managed_branch)? {
        return Ok(Some(managed_branch));
    }

    let legacy_branch = legacy_managed_worktree_branch_name(worktree_path)?;
    if branch_exists(repo_path, &legacy_branch)? {
        return Ok(Some(legacy_branch));
    }

    Ok(None)
}

/// Get the worktrees root directory (~/.acepe/worktrees/)
fn get_worktrees_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".acepe").join("worktrees"))
}

/// Generate a project ID from the project path (first 12 chars of SHA-256 hash)
fn project_id_from_path(project_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_path.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..6]) // 6 bytes = 12 hex chars
}

/// Get the worktree directory for a project
fn get_project_worktrees_dir(project_path: &str) -> Result<PathBuf, String> {
    let root = get_worktrees_root()?;
    let project_id = project_id_from_path(project_path);
    Ok(root.join(project_id))
}

/// Check if a git branch exists in the repository
fn branch_exists(repo_path: &Path, branch: &str) -> Result<bool, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--verify", branch])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to check branch existence: {}", e))?;

    Ok(output.status.success())
}

fn check_git_repo_state(path: &Path) -> Result<bool, String> {
    if path.join(".git").exists() {
        return Ok(true);
    }

    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(path)
        .output()
        .map(|output| output.status.success())
        .map_err(|error| format!("Failed to check git repository state: {}", error))
}

/// Check if the path is a git repository (async version for Tauri commands)
async fn is_git_repo_async(path: &Path) -> bool {
    // First check if .git exists (fast path)
    if path.join(".git").exists() {
        return true;
    }

    // Fall back to git command for worktrees/submodules
    AsyncCommand::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(path)
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if repository has uncommitted changes
fn has_uncommitted_changes(repo_path: &Path) -> Result<bool, String> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to check git status: {}", e))?;

    if !output.status.success() {
        return Err("Failed to get git status".to_string());
    }

    Ok(!output.stdout.is_empty())
}

/// Get the current branch name
pub(crate) fn get_current_branch(repo_path: &Path) -> Result<String, String> {
    let repo = crate::file_index::git::open_repository(repo_path)
        .map_err(|e| format!("Failed to get current branch: {}", e))?;
    crate::file_index::git::get_branch_name(&repo)
        .ok_or_else(|| "Failed to get current branch".to_string())
}

fn has_valid_head(repo_path: &Path) -> Result<bool, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to check HEAD: {}", e))?;

    Ok(output.status.success())
}

fn fetch_latest_base_refs(repo_path: &Path) {
    for branch in ["main", "master"] {
        let _ = Command::new("git")
            .args(["fetch", "origin", branch])
            .current_dir(repo_path)
            .output();
    }
}

fn resolve_worktree_base_ref(repo_path: &Path) -> Result<String, String> {
    fetch_latest_base_refs(repo_path);

    for candidate in ["origin/main", "origin/master", "main", "master"] {
        if branch_exists(repo_path, candidate)? {
            return Ok(candidate.to_string());
        }
    }

    if has_valid_head(repo_path)? {
        return Ok("HEAD".to_string());
    }

    Err("Could not determine worktree base ref".to_string())
}

fn ensure_initial_commit_for_unborn_repo(repo_path: &Path) -> Result<bool, String> {
    if has_valid_head(repo_path)? {
        return Ok(false);
    }

    tracing::info!(repo_path = %repo_path.display(), "Repository has unborn HEAD; creating initial empty commit");

    let add_output = Command::new("git")
        .args(["add", "-A"])
        .current_dir(repo_path)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()
        .map_err(|e| format!("Failed to stage files for initial commit: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!(
            "Failed to stage files for initial commit: {}",
            stderr.trim()
        ));
    }

    let commit_output = Command::new("git")
        .args([
            "commit",
            "--allow-empty",
            "-m",
            "Initial commit created by Acepe for worktree support",
        ])
        .current_dir(repo_path)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env("GIT_AUTHOR_NAME", "Acepe")
        .env("GIT_AUTHOR_EMAIL", "acepe@local")
        .env("GIT_COMMITTER_NAME", "Acepe")
        .env("GIT_COMMITTER_EMAIL", "acepe@local")
        .output()
        .map_err(|e| format!("Failed to create initial commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(format!(
            "Failed to create initial commit: {}",
            stderr.trim()
        ));
    }

    tracing::info!(repo_path = %repo_path.display(), "Initial commit created for unborn repository");
    Ok(true)
}

/// Generate a unique worktree candidate that doesn't conflict with existing worktrees or branches
fn generate_unique_candidate(
    project_path: &Path,
    worktrees_dir: &Path,
    base_name: Option<&str>,
) -> Result<WorktreeInfo, String> {
    for _ in 0..26 {
        let name = match base_name {
            Some(base) => format!("{}-{}", base, generate_name()),
            None => generate_name(),
        };
        let branch = worktree_branch_name(&name);
        let directory = worktrees_dir.join(&name);

        // Check that neither the directory nor branch already exists
        if !directory.exists() && !branch_exists(project_path, &branch)? {
            return Ok(WorktreeInfo {
                name,
                branch,
                directory: directory.to_string_lossy().to_string(),
                origin: WorktreeOrigin::Acepe,
            });
        }
    }

    Err("Failed to generate unique worktree name after 26 attempts".to_string())
}

fn generate_unique_candidate_from_basename(
    project_path: &Path,
    worktrees_dir: &Path,
    basename: &str,
) -> Result<WorktreeInfo, String> {
    for suffix in 1..=99 {
        let name = if suffix == 1 {
            basename.to_string()
        } else {
            format!("{basename}-{suffix}")
        };
        let branch = worktree_branch_name(&name);
        let directory = worktrees_dir.join(&name);
        if !directory.exists() && !branch_exists(project_path, &branch)? {
            return Ok(WorktreeInfo {
                name,
                branch,
                directory: directory.to_string_lossy().to_string(),
                origin: WorktreeOrigin::Acepe,
            });
        }
    }

    Err("Failed to generate unique deterministic worktree name after 99 attempts".to_string())
}

fn build_renamed_worktree_path(current_path: &Path, new_name: &str) -> Result<PathBuf, String> {
    let parent = current_path
        .parent()
        .ok_or("Could not determine worktree parent directory")?;

    Ok(parent.join(new_name))
}

fn get_main_repo_from_worktree_path(worktree_path: &Path) -> Result<PathBuf, String> {
    let git_dir = worktree_path.join(".git");
    if !git_dir.is_file() {
        return Err("Could not determine main repository from worktree".to_string());
    }

    let content = std::fs::read_to_string(&git_dir)
        .map_err(|e| format!("Failed to read .git file: {}", e))?;
    let gitdir_path = content
        .strip_prefix("gitdir: ")
        .ok_or("Invalid .git file format")?
        .trim();
    let gitdir = PathBuf::from(gitdir_path);

    gitdir
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(Path::to_path_buf)
        .ok_or("Could not determine main repository".to_string())
}

fn create_worktree_from_info(project_path: &str, info: &WorktreeInfo) -> Result<(), String> {
    let project_path_buf = PathBuf::from(project_path);
    let bootstrapped_initial_commit = ensure_initial_commit_for_unborn_repo(&project_path_buf)?;
    tracing::info!(
        project_path = %project_path,
        bootstrapped_initial_commit,
        "Checked unborn HEAD status before worktree creation"
    );

    let base_ref = resolve_worktree_base_ref(&project_path_buf)?;
    tracing::info!(base_ref = %base_ref, "Resolved worktree base ref");

    if let Some(parent) = Path::new(&info.directory).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create worktree parent directory: {}", e))?;
    }

    let output = Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            &info.branch,
            &info.directory,
            &base_ref,
        ])
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("Failed to execute git worktree add: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!(stderr = %stderr, "Git worktree add failed");
        return Err(format!("Failed to create worktree: {}", stderr.trim()));
    }

    Ok(())
}

/// Create a new git worktree for isolated agent work
///
/// # Arguments
/// * `project_path` - The path to the main git repository
/// * `name` - Optional user-provided name (will be combined with random suffix if provided)
///
/// # Returns
/// * `WorktreeInfo` with the name, branch, and directory of the created worktree
#[tauri::command]
#[specta::specta]
pub async fn git_worktree_create(
    _app: AppHandle,
    project_path: String,
    name: Option<String>,
) -> CommandResult<WorktreeInfo>  {
    let project_path_buf = PathBuf::from(&project_path);

    if !project_path_buf.exists() {
        return Err(SerializableCommandError::expected(
            "git_worktree_create",
            format!("Path does not exist: {}", project_path),
        ));
    }

    if !unexpected_command_result(
        "git_worktree_create",
        "Failed to inspect git repository",
        check_git_repo_state(&project_path_buf),
    )? {
        return Err(SerializableCommandError::expected(
            "git_worktree_create",
            "This project is not a git repository",
        ));
    }

    if let Some(ref n) = name {
        path_safety::validate_path_segment(n, "worktree name").map_err(|e| {
            SerializableCommandError::expected(
                "git_worktree_create",
                format!("Invalid worktree name: {}", e),
            )
        })?;
    }

    unexpected_command_result("git_worktree_create", "Failed to create git worktree", async {

        tracing::info!(
            project_path = %project_path,
            name = ?name,
            "Creating git worktree"
        );

        // Get the worktrees directory for this project
        let worktrees_dir = get_project_worktrees_dir(&project_path)?;

        // Create the worktrees directory if it doesn't exist
        std::fs::create_dir_all(&worktrees_dir)
            .map_err(|e| format!("Failed to create worktrees directory: {}", e))?;

        // Generate a unique worktree name and branch
        let info = generate_unique_candidate(&project_path_buf, &worktrees_dir, name.as_deref())?;

        tracing::info!(
            worktree_name = %info.name,
            branch = %info.branch,
            directory = %info.directory,
            "Creating worktree"
        );

        create_worktree_from_info(&project_path, &info)?;

        tracing::info!(
            worktree_name = %info.name,
            directory = %info.directory,
            "Worktree created successfully"
        );

        Ok(info)

    }.await)
}

#[tauri::command]
#[specta::specta]
pub async fn git_prepare_worktree_session_launch(
    app: AppHandle,
    project_path: String,
    agent_id: String,
) -> CommandResult<PreparedWorktreeLaunch>  {
    unexpected_command_result("git_prepare_worktree_session_launch", "Failed to prepare worktree session launch", async {

        let project_path_buf = PathBuf::from(&project_path);
        if !check_git_repo_state(&project_path_buf)? {
            return Err("This project is not a git repository".to_string());
        }

        let db = app.state::<DbConn>();
        let reserved =
            SessionMetadataRepository::reserve_worktree_launch(db.inner(), &project_path, &agent_id)
                .await
                .map_err(|error| format!("Failed to reserve worktree launch: {error}"))?;

        let worktrees_dir = match get_project_worktrees_dir(&project_path) {
            Ok(path) => path,
            Err(error) => {
                let _ = SessionMetadataRepository::discard_reserved_worktree_launch(
                    db.inner(),
                    &reserved.launch_token,
                )
                .await;
                return Err(error);
            }
        };
        if let Err(error) = std::fs::create_dir_all(&worktrees_dir) {
            let _ = SessionMetadataRepository::discard_reserved_worktree_launch(
                db.inner(),
                &reserved.launch_token,
            )
            .await;
            return Err(format!("Failed to create worktrees directory: {error}"));
        }

        let basename =
            format_reserved_worktree_relative_path(&project_path_buf, reserved.sequence_id, &agent_id);
        let info =
            match generate_unique_candidate_from_basename(&project_path_buf, &worktrees_dir, &basename)
            {
                Ok(info) => info,
                Err(error) => {
                    let _ = SessionMetadataRepository::discard_reserved_worktree_launch(
                        db.inner(),
                        &reserved.launch_token,
                    )
                    .await;
                    return Err(error);
                }
            };

        if let Err(error) = create_worktree_from_info(&project_path, &info) {
            let _ = SessionMetadataRepository::discard_reserved_worktree_launch(
                db.inner(),
                &reserved.launch_token,
            )
            .await;
            return Err(error);
        }

        let attached = match SessionMetadataRepository::attach_reserved_worktree_launch(
            db.inner(),
            &reserved.launch_token,
            &info.directory,
        )
        .await
        {
            Ok(attached) => attached,
            Err(error) => {
                let _ = git_worktree_remove(info.directory.clone(), true).await;
                let _ = SessionMetadataRepository::discard_reserved_worktree_launch(
                    db.inner(),
                    &reserved.launch_token,
                )
                .await;
                return Err(format!(
                    "Failed to persist prepared worktree launch: {error}"
                ));
            }
        };

        Ok(PreparedWorktreeLaunch {
            launch_token: attached.launch_token,
            sequence_id: attached.sequence_id,
            worktree: info,
        })

    }.await)
}

#[tauri::command]
#[specta::specta]
pub async fn git_discard_prepared_worktree_session_launch(
    app: AppHandle,
    launch_token: String,
    remove_worktree: bool,
) -> CommandResult<()>  {
    unexpected_command_result("git_discard_prepared_worktree_session_launch", "Failed to discard prepared worktree session launch", async {

        let db = app.state::<DbConn>();
        let reserved = SessionMetadataRepository::get_by_id(db.inner(), &launch_token)
            .await
            .map_err(|error| format!("Failed to load prepared worktree launch: {error}"))?;
        let worktree_path = reserved.as_ref().and_then(|row| row.worktree_path.clone());

        SessionMetadataRepository::discard_reserved_worktree_launch(db.inner(), &launch_token)
            .await
            .map_err(|error| format!("Failed to discard prepared worktree launch: {error}"))?;

        if remove_worktree {
            if let Some(path) = worktree_path {
                let _ = git_worktree_remove(path, true).await;
            }
        }

        Ok(())

    }.await)
}

/// Remove a git worktree and its associated branch
///
/// # Arguments
/// * `worktree_path` - The path to the worktree to remove
/// * `force` - Whether to force removal even with uncommitted changes
#[tauri::command]
#[specta::specta]
pub async fn git_worktree_remove(worktree_path: String, force: bool) -> CommandResult<()>  {
    unexpected_command_result("git_worktree_remove", "Failed to remove git worktree", async {

        tracing::info!(
            worktree_path = %worktree_path,
            force = force,
            "Removing git worktree"
        );

        let worktree_path_buf = PathBuf::from(&worktree_path);

        if !worktree_path_buf.exists() {
            tracing::warn!(worktree_path = %worktree_path, "Worktree path does not exist");
            return Ok(());
        }

        let worktree_path_buf = worktree_config::validate_worktree_path(&worktree_path_buf)
            .map_err(|e| format!("Invalid worktree path: {}", e))?;

        // Find the main repository by going up the directory tree
        // Worktrees are in ~/.acepe/worktrees/<project-id>/<name>
        // We need to find the original repo to run git commands
        // Read the gitdir file to find the main repo
        let main_repo = get_main_repo_from_worktree_path(&worktree_path_buf)?;
        let branch_name = resolve_existing_managed_worktree_branch_name(&main_repo, &worktree_path_buf)?;

        // Remove the worktree
        let mut args = vec!["worktree", "remove"];
        if force {
            args.push("--force");
        }
        args.push(
            worktree_path_buf
                .to_str()
                .ok_or("Invalid worktree path encoding")?,
        );

        let output = Command::new("git")
            .args(&args)
            .current_dir(&main_repo)
            .output()
            .map_err(|e| format!("Failed to execute git worktree remove: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(stderr = %stderr, "Git worktree remove failed");
            return Err(format!("Failed to remove worktree: {}", stderr.trim()));
        }

        // Delete the branch
        if let Some(branch_name) = branch_name.as_ref() {
            let output = Command::new("git")
                .args(["branch", "-D", branch_name])
                .current_dir(&main_repo)
                .output()
                .map_err(|e| format!("Failed to execute git branch delete: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // Branch might already be deleted, just log warning
                tracing::warn!(stderr = %stderr, "Failed to delete branch (may already be deleted)");
            }
        }

        tracing::info!(
            worktree_path = %worktree_path,
            branch = ?branch_name,
            "Worktree and branch removed successfully"
        );

        Ok(())

    }.await)
}

#[tauri::command]
#[specta::specta]
pub async fn git_worktree_rename(
    worktree_path: String,
    new_name: String,
) -> CommandResult<WorktreeInfo>  {
    unexpected_command_result("git_worktree_rename", "Failed to rename git worktree", async {

        tracing::info!(
            worktree_path = %worktree_path,
            new_name = %new_name,
            "Renaming git worktree"
        );

        path_safety::validate_path_segment(&new_name, "worktree name")
            .map_err(|e| format!("Invalid worktree name: {}", e))?;

        let worktree_path_buf = worktree_config::validate_worktree_path(Path::new(&worktree_path))
            .map_err(|e| format!("Invalid worktree path: {}", e))?;

        if !worktree_path_buf.exists() {
            return Err("Worktree path does not exist".to_string());
        }

        let current_name = worktree_path_buf
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("Could not determine current worktree name")?;

        if current_name == new_name {
            let branch = get_current_branch(&worktree_path_buf)?;
            let origin = determine_worktree_origin(&worktree_path, &branch);
            return Ok(WorktreeInfo {
                name: new_name,
                branch,
                directory: worktree_path,
                origin,
            });
        }

        let renamed_path = build_renamed_worktree_path(&worktree_path_buf, &new_name)?;
        let validated_renamed_path = worktree_config::validate_worktree_path(&renamed_path)
            .map_err(|e| format!("Invalid renamed worktree path: {}", e))?;

        if validated_renamed_path.exists() {
            return Err(format!("A worktree named '{}' already exists", new_name));
        }

        let main_repo = get_main_repo_from_worktree_path(&worktree_path_buf)?;
        let current_branch = resolve_existing_managed_worktree_branch_name(&main_repo, &worktree_path_buf)?
            .ok_or("Could not determine managed branch for worktree")?;
        let renamed_branch = managed_worktree_branch_name(&validated_renamed_path)?;

        if current_branch != renamed_branch {
            if branch_exists(&main_repo, &renamed_branch)? {
                return Err(format!(
                    "A branch named '{}' already exists",
                    renamed_branch
                ));
            }

            let output = Command::new("git")
                .args(["branch", "-m", &current_branch, &renamed_branch])
                .current_dir(&main_repo)
                .output()
                .map_err(|e| format!("Failed to execute git branch rename: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to rename branch: {}", stderr.trim()));
            }
        }

        let output = Command::new("git")
            .args([
                "worktree",
                "move",
                &worktree_path,
                &validated_renamed_path.to_string_lossy(),
            ])
            .current_dir(&main_repo)
            .output()
            .map_err(|e| format!("Failed to execute git worktree move: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to rename worktree: {}", stderr.trim()));
        }

        let branch = get_current_branch(&validated_renamed_path)?;
        let directory = validated_renamed_path.to_string_lossy().into_owned();
        let origin = determine_worktree_origin(&directory, &branch);

        Ok(WorktreeInfo {
            name: new_name,
            branch,
            directory,
            origin,
        })

    }.await)
}

/// Reset a worktree to match the main branch (origin/main or main)
///
/// This performs:
/// 1. git fetch origin main
/// 2. git reset --hard origin/main (or main if no remote)
/// 3. git clean -fdx
/// 4. git submodule update --init --recursive --force
#[tauri::command]
#[specta::specta]
pub async fn git_worktree_reset(worktree_path: String) -> CommandResult<()>  {
    unexpected_command_result("git_worktree_reset", "Failed to reset git worktree", async {

        tracing::info!(worktree_path = %worktree_path, "Resetting git worktree");

        let worktree_path_buf = worktree_config::validate_worktree_path(Path::new(&worktree_path))
            .map_err(|e| format!("Invalid worktree path: {}", e))?;

        if !worktree_path_buf.exists() {
            return Err("Worktree path does not exist".to_string());
        }

        // Try to fetch from origin
        let _ = Command::new("git")
            .args(["fetch", "origin", "main"])
            .current_dir(&worktree_path)
            .output();

        // Determine the reset target (origin/main if available, otherwise main)
        let reset_target = if branch_exists(&worktree_path_buf, "origin/main")? {
            "origin/main"
        } else if branch_exists(&worktree_path_buf, "origin/master")? {
            "origin/master"
        } else if branch_exists(&worktree_path_buf, "main")? {
            "main"
        } else if branch_exists(&worktree_path_buf, "master")? {
            "master"
        } else {
            return Err("Could not find main/master branch to reset to".to_string());
        };

        tracing::info!(reset_target = %reset_target, "Resetting to target");

        // Hard reset
        let output = Command::new("git")
            .args(["reset", "--hard", reset_target])
            .current_dir(&worktree_path)
            .output()
            .map_err(|e| format!("Failed to execute git reset: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Git reset failed: {}", stderr.trim()));
        }

        // Clean untracked files
        let output = Command::new("git")
            .args(["clean", "-fdx"])
            .current_dir(&worktree_path)
            .output()
            .map_err(|e| format!("Failed to execute git clean: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!(stderr = %stderr, "Git clean failed (continuing anyway)");
        }

        // Update submodules if any
        let _ = Command::new("git")
            .args(["submodule", "update", "--init", "--recursive", "--force"])
            .current_dir(&worktree_path)
            .output();

        tracing::info!(worktree_path = %worktree_path, "Worktree reset successfully");

        Ok(())

    }.await)
}

/// Determine the origin of a worktree based on its path and branch name.
fn determine_worktree_origin(directory: &str, _branch: &str) -> WorktreeOrigin {
    // Acepe-created worktrees live under ~/.acepe/worktrees/
    if let Ok(root) = get_worktrees_root() {
        if Path::new(directory).starts_with(&root) {
            return WorktreeOrigin::Acepe;
        }
    }
    WorktreeOrigin::External
}

/// Parse `git worktree list --porcelain` output into WorktreeInfo entries.
fn parse_worktree_list_porcelain(output: &str, project_path: &Path) -> Vec<WorktreeInfo> {
    let canonical_project =
        std::fs::canonicalize(project_path).unwrap_or_else(|_| project_path.to_path_buf());

    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;
    let mut is_bare = false;
    let mut is_detached = false;

    let flush = |path: &Option<String>,
                 branch: &Option<String>,
                 is_bare: bool,
                 is_detached: bool,
                 canonical_project: &Path,
                 worktrees: &mut Vec<WorktreeInfo>| {
        if let Some(ref wt_path) = path {
            // Skip bare worktrees
            if is_bare {
                return;
            }

            // Skip main worktree (compare canonicalized paths)
            let canonical_wt =
                std::fs::canonicalize(wt_path).unwrap_or_else(|_| PathBuf::from(wt_path));
            if canonical_wt == canonical_project {
                return;
            }

            let name = PathBuf::from(wt_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let branch_display = if is_detached {
                "(detached)".to_string()
            } else {
                branch
                    .as_deref()
                    .map(|b| b.strip_prefix("refs/heads/").unwrap_or(b).to_string())
                    .unwrap_or_else(|| "(unknown)".to_string())
            };

            let origin = determine_worktree_origin(wt_path, &branch_display);

            worktrees.push(WorktreeInfo {
                name,
                branch: branch_display,
                directory: wt_path.clone(),
                origin,
            });
        }
    };

    for line in output.lines() {
        if line.is_empty() {
            flush(
                &current_path,
                &current_branch,
                is_bare,
                is_detached,
                &canonical_project,
                &mut worktrees,
            );
            current_path = None;
            current_branch = None;
            is_bare = false;
            is_detached = false;
            continue;
        }

        if let Some(path) = line.strip_prefix("worktree ") {
            // If we have a pending entry without a blank line separator, flush it
            if current_path.is_some() {
                flush(
                    &current_path,
                    &current_branch,
                    is_bare,
                    is_detached,
                    &canonical_project,
                    &mut worktrees,
                );
                current_branch = None;
                is_bare = false;
                is_detached = false;
            }
            current_path = Some(path.to_string());
        } else if let Some(branch_ref) = line.strip_prefix("branch ") {
            current_branch = Some(branch_ref.to_string());
        } else if line == "detached" {
            is_detached = true;
        } else if line == "bare" {
            is_bare = true;
        }
        // Silently skip unknown lines (HEAD, locked, prunable) for forward-compatibility
    }

    // Flush last entry (output may not end with trailing blank line)
    flush(
        &current_path,
        &current_branch,
        is_bare,
        is_detached,
        &canonical_project,
        &mut worktrees,
    );

    worktrees
}

/// List all worktrees for a project using `git worktree list --porcelain`.
///
/// Discovers both Acepe-created and externally-created worktrees.
#[tauri::command]
#[specta::specta]
pub async fn git_worktree_list(project_path: String) -> CommandResult<Vec<WorktreeInfo>>  {
    unexpected_command_result("git_worktree_list", "Failed to list git worktrees", async {

        tracing::debug!(project_path = %project_path, "Listing git worktrees");

        let project_path_buf = PathBuf::from(&project_path);
        if !project_path_buf.exists() {
            return Err(format!("Path does not exist: {}", project_path));
        }
        if !check_git_repo_state(&project_path_buf)? {
            return Ok(vec![]);
        }

        let output = Command::new("git")
            .args(["worktree", "list", "--porcelain"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to execute git worktree list: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to list worktrees: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let worktrees = parse_worktree_list_porcelain(&stdout, &project_path_buf);

        tracing::debug!(count = worktrees.len(), "Found worktrees");

        Ok(worktrees)

    }.await)
}

/// Get the disk size of a worktree directory in bytes
#[tauri::command]
#[specta::specta]
pub async fn git_worktree_disk_size(path: String) -> CommandResult<u64>  {
    unexpected_command_result("git_worktree_disk_size", "Failed to get worktree disk size", async {

        let path_buf = PathBuf::from(&path);

        if !path_buf.exists() {
            return Ok(0);
        }

        fn dir_size(path: &Path) -> std::io::Result<u64> {
            let mut size = 0;
            if path.is_dir() {
                for entry in std::fs::read_dir(path)? {
                    let entry = entry?;
                    let path = entry.path();
                    if path.is_dir() {
                        size += dir_size(&path)?;
                    } else {
                        size += entry.metadata()?.len();
                    }
                }
            } else {
                size = std::fs::metadata(path)?.len();
            }
            Ok(size)
        }

        dir_size(&path_buf).map_err(|e| format!("Failed to calculate disk size: {}", e))

    }.await)
}

/// Initialize a new git repository in the given directory
#[tauri::command]
#[specta::specta]
pub async fn git_init(project_path: String) -> CommandResult<()>  {
    unexpected_command_result("git_init", "Failed to initialize git repository", async {

        let path = PathBuf::from(&project_path);
        if !path.exists() {
            return Err(format!("Path does not exist: {}", project_path));
        }
        if is_git_repo_async(&path).await {
            return Err(format!(
                "Path is already a git repository: {}",
                project_path
            ));
        }

        let output = Command::new("git")
            .args(["init"])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to initialize git repository: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Failed to initialize git repository: {}",
                stderr.trim()
            ));
        }

        Ok(())

    }.await)
}

/// Check if a project is a git repository (for UI to show/hide worktree toggle)
#[tauri::command]
#[specta::specta]
pub async fn git_is_repo(project_path: String) -> CommandResult<bool>  {
    unexpected_command_result("git_is_repo", "Failed to check if path is git repository", async {

        let path = PathBuf::from(&project_path);
        if !path.exists() {
            return Err(format!("Path does not exist: {}", project_path));
        }
        Ok(is_git_repo_async(&path).await)

    }.await)
}

/// Get the current branch for a repository or worktree path
#[tauri::command]
#[specta::specta]
pub async fn git_current_branch(project_path: String) -> CommandResult<String>  {
    unexpected_command_result("git_current_branch", "Failed to get current git branch", async {

        let path = PathBuf::from(&project_path);
        if !path.exists() {
            return Err(format!("Path does not exist: {}", project_path));
        }
        get_current_branch(&path).map_err(|error| {
            if error.contains("Failed to get current branch") {
                format!("Path is not a git repository: {}", project_path)
            } else {
                error
            }
        })

    }.await)
}

/// List local branches for a repository or worktree path.
///
/// Excludes branches that are checked out in other worktrees, since git
/// prevents switching to them anyway. The branch checked out in the
/// current working directory (`project_path`) is always included.
#[tauri::command]
#[specta::specta]
pub async fn git_list_branches(project_path: String) -> CommandResult<Vec<String>>  {
    unexpected_command_result("git_list_branches", "Failed to list git branches", async {

        let path = PathBuf::from(&project_path);
        if !path.exists() {
            return Err(format!("Path does not exist: {}", project_path));
        }
        if !is_git_repo_async(&path).await {
            return Err(format!("Path is not a git repository: {}", project_path));
        }

        // Collect branches checked out in OTHER worktrees so we can exclude them.
        let worktree_branches = get_other_worktree_branches(&path);

        let output = Command::new("git")
            .args(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to list branches: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to list branches: {}", stderr.trim()));
        }

        let mut branches = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !worktree_branches.contains(*line))
            .map(ToOwned::to_owned)
            .collect::<Vec<String>>();
        branches.sort();
        Ok(branches)

    }.await)
}

/// Returns the set of branch names checked out in worktrees OTHER than the
/// one rooted at `current_dir`. Falls back to an empty set on any error so
/// callers always get a usable result.
fn get_other_worktree_branches(current_dir: &Path) -> std::collections::HashSet<String> {
    use std::collections::HashSet;

    let output = match std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(current_dir)
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return HashSet::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let canonical_current = current_dir.canonicalize().ok();

    let mut branches = HashSet::new();
    let mut current_wt_path: Option<PathBuf> = None;
    let mut current_branch: Option<String> = None;

    for line in stdout.lines() {
        if let Some(wt_path) = line.strip_prefix("worktree ") {
            // Flush previous entry
            if let (Some(wt), Some(branch)) = (current_wt_path.take(), current_branch.take()) {
                let is_self = canonical_current
                    .as_ref()
                    .map(|c| wt.canonicalize().ok().as_ref() == Some(c))
                    .unwrap_or(false);
                if !is_self {
                    branches.insert(branch);
                }
            }
            current_wt_path = Some(PathBuf::from(wt_path));
            current_branch = None;
        } else if let Some(branch_ref) = line.strip_prefix("branch refs/heads/") {
            current_branch = Some(branch_ref.to_string());
        } else if line.is_empty() {
            // Entry separator — flush
            if let (Some(wt), Some(branch)) = (current_wt_path.take(), current_branch.take()) {
                let is_self = canonical_current
                    .as_ref()
                    .map(|c| wt.canonicalize().ok().as_ref() == Some(c))
                    .unwrap_or(false);
                if !is_self {
                    branches.insert(branch);
                }
            }
        }
    }

    // Flush last entry (porcelain output may not end with blank line)
    if let (Some(wt), Some(branch)) = (current_wt_path, current_branch) {
        let is_self = canonical_current
            .as_ref()
            .map(|c| wt.canonicalize().ok().as_ref() == Some(c))
            .unwrap_or(false);
        if !is_self {
            branches.insert(branch);
        }
    }

    branches
}

/// Checkout an existing branch, optionally creating it first
#[tauri::command]
#[specta::specta]
pub async fn git_checkout_branch(
    app: tauri::AppHandle,
    project_path: String,
    branch: String,
    create: bool,
) -> CommandResult<String>  {
    unexpected_command_result("git_checkout_branch", "Failed to checkout git branch", async {

        let path = PathBuf::from(&project_path);
        if !path.exists() {
            return Err(format!("Path does not exist: {}", project_path));
        }
        if !is_git_repo_async(&path).await {
            return Err(format!("Path is not a git repository: {}", project_path));
        }

        let branch_name = branch.trim();
        if branch_name.is_empty() {
            return Err("Branch name cannot be empty".to_string());
        }

        let mut args = vec!["switch"];
        if create {
            args.push("-c");
        }
        args.push(branch_name);

        let output = Command::new("git")
            .args(args)
            .current_dir(&path)
            .output()
            .map_err(|e| format!("Failed to switch branch: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to switch branch: {}", stderr.trim()));
        }

        // Emit head-changed event so all frontend listeners update immediately
        let new_branch = super::watcher::read_branch_from_repo(&path);
        let _ = app.emit(
            "git:head-changed",
            super::watcher::GitHeadChangedPayload {
                project_path,
                branch: new_branch,
            },
        );

        Ok(branch_name.to_string())

    }.await)
}

/// Check if a repository has uncommitted changes
#[tauri::command]
#[specta::specta]
pub async fn git_has_uncommitted_changes(project_path: String) -> CommandResult<bool>  {
    unexpected_command_result("git_has_uncommitted_changes", "Failed to check for uncommitted changes", async {

        has_uncommitted_changes(&PathBuf::from(project_path))

    }.await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::fs;
    use tempfile::TempDir;

    fn run_git(repo_path: &Path, args: &[&str]) -> std::process::Output {
        Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .output()
            .expect("git command should run")
    }

    fn run_git_with_env(
        repo_path: &Path,
        args: &[&str],
        extra_env: &[(&str, &str)],
    ) -> std::process::Output {
        let mut command = Command::new("git");
        command
            .args(args)
            .current_dir(repo_path)
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE");

        for (key, value) in extra_env {
            command.env(key, value);
        }

        command.output().expect("git command should run")
    }

    fn git_stdout(repo_path: &Path, args: &[&str]) -> String {
        let output = run_git(repo_path, args);
        assert!(
            output.status.success(),
            "git command should succeed: {:?}",
            args
        );
        String::from_utf8(output.stdout)
            .expect("git output should be utf8")
            .trim()
            .to_string()
    }

    fn init_repo() -> TempDir {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let init_output = run_git(temp_dir.path(), &["init"]);
        assert!(init_output.status.success(), "git init should succeed");

        let set_main_output = run_git(
            temp_dir.path(),
            &["symbolic-ref", "HEAD", "refs/heads/main"],
        );
        assert!(
            set_main_output.status.success(),
            "git symbolic-ref HEAD refs/heads/main should succeed"
        );

        temp_dir
    }

    fn write_repo_file(repo_path: &Path, relative_path: &str, contents: &str) {
        let file_path = repo_path.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("parent directory should be created");
        }
        fs::write(file_path, contents).expect("file contents should be written");
    }

    #[test]
    fn formats_reserved_worktree_relative_path_with_timestamp_project_sequence_and_agent() {
        let now = Utc
            .with_ymd_and_hms(2026, 4, 14, 14, 35, 0)
            .single()
            .expect("fixed datetime should be valid");
        let formatted = format_reserved_worktree_relative_path_at(
            now,
            Path::new("/tmp/My Project"),
            41,
            "claude-code",
        );

        assert_eq!(formatted, "14-april-2026-14:35/my-project/41/claude-code");
    }

    #[test]
    fn branch_name_sanitizes_colons_but_preserves_hierarchy() {
        let branch = worktree_branch_name("14-april-2026-14:35/my-project/41/claude-code");

        assert_eq!(branch, "14-april-2026-14-35/my-project/41/claude-code");
    }

    fn commit_all(repo_path: &Path, message: &str) {
        let add_output = run_git(repo_path, &["add", "-A"]);
        assert!(add_output.status.success(), "git add -A should succeed");

        let commit_output = run_git_with_env(
            repo_path,
            &["commit", "-m", message],
            &[
                ("GIT_AUTHOR_NAME", "Acepe Tests"),
                ("GIT_AUTHOR_EMAIL", "acepe-tests@local"),
                ("GIT_COMMITTER_NAME", "Acepe Tests"),
                ("GIT_COMMITTER_EMAIL", "acepe-tests@local"),
            ],
        );
        assert!(
            commit_output.status.success(),
            "git commit should succeed: {}",
            String::from_utf8_lossy(&commit_output.stderr)
        );
    }

    fn init_bare_remote() -> TempDir {
        let remote_dir = TempDir::new().expect("remote temp dir should create");
        let init_output = run_git(remote_dir.path(), &["init", "--bare"]);
        assert!(
            init_output.status.success(),
            "git init --bare should succeed"
        );
        remote_dir
    }

    #[test]
    fn test_generate_name() {
        let name = generate_name();
        assert!(name.contains('-'), "Name should contain a hyphen");
        let parts: Vec<&str> = name.split('-').collect();
        assert_eq!(parts.len(), 2, "Name should have exactly two parts");
        assert!(
            ADJECTIVES.contains(&parts[0]),
            "First part should be an adjective"
        );
        assert!(NOUNS.contains(&parts[1]), "Second part should be a noun");
    }

    #[test]
    fn test_project_id_from_path() {
        let id1 = project_id_from_path("/Users/example/Documents/acepe");
        let id2 = project_id_from_path("/Users/example/Documents/acepe");
        let id3 = project_id_from_path("/Users/example/Documents/other");

        assert_eq!(id1.len(), 12, "Project ID should be 12 characters");
        assert_eq!(id1, id2, "Same path should produce same ID");
        assert_ne!(id1, id3, "Different paths should produce different IDs");
    }

    #[test]
    fn test_worktrees_root() {
        let root = get_worktrees_root().unwrap();
        assert!(
            root.ends_with(".acepe/worktrees"),
            "Root should end with .acepe/worktrees"
        );
    }

    #[test]
    fn test_parse_porcelain_basic() {
        let output = "\
worktree /nonexistent-acepe-test/main-repo
HEAD abc123
branch refs/heads/main

worktree /nonexistent-acepe-test/wt-feature
HEAD def456
branch refs/heads/feature/cool

";
        let result =
            parse_worktree_list_porcelain(output, Path::new("/nonexistent-acepe-test/main-repo"));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "wt-feature");
        assert_eq!(result[0].branch, "feature/cool");
        assert_eq!(result[0].directory, "/nonexistent-acepe-test/wt-feature");
    }

    #[test]
    fn test_parse_porcelain_detached_head() {
        let output = "\
worktree /nonexistent-acepe-test/main-repo
HEAD abc123
branch refs/heads/main

worktree /nonexistent-acepe-test/wt-detached
HEAD def456
detached

";
        let result =
            parse_worktree_list_porcelain(output, Path::new("/nonexistent-acepe-test/main-repo"));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch, "(detached)");
    }

    #[test]
    fn test_parse_porcelain_bare_filtered() {
        let output = "\
worktree /nonexistent-acepe-test/bare-repo
HEAD abc123
bare

worktree /nonexistent-acepe-test/wt-normal
HEAD def456
branch refs/heads/main

";
        let result =
            parse_worktree_list_porcelain(output, Path::new("/nonexistent-acepe-test/nonexistent"));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "wt-normal");
    }

    #[test]
    fn test_parse_porcelain_no_trailing_newline() {
        let output = "\
worktree /nonexistent-acepe-test/main-repo
HEAD abc123
branch refs/heads/main

worktree /nonexistent-acepe-test/wt-last
HEAD def456
branch refs/heads/clever-falcon";
        let result =
            parse_worktree_list_porcelain(output, Path::new("/nonexistent-acepe-test/main-repo"));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch, "clever-falcon");
    }

    #[test]
    fn test_parse_porcelain_empty_input() {
        let result = parse_worktree_list_porcelain("", Path::new("/nonexistent-acepe-test/repo"));
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_determine_origin_acepe_branch() {
        // Origin is now determined by path, not branch prefix
        assert_eq!(
            determine_worktree_origin("/some/path", "cool-name"),
            WorktreeOrigin::External
        );
    }

    #[test]
    fn test_determine_origin_external() {
        assert_eq!(
            determine_worktree_origin("/some/external/path", "feature/login"),
            WorktreeOrigin::External
        );
    }

    #[test]
    fn test_worktree_relative_name_preserves_nested_segments() {
        let worktree_dir = get_project_worktrees_dir("/Users/example/code/acepe")
            .expect("worktrees dir should resolve");
        let worktree_path = worktree_dir.join("15-april-2026-20:22/acepe/50/copilot");

        assert_eq!(
            worktree_relative_name(&worktree_path).expect("relative name should resolve"),
            "15-april-2026-20:22/acepe/50/copilot"
        );
    }

    #[test]
    fn test_managed_worktree_branch_name_sanitizes_nested_relative_path() {
        let worktree_dir = get_project_worktrees_dir("/Users/example/code/acepe")
            .expect("worktrees dir should resolve");
        let worktree_path = worktree_dir.join("15-april-2026-20:22/acepe/50/copilot");

        assert_eq!(
            managed_worktree_branch_name(&worktree_path).expect("managed branch name should resolve"),
            "15-april-2026-20-22/acepe/50/copilot"
        );
    }

    #[test]
    fn test_legacy_managed_worktree_branch_name_preserves_acepe_prefix() {
        let worktree_dir = get_project_worktrees_dir("/Users/example/code/acepe")
            .expect("worktrees dir should resolve");
        let worktree_path = worktree_dir.join("15-april-2026-20:22/acepe/50/copilot");

        assert_eq!(
            legacy_managed_worktree_branch_name(&worktree_path)
                .expect("legacy managed branch name should resolve"),
            "acepe/15-april-2026-20-22/acepe/50/copilot"
        );
    }

    #[test]
    fn test_build_renamed_worktree_path_swaps_last_segment() {
        let current = Path::new("/Users/example/.acepe/worktrees/123abc/happy-canyon");
        let renamed =
            build_renamed_worktree_path(current, "brave-river").expect("path should build");

        assert_eq!(
            renamed,
            PathBuf::from("/Users/example/.acepe/worktrees/123abc/brave-river")
        );
    }

    #[test]
    fn ensure_initial_commit_bootstraps_unborn_repo() {
        let repo_dir = init_repo();

        let changed = ensure_initial_commit_for_unborn_repo(repo_dir.path())
            .expect("initial commit bootstrap should succeed");

        assert!(changed, "unborn repo should be bootstrapped");
        assert!(has_valid_head(repo_dir.path()).expect("head check should work"));
    }

    #[test]
    fn ensure_initial_commit_is_noop_when_head_exists() {
        let repo_dir = init_repo();
        ensure_initial_commit_for_unborn_repo(repo_dir.path())
            .expect("initial bootstrap should succeed");

        let changed = ensure_initial_commit_for_unborn_repo(repo_dir.path())
            .expect("second bootstrap should succeed");

        assert!(
            !changed,
            "existing head should not create another initial commit"
        );
    }

    #[test]
    fn resolve_worktree_base_ref_prefers_origin_main_over_current_head() {
        let remote_dir = init_bare_remote();
        let repo_dir = init_repo();

        write_repo_file(repo_dir.path(), "README.md", "main branch\n");
        commit_all(repo_dir.path(), "initial commit");

        let remote_path = remote_dir.path().to_string_lossy().to_string();
        let add_remote_output =
            run_git(repo_dir.path(), &["remote", "add", "origin", &remote_path]);
        assert!(
            add_remote_output.status.success(),
            "git remote add should succeed"
        );

        let push_output = run_git(repo_dir.path(), &["push", "-u", "origin", "main"]);
        assert!(push_output.status.success(), "git push should succeed");

        let checkout_output = run_git(
            repo_dir.path(),
            &["checkout", "-b", "feature/worktree-base"],
        );
        assert!(
            checkout_output.status.success(),
            "git checkout -b should succeed"
        );

        write_repo_file(repo_dir.path(), "README.md", "feature branch\n");
        commit_all(repo_dir.path(), "feature commit");

        let base_ref = resolve_worktree_base_ref(repo_dir.path()).expect("base ref should resolve");

        assert_eq!(base_ref, "origin/main");
    }

    #[test]
    fn resolve_worktree_base_ref_falls_back_to_local_main_when_origin_main_is_missing() {
        let repo_dir = init_repo();

        write_repo_file(repo_dir.path(), "README.md", "main branch\n");
        commit_all(repo_dir.path(), "initial commit");

        let base_ref = resolve_worktree_base_ref(repo_dir.path()).expect("base ref should resolve");

        assert_eq!(base_ref, "main");
    }

    #[test]
    fn resolve_worktree_base_ref_fetches_latest_origin_main_before_use() {
        let remote_dir = init_bare_remote();
        let repo_dir = init_repo();

        write_repo_file(repo_dir.path(), "README.md", "initial\n");
        commit_all(repo_dir.path(), "initial commit");

        let remote_path = remote_dir.path().to_string_lossy().to_string();
        let add_remote_output =
            run_git(repo_dir.path(), &["remote", "add", "origin", &remote_path]);
        assert!(
            add_remote_output.status.success(),
            "git remote add should succeed"
        );

        let push_output = run_git(repo_dir.path(), &["push", "-u", "origin", "main"]);
        assert!(push_output.status.success(), "git push should succeed");

        let updater_dir = TempDir::new().expect("temp dir should create");
        let clone_output = Command::new("git")
            .args([
                "clone",
                &remote_path,
                updater_dir.path().to_string_lossy().as_ref(),
            ])
            .output()
            .expect("git clone should run");
        assert!(clone_output.status.success(), "git clone should succeed");

        let checkout_main_output =
            run_git(updater_dir.path(), &["checkout", "-B", "main", "origin/main"]);
        assert!(
            checkout_main_output.status.success(),
            "git checkout -B main origin/main should succeed: {}",
            String::from_utf8_lossy(&checkout_main_output.stderr)
        );

        write_repo_file(updater_dir.path(), "README.md", "remote update\n");
        commit_all(updater_dir.path(), "remote update");
        let updater_push_output = run_git(updater_dir.path(), &["push", "origin", "main"]);
        assert!(
            updater_push_output.status.success(),
            "git push from updater clone should succeed: {}",
            String::from_utf8_lossy(&updater_push_output.stderr)
        );

        let remote_head_before = git_stdout(repo_dir.path(), &["rev-parse", "origin/main"]);
        let local_head_before = git_stdout(repo_dir.path(), &["rev-parse", "main"]);
        assert_eq!(
            remote_head_before, local_head_before,
            "tracking ref should be stale before resolver fetches"
        );

        let base_ref = resolve_worktree_base_ref(repo_dir.path()).expect("base ref should resolve");
        assert_eq!(base_ref, "origin/main");

        let remote_head_after = git_stdout(repo_dir.path(), &["rev-parse", "origin/main"]);
        let actual_remote_head = git_stdout(updater_dir.path(), &["rev-parse", "main"]);
        assert_eq!(
            remote_head_after, actual_remote_head,
            "resolver should refresh origin/main before choosing base ref"
        );
    }
}
