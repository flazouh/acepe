use crate::acp::session_descriptor::SessionCompatibilityInput;
use crate::acp::session_restore::load_provider_owned_session_snapshot;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_viewport::ledger::{
    SessionTranscriptRowLedgerStatus, TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
};
use crate::acp::transcript_viewport::ledger_rebuild::{
    rebuild_and_replace_current_transcript_row_ledger_from_journal,
    rebuild_and_replace_current_transcript_row_ledger_from_provider_snapshot,
};
use crate::commands::observability::{unexpected_command_result, CommandResult};
use crate::db::repository::{
    SessionMetadataRepository, SessionMetadataRow, SessionTranscriptRowLedgerRepository,
};
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const DEFAULT_LEDGER_BACKFILL_LIMIT: u64 = 8;
const MAX_LEDGER_BACKFILL_LIMIT: u64 = 32;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptRowLedgerBackfillResult {
    pub requested_limit: u64,
    pub candidate_count: u64,
    pub checked_count: u64,
    pub rebuilt_count: u64,
    pub rebuilt_from_provider_count: u64,
    pub skipped_current_count: u64,
    pub skipped_no_journal_count: u64,
    pub skipped_missing_facts_count: u64,
    pub failed_count: u64,
    pub failed_session_ids: Vec<String>,
}

impl TranscriptRowLedgerBackfillResult {
    fn new(requested_limit: u64, candidate_count: u64) -> Self {
        Self {
            requested_limit,
            candidate_count,
            checked_count: 0,
            rebuilt_count: 0,
            rebuilt_from_provider_count: 0,
            skipped_current_count: 0,
            skipped_no_journal_count: 0,
            skipped_missing_facts_count: 0,
            failed_count: 0,
            failed_session_ids: Vec::new(),
        }
    }
}

fn bounded_ledger_backfill_limit(limit: Option<u64>) -> u64 {
    limit
        .unwrap_or(DEFAULT_LEDGER_BACKFILL_LIMIT)
        .min(MAX_LEDGER_BACKFILL_LIMIT)
}

fn is_current_ledger(
    metadata: &crate::acp::transcript_viewport::ledger::SessionTranscriptRowLedgerMetadata,
) -> bool {
    metadata.rebuild_status == SessionTranscriptRowLedgerStatus::Current
        && metadata.projection_version == TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION
}

fn replay_context_for_backfill(
    row: &SessionMetadataRow,
) -> Result<crate::acp::session_descriptor::SessionReplayContext, String> {
    SessionMetadataRepository::resolve_existing_session_replay_context_from_metadata(
        &row.id,
        Some(row),
        SessionCompatibilityInput::default(),
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
pub(crate) async fn warm_recent_transcript_row_ledgers_with_db(
    db: &DbConn,
    limit: Option<u64>,
) -> Result<TranscriptRowLedgerBackfillResult, String> {
    warm_recent_transcript_row_ledgers_internal(None, db, limit).await
}

async fn warm_recent_transcript_row_ledgers_internal(
    app: Option<&AppHandle>,
    db: &DbConn,
    limit: Option<u64>,
) -> Result<TranscriptRowLedgerBackfillResult, String> {
    let requested_limit = bounded_ledger_backfill_limit(limit);
    let candidates = SessionMetadataRepository::get_recent_persisted_sessions(db, requested_limit)
        .await
        .map_err(|error| error.to_string())?;
    let mut result =
        TranscriptRowLedgerBackfillResult::new(requested_limit, candidates.len() as u64);
    let lifecycle = SessionGraphLifecycle::detached(
        crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
    );
    let capabilities = SessionGraphCapabilities::empty();

    for candidate in candidates {
        result.checked_count = result.checked_count.saturating_add(1);
        let metadata = SessionTranscriptRowLedgerRepository::read_metadata(db, &candidate.id)
            .await
            .map_err(|error| error.to_string())?;
        if metadata.as_ref().is_some_and(is_current_ledger) {
            result.skipped_current_count = result.skipped_current_count.saturating_add(1);
            continue;
        }

        let replay_context = match replay_context_for_backfill(&candidate) {
            Ok(context) => context,
            Err(_) => {
                result.skipped_missing_facts_count =
                    result.skipped_missing_facts_count.saturating_add(1);
                continue;
            }
        };

        match rebuild_and_replace_current_transcript_row_ledger_from_journal(
            db,
            &replay_context,
            &lifecycle,
            &capabilities,
        )
        .await
        {
            Ok(Some(_)) => {
                result.rebuilt_count = result.rebuilt_count.saturating_add(1);
            }
            Ok(None) => {
                let Some(app) = app else {
                    result.skipped_no_journal_count =
                        result.skipped_no_journal_count.saturating_add(1);
                    continue;
                };
                match load_provider_owned_session_snapshot(app.clone(), &replay_context).await {
                    Ok(Some(snapshot)) => {
                        match rebuild_and_replace_current_transcript_row_ledger_from_provider_snapshot(
                            db,
                            &replay_context,
                            &lifecycle,
                            &capabilities,
                            &snapshot,
                        )
                        .await
                        {
                            Ok(Some(_)) => {
                                result.rebuilt_count = result.rebuilt_count.saturating_add(1);
                                result.rebuilt_from_provider_count =
                                    result.rebuilt_from_provider_count.saturating_add(1);
                            }
                            Ok(None) => {
                                result.skipped_no_journal_count =
                                    result.skipped_no_journal_count.saturating_add(1);
                            }
                            Err(error) => {
                                tracing::warn!(
                                    session_id = %candidate.id,
                                    error = %error,
                                    "Idle transcript row ledger provider backfill failed"
                                );
                                result.failed_count = result.failed_count.saturating_add(1);
                                result.failed_session_ids.push(candidate.id);
                            }
                        }
                    }
                    Ok(None) => {
                        result.skipped_no_journal_count =
                            result.skipped_no_journal_count.saturating_add(1);
                    }
                    Err(error) => {
                        tracing::warn!(
                            session_id = %candidate.id,
                            error = ?error,
                            "Idle transcript row ledger provider history load failed"
                        );
                        result.failed_count = result.failed_count.saturating_add(1);
                        result.failed_session_ids.push(candidate.id);
                    }
                }
            }
            Err(error) => {
                tracing::warn!(
                    session_id = %candidate.id,
                    error = %error,
                    "Idle transcript row ledger backfill failed"
                );
                result.failed_count = result.failed_count.saturating_add(1);
                result.failed_session_ids.push(candidate.id);
            }
        }
    }

    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn warm_recent_transcript_row_ledgers(
    app: AppHandle,
    limit: Option<u64>,
) -> CommandResult<TranscriptRowLedgerBackfillResult> {
    unexpected_command_result(
        "warm_recent_transcript_row_ledgers",
        "Failed to warm recent transcript row ledgers",
        async {
            let db = app
                .try_state::<DbConn>()
                .ok_or_else(|| "Database not available".to_string())?
                .inner()
                .clone();
            warm_recent_transcript_row_ledgers_internal(Some(&app), &db, limit).await
        }
        .await,
    )
}

#[cfg(test)]
mod tests {
    use super::warm_recent_transcript_row_ledgers_with_db;
    use crate::acp::transcript_viewport::ledger::TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION;
    use crate::db::repository::{
        SessionJournalEventRepository, SessionMetadataRepository,
        SessionTranscriptRowLedgerRepository,
    };
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("run migrations");
        db
    }

    async fn insert_persisted_session(db: &DbConn, session_id: &str, timestamp: i64) {
        SessionMetadataRepository::upsert(
            db,
            session_id.to_string(),
            format!("Session {session_id}"),
            timestamp,
            "/test/repo".to_string(),
            "claude-code".to_string(),
            format!("-test-repo/{session_id}.jsonl"),
            timestamp,
            10,
        )
        .await
        .expect("insert session metadata");
    }

    async fn append_journal_barrier(db: &DbConn, session_id: &str) {
        SessionJournalEventRepository::append_materialization_barrier(db, session_id)
            .await
            .expect("append barrier");
    }

    #[tokio::test]
    async fn warm_recent_transcript_row_ledgers_is_bounded() {
        let db = setup_test_db().await;
        insert_persisted_session(&db, "session-old", 1).await;
        insert_persisted_session(&db, "session-newer", 2).await;
        insert_persisted_session(&db, "session-newest", 3).await;
        append_journal_barrier(&db, "session-old").await;
        append_journal_barrier(&db, "session-newer").await;
        append_journal_barrier(&db, "session-newest").await;

        let result = warm_recent_transcript_row_ledgers_with_db(&db, Some(2))
            .await
            .expect("warm ledgers");

        assert_eq!(result.requested_limit, 2);
        assert_eq!(result.candidate_count, 2);
        assert_eq!(result.checked_count, 2);
        assert_eq!(result.rebuilt_count, 2);
        assert!(
            SessionTranscriptRowLedgerRepository::read_metadata(&db, "session-old")
                .await
                .expect("read old metadata")
                .is_none(),
            "oldest session should not be touched past the limit"
        );
    }

    #[tokio::test]
    async fn warm_recent_transcript_row_ledgers_skips_current_ledger() {
        let db = setup_test_db().await;
        insert_persisted_session(&db, "session-current", 1).await;
        SessionTranscriptRowLedgerRepository::replace_current(
            &db,
            "session-current",
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            1,
            1,
            1,
            None,
            Vec::new(),
        )
        .await
        .expect("seed current ledger");

        let result = warm_recent_transcript_row_ledgers_with_db(&db, Some(1))
            .await
            .expect("warm ledgers");

        assert_eq!(result.checked_count, 1);
        assert_eq!(result.skipped_current_count, 1);
        assert_eq!(result.rebuilt_count, 0);
    }

    #[tokio::test]
    async fn warm_recent_transcript_row_ledgers_upgrades_stale_projection() {
        let db = setup_test_db().await;
        let session_id = "session-stale-projection";
        insert_persisted_session(&db, session_id, 1).await;
        append_journal_barrier(&db, session_id).await;
        SessionTranscriptRowLedgerRepository::replace_current(
            &db,
            session_id,
            "transcript_viewport_row:old",
            0,
            0,
            0,
            None,
            Vec::new(),
        )
        .await
        .expect("seed stale ledger");

        let result = warm_recent_transcript_row_ledgers_with_db(&db, Some(1))
            .await
            .expect("warm ledgers");

        assert_eq!(result.checked_count, 1);
        assert_eq!(result.skipped_current_count, 0);
        assert_eq!(result.rebuilt_count, 1);
        let metadata = SessionTranscriptRowLedgerRepository::read_metadata(&db, session_id)
            .await
            .expect("read metadata")
            .expect("rebuilt metadata should exist");
        assert_eq!(
            metadata.projection_version,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION
        );
        assert_eq!(metadata.row_count, 0);
    }

    #[tokio::test]
    async fn warm_recent_transcript_row_ledgers_reports_no_journal() {
        let db = setup_test_db().await;
        insert_persisted_session(&db, "session-no-journal", 1).await;

        let result = warm_recent_transcript_row_ledgers_with_db(&db, Some(1))
            .await
            .expect("warm ledgers");

        assert_eq!(result.checked_count, 1);
        assert_eq!(result.skipped_no_journal_count, 1);
        assert_eq!(result.rebuilt_count, 0);
    }
}
