use crate::acp::session_restore::{
    audit_session_load_timing_with_app, canonicalize_persisted_worktree_path,
    get_session_open_result_domain, SessionLoadTiming,
};
use crate::commands::observability::{
    unexpected_command_result, CommandResult, SerializableCommandError,
};
use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;
use tauri::{AppHandle, Manager};

#[tauri::command]
#[specta::specta]
pub async fn get_session_open_result(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<crate::acp::session_open_snapshot::SessionOpenResult, String> {
    get_session_open_result_domain(app, session_id, project_path, agent_id, source_path).await
}

/// Returns per-stage durations (ms) for file discovery, parse, convert, etc.
/// Supports Claude and Cursor in CLI mode; OpenCode requires running app.
#[tauri::command]
#[specta::specta]
pub async fn audit_session_load_timing(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> CommandResult<SessionLoadTiming> {
    unexpected_command_result(
        "audit_session_load_timing",
        "Failed to audit session load timing",
        audit_session_load_timing_with_app(app, session_id, project_path, agent_id, source_path)
            .await,
    )
}

/// Set the worktree path for a session in the metadata index.
/// Called by the frontend when a session is created within a worktree.
/// Accepts any existing git worktree path, not just Acepe-managed worktrees.
#[tauri::command]
#[specta::specta]
pub async fn set_session_worktree_path(
    app: AppHandle,
    session_id: String,
    worktree_path: String,
    project_path: Option<String>,
    agent_id: Option<String>,
) -> CommandResult<()> {
    unexpected_command_result(
        "set_session_worktree_path",
        "Failed to set session worktree path",
        async {
            tracing::info!(
                session_id = %session_id,
                worktree_path = %worktree_path,
                "Persisting worktree path for session"
            );

            let canonical = canonicalize_persisted_worktree_path(&worktree_path).map_err(|e| {
                tracing::error!(
                    session_id = %session_id,
                    worktree_path = %worktree_path,
                    error = %e,
                    "Worktree path validation failed"
                );
                format!("Invalid worktree path: {}", e)
            })?;

            let db = app
                .try_state::<DbConn>()
                .ok_or("Database not available")?
                .inner()
                .clone();

            SessionMetadataRepository::set_worktree_path(
                &db,
                &session_id,
                &canonical.to_string_lossy(),
                project_path.as_deref(),
                agent_id.as_deref(),
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    "Failed to persist worktree path to DB"
                );
                format!("Failed to set worktree path: {}", e)
            })?;

            if let (Some(_project_path), Some(_agent_id)) =
                (project_path.as_deref(), agent_id.as_deref())
            {
                SessionMetadataRepository::mark_as_acepe_managed(&db, &session_id)
                    .await
                    .map_err(|e| {
                        tracing::error!(
                            session_id = %session_id,
                            error = %e,
                            "Failed to promote session to Acepe-managed state"
                        );
                        format!("Failed to set worktree path: {}", e)
                    })?;
            }

            Ok(())
        }
        .await,
    )
}

/// Persist the PR number associated with a session.
/// Called by the frontend when a PR number is discovered in session entries.
#[tauri::command]
#[specta::specta]
pub async fn set_session_pr_number(
    app: AppHandle,
    session_id: String,
    pr_number: Option<i32>,
    pr_link_mode: Option<String>,
) -> CommandResult<()> {
    unexpected_command_result(
        "set_session_pr_number",
        "Failed to set session PR number",
        async {
            tracing::info!(
                session_id = %session_id,
                pr_number = ?pr_number,
                pr_link_mode = ?pr_link_mode,
                "Persisting PR number for session"
            );

            let db = app
                .try_state::<DbConn>()
                .ok_or("Database not available")?
                .inner()
                .clone();

            SessionMetadataRepository::set_pr_number(
                &db,
                &session_id,
                pr_number,
                pr_link_mode.as_deref(),
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    "Failed to persist PR number to DB"
                );
                format!("Failed to set PR number: {}", e)
            })
        }
        .await,
    )
}

/// Persist a user-provided title override for a session.
#[tauri::command]
#[specta::specta]
pub async fn set_session_title(
    app: AppHandle,
    session_id: String,
    title: String,
) -> CommandResult<()> {
    let trimmed_title = title.trim().to_string();
    if trimmed_title.is_empty() {
        return Err(SerializableCommandError::expected(
            "set_session_title",
            "Session title cannot be empty",
        ));
    }

    unexpected_command_result(
        "set_session_title",
        "Failed to set session title",
        async {
            tracing::info!(
                session_id = %session_id,
                "Persisting title override for session"
            );

            let db = app
                .try_state::<DbConn>()
                .ok_or("Database not available")?
                .inner()
                .clone();

            SessionMetadataRepository::set_title_override(
                &db,
                &session_id,
                Some(trimmed_title.as_str()),
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    "Failed to persist title override to DB"
                );
                format!("Failed to set session title: {}", e)
            })
        }
        .await,
    )
}
