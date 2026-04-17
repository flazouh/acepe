use crate::acp::session_update::{SessionUpdate, TurnErrorData};
use crate::acp::transcript_projection::delta::{TranscriptDelta, TranscriptDeltaOperation};
use crate::acp::transcript_projection::snapshot::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::types::ContentBlock;
use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Default)]
pub struct TranscriptProjectionRegistry {
    sessions: Arc<DashMap<String, SessionTranscriptProjection>>,
}

impl TranscriptProjectionRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
        }
    }

    pub fn restore_session_snapshot(&self, session_id: String, snapshot: TranscriptSnapshot) {
        self.sessions.insert(
            session_id,
            SessionTranscriptProjection::from_snapshot(snapshot),
        );
    }

    pub fn remove_session(&self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    #[must_use]
    pub fn snapshot_for_session(&self, session_id: &str) -> Option<TranscriptSnapshot> {
        self.sessions.get(session_id).map(|entry| entry.snapshot())
    }

    #[must_use]
    pub fn apply_delta(&self, delta: &TranscriptDelta) -> TranscriptSnapshot {
        let mut session = self
            .sessions
            .entry(delta.session_id.clone())
            .or_default();
        session.apply_delta(delta);
        session.snapshot()
    }

    #[must_use]
    pub fn apply_session_update(
        &self,
        event_seq: i64,
        update: &SessionUpdate,
    ) -> Option<TranscriptDelta> {
        let session_id = update.session_id()?.to_string();
        let mut session = self
            .sessions
            .entry(session_id.clone())
            .or_default();
        let operations = session.apply_session_update(event_seq, update)?;
        Some(TranscriptDelta {
            event_seq,
            session_id,
            snapshot_revision: event_seq,
            operations,
        })
    }
}

#[derive(Debug, Clone, Default)]
struct SessionTranscriptProjection {
    revision: i64,
    entries: Vec<TranscriptEntry>,
    entry_indexes: HashMap<String, usize>,
}

impl SessionTranscriptProjection {
    fn from_snapshot(snapshot: TranscriptSnapshot) -> Self {
        let mut entry_indexes = HashMap::new();
        for (index, entry) in snapshot.entries.iter().enumerate() {
            entry_indexes.insert(entry.entry_id.clone(), index);
        }
        Self {
            revision: snapshot.revision,
            entries: snapshot.entries,
            entry_indexes,
        }
    }

    fn snapshot(&self) -> TranscriptSnapshot {
        TranscriptSnapshot {
            revision: self.revision,
            entries: self.entries.clone(),
        }
    }

    fn apply_delta(&mut self, delta: &TranscriptDelta) {
        self.revision = delta.snapshot_revision;
        for operation in &delta.operations {
            match operation {
                TranscriptDeltaOperation::AppendEntry { entry } => {
                    self.upsert_entry(entry.clone());
                }
                TranscriptDeltaOperation::AppendSegment {
                    entry_id,
                    role,
                    segment,
                } => {
                    self.append_segment(entry_id.clone(), role.clone(), segment.clone());
                }
                TranscriptDeltaOperation::ReplaceSnapshot { snapshot } => {
                    *self = Self::from_snapshot(snapshot.clone());
                }
            }
        }
    }

    fn apply_session_update(
        &mut self,
        event_seq: i64,
        update: &SessionUpdate,
    ) -> Option<Vec<TranscriptDeltaOperation>> {
        self.revision = event_seq;
        match update {
            SessionUpdate::UserMessageChunk { chunk, .. } => {
                let text = text_from_block(&chunk.content)?;
                let entry = TranscriptEntry {
                    entry_id: format!("user-event-{event_seq}"),
                    role: TranscriptEntryRole::User,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("user-event-{event_seq}:segment:{event_seq}"),
                        text,
                    }],
                };
                self.upsert_entry(entry.clone());
                Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
            }
            SessionUpdate::AgentMessageChunk {
                chunk, message_id, ..
            } => {
                let text = text_from_block(&chunk.content)?;
                let entry_id = message_id
                    .clone()
                    .unwrap_or_else(|| format!("assistant-event-{event_seq}"));
                let segment = TranscriptSegment::Text {
                    segment_id: format!("{entry_id}:segment:{event_seq}"),
                    text,
                };
                if self.entry_indexes.contains_key(&entry_id) {
                    self.append_segment(
                        entry_id.clone(),
                        TranscriptEntryRole::Assistant,
                        segment.clone(),
                    );
                    Some(vec![TranscriptDeltaOperation::AppendSegment {
                        entry_id,
                        role: TranscriptEntryRole::Assistant,
                        segment,
                    }])
                } else {
                    let entry = TranscriptEntry {
                        entry_id,
                        role: TranscriptEntryRole::Assistant,
                        segments: vec![segment],
                    };
                    self.upsert_entry(entry.clone());
                    Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
                }
            }
            SessionUpdate::ToolCall { tool_call, .. } => {
                let entry = TranscriptEntry {
                    entry_id: tool_call.id.clone(),
                    role: TranscriptEntryRole::Tool,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("{}:tool", tool_call.id),
                        text: tool_call
                            .title
                            .clone()
                            .unwrap_or_else(|| tool_call.name.clone()),
                    }],
                };
                self.upsert_entry(entry.clone());
                Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
            }
            SessionUpdate::TurnError { error, turn_id, .. } => {
                let entry = TranscriptEntry {
                    entry_id: turn_id
                        .clone()
                        .unwrap_or_else(|| format!("error-event-{event_seq}")),
                    role: TranscriptEntryRole::Error,
                    segments: vec![error_segment(event_seq, error)],
                };
                self.upsert_entry(entry.clone());
                Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
            }
            _ => None,
        }
    }

    fn upsert_entry(&mut self, entry: TranscriptEntry) {
        if let Some(index) = self.entry_indexes.get(&entry.entry_id).copied() {
            self.entries[index] = entry;
            return;
        }
        let index = self.entries.len();
        self.entry_indexes.insert(entry.entry_id.clone(), index);
        self.entries.push(entry);
    }

    fn append_segment(
        &mut self,
        entry_id: String,
        role: TranscriptEntryRole,
        segment: TranscriptSegment,
    ) {
        if let Some(index) = self.entry_indexes.get(&entry_id).copied() {
            self.entries[index].segments.push(segment);
            return;
        }
        self.upsert_entry(TranscriptEntry {
            entry_id,
            role,
            segments: vec![segment],
        });
    }
}

fn text_from_block(block: &ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text { text } => Some(text.clone()),
        _ => None,
    }
}

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
    use super::TranscriptProjectionRegistry;
    use crate::acp::session_update::{
        ContentChunk, SessionUpdate, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
    };
    use crate::acp::transcript_projection::snapshot::{
        TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
    };
    use crate::acp::transcript_projection::TranscriptDeltaOperation;
    use crate::acp::types::ContentBlock;

    #[test]
    fn assistant_lineage_starts_with_entry_then_appends_segments() {
        let registry = TranscriptProjectionRegistry::new();
        let first = registry
            .apply_session_update(
                7,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "hello".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    session_id: Some("session-1".to_string()),
                },
            )
            .expect("first delta");
        let second = registry
            .apply_session_update(
                8,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: " world".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    session_id: Some("session-1".to_string()),
                },
            )
            .expect("second delta");

        assert!(matches!(
            &first.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "assistant-1"
        ));
        assert!(matches!(
            &second.operations[0],
            TranscriptDeltaOperation::AppendSegment { entry_id, role, .. }
                if entry_id == "assistant-1" && role == &TranscriptEntryRole::Assistant
        ));
    }

    #[test]
    fn restored_snapshot_keeps_followup_chunk_on_existing_entry() {
        let registry = TranscriptProjectionRegistry::new();
        registry.restore_session_snapshot(
            "session-1".to_string(),
            TranscriptSnapshot {
                revision: 6,
                entries: vec![TranscriptEntry {
                    entry_id: "assistant-1".to_string(),
                    role: TranscriptEntryRole::Assistant,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: "assistant-1:chunk:0".to_string(),
                        text: "hello".to_string(),
                    }],
                }],
            },
        );

        let delta = registry
            .apply_session_update(
                7,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: " world".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    session_id: Some("session-1".to_string()),
                },
            )
            .expect("delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendSegment { entry_id, .. } if entry_id == "assistant-1"
        ));
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].segments.len(), 2);
    }

    #[test]
    fn apply_delta_rehydrates_runtime_lineage_for_replayed_buffer() {
        let registry = TranscriptProjectionRegistry::new();
        let _ = registry.apply_delta(&crate::acp::transcript_projection::TranscriptDelta {
            event_seq: 7,
            session_id: "session-1".to_string(),
            snapshot_revision: 7,
            operations: vec![TranscriptDeltaOperation::AppendEntry {
                entry: TranscriptEntry {
                    entry_id: "assistant-1".to_string(),
                    role: TranscriptEntryRole::Assistant,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: "assistant-1:segment:7".to_string(),
                        text: "hello".to_string(),
                    }],
                },
            }],
        });

        let delta = registry
            .apply_session_update(
                8,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: " world".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    session_id: Some("session-1".to_string()),
                },
            )
            .expect("delta");
        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendSegment { entry_id, .. } if entry_id == "assistant-1"
        ));
    }

    #[test]
    fn turn_error_appends_error_entry() {
        let registry = TranscriptProjectionRegistry::new();
        let delta = registry
            .apply_session_update(
                9,
                &SessionUpdate::TurnError {
                    error: TurnErrorData::Structured(TurnErrorInfo {
                        message: "boom".to_string(),
                        kind: TurnErrorKind::Fatal,
                        code: None,
                        source: Some(TurnErrorSource::Unknown),
                    }),
                    session_id: Some("session-1".to_string()),
                    turn_id: Some("turn-1".to_string()),
                },
            )
            .expect("delta");
        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "turn-1" && entry.role == TranscriptEntryRole::Error
        ));
    }
}
