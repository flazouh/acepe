//! Deterministic session graph fold — single truth builder for live and history.
//!
//! Phase 1: skeleton + transcript facts. Full operation/interaction merge follows.

use crate::acp::projections::SessionTurnState;
use crate::acp::session::engine::fold_lifecycle::{apply_historical_close, apply_turn_end};
use crate::acp::session::engine::fold_operations::{apply_tool_call, apply_tool_call_update};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_projection::snapshot::user_transcript_segment_from_text;
use crate::acp::transcript_projection::{
    assistant_boundary_entry_count_from_transcript_entries, derive_entry_id_for_snapshot_role,
    turn_key_for_assistant_boundary, TranscriptEntry, TranscriptEntryRole, TranscriptSegment,
    TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;

/// Context supplied to the fold (session identity, not live lifecycle).
#[derive(Debug, Clone)]
pub struct FoldContext {
    pub session_id: String,
    pub agent_id: CanonicalAgentId,
    pub project_path: String,
}

impl FoldContext {
    pub fn new(
        session_id: impl Into<String>,
        agent_id: CanonicalAgentId,
        project_path: impl Into<String>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            agent_id,
            project_path: project_path.into(),
        }
    }
}

/// Delta emitted by a single live fold step (Phase 1 stub).
#[derive(Debug, Clone, Default)]
pub struct GraphDelta {
    pub transcript_revision: i64,
}

#[derive(Debug, Clone, Default)]
struct HistoryTurnContext {
    assistant_boundary_entry_count: usize,
}

impl HistoryTurnContext {
    fn from_transcript_entries(entries: &[TranscriptEntry]) -> Self {
        Self {
            assistant_boundary_entry_count: assistant_boundary_entry_count_from_transcript_entries(
                entries,
            ),
        }
    }

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

/// Fold a full ordered event stream into a session graph (history open path).
#[must_use]
pub fn fold_full(events: &[ProviderEvent], ctx: &FoldContext) -> SessionStateGraph {
    let mut graph = empty_graph(ctx);
    let mut turn_context = HistoryTurnContext::default();
    for event in events {
        apply_event(&mut graph, &mut turn_context, event);
    }
    apply_historical_close(&mut graph);
    graph
}

/// Fold one live event onto the previous graph.
#[must_use]
pub fn fold_step(
    prev: &SessionStateGraph,
    event: &ProviderEvent,
) -> (SessionStateGraph, GraphDelta) {
    let mut graph = prev.clone();
    let mut turn_context =
        HistoryTurnContext::from_transcript_entries(&graph.transcript_snapshot.entries);
    let mut delta = GraphDelta {
        transcript_revision: graph.transcript_snapshot.revision,
    };

    apply_event(&mut graph, &mut turn_context, event);

    delta.transcript_revision = graph.transcript_snapshot.revision;
    (graph, delta)
}

fn apply_event(
    graph: &mut SessionStateGraph,
    turn_context: &mut HistoryTurnContext,
    event: &ProviderEvent,
) {
    match &event.kind {
        ProviderEventKind::UserText { text } => {
            if !text.is_empty() {
                let turn_key = turn_context.current_turn_key();
                let entry_id =
                    derive_entry_id_for_snapshot_role(&turn_key, &TranscriptEntryRole::User, None);
                let segment_id = format!("{turn_key}:event:{}", event.provider_seq);
                append_transcript_entry(
                    graph,
                    turn_context,
                    event,
                    TranscriptEntry {
                        entry_id,
                        role: TranscriptEntryRole::User,
                        segments: vec![user_transcript_segment_from_text(segment_id, text.clone())],
                        attempt_id: None,
                        timestamp_ms: event.timestamp_ms,
                    },
                );
            }
        }
        ProviderEventKind::UserPastedContent { text } => {
            if !text.is_empty() {
                let turn_key = turn_context.current_turn_key();
                let entry_id =
                    derive_entry_id_for_snapshot_role(&turn_key, &TranscriptEntryRole::User, None);
                append_transcript_entry(
                    graph,
                    turn_context,
                    event,
                    TranscriptEntry {
                        entry_id,
                        role: TranscriptEntryRole::User,
                        segments: vec![TranscriptSegment::PastedContent {
                            segment_id: format!("{turn_key}:event:{}", event.provider_seq),
                            text: text.clone(),
                        }],
                        attempt_id: None,
                        timestamp_ms: event.timestamp_ms,
                    },
                );
            }
        }
        ProviderEventKind::AssistantText { text } => {
            if !text.is_empty() {
                let turn_key = turn_context.current_turn_key();
                let entry_id = derive_entry_id_for_snapshot_role(
                    &turn_key,
                    &TranscriptEntryRole::Assistant,
                    None,
                );
                append_transcript_entry(
                    graph,
                    turn_context,
                    event,
                    TranscriptEntry {
                        entry_id,
                        role: TranscriptEntryRole::Assistant,
                        segments: vec![TranscriptSegment::Text {
                            segment_id: format!("{turn_key}:event:{}", event.provider_seq),
                            text: text.clone(),
                        }],
                        attempt_id: None,
                        timestamp_ms: event.timestamp_ms,
                    },
                );
            }
        }
        ProviderEventKind::AssistantThought { text, redacted } => {
            if !text.is_empty() || redacted.is_some() {
                let turn_key = turn_context.current_turn_key();
                let entry_id = derive_entry_id_for_snapshot_role(
                    &turn_key,
                    &TranscriptEntryRole::Assistant,
                    None,
                );
                append_transcript_entry(
                    graph,
                    turn_context,
                    event,
                    TranscriptEntry {
                        entry_id,
                        role: TranscriptEntryRole::Assistant,
                        segments: vec![TranscriptSegment::Thought {
                            segment_id: format!("{turn_key}:event:{}", event.provider_seq),
                            text: thought_text_for_display(text, redacted.as_deref()),
                        }],
                        attempt_id: None,
                        timestamp_ms: event.timestamp_ms,
                    },
                );
            }
        }
        ProviderEventKind::ToolCall(tool_call) => {
            apply_tool_call(graph, event, tool_call);
            turn_context.note_entry(
                &TranscriptEntryRole::Tool,
                graph.transcript_snapshot.entries.len(),
            );
        }
        ProviderEventKind::ToolCallUpdate(update) => {
            apply_tool_call_update(graph, update);
        }
        ProviderEventKind::TurnEnd { outcome } => {
            apply_turn_end(graph, *outcome);
        }
        _ => {}
    }
}

fn empty_graph(ctx: &FoldContext) -> SessionStateGraph {
    SessionStateGraph {
        requested_session_id: ctx.session_id.clone(),
        canonical_session_id: ctx.session_id.clone(),
        is_alias: false,
        agent_id: ctx.agent_id.clone(),
        project_path: ctx.project_path.clone(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        revision: SessionGraphRevision::new(0, 0, 0),
        transcript_snapshot: TranscriptSnapshot {
            revision: 0,
            entries: Vec::new(),
        },
        operations: Vec::new(),
        interactions: Vec::new(),
        turn_state: SessionTurnState::Idle,
        message_count: 0,
        active_streaming_tail: None,
        active_turn_failure: None,
        last_terminal_turn_id: None,
        lifecycle: SessionGraphLifecycle::idle(),
        activity: SessionGraphActivity::idle(),
        capabilities: SessionGraphCapabilities::empty(),
    }
}

fn append_transcript_entry(
    graph: &mut SessionStateGraph,
    turn_context: &mut HistoryTurnContext,
    _event: &ProviderEvent,
    entry: TranscriptEntry,
) {
    graph.transcript_snapshot.revision += 1;
    let role = entry.role.clone();
    append_or_merge_entry(&mut graph.transcript_snapshot.entries, entry);
    turn_context.note_entry(&role, graph.transcript_snapshot.entries.len());
    graph.message_count += 1;
    graph.revision.transcript_revision = graph.transcript_snapshot.revision;
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

fn thought_text_for_display(text: &str, redacted_provider_data: Option<&str>) -> String {
    match redacted_provider_data {
        Some(_) if text.trim().is_empty() => "[REDACTED]".to_string(),
        _ => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_full_user_text_produces_transcript_entry() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let events = vec![ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq: 1,
            provider_row_id: "user-1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::UserText {
                text: "hi".to_string(),
            },
        }];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        assert_eq!(graph.message_count, 1);
    }

    #[test]
    fn fold_user_text_entry_id_matches_display_id_authority() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let events = vec![ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq: 1,
            provider_row_id: "user-1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::UserText {
                text: "hi".to_string(),
            },
        }];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        assert_eq!(
            graph.transcript_snapshot.entries[0].entry_id,
            "acepe::entry::session-start::user::."
        );
    }

    #[test]
    fn fold_merges_consecutive_assistant_text_into_one_entry() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let events = vec![
            ProviderEvent {
                source: CanonicalAgentId::Cursor,
                provider_seq: 0,
                provider_row_id: "user-0".to_string(),
                timestamp_ms: None,
                kind: ProviderEventKind::UserText {
                    text: "hello".to_string(),
                },
            },
            ProviderEvent {
                source: CanonicalAgentId::Cursor,
                provider_seq: 1,
                provider_row_id: "asst-1".to_string(),
                timestamp_ms: None,
                kind: ProviderEventKind::AssistantText {
                    text: "part one".to_string(),
                },
            },
            ProviderEvent {
                source: CanonicalAgentId::Cursor,
                provider_seq: 2,
                provider_row_id: "asst-2".to_string(),
                timestamp_ms: None,
                kind: ProviderEventKind::AssistantText {
                    text: "part two".to_string(),
                },
            },
            ProviderEvent {
                source: CanonicalAgentId::Cursor,
                provider_seq: 3,
                provider_row_id: "asst-3".to_string(),
                timestamp_ms: None,
                kind: ProviderEventKind::AssistantText {
                    text: "part three".to_string(),
                },
            },
        ];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.transcript_snapshot.entries.len(), 2);
        assert_eq!(graph.message_count, 4);

        let assistant = &graph.transcript_snapshot.entries[1];
        assert_eq!(assistant.role, TranscriptEntryRole::Assistant);
        assert_eq!(assistant.segments.len(), 3);
        assert_eq!(
            assistant.segments[0],
            TranscriptSegment::Text {
                segment_id: "assistant-boundary:1:event:1".to_string(),
                text: "part one".to_string(),
            }
        );
        assert_eq!(
            assistant.segments[1],
            TranscriptSegment::Text {
                segment_id: "assistant-boundary:1:event:2".to_string(),
                text: "part two".to_string(),
            }
        );
        assert_eq!(
            assistant.segments[2],
            TranscriptSegment::Text {
                segment_id: "assistant-boundary:1:event:3".to_string(),
                text: "part three".to_string(),
            }
        );
    }
}
