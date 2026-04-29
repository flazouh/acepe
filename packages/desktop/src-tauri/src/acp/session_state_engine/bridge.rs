use crate::acp::session_open_snapshot::SessionOpenFound;
use crate::acp::session_state_engine::envelope::SessionStateEnvelope;
use crate::acp::session_state_engine::protocol::{SessionStateDelta, SessionStatePayload};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::SessionGraphActivity;
use crate::acp::session_state_engine::snapshot_builder::build_graph_from_open_found;
use crate::acp::transcript_projection::TranscriptDeltaOperation;

pub struct DeltaSessionProjectionFields {
    pub activity: SessionGraphActivity,
    pub turn_state: crate::acp::projections::SessionTurnState,
    pub active_turn_failure: Option<crate::acp::projections::TurnFailureSnapshot>,
    pub last_terminal_turn_id: Option<String>,
}

pub struct DeltaEnvelopeParts<'a> {
    pub session_id: &'a str,
    pub from_revision: SessionGraphRevision,
    pub to_revision: SessionGraphRevision,
    pub projection: DeltaSessionProjectionFields,
    pub transcript_operations: Vec<TranscriptDeltaOperation>,
    pub operation_patches: Vec<crate::acp::projections::OperationSnapshot>,
    pub interaction_patches: Vec<crate::acp::projections::InteractionSnapshot>,
    pub changed_fields: Vec<String>,
}

pub fn build_snapshot_envelope(found: &SessionOpenFound) -> SessionStateEnvelope {
    let graph = build_graph_from_open_found(found);
    SessionStateEnvelope {
        session_id: graph.canonical_session_id.clone(),
        graph_revision: graph.revision.graph_revision,
        last_event_seq: graph.revision.last_event_seq,
        payload: SessionStatePayload::Snapshot {
            graph: Box::new(graph),
        },
    }
}

pub fn build_delta_envelope(parts: DeltaEnvelopeParts<'_>) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: parts.session_id.to_string(),
        graph_revision: parts.to_revision.graph_revision,
        last_event_seq: parts.to_revision.last_event_seq,
        payload: SessionStatePayload::Delta {
            delta: SessionStateDelta {
                from_revision: parts.from_revision,
                to_revision: parts.to_revision,
                activity: parts.projection.activity,
                turn_state: parts.projection.turn_state,
                active_turn_failure: parts.projection.active_turn_failure,
                last_terminal_turn_id: parts.projection.last_terminal_turn_id,
                transcript_operations: parts.transcript_operations,
                operation_patches: parts.operation_patches,
                interaction_patches: parts.interaction_patches,
                changed_fields: parts.changed_fields,
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_open_snapshot::SessionOpenFound;
    use crate::acp::session_state_engine::protocol::SessionStatePayload;
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
    };
    use crate::acp::transcript_projection::{TranscriptDeltaOperation, TranscriptSnapshot};
    use crate::acp::types::CanonicalAgentId;

    use super::{
        build_delta_envelope, build_snapshot_envelope, DeltaEnvelopeParts,
        DeltaSessionProjectionFields,
    };

    #[test]
    fn bridge_builds_snapshot_envelope_from_open_found() {
        let found = SessionOpenFound {
            requested_session_id: "requested-1".to_string(),
            canonical_session_id: "canonical-1".to_string(),
            is_alias: false,
            last_event_seq: 11,
            graph_revision: 9,
            open_token: "open-token-1".to_string(),
            agent_id: CanonicalAgentId::Cursor,
            project_path: "/workspace/a".to_string(),
            worktree_path: None,
            source_path: None,
            transcript_snapshot: TranscriptSnapshot {
                revision: 3,
                entries: Vec::new(),
            },
            session_title: "Session 1".to_string(),
            operations: Vec::new(),
            interactions: Vec::new(),
            turn_state: SessionTurnState::Idle,
            message_count: 0,
            lifecycle: SessionGraphLifecycle::idle(),
            capabilities: SessionGraphCapabilities::empty(),
            active_turn_failure: None,
            last_terminal_turn_id: None,
        };

        let envelope = build_snapshot_envelope(&found);

        assert_eq!(envelope.session_id, "canonical-1");
        assert_eq!(envelope.graph_revision, 9);
        match envelope.payload {
            SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.requested_session_id, "requested-1");
                assert_eq!(graph.revision.graph_revision, 9);
                assert_eq!(graph.revision.last_event_seq, 11);
            }
            _ => panic!("expected snapshot payload"),
        }
    }

    #[test]
    fn bridge_builds_delta_envelope_from_transcript_operations() {
        let envelope = build_delta_envelope(DeltaEnvelopeParts {
            session_id: "canonical-1",
            from_revision: SessionGraphRevision::new(11, 3, 11),
            to_revision: SessionGraphRevision::new(12, 4, 12),
            projection: DeltaSessionProjectionFields {
                activity: SessionGraphActivity::idle(),
                turn_state: SessionTurnState::Idle,
                active_turn_failure: None,
                last_terminal_turn_id: None,
            },
            transcript_operations: vec![TranscriptDeltaOperation::ReplaceSnapshot {
                snapshot: TranscriptSnapshot {
                    revision: 4,
                    entries: Vec::new(),
                },
            }],
            operation_patches: Vec::new(),
            interaction_patches: Vec::new(),
            changed_fields: vec!["transcriptSnapshot".to_string()],
        });

        assert_eq!(envelope.graph_revision, 12);
        assert_eq!(envelope.last_event_seq, 12);
        match envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.from_revision, SessionGraphRevision::new(11, 3, 11));
                assert_eq!(delta.to_revision, SessionGraphRevision::new(12, 4, 12));
                assert_eq!(delta.transcript_operations.len(), 1);
            }
            _ => panic!("expected delta payload"),
        }
    }
}
