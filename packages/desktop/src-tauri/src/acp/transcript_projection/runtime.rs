use crate::acp::session_update::{SessionUpdate, ToolCallData, ToolKind, TurnErrorData};
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
        let mut session = self.sessions.entry(delta.session_id.clone()).or_default();
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
        let mut session = self.sessions.entry(session_id.clone()).or_default();
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
    assistant_entry_ids_by_turn_key: HashMap<String, String>,
    assistant_boundary_entry_count: usize,
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
            assistant_entry_ids_by_turn_key: HashMap::new(),
            assistant_boundary_entry_count: 0,
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
                    let closes_assistant_boundary = entry_closes_assistant_boundary(entry);
                    self.upsert_transcript_entry(delta.event_seq, entry.clone());
                    if closes_assistant_boundary {
                        self.close_assistant_entry_boundary();
                    }
                }
                TranscriptDeltaOperation::AppendSegment {
                    entry_id,
                    role,
                    segment,
                } => {
                    let closes_assistant_boundary = role_closes_assistant_boundary(role);
                    self.append_transcript_segment(
                        delta.event_seq,
                        entry_id.clone(),
                        role.clone(),
                        segment.clone(),
                    );
                    if closes_assistant_boundary {
                        self.close_assistant_entry_boundary();
                    }
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
        let delta = self.apply_session_update_inner(event_seq, update)?;
        // Transcript revision must only advance, and only when the transcript
        // actually changed. Non-transcript-bearing updates (telemetry, plan,
        // tool-call updates, etc.) must not bump the revision — otherwise
        // synthetic event seqs from the journal's Ok(None) path push revision
        // ahead of real transcript content, and a later real journaled
        // transcript event with a smaller event_seq would silently regress
        // revision and the frontend would drop the snapshot as "stale".
        if event_seq > self.revision {
            self.revision = event_seq;
        }
        Some(delta)
    }

    fn apply_session_update_inner(
        &mut self,
        event_seq: i64,
        update: &SessionUpdate,
    ) -> Option<Vec<TranscriptDeltaOperation>> {
        match update {
            SessionUpdate::UserMessageChunk {
                chunk, attempt_id, ..
            } => {
                let text = text_from_block(&chunk.content)?;
                let entry = TranscriptEntry {
                    entry_id: format!("user-event-{event_seq}"),
                    role: TranscriptEntryRole::User,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("user-event-{event_seq}:segment:{event_seq}"),
                        text,
                    }],
                    attempt_id: attempt_id.clone(),
                    timestamp_ms: None,
                };
                self.upsert_entry(entry.clone());
                self.close_assistant_entry_boundary();
                Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
            }
            SessionUpdate::AgentMessageChunk {
                chunk,
                message_id,
                part_id,
                ..
            } => {
                let text = text_from_block(&chunk.content)?;
                let entry_id = self.assistant_entry_id_for_chunk(message_id, part_id, event_seq);
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
                        attempt_id: None,
                        timestamp_ms: None,
                    };
                    self.upsert_entry(entry.clone());
                    Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
                }
            }
            SessionUpdate::AgentThoughtChunk {
                chunk,
                message_id,
                part_id,
                ..
            } => {
                let text = text_from_block(&chunk.content)?;
                let entry_id = self.assistant_entry_id_for_chunk(message_id, part_id, event_seq);
                let segment = TranscriptSegment::Thought {
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
                        attempt_id: None,
                        timestamp_ms: None,
                    };
                    self.upsert_entry(entry.clone());
                    Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
                }
            }
            SessionUpdate::ToolCall { tool_call, .. } => {
                if should_skip_unanswered_question_tool_row(tool_call) {
                    return None;
                }
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
                    attempt_id: None,
                    timestamp_ms: None,
                };
                self.upsert_entry(entry.clone());
                self.close_assistant_entry_boundary();
                Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
            }
            SessionUpdate::TurnError { error, turn_id, .. } => {
                let entry = TranscriptEntry {
                    entry_id: turn_id
                        .clone()
                        .unwrap_or_else(|| format!("error-event-{event_seq}")),
                    role: TranscriptEntryRole::Error,
                    segments: vec![error_segment(event_seq, error)],
                    attempt_id: None,
                    timestamp_ms: None,
                };
                self.upsert_entry(entry.clone());
                self.close_assistant_entry_boundary();
                Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
            }
            SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnCancelled { .. } => {
                self.close_assistant_entry_boundary();
                None
            }
            _ => None,
        }
    }

    fn upsert_transcript_entry(&mut self, _event_seq: i64, entry: TranscriptEntry) {
        self.upsert_entry(entry);
    }

    fn append_transcript_segment(
        &mut self,
        _event_seq: i64,
        entry_id: String,
        role: TranscriptEntryRole,
        segment: TranscriptSegment,
    ) {
        self.append_segment(entry_id, role, segment);
    }

    fn assistant_entry_id_for_chunk(
        &mut self,
        message_id: &Option<String>,
        part_id: &Option<String>,
        event_seq: i64,
    ) -> String {
        let provider_key = assistant_provider_key(message_id, part_id);
        let turn_key = self.current_turn_key();
        let scoped_key = format!("{turn_key}\u{1f}{provider_key}");

        if let Some(entry_id) = self.assistant_entry_ids_by_turn_key.get(&scoped_key) {
            return entry_id.clone();
        }

        let entry_id = format!("assistant-event-{event_seq}");
        self.assistant_entry_ids_by_turn_key
            .insert(scoped_key, entry_id.clone());
        entry_id
    }

    fn current_turn_key(&self) -> String {
        if self.assistant_boundary_entry_count == 0 {
            return "session-start".to_string();
        }
        format!("assistant-boundary:{}", self.assistant_boundary_entry_count)
    }

    fn close_assistant_entry_boundary(&mut self) {
        self.assistant_boundary_entry_count = self.entries.len();
        self.assistant_entry_ids_by_turn_key.clear();
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
            attempt_id: None,
            timestamp_ms: None,
        });
    }
}

fn should_skip_unanswered_question_tool_row(tool_call: &ToolCallData) -> bool {
    matches!(tool_call.kind, Some(ToolKind::Question)) && tool_call.question_answer.is_none()
}

fn assistant_provider_key(message_id: &Option<String>, part_id: &Option<String>) -> String {
    if let Some(message_id) = message_id.as_ref().filter(|value| !value.is_empty()) {
        return message_id.clone();
    }

    if let Some(part_id) = part_id.as_ref().filter(|value| !value.is_empty()) {
        return part_id.clone();
    }

    "assistant".to_string()
}

fn entry_closes_assistant_boundary(entry: &TranscriptEntry) -> bool {
    role_closes_assistant_boundary(&entry.role)
}

fn role_closes_assistant_boundary(role: &TranscriptEntryRole) -> bool {
    !matches!(role, TranscriptEntryRole::Assistant)
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
        ContentChunk, QuestionItem, QuestionOption, SessionUpdate, ToolArguments, ToolCallData,
        ToolCallStatus, ToolKind, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
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
                    produced_at_monotonic_ms: None,
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
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second delta");

        assert!(matches!(
            &first.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "assistant-event-7"
        ));
        assert!(matches!(
            &second.operations[0],
            TranscriptDeltaOperation::AppendSegment { entry_id, role, .. }
                if entry_id == "assistant-event-7" && role == &TranscriptEntryRole::Assistant
        ));
    }

    #[test]
    fn thought_chunk_projects_as_canonical_thought_segment() {
        let registry = TranscriptProjectionRegistry::new();
        let delta = registry
            .apply_session_update(
                7,
                &SessionUpdate::AgentThoughtChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "checking the readme".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("thinking-part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    session_id: Some("session-1".to_string()),
                },
            )
            .expect("thought delta");

        let value = serde_json::to_value(&delta.operations[0]).expect("serialized operation");

        assert_eq!(value["kind"], "appendEntry");
        assert_eq!(value["entry"]["role"], "assistant");
        assert_eq!(value["entry"]["segments"][0]["kind"], "thought");
        assert_eq!(value["entry"]["segments"][0]["text"], "checking the readme");
    }

    #[test]
    fn restored_snapshot_does_not_rehydrate_lineage_from_provider_message_id() {
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
                    attempt_id: None,
                    timestamp_ms: None,
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
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry, .. } if entry.entry_id == "assistant-event-7"
        ));
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(snapshot.entries[0].entry_id, "assistant-1");
        assert_eq!(snapshot.entries[1].entry_id, "assistant-event-7");
    }

    #[test]
    fn no_message_id_assistant_chunks_share_current_turn_entry() {
        let registry = TranscriptProjectionRegistry::new();
        registry
            .apply_session_update(
                1,
                &SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "reply shortly".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("session-1".to_string()),
                    attempt_id: None,
                },
            )
            .expect("user delta");

        let first = registry
            .apply_session_update(
                2,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "Ra".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("first assistant delta");
        let second = registry
            .apply_session_update(
                3,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "inbows arrive".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second assistant delta");

        let assistant_entry_id = match &first.operations[0] {
            TranscriptDeltaOperation::AppendEntry { entry } => entry.entry_id.clone(),
            other => {
                panic!("expected first no-id chunk to append an assistant entry, got {other:?}")
            }
        };
        assert!(matches!(
            &second.operations[0],
            TranscriptDeltaOperation::AppendSegment { entry_id, role, .. }
                if entry_id == &assistant_entry_id && role == &TranscriptEntryRole::Assistant
        ));

        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        let assistant_entries: Vec<_> = snapshot
            .entries
            .iter()
            .filter(|entry| entry.role == TranscriptEntryRole::Assistant)
            .collect();
        assert_eq!(assistant_entries.len(), 1);
        assert_eq!(assistant_entries[0].segments.len(), 2);
    }

    #[test]
    fn reused_assistant_message_id_after_user_turn_starts_new_entry() {
        let registry = TranscriptProjectionRegistry::new();
        registry
            .apply_session_update(
                1,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "English explanation".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("first assistant delta");
        registry
            .apply_session_update(
                2,
                &SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "repeat, in french".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("session-1".to_string()),
                    attempt_id: None,
                },
            )
            .expect("user delta");

        let delta = registry
            .apply_session_update(
                3,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "Explication en francais".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-2".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second assistant delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "assistant-event-3"
        ));
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(snapshot.entries.len(), 3);
        assert_eq!(snapshot.entries[0].entry_id, "assistant-event-1");
        assert_eq!(snapshot.entries[1].entry_id, "user-event-2");
        assert_eq!(snapshot.entries[2].entry_id, "assistant-event-3");
        assert_eq!(snapshot.entries[0].segments.len(), 1);
        assert_eq!(snapshot.entries[2].segments.len(), 1);
    }

    #[test]
    fn reused_assistant_message_id_after_tool_boundary_starts_new_entry() {
        let registry = TranscriptProjectionRegistry::new();
        registry
            .apply_session_update(
                1,
                &SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "run a command, then summarize".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("session-1".to_string()),
                    attempt_id: None,
                },
            )
            .expect("user delta");
        registry
            .apply_session_update(
                2,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "I'll inspect the files.".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-1".to_string()),
                    message_id: Some("msg-same".to_string()),
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("first assistant delta");
        registry
            .apply_session_update(
                3,
                &SessionUpdate::ToolCall {
                    tool_call: ToolCallData {
                        id: "toolu_1".to_string(),
                        name: "Read".to_string(),
                        arguments: ToolArguments::Read {
                            file_path: Some("README.md".to_string()),
                            source_context: None,
                        },
                        raw_input: None,
                        status: ToolCallStatus::Completed,
                        result: None,
                        kind: Some(ToolKind::Read),
                        title: Some("Read README.md".to_string()),
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
                },
            )
            .expect("tool delta");
        let trailing = registry
            .apply_session_update(
                4,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "The README is straightforward.".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-2".to_string()),
                    message_id: Some("msg-same".to_string()),
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second assistant delta");

        assert!(matches!(
            &trailing.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "assistant-event-4"
                    && entry.role == TranscriptEntryRole::Assistant
        ));

        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        let entry_roles: Vec<_> = snapshot
            .entries
            .iter()
            .map(|entry| entry.role.clone())
            .collect();
        assert_eq!(
            entry_roles,
            vec![
                TranscriptEntryRole::User,
                TranscriptEntryRole::Assistant,
                TranscriptEntryRole::Tool,
                TranscriptEntryRole::Assistant,
            ]
        );
        assert_eq!(snapshot.entries[1].entry_id, "assistant-event-2");
        assert_eq!(snapshot.entries[2].entry_id, "toolu_1");
        assert_eq!(snapshot.entries[3].entry_id, "assistant-event-4");
        assert_eq!(snapshot.entries[1].segments.len(), 1);
        assert_eq!(snapshot.entries[3].segments.len(), 1);
    }

    #[test]
    fn user_message_chunk_carries_attempt_id_into_canonical_entry() {
        let registry = TranscriptProjectionRegistry::new();
        let update: SessionUpdate = serde_json::from_value(serde_json::json!({
            "type": "userMessageChunk",
            "content": {
                "type": "text",
                "text": "hello"
            },
            "sessionId": "session-1",
            "attemptId": "attempt-123"
        }))
        .expect("user update");

        let delta = registry
            .apply_session_update(9, &update)
            .expect("user delta");
        let delta_json = serde_json::to_value(&delta).expect("serialize delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "user-event-9"
                    && entry.role == TranscriptEntryRole::User
        ));
        assert_eq!(
            delta_json["operations"][0]["entry"]["attemptId"],
            "attempt-123"
        );
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        let snapshot_json = serde_json::to_value(&snapshot).expect("serialize snapshot");
        assert_eq!(snapshot.entries[0].entry_id, "user-event-9");
        assert_eq!(snapshot_json["entries"][0]["attemptId"], "attempt-123");
    }

    #[test]
    fn apply_delta_does_not_rehydrate_lineage_from_provider_message_id() {
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
                    attempt_id: None,
                    timestamp_ms: None,
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
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("delta");
        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry, .. } if entry.entry_id == "assistant-event-8"
        ));
    }

    #[test]
    fn apply_delta_tool_entry_closes_live_assistant_boundary() {
        let registry = TranscriptProjectionRegistry::new();
        registry
            .apply_session_update(
                1,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "first".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-1".to_string()),
                    message_id: Some("msg-same".to_string()),
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("first assistant delta");

        let _ = registry.apply_delta(&crate::acp::transcript_projection::TranscriptDelta {
            event_seq: 2,
            session_id: "session-1".to_string(),
            snapshot_revision: 2,
            operations: vec![TranscriptDeltaOperation::AppendEntry {
                entry: TranscriptEntry {
                    entry_id: "toolu-1".to_string(),
                    role: TranscriptEntryRole::Tool,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: "toolu-1:tool".to_string(),
                        text: "Read README.md".to_string(),
                    }],
                    attempt_id: None,
                    timestamp_ms: None,
                },
            }],
        });

        let delta = registry
            .apply_session_update(
                3,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "second".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("part-2".to_string()),
                    message_id: Some("msg-same".to_string()),
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second assistant delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry, .. } if entry.entry_id == "assistant-event-3"
        ));
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(snapshot.entries[0].entry_id, "assistant-event-1");
        assert_eq!(snapshot.entries[1].entry_id, "toolu-1");
        assert_eq!(snapshot.entries[2].entry_id, "assistant-event-3");
    }

    #[test]
    fn live_transcript_skips_unanswered_question_tool_rows() {
        let registry = TranscriptProjectionRegistry::new();
        let delta = registry.apply_session_update(
            9,
            &SessionUpdate::ToolCall {
                tool_call: ToolCallData {
                    id: "toolu-question".to_string(),
                    name: "AskUserQuestion".to_string(),
                    arguments: ToolArguments::Other {
                        raw: serde_json::json!({
                            "questions": [{
                                "question": "Which archive button should get the confirm step?",
                                "header": "Archive confirm",
                                "options": [{
                                    "label": "Sidebar session list",
                                    "description": "Use the archive button in the session list"
                                }],
                                "multiSelect": false
                            }]
                        }),
                    },
                    raw_input: None,
                    status: ToolCallStatus::Pending,
                    result: None,
                    kind: Some(ToolKind::Question),
                    title: Some("Question".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: Some(vec![QuestionItem {
                        question: "Which archive button should get the confirm step?".to_string(),
                        header: "Archive confirm".to_string(),
                        options: vec![QuestionOption {
                            label: "Sidebar session list".to_string(),
                            description: "Use the archive button in the session list".to_string(),
                        }],
                        multi_select: false,
                    }]),
                    normalized_todos: None,
                    normalized_todo_update: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                session_id: Some("session-1".to_string()),
            },
        );

        assert!(
            delta.is_none(),
            "live AskUserQuestion should render through question UI, not as a tool transcript row"
        );
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("session transcript holder");
        assert!(
            snapshot.entries.is_empty(),
            "skipped question tool must not create a transcript entry"
        );
    }

    #[test]
    fn non_transcript_bearing_update_does_not_advance_transcript_revision() {
        // Regression: synthetic event seqs (from updates that don't change the transcript,
        // e.g. UsageTelemetryUpdate, Plan, ToolCallUpdate) must not bump the registry's
        // transcript revision. Otherwise revision drifts away from real transcript content
        // and later real transcript-bearing updates can REGRESS the revision, which the
        // frontend interprets as "stale snapshot, ignore" — silently dropping assistant
        // entries.
        let registry = TranscriptProjectionRegistry::new();

        // Seed with a real transcript-bearing update at event_seq=5.
        registry
            .apply_session_update(
                5,
                &SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "hello".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("session-1".to_string()),
                    attempt_id: None,
                },
            )
            .expect("user delta");
        let revision_before = registry
            .snapshot_for_session("session-1")
            .expect("snapshot")
            .revision;
        assert_eq!(revision_before, 5);

        // Apply many non-transcript-bearing updates with synthetic event seqs.
        for synthetic_seq in [100i64, 150, 220, 221] {
            let result = registry.apply_session_update(
                synthetic_seq,
                &SessionUpdate::UsageTelemetryUpdate {
                    data: crate::acp::session_update::UsageTelemetryData {
                        session_id: "session-1".to_string(),
                        event_id: None,
                        scope: "step".to_string(),
                        cost_usd: None,
                        tokens: Default::default(),
                        source_model_id: None,
                        timestamp_ms: None,
                        context_window_size: None,
                    },
                },
            );
            assert!(
                result.is_none(),
                "telemetry updates must not produce transcript deltas"
            );
        }

        let revision_after_telemetry = registry
            .snapshot_for_session("session-1")
            .expect("snapshot")
            .revision;
        assert_eq!(
            revision_after_telemetry, 5,
            "non-transcript-bearing updates must not advance transcript revision \
             (was bumped to event_seq, regressing later real transcript updates)"
        );
    }

    #[test]
    fn transcript_revision_must_not_regress_after_late_real_event() {
        // Invariant: the registry's transcript revision is monotonic.
        // Even if event_seqs arrive out of order (e.g. synthetic event seqs
        // from the journal Ok(None) path advance ahead of the real journaled
        // seq), a later real transcript-bearing update with a smaller
        // event_seq must never regress revision. Otherwise the frontend
        // would treat the snapshot as stale and silently drop the entry.
        let registry = TranscriptProjectionRegistry::new();

        // First a real transcript-bearing update at a high event_seq.
        registry
            .apply_session_update(
                221,
                &SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "hi".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("session-1".to_string()),
                    attempt_id: None,
                },
            )
            .expect("user delta");
        assert_eq!(
            registry
                .snapshot_for_session("session-1")
                .expect("snapshot")
                .revision,
            221
        );

        // Then a real transcript-bearing update arrives at a smaller event_seq
        // (simulates real journaled event interleaved with prior higher-seq events).
        registry
            .apply_session_update(
                64,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "the real assistant response".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: Some("assistant-1".to_string()),
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("assistant delta");

        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("snapshot");
        assert!(
            snapshot.revision >= 221,
            "transcript revision regressed (was 221, now {} after smaller event_seq=64) \
             — frontend would drop the assistant entry as 'stale snapshot'",
            snapshot.revision
        );
        assert!(
            snapshot
                .entries
                .iter()
                .any(|e| e.role == TranscriptEntryRole::Assistant),
            "assistant entry must be present"
        );
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
