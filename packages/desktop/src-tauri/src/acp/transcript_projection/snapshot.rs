use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::session_update::{SessionCompactionEvent, ToolCallData, ToolKind};
use crate::acp::transcript_projection::canonical_event::{
    CanonicalTranscriptEvent, CanonicalTranscriptEventKind,
};
use crate::acp::transcript_projection::display_id::{
    derive_entry_id_for_snapshot_role, derive_tool_entry_id, turn_key_for_assistant_boundary,
};
use crate::session_jsonl::types::{StoredAssistantChunk, StoredContentBlock, StoredEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Default)]
struct HistoryTurnContext {
    assistant_boundary_entry_count: usize,
}

impl HistoryTurnContext {
    fn current_turn_key(&self) -> String {
        turn_key_for_assistant_boundary(self.assistant_boundary_entry_count)
    }

    fn note_entry(&mut self, role: &TranscriptEntryRole, entries_len_after: usize) {
        if role_closes_assistant_boundary(role) {
            self.assistant_boundary_entry_count = entries_len_after;
        }
    }
}

fn role_closes_assistant_boundary(role: &TranscriptEntryRole) -> bool {
    !matches!(role, TranscriptEntryRole::Assistant)
}

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
        let mut turn_context = HistoryTurnContext::default();
        for event in ordered_events {
            let turn_key = turn_context.current_turn_key();
            let Some(entry) = TranscriptEntry::from_canonical_event(event, &turn_key) else {
                continue;
            };
            let role = entry.role.clone();
            append_or_merge_entry(&mut entries, entry);
            turn_context.note_entry(&role, entries.len());
        }

        Self { revision, entries }
    }

    #[must_use]
    pub fn from_stored_entries(revision: i64, stored_entries: &[StoredEntry]) -> Self {
        let mut seen_tool_call_ids = HashSet::new();
        let mut entries = Vec::new();
        let mut turn_context = HistoryTurnContext::default();

        for (stored_entry_index, stored_entry) in stored_entries.iter().enumerate() {
            let turn_key = turn_context.current_turn_key();
            if let StoredEntry::ToolCall { message, .. } = stored_entry {
                let normalized_tool_call_id = normalize_tool_call_id(&message.id);
                if !seen_tool_call_ids.insert(normalized_tool_call_id) {
                    continue;
                }
            }
            if let Some(entry) =
                TranscriptEntry::from_stored_entry(stored_entry, &turn_key, stored_entry_index)
            {
                let role = entry.role.clone();
                append_or_merge_entry(&mut entries, entry);
                turn_context.note_entry(&role, entries.len());
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
    fn from_canonical_event(event: &CanonicalTranscriptEvent, turn_key: &str) -> Option<Self> {
        match &event.kind {
            CanonicalTranscriptEventKind::UserText { text } => {
                let entry_id =
                    derive_entry_id_for_snapshot_role(turn_key, &TranscriptEntryRole::User, None);
                Some(Self {
                    entry_id,
                    role: TranscriptEntryRole::User,
                    segments: vec![user_transcript_segment_from_text(
                        format!("{turn_key}:event:{}", event.transcript_seq),
                        text.clone(),
                    )],
                    attempt_id: None,
                    timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
                })
            }
            CanonicalTranscriptEventKind::AssistantText { text } => {
                let entry_id = derive_entry_id_for_snapshot_role(
                    turn_key,
                    &TranscriptEntryRole::Assistant,
                    None,
                );
                Some(Self {
                    entry_id,
                    role: TranscriptEntryRole::Assistant,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("{turn_key}:event:{}", event.transcript_seq),
                        text: text.clone(),
                    }],
                    attempt_id: None,
                    timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
                })
            }
            CanonicalTranscriptEventKind::AssistantThought {
                text,
                redacted_provider_data,
            } => {
                let entry_id = derive_entry_id_for_snapshot_role(
                    turn_key,
                    &TranscriptEntryRole::Assistant,
                    None,
                );
                Some(Self {
                    entry_id,
                    role: TranscriptEntryRole::Assistant,
                    segments: vec![TranscriptSegment::Thought {
                        segment_id: format!("{turn_key}:event:{}", event.transcript_seq),
                        text: thought_text_for_display(text, redacted_provider_data.as_deref()),
                    }],
                    attempt_id: None,
                    timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
                })
            }
            CanonicalTranscriptEventKind::AssistantError { .. } => None,
            CanonicalTranscriptEventKind::ToolUse {
                tool_call_id, name, ..
            } => {
                if tool_call_id.trim().is_empty() {
                    return None;
                }
                let entry_id = derive_tool_entry_id(turn_key, tool_call_id);
                Some(Self {
                    entry_id: entry_id.clone(),
                    role: TranscriptEntryRole::Tool,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("{entry_id}:tool"),
                        text: name.clone(),
                    }],
                    attempt_id: None,
                    timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
                })
            }
        }
    }

    fn from_stored_entry(
        entry: &StoredEntry,
        turn_key: &str,
        stored_entry_index: usize,
    ) -> Option<Self> {
        match entry {
            StoredEntry::User {
                id: _,
                message,
                timestamp,
            } => {
                let entry_id =
                    derive_entry_id_for_snapshot_role(turn_key, &TranscriptEntryRole::User, None);
                let segments = if message.chunks.is_empty() {
                    segments_from_blocks(&entry_id, std::slice::from_ref(&message.content))
                } else {
                    segments_from_blocks(&entry_id, &message.chunks)
                };
                Some(Self {
                    entry_id,
                    role: TranscriptEntryRole::User,
                    segments,
                    attempt_id: None,
                    timestamp_ms: timestamp.as_deref().and_then(parse_timestamp_to_millis),
                })
            }
            StoredEntry::Assistant {
                id: _,
                message,
                timestamp,
            } => {
                let entry_id = derive_entry_id_for_snapshot_role(
                    turn_key,
                    &TranscriptEntryRole::Assistant,
                    None,
                );
                Some(Self {
                    entry_id: entry_id.clone(),
                    role: TranscriptEntryRole::Assistant,
                    segments: segments_from_assistant_chunks(
                        &entry_id,
                        &message.chunks,
                        stored_entry_index,
                    ),
                    attempt_id: None,
                    timestamp_ms: timestamp.as_deref().and_then(parse_timestamp_to_millis),
                })
            }
            StoredEntry::ToolCall {
                id: _,
                message,
                timestamp,
            } => {
                if should_skip_unanswered_historical_question_tool(message) {
                    return None;
                }
                let entry_id = derive_tool_entry_id(turn_key, &message.id);
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
            StoredEntry::Error { .. } => None,
        }
    }
}

fn thought_text_for_display(text: &str, redacted_provider_data: Option<&str>) -> String {
    match redacted_provider_data {
        Some(_) if text.trim().is_empty() => "[REDACTED]".to_string(),
        _ => text.to_string(),
    }
}

fn parse_timestamp_to_millis(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .map(|datetime| datetime.timestamp_millis())
        .ok()
        .or_else(|| timestamp.parse::<i64>().ok())
}

fn append_or_merge_entry(entries: &mut Vec<TranscriptEntry>, entry: TranscriptEntry) {
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
            TranscriptSegment::Text { text, .. } | TranscriptSegment::Thought { text, .. } => text,
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
            TranscriptSegment::Text { text, .. } | TranscriptSegment::Thought { text, .. } => {
                !text.is_empty()
            }
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

fn segments_from_blocks(entry_id: &str, blocks: &[StoredContentBlock]) -> Vec<TranscriptSegment> {
    blocks
        .iter()
        .enumerate()
        .filter_map(|(index, block)| {
            block.text.as_ref().map(|text| {
                user_transcript_segment_from_text(format!("{entry_id}:block:{index}"), text.clone())
            })
        })
        .collect()
}

fn segments_from_assistant_chunks(
    entry_id: &str,
    chunks: &[StoredAssistantChunk],
    stored_entry_index: usize,
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
                        segment_id: format!("{entry_id}:stored:{stored_entry_index}:chunk:{index}"),
                        text: text.clone(),
                    },
                    _ => TranscriptSegment::Text {
                        segment_id: format!("{entry_id}:stored:{stored_entry_index}:chunk:{index}"),
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

    fn test_canonical_event(
        source: AgentType,
        transcript_seq: u64,
        display_id: &str,
        kind: CanonicalTranscriptEventKind,
    ) -> CanonicalTranscriptEvent {
        CanonicalTranscriptEvent {
            transcript_seq,
            source,
            provider_row_id: format!("row-{display_id}"),
            provider_msg_id: None,
            request_id: Some(format!("req-{transcript_seq}")),
            block_index: 0,
            display_id: display_id.to_string(),
            timestamp: "2026-05-18T00:00:00Z".to_string(),
            model: None,
            kind,
        }
    }

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
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::user::."
        );
        assert_eq!(snapshot.entries[0].role, TranscriptEntryRole::User);
        assert_eq!(
            snapshot.entries[0].segments,
            vec![TranscriptSegment::Text {
                segment_id: "acepe::entry::session-start::user::.:block:0".to_string(),
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
    fn transcript_snapshot_merges_stored_assistant_fragments_in_one_boundary() {
        let snapshot = TranscriptSnapshot::from_stored_entries(
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
                    segment_id: "acepe::entry::assistant-boundary:1::assistant::.:stored:1:chunk:0"
                        .to_string(),
                    text: "first".to_string(),
                },
                TranscriptSegment::Text {
                    segment_id: "acepe::entry::assistant-boundary:1::assistant::.:stored:2:chunk:0"
                        .to_string(),
                    text: "second".to_string(),
                },
            ]
        );
    }

    #[test]
    fn transcript_snapshot_preserves_tool_rows_and_skips_error_rows() {
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
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::tool::provider-tool-id"
        );
    }

    #[test]
    fn transcript_snapshot_from_canonical_events_uses_acepe_display_ids_without_remap() {
        let events = vec![
            test_canonical_event(
                AgentType::Cursor,
                0,
                "user-1",
                CanonicalTranscriptEventKind::UserText {
                    text: "first".to_string(),
                },
            ),
            test_canonical_event(
                AgentType::Codex,
                1,
                "assistant-display-1",
                CanonicalTranscriptEventKind::AssistantText {
                    text: "first answer".to_string(),
                },
            ),
            test_canonical_event(
                AgentType::OpenCode,
                2,
                "user-2",
                CanonicalTranscriptEventKind::UserText {
                    text: "second".to_string(),
                },
            ),
            test_canonical_event(
                AgentType::Copilot,
                3,
                "assistant-display-2",
                CanonicalTranscriptEventKind::AssistantText {
                    text: "second answer".to_string(),
                },
            ),
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
                "acepe::entry::session-start::user::.",
                "acepe::entry::assistant-boundary:1::assistant::.",
                "acepe::entry::assistant-boundary:1::user::.",
                "acepe::entry::assistant-boundary:3::assistant::.",
            ]
        );
        assert_eq!(snapshot.entries[1].role, TranscriptEntryRole::Assistant);
        assert_eq!(snapshot.entries[3].role, TranscriptEntryRole::Assistant);
    }

    #[test]
    fn transcript_snapshot_from_canonical_events_derives_tool_identity_from_tool_call_id() {
        let events = vec![test_canonical_event(
            AgentType::Cursor,
            0,
            "",
            CanonicalTranscriptEventKind::ToolUse {
                tool_call_id: "provider-tool-id".to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({ "file_path": "/tmp/file" }),
            },
        )];

        let snapshot = TranscriptSnapshot::from_canonical_events(10, &events);

        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::tool::provider-tool-id"
        );
    }

    #[test]
    fn transcript_snapshot_entry_ids_are_independent_of_provider_source() {
        let expected_entry_ids = vec![
            "acepe::entry::session-start::user::.",
            "acepe::entry::assistant-boundary:1::assistant::.",
            "acepe::entry::assistant-boundary:1::tool::toolu_read",
        ];
        for source in [
            AgentType::Cursor,
            AgentType::Codex,
            AgentType::OpenCode,
            AgentType::Copilot,
        ] {
            let events = vec![
                test_canonical_event(
                    source,
                    0,
                    "user-1",
                    CanonicalTranscriptEventKind::UserText {
                        text: "hello".to_string(),
                    },
                ),
                test_canonical_event(
                    source,
                    1,
                    "assistant-display-1",
                    CanonicalTranscriptEventKind::AssistantText {
                        text: "world".to_string(),
                    },
                ),
                test_canonical_event(
                    source,
                    2,
                    "toolu_read",
                    CanonicalTranscriptEventKind::ToolUse {
                        tool_call_id: "toolu_read".to_string(),
                        name: "Read".to_string(),
                        input: serde_json::json!({ "file_path": "/tmp/file" }),
                    },
                ),
            ];
            let snapshot = TranscriptSnapshot::from_canonical_events(1, &events);
            assert_eq!(
                snapshot
                    .entries
                    .iter()
                    .map(|entry| entry.entry_id.as_str())
                    .collect::<Vec<_>>(),
                expected_entry_ids,
                "entry ids must not vary with AgentType::{source:?}"
            );
        }
    }

    #[test]
    fn transcript_snapshot_from_canonical_events_preserves_timestamp_ms() {
        let events = vec![test_canonical_event(
            AgentType::Cursor,
            0,
            "user-1",
            CanonicalTranscriptEventKind::UserText {
                text: "hello".to_string(),
            },
        )];

        let snapshot = TranscriptSnapshot::from_canonical_events(1, &events);

        assert_eq!(snapshot.entries[0].timestamp_ms, Some(1_779_062_400_000));
    }
}
