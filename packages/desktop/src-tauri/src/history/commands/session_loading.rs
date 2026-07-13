use crate::acp::session_open_snapshot::SessionOpenResult;
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

async fn emit_transcript_repair_failure<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    error: &crate::acp::session_open_snapshot::SessionOpenError,
) {
    let supervisor = app.state::<std::sync::Arc<crate::acp::lifecycle::SessionSupervisor>>();
    let db = app.state::<DbConn>();
    let projection_registry =
        app.state::<std::sync::Arc<crate::acp::projections::ProjectionRegistry>>();
    let expected = match supervisor
        .inner()
        .reserve(db.inner(), projection_registry.inner(), session_id)
        .await
    {
        Ok(checkpoint) => checkpoint,
        Err(crate::acp::lifecycle::SessionSupervisorError::AlreadyReserved { .. }) => {
            let Some(checkpoint) = supervisor.inner().snapshot_for_session(session_id) else {
                return;
            };
            if !matches!(
                checkpoint.lifecycle.status,
                crate::acp::lifecycle::LifecycleStatus::Detached
                    | crate::acp::lifecycle::LifecycleStatus::Reserved
            ) {
                return;
            }
            checkpoint
        }
        Err(reservation_error) => {
            tracing::error!(
                session_id = %session_id,
                error = %reservation_error,
                "Failed to establish lifecycle authority for transcript repair failure"
            );
            return;
        }
    };
    let hub = app
        .try_state::<std::sync::Arc<crate::acp::event_hub::AcpEventHubState>>()
        .map(|state| state.inner().clone());
    let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
        session_id: session_id.to_string(),
        attempt_id: 0,
        error: error.message.clone(),
        failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
    };
    crate::acp::commands::emit_lifecycle_event_if_current(app, &hub, update, session_id, &expected)
        .await;
}

#[tauri::command]
#[specta::specta]
pub async fn get_session_open_result(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
    repair_priority: Option<crate::acp::session_restore::TranscriptRepairPriority>,
) -> Result<crate::acp::session_open_snapshot::SessionOpenResult, String> {
    get_session_open_result_domain(
        app.clone(),
        session_id,
        project_path,
        agent_id,
        source_path,
        repair_priority.unwrap_or(crate::acp::session_restore::TranscriptRepairPriority::Selected),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn await_session_open_repair(
    app: AppHandle,
    repair_ticket: String,
) -> Result<SessionOpenResult, String> {
    let coordinator = app
        .try_state::<std::sync::Arc<crate::acp::session_restore::TranscriptRepairCoordinator>>()
        .ok_or_else(|| "Transcript repair coordinator is unavailable".to_string())?;
    let request = match coordinator.await_ticket(&repair_ticket).await {
        Ok(request) => request,
        Err(error) => {
            let session_id = error.requested_session_id.clone();
            emit_transcript_repair_failure(&app, &session_id, &error).await;
            return Ok(SessionOpenResult::Error(error));
        }
    };
    let replay_context = request.replay_context;
    get_session_open_result_domain(
        app,
        replay_context.local_session_id,
        replay_context.project_path,
        replay_context.agent_id.to_string_with_prefix(),
        replay_context.source_path,
        crate::acp::session_restore::TranscriptRepairPriority::Selected,
    )
    .await
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use tauri::{
        test::{mock_builder, mock_context, noop_assets},
        Manager,
    };

    use super::emit_transcript_repair_failure;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect test database");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("migrate test database");
        db
    }

    #[tokio::test]
    async fn transcript_repair_failure_reserves_lifecycle_before_emitting_failure() {
        let db = setup_test_db().await;
        let session_id = "historical-repair-failure";
        crate::db::repository::SessionMetadataRepository::ensure_exists(
            &db, session_id, "/repo", "cursor", None,
        )
        .await
        .expect("seed session metadata");
        let hub = Arc::new(crate::acp::event_hub::AcpEventHubState::new());
        let projection_registry = Arc::new(crate::acp::projections::ProjectionRegistry::new());
        let transcript_registry =
            Arc::new(crate::acp::transcript_projection::TranscriptProjectionRegistry::new());
        let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
        let runtime_registry = Arc::new(
            crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry::with_supervisor(
                Arc::clone(&supervisor),
            ),
        );
        let app = mock_builder()
            .manage(db)
            .manage(hub)
            .manage(Arc::clone(&projection_registry))
            .manage(transcript_registry)
            .manage(runtime_registry)
            .manage(Arc::clone(&supervisor))
            .build(mock_context(noop_assets()))
            .expect("build mock app");

        emit_transcript_repair_failure(
            &app.handle().clone(),
            session_id,
            &crate::acp::session_open_snapshot::SessionOpenError::provider_history_missing(
                session_id,
                "history missing",
            ),
        )
        .await;

        let checkpoint = supervisor
            .snapshot_for_session(session_id)
            .expect("repair failure must establish lifecycle ownership");
        assert_eq!(
            checkpoint.lifecycle.status,
            crate::acp::lifecycle::LifecycleStatus::Failed
        );

        let journal_frontier = crate::db::repository::SessionJournalEventRepository::max_event_seq(
            app.state::<DbConn>().inner(),
            session_id,
        )
        .await
        .expect("load repair failure frontier");
        emit_transcript_repair_failure(
            &app.handle().clone(),
            session_id,
            &crate::acp::session_open_snapshot::SessionOpenError::provider_history_missing(
                session_id,
                "duplicate history failure",
            ),
        )
        .await;
        assert_eq!(
            crate::db::repository::SessionJournalEventRepository::max_event_seq(
                app.state::<DbConn>().inner(),
                session_id,
            )
            .await
            .expect("load duplicate repair failure frontier"),
            journal_frontier,
            "duplicate repair failures must not append another lifecycle transition"
        );

        supervisor.replace_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                10,
                crate::acp::lifecycle::LifecycleState::ready(),
                crate::acp::session_state_engine::SessionGraphCapabilities::empty(),
            ),
        );
        emit_transcript_repair_failure(
            &app.handle().clone(),
            session_id,
            &crate::acp::session_open_snapshot::SessionOpenError::provider_history_missing(
                session_id,
                "stale history failure",
            ),
        )
        .await;
        assert_eq!(
            supervisor
                .snapshot_for_session(session_id)
                .expect("ready checkpoint must remain")
                .lifecycle
                .status,
            crate::acp::lifecycle::LifecycleStatus::Ready,
            "a stale repair failure must not demote a ready session"
        );

        supervisor.replace_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                11,
                crate::acp::lifecycle::LifecycleState::activating(),
                crate::acp::session_state_engine::SessionGraphCapabilities::empty(),
            ),
        );
        emit_transcript_repair_failure(
            &app.handle().clone(),
            session_id,
            &crate::acp::session_open_snapshot::SessionOpenError::provider_history_missing(
                session_id,
                "in-flight history failure",
            ),
        )
        .await;
        assert_eq!(
            supervisor
                .snapshot_for_session(session_id)
                .expect("activating checkpoint must remain")
                .lifecycle
                .status,
            crate::acp::lifecycle::LifecycleStatus::Activating,
            "a stale repair failure must not demote an activating session"
        );
    }

    #[tokio::test]
    async fn transcript_repair_failure_demotes_detached_or_reserved_checkpoint_and_emits_envelope()
    {
        let db = setup_test_db().await;
        let session_id = "detached-repair-failure";
        crate::db::repository::SessionMetadataRepository::ensure_exists(
            &db, session_id, "/repo", "cursor", None,
        )
        .await
        .expect("seed session metadata");
        let hub = Arc::new(crate::acp::event_hub::AcpEventHubState::new());
        let projection_registry = Arc::new(crate::acp::projections::ProjectionRegistry::new());
        let transcript_registry =
            Arc::new(crate::acp::transcript_projection::TranscriptProjectionRegistry::new());
        let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
        assert!(supervisor.seed_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                7,
                crate::acp::lifecycle::LifecycleState::detached(
                    crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
                ),
                crate::acp::session_state_engine::SessionGraphCapabilities::empty(),
            ),
        ));
        let runtime_registry = Arc::new(
            crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry::with_supervisor(
                Arc::clone(&supervisor),
            ),
        );
        let app = mock_builder()
            .manage(db)
            .manage(Arc::clone(&hub))
            .manage(Arc::clone(&projection_registry))
            .manage(transcript_registry)
            .manage(runtime_registry)
            .manage(Arc::clone(&supervisor))
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        let mut receiver = hub.subscribe();

        emit_transcript_repair_failure(
            &app.handle().clone(),
            session_id,
            &crate::acp::session_open_snapshot::SessionOpenError::provider_history_missing(
                session_id,
                "detached history missing",
            ),
        )
        .await;

        assert_eq!(
            supervisor
                .snapshot_for_session(session_id)
                .expect("detached checkpoint must remain supervisor-owned")
                .lifecycle
                .status,
            crate::acp::lifecycle::LifecycleStatus::Failed,
        );
        let envelope = loop {
            let event =
                tokio::time::timeout(std::time::Duration::from_millis(200), receiver.recv())
                    .await
                    .expect("repair failure must publish an event")
                    .expect("repair failure event must be delivered");
            if event.event_name == "acp-session-state" {
                break serde_json::from_value::<
                    crate::acp::session_state_engine::SessionStateEnvelope,
                >(event.payload)
                .expect("deserialize repair failure envelope");
            }
        };
        match envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::Lifecycle {
                lifecycle, ..
            } => assert_eq!(
                lifecycle.status,
                crate::acp::lifecycle::LifecycleStatus::Failed,
            ),
            payload => panic!("expected lifecycle envelope, got {payload:?}"),
        }

        assert!(supervisor.replace_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                20,
                crate::acp::lifecycle::LifecycleState::reserved(),
                crate::acp::session_state_engine::SessionGraphCapabilities::empty(),
            ),
        ));
        emit_transcript_repair_failure(
            &app.handle().clone(),
            session_id,
            &crate::acp::session_open_snapshot::SessionOpenError::provider_history_missing(
                session_id,
                "reserved history missing",
            ),
        )
        .await;

        assert_eq!(
            supervisor
                .snapshot_for_session(session_id)
                .expect("reserved checkpoint must remain supervisor-owned")
                .lifecycle
                .status,
            crate::acp::lifecycle::LifecycleStatus::Failed,
        );
        let envelope = loop {
            let event =
                tokio::time::timeout(std::time::Duration::from_millis(200), receiver.recv())
                    .await
                    .expect("reserved repair failure must publish an event")
                    .expect("reserved repair failure event must be delivered");
            if event.event_name == "acp-session-state" {
                break serde_json::from_value::<
                    crate::acp::session_state_engine::SessionStateEnvelope,
                >(event.payload)
                .expect("deserialize reserved repair failure envelope");
            }
        };
        match envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::Lifecycle {
                lifecycle, ..
            } => assert_eq!(
                lifecycle.status,
                crate::acp::lifecycle::LifecycleStatus::Failed,
            ),
            payload => panic!("expected lifecycle envelope, got {payload:?}"),
        }
    }
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
