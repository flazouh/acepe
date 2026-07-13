//! One-way fold graph → `StoredEntry` export projection (Phase 4 compat only).

use std::collections::HashMap;

use crate::acp::projections::OperationSnapshot;
use crate::acp::session_update::ToolCallData;
use crate::acp::transcript_projection::{
    tool_call_id_from_authority_entry_id, TranscriptEntry, TranscriptEntryRole, TranscriptSegment,
};
use crate::session_jsonl::types::{
    StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    StoredUserMessage,
};

#[must_use]
pub(crate) fn stored_entries_from_transcript(
    transcript_entries: &[TranscriptEntry],
    operations_by_entry_id: &HashMap<String, OperationSnapshot>,
    operations_by_tool_call_id: &HashMap<String, OperationSnapshot>,
) -> Vec<StoredEntry> {
    let mut entries = Vec::new();
    let mut seen_tool_call_ids = std::collections::HashSet::new();

    for (index, entry) in transcript_entries.iter().enumerate() {
        let timestamp = timestamp_ms_to_rfc3339(entry.timestamp_ms);
        match entry.role {
            TranscriptEntryRole::User => {
                if let Some(stored) = stored_user_entry_from_transcript(entry, index, timestamp) {
                    entries.push(stored);
                }
            }
            TranscriptEntryRole::Assistant => {
                if let Some(stored) =
                    stored_assistant_entry_from_transcript(entry, index, timestamp)
                {
                    entries.push(stored);
                }
            }
            TranscriptEntryRole::Tool => {
                let Some(operation) = operation_for_transcript_entry(
                    entry,
                    operations_by_entry_id,
                    operations_by_tool_call_id,
                ) else {
                    continue;
                };
                if !seen_tool_call_ids.insert(operation.tool_call_id.clone()) {
                    continue;
                }
                entries.push(stored_tool_call_entry_from_operation(operation, timestamp));
            }
            TranscriptEntryRole::SessionActivity => {}
        }
    }

    entries
}

#[must_use]
pub(crate) fn timestamp_ms_to_rfc3339(timestamp_ms: Option<i64>) -> Option<String> {
    timestamp_ms.and_then(|timestamp_ms| {
        chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
            .map(|datetime| datetime.to_rfc3339())
    })
}

fn operation_for_transcript_entry<'a>(
    entry: &TranscriptEntry,
    operations_by_entry_id: &'a HashMap<String, OperationSnapshot>,
    operations_by_tool_call_id: &'a HashMap<String, OperationSnapshot>,
) -> Option<&'a OperationSnapshot> {
    if let Some(operation) = operations_by_entry_id.get(&entry.entry_id) {
        return Some(operation);
    }

    tool_call_id_from_authority_entry_id(&entry.entry_id)
        .and_then(|tool_call_id| operations_by_tool_call_id.get(&tool_call_id))
}

fn stored_user_entry_from_transcript(
    entry: &TranscriptEntry,
    index: usize,
    timestamp: Option<String>,
) -> Option<StoredEntry> {
    let blocks = user_content_blocks_from_segments(&entry.segments);
    if blocks.is_empty() {
        return None;
    }

    let id = format!("user-{index}");
    Some(StoredEntry::User {
        id: id.clone(),
        message: StoredUserMessage {
            id: Some(id),
            content: blocks[0].clone(),
            chunks: blocks,
            sent_at: timestamp.clone(),
        },
        timestamp,
    })
}

fn stored_assistant_entry_from_transcript(
    entry: &TranscriptEntry,
    index: usize,
    timestamp: Option<String>,
) -> Option<StoredEntry> {
    let chunks = assistant_chunks_from_segments(&entry.segments);
    if chunks.is_empty() {
        return None;
    }

    Some(StoredEntry::Assistant {
        id: format!("assistant-{index}"),
        message: StoredAssistantMessage {
            chunks,
            model: None,
            display_model: None,
            received_at: timestamp.clone(),
        },
        timestamp,
    })
}

fn stored_tool_call_entry_from_operation(
    operation: &OperationSnapshot,
    timestamp: Option<String>,
) -> StoredEntry {
    StoredEntry::ToolCall {
        id: operation.tool_call_id.clone(),
        message: tool_call_data_from_operation(operation),
        timestamp,
    }
}

fn tool_call_data_from_operation(operation: &OperationSnapshot) -> ToolCallData {
    ToolCallData {
        id: operation.tool_call_id.clone(),
        name: operation.name.clone(),
        arguments: operation.arguments.clone(),
        diagnostic_input: None,
        status: operation.provider_status.clone(),
        result: operation.result.clone(),
        kind: operation.kind,
        title: operation.title.clone(),
        locations: operation.locations.clone(),
        skill_meta: operation.skill_meta.clone(),
        normalized_questions: operation.normalized_questions.clone(),
        normalized_todos: operation.normalized_todos.clone(),
        normalized_todo_update: None,
        parent_tool_use_id: operation.parent_tool_call_id.clone(),
        task_children: None,
        question_answer: operation.question_answer.clone(),
        awaiting_plan_approval: operation.awaiting_plan_approval,
        plan_approval_request_id: operation.plan_approval_request_id,
    }
}

fn user_content_blocks_from_segments(segments: &[TranscriptSegment]) -> Vec<StoredContentBlock> {
    segments
        .iter()
        .filter_map(|segment| match segment {
            TranscriptSegment::Text { text, .. } => Some(StoredContentBlock {
                block_type: "text".to_string(),
                text: Some(text.clone()),
            }),
            TranscriptSegment::PastedContent { text, .. } => Some(StoredContentBlock {
                block_type: "pasted_content".to_string(),
                text: Some(text.clone()),
            }),
            _ => None,
        })
        .collect()
}

fn assistant_chunks_from_segments(segments: &[TranscriptSegment]) -> Vec<StoredAssistantChunk> {
    segments
        .iter()
        .filter_map(|segment| match segment {
            TranscriptSegment::Text { text, .. } => Some(StoredAssistantChunk {
                chunk_type: "message".to_string(),
                block: StoredContentBlock {
                    block_type: "text".to_string(),
                    text: Some(text.clone()),
                },
            }),
            TranscriptSegment::Thought { text, .. } => Some(StoredAssistantChunk {
                chunk_type: "thought".to_string(),
                block: StoredContentBlock {
                    block_type: "text".to_string(),
                    text: Some(text.clone()),
                },
            }),
            _ => None,
        })
        .collect()
}
