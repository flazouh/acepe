use std::sync::Arc;

use crate::acp::event_hub::AcpEventHubState;
use crate::acp::session_open_snapshot::{
    session_open_result_from_completed_local_journal, session_open_result_from_provider_owned_snapshot,
    SessionOpenError, SessionOpenMissing, SessionOpenResult,
};
use sea_orm::DbConn;
use tauri::{AppHandle, Manager};

use super::provider_load::{load_provider_owned_session_snapshot, session_open_error_from_provider_load};
use super::restore_authority::restore_session_open_authority;

pub async fn get_session_open_result_domain(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<SessionOpenResult, String> {
    let db = app.state::<DbConn>();
    let hub = app.state::<Arc<AcpEventHubState>>().inner().clone();
    let app_clone = app.clone();

    let context = crate::history::session_context::resolve_session_context(
        Some(db.inner()),
        &session_id,
        &project_path,
        &agent_id,
        source_path.as_deref(),
    )
    .await;
    let replay_context = context.replay_context();
    let thread_content =
        match load_provider_owned_session_snapshot(app_clone, &replay_context).await {
            Ok(snapshot) => snapshot,
            Err(error) => {
                match session_open_result_from_completed_local_journal(
                    db.inner(),
                    &hub,
                    &replay_context,
                    &session_id,
                    crate::acp::session_state_engine::selectors::SessionGraphLifecycle::detached(
                        crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
                    ),
                    crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty(),
                )
                .await
                {
                    Ok(Some(result)) => {
                        restore_session_open_authority(&app, &result);
                        return Ok(result);
                    }
                    Ok(None) => {}
                    Err(message) => {
                        return Ok(SessionOpenResult::Error(SessionOpenError::internal(
                            &session_id,
                            message,
                        )));
                    }
                }

                let open_error = session_open_error_from_provider_load(&session_id, error);
                // GOD: emit a Failed lifecycle envelope so canonical readers see the
                // failure through the canonical channel — no client-side synthesis.
                let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
                    session_id: session_id.clone(),
                    attempt_id: 0,
                    error: open_error.message.clone(),
                    // Provider snapshot load failure — not the same path as
                    // `session/load` rejection. Treat as transient/transport
                    // by default; classifier could be invoked here in future
                    // if `ProviderHistoryLoadError` gains richer cases.
                    failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
                };
                crate::acp::commands::emit_lifecycle_event(
                    &app,
                    &Some(hub.clone()),
                    update,
                    &session_id,
                )
                .await;
                return Ok(SessionOpenResult::Error(open_error));
            }
        };

    let Some(thread_content) = thread_content else {
        match session_open_result_from_completed_local_journal(
            db.inner(),
            &hub,
            &replay_context,
            &session_id,
            crate::acp::session_state_engine::selectors::SessionGraphLifecycle::detached(
                crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
            ),
            crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty(),
        )
        .await
        {
            Ok(Some(result)) => {
                restore_session_open_authority(&app, &result);
                return Ok(result);
            }
            Ok(None) => {}
            Err(message) => {
                return Ok(SessionOpenResult::Error(SessionOpenError::internal(
                    &session_id,
                    message,
                )));
            }
        }

        // GOD: emit a Failed lifecycle envelope so canonical readers see the
        // missing state through the canonical channel — no client-side synthesis.
        // History-not-available means the provider has no replayable state for
        // this session — same upstream-permanent semantics as session-not-found
        // at the resume boundary, so classify as SessionGoneUpstream.
        let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
            session_id: session_id.clone(),
            attempt_id: 0,
            error: "Provider history is not available for this session".to_string(),
            failure_reason: crate::acp::lifecycle::FailureReason::SessionGoneUpstream,
        };
        crate::acp::commands::emit_lifecycle_event(&app, &Some(hub.clone()), update, &session_id)
            .await;
        return Ok(SessionOpenResult::Missing(SessionOpenMissing {
            requested_session_id: session_id,
        }));
    };

    let runtime_registry = app
        .try_state::<Arc<crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry>>()
        .map(|state| state.inner().clone());

    let result = session_open_result_from_provider_owned_snapshot(
        db.inner(),
        &hub,
        runtime_registry.as_deref(),
        &replay_context,
        &session_id,
        &thread_content,
    )
    .await;
    restore_session_open_authority(&app, &result);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::types::CanonicalAgentId;
    use crate::db::repository::{SessionJournalEventRepository, SessionMetadataRepository};
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory SQLite");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("Failed to run migrations");
        db
    }

    #[tokio::test]
    async fn journal_has_no_events_before_materialization() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "canonical-session",
            "/repo",
            "copilot",
            None,
        )
        .await
        .expect("seed metadata");
        let replay_context = SessionReplayContext {
            local_session_id: "canonical-session".to_string(),
            history_session_id: "provider-canonical-session".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: crate::acp::parsers::AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        let revision =
            SessionJournalEventRepository::max_event_seq(&db, &replay_context.local_session_id)
                .await
                .expect("read revision");

        assert_eq!(revision, None);
    }
}
