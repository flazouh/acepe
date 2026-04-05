use super::*;
use crate::db::repository::{SessionMetadataRepository, SessionMetadataRow};
use crate::path_safety::{
    resolve_write_path, resolve_write_path_within_project, validate_project_directory_from_str,
};
use sea_orm::DbConn;
use std::path::Path;
use tauri::{AppHandle, Manager};

fn session_write_scope_root(metadata: &SessionMetadataRow) -> &str {
    match metadata.worktree_path.as_deref() {
        Some(worktree_path) => worktree_path,
        None => metadata.project_path.as_str(),
    }
}

async fn resolve_session_scoped_write_path(
    app: &AppHandle,
    session_id: &str,
    path: &Path,
) -> Result<std::path::PathBuf, SerializableAcpError> {
    let db = app.state::<DbConn>();
    let metadata = SessionMetadataRepository::get_by_id(db.inner(), session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Failed to load session metadata: {}", error),
        })?
        .ok_or_else(|| SerializableAcpError::SessionNotFound {
            session_id: session_id.to_string(),
        })?;
    let scope_root = session_write_scope_root(&metadata);
    let canonical_scope_root =
        validate_project_directory_from_str(scope_root).map_err(|error| {
            SerializableAcpError::InvalidState {
                message: error.message_for(Path::new(scope_root)),
            }
        })?;

    resolve_write_path_within_project(&canonical_scope_root, path)
        .map_err(|message| SerializableAcpError::InvalidState { message })
}

/// Read text content from a file (for ACP fs/read_text_file protocol)
///
/// Supports optional line-based pagination via line (1-based start) and limit parameters.
/// Returns the file content as a string.
#[tauri::command]
#[specta::specta]
pub async fn acp_read_text_file(
    path: String,
    line: Option<u32>,
    limit: Option<u32>,
) -> Result<String, SerializableAcpError> {
    tracing::debug!(path = %path, line = ?line, limit = ?limit, "acp_read_text_file called");

    // Normalize path to fix potential duplicate cwd issues from ACP subprocess
    let path = normalize_acp_path(&path);

    // Validate path is absolute
    let file_path = std::path::Path::new(&path);
    if !file_path.is_absolute() {
        return Err(SerializableAcpError::InvalidState {
            message: format!("Path must be absolute: {}", path),
        });
    }

    // Security: Check for path traversal attempts
    // Canonicalize the path to resolve any .. or symlinks
    let canonical_path = match tokio::fs::canonicalize(&path).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(path = %path, error = %e, "Failed to canonicalize path");
            return Err(SerializableAcpError::InvalidState {
                message: format!("Cannot access path: {}", e),
            });
        }
    };

    // Read the file content
    let content = match tokio::fs::read_to_string(&canonical_path).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(path = %path, error = %e, "Failed to read file");
            return Err(SerializableAcpError::InvalidState {
                message: format!("Failed to read file: {}", e),
            });
        }
    };

    // Apply line-based pagination if specified
    let result = match (line, limit) {
        (Some(start_line), Some(max_lines)) => {
            // line is 1-based, convert to 0-based index
            let start_idx = (start_line.saturating_sub(1)) as usize;
            content
                .lines()
                .skip(start_idx)
                .take(max_lines as usize)
                .collect::<Vec<_>>()
                .join("\n")
        }
        (Some(start_line), None) => {
            let start_idx = (start_line.saturating_sub(1)) as usize;
            content
                .lines()
                .skip(start_idx)
                .collect::<Vec<_>>()
                .join("\n")
        }
        (None, Some(max_lines)) => content
            .lines()
            .take(max_lines as usize)
            .collect::<Vec<_>>()
            .join("\n"),
        (None, None) => content,
    };

    tracing::debug!(
        path = %path,
        content_len = result.len(),
        "File read successfully"
    );

    Ok(result)
}

/// Write text content to a file (for ACP fs/write_text_file protocol)
///
/// Creates parent directories if they don't exist.
/// Overwrites existing file content.
#[tauri::command]
#[specta::specta]
pub async fn acp_write_text_file(
    app: AppHandle,
    path: String,
    content: String,
    session_id: Option<String>,
) -> Result<(), SerializableAcpError> {
    tracing::debug!(
        path = %path,
        content_len = content.len(),
        session_id = ?session_id,
        "acp_write_text_file called"
    );

    // Normalize path to fix potential duplicate cwd issues from ACP subprocess
    let path = normalize_acp_path(&path);

    // Validate path is absolute
    let file_path = std::path::Path::new(&path);
    if !file_path.is_absolute() {
        return Err(SerializableAcpError::InvalidState {
            message: format!("Path must be absolute: {}", path),
        });
    }

    let resolved_path = match session_id.as_deref() {
        Some(session_id) => resolve_session_scoped_write_path(&app, session_id, file_path).await?,
        None => resolve_write_path(file_path)
            .map_err(|message| SerializableAcpError::InvalidState { message })?,
    };

    // Create parent directories if they don't exist
    if let Some(parent) = resolved_path.parent() {
        if !parent.exists() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                tracing::warn!(path = %path, error = %e, "Failed to create parent directories");
                return Err(SerializableAcpError::InvalidState {
                    message: format!("Failed to create parent directories: {}", e),
                });
            }
        }
    }

    // Write the file content
    if let Err(e) = tokio::fs::write(&resolved_path, &content).await {
        tracing::warn!(path = %path, error = %e, "Failed to write file");
        return Err(SerializableAcpError::InvalidState {
            message: format!("Failed to write file: {}", e),
        });
    }

    tracing::info!(path = %path, "File written successfully");
    Ok(())
}
