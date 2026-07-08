use std::sync::Arc;
use std::time::Instant;

use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_open_snapshot::{
    apply_runtime_authority_to_session_open_result, compact_oversized_session_open_result,
    session_open_result_from_completed_local_journal,
    session_open_result_from_current_row_ledger_with_initial_page_policy,
    session_open_result_from_provider_owned_snapshot, CurrentRowLedgerInitialPagePolicy,
    CurrentRowLedgerOpenLookup, SessionOpenError, SessionOpenMissing, SessionOpenPath,
    SessionOpenResult, SessionOpenResultTiming,
};
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::session_state_engine::transcript_rows_ledger::TranscriptRowsLedgerWriteHint;
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use sea_orm::DbConn;
use tauri::{AppHandle, Manager};

use super::provider_load::{
    load_provider_owned_session_snapshot, session_open_error_from_provider_load,
};
use super::restore_authority::restore_session_open_authority;

fn elapsed_ms(start: Instant) -> u128 {
    start.elapsed().as_millis()
}

const HOT_LEDGER_INITIAL_MAX_ROWS: u64 = 16;
const HOT_LEDGER_INITIAL_MIN_ROWS: usize = 8;
const HOT_LEDGER_INITIAL_PAYLOAD_BYTE_LIMIT: u64 = 24 * 1024;

fn session_open_result_counts(result: &SessionOpenResult) -> (usize, usize) {
    match result {
        SessionOpenResult::Found(found) => (
            found.transcript_snapshot.entries.len(),
            found.operations.len(),
        ),
        SessionOpenResult::Missing(_) | SessionOpenResult::Error(_) => (0, 0),
    }
}

fn attach_open_result_timing(
    mut result: SessionOpenResult,
    timing: SessionOpenResultTiming,
) -> SessionOpenResult {
    if let SessionOpenResult::Found(found) = &mut result {
        found.open_result_timing = Some(timing);
    }
    result
}

fn set_open_path(mut result: SessionOpenResult, open_path: SessionOpenPath) -> SessionOpenResult {
    if let SessionOpenResult::Found(found) = &mut result {
        found.open_path = open_path;
    }
    result
}

async fn persist_open_result_row_ledger_if_possible(
    app: &AppHandle,
    db: &DbConn,
    result: &SessionOpenResult,
    runtime_registry: Option<&Arc<SessionGraphRuntimeRegistry>>,
) {
    let SessionOpenResult::Found(found) = result else {
        return;
    };
    let Some(runtime_registry) = runtime_registry else {
        return;
    };
    let Some(projection_registry) = app.try_state::<Arc<ProjectionRegistry>>() else {
        return;
    };
    let Some(transcript_projection_registry) = app.try_state::<Arc<TranscriptProjectionRegistry>>()
    else {
        return;
    };

    let revision = crate::acp::session_state_engine::SessionGraphRevision::new(
        found.graph_revision,
        found.transcript_snapshot.revision,
        found.last_event_seq,
    );
    if let Err(error) = runtime_registry
        .persist_current_transcript_row_ledger(
            db,
            &found.canonical_session_id,
            revision,
            projection_registry.inner(),
            transcript_projection_registry.inner(),
            TranscriptRowsLedgerWriteHint::full_replace(),
        )
        .await
    {
        tracing::warn!(
            session_id = %found.canonical_session_id,
            error = %error,
            "Legacy session open succeeded but transcript row ledger persistence failed"
        );
    }
}

async fn persist_local_journal_row_ledger_if_possible(
    db: &DbConn,
    replay_context: &crate::acp::session_descriptor::SessionReplayContext,
    lifecycle: &crate::acp::session_state_engine::selectors::SessionGraphLifecycle,
    capabilities: &crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
) {
    if let Err(error) =
        crate::acp::transcript_viewport::ledger_rebuild::rebuild_and_replace_current_transcript_row_ledger_from_journal(
            db,
            replay_context,
            lifecycle,
            capabilities,
        )
        .await
    {
        tracing::warn!(
            session_id = %replay_context.local_session_id,
            error = %error,
            "Local journal fallback succeeded but transcript row ledger rebuild failed"
        );
    }
}

pub async fn get_session_open_result_domain(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
) -> Result<SessionOpenResult, String> {
    let total_started_at = Instant::now();
    let db = app.state::<DbConn>();
    let hub = app.state::<Arc<AcpEventHubState>>().inner().clone();
    let app_clone = app.clone();

    let context_started_at = Instant::now();
    let context = crate::history::session_context::resolve_session_context(
        Some(db.inner()),
        &session_id,
        &project_path,
        &agent_id,
        source_path.as_deref(),
    )
    .await;
    let context_ms = elapsed_ms(context_started_at);
    let replay_context = context.replay_context();
    let runtime_lookup_started_at = Instant::now();
    let runtime_registry = app
        .try_state::<Arc<crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry>>()
        .map(|state| state.inner().clone());
    let runtime_lookup_ms = elapsed_ms(runtime_lookup_started_at);
    let ledger_tail_started_at = Instant::now();
    let ledger_probe_status =
        match session_open_result_from_current_row_ledger_with_initial_page_policy(
            db.inner(),
            &hub,
            &replay_context,
            &session_id,
            CurrentRowLedgerInitialPagePolicy::byte_bounded(
                HOT_LEDGER_INITIAL_MAX_ROWS,
                HOT_LEDGER_INITIAL_MIN_ROWS,
                HOT_LEDGER_INITIAL_PAYLOAD_BYTE_LIMIT,
            ),
        )
        .await
        {
            Ok(CurrentRowLedgerOpenLookup::Found { result, timing }) => {
                let ledger_tail_read_ms = elapsed_ms(ledger_tail_started_at);
                let result = apply_runtime_authority_to_session_open_result(
                    result,
                    runtime_registry.as_deref(),
                );
                let restore_started_at = Instant::now();
                restore_session_open_authority(&app, &result);
                let restore_ms = elapsed_ms(restore_started_at);
                let total_ms = elapsed_ms(total_started_at);
                let result = attach_open_result_timing(
                    result,
                    SessionOpenResultTiming {
                        source: "transcript-row-ledger".to_string(),
                        open_path: SessionOpenPath::HotLedger,
                        ledger_probe_status: "current".to_string(),
                        context_ms,
                        provider_load_ms: 0,
                        ledger_tail_read_ms,
                        ledger_journal_cutoff_ms: timing.journal_cutoff_ms,
                        ledger_page_read_ms: timing.page_read_ms,
                        ledger_header_decode_ms: timing.header_decode_ms,
                        ledger_rows_decode_ms: timing.rows_decode_ms,
                        ledger_result_build_ms: timing.result_build_ms,
                        runtime_lookup_ms,
                        assemble_ms: 0,
                        restore_authority_ms: restore_ms,
                        compact_ms: 0,
                        local_journal_fallback_ms: 0,
                        total_ms,
                        transcript_entry_count: 0,
                        operation_count: 0,
                    },
                );
                return Ok(result);
            }
            Ok(CurrentRowLedgerOpenLookup::Miss(miss)) => miss.timing_label().to_string(),
            Err(message) => {
                return Ok(SessionOpenResult::Error(SessionOpenError::internal(
                    &session_id,
                    message,
                )));
            }
        };
    let provider_load_started_at = Instant::now();
    let thread_content = match load_provider_owned_session_snapshot(app_clone, &replay_context)
        .await
    {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let fallback_lifecycle =
                crate::acp::session_state_engine::selectors::SessionGraphLifecycle::detached(
                    crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
                );
            let fallback_capabilities =
                crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty();
            match session_open_result_from_completed_local_journal(
                db.inner(),
                &hub,
                &replay_context,
                &session_id,
                fallback_lifecycle.clone(),
                fallback_capabilities.clone(),
            )
            .await
            {
                Ok(Some(result)) => {
                    let result = apply_runtime_authority_to_session_open_result(
                        result,
                        runtime_registry.as_deref(),
                    );
                    restore_session_open_authority(&app, &result);
                    let (ledger_lifecycle, ledger_capabilities) = match &result {
                        SessionOpenResult::Found(found) => (&found.lifecycle, &found.capabilities),
                        SessionOpenResult::Missing(_) | SessionOpenResult::Error(_) => {
                            (&fallback_lifecycle, &fallback_capabilities)
                        }
                    };
                    persist_local_journal_row_ledger_if_possible(
                        db.inner(),
                        &replay_context,
                        ledger_lifecycle,
                        ledger_capabilities,
                    )
                    .await;
                    return Ok(compact_oversized_session_open_result(result));
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
    let provider_load_ms = elapsed_ms(provider_load_started_at);

    let Some(thread_content) = thread_content else {
        let fallback_lifecycle =
            crate::acp::session_state_engine::selectors::SessionGraphLifecycle::detached(
                crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
            );
        let fallback_capabilities =
            crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty();
        match session_open_result_from_completed_local_journal(
            db.inner(),
            &hub,
            &replay_context,
            &session_id,
            fallback_lifecycle.clone(),
            fallback_capabilities.clone(),
        )
        .await
        {
            Ok(Some(result)) => {
                let result = apply_runtime_authority_to_session_open_result(
                    result,
                    runtime_registry.as_deref(),
                );
                restore_session_open_authority(&app, &result);
                let (ledger_lifecycle, ledger_capabilities) = match &result {
                    SessionOpenResult::Found(found) => (&found.lifecycle, &found.capabilities),
                    SessionOpenResult::Missing(_) | SessionOpenResult::Error(_) => {
                        (&fallback_lifecycle, &fallback_capabilities)
                    }
                };
                persist_local_journal_row_ledger_if_possible(
                    db.inner(),
                    &replay_context,
                    ledger_lifecycle,
                    ledger_capabilities,
                )
                .await;
                return Ok(compact_oversized_session_open_result(result));
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

    let assemble_started_at = Instant::now();
    let result = session_open_result_from_provider_owned_snapshot(
        db.inner(),
        &hub,
        runtime_registry.as_deref(),
        &replay_context,
        &session_id,
        &thread_content,
    )
    .await;
    let result =
        apply_runtime_authority_to_session_open_result(result, runtime_registry.as_deref());
    let result = set_open_path(result, SessionOpenPath::LegacyRebuild);
    let assemble_ms = elapsed_ms(assemble_started_at);
    let restore_started_at = Instant::now();
    restore_session_open_authority(&app, &result);
    let restore_ms = elapsed_ms(restore_started_at);
    persist_open_result_row_ledger_if_possible(
        &app,
        db.inner(),
        &result,
        runtime_registry.as_ref(),
    )
    .await;
    let compact_started_at = Instant::now();
    let compacted = compact_oversized_session_open_result(result);
    let compact_ms = elapsed_ms(compact_started_at);
    let total_ms = elapsed_ms(total_started_at);
    let (transcript_entry_count, operation_count) = session_open_result_counts(&compacted);
    let compacted = attach_open_result_timing(
        compacted,
        SessionOpenResultTiming {
            source: "provider-owned-legacy-rebuild".to_string(),
            open_path: SessionOpenPath::LegacyRebuild,
            ledger_probe_status,
            context_ms,
            provider_load_ms,
            ledger_tail_read_ms: 0,
            ledger_journal_cutoff_ms: 0,
            ledger_page_read_ms: 0,
            ledger_header_decode_ms: 0,
            ledger_rows_decode_ms: 0,
            ledger_result_build_ms: 0,
            runtime_lookup_ms,
            assemble_ms,
            restore_authority_ms: restore_ms,
            compact_ms,
            local_journal_fallback_ms: 0,
            total_ms,
            transcript_entry_count,
            operation_count,
        },
    );
    if total_ms > 500 {
        tracing::warn!(
            session_id = %session_id,
            agent_id = %agent_id,
            context_ms,
            provider_load_ms,
            runtime_lookup_ms,
            assemble_ms,
            restore_ms,
            compact_ms,
            total_ms,
            transcript_entry_count,
            operation_count,
            "Slow session-open result command"
        );
    }
    Ok(compacted)
}

#[cfg(test)]
mod tests {
    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::session_open_snapshot::{
        SessionOpenFound, SessionOpenMissing, SessionOpenPath, SessionOpenResult,
    };
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
    };
    use crate::acp::transcript_projection::TranscriptSnapshot;
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

    #[test]
    fn legacy_rebuild_classification_is_explicit_on_fallback_found_result() {
        let result = SessionOpenResult::Found(Box::new(SessionOpenFound {
            requested_session_id: "requested-session".to_string(),
            canonical_session_id: "canonical-session".to_string(),
            is_alias: true,
            last_event_seq: 1,
            graph_revision: 1,
            open_token: "open-token".to_string(),
            agent_id: CanonicalAgentId::Codex,
            project_path: "/repo".to_string(),
            worktree_path: None,
            source_path: None,
            sequence_id: None,
            transcript_snapshot: TranscriptSnapshot {
                revision: 1,
                entries: Vec::new(),
            },
            session_title: "Fallback session".to_string(),
            operations: Vec::new(),
            interactions: Vec::new(),
            turn_state: SessionTurnState::Idle,
            message_count: 0,
            activity: SessionGraphActivity::idle(),
            active_streaming_tail: None,
            lifecycle: SessionGraphLifecycle::detached(
                crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
            ),
            capabilities: SessionGraphCapabilities::empty(),
            open_path: SessionOpenPath::CompatSnapshot,
            initial_transcript_row_page: None,
            initial_viewport_envelope: None,
            open_result_timing: None,
            active_turn_failure: None,
            last_terminal_turn_id: None,
        }));

        let classified = super::set_open_path(result, SessionOpenPath::LegacyRebuild);
        let SessionOpenResult::Found(found) = classified else {
            panic!("expected found result");
        };
        assert_eq!(found.open_path, SessionOpenPath::LegacyRebuild);
    }

    #[test]
    fn open_path_classification_leaves_missing_result_unchanged() {
        let result = SessionOpenResult::Missing(SessionOpenMissing {
            requested_session_id: "missing-session".to_string(),
        });

        let classified = super::set_open_path(result, SessionOpenPath::LegacyRebuild);

        assert!(matches!(classified, SessionOpenResult::Missing(_)));
    }
}
