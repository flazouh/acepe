use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::protocol::SessionStateDelta;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_projection::{
    TranscriptDeltaOperation, TranscriptEntry, TranscriptSnapshot,
};

pub enum SessionStateGraphMutation {
    ReplaceSnapshot {
        graph: Box<SessionStateGraph>,
    },
    ApplyDelta {
        delta: SessionStateDelta,
    },
    UpdateLifecycle {
        lifecycle: SessionGraphLifecycle,
        revision: SessionGraphRevision,
    },
    UpdateCapabilities {
        capabilities: Box<SessionGraphCapabilities>,
        revision: SessionGraphRevision,
    },
}

pub struct SessionStateReducer;

impl SessionStateReducer {
    pub fn apply(graph: &mut SessionStateGraph, mutation: SessionStateGraphMutation) {
        match mutation {
            SessionStateGraphMutation::ReplaceSnapshot {
                graph: replacement_graph,
            } => {
                *graph = *replacement_graph;
            }
            SessionStateGraphMutation::ApplyDelta { delta } => {
                if !delta.transcript_operations.is_empty() {
                    apply_transcript_delta(
                        &mut graph.transcript_snapshot,
                        delta.transcript_operations.as_slice(),
                        delta.to_revision.graph_revision,
                    );
                }
                graph.revision = delta.to_revision;
            }
            SessionStateGraphMutation::UpdateLifecycle {
                lifecycle,
                revision,
            } => {
                graph.lifecycle = lifecycle;
                graph.revision = revision;
            }
            SessionStateGraphMutation::UpdateCapabilities {
                capabilities,
                revision,
            } => {
                graph.capabilities = *capabilities;
                graph.revision = revision;
            }
        }
    }
}

fn apply_transcript_delta(
    snapshot: &mut TranscriptSnapshot,
    operations: &[TranscriptDeltaOperation],
    revision: i64,
) {
    for operation in operations {
        match operation {
            TranscriptDeltaOperation::AppendEntry { entry } => {
                snapshot.entries.push(entry.clone());
            }
            TranscriptDeltaOperation::AppendSegment {
                entry_id,
                role,
                segment,
            } => {
                if let Some(existing_entry) = snapshot
                    .entries
                    .iter_mut()
                    .find(|entry| entry.entry_id == *entry_id)
                {
                    existing_entry.segments.push(segment.clone());
                } else {
                    snapshot.entries.push(TranscriptEntry {
                        entry_id: entry_id.clone(),
                        role: role.clone(),
                        segments: vec![segment.clone()],
                    });
                }
            }
            TranscriptDeltaOperation::ReplaceSnapshot {
                snapshot: replacement_snapshot,
            } => {
                *snapshot = replacement_snapshot.clone();
            }
        }
    }

    snapshot.revision = revision;
}

#[cfg(test)]
mod tests {
    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_state_engine::graph::SessionStateGraph;
    use crate::acp::session_state_engine::protocol::SessionStateDelta;
    use crate::acp::session_state_engine::reducer::{
        SessionStateGraphMutation, SessionStateReducer,
    };
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphCapabilities, SessionGraphLifecycle,
    };
    use crate::acp::transcript_projection::{
        TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole, TranscriptSegment,
        TranscriptSnapshot,
    };
    use crate::acp::types::CanonicalAgentId;

    fn base_graph() -> SessionStateGraph {
        SessionStateGraph {
            requested_session_id: "requested-1".to_string(),
            canonical_session_id: "canonical-1".to_string(),
            is_alias: false,
            agent_id: CanonicalAgentId::Cursor,
            project_path: "/workspace/a".to_string(),
            worktree_path: None,
            source_path: None,
            revision: SessionGraphRevision::new(1, 1, 1),
            transcript_snapshot: TranscriptSnapshot {
                revision: 1,
                entries: vec![TranscriptEntry {
                    entry_id: "assistant-1".to_string(),
                    role: TranscriptEntryRole::Assistant,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: "assistant-1:segment:1".to_string(),
                        text: "hello".to_string(),
                    }],
                }],
            },
            operations: Vec::new(),
            interactions: Vec::new(),
            turn_state: SessionTurnState::Idle,
            message_count: 1,
            active_turn_failure: None,
            last_terminal_turn_id: None,
            lifecycle: SessionGraphLifecycle::idle(),
            capabilities: SessionGraphCapabilities::empty(),
        }
    }

    #[test]
    fn reducer_applies_append_segment_delta_to_existing_entry() {
        let mut graph = base_graph();
        let delta = SessionStateDelta {
            from_revision: SessionGraphRevision::new(1, 1, 1),
            to_revision: SessionGraphRevision::new(2, 2, 2),
            transcript_operations: vec![TranscriptDeltaOperation::AppendSegment {
                entry_id: "assistant-1".to_string(),
                role: TranscriptEntryRole::Assistant,
                segment: TranscriptSegment::Text {
                    segment_id: "assistant-1:segment:2".to_string(),
                    text: " world".to_string(),
                },
            }],
            changed_fields: vec!["transcriptSnapshot".to_string()],
        };

        SessionStateReducer::apply(&mut graph, SessionStateGraphMutation::ApplyDelta { delta });

        assert_eq!(graph.revision, SessionGraphRevision::new(2, 2, 2));
        assert_eq!(graph.transcript_snapshot.revision, 2);
        assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        assert_eq!(graph.transcript_snapshot.entries[0].segments.len(), 2);
    }

    #[test]
    fn reducer_replaces_snapshot_when_delta_requests_full_reset() {
        let mut graph = base_graph();
        let replacement_snapshot = TranscriptSnapshot {
            revision: 5,
            entries: vec![TranscriptEntry {
                entry_id: "user-2".to_string(),
                role: TranscriptEntryRole::User,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "user-2:block:0".to_string(),
                    text: "fresh".to_string(),
                }],
            }],
        };
        let delta = SessionStateDelta {
            from_revision: SessionGraphRevision::new(1, 1, 1),
            to_revision: SessionGraphRevision::new(5, 5, 5),
            transcript_operations: vec![TranscriptDeltaOperation::ReplaceSnapshot {
                snapshot: replacement_snapshot.clone(),
            }],
            changed_fields: vec!["transcriptSnapshot".to_string()],
        };

        SessionStateReducer::apply(&mut graph, SessionStateGraphMutation::ApplyDelta { delta });

        assert_eq!(graph.transcript_snapshot, replacement_snapshot);
        assert_eq!(graph.revision, SessionGraphRevision::new(5, 5, 5));
    }
}
