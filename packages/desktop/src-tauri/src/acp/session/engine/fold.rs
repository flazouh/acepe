//! Deterministic session graph fold — single truth builder for live and history.
//!
//! Phase 1: skeleton + transcript facts. Full operation/interaction merge follows.

use crate::acp::projections::SessionTurnState;
use crate::acp::session::engine::fold_lifecycle::apply_historical_close;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_projection::{
    assistant_boundary_entry_count_from_transcript_entries, turn_key_for_assistant_boundary,
    TranscriptEntry, TranscriptEntryRole, TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;
use std::collections::HashSet;

#[cfg(test)]
mod behavior_tests;
#[cfg(test)]
mod control_plane_tests;
mod event_application;

use event_application::{apply_event, apply_interaction_reply, refresh_graph_activity};

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

/// A history-folded graph together with the provider events already applied to it.
///
/// The live runtime must seed both pieces atomically so reconnect delivery of the
/// history frontier is recognized as replay instead of being appended twice.
#[derive(Debug, Clone)]
pub(crate) struct FoldedHistory {
    pub(crate) graph: SessionStateGraph,
    pub(crate) applied_fold_keys: HashSet<String>,
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
    fold_history_with_dedup_frontier(events, ctx).graph
}

/// Fold ordered history and retain the idempotency frontier for live reconnect.
#[must_use]
pub(crate) fn fold_history_with_dedup_frontier(
    events: &[ProviderEvent],
    ctx: &FoldContext,
) -> FoldedHistory {
    let mut graph = empty_graph(ctx);
    let mut turn_context = HistoryTurnContext::default();
    let mut applied_fold_keys = HashSet::with_capacity(events.len());
    for event in events {
        let previous_graph_revision = graph.revision.graph_revision;
        apply_event(&mut graph, &mut turn_context, event);
        advance_graph_frontier(&mut graph, previous_graph_revision, event);
        if let Some(key) = event.fold_dedup_key() {
            applied_fold_keys.insert(key);
        }
    }
    apply_historical_close(&mut graph);
    refresh_graph_activity(&mut graph);
    FoldedHistory {
        graph,
        applied_fold_keys,
    }
}

/// Fold one live event onto the previous graph.
#[must_use]
pub fn fold_step(
    prev: &SessionStateGraph,
    event: &ProviderEvent,
) -> (SessionStateGraph, GraphDelta) {
    fold_step_with_dedup(prev, event, &mut None)
}

/// Apply one user reply to an existing canonical interaction.
#[must_use]
pub(crate) fn fold_interaction_reply(
    prev: &SessionStateGraph,
    interaction_id: &str,
    state: crate::acp::projections::InteractionState,
    response: crate::acp::projections::InteractionResponse,
    event_seq: i64,
) -> Option<SessionStateGraph> {
    let mut graph = prev.clone();
    if !apply_interaction_reply(&mut graph, interaction_id, state, response, event_seq) {
        return None;
    }
    graph.revision.graph_revision = prev.revision.graph_revision.saturating_add(1);
    graph.revision.last_event_seq = prev.revision.last_event_seq.max(event_seq);
    graph.revision.transcript_revision = graph.transcript_snapshot.revision;
    Some(graph)
}

/// Fold one live event with optional idempotency keys (live replay only).
#[must_use]
pub fn fold_step_with_dedup(
    prev: &SessionStateGraph,
    event: &ProviderEvent,
    dedup_keys: &mut Option<std::collections::HashSet<String>>,
) -> (SessionStateGraph, GraphDelta) {
    if fold_event_is_duplicate(dedup_keys, event) {
        return (
            prev.clone(),
            GraphDelta {
                transcript_revision: prev.transcript_snapshot.revision,
            },
        );
    }

    let mut graph = prev.clone();
    let mut turn_context =
        HistoryTurnContext::from_transcript_entries(&graph.transcript_snapshot.entries);
    let mut delta = GraphDelta {
        transcript_revision: graph.transcript_snapshot.revision,
    };

    apply_event(&mut graph, &mut turn_context, event);
    advance_graph_frontier(&mut graph, prev.revision.graph_revision, event);
    record_fold_applied_key(dedup_keys, event);

    delta.transcript_revision = graph.transcript_snapshot.revision;
    (graph, delta)
}

fn advance_graph_frontier(
    graph: &mut SessionStateGraph,
    previous_graph_revision: i64,
    event: &ProviderEvent,
) {
    graph.revision.graph_revision = previous_graph_revision.saturating_add(1);
    let event_seq = i64::try_from(event.provider_seq).unwrap_or(i64::MAX);
    graph.revision.last_event_seq = graph.revision.last_event_seq.max(event_seq);
    graph.revision.transcript_revision = graph.transcript_snapshot.revision;
}

fn fold_event_is_duplicate(
    dedup_keys: &Option<std::collections::HashSet<String>>,
    event: &ProviderEvent,
) -> bool {
    let Some(key) = event.fold_dedup_key() else {
        return false;
    };
    dedup_keys.as_ref().is_some_and(|keys| keys.contains(&key))
}

fn record_fold_applied_key(
    dedup_keys: &mut Option<std::collections::HashSet<String>>,
    event: &ProviderEvent,
) {
    if let Some(keys) = dedup_keys {
        if let Some(key) = event.fold_dedup_key() {
            keys.insert(key);
        }
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
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session_update::CurrentModeData;
    use crate::acp::transcript_projection::TranscriptSegment;

    fn provider_event(provider_seq: u64, kind: ProviderEventKind) -> ProviderEvent {
        ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq,
            provider_row_id: format!("row-{provider_seq}"),
            timestamp_ms: None,
            kind,
        }
    }

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
                attempt_id: None,
            },
        }];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        assert_eq!(graph.message_count, 1);
    }

    #[test]
    fn fold_owns_separate_graph_transcript_and_event_frontiers() {
        let ctx = FoldContext::new("sess-frontiers", CanonicalAgentId::Cursor, "/tmp");
        let history = vec![
            provider_event(
                4,
                ProviderEventKind::UserText {
                    text: "hello".to_string(),
                    attempt_id: None,
                },
            ),
            provider_event(
                7,
                ProviderEventKind::ModeUpdate(CurrentModeData {
                    current_mode_id: "plan".to_string(),
                }),
            ),
        ];

        let graph = fold_full(&history, &ctx);
        assert_eq!(graph.revision.graph_revision, 2);
        assert_eq!(graph.revision.transcript_revision, 1);
        assert_eq!(graph.revision.last_event_seq, 7);

        let (after, _) = fold_step(
            &graph,
            &provider_event(
                9,
                ProviderEventKind::AssistantText {
                    text: "world".to_string(),
                },
            ),
        );
        assert_eq!(after.revision.graph_revision, 3);
        assert_eq!(after.revision.transcript_revision, 2);
        assert_eq!(after.revision.last_event_seq, 9);
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
                attempt_id: None,
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
                    attempt_id: None,
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
                segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:1"
                    .to_string(),
                text: "part one".to_string(),
            }
        );
        assert_eq!(
            assistant.segments[1],
            TranscriptSegment::Text {
                segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:2"
                    .to_string(),
                text: "part two".to_string(),
            }
        );
        assert_eq!(
            assistant.segments[2],
            TranscriptSegment::Text {
                segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:3"
                    .to_string(),
                text: "part three".to_string(),
            }
        );
    }
}
