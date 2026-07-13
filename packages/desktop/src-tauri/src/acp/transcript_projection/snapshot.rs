use crate::acp::session_update::SessionCompactionEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSnapshot {
    pub revision: i64,
    pub entries: Vec<TranscriptEntry>,
}

impl TranscriptSnapshot {
    #[must_use]
    pub fn empty(revision: i64) -> Self {
        Self {
            revision,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEntry {
    pub entry_id: String,
    pub role: TranscriptEntryRole,
    pub segments: Vec<TranscriptSegment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TranscriptEntryRole {
    User,
    Assistant,
    Tool,
    SessionActivity,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranscriptSegment {
    #[serde(rename_all = "camelCase")]
    Text { segment_id: String, text: String },
    #[serde(rename_all = "camelCase")]
    Thought { segment_id: String, text: String },
    #[serde(rename_all = "camelCase")]
    PastedContent { segment_id: String, text: String },
    #[serde(rename_all = "camelCase")]
    LocalCommand {
        segment_id: String,
        command: String,
        message: String,
        args: String,
        stdout: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        model_display_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model_description: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Compaction {
        segment_id: String,
        event: SessionCompactionEvent,
    },
}

pub(crate) fn user_transcript_segment_from_text(
    segment_id: String,
    text: String,
) -> TranscriptSegment {
    if let Some(parsed) = crate::acp::local_command::parse_local_command(&text) {
        return TranscriptSegment::LocalCommand {
            segment_id,
            command: parsed.command,
            message: parsed.message,
            args: parsed.args,
            stdout: parsed.stdout,
            model_display_name: parsed.model_display_name,
            model_description: parsed.model_description,
        };
    }

    TranscriptSegment::Text { segment_id, text }
}

impl TranscriptSegment {
    pub fn primary_text(&self) -> &str {
        match self {
            TranscriptSegment::Text { text, .. }
            | TranscriptSegment::Thought { text, .. }
            | TranscriptSegment::PastedContent { text, .. } => text,
            TranscriptSegment::Compaction { event, .. } => {
                event.summary.as_deref().unwrap_or("Compaction done")
            }
            TranscriptSegment::LocalCommand {
                stdout,
                command,
                message,
                ..
            } => {
                if !stdout.is_empty() {
                    stdout
                } else if !command.is_empty() {
                    command
                } else {
                    message
                }
            }
        }
    }

    pub fn is_nonempty(&self) -> bool {
        match self {
            TranscriptSegment::Text { text, .. }
            | TranscriptSegment::Thought { text, .. }
            | TranscriptSegment::PastedContent { text, .. } => !text.is_empty(),
            TranscriptSegment::Compaction { .. } => true,
            TranscriptSegment::LocalCommand {
                command,
                message,
                stdout,
                args,
                ..
            } => {
                !command.is_empty() || !message.is_empty() || !stdout.is_empty() || !args.is_empty()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot};
    use crate::acp::session::fold_export::fold_graph_from_history_events;
    use crate::acp::session::ingress::stored_entry_events::stored_entries_to_provider_events;
    use crate::acp::session_update::{
        ToolArguments, ToolCallData, ToolCallStatus, ToolKind, TurnErrorKind,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::session_jsonl::types::{
        StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
        StoredErrorMessage, StoredUserMessage,
    };

    fn snapshot_from_provider_event_fold(
        revision: i64,
        stored_entries: &[StoredEntry],
    ) -> TranscriptSnapshot {
        let agent_id = CanonicalAgentId::ClaudeCode;
        let events = stored_entries_to_provider_events(stored_entries, agent_id.clone());
        let graph = fold_graph_from_history_events("snapshot-test", &agent_id, "", &events);
        let mut snapshot = graph.transcript_snapshot;
        snapshot.revision = revision;
        snapshot
    }

    #[test]
    fn provider_event_fold_uses_revision_and_canonical_entry_ids() {
        let snapshot = snapshot_from_provider_event_fold(
            7,
            &[
                StoredEntry::User {
                    id: "user-1".to_string(),
                    message: StoredUserMessage {
                        id: Some("user-1".to_string()),
                        content: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some("hello".to_string()),
                        },
                        chunks: vec![],
                        sent_at: None,
                    },
                    timestamp: None,
                },
                StoredEntry::Assistant {
                    id: "assistant-1".to_string(),
                    message: StoredAssistantMessage {
                        chunks: vec![StoredAssistantChunk {
                            chunk_type: "message".to_string(),
                            block: StoredContentBlock {
                                block_type: "text".to_string(),
                                text: Some("world".to_string()),
                            },
                        }],
                        model: None,
                        display_model: None,
                        received_at: None,
                    },
                    timestamp: None,
                },
            ],
        );

        assert_eq!(snapshot.revision, 7);
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::user::."
        );
        assert_eq!(snapshot.entries[0].role, TranscriptEntryRole::User);
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "acepe::entry::session-start::user::.:segment:1".to_string(),
                text: "hello".to_string(),
            }]
        );
        assert_eq!(
            snapshot.entries[1].entry_id,
            "acepe::entry::assistant-boundary:1::assistant::."
        );
        assert_eq!(snapshot.entries[1].role, TranscriptEntryRole::Assistant);
    }

    #[test]
    fn provider_event_fold_merges_assistant_fragments_in_one_boundary() {
        let snapshot = snapshot_from_provider_event_fold(
            8,
            &[
                StoredEntry::User {
                    id: "user-1".to_string(),
                    message: StoredUserMessage {
                        id: Some("user-1".to_string()),
                        content: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some("prompt".to_string()),
                        },
                        chunks: vec![],
                        sent_at: None,
                    },
                    timestamp: None,
                },
                StoredEntry::Assistant {
                    id: "assistant-fragment-1".to_string(),
                    message: StoredAssistantMessage {
                        chunks: vec![StoredAssistantChunk {
                            chunk_type: "message".to_string(),
                            block: StoredContentBlock {
                                block_type: "text".to_string(),
                                text: Some("first".to_string()),
                            },
                        }],
                        model: None,
                        display_model: None,
                        received_at: None,
                    },
                    timestamp: None,
                },
                StoredEntry::Assistant {
                    id: "assistant-fragment-2".to_string(),
                    message: StoredAssistantMessage {
                        chunks: vec![StoredAssistantChunk {
                            chunk_type: "message".to_string(),
                            block: StoredContentBlock {
                                block_type: "text".to_string(),
                                text: Some("second".to_string()),
                            },
                        }],
                        model: None,
                        display_model: None,
                        received_at: None,
                    },
                    timestamp: None,
                },
            ],
        );

        assert_eq!(snapshot.revision, 8);
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(
            snapshot.entries[1].entry_id,
            "acepe::entry::assistant-boundary:1::assistant::."
        );
        assert_eq!(
            snapshot.entries[1].segments,
            vec![
                TranscriptSegment::Text {
                    segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:2"
                        .to_string(),
                    text: "first".to_string(),
                },
                TranscriptSegment::Text {
                    segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:3"
                        .to_string(),
                    text: "second".to_string(),
                },
            ]
        );
    }

    #[test]
    fn transcript_snapshot_preserves_tool_rows_and_skips_error_rows() {
        let snapshot = snapshot_from_provider_event_fold(
            11,
            &[
                StoredEntry::ToolCall {
                    id: "tool-1".to_string(),
                    message: ToolCallData {
                        id: "tool-1".to_string(),
                        name: "Read".to_string(),
                        arguments: ToolArguments::Read {
                            file_path: Some("/tmp/file".to_string()),
                            source_context: None,
                        },
                        diagnostic_input: None,
                        status: ToolCallStatus::Completed,
                        result: None,
                        kind: Some(ToolKind::Read),
                        title: Some("Read file".to_string()),
                        locations: None,
                        skill_meta: None,
                        normalized_questions: None,
                        normalized_todos: None,
                        normalized_todo_update: None,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer: None,
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    },
                    timestamp: None,
                },
                StoredEntry::Error {
                    id: "error-1".to_string(),
                    message: StoredErrorMessage {
                        content: "boom".to_string(),
                        code: None,
                        details: None,
                        kind: TurnErrorKind::Fatal,
                        source: None,
                    },
                    timestamp: None,
                },
            ],
        );

        assert_eq!(snapshot.revision, 11);
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].role, TranscriptEntryRole::Tool);
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "acepe::entry::session-start::tool::tool-1:tool".to_string(),
                text: "Read file".to_string(),
            }]
        );
    }

    #[test]
    fn transcript_snapshot_skips_unanswered_question_tool_rows() {
        let snapshot = snapshot_from_provider_event_fold(
            12,
            &[StoredEntry::ToolCall {
                id: "question-tool".to_string(),
                message: ToolCallData {
                    id: "question-tool".to_string(),
                    name: "AskUserQuestion".to_string(),
                    arguments: ToolArguments::Other {
                        raw: serde_json::json!({
                            "questions": [{
                                "question": "Pick one?",
                                "header": "Pick",
                                "options": [],
                                "multiSelect": false
                            }]
                        }),
                        intent: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Pending,
                    result: None,
                    kind: Some(ToolKind::Question),
                    title: Some("Question".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    normalized_todo_update: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                timestamp: None,
            }],
        );

        assert_eq!(snapshot.revision, 12);
        assert!(
            snapshot.entries.is_empty(),
            "unanswered historical questions should not render as unresolved tool rows"
        );
    }

    #[test]
    fn transcript_snapshot_normalizes_tool_row_ids_for_canonical_join_keys() {
        let snapshot = snapshot_from_provider_event_fold(
            3,
            &[StoredEntry::ToolCall {
                id: "tool%provider\ncursor".to_string(),
                message: ToolCallData {
                    id: "tool%provider\ncursor".to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Read {
                        file_path: Some("/tmp/file".to_string()),
                        source_context: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Completed,
                    result: None,
                    kind: Some(ToolKind::Read),
                    title: Some("Read file".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    normalized_todo_update: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                timestamp: None,
            }],
        );

        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::tool::tool%25provider%0Acursor"
        );
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "acepe::entry::session-start::tool::tool%25provider%0Acursor:tool"
                    .to_string(),
                text: "Read file".to_string(),
            }]
        );
    }

    #[test]
    fn transcript_snapshot_uses_stored_tool_entry_id_for_tool_row_identity() {
        let snapshot = snapshot_from_provider_event_fold(
            4,
            &[StoredEntry::ToolCall {
                id: "jsonl-event-id".to_string(),
                message: ToolCallData {
                    id: "provider-tool-id".to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Read {
                        file_path: Some("/tmp/file".to_string()),
                        source_context: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Completed,
                    result: None,
                    kind: Some(ToolKind::Read),
                    title: Some("Read file".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    normalized_todo_update: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                timestamp: None,
            }],
        );

        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::tool::provider-tool-id"
        );
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "acepe::entry::session-start::tool::provider-tool-id:tool".to_string(),
                text: "Read file".to_string(),
            }]
        );
    }

    #[test]
    fn transcript_snapshot_dedupes_tool_rows_with_same_provider_tool_call_id() {
        let snapshot = snapshot_from_provider_event_fold(
            5,
            &[
                StoredEntry::ToolCall {
                    id: "jsonl-event-a".to_string(),
                    message: ToolCallData {
                        id: "provider-tool-id".to_string(),
                        name: "Read".to_string(),
                        arguments: ToolArguments::Read {
                            file_path: Some("/tmp/file".to_string()),
                            source_context: None,
                        },
                        diagnostic_input: None,
                        status: ToolCallStatus::Completed,
                        result: None,
                        kind: Some(ToolKind::Read),
                        title: Some("Read file".to_string()),
                        locations: None,
                        skill_meta: None,
                        normalized_questions: None,
                        normalized_todos: None,
                        normalized_todo_update: None,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer: None,
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    },
                    timestamp: None,
                },
                StoredEntry::ToolCall {
                    id: "jsonl-event-b".to_string(),
                    message: ToolCallData {
                        id: "provider-tool-id".to_string(),
                        name: "Read".to_string(),
                        arguments: ToolArguments::Read {
                            file_path: Some("/tmp/file".to_string()),
                            source_context: None,
                        },
                        diagnostic_input: None,
                        status: ToolCallStatus::Completed,
                        result: None,
                        kind: Some(ToolKind::Read),
                        title: Some("Sparse replay row".to_string()),
                        locations: None,
                        skill_meta: None,
                        normalized_questions: None,
                        normalized_todos: None,
                        normalized_todo_update: None,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer: None,
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    },
                    timestamp: None,
                },
            ],
        );

        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::tool::provider-tool-id"
        );
    }
}
#[test]
fn empty_snapshot_preserves_the_requested_revision() {
    let snapshot = TranscriptSnapshot::empty(42);

    assert_eq!(snapshot.revision, 42);
    assert!(snapshot.entries.is_empty());
}
