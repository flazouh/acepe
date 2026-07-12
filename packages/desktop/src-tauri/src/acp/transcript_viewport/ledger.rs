use crate::acp::projections::{SessionTurnState, TurnFailureSnapshot};
use crate::acp::session_state_engine::graph::ActiveStreamingTail;
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_viewport::row::{TranscriptViewportRow, TranscriptViewportRowKind};
use crate::acp::types::CanonicalAgentId;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

// v13 widens the cached open header to preserve canonical turn failures rebuilt
// from the local journal. Older headers can incorrectly describe failed turns
// as idle, so they must not be reused by the hot-ledger open path.
// v14 invalidates rows built by the pre-fix Cursor store.db parser, which
// leaked provider prompt scaffolding (<mcp_instructions>, <timestamp>) and
// protobuf wire bytes ("MChecking…", "summarized_conversation") into
// canonical transcript text.
// v15 invalidates rows where Cursor's routine encrypted redacted-reasoning
// blocks were projected as "[REDACTED]" Thought segments.
pub const TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION: &str = "transcript_viewport_row:v15";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SerializedTranscriptRowLedgerRow {
    pub session_id: String,
    pub row_index: i64,
    pub row_id: String,
    pub source_entry_id: Option<String>,
    pub row_kind: String,
    pub row_version: String,
    pub transcript_revision: i64,
    pub graph_revision: i64,
    pub projection_version: String,
    pub row_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionTranscriptRowLedgerMetadata {
    pub session_id: String,
    pub row_count: i64,
    pub transcript_revision: i64,
    pub graph_revision: i64,
    pub last_event_seq: i64,
    pub projection_version: String,
    pub open_header_json: Option<String>,
    pub rebuild_status: SessionTranscriptRowLedgerStatus,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptRowLedgerOpenHeader {
    pub agent_id: CanonicalAgentId,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub source_path: Option<String>,
    pub sequence_id: Option<i32>,
    pub session_title: String,
    pub turn_state: SessionTurnState,
    pub message_count: u64,
    pub activity: SessionGraphActivity,
    pub active_streaming_tail: Option<ActiveStreamingTail>,
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    pub last_terminal_turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionTranscriptRowLedgerStatus {
    Current,
    RebuildNeeded,
}

impl SessionTranscriptRowLedgerStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::RebuildNeeded => "rebuild_needed",
        }
    }

    pub fn from_persisted(value: &str) -> Option<Self> {
        match value {
            "current" => Some(Self::Current),
            "rebuild_needed" => Some(Self::RebuildNeeded),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionTranscriptRowLedgerRead {
    Missing,
    Stale {
        metadata: SessionTranscriptRowLedgerMetadata,
    },
    Current {
        metadata: SessionTranscriptRowLedgerMetadata,
        rows: Vec<SerializedTranscriptRowLedgerRow>,
    },
}

pub fn serialize_viewport_rows_for_ledger(
    session_id: &str,
    transcript_revision: i64,
    graph_revision: i64,
    projection_version: &str,
    rows: &[TranscriptViewportRow],
) -> Result<Vec<SerializedTranscriptRowLedgerRow>> {
    serialize_viewport_rows_for_ledger_from_index(
        session_id,
        transcript_revision,
        graph_revision,
        projection_version,
        0,
        rows,
    )
}

pub fn serialize_viewport_rows_for_ledger_from_index(
    session_id: &str,
    transcript_revision: i64,
    graph_revision: i64,
    projection_version: &str,
    start_row_index: i64,
    rows: &[TranscriptViewportRow],
) -> Result<Vec<SerializedTranscriptRowLedgerRow>> {
    for row in rows {
        validate_current_row_payload(row)?;
    }

    rows.iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(SerializedTranscriptRowLedgerRow {
                session_id: session_id.to_string(),
                row_index: start_row_index.saturating_add(index as i64),
                row_id: row.row_id.clone(),
                source_entry_id: Some(row.source_entry_id.clone()),
                row_kind: row_kind_key(&row.kind).to_string(),
                row_version: row.version.clone(),
                transcript_revision,
                graph_revision,
                projection_version: projection_version.to_string(),
                row_json: serde_json::to_string(row)?,
            })
        })
        .collect()
}

pub(crate) fn validate_current_row_payload(row: &TranscriptViewportRow) -> Result<()> {
    for operation_link in &row.operation_links {
        let Some(display_facts) = &operation_link.display_facts else {
            return Err(anyhow!(
                "transcript row {} links operation {} without required display facts",
                row.row_id,
                operation_link.operation_id
            ));
        };
        if display_facts.operation_id != operation_link.operation_id {
            return Err(anyhow!(
                "transcript row {} operation display facts belong to {}, expected {}",
                row.row_id,
                display_facts.operation_id,
                operation_link.operation_id
            ));
        }
        if display_facts.tool_call_id != operation_link.tool_call_id {
            return Err(anyhow!(
                "transcript row {} operation display facts tool call {}, expected {}",
                row.row_id,
                display_facts.tool_call_id,
                operation_link.tool_call_id
            ));
        }
        if display_facts.state != operation_link.state {
            return Err(anyhow!(
                "transcript row {} operation display facts state does not match link state",
                row.row_id
            ));
        }
        if display_facts.title.trim().is_empty() {
            return Err(anyhow!(
                "transcript row {} operation {} has empty display title",
                row.row_id,
                operation_link.operation_id
            ));
        }
    }

    Ok(())
}

fn row_kind_key(kind: &TranscriptViewportRowKind) -> &'static str {
    match kind {
        TranscriptViewportRowKind::User => "user",
        TranscriptViewportRowKind::AssistantText => "assistant_text",
        TranscriptViewportRowKind::AssistantThought => "assistant_thought",
        TranscriptViewportRowKind::Tool => "tool",
        TranscriptViewportRowKind::SessionActivity => "session_activity",
        TranscriptViewportRowKind::AwaitingPlaceholder => "awaiting_placeholder",
    }
}

#[cfg(test)]
mod tests {
    use super::serialize_viewport_rows_for_ledger;
    use crate::acp::projections::OperationState;
    use crate::acp::session_update::ToolKind;
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
    use crate::acp::transcript_viewport::row::{
        TranscriptViewportOperationDisplayFacts, TranscriptViewportOperationLink,
        TranscriptViewportRow, TranscriptViewportRowContent, TranscriptViewportRowKind,
    };
    use serde_json::Value;

    #[test]
    fn serializes_viewport_rows_for_persistent_ledger() {
        let rows = vec![TranscriptViewportRow {
            row_id: "row-1".to_string(),
            source_entry_id: "entry-1".to_string(),
            kind: TranscriptViewportRowKind::Tool,
            version: "version-hash".to_string(),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "entry-1:text:0".to_string(),
                    text: "exec_command".to_string(),
                }],
            },
            duration_started_at_ms: None,
        }];

        let serialized =
            serialize_viewport_rows_for_ledger("session-1", 7, 11, "projection-v1", &rows)
                .expect("viewport rows should serialize");

        assert_eq!(serialized.len(), 1);
        assert_eq!(serialized[0].session_id, "session-1");
        assert_eq!(serialized[0].row_index, 0);
        assert_eq!(serialized[0].row_id, "row-1");
        assert_eq!(serialized[0].source_entry_id.as_deref(), Some("entry-1"));
        assert_eq!(serialized[0].row_kind, "tool");
        assert_eq!(serialized[0].row_version, "version-hash");
        assert_eq!(serialized[0].transcript_revision, 7);
        assert_eq!(serialized[0].graph_revision, 11);
        assert_eq!(serialized[0].projection_version, "projection-v1");

        let row_json: Value =
            serde_json::from_str(&serialized[0].row_json).expect("row json should parse");
        assert_eq!(row_json["rowId"], "row-1");
        assert_eq!(row_json["kind"], "tool");
    }

    #[test]
    fn serializes_viewport_row_suffix_with_start_index() {
        let rows = vec![TranscriptViewportRow {
            row_id: "row-9".to_string(),
            source_entry_id: "entry-9".to_string(),
            kind: TranscriptViewportRowKind::AssistantText,
            version: "version-hash".to_string(),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "entry-9:text:0".to_string(),
                    text: "hello".to_string(),
                }],
            },
            duration_started_at_ms: None,
        }];

        let serialized = super::serialize_viewport_rows_for_ledger_from_index(
            "session-1",
            8,
            12,
            "projection-v1",
            9,
            &rows,
        )
        .expect("viewport row suffix should serialize");

        assert_eq!(serialized[0].row_index, 9);
        assert_eq!(serialized[0].row_id, "row-9");
    }

    #[test]
    fn linked_operation_row_requires_display_facts_for_current_ledger() {
        let row = TranscriptViewportRow {
            row_id: "row-1".to_string(),
            source_entry_id: "entry-1".to_string(),
            kind: TranscriptViewportRowKind::Tool,
            version: "version-hash".to_string(),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: vec![TranscriptViewportOperationLink {
                operation_id: "operation-1".to_string(),
                tool_call_id: "tool-1".to_string(),
                name: "exec_command".to_string(),
                state: OperationState::Running,
                display_facts: None,
                operation: None,
            }],
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "entry-1:text:0".to_string(),
                    text: "exec_command".to_string(),
                }],
            },
            duration_started_at_ms: None,
        };

        let result =
            serialize_viewport_rows_for_ledger("session-1", 7, 11, "projection-v1", &[row]);

        assert!(
            result.is_err(),
            "current persisted row truth must not hide missing operation display facts"
        );
    }

    #[test]
    fn linked_operation_row_serializes_with_display_facts() {
        let row = TranscriptViewportRow {
            row_id: "row-1".to_string(),
            source_entry_id: "entry-1".to_string(),
            kind: TranscriptViewportRowKind::Tool,
            version: "version-hash".to_string(),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: vec![TranscriptViewportOperationLink {
                operation_id: "operation-1".to_string(),
                tool_call_id: "tool-1".to_string(),
                name: "exec_command".to_string(),
                state: OperationState::Running,
                display_facts: Some(TranscriptViewportOperationDisplayFacts {
                    operation_id: "operation-1".to_string(),
                    tool_call_id: "tool-1".to_string(),
                    name: "exec_command".to_string(),
                    title: "Run".to_string(),
                    state: OperationState::Running,
                    kind: Some(ToolKind::Execute),
                    skill_name: None,
                    skill_args: None,
                    task_description: None,
                    task_prompt: None,
                    subagent_type: None,
                    normalized_todos: None,
                    command_summary: Some("bun test".to_string()),
                    target_path_summary: None,
                    result_summary: None,
                    error_summary: None,
                    interaction_ids: Vec::new(),
                    parent_tool_call_id: None,
                    child_tool_call_ids: Vec::new(),
                }),
                operation: None,
            }],
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "entry-1:text:0".to_string(),
                    text: "exec_command".to_string(),
                }],
            },
            duration_started_at_ms: None,
        };

        let serialized =
            serialize_viewport_rows_for_ledger("session-1", 7, 11, "projection-v1", &[row])
                .expect("linked operation row should serialize with display facts");
        let row_json: Value =
            serde_json::from_str(&serialized[0].row_json).expect("row json should parse");

        assert_eq!(
            row_json["operationLinks"][0]["displayFacts"]["title"],
            "Run"
        );
        assert_eq!(
            row_json["operationLinks"][0]["displayFacts"]["commandSummary"],
            "bun test"
        );
    }
}
