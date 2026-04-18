use crate::session_jsonl::types::{StoredAssistantChunk, StoredContentBlock, StoredEntry};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSnapshot {
    pub revision: i64,
    pub entries: Vec<TranscriptEntry>,
}

impl TranscriptSnapshot {
    #[must_use]
    pub fn from_stored_entries(revision: i64, stored_entries: &[StoredEntry]) -> Self {
        Self {
            revision,
            entries: stored_entries
                .iter()
                .filter_map(TranscriptEntry::from_stored_entry)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEntry {
    pub entry_id: String,
    pub role: TranscriptEntryRole,
    pub segments: Vec<TranscriptSegment>,
}

impl TranscriptEntry {
    fn from_stored_entry(entry: &StoredEntry) -> Option<Self> {
        match entry {
            StoredEntry::User { id, message, .. } => {
                let segments = if message.chunks.is_empty() {
                    segments_from_blocks(id, std::slice::from_ref(&message.content))
                } else {
                    segments_from_blocks(id, &message.chunks)
                };
                Some(Self {
                    entry_id: id.clone(),
                    role: TranscriptEntryRole::User,
                    segments,
                })
            }
            StoredEntry::Assistant { id, message, .. } => Some(Self {
                entry_id: id.clone(),
                role: TranscriptEntryRole::Assistant,
                segments: segments_from_assistant_chunks(id, &message.chunks),
            }),
            StoredEntry::ToolCall { id, message, .. } => Some(Self {
                entry_id: id.clone(),
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{id}:tool"),
                    text: message
                        .title
                        .clone()
                        .unwrap_or_else(|| message.name.clone()),
                }],
            }),
            StoredEntry::Error { id, message, .. } => Some(Self {
                entry_id: id.clone(),
                role: TranscriptEntryRole::Error,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{id}:error"),
                    text: message.content.clone(),
                }],
            }),
        }
    }
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
    Text { segment_id: String, text: String },
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
                .map(|text| TranscriptSegment::Text {
                    segment_id: format!("{entry_id}:chunk:{index}"),
                    text: text.clone(),
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot};
    use crate::acp::session_update::{
        ToolArguments, ToolCallData, ToolCallStatus, ToolKind, TurnErrorKind,
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
                        raw_input: None,
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
}
