use crate::acp::session_restore::{
    audit_session_load_timing_with_app, canonicalize_persisted_worktree_path,
    get_session_open_result_domain, SessionLoadTiming,
};
use crate::acp::{
    event_hub::AcpEventHubState,
    lifecycle::{FailureReason, LifecycleStatus},
    session_open_snapshot::SessionOpenResult,
    session_update::SessionUpdate,
};
use crate::commands::observability::{
    unexpected_command_result, CommandResult, SerializableCommandError,
};
use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;
use std::future::Future;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::{AppHandle, Manager};

static NEXT_SESSION_OPEN_AUTO_RECONNECT_ATTEMPT_ID: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
#[specta::specta]
pub async fn get_session_open_result(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<crate::acp::session_open_snapshot::SessionOpenResult, String> {
    let result = get_session_open_result_domain(
        app.clone(),
        session_id,
        project_path,
        agent_id,
        source_path,
    )
    .await?;
    start_auto_reconnect_for_open_result(app, &result).await;
    Ok(result)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct OpenResultAutoReconnectRequest {
    session_id: String,
    cwd: String,
    attempt_id: u64,
    open_token: String,
}

fn next_session_open_auto_reconnect_attempt_id() -> u64 {
    NEXT_SESSION_OPEN_AUTO_RECONNECT_ATTEMPT_ID.fetch_add(1, Ordering::Relaxed)
}

async fn start_auto_reconnect_for_open_result(app: AppHandle, result: &SessionOpenResult) {
    start_auto_reconnect_for_open_result_with_worker(
        app,
        result,
        next_session_open_auto_reconnect_attempt_id,
        |app, request| async move {
            crate::acp::commands::acp_resume_session(
                app,
                request.session_id,
                request.cwd,
                None,
                None,
                request.attempt_id,
                Some(request.open_token),
            )
            .await
        },
    )
    .await;
}

async fn start_auto_reconnect_for_open_result_with_worker<R, NextAttemptId, Worker, Work>(
    app: AppHandle<R>,
    result: &SessionOpenResult,
    next_attempt_id: NextAttemptId,
    worker: Worker,
) where
    R: tauri::Runtime,
    NextAttemptId: FnOnce() -> u64,
    Worker: FnOnce(AppHandle<R>, OpenResultAutoReconnectRequest) -> Work,
    Work: Future<Output = CommandResult<()>>,
{
    let Some(request) = auto_reconnect_request_from_open_result(result, next_attempt_id) else {
        return;
    };
    let session_id = request.session_id.clone();
    let attempt_id = request.attempt_id;
    if let Err(error) = worker(app.clone(), request).await {
        emit_auto_reconnect_start_failure(&app, &session_id, attempt_id, error).await;
    }
}

fn auto_reconnect_request_from_open_result<NextAttemptId>(
    result: &SessionOpenResult,
    next_attempt_id: NextAttemptId,
) -> Option<OpenResultAutoReconnectRequest>
where
    NextAttemptId: FnOnce() -> u64,
{
    let SessionOpenResult::Found(found) = result else {
        return None;
    };
    if found.lifecycle.status != LifecycleStatus::Reconnecting || found.open_token.is_empty() {
        return None;
    }
    Some(OpenResultAutoReconnectRequest {
        session_id: found.canonical_session_id.clone(),
        cwd: found.project_path.clone(),
        attempt_id: next_attempt_id(),
        open_token: found.open_token.clone(),
    })
}

async fn emit_auto_reconnect_start_failure<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    attempt_id: u64,
    error: SerializableCommandError,
) {
    let hub = app
        .try_state::<Arc<AcpEventHubState>>()
        .map(|state| state.inner().clone());
    let update = SessionUpdate::ConnectionFailed {
        session_id: session_id.to_string(),
        attempt_id,
        error: error.to_string(),
        failure_reason: FailureReason::ResumeFailed,
    };
    crate::acp::commands::emit_lifecycle_event(app, &hub, update, session_id).await;
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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_open_snapshot::{SessionOpenFound, SessionOpenPath, SessionOpenResult};
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
    };
    use crate::acp::transcript_projection::TranscriptSnapshot;
    use crate::acp::types::CanonicalAgentId;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[tokio::test]
    async fn auto_reconnect_starts_backend_resume_for_reconnecting_open_result() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let captured = Arc::new(Mutex::new(None));

        super::start_auto_reconnect_for_open_result_with_worker(
            app.handle().clone(),
            &found_result(SessionGraphLifecycle::reconnecting()),
            || 77,
            {
                let captured = Arc::clone(&captured);
                |_, request| async move {
                    *captured.lock().expect("capture lock") = Some(request);
                    Ok(())
                }
            },
        )
        .await;

        let request = captured
            .lock()
            .expect("capture lock")
            .clone()
            .expect("backend resume should start");
        assert_eq!(request.session_id, "session-1");
        assert_eq!(request.cwd, "/repo");
        assert_eq!(request.attempt_id, 77);
        assert_eq!(request.open_token, "open-token-1");
    }

    #[tokio::test]
    async fn auto_reconnect_does_not_resume_ready_open_result() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let captured = Arc::new(Mutex::new(None));

        super::start_auto_reconnect_for_open_result_with_worker(
            app.handle().clone(),
            &found_result(SessionGraphLifecycle::ready()),
            || 77,
            {
                let captured = Arc::clone(&captured);
                |_, request| async move {
                    *captured.lock().expect("capture lock") = Some(request);
                    Ok(())
                }
            },
        )
        .await;

        assert!(
            captured.lock().expect("capture lock").is_none(),
            "ready sessions must not start another backend reconnect",
        );
    }

    fn found_result(lifecycle: SessionGraphLifecycle) -> SessionOpenResult {
        SessionOpenResult::Found(Box::new(SessionOpenFound {
            requested_session_id: "session-1".to_string(),
            canonical_session_id: "session-1".to_string(),
            is_alias: false,
            last_event_seq: 1,
            graph_revision: 1,
            open_token: "open-token-1".to_string(),
            agent_id: CanonicalAgentId::Codex,
            project_path: "/repo".to_string(),
            worktree_path: None,
            source_path: None,
            sequence_id: Some(1),
            transcript_snapshot: TranscriptSnapshot {
                revision: 1,
                entries: Vec::new(),
            },
            session_title: "Session".to_string(),
            operations: Vec::new(),
            interactions: Vec::new(),
            turn_state: SessionTurnState::Completed,
            message_count: 0,
            activity: SessionGraphActivity::idle(),
            active_streaming_tail: None,
            lifecycle,
            capabilities: SessionGraphCapabilities::empty(),
            open_path: SessionOpenPath::HotLedger,
            initial_transcript_row_page: None,
            initial_viewport_envelope: None,
            open_result_timing: None,
            active_turn_failure: None,
            last_terminal_turn_id: None,
        }))
    }
}
