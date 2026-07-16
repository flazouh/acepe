use crate::acp::commands::transcript_viewport_commands::TranscriptViewportCommandRevision;
use crate::acp::error::SerializableAcpError;
use crate::acp::session_open_snapshot::{
    hot_ledger_rows_require_historical_normalization, sanitize_transcript_rows_for_historical_open,
};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::transcript_viewport::ledger::{
    validate_current_row_payload, SessionTranscriptRowLedgerMetadata,
    SessionTranscriptRowLedgerRead, TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
};
use crate::acp::transcript_viewport::TranscriptViewportRow;
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use crate::db::repository::SessionTranscriptRowLedgerRepository;
use sea_orm::DbConn;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

const MAX_TRANSCRIPT_ROW_PAGE_LIMIT: u64 = 512;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TranscriptRowPageResult {
    Current {
        projection_version: String,
        start_row_index: i64,
        total_row_count: i64,
        row_payload_bytes: u64,
        transcript_revision: i64,
        graph_revision: i64,
        last_event_seq: i64,
        rows: Vec<TranscriptViewportRow>,
    },
    Missing,
    Stale {
        projection_version: String,
        total_row_count: i64,
        transcript_revision: i64,
        graph_revision: i64,
        last_event_seq: i64,
    },
}

#[tauri::command]
#[specta::specta]
pub async fn acp_read_transcript_row_page(
    app: AppHandle,
    db: State<'_, DbConn>,
    session_id: String,
    start_row_index: i64,
    limit: u64,
    expected_revision: TranscriptViewportCommandRevision,
) -> CommandResult<TranscriptRowPageResult> {
    let db = db.inner().clone();
    let runtime_registry = app.state::<Arc<SessionGraphRuntimeRegistry>>();
    expected_acp_command_result(
        "acp_read_transcript_row_page",
        read_transcript_row_page_from_ledger(
            &db,
            &session_id,
            start_row_index,
            limit,
            expected_revision.into(),
            Some(runtime_registry.inner().as_ref()),
        )
        .await,
    )
}

pub(crate) async fn read_transcript_row_page_from_ledger(
    db: &DbConn,
    session_id: &str,
    start_row_index: i64,
    limit: u64,
    expected_revision: SessionGraphRevision,
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
) -> Result<TranscriptRowPageResult, SerializableAcpError> {
    let bounded_start_row_index = start_row_index.max(0);
    let bounded_limit = limit.clamp(1, MAX_TRANSCRIPT_ROW_PAGE_LIMIT);
    let ledger_read = SessionTranscriptRowLedgerRepository::read_range_page(
        db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        bounded_start_row_index,
        bounded_limit,
    )
    .await
    .map_err(|error| SerializableAcpError::InvalidState {
        message: format!("Failed to read transcript row page: {error}"),
    })?;

    match ledger_read {
        SessionTranscriptRowLedgerRead::Missing => Ok(TranscriptRowPageResult::Missing),
        SessionTranscriptRowLedgerRead::Stale { metadata } => Ok(stale_page_result(metadata)),
        SessionTranscriptRowLedgerRead::Current { metadata, rows } => {
            if metadata.transcript_revision != expected_revision.transcript_revision
                || metadata.graph_revision != expected_revision.graph_revision
                || metadata.last_event_seq != expected_revision.last_event_seq
            {
                return Ok(stale_page_result(metadata));
            }

            let row_payload_bytes = rows
                .iter()
                .map(|row| row.row_json.len() as u64)
                .sum::<u64>();
            let mut decoded_rows = rows
                .into_iter()
                .map(|row| {
                    let decoded: TranscriptViewportRow =
                        serde_json::from_str(&row.row_json).map_err(|error| {
                            SerializableAcpError::InvalidState {
                                message: format!(
                                    "Persisted transcript row {} could not be decoded: {error}",
                                    row.row_id
                                ),
                            }
                        })?;
                    if decoded.row_id != row.row_id {
                        return Err(SerializableAcpError::InvalidState {
                            message: format!(
                                "Persisted transcript row id mismatch: metadata {}, payload {}",
                                row.row_id, decoded.row_id
                            ),
                        });
                    }
                    if decoded.version != row.row_version {
                        return Err(SerializableAcpError::InvalidState {
                            message: format!(
                                "Persisted transcript row {} version mismatch: metadata {}, payload {}",
                                row.row_id, row.row_version, decoded.version
                            ),
                        });
                    }
                    validate_current_row_payload(&decoded).map_err(|error| {
                        SerializableAcpError::InvalidState {
                            message: format!(
                                "Persisted transcript row {} is not render-ready: {error}",
                                row.row_id
                            ),
                        }
                    })?;
                    Ok(decoded)
                })
                .collect::<Result<Vec<_>, SerializableAcpError>>()?;
            let runtime_snapshot = runtime_registry
                .and_then(|registry| registry.current_snapshot_for_session(session_id));
            if hot_ledger_rows_require_historical_normalization(runtime_snapshot.as_ref()) {
                sanitize_transcript_rows_for_historical_open(&mut decoded_rows);
            }

            Ok(TranscriptRowPageResult::Current {
                projection_version: metadata.projection_version,
                start_row_index: bounded_start_row_index,
                total_row_count: metadata.row_count,
                row_payload_bytes,
                transcript_revision: metadata.transcript_revision,
                graph_revision: metadata.graph_revision,
                last_event_seq: metadata.last_event_seq,
                rows: decoded_rows,
            })
        }
    }
}

fn stale_page_result(metadata: SessionTranscriptRowLedgerMetadata) -> TranscriptRowPageResult {
    TranscriptRowPageResult::Stale {
        projection_version: metadata.projection_version,
        total_row_count: metadata.row_count,
        transcript_revision: metadata.transcript_revision,
        graph_revision: metadata.graph_revision,
        last_event_seq: metadata.last_event_seq,
    }
}

#[cfg(test)]
mod tests {
    use super::{read_transcript_row_page_from_ledger, TranscriptRowPageResult};
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
    use crate::acp::transcript_viewport::ledger::{
        serialize_viewport_rows_for_ledger, TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
    };
    use crate::acp::transcript_viewport::row::{
        TranscriptViewportRow, TranscriptViewportRowContent, TranscriptViewportRowKind,
    };
    use crate::db::repository::{SessionMetadataRepository, SessionTranscriptRowLedgerRepository};
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect test database");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("run migrations");
        db
    }

    async fn ensure_test_session(db: &DbConn, session_id: &str) {
        SessionMetadataRepository::ensure_exists(db, session_id, "/test/repo", "claude-code", None)
            .await
            .expect("ensure test session");
    }

    fn test_row(row_id: &str, text: &str) -> TranscriptViewportRow {
        TranscriptViewportRow {
            row_id: row_id.to_string(),
            source_entry_id: row_id.to_string(),
            scope: crate::acp::transcript_projection::TranscriptScope::Root,
            kind: TranscriptViewportRowKind::AssistantText,
            version: format!("{row_id}:v1"),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{row_id}:segment:0"),
                    text: text.to_string(),
                }],
            },
            duration_started_at_ms: None,
        }
    }

    async fn write_rows(
        db: &DbConn,
        session_id: &str,
        rows: Vec<TranscriptViewportRow>,
    ) -> Vec<u64> {
        let serialized = serialize_viewport_rows_for_ledger(
            session_id,
            7,
            11,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            &rows,
        )
        .expect("serialize ledger rows");
        let row_payload_bytes = serialized
            .iter()
            .map(|row| row.row_json.len() as u64)
            .collect::<Vec<_>>();
        SessionTranscriptRowLedgerRepository::replace_current(
            db,
            session_id,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            7,
            11,
            13,
            None,
            serialized,
        )
        .await
        .expect("write current ledger");
        row_payload_bytes
    }

    #[tokio::test]
    async fn row_page_command_returns_current_range_from_ledger() {
        let db = setup_test_db().await;
        let session_id = "row-page-current-session";
        ensure_test_session(&db, session_id).await;
        let row_payload_bytes = write_rows(
            &db,
            session_id,
            vec![
                test_row("row-0", "zero"),
                test_row("row-1", "one"),
                test_row("row-2", "two"),
            ],
        )
        .await;
        let expected_page_payload_bytes = row_payload_bytes[1] + row_payload_bytes[2];

        let result = read_transcript_row_page_from_ledger(
            &db,
            session_id,
            1,
            2,
            SessionGraphRevision::new(11, 7, 13),
            None,
        )
        .await
        .expect("read page");

        let TranscriptRowPageResult::Current {
            start_row_index,
            total_row_count,
            row_payload_bytes,
            transcript_revision,
            graph_revision,
            last_event_seq,
            rows,
            ..
        } = result
        else {
            panic!("expected current row page");
        };
        assert_eq!(start_row_index, 1);
        assert_eq!(total_row_count, 3);
        assert_eq!(row_payload_bytes, expected_page_payload_bytes);
        assert_eq!(transcript_revision, 7);
        assert_eq!(graph_revision, 11);
        assert_eq!(last_event_seq, 13);
        assert_eq!(
            rows.iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["row-1", "row-2"]
        );
    }

    #[tokio::test]
    async fn row_page_command_returns_stale_when_expected_revision_differs() {
        let db = setup_test_db().await;
        let session_id = "row-page-stale-session";
        ensure_test_session(&db, session_id).await;
        write_rows(&db, session_id, vec![test_row("row-0", "zero")]).await;

        let result = read_transcript_row_page_from_ledger(
            &db,
            session_id,
            0,
            128,
            SessionGraphRevision::new(11, 7, 12),
            None,
        )
        .await
        .expect("read page");

        let TranscriptRowPageResult::Stale {
            total_row_count,
            transcript_revision,
            graph_revision,
            last_event_seq,
            ..
        } = result
        else {
            panic!("expected stale row page");
        };
        assert_eq!(total_row_count, 1);
        assert_eq!(transcript_revision, 7);
        assert_eq!(graph_revision, 11);
        assert_eq!(last_event_seq, 13);
    }

    #[tokio::test]
    async fn row_page_command_returns_missing_when_ledger_is_absent() {
        let db = setup_test_db().await;

        let result = read_transcript_row_page_from_ledger(
            &db,
            "missing-row-page-session",
            0,
            128,
            SessionGraphRevision::new(11, 7, 13),
            None,
        )
        .await
        .expect("read page");

        assert_eq!(result, TranscriptRowPageResult::Missing);
    }
}
