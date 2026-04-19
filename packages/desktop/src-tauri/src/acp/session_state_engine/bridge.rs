use crate::acp::session_open_snapshot::SessionOpenFound;
use crate::acp::session_state_engine::envelope::SessionStateEnvelope;
use crate::acp::session_state_engine::protocol::{SessionStateDelta, SessionStatePayload};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::snapshot_builder::build_graph_from_open_found;
use crate::acp::transcript_projection::TranscriptDelta;

pub fn build_snapshot_envelope(
    found: &SessionOpenFound,
    lifecycle: SessionGraphLifecycle,
    capabilities: SessionGraphCapabilities,
) -> SessionStateEnvelope {
    let graph = build_graph_from_open_found(found, lifecycle, capabilities);
    SessionStateEnvelope {
        session_id: graph.canonical_session_id.clone(),
        graph_revision: graph.revision.graph_revision,
        last_event_seq: graph.revision.last_event_seq,
        payload: SessionStatePayload::Snapshot { graph },
    }
}

pub fn build_delta_envelope(
    session_id: &str,
    from_revision: SessionGraphRevision,
    transcript_delta: TranscriptDelta,
    changed_fields: Vec<String>,
) -> SessionStateEnvelope {
    let to_revision = SessionGraphRevision::new(
        transcript_delta.snapshot_revision,
        transcript_delta.event_seq,
    );
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: to_revision.graph_revision,
        last_event_seq: to_revision.last_event_seq,
        payload: SessionStatePayload::Delta {
            delta: SessionStateDelta {
                from_revision,
                to_revision,
                transcript_delta: Some(transcript_delta),
                changed_fields,
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
        SessionGraphCapabilities, SessionGraphLifecycle,
    };
    use crate::acp::transcript_projection::{TranscriptDelta, TranscriptSnapshot};
    use crate::acp::types::CanonicalAgentId;

    use super::{build_delta_envelope, build_snapshot_envelope};

    #[test]
    fn bridge_builds_snapshot_envelope_from_open_found() {
        let found = SessionOpenFound {
            requested_session_id: "requested-1".to_string(),
            canonical_session_id: "canonical-1".to_string(),
            is_alias: false,
            last_event_seq: 11,
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
            active_turn_failure: None,
            last_terminal_turn_id: None,
        };

        let envelope = build_snapshot_envelope(
            &found,
            SessionGraphLifecycle::idle(),
            SessionGraphCapabilities::empty(),
        );

        assert_eq!(envelope.session_id, "canonical-1");
        assert_eq!(envelope.graph_revision, 3);
        match envelope.payload {
            SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.requested_session_id, "requested-1");
                assert_eq!(graph.revision.last_event_seq, 11);
            }
            _ => panic!("expected snapshot payload"),
        }
    }

    #[test]
    fn bridge_builds_delta_envelope_from_transcript_delta() {
        let envelope = build_delta_envelope(
            "canonical-1",
            SessionGraphRevision::new(3, 11),
            TranscriptDelta {
                event_seq: 12,
                session_id: "canonical-1".to_string(),
                snapshot_revision: 4,
                operations: Vec::new(),
            },
            vec!["transcriptSnapshot".to_string()],
        );

        assert_eq!(envelope.graph_revision, 4);
        assert_eq!(envelope.last_event_seq, 12);
        match envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.from_revision, SessionGraphRevision::new(3, 11));
                assert_eq!(delta.to_revision, SessionGraphRevision::new(4, 12));
            }
            _ => panic!("expected delta payload"),
        }
    }
}
