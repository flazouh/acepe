use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::projections::{RouteDecision, TerminalTurnGuard};
use crate::acp::session_update::{SessionUpdate, ToolCallData, ToolKind};
use crate::acp::transcript_projection::delta::{TranscriptDelta, TranscriptDeltaOperation};
use crate::acp::transcript_projection::display_id::{
    assistant_boundary_entry_count_from_transcript_entries, derive_entry_id_for_snapshot_role,
    derive_session_activity_entry_id, derive_tool_entry_id, tool_call_id_from_authority_entry_id,
    turn_key_for_assistant_boundary,
};
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

#[derive(Debug, Clone)]
pub(crate) struct TranscriptEntryProjectionSlice {
    pub(crate) revision: i64,
    pub(crate) total_entry_count: usize,
    pub(crate) entries: Vec<IndexedTranscriptEntry>,
}

#[derive(Debug, Clone)]
pub(crate) struct IndexedTranscriptEntry {
    pub(crate) index: usize,
    pub(crate) entry: TranscriptEntry,
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
    pub fn compact_snapshot_for_session(&self, session_id: &str) -> Option<TranscriptSnapshot> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.compact_snapshot())
    }

    #[must_use]
    pub(crate) fn entry_slice_for_session(
        &self,
        session_id: &str,
        entry_ids: &[String],
    ) -> Option<TranscriptEntryProjectionSlice> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.entry_slice(entry_ids))
    }

    #[must_use]
    pub(crate) fn entry_suffix_for_session(
        &self,
        session_id: &str,
        start_index: usize,
    ) -> Option<TranscriptEntryProjectionSlice> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.entry_suffix(start_index))
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
        decision: RouteDecision,
    ) -> Option<TranscriptDelta> {
        let session_id = update.session_id()?.to_string();
        let mut session = self.sessions.entry(session_id.clone()).or_default();
        let operations = session.apply_session_update(event_seq, update, decision)?;
        Some(TranscriptDelta {
            event_seq,
            session_id,
            snapshot_revision: event_seq,
            operations,
        })
    }

    /// Applies one update with decide-then-advance on an explicit guard (tests and replay loops).
    #[must_use]
    pub fn apply_session_update_with_guard(
        &self,
        guard: &mut TerminalTurnGuard,
        event_seq: i64,
        update: &SessionUpdate,
    ) -> Option<TranscriptDelta> {
        let decision = guard.route(update);
        let delta = self.apply_session_update(event_seq, update, decision);
        guard.advance(update);
        delta
    }

    /// Applies one update using a non-terminal idle guard (simple test paths only).
    #[must_use]
    pub fn apply_session_update_idle(
        &self,
        event_seq: i64,
        update: &SessionUpdate,
    ) -> Option<TranscriptDelta> {
        self.apply_session_update(
            event_seq,
            update,
            TerminalTurnGuard::default().route(update),
        )
    }
}

#[derive(Debug, Clone, Default)]
struct SessionTranscriptProjection {
    revision: i64,
    entries: Vec<TranscriptEntry>,
    entry_indexes: HashMap<String, usize>,
    tool_entry_ids_by_tool_call_id: HashMap<String, String>,
    assistant_boundary_entry_count: usize,
}

impl SessionTranscriptProjection {
    fn from_snapshot(snapshot: TranscriptSnapshot) -> Self {
        let mut entry_indexes = HashMap::new();
        for (index, entry) in snapshot.entries.iter().enumerate() {
            entry_indexes.insert(entry.entry_id.clone(), index);
        }
        let entries = snapshot.entries;
        Self {
            revision: snapshot.revision,
            entries: entries.clone(),
            entry_indexes,
            tool_entry_ids_by_tool_call_id: rebuild_tool_entry_ids_by_tool_call_id(&entries),
            assistant_boundary_entry_count: assistant_boundary_entry_count_from_transcript_entries(
                &entries,
            ),
        }
    }

    fn snapshot(&self) -> TranscriptSnapshot {
        TranscriptSnapshot {
            revision: self.revision,
            entries: self.entries.clone(),
        }
    }

    fn compact_snapshot(&self) -> TranscriptSnapshot {
        TranscriptSnapshot {
            revision: self.revision,
            entries: Vec::new(),
        }
    }

    fn entry_slice(&self, entry_ids: &[String]) -> TranscriptEntryProjectionSlice {
        let mut entries = Vec::new();
        for entry_id in entry_ids {
            let Some(index) = self.entry_indexes.get(entry_id).copied() else {
                continue;
            };
            if entries
                .iter()
                .any(|entry: &IndexedTranscriptEntry| entry.index == index)
            {
                continue;
            }
            entries.push(IndexedTranscriptEntry {
                index,
                entry: self.entries[index].clone(),
            });
        }
        entries.sort_by_key(|entry| entry.index);

        TranscriptEntryProjectionSlice {
            revision: self.revision,
            total_entry_count: self.entries.len(),
            entries,
        }
    }

    fn entry_suffix(&self, start_index: usize) -> TranscriptEntryProjectionSlice {
        let start_index = start_index.min(self.entries.len());
        let entries = self.entries[start_index..]
            .iter()
            .enumerate()
            .map(|(offset, entry)| IndexedTranscriptEntry {
                index: start_index.saturating_add(offset),
                entry: entry.clone(),
            })
            .collect();

        TranscriptEntryProjectionSlice {
            revision: self.revision,
            total_entry_count: self.entries.len(),
            entries,
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
        decision: RouteDecision,
    ) -> Option<Vec<TranscriptDeltaOperation>> {
        let delta = self.apply_session_update_inner(event_seq, update, decision)?;
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
        decision: RouteDecision,
    ) -> Option<Vec<TranscriptDeltaOperation>> {
        if decision.ignore_late {
            if matches!(
                update,
                SessionUpdate::TurnError { .. } | SessionUpdate::TurnComplete { .. }
            ) {
                return None;
            }
        }
        if decision.suppress {
            if matches!(
                update,
                SessionUpdate::AgentMessageChunk { .. }
                    | SessionUpdate::AgentThoughtChunk { .. }
                    | SessionUpdate::ToolCall { .. }
                    | SessionUpdate::ToolCallUpdate { .. }
            ) {
                return None;
            }
        }
        if let SessionUpdate::ToolCall { tool_call, .. } = update {
            if should_skip_unanswered_question_tool_row(tool_call) {
                return None;
            }
        }

        match update {
            SessionUpdate::UserMessageChunk {
                chunk, attempt_id, ..
            } => {
                let text = text_from_block(&chunk.content)?;
                let turn_key = self.current_turn_key();
                let entry_id =
                    derive_entry_id_for_snapshot_role(&turn_key, &TranscriptEntryRole::User, None);
                let segment =
                    crate::acp::transcript_projection::snapshot::user_transcript_segment_from_text(
                        format!("{entry_id}:segment:{event_seq}"),
                        text,
                    );
                let entry = TranscriptEntry {
                    entry_id: entry_id.clone(),
                    role: TranscriptEntryRole::User,
                    segments: vec![segment],
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
                parent_tool_use_id,
                ..
            } => {
                if parent_tool_use_id.is_some() {
                    return None;
                }
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
                parent_tool_use_id,
                ..
            } => {
                if parent_tool_use_id.is_some() {
                    return None;
                }
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
                let normalized_tool_call_id = normalize_tool_call_id(&tool_call.id);
                let entry_id = self
                    .tool_entry_ids_by_tool_call_id
                    .get(&normalized_tool_call_id)
                    .cloned()
                    .unwrap_or_else(|| {
                        derive_tool_entry_id(&self.current_turn_key(), &tool_call.id)
                    });
                let entry = TranscriptEntry {
                    entry_id: entry_id.clone(),
                    role: TranscriptEntryRole::Tool,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("{entry_id}:tool"),
                        text: tool_call
                            .title
                            .clone()
                            .unwrap_or_else(|| tool_call.name.clone()),
                    }],
                    attempt_id: None,
                    timestamp_ms: None,
                };
                self.tool_entry_ids_by_tool_call_id
                    .insert(normalized_tool_call_id, entry_id);
                self.upsert_entry(entry.clone());
                self.close_assistant_entry_boundary();
                Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
            }
            SessionUpdate::CompactionEvent { event, .. } => {
                let entry_id =
                    derive_session_activity_entry_id(&self.current_turn_key(), &event.event_id);
                let entry = TranscriptEntry {
                    entry_id: entry_id.clone(),
                    role: TranscriptEntryRole::SessionActivity,
                    segments: vec![TranscriptSegment::Compaction {
                        segment_id: format!("{entry_id}:compaction"),
                        event: event.clone(),
                    }],
                    attempt_id: None,
                    timestamp_ms: event.timestamp_ms,
                };
                self.upsert_entry(entry.clone());
                self.close_assistant_entry_boundary();
                Some(vec![TranscriptDeltaOperation::AppendEntry { entry }])
            }
            SessionUpdate::TurnError { .. } => {
                self.close_assistant_entry_boundary();
                None
            }
            SessionUpdate::TurnComplete { .. } => {
                self.close_assistant_entry_boundary();
                None
            }
            SessionUpdate::TurnCancelled { .. } => {
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
        _message_id: &Option<String>,
        _part_id: &Option<String>,
        _event_seq: i64,
    ) -> String {
        derive_entry_id_for_snapshot_role(
            &self.current_turn_key(),
            &TranscriptEntryRole::Assistant,
            None,
        )
    }

    fn current_turn_key(&self) -> String {
        turn_key_for_assistant_boundary(self.assistant_boundary_entry_count)
    }

    fn close_assistant_entry_boundary(&mut self) {
        self.assistant_boundary_entry_count = self.entries.len();
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

fn rebuild_tool_entry_ids_by_tool_call_id(entries: &[TranscriptEntry]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for entry in entries {
        if entry.role != TranscriptEntryRole::Tool {
            continue;
        }
        let Some(tool_call_id) = tool_call_id_from_authority_entry_id(&entry.entry_id) else {
            continue;
        };
        map.insert(tool_call_id.clone(), entry.entry_id.clone());
    }
    map
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

#[cfg(test)]
mod tests {
    use super::TranscriptProjectionRegistry;
    use crate::acp::projections::TerminalTurnGuard;
    use crate::acp::session_update::{
        ContentChunk, QuestionItem, QuestionOption, SessionCompactionEvent,
        SessionCompactionStatus, SessionCompactionTrigger, SessionUpdate, ToolArguments,
        ToolCallData, ToolCallStatus, ToolKind, TurnErrorData, TurnErrorInfo, TurnErrorKind,
        TurnErrorSource,
    };
    use crate::acp::transcript_projection::snapshot::{
        TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
    };
    use crate::acp::transcript_projection::TranscriptDeltaOperation;
    use crate::acp::types::ContentBlock;

    fn transcript_entry(entry_id: &str, role: TranscriptEntryRole, text: &str) -> TranscriptEntry {
        TranscriptEntry {
            entry_id: entry_id.to_string(),
            role,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:text:0"),
                text: text.to_string(),
            }],
            attempt_id: None,
            timestamp_ms: None,
        }
    }

    #[test]
    fn assistant_lineage_starts_with_entry_then_appends_segments() {
        let registry = TranscriptProjectionRegistry::new();
        let first = registry
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("first delta");
        let second = registry
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second delta");

        assert!(matches!(
            &first.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "acepe::entry::session-start::assistant::."
        ));
        assert!(matches!(
            &second.operations[0],
            TranscriptDeltaOperation::AppendSegment { entry_id, role, .. }
                if entry_id == "acepe::entry::session-start::assistant::." && role == &TranscriptEntryRole::Assistant
        ));
    }

    #[test]
    fn compaction_event_appends_session_activity_entry() {
        let registry = TranscriptProjectionRegistry::new();
        let event = SessionCompactionEvent {
            event_id: "compact-1".to_string(),
            session_id: "session-1".to_string(),
            status: SessionCompactionStatus::Completed,
            trigger: SessionCompactionTrigger::Auto,
            pre_compaction_tokens: Some(180000),
            post_compaction_tokens: Some(42000),
            dropped_tokens: Some(138000),
            context_window_size: Some(200000),
            duration_ms: Some(918),
            precomputed: Some(true),
            preserved_message_count: Some(2),
            cumulative_dropped_tokens: Some(138000),
            timestamp_ms: Some(1770000000000_i64),
            summary: Some("Compaction done".to_string()),
            provider_metadata: serde_json::json!({ "subtype": "compact_boundary" }),
        };

        let delta = registry
            .apply_session_update_idle(
                7,
                &SessionUpdate::CompactionEvent {
                    event: event.clone(),
                    session_id: Some("session-1".to_string()),
                },
            )
            .expect("compaction delta");

        assert_eq!(delta.snapshot_revision, 7);
        let TranscriptDeltaOperation::AppendEntry { entry } = &delta.operations[0] else {
            panic!("expected append entry");
        };
        assert_eq!(entry.role, TranscriptEntryRole::SessionActivity);
        assert_eq!(entry.timestamp_ms, Some(1770000000000_i64));
        assert!(entry.entry_id.contains("session-activity"));
        assert_eq!(
            entry.segments,
            vec![TranscriptSegment::Compaction {
                segment_id: format!("{}:compaction", entry.entry_id),
                event,
            }]
        );
    }

    #[test]
    fn subagent_text_chunk_does_not_append_to_parent_assistant_row() {
        let registry = TranscriptProjectionRegistry::new();
        registry
            .apply_session_update_idle(
                1,
                &SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "Parent text.".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: Some("parent-message".to_string()),
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("parent assistant delta");
        registry
            .apply_session_update_idle(
                2,
                &SessionUpdate::ToolCall {
                    tool_call: ToolCallData {
                        id: "toolu_task_parent".to_string(),
                        name: "Task".to_string(),
                        arguments: ToolArguments::Other {
                            raw: serde_json::json!({
                                "description": "Find new chat modal project trigger"
                            }),
                            intent: None,
                        },
                        diagnostic_input: None,
                        status: ToolCallStatus::Completed,
                        result: None,
                        kind: Some(ToolKind::Task),
                        title: Some("Find new chat modal project trigger".to_string()),
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
            .expect("task tool delta");

        let subagent_delta = registry.apply_session_update_idle(
            3,
            &SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "Subagent report that must not leak.".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: None,
                message_id: Some("subagent-message".to_string()),
                session_id: Some("session-1".to_string()),
                produced_at_monotonic_ms: None,
                parent_tool_use_id: Some("toolu_task_parent".to_string()),
            },
        );

        assert_eq!(subagent_delta, None);
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(snapshot.entries[0].role, TranscriptEntryRole::Assistant);
        assert_eq!(snapshot.entries[1].role, TranscriptEntryRole::Tool);
        match &snapshot.entries[0].segments[0] {
            TranscriptSegment::Text { text, .. } => assert_eq!(text, "Parent text."),
            other => panic!("expected parent text segment, got {other:?}"),
        }
    }

    #[test]
    fn thought_chunk_projects_as_canonical_thought_segment() {
        let registry = TranscriptProjectionRegistry::new();
        let delta = registry
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry, .. } if entry.entry_id == "acepe::entry::session-start::assistant::."
        ));
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(snapshot.entries[0].entry_id, "assistant-1");
        assert_eq!(
            snapshot.entries[1].entry_id,
            "acepe::entry::session-start::assistant::."
        );
    }

    #[test]
    fn entry_slice_for_session_returns_requested_entry_indexes() {
        let registry = TranscriptProjectionRegistry::new();
        registry.restore_session_snapshot(
            "session-1".to_string(),
            TranscriptSnapshot {
                revision: 9,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Assistant, "second"),
                    transcript_entry("entry-2", TranscriptEntryRole::Assistant, "third"),
                ],
            },
        );

        let requested_entry_ids = vec!["entry-2".to_string()];
        let slice = registry
            .entry_slice_for_session("session-1", &requested_entry_ids)
            .expect("entry slice should exist");

        assert_eq!(slice.revision, 9);
        assert_eq!(slice.total_entry_count, 3);
        assert_eq!(slice.entries.len(), 1);
        assert_eq!(slice.entries[0].index, 2);
        assert_eq!(slice.entries[0].entry.entry_id, "entry-2");
    }

    #[test]
    fn entry_suffix_for_session_returns_entries_from_start_index() {
        let registry = TranscriptProjectionRegistry::new();
        registry.restore_session_snapshot(
            "session-1".to_string(),
            TranscriptSnapshot {
                revision: 11,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Assistant, "second"),
                    transcript_entry("entry-2", TranscriptEntryRole::Tool, "third"),
                    transcript_entry("entry-3", TranscriptEntryRole::Assistant, "fourth"),
                ],
            },
        );

        let suffix = registry
            .entry_suffix_for_session("session-1", 1)
            .expect("entry suffix should exist");

        assert_eq!(suffix.revision, 11);
        assert_eq!(suffix.total_entry_count, 4);
        assert_eq!(suffix.entries.len(), 3);
        assert_eq!(suffix.entries[0].index, 1);
        assert_eq!(suffix.entries[0].entry.entry_id, "entry-1");
        assert_eq!(suffix.entries[2].index, 3);
        assert_eq!(suffix.entries[2].entry.entry_id, "entry-3");
    }

    #[test]
    fn no_message_id_assistant_chunks_share_current_turn_entry() {
        let registry = TranscriptProjectionRegistry::new();
        registry
            .apply_session_update_idle(
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("first assistant delta");
        let second = registry
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("first assistant delta");
        registry
            .apply_session_update_idle(
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second assistant delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "acepe::entry::assistant-boundary:2::assistant::."
        ));
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(snapshot.entries.len(), 3);
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::assistant::."
        );
        assert_eq!(
            snapshot.entries[1].entry_id,
            "acepe::entry::session-start::user::."
        );
        assert_eq!(
            snapshot.entries[2].entry_id,
            "acepe::entry::assistant-boundary:2::assistant::."
        );
        assert_eq!(snapshot.entries[0].segments.len(), 1);
        assert_eq!(snapshot.entries[2].segments.len(), 1);
    }

    #[test]
    fn reused_assistant_message_id_after_tool_boundary_starts_new_entry() {
        let registry = TranscriptProjectionRegistry::new();
        registry
            .apply_session_update_idle(
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("first assistant delta");
        registry
            .apply_session_update_idle(
                3,
                &SessionUpdate::ToolCall {
                    tool_call: ToolCallData {
                        id: "toolu_1".to_string(),
                        name: "Read".to_string(),
                        arguments: ToolArguments::Read {
                            file_path: Some("README.md".to_string()),
                            source_context: None,
                        },
                        diagnostic_input: None,
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second assistant delta");

        assert!(matches!(
            &trailing.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "acepe::entry::assistant-boundary:3::assistant::."
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
        assert_eq!(
            snapshot.entries[1].entry_id,
            "acepe::entry::assistant-boundary:1::assistant::."
        );
        assert_eq!(
            snapshot.entries[2].entry_id,
            "acepe::entry::assistant-boundary:1::tool::toolu_1"
        );
        assert_eq!(
            snapshot.entries[3].entry_id,
            "acepe::entry::assistant-boundary:3::assistant::."
        );
        assert_eq!(snapshot.entries[1].segments.len(), 1);
        assert_eq!(snapshot.entries[3].segments.len(), 1);
    }

    #[test]
    fn user_message_chunk_carries_attempt_id_into_canonical_entry() {
        let registry = TranscriptProjectionRegistry::new();
        let update = SessionUpdate::UserMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some("session-1".to_string()),
            attempt_id: Some("attempt-123".to_string()),
        };

        let delta = registry
            .apply_session_update_idle(9, &update)
            .expect("user delta");
        let delta_json = serde_json::to_value(&delta).expect("serialize delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.entry_id == "acepe::entry::session-start::user::."
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
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::user::."
        );
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("delta");
        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry, .. } if entry.entry_id == "acepe::entry::session-start::assistant::."
        ));
    }

    #[test]
    fn apply_delta_tool_entry_closes_live_assistant_boundary() {
        let registry = TranscriptProjectionRegistry::new();
        registry
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
                    session_id: Some("session-1".to_string()),
                    produced_at_monotonic_ms: None,
                },
            )
            .expect("second assistant delta");

        assert!(matches!(
            &delta.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry, .. } if entry.entry_id == "acepe::entry::assistant-boundary:2::assistant::."
        ));
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(
            snapshot.entries[0].entry_id,
            "acepe::entry::session-start::assistant::."
        );
        assert_eq!(snapshot.entries[1].entry_id, "toolu-1");
        assert_eq!(
            snapshot.entries[2].entry_id,
            "acepe::entry::assistant-boundary:2::assistant::."
        );
    }

    #[test]
    fn live_transcript_skips_unanswered_question_tool_rows() {
        let registry = TranscriptProjectionRegistry::new();
        let delta = registry.apply_session_update_idle(
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
                        intent: None,
                    },
                    diagnostic_input: None,
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
    fn live_transcript_replaces_duplicate_tool_call_row_for_same_tool_id() {
        let registry = TranscriptProjectionRegistry::new();
        let first = registry
            .apply_session_update_idle(
                432,
                &SessionUpdate::ToolCall {
                    tool_call: ToolCallData {
                        id: "toolu_same".to_string(),
                        name: "Run".to_string(),
                        arguments: ToolArguments::Execute {
                            command: Some("pwd".to_string()),
                        },
                        diagnostic_input: None,
                        status: ToolCallStatus::InProgress,
                        result: None,
                        kind: Some(ToolKind::Execute),
                        title: Some("Verify file path".to_string()),
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
            .expect("first tool delta");
        let second = registry
            .apply_session_update_idle(
                433,
                &SessionUpdate::ToolCall {
                    tool_call: ToolCallData {
                        id: "toolu_same".to_string(),
                        name: "Run".to_string(),
                        arguments: ToolArguments::Execute {
                            command: Some("pwd".to_string()),
                        },
                        diagnostic_input: None,
                        status: ToolCallStatus::InProgress,
                        result: None,
                        kind: Some(ToolKind::Execute),
                        title: Some("Verify file path".to_string()),
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
            .expect("replacement tool delta");

        let authority_entry_id = "acepe::entry::session-start::tool::toolu_same";
        assert!(matches!(
            &first.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry } if entry.entry_id == authority_entry_id
        ));
        assert!(matches!(
            &second.operations[0],
            TranscriptDeltaOperation::AppendEntry { entry } if entry.entry_id == authority_entry_id
        ));

        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].entry_id, authority_entry_id);
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
            .apply_session_update_idle(
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
            let result = registry.apply_session_update_idle(
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
                        context_window_source: None,
                        parent_tool_use_id: None,
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
            .apply_session_update_idle(
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
            .apply_session_update_idle(
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
                    parent_tool_use_id: None,
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
    fn turn_error_does_not_append_transcript_entry() {
        let registry = TranscriptProjectionRegistry::new();
        let delta = registry.apply_session_update_idle(
            9,
            &SessionUpdate::TurnError {
                error: TurnErrorData::Structured(TurnErrorInfo {
                    message: "boom".to_string(),
                    kind: TurnErrorKind::Fatal,
                    code: None,
                    source: Some(TurnErrorSource::Unknown),
                    details: None,
                }),
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );
        assert!(
            delta.is_none(),
            "turn errors are live-only state, not transcript content"
        );
        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("snapshot");
        assert!(
            snapshot.entries.is_empty(),
            "turn error must not materialize a transcript row"
        );
    }

    #[test]
    fn skips_tool_call_after_terminal_turn_error() {
        let registry = TranscriptProjectionRegistry::new();
        let mut guard = TerminalTurnGuard::default();
        let _ = registry.apply_session_update_with_guard(
            &mut guard,
            8,
            &SessionUpdate::TurnError {
                error: TurnErrorData::Structured(TurnErrorInfo {
                    message: "boom".to_string(),
                    kind: TurnErrorKind::Fatal,
                    code: None,
                    source: Some(TurnErrorSource::Unknown),
                    details: None,
                }),
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        let late_tool = registry.apply_session_update_with_guard(
            &mut guard,
            9,
            &SessionUpdate::ToolCall {
                tool_call: ToolCallData {
                    id: "tool-1".to_string(),
                    name: "bash".to_string(),
                    arguments: ToolArguments::Execute {
                        command: Some("echo".to_string()),
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::InProgress,
                    result: None,
                    kind: Some(ToolKind::Execute),
                    title: None,
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
        );
        assert!(late_tool.is_none());
    }

    #[test]
    fn appends_tool_call_for_new_turn_after_terminal_turn_error() {
        // Regression: after a turn fails, the terminal-turn guard must reset when
        // the user re-prompts (a genuinely new turn). A tool call belonging to the
        // new turn is NOT a straggler of the failed turn and must appear in the
        // transcript -- otherwise it shows only in the Attention Queue, never in chat.
        let registry = TranscriptProjectionRegistry::new();
        let mut guard = TerminalTurnGuard::default();

        let _ = registry.apply_session_update_with_guard(
            &mut guard,
            8,
            &SessionUpdate::TurnError {
                error: TurnErrorData::Structured(TurnErrorInfo {
                    message: "boom".to_string(),
                    kind: TurnErrorKind::Fatal,
                    code: None,
                    source: Some(TurnErrorSource::Unknown),
                    details: None,
                }),
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        registry
            .apply_session_update_with_guard(
                &mut guard,
                9,
                &SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "What is the current branch?".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("session-1".to_string()),
                    attempt_id: None,
                },
            )
            .expect("user delta");

        let new_turn_tool = registry.apply_session_update_with_guard(
            &mut guard,
            10,
            &SessionUpdate::ToolCall {
                tool_call: ToolCallData {
                    id: "tool-2".to_string(),
                    name: "bash".to_string(),
                    arguments: ToolArguments::Execute {
                        command: Some("rtk git branch --show-current".to_string()),
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::InProgress,
                    result: None,
                    kind: Some(ToolKind::Execute),
                    title: None,
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
        );

        assert!(
            new_turn_tool.is_some(),
            "tool call for a new turn after a terminal error must append a transcript row"
        );
    }

    #[test]
    fn skips_agent_thought_after_terminal_turn_cancelled() {
        let registry = TranscriptProjectionRegistry::new();
        let mut guard = TerminalTurnGuard::default();
        let _ = registry.apply_session_update_with_guard(
            &mut guard,
            8,
            &SessionUpdate::TurnCancelled {
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        let late_thought = registry.apply_session_update_with_guard(
            &mut guard,
            9,
            &SessionUpdate::AgentThoughtChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "still thinking".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: Some("part-1".to_string()),
                message_id: Some("assistant-1".to_string()),
                parent_tool_use_id: None,
                session_id: Some("session-1".to_string()),
            },
        );
        assert!(late_thought.is_none());
    }

    #[test]
    fn skips_agent_message_chunk_after_terminal_turn_error() {
        let registry = TranscriptProjectionRegistry::new();
        let mut guard = TerminalTurnGuard::default();
        let _ = registry.apply_session_update_with_guard(
            &mut guard,
            8,
            &SessionUpdate::TurnError {
                error: TurnErrorData::Structured(TurnErrorInfo {
                    message: "boom".to_string(),
                    kind: TurnErrorKind::Fatal,
                    code: None,
                    source: Some(TurnErrorSource::Unknown),
                    details: None,
                }),
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        let late_chunk = registry.apply_session_update_with_guard(
            &mut guard,
            9,
            &SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "late assistant".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: None,
                message_id: Some("assistant-1".to_string()),
                parent_tool_use_id: None,
                session_id: Some("session-1".to_string()),
                produced_at_monotonic_ms: None,
            },
        );
        assert!(late_chunk.is_none());
    }

    #[test]
    fn skips_tool_call_update_after_terminal_turn_cancelled() {
        let registry = TranscriptProjectionRegistry::new();
        let mut guard = TerminalTurnGuard::default();
        let _ = registry.apply_session_update_with_guard(
            &mut guard,
            8,
            &SessionUpdate::TurnCancelled {
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        let late_update = registry.apply_session_update_with_guard(
            &mut guard,
            9,
            &SessionUpdate::ToolCallUpdate {
                update: crate::acp::session_update::ToolCallUpdateData {
                    tool_call_id: "tool-1".to_string(),
                    status: Some(ToolCallStatus::Completed),
                    result: None,
                    content: None,
                    raw_output: None,
                    title: None,
                    locations: None,
                    streaming_input_delta: None,
                    normalized_todos: None,
                    normalized_questions: None,
                    streaming_arguments: None,
                    streaming_plan: None,
                    arguments: None,
                    failure_reason: None,
                },
                session_id: Some("session-1".to_string()),
            },
        );
        assert!(late_update.is_none());
    }
}
