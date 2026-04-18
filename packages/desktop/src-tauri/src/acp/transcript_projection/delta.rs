#[cfg(test)]
use crate::acp::session_update::{SessionUpdate, TurnErrorData};
use crate::acp::transcript_projection::snapshot::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
#[cfg(test)]
use crate::acp::types::ContentBlock;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptDelta {
    pub event_seq: i64,
    pub session_id: String,
    pub snapshot_revision: i64,
    pub operations: Vec<TranscriptDeltaOperation>,
}

impl TranscriptDelta {
    #[cfg(test)]
    #[must_use]
    pub fn from_session_update(event_seq: i64, update: &SessionUpdate) -> Option<Self> {
        let session_id = update.session_id()?.to_string();
        let operations = TranscriptDeltaOperation::from_session_update(event_seq, update)?;
        Some(Self {
            event_seq,
            session_id,
            snapshot_revision: event_seq,
            operations,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranscriptDeltaOperation {
    AppendEntry {
        entry: TranscriptEntry,
    },
    AppendSegment {
        entry_id: String,
        role: TranscriptEntryRole,
        segment: TranscriptSegment,
    },
    ReplaceSnapshot {
        snapshot: TranscriptSnapshot,
    },
}

#[cfg(test)]
impl TranscriptDeltaOperation {
    fn from_session_update(event_seq: i64, update: &SessionUpdate) -> Option<Vec<Self>> {
        match update {
            SessionUpdate::UserMessageChunk { chunk, .. } => text_chunk_from_block(
                &chunk.content,
                || format!("user-event-{event_seq}"),
                TranscriptEntryRole::User,
                format!("user-event-{event_seq}:block:0"),
            )
            .map(|segment| {
                vec![Self::AppendEntry {
                    entry: TranscriptEntry {
                        entry_id: format!("user-event-{event_seq}"),
                        role: TranscriptEntryRole::User,
                        segments: vec![segment],
                    },
                }]
            }),
            SessionUpdate::AgentMessageChunk {
                chunk,
                message_id,
                part_id,
                ..
            } => text_chunk_from_block(
                &chunk.content,
                || {
                    message_id
                        .clone()
                        .unwrap_or_else(|| format!("assistant-event-{event_seq}"))
                },
                TranscriptEntryRole::Assistant,
                part_id
                    .clone()
                    .unwrap_or_else(|| format!("assistant-event-{event_seq}:chunk:{event_seq}")),
            )
            .map(|segment| {
                vec![Self::AppendSegment {
                    entry_id: message_id
                        .clone()
                        .unwrap_or_else(|| format!("assistant-event-{event_seq}")),
                    role: TranscriptEntryRole::Assistant,
                    segment,
                }]
            }),
            SessionUpdate::ToolCall { tool_call, .. } => Some(vec![Self::AppendEntry {
                entry: TranscriptEntry {
                    entry_id: tool_call.id.clone(),
                    role: TranscriptEntryRole::Tool,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("{}:tool", tool_call.id),
                        text: tool_call
                            .title
                            .clone()
                            .unwrap_or_else(|| tool_call.name.clone()),
                    }],
                },
            }]),
            SessionUpdate::TurnError { error, turn_id, .. } => Some(vec![Self::AppendEntry {
                entry: TranscriptEntry {
                    entry_id: turn_id
                        .clone()
                        .unwrap_or_else(|| format!("error-event-{event_seq}")),
                    role: TranscriptEntryRole::Error,
                    segments: vec![error_segment(event_seq, error)],
                },
            }]),
            _ => None,
        }
    }
}

#[cfg(test)]
fn text_chunk_from_block(
    block: &ContentBlock,
    entry_id: impl FnOnce() -> String,
    role: TranscriptEntryRole,
    segment_id: String,
) -> Option<TranscriptSegment> {
    match block {
        ContentBlock::Text { text } => Some(TranscriptSegment::Text {
            segment_id: match role {
                TranscriptEntryRole::Assistant | TranscriptEntryRole::User => {
                    format!("{}:{segment_id}", entry_id())
                }
                _ => segment_id,
            },
            text: text.clone(),
        }),
        _ => None,
    }
}

#[cfg(test)]
fn error_segment(event_seq: i64, error: &TurnErrorData) -> TranscriptSegment {
    TranscriptSegment::Text {
        segment_id: format!("error-event-{event_seq}:error"),
        text: match error {
            TurnErrorData::Legacy(message) => message.clone(),
            TurnErrorData::Structured(info) => info.message.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{TranscriptDelta, TranscriptDeltaOperation};
    use crate::acp::session_update::{
        ContentChunk, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
        TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
    };
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
    use crate::acp::types::ContentBlock;

    #[test]
    fn transcript_delta_appends_assistant_segments_to_one_lineage() {
        let update = SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("part-1".to_string()),
            message_id: Some("assistant-1".to_string()),
            session_id: Some("session-1".to_string()),
        };

        let delta = TranscriptDelta::from_session_update(7, &update).expect("delta");

        assert_eq!(delta.session_id, "session-1");
        assert_eq!(delta.snapshot_revision, 7);
        assert_eq!(
            delta.operations,
            vec![TranscriptDeltaOperation::AppendSegment {
                entry_id: "assistant-1".to_string(),
                role: TranscriptEntryRole::Assistant,
                segment: TranscriptSegment::Text {
                    segment_id: "assistant-1:part-1".to_string(),
                    text: "hello".to_string(),
                },
            }]
        );
    }

    #[test]
    fn transcript_delta_emits_tool_and_error_rows_as_entries() {
        let tool_update = SessionUpdate::ToolCall {
            tool_call: ToolCallData {
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
            session_id: Some("session-1".to_string()),
        };
        let error_update = SessionUpdate::TurnError {
            error: TurnErrorData::Structured(TurnErrorInfo {
                message: "boom".to_string(),
                kind: TurnErrorKind::Fatal,
                source: Some(TurnErrorSource::Unknown),
                code: None,
            }),
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };

        let tool_delta = TranscriptDelta::from_session_update(8, &tool_update).expect("tool delta");
        let error_delta =
            TranscriptDelta::from_session_update(9, &error_update).expect("error delta");

        assert!(matches!(
            &tool_delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "tool-1" && entry.role == TranscriptEntryRole::Tool
        ));
        assert!(matches!(
            &error_delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "turn-1" && entry.role == TranscriptEntryRole::Error
        ));
    }
}
