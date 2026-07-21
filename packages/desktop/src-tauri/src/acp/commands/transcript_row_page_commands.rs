use crate::acp::commands::transcript_viewport_commands::TranscriptViewportCommandRevision;
use crate::acp::error::SerializableAcpError;
use crate::acp::session::delivery::history_load::load_fold_graph_from_history;
use crate::acp::session_open_snapshot::{
    hot_ledger_rows_require_historical_normalization, sanitize_transcript_rows_for_historical_open,
};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::session_update::ToolKind;
use crate::acp::transcript_projection::TranscriptScope;
use crate::acp::transcript_viewport::ledger::{
    validate_current_row_payload, SessionTranscriptRowLedgerMetadata,
    SessionTranscriptRowLedgerRead, TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
};
use crate::acp::transcript_viewport::project_transcript_viewport_rows_for_scope;
use crate::acp::transcript_viewport::TranscriptViewportRow;
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use crate::db::repository::{SessionMetadataRepository, SessionTranscriptRowLedgerRepository};
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
    scope: TranscriptScope,
    start_row_index: i64,
    limit: u64,
    expected_revision: TranscriptViewportCommandRevision,
) -> CommandResult<TranscriptRowPageResult> {
    let db = db.inner().clone();
    let runtime_registry = app.state::<Arc<SessionGraphRuntimeRegistry>>();
    expected_acp_command_result(
        "acp_read_transcript_row_page",
        read_transcript_row_page_for_scope_from_ledger(
            &db,
            &session_id,
            &scope,
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
    read_transcript_row_page_for_scope_from_ledger(
        db,
        session_id,
        &TranscriptScope::Root,
        start_row_index,
        limit,
        expected_revision,
        runtime_registry,
    )
    .await
}

pub(crate) async fn read_transcript_row_page_for_scope_from_ledger(
    db: &DbConn,
    session_id: &str,
    scope: &TranscriptScope,
    start_row_index: i64,
    limit: u64,
    expected_revision: SessionGraphRevision,
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
) -> Result<TranscriptRowPageResult, SerializableAcpError> {
    let bounded_start_row_index = start_row_index.max(0);
    let bounded_limit = limit.clamp(1, MAX_TRANSCRIPT_ROW_PAGE_LIMIT);
    let ledger_read = SessionTranscriptRowLedgerRepository::read_range_page_for_scope(
        db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        scope,
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

            let runtime_snapshot = runtime_registry
                .and_then(|registry| registry.current_snapshot_for_session(session_id));
            if let Some(recovered_page) = read_empty_task_scope_from_provider_history(
                db,
                session_id,
                scope,
                bounded_start_row_index,
                bounded_limit,
                &metadata,
            )
            .await?
            {
                return Ok(recovered_page);
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

async fn read_empty_task_scope_from_provider_history(
    db: &DbConn,
    session_id: &str,
    scope: &TranscriptScope,
    start_row_index: i64,
    limit: u64,
    metadata: &SessionTranscriptRowLedgerMetadata,
) -> Result<Option<TranscriptRowPageResult>, SerializableAcpError> {
    if metadata.row_count != 0 {
        return Ok(None);
    }

    let TranscriptScope::Operation(operation_id) = scope else {
        return Ok(None);
    };

    let Some(session_metadata) = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to read session metadata for Task transcript recovery: {error}"
            ),
        })?
    else {
        return Ok(None);
    };
    let metadata_facts = session_metadata.descriptor_facts();
    let agent_id = crate::acp::types::CanonicalAgentId::from(session_metadata.agent_id.clone());
    let history_graph = match load_fold_graph_from_history(
        &agent_id,
        session_id,
        &session_metadata.project_path,
        metadata_facts.source_path.as_deref(),
    ) {
        Ok(Some(history_graph)) => history_graph,
        Ok(None) => return Ok(None),
        Err(error) => {
            tracing::debug!(
                session_id = %session_id,
                operation_id = %operation_id,
                error = %error,
                "Unable to recover empty Task transcript scope from provider history"
            );
            return Ok(None);
        }
    };

    let Some(history_operation) = history_graph
        .operations
        .iter()
        .find(|operation| operation.id == *operation_id && operation.kind == Some(ToolKind::Task))
    else {
        return Ok(None);
    };

    let recovered_scope = TranscriptScope::Operation(history_operation.id.clone());
    let recovered_rows = project_transcript_viewport_rows_for_scope(
        &history_graph.transcript_snapshot,
        &history_graph.operations,
        &history_graph.interactions,
        None,
        None,
        &recovered_scope,
    );
    if recovered_rows.is_empty() {
        return Ok(None);
    }

    page_result_from_projected_rows(start_row_index, limit, metadata, recovered_rows).map(Some)
}

fn page_result_from_projected_rows(
    start_row_index: i64,
    limit: u64,
    metadata: &SessionTranscriptRowLedgerMetadata,
    rows: Vec<TranscriptViewportRow>,
) -> Result<TranscriptRowPageResult, SerializableAcpError> {
    let total_row_count = rows.len() as i64;
    let page_start = start_row_index.min(total_row_count);
    let page_end = page_start.saturating_add(limit as i64).min(total_row_count);
    let page_rows = rows
        .into_iter()
        .skip(page_start as usize)
        .take(page_end.saturating_sub(page_start) as usize)
        .collect::<Vec<_>>();
    let row_payload_bytes = page_rows.iter().try_fold(0_u64, |total, row| {
        let row_json =
            serde_json::to_string(row).map_err(|error| SerializableAcpError::InvalidState {
                message: format!("Recovered transcript row could not be encoded: {error}"),
            })?;
        Ok::<u64, SerializableAcpError>(total + row_json.len() as u64)
    })?;

    Ok(TranscriptRowPageResult::Current {
        projection_version: metadata.projection_version.clone(),
        start_row_index: page_start,
        total_row_count,
        row_payload_bytes,
        transcript_revision: metadata.transcript_revision,
        graph_revision: metadata.graph_revision,
        last_event_seq: metadata.last_event_seq,
        rows: page_rows,
    })
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
    use super::{
        read_empty_task_scope_from_provider_history,
        read_transcript_row_page_for_scope_from_ledger, read_transcript_row_page_from_ledger,
        TranscriptRowPageResult,
    };
    use crate::acp::session::delivery::history_load::load_fold_graph_from_history;
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::transcript_projection::{
        TranscriptEntryRole, TranscriptScope, TranscriptSegment,
    };
    use crate::acp::transcript_viewport::ledger::{
        serialize_viewport_rows_for_ledger, SerializedTranscriptRowLedgerScope,
        SessionTranscriptRowLedgerMetadata, SessionTranscriptRowLedgerStatus,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
    };
    use crate::acp::transcript_viewport::row::{
        TranscriptViewportRow, TranscriptViewportRowContent, TranscriptViewportRowKind,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::db::repository::{SessionMetadataRepository, SessionTranscriptRowLedgerRepository};
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use std::fs;
    use tempfile::TempDir;

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
            timestamp_ms: None,
        }
    }

    async fn write_scoped_rows(
        db: &DbConn,
        session_id: &str,
        scopes: Vec<(TranscriptScope, Vec<TranscriptViewportRow>)>,
    ) {
        let serialized_scopes = scopes
            .into_iter()
            .map(|(scope, rows)| SerializedTranscriptRowLedgerScope {
                scope,
                rows: serialize_viewport_rows_for_ledger(
                    session_id,
                    7,
                    11,
                    TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
                    &rows,
                )
                .expect("serialize scoped ledger rows"),
            })
            .collect();
        SessionTranscriptRowLedgerRepository::replace_current_scopes(
            db,
            session_id,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            7,
            11,
            13,
            None,
            serialized_scopes,
        )
        .await
        .expect("write scoped ledger");
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
    async fn row_page_command_returns_operation_scope_range_without_root_rows() {
        let db = setup_test_db().await;
        let session_id = "row-page-operation-scope-session";
        let operation_scope = TranscriptScope::Operation("operation-task-1".to_string());
        ensure_test_session(&db, session_id).await;
        let mut root_row = test_row("root-row", "root");
        root_row.scope = TranscriptScope::Root;
        let mut thought_row = test_row("task-thought", "thought");
        thought_row.scope = operation_scope.clone();
        let mut tool_row = test_row("task-tool", "Read");
        tool_row.scope = operation_scope.clone();
        let mut final_row = test_row("task-final", "done");
        final_row.scope = operation_scope.clone();
        write_scoped_rows(
            &db,
            session_id,
            vec![
                (TranscriptScope::Root, vec![root_row]),
                (
                    operation_scope.clone(),
                    vec![thought_row, tool_row, final_row],
                ),
            ],
        )
        .await;

        let result = read_transcript_row_page_for_scope_from_ledger(
            &db,
            session_id,
            &operation_scope,
            1,
            2,
            SessionGraphRevision::new(11, 7, 13),
            None,
        )
        .await
        .expect("read operation-scope page");

        let TranscriptRowPageResult::Current {
            start_row_index,
            total_row_count,
            rows,
            ..
        } = result
        else {
            panic!("expected current operation-scope row page");
        };
        assert_eq!(start_row_index, 1);
        assert_eq!(total_row_count, 3);
        assert_eq!(
            rows.iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["task-tool", "task-final"]
        );
        assert!(rows.iter().all(|row| row.scope == operation_scope));
    }

    #[tokio::test]
    async fn empty_task_operation_scope_recovers_rows_from_claude_sidechain_history() {
        const SESSION_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
        let db = setup_test_db().await;
        let temp_dir = TempDir::new().expect("temp dir");
        let project_dir = temp_dir.path().join("project");
        let session_dir = project_dir.join("session-files");
        let subagents_dir = session_dir.join("subagents");
        fs::create_dir_all(&subagents_dir).expect("create sidechain dir");

        let agent_id = "ac373ea9520618f17";
        let parent_tool_use_id = "toolu_task_parent";
        let session_path = session_dir.join(format!("{SESSION_ID}.jsonl"));
        let parent_content = [
            serde_json::json!({
                "type": "queue-operation",
                "operation": "enqueue",
                "sessionId": SESSION_ID
            })
            .to_string(),
            serde_json::json!({
                "parentUuid": null,
                "isSidechain": false,
                "type": "assistant",
                "sessionId": SESSION_ID,
                "uuid": "parent-assistant",
                "timestamp": "2026-07-16T12:07:32.288Z",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": parent_tool_use_id,
                        "name": "Agent",
                        "input": {
                            "description": "Inspect dir",
                            "subagent_type": "Explore",
                            "prompt": "Read README.md"
                        }
                    }]
                }
            })
            .to_string(),
            serde_json::json!({
                "parentUuid": "parent-assistant",
                "isSidechain": false,
                "type": "user",
                "sessionId": SESSION_ID,
                "uuid": "parent-result",
                "timestamp": "2026-07-16T12:07:41.805Z",
                "message": {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": parent_tool_use_id,
                        "content": [{
                            "type": "text",
                            "text": "Child report"
                        }]
                    }]
                },
                "toolUseResult": {
                    "status": "completed",
                    "agentId": agent_id,
                    "agentType": "Explore",
                    "content": [{
                        "type": "text",
                        "text": "Child report"
                    }]
                }
            })
            .to_string(),
        ]
        .join("\n");
        fs::write(&session_path, parent_content).expect("write parent session");

        let sidechain_path = subagents_dir.join(format!("agent-{agent_id}.jsonl"));
        let sidechain_content = [
            serde_json::json!({
                "parentUuid": null,
                "isSidechain": true,
                "agentId": agent_id,
                "type": "user",
                "sessionId": SESSION_ID,
                "uuid": "child-user",
                "timestamp": "2026-07-16T12:07:32.303Z",
                "message": {
                    "role": "user",
                    "content": "Read README.md"
                }
            })
            .to_string(),
            serde_json::json!({
                "parentUuid": "child-user",
                "isSidechain": true,
                "agentId": agent_id,
                "type": "assistant",
                "sessionId": SESSION_ID,
                "uuid": "child-assistant",
                "timestamp": "2026-07-16T12:07:41.768Z",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "text",
                        "text": "Child report"
                    }]
                }
            })
            .to_string(),
        ]
        .join("\n");
        fs::write(sidechain_path, sidechain_content).expect("write sidechain session");
        SessionMetadataRepository::upsert(
            &db,
            SESSION_ID.to_string(),
            "Sidechain session".to_string(),
            1_789_401_261_000,
            project_dir.to_str().expect("project path").to_string(),
            CanonicalAgentId::ClaudeCode.as_str().to_string(),
            session_path.to_string_lossy().to_string(),
            1,
            1,
        )
        .await
        .expect("ensure test session with source path");

        let runtime_graph = load_fold_graph_from_history(
            &CanonicalAgentId::ClaudeCode,
            SESSION_ID,
            project_dir.to_str().expect("project path"),
            Some(session_path.to_str().expect("session path")),
        )
        .expect("history load")
        .expect("history graph");
        let task_operation = runtime_graph
            .operations
            .iter()
            .find(|operation| operation.tool_call_id == parent_tool_use_id)
            .expect("task operation");
        let operation_scope = TranscriptScope::Operation(task_operation.id.clone());
        let empty_scope_metadata = SessionTranscriptRowLedgerMetadata {
            session_id: SESSION_ID.to_string(),
            scope: operation_scope.clone(),
            row_count: 0,
            transcript_revision: 7,
            graph_revision: 11,
            last_event_seq: 13,
            projection_version: TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION.to_string(),
            open_header_json: None,
            rebuild_status: SessionTranscriptRowLedgerStatus::Current,
            updated_at_ms: 0,
        };

        let result = read_empty_task_scope_from_provider_history(
            &db,
            SESSION_ID,
            &operation_scope,
            0,
            128,
            &empty_scope_metadata,
        )
        .await
        .expect("recover page")
        .expect("recovered page");

        let TranscriptRowPageResult::Current {
            total_row_count,
            rows,
            transcript_revision,
            graph_revision,
            last_event_seq,
            ..
        } = result
        else {
            panic!("expected recovered current page");
        };
        assert!(total_row_count > 0);
        assert_eq!(transcript_revision, 7);
        assert_eq!(graph_revision, 11);
        assert_eq!(last_event_seq, 13);
        assert!(rows.iter().all(|row| row.scope == operation_scope));
        let encoded_rows = serde_json::to_string(&rows).expect("encode rows");
        assert!(encoded_rows.contains("Child report"));
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
