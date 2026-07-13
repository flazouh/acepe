use std::sync::Arc;
use std::time::Instant;

use crate::acp::event_hub::AcpEventHubState;
use crate::acp::session_open_snapshot::{
    apply_runtime_authority_to_session_open_result,
    session_open_result_from_current_row_ledger_with_initial_page_policy,
    session_open_result_from_history_events, CurrentRowLedgerInitialPagePolicy,
    CurrentRowLedgerOpenLookup, SessionOpenError, SessionOpenPath, SessionOpenResult,
    SessionOpenResultTiming,
};
use crate::acp::types::CanonicalAgentId;
use sea_orm::DbConn;
use tauri::{AppHandle, Manager};

use super::restore_authority::restore_session_open_authority;

fn elapsed_ms(start: Instant) -> u128 {
    start.elapsed().as_millis()
}

const HOT_LEDGER_INITIAL_MAX_ROWS: u64 = 16;
const HOT_LEDGER_INITIAL_MIN_ROWS: usize = 8;
const HOT_LEDGER_INITIAL_PAYLOAD_BYTE_LIMIT: u64 = 24 * 1024;

fn attach_open_result_timing(
    mut result: SessionOpenResult,
    timing: SessionOpenResultTiming,
) -> SessionOpenResult {
    if let SessionOpenResult::Found(found) = &mut result {
        found.open_result_timing = Some(timing);
    }
    result
}

pub async fn get_session_open_result_domain(
    app: AppHandle,
    session_id: String,
    project_path: String,
    agent_id: String,
    source_path: Option<String>,
    repair_priority: super::TranscriptRepairPriority,
) -> Result<SessionOpenResult, String> {
    let total_started_at = Instant::now();
    let db = app.state::<DbConn>();
    let hub = app.state::<Arc<AcpEventHubState>>().inner().clone();
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
                restore_session_open_authority(&app, &result).await;
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

    if matches!(
        replay_context.agent_id,
        CanonicalAgentId::Cursor
            | CanonicalAgentId::ClaudeCode
            | CanonicalAgentId::OpenCode
            | CanonicalAgentId::Copilot
            | CanonicalAgentId::Codex
    ) {
        let provider_load_started_at = Instant::now();
        match super::fold_provider_load::load_provider_history_events(app.clone(), &replay_context)
            .await
        {
            Ok(Some(events)) if !events.is_empty() => {
                let provider_load_ms = elapsed_ms(provider_load_started_at);
                let assemble_started_at = Instant::now();
                let result = session_open_result_from_history_events(
                    db.inner(),
                    &hub,
                    runtime_registry.as_deref(),
                    &replay_context,
                    &session_id,
                    &events,
                )
                .await;
                let assemble_ms = elapsed_ms(assemble_started_at);
                if let SessionOpenResult::Found(found) = &result {
                    let transcript_entry_count = found.transcript_snapshot.entries.len();
                    let operation_count = found.operations.len();
                    let result = apply_runtime_authority_to_session_open_result(
                        result,
                        runtime_registry.as_deref(),
                    );
                    let restore_started_at = Instant::now();
                    restore_session_open_authority(&app, &result).await;
                    let restore_ms = elapsed_ms(restore_started_at);
                    let total_ms = elapsed_ms(total_started_at);
                    return Ok(attach_open_result_timing(
                        result,
                        SessionOpenResultTiming {
                            source: "fold-history".to_string(),
                            open_path: SessionOpenPath::FoldHistory,
                            ledger_probe_status: ledger_probe_status.clone(),
                            context_ms,
                            provider_load_ms,
                            ledger_tail_read_ms: elapsed_ms(ledger_tail_started_at),
                            ledger_journal_cutoff_ms: 0,
                            ledger_page_read_ms: 0,
                            ledger_header_decode_ms: 0,
                            ledger_rows_decode_ms: 0,
                            ledger_result_build_ms: 0,
                            runtime_lookup_ms,
                            assemble_ms,
                            restore_authority_ms: restore_ms,
                            compact_ms: 0,
                            local_journal_fallback_ms: 0,
                            total_ms,
                            transcript_entry_count,
                            operation_count,
                        },
                    ));
                }
            }
            Ok(Some(_)) | Ok(None) => {}
            Err(error) => {
                tracing::debug!(
                    session_id = %session_id,
                    agent_id = %replay_context.agent_id,
                    error = ?error,
                    "Fold history load unavailable; falling back to transcript repair"
                );
            }
        }
    }

    let coordinator = app.state::<Arc<super::TranscriptRepairCoordinator>>();
    let repair_ticket = coordinator.request(
        app.clone(),
        super::TranscriptRepairRequest { replay_context },
        repair_priority,
    );
    tracing::info!(
        session_id = %session_id,
        ledger_probe_status = %ledger_probe_status,
        elapsed_ms = elapsed_ms(total_started_at),
        "Canonical transcript repair queued for session open"
    );
    Ok(SessionOpenResult::Preparing(
        crate::acp::session_open_snapshot::SessionOpenPreparing {
            requested_session_id: session_id,
            repair_ticket,
        },
    ))
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
