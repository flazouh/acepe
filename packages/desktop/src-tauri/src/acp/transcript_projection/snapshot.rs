use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::session_update::{ToolCallData, ToolKind};
use crate::acp::transcript_projection::canonical_event::{
    CanonicalTranscriptEvent, CanonicalTranscriptEventKind,
};
use crate::session_jsonl::types::{StoredAssistantChunk, StoredContentBlock, StoredEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSnapshot {
    pub revision: i64,
    pub entries: Vec<TranscriptEntry>,
}

impl TranscriptSnapshot {
    #[must_use]
    pub(crate) fn from_canonical_events(
        revision: i64,
        events: &[CanonicalTranscriptEvent],
    ) -> Self {
        let mut ordered_events: Vec<&CanonicalTranscriptEvent> = events.iter().collect();
        ordered_events.sort_by_key(|event| event.transcript_seq);

        let mut entries = Vec::new();
        for event in ordered_events {
            let Some(entry) = TranscriptEntry::from_canonical_event(event) else {
                continue;
            };
            append_or_merge_canonical_entry(&mut entries, entry);
        }

        Self { revision, entries }
    }

    #[must_use]
    pub fn from_stored_entries(revision: i64, stored_entries: &[StoredEntry]) -> Self {
        let mut seen_tool_entry_ids = HashSet::new();
        let mut entries = Vec::new();

        for stored_entry in stored_entries {
            if let Some(entry) = TranscriptEntry::from_stored_entry(stored_entry) {
                if entry.role == TranscriptEntryRole::Tool
                    && !seen_tool_entry_ids.insert(entry.entry_id.clone())
                {
                    continue;
                }
                entries.push(entry);
            }
        }

        Self { revision, entries }
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

impl TranscriptEntry {
    fn from_canonical_event(event: &CanonicalTranscriptEvent) -> Option<Self> {
        let display_id = event.display_id.trim();
        if display_id.is_empty() {
            return None;
        }

        match &event.kind {
            CanonicalTranscriptEventKind::UserText { text } => Some(Self {
                entry_id: display_id.to_string(),
                role: TranscriptEntryRole::User,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{display_id}:event:{}", event.transcript_seq),
                    text: text.clone(),
                }],
                attempt_id: None,
                timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
            }),
            CanonicalTranscriptEventKind::AssistantText { text } => Some(Self {
                entry_id: display_id.to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{display_id}:event:{}", event.transcript_seq),
                    text: text.clone(),
                }],
                attempt_id: None,
                timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
            }),
            CanonicalTranscriptEventKind::AssistantThought { text } => Some(Self {
                entry_id: display_id.to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Thought {
                    segment_id: format!("{display_id}:event:{}", event.transcript_seq),
                    text: text.clone(),
                }],
                attempt_id: None,
                timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
            }),
            CanonicalTranscriptEventKind::AssistantError { text, .. } => Some(Self {
                entry_id: display_id.to_string(),
                role: TranscriptEntryRole::Error,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{display_id}:error:{}", event.transcript_seq),
                    text: text.clone(),
                }],
                attempt_id: None,
                timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
            }),
            CanonicalTranscriptEventKind::ToolUse { name, .. } => Some(Self {
                entry_id: display_id.to_string(),
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{display_id}:tool"),
                    text: name.clone(),
                }],
                attempt_id: None,
                timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
            }),
        }
    }

    fn from_stored_entry(entry: &StoredEntry) -> Option<Self> {
        match entry {
            StoredEntry::User {
                id,
                message,
                timestamp,
            } => {
                let segments = if message.chunks.is_empty() {
                    segments_from_blocks(id, std::slice::from_ref(&message.content))
                } else {
                    segments_from_blocks(id, &message.chunks)
                };
                Some(Self {
                    entry_id: id.clone(),
                    role: TranscriptEntryRole::User,
                    segments,
                    attempt_id: None,
                    timestamp_ms: timestamp.as_deref().and_then(parse_timestamp_to_millis),
                })
            }
            StoredEntry::Assistant {
                id,
                message,
                timestamp,
            } => Some(Self {
                entry_id: id.clone(),
                role: TranscriptEntryRole::Assistant,
                segments: segments_from_assistant_chunks(id, &message.chunks),
                attempt_id: None,
                timestamp_ms: timestamp.as_deref().and_then(parse_timestamp_to_millis),
            }),
            StoredEntry::ToolCall {
                message, timestamp, ..
            } => {
                if should_skip_unanswered_historical_question_tool(message) {
                    return None;
                }
                let entry_id = normalize_tool_call_id(&message.id);
                Some(Self {
                    entry_id: entry_id.clone(),
                    role: TranscriptEntryRole::Tool,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("{entry_id}:tool"),
                        text: message
                            .title
                            .clone()
                            .unwrap_or_else(|| message.name.clone()),
                    }],
                    attempt_id: None,
                    timestamp_ms: timestamp.as_deref().and_then(parse_timestamp_to_millis),
                })
            }
            StoredEntry::Error {
                id,
                message,
                timestamp,
            } => Some(Self {
                entry_id: id.clone(),
                role: TranscriptEntryRole::Error,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{id}:error"),
                    text: message.content.clone(),
                }],
                attempt_id: None,
                timestamp_ms: timestamp.as_deref().and_then(parse_timestamp_to_millis),
            }),
        }
    }
}

fn parse_timestamp_to_millis(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .map(|datetime| datetime.timestamp_millis())
        .ok()
        .or_else(|| timestamp.parse::<i64>().ok())
}

fn append_or_merge_canonical_entry(entries: &mut Vec<TranscriptEntry>, entry: TranscriptEntry) {
    let Some(last_entry) = entries.last_mut() else {
        entries.push(entry);
        return;
    };

    if last_entry.entry_id == entry.entry_id && last_entry.role == entry.role {
        if last_entry.timestamp_ms.is_none() {
            last_entry.timestamp_ms = entry.timestamp_ms;
        }
        last_entry.segments.extend(entry.segments);
        return;
    }

    entries.push(entry);
}

fn should_skip_unanswered_historical_question_tool(tool_call: &ToolCallData) -> bool {
    matches!(tool_call.kind, Some(ToolKind::Question)) && tool_call.question_answer.is_none()
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TranscriptEntryRole {
    User,
    Assistant,
    Tool,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranscriptSegment {
    #[serde(rename_all = "camelCase")]
    Text { segment_id: String, text: String },
    #[serde(rename_all = "camelCase")]
    Thought { segment_id: String, text: String },
}

fn segments_from_blocks(entry_id: &str, blocks: &[StoredContentBlock]) -> Vec<TranscriptSegment> {
    blocks
        .iter()
        .enumerate()
        .filter_map(|(index, block)| {
            block.text.as_ref().map(|text| TranscriptSegment::Text {
                segment_id: format!("{entry_id}:block:{index}"),
                text: text.clone(),
            })
        })
        .collect()
}

fn segments_from_assistant_chunks(
    entry_id: &str,
    chunks: &[StoredAssistantChunk],
) -> Vec<TranscriptSegment> {
    chunks
        .iter()
        .enumerate()
        .filter_map(|(index, chunk)| {
            chunk
                .block
                .text
                .as_ref()
                .map(|text| match chunk.chunk_type.as_str() {
                    "thought" => TranscriptSegment::Thought {
                        segment_id: format!("{entry_id}:chunk:{index}"),
                        text: text.clone(),
                    },
                    _ => TranscriptSegment::Text {
                        segment_id: format!("{entry_id}:chunk:{index}"),
                        text: text.clone(),
                    },
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot};
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::{
        ToolArguments, ToolCallData, ToolCallStatus, ToolKind, TurnErrorKind,
    };
    use crate::acp::transcript_projection::{
        CanonicalTranscriptEvent, CanonicalTranscriptEventKind,
    };
    use crate::session_jsonl::types::{
        StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
        StoredErrorMessage, StoredUserMessage,
    };

    #[test]
    fn transcript_snapshot_uses_revision_and_entry_ids_from_stored_entries() {
        let snapshot = TranscriptSnapshot::from_stored_entries(
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
        assert_eq!(snapshot.entries[0].entry_id, "user-1");
        assert_eq!(snapshot.entries[0].role, TranscriptEntryRole::User);
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "user-1:block:0".to_string(),
                text: "hello".to_string(),
            }]
        );
        assert_eq!(snapshot.entries[1].entry_id, "assistant-1");
        assert_eq!(snapshot.entries[1].role, TranscriptEntryRole::Assistant);
    }

    #[test]
    fn transcript_snapshot_preserves_tool_and_error_rows_as_text_segments() {
        let snapshot = TranscriptSnapshot::from_stored_entries(
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
                        kind: TurnErrorKind::Fatal,
                        source: None,
                    },
                    timestamp: None,
                },
            ],
        );

        assert_eq!(snapshot.revision, 11);
        assert_eq!(snapshot.entries[0].role, TranscriptEntryRole::Tool);
        assert_eq!(snapshot.entries[1].role, TranscriptEntryRole::Error);
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "tool-1:tool".to_string(),
                text: "Read file".to_string(),
            }]
        );
        assert_eq!(
            snapshot.entries[1].segments,
            vec![TranscriptSegment::Text {
                segment_id: "error-1:error".to_string(),
                text: "boom".to_string(),
            }]
        );
    }

    #[test]
    fn transcript_snapshot_skips_unanswered_question_tool_rows() {
        let snapshot = TranscriptSnapshot::from_stored_entries(
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
        let snapshot = TranscriptSnapshot::from_stored_entries(
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

        assert_eq!(snapshot.entries[0].entry_id, "tool%25provider%0Acursor");
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "tool%25provider%0Acursor:tool".to_string(),
                text: "Read file".to_string(),
            }]
        );
    }

    #[test]
    fn transcript_snapshot_uses_provider_tool_call_id_for_tool_row_identity() {
        let snapshot = TranscriptSnapshot::from_stored_entries(
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
        assert_eq!(snapshot.entries[0].entry_id, "provider-tool-id");
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "provider-tool-id:tool".to_string(),
                text: "Read file".to_string(),
            }]
        );
    }

    #[test]
    fn transcript_snapshot_deduplicates_tool_rows_by_provider_tool_call_id() {
        let snapshot = TranscriptSnapshot::from_stored_entries(
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
        assert_eq!(snapshot.entries[0].entry_id, "provider-tool-id");
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "provider-tool-id:tool".to_string(),
                text: "Read file".to_string(),
            }]
        );
    }

    #[test]
    fn transcript_snapshot_from_canonical_events_uses_acepe_display_ids_without_remap() {
        let events = vec![
            CanonicalTranscriptEvent {
                transcript_seq: 0,
                source: AgentType::ClaudeCode,
                provider_row_id: "row-user-1".to_string(),
                provider_msg_id: None,
                request_id: Some("req-1".to_string()),
                block_index: 0,
                display_id: "user-1".to_string(),
                timestamp: "2026-05-18T00:00:00Z".to_string(),
                model: None,
                kind: CanonicalTranscriptEventKind::UserText {
                    text: "first".to_string(),
                },
            },
            CanonicalTranscriptEvent {
                transcript_seq: 1,
                source: AgentType::ClaudeCode,
                provider_row_id: "row-assistant-1".to_string(),
                provider_msg_id: Some("provider-reused-message".to_string()),
                request_id: Some("req-1".to_string()),
                block_index: 0,
                display_id: "assistant-display-1".to_string(),
                timestamp: "2026-05-18T00:00:01Z".to_string(),
                model: None,
                kind: CanonicalTranscriptEventKind::AssistantText {
                    text: "first answer".to_string(),
                },
            },
            CanonicalTranscriptEvent {
                transcript_seq: 2,
                source: AgentType::ClaudeCode,
                provider_row_id: "row-user-2".to_string(),
                provider_msg_id: None,
                request_id: Some("req-2".to_string()),
                block_index: 0,
                display_id: "user-2".to_string(),
                timestamp: "2026-05-18T00:00:02Z".to_string(),
                model: None,
                kind: CanonicalTranscriptEventKind::UserText {
                    text: "second".to_string(),
                },
            },
            CanonicalTranscriptEvent {
                transcript_seq: 3,
                source: AgentType::ClaudeCode,
                provider_row_id: "row-assistant-2".to_string(),
                provider_msg_id: Some("provider-reused-message".to_string()),
                request_id: Some("req-2".to_string()),
                block_index: 0,
                display_id: "assistant-display-2".to_string(),
                timestamp: "2026-05-18T00:00:03Z".to_string(),
                model: None,
                kind: CanonicalTranscriptEventKind::AssistantText {
                    text: "second answer".to_string(),
                },
            },
        ];

        let snapshot = TranscriptSnapshot::from_canonical_events(9, &events);

        assert_eq!(snapshot.revision, 9);
        assert_eq!(
            snapshot
                .entries
                .iter()
                .map(|entry| entry.entry_id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "user-1",
                "assistant-display-1",
                "user-2",
                "assistant-display-2"
            ]
        );
        assert_eq!(snapshot.entries[1].role, TranscriptEntryRole::Assistant);
        assert_eq!(snapshot.entries[3].role, TranscriptEntryRole::Assistant);
    }

    #[test]
    fn transcript_snapshot_from_canonical_events_does_not_repair_missing_display_id() {
        let events = vec![CanonicalTranscriptEvent {
            transcript_seq: 0,
            source: AgentType::ClaudeCode,
            provider_row_id: "row-tool-1".to_string(),
            provider_msg_id: Some("provider-message".to_string()),
            request_id: Some("req-1".to_string()),
            block_index: 0,
            display_id: String::new(),
            timestamp: "2026-05-18T00:00:00Z".to_string(),
            model: None,
            kind: CanonicalTranscriptEventKind::ToolUse {
                tool_call_id: "provider-tool-id".to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({ "file_path": "/tmp/file" }),
            },
        }];

        let snapshot = TranscriptSnapshot::from_canonical_events(10, &events);

        assert!(
            snapshot.entries.is_empty(),
            "projection must not invent display identity from provider tool id"
        );
    }

    #[test]
    fn transcript_snapshot_from_canonical_events_preserves_timestamp_ms() {
        let events = vec![CanonicalTranscriptEvent {
            transcript_seq: 0,
            source: AgentType::ClaudeCode,
            provider_row_id: "row-user-1".to_string(),
            provider_msg_id: None,
            request_id: Some("req-1".to_string()),
            block_index: 0,
            display_id: "user-1".to_string(),
            timestamp: "2026-05-18T00:00:00Z".to_string(),
            model: None,
            kind: CanonicalTranscriptEventKind::UserText {
                text: "hello".to_string(),
            },
        }];

        let snapshot = TranscriptSnapshot::from_canonical_events(1, &events);

        assert_eq!(snapshot.entries[0].timestamp_ms, Some(1_779_062_400_000));
    }
}
