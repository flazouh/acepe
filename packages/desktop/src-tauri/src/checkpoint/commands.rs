//! Tauri commands for checkpoint operations.

use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;
use tauri::{AppHandle, State};
use uuid::Uuid;

use std::path::Path;

use super::manager::{convert_to_relative_path_with_cached_bases, CheckpointManager};
use super::repository::CheckpointRepository;
use crate::commands::observability::{
    CommandResult, SerializableCommandError, unexpected_command_result,
};
use super::types::{
    Checkpoint, CreateCheckpointInput, FileDiffContent, FileSnapshot, RevertResult,
};

/// Validate that an ID string is a valid UUID format.
///
/// This provides defense-in-depth by ensuring IDs have the expected format
/// before querying the database.
#[allow(clippy::result_large_err)]
fn validate_uuid(id: &str, field_name: &str, command_name: &'static str) -> CommandResult<()> {
    Uuid::parse_str(id).map_err(|_| {
        SerializableCommandError::expected(command_name, format!("Invalid {} format", field_name))
    })?;
    Ok(())
}

/// Verify that a checkpoint belongs to the specified session.
///
/// This provides defense-in-depth security by ensuring users can only
/// access checkpoints from their own sessions.
async fn verify_checkpoint_ownership(
    db: &DbConn,
    checkpoint_id: &str,
    session_id: &str,
    command_name: &'static str,
) -> CommandResult<Checkpoint> {
    // Validate UUID formats before querying
    validate_uuid(checkpoint_id, "checkpoint_id", command_name)?;
    validate_uuid(session_id, "session_id", command_name)?;

    let checkpoint = unexpected_command_result(
        command_name,
        "Failed to load checkpoint",
        CheckpointRepository::get_by_id(db, checkpoint_id)
            .await
            .map_err(|e| e.to_string()),
    )?
    .ok_or_else(|| {
        SerializableCommandError::expected(
            command_name,
            format!("Checkpoint not found: {}", checkpoint_id),
        )
    })?;

    if checkpoint.session_id != session_id {
        return Err(SerializableCommandError::expected(
            command_name,
            "Access denied: checkpoint belongs to a different session",
        ));
    }

    Ok(checkpoint)
}

/// Create a new checkpoint for a session.
///
/// Accepts absolute or relative file paths. Absolute paths are converted to relative
/// paths using worktree_path (if provided) or project_path as the root.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
#[specta::specta]
pub async fn checkpoint_create(
    db: State<'_, DbConn>,
    session_id: String,
    project_path: String,
    worktree_path: Option<String>,
    agent_id: Option<String>,
    modified_files: Vec<String>,
    tool_call_id: Option<String>,
    name: Option<String>,
    is_auto: bool,
) -> CommandResult<Checkpoint> {
    validate_uuid(&session_id, "session_id", "checkpoint_create")?;

    unexpected_command_result("checkpoint_create", "Failed to create checkpoint", async {
        tracing::debug!(
            session_id = %session_id,
            project_path = %project_path,
            worktree_path = ?worktree_path,
            file_count = modified_files.len(),
            is_auto = is_auto,
            "checkpoint_create command"
        );

        // Pre-canonicalize base paths once for all file conversions (performance optimization)
        let project = Path::new(&project_path);
        let project_canon = match project.canonicalize() {
            Ok(p) => p,
            Err(e) => {
                return Err(format!("Cannot access project directory: {}", e));
            }
        };
        let worktree_canon = worktree_path
            .as_ref()
            .and_then(|p| Path::new(p.as_str()).canonicalize().ok());

        let relative_files: Vec<String> = modified_files
            .into_iter()
            .filter_map(|file_path| {
                let path = Path::new(&file_path);

                // If already relative (doesn't start with / or drive letter), use as-is
                if !path.is_absolute() {
                    return Some(file_path);
                }

                // Convert absolute to relative using cached base paths
                match convert_to_relative_path_with_cached_bases(
                    path,
                    &project_canon,
                    worktree_canon.as_deref(),
                ) {
                    Ok(relative) => Some(relative),
                    Err(e) => {
                        tracing::warn!(
                            path = %file_path,
                            error = %e,
                            "Failed to convert path to relative, skipping"
                        );
                        None
                    }
                }
            })
            .collect();

        if relative_files.is_empty() {
            return Err("No valid files to checkpoint".to_string());
        }

        let input = CreateCheckpointInput {
            session_id,
            project_path,
            worktree_path,
            modified_files: relative_files,
            tool_call_id,
            name,
            is_auto,
        };

        let checkpoint_agent_id = agent_id.as_deref().unwrap_or("claude-code");
        SessionMetadataRepository::ensure_exists(
            &db,
            &input.session_id,
            &input.project_path,
            checkpoint_agent_id,
            input.worktree_path.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;

        CheckpointManager::create_checkpoint(&db, input)
            .await
            .map_err(|e| e.to_string())
    }.await)
}

/// List all checkpoints for a session.
#[tauri::command]
#[specta::specta]
pub async fn checkpoint_list(
    db: State<'_, DbConn>,
    session_id: String,
) -> CommandResult<Vec<Checkpoint>>  {
    validate_uuid(&session_id, "session_id", "checkpoint_list")?;

    unexpected_command_result("checkpoint_list", "Failed to list checkpoints", async {
        tracing::debug!(session_id = %session_id, "checkpoint_list command");

        CheckpointManager::list_checkpoints(&db, &session_id)
            .await
            .map_err(|e| e.to_string())

    }.await)
}

/// Get file content at a specific checkpoint.
#[tauri::command]
#[specta::specta]
pub async fn checkpoint_get_file_content(
    db: State<'_, DbConn>,
    session_id: String,
    checkpoint_id: String,
    file_path: String,
) -> CommandResult<String>  {
    verify_checkpoint_ownership(
        &db,
        &checkpoint_id,
        &session_id,
        "checkpoint_get_file_content",
    )
    .await?;

    unexpected_command_result("checkpoint_get_file_content", "Failed to get checkpoint file content", async {

        tracing::debug!(
            checkpoint_id = %checkpoint_id,
            session_id = %session_id,
            file_path = %file_path,
            "checkpoint_get_file_content command"
        );

        CheckpointManager::get_file_content_at_checkpoint(&db, &checkpoint_id, &file_path)
            .await
            .map_err(|e| e.to_string())

    }.await)
}

/// Get old and new file content for diff display at a checkpoint.
#[tauri::command]
#[specta::specta]
pub async fn checkpoint_get_file_diff_content(
    db: State<'_, DbConn>,
    session_id: String,
    checkpoint_id: String,
    file_path: String,
) -> CommandResult<FileDiffContent>  {
    let checkpoint = verify_checkpoint_ownership(
        &db,
        &checkpoint_id,
        &session_id,
        "checkpoint_get_file_diff_content",
    )
    .await?;
    tracing::debug!(
        checkpoint_id = %checkpoint_id,
        session_id = %session_id,
        file_path = %file_path,
        "checkpoint_get_file_diff_content command"
    );

    let old_content = unexpected_command_result(
        "checkpoint_get_file_diff_content",
        "Failed to get checkpoint file diff content",
        CheckpointRepository::get_previous_file_content(
            &db,
            &session_id,
            &file_path,
            checkpoint.checkpoint_number,
        )
        .await
        .map_err(|e| e.to_string()),
    )?;

    let new_content = unexpected_command_result(
        "checkpoint_get_file_diff_content",
        "Failed to get checkpoint file diff content",
        CheckpointRepository::get_file_content(&db, &checkpoint_id, &file_path)
            .await
            .map_err(|e| e.to_string()),
    )?
    .ok_or_else(|| {
        SerializableCommandError::expected(
            "checkpoint_get_file_diff_content",
            format!("File '{}' not found in checkpoint '{}'", file_path, checkpoint_id),
        )
    })?;

    Ok(FileDiffContent {
        old_content,
        new_content,
    })
}

/// Revert all files to a specific checkpoint.
///
/// When worktree_path is provided, files are restored to the worktree directory.
/// Otherwise, files are restored to project_path.
#[tauri::command]
#[specta::specta]
pub async fn checkpoint_revert(
    _app: AppHandle,
    db: State<'_, DbConn>,
    session_id: String,
    checkpoint_id: String,
    project_path: String,
    worktree_path: Option<String>,
) -> CommandResult<RevertResult>  {
    verify_checkpoint_ownership(&db, &checkpoint_id, &session_id, "checkpoint_revert").await?;

    unexpected_command_result("checkpoint_revert", "Failed to revert to checkpoint", async {

        // Use worktree path if provided, otherwise use project path
        let effective_path = worktree_path.as_ref().unwrap_or(&project_path);

        tracing::debug!(
            checkpoint_id = %checkpoint_id,
            session_id = %session_id,
            project_path = %project_path,
            worktree_path = ?worktree_path,
            effective_path = %effective_path,
            "checkpoint_revert command"
        );

        let result = CheckpointManager::revert_to_checkpoint(&db, &checkpoint_id, effective_path)
            .await
            .map_err(|e| e.to_string());

        result

    }.await)
}

/// Revert a single file to a specific checkpoint.
///
/// When worktree_path is provided, the file is restored to the worktree directory.
/// Otherwise, the file is restored to project_path.
#[tauri::command]
#[specta::specta]
pub async fn checkpoint_revert_file(
    db: State<'_, DbConn>,
    session_id: String,
    checkpoint_id: String,
    file_path: String,
    project_path: String,
    worktree_path: Option<String>,
) -> CommandResult<()>  {
    verify_checkpoint_ownership(&db, &checkpoint_id, &session_id, "checkpoint_revert_file")
        .await?;

    unexpected_command_result("checkpoint_revert_file", "Failed to revert file to checkpoint", async {

        // Use worktree path if provided, otherwise use project path
        let effective_path = worktree_path.as_ref().unwrap_or(&project_path);

        tracing::debug!(
            checkpoint_id = %checkpoint_id,
            session_id = %session_id,
            file_path = %file_path,
            project_path = %project_path,
            worktree_path = ?worktree_path,
            effective_path = %effective_path,
            "checkpoint_revert_file command"
        );

        CheckpointManager::revert_file(&db, &checkpoint_id, &file_path, effective_path)
            .await
            .map_err(|e| e.to_string())

    }.await)
}

/// Get file snapshots for a specific checkpoint.
#[tauri::command]
#[specta::specta]
pub async fn checkpoint_get_file_snapshots(
    db: State<'_, DbConn>,
    session_id: String,
    checkpoint_id: String,
) -> CommandResult<Vec<FileSnapshot>>  {
    verify_checkpoint_ownership(
        &db,
        &checkpoint_id,
        &session_id,
        "checkpoint_get_file_snapshots",
    )
    .await?;

    unexpected_command_result("checkpoint_get_file_snapshots", "Failed to get checkpoint file snapshots", async {

        tracing::debug!(
            checkpoint_id = %checkpoint_id,
            session_id = %session_id,
            "checkpoint_get_file_snapshots command"
        );

        CheckpointRepository::get_file_snapshots(&db, &checkpoint_id)
            .await
            .map_err(|e| e.to_string())

    }.await)
}
