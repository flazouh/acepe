//! Persisted-region equality oracle for live ≡ history graph comparison.
//!
//! The persisted region is the subset of [`SessionStateGraph`] that must match
//! between live replay and history open. Live-only fields (lifecycle, activity,
//! capabilities, streaming tail, revision, session metadata) are excluded.

use crate::acp::projections::{
    InteractionSnapshot, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::transcript_projection::TranscriptSnapshot;
use serde::{Deserialize, Serialize};

/// Equality-oracle subset of [`SessionStateGraph`]: persisted transcript and turn facts only.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionGraph {
    /// Transcript entries with revision normalized to zero for equality checks.
    pub transcript_snapshot: TranscriptSnapshot,
    pub operations: Vec<OperationSnapshot>,
    pub interactions: Vec<InteractionSnapshot>,
    pub turn_state: SessionTurnState,
    pub message_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_terminal_turn_id: Option<String>,
}

/// Extract the persisted region from a full session graph, stripping live-only state.
#[must_use]
pub fn extract_persisted_region(graph: &SessionStateGraph) -> PersistedSessionGraph {
    PersistedSessionGraph {
        transcript_snapshot: TranscriptSnapshot {
            revision: 0,
            entries: graph.transcript_snapshot.entries.clone(),
        },
        operations: graph.operations.clone(),
        interactions: graph.interactions.clone(),
        turn_state: graph.turn_state.clone(),
        message_count: graph.message_count,
        active_turn_failure: graph.active_turn_failure.clone(),
        last_terminal_turn_id: graph.last_terminal_turn_id.clone(),
    }
}

fn serialized_slices_equal<T: Serialize>(left: &[T], right: &[T]) -> bool {
    match (serde_json::to_string(left), serde_json::to_string(right)) {
        (Ok(left_json), Ok(right_json)) => left_json == right_json,
        _ => false,
    }
}

/// Compare two persisted regions for equality.
///
/// Transcript revision is ignored; only entries are compared. Emits debug logs on mismatch.
#[must_use]
pub fn persisted_regions_equal(a: &PersistedSessionGraph, b: &PersistedSessionGraph) -> bool {
    if a.transcript_snapshot.entries != b.transcript_snapshot.entries {
        tracing::debug!(
            left_entry_count = a.transcript_snapshot.entries.len(),
            right_entry_count = b.transcript_snapshot.entries.len(),
            "persisted region mismatch: transcript entries"
        );
        return false;
    }

    if !serialized_slices_equal(&a.operations, &b.operations) {
        tracing::debug!(
            left_operation_count = a.operations.len(),
            right_operation_count = b.operations.len(),
            "persisted region mismatch: operations"
        );
        return false;
    }

    if !serialized_slices_equal(&a.interactions, &b.interactions) {
        tracing::debug!(
            left_interaction_count = a.interactions.len(),
            right_interaction_count = b.interactions.len(),
            "persisted region mismatch: interactions"
        );
        return false;
    }

    if a.turn_state != b.turn_state {
        tracing::debug!(
            left = ?a.turn_state,
            right = ?b.turn_state,
            "persisted region mismatch: turn_state"
        );
        return false;
    }

    if a.message_count != b.message_count {
        tracing::debug!(
            left = a.message_count,
            right = b.message_count,
            "persisted region mismatch: message_count"
        );
        return false;
    }

    if a.active_turn_failure != b.active_turn_failure {
        tracing::debug!(
            left = ?a.active_turn_failure,
            right = ?b.active_turn_failure,
            "persisted region mismatch: active_turn_failure"
        );
        return false;
    }

    if a.last_terminal_turn_id != b.last_terminal_turn_id {
        tracing::debug!(
            left = ?a.last_terminal_turn_id,
            right = ?b.last_terminal_turn_id,
            "persisted region mismatch: last_terminal_turn_id"
        );
        return false;
    }

    true
}

#[cfg(test)]
mod tests {
    use super::{extract_persisted_region, persisted_regions_equal, PersistedSessionGraph};
    use crate::acp::projections::{SessionTurnState, TurnFailureSnapshot};
    use crate::acp::session_state_engine::graph::{
        ActiveStreamingTail, ActiveStreamingTailContentKind, SessionStateGraph,
    };
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphActivityKind, SessionGraphCapabilities,
        SessionGraphLifecycle,
    };
    use crate::acp::session_update::{TurnErrorKind, TurnErrorSource};
    use crate::acp::transcript_projection::{
        TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
    };
    use crate::acp::types::CanonicalAgentId;

    fn text_entry(entry_id: &str, role: TranscriptEntryRole, text: &str) -> TranscriptEntry {
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

    fn base_graph() -> SessionStateGraph {
        SessionStateGraph {
            requested_session_id: "requested-1".to_string(),
            canonical_session_id: "canonical-1".to_string(),
            is_alias: false,
            agent_id: CanonicalAgentId::Cursor,
            project_path: "/workspace/a".to_string(),
            worktree_path: None,
            source_path: None,
            sequence_id: None,
            revision: SessionGraphRevision::new(1, 1, 1),
            transcript_snapshot: TranscriptSnapshot {
                revision: 42,
                entries: vec![text_entry(
                    "assistant-1",
                    TranscriptEntryRole::Assistant,
                    "hello",
                )],
            },
            operations: Vec::new(),
            interactions: Vec::new(),
            turn_state: SessionTurnState::Idle,
            message_count: 1,
            active_streaming_tail: None,
            active_turn_failure: None,
            last_terminal_turn_id: None,
            lifecycle: SessionGraphLifecycle::idle(),
            activity: SessionGraphActivity::idle(),
            capabilities: SessionGraphCapabilities::empty(),
        }
    }

    fn graph_with_live_only_differences() -> SessionStateGraph {
        let mut graph = base_graph();
        graph.requested_session_id = "other-requested".to_string();
        graph.canonical_session_id = "other-canonical".to_string();
        graph.is_alias = true;
        graph.agent_id = CanonicalAgentId::ClaudeCode;
        graph.project_path = "/other/path".to_string();
        graph.worktree_path = Some("/other/worktree".to_string());
        graph.source_path = Some("/other/source".to_string());
        graph.sequence_id = Some(99);
        graph.revision = SessionGraphRevision::new(999, 888, 777);
        graph.transcript_snapshot.revision = 555;
        graph.active_streaming_tail = Some(ActiveStreamingTail {
            row_id: "assistant-1".to_string(),
            content_kind: ActiveStreamingTailContentKind::Message,
        });
        graph.lifecycle = SessionGraphLifecycle::ready();
        graph.activity = SessionGraphActivity {
            kind: SessionGraphActivityKind::RunningOperation,
            active_operation_count: 2,
            active_subagent_count: 1,
            dominant_operation_id: Some("op-1".to_string()),
            blocking_interaction_id: None,
            kind_started_at_ms: Some(1_700_000_000_000),
        };
        let mut capabilities = SessionGraphCapabilities::empty();
        capabilities.autonomous_enabled = Some(true);
        graph.capabilities = capabilities;
        graph
    }

    #[test]
    fn extract_normalizes_transcript_revision_to_zero() {
        let graph = base_graph();
        let persisted = extract_persisted_region(&graph);

        assert_eq!(persisted.transcript_snapshot.revision, 0);
        assert_eq!(
            persisted.transcript_snapshot.entries,
            graph.transcript_snapshot.entries
        );
    }

    #[test]
    fn extract_copies_persisted_fields() {
        let mut graph = base_graph();
        graph.turn_state = SessionTurnState::Completed;
        graph.message_count = 7;
        graph.last_terminal_turn_id = Some("turn-3".to_string());
        graph.active_turn_failure = Some(TurnFailureSnapshot {
            turn_id: Some("turn-2".to_string()),
            message: "boom".to_string(),
            code: Some("500".to_string()),
            details: None,
            kind: TurnErrorKind::Recoverable,
            source: TurnErrorSource::Process,
        });

        let persisted = extract_persisted_region(&graph);

        assert_eq!(persisted.turn_state, SessionTurnState::Completed);
        assert_eq!(persisted.message_count, 7);
        assert_eq!(persisted.last_terminal_turn_id.as_deref(), Some("turn-3"));
        assert_eq!(persisted.active_turn_failure, graph.active_turn_failure);
    }

    #[test]
    fn persisted_regions_equal_ignores_live_only_differences() {
        let live = base_graph();
        let history = graph_with_live_only_differences();

        let live_persisted = extract_persisted_region(&live);
        let history_persisted = extract_persisted_region(&history);

        assert!(persisted_regions_equal(&live_persisted, &history_persisted));
    }

    #[test]
    fn persisted_regions_equal_false_when_transcript_entries_differ() {
        let graph_a = base_graph();
        let mut graph_b = base_graph();
        graph_b.transcript_snapshot.entries.push(text_entry(
            "user-2",
            TranscriptEntryRole::User,
            "follow-up",
        ));

        let a = extract_persisted_region(&graph_a);
        let b = extract_persisted_region(&graph_b);

        assert!(!persisted_regions_equal(&a, &b));
    }

    #[test]
    fn persisted_regions_equal_false_when_turn_state_differs() {
        let graph_a = base_graph();
        let mut graph_b = base_graph();
        graph_b.turn_state = SessionTurnState::Running;

        let a = extract_persisted_region(&graph_a);
        let b = extract_persisted_region(&graph_b);

        assert!(!persisted_regions_equal(&a, &b));
    }

    #[test]
    fn persisted_regions_equal_false_when_message_count_differs() {
        let graph_a = base_graph();
        let mut graph_b = base_graph();
        graph_b.message_count = 99;

        let a = extract_persisted_region(&graph_a);
        let b = extract_persisted_region(&graph_b);

        assert!(!persisted_regions_equal(&a, &b));
    }

    #[test]
    fn persisted_regions_equal_matches_manual_clone() {
        let graph = base_graph();
        let persisted = extract_persisted_region(&graph);
        let clone = PersistedSessionGraph {
            transcript_snapshot: TranscriptSnapshot {
                revision: 0,
                entries: graph.transcript_snapshot.entries.clone(),
            },
            operations: graph.operations.clone(),
            interactions: graph.interactions.clone(),
            turn_state: graph.turn_state.clone(),
            message_count: graph.message_count,
            active_turn_failure: graph.active_turn_failure.clone(),
            last_terminal_turn_id: graph.last_terminal_turn_id.clone(),
        };

        assert!(persisted_regions_equal(&persisted, &clone));
    }
}
