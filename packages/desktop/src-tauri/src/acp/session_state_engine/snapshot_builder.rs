use crate::acp::session_open_snapshot::SessionOpenFound;
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};

pub fn build_graph_from_open_found(
    found: &SessionOpenFound,
    lifecycle: SessionGraphLifecycle,
    capabilities: SessionGraphCapabilities,
) -> SessionStateGraph {
    SessionStateGraph {
        requested_session_id: found.requested_session_id.clone(),
        canonical_session_id: found.canonical_session_id.clone(),
        is_alias: found.is_alias,
        agent_id: found.agent_id.clone(),
        project_path: found.project_path.clone(),
        worktree_path: found.worktree_path.clone(),
        source_path: found.source_path.clone(),
        revision: SessionGraphRevision::new(
            found.graph_revision,
            found.transcript_snapshot.revision,
            found.last_event_seq,
        ),
        transcript_snapshot: found.transcript_snapshot.clone(),
        operations: found.operations.clone(),
        interactions: found.interactions.clone(),
        turn_state: found.turn_state.clone(),
        message_count: found.message_count,
        active_turn_failure: found.active_turn_failure.clone(),
        last_terminal_turn_id: found.last_terminal_turn_id.clone(),
        lifecycle,
        capabilities,
    }
}

#[cfg(test)]
mod tests {
    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_open_snapshot::SessionOpenFound;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphCapabilities, SessionGraphLifecycle,
    };
    use crate::acp::transcript_projection::TranscriptSnapshot;
    use crate::acp::types::CanonicalAgentId;

    use super::build_graph_from_open_found;

    #[test]
    fn snapshot_builder_maps_open_found_into_graph_contract() {
        let found = SessionOpenFound {
            requested_session_id: "requested-1".to_string(),
            canonical_session_id: "canonical-1".to_string(),
            is_alias: true,
            last_event_seq: 11,
            graph_revision: 9,
            open_token: "open-token-1".to_string(),
            agent_id: CanonicalAgentId::Cursor,
            project_path: "/workspace/a".to_string(),
            worktree_path: Some("/workspace/.worktrees/feature-a".to_string()),
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

        let graph = build_graph_from_open_found(
            &found,
            SessionGraphLifecycle::idle(),
            SessionGraphCapabilities::empty(),
        );

        assert_eq!(graph.canonical_session_id, "canonical-1");
        assert!(graph.is_alias);
        assert_eq!(graph.revision.graph_revision, 9);
        assert_eq!(graph.revision.transcript_revision, 3);
        assert_eq!(graph.revision.last_event_seq, 11);
    }
}
