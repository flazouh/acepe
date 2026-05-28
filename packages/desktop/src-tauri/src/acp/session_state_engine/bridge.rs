use crate::acp::session_open_snapshot::SessionOpenFound;
use crate::acp::session_state_engine::envelope::SessionStateEnvelope;
use crate::acp::session_state_engine::graph::ActiveStreamingTail;
use crate::acp::session_state_engine::protocol::{
    SessionStateDelta, SessionStatePayload, VisibleTranscriptWindowPayload,
};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::SessionGraphActivity;
use crate::acp::session_state_engine::snapshot_builder::build_graph_from_open_found;
use crate::acp::transcript_projection::TranscriptDeltaOperation;
use crate::acp::transcript_viewport::{
    project_transcript_viewport_rows, LayoutIndex, TranscriptViewport,
};

pub struct DeltaSessionProjectionFields {
    pub activity: SessionGraphActivity,
    pub turn_state: crate::acp::projections::SessionTurnState,
    pub active_turn_failure: Option<crate::acp::projections::TurnFailureSnapshot>,
    pub last_terminal_turn_id: Option<String>,
    pub active_streaming_tail: Option<ActiveStreamingTail>,
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

pub fn build_visible_transcript_window_envelope_from_graph(
    graph: &crate::acp::session_state_engine::graph::SessionStateGraph,
    viewport_height_px: u32,
) -> SessionStateEnvelope {
    let rows = project_transcript_viewport_rows(
        &graph.transcript_snapshot,
        &graph.operations,
        &graph.interactions,
        graph.active_streaming_tail.as_ref(),
    );
    let layout = LayoutIndex::from_viewport_rows(rows.as_slice());
    let viewport = TranscriptViewport::new(layout, viewport_height_px);
    let window = viewport.window();
    let visible_rows = rows[window.visible_start_index..window.visible_end_index].to_vec();
    let row_offsets_px = visible_rows
        .iter()
        .map(|row| viewport.layout().row_offset_px(&row.row_id).unwrap_or(0))
        .collect();

    SessionStateEnvelope {
        session_id: graph.canonical_session_id.clone(),
        graph_revision: graph.revision.graph_revision,
        last_event_seq: graph.revision.last_event_seq,
        payload: SessionStatePayload::VisibleTranscriptWindow {
            window: VisibleTranscriptWindowPayload {
                session_id: graph.canonical_session_id.clone(),
                graph_revision: graph.revision,
                viewport_revision: graph.revision.transcript_revision,
                total_height_px: window.total_height_px,
                viewport_offset_px: window.offset_px,
                visible_start_index: window.visible_start_index,
                visible_end_index: window.visible_end_index,
                rows: visible_rows,
                row_offsets_px,
                mode: window.mode,
                diagnostics: Vec::new(),
            },
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
                active_streaming_tail: parts.projection.active_streaming_tail,
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
    use crate::acp::transcript_projection::{
        TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole, TranscriptSegment,
        TranscriptSnapshot,
    };
    use crate::acp::types::CanonicalAgentId;

    use super::{
        build_delta_envelope, build_snapshot_envelope,
        build_visible_transcript_window_envelope_from_graph, DeltaEnvelopeParts,
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
            sequence_id: None,
            transcript_snapshot: TranscriptSnapshot {
                revision: 3,
                entries: Vec::new(),
            },
            session_title: "Session 1".to_string(),
            operations: Vec::new(),
            interactions: Vec::new(),
            turn_state: SessionTurnState::Idle,
            message_count: 0,
            activity: SessionGraphActivity::idle(),
            active_streaming_tail: None,
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
    fn bridge_builds_bounded_visible_window_from_snapshot_graph() {
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
            sequence_id: None,
            transcript_snapshot: TranscriptSnapshot {
                revision: 3,
                entries: (0..100)
                    .map(|index| TranscriptEntry {
                        entry_id: format!("assistant-{index}"),
                        role: TranscriptEntryRole::Assistant,
                        segments: vec![TranscriptSegment::Text {
                            segment_id: format!("assistant-{index}:text"),
                            text: "hello".to_string(),
                        }],
                        attempt_id: None,
                        timestamp_ms: None,
                    })
                    .collect(),
            },
            session_title: "Session 1".to_string(),
            operations: Vec::new(),
            interactions: Vec::new(),
            turn_state: SessionTurnState::Idle,
            message_count: 100,
            activity: SessionGraphActivity::idle(),
            active_streaming_tail: None,
            lifecycle: SessionGraphLifecycle::idle(),
            capabilities: SessionGraphCapabilities::empty(),
            active_turn_failure: None,
            last_terminal_turn_id: None,
        };
        let snapshot_envelope = build_snapshot_envelope(&found);
        let SessionStatePayload::Snapshot { graph } = snapshot_envelope.payload else {
            panic!("expected snapshot");
        };

        let envelope = build_visible_transcript_window_envelope_from_graph(&graph, 240);

        match envelope.payload {
            SessionStatePayload::VisibleTranscriptWindow { window } => {
                assert_eq!(window.session_id, "canonical-1");
                assert_eq!(window.total_height_px, 12_000);
                assert!(window.rows.len() < 100);
                assert_eq!(
                    window.rows.last().map(|row| row.source_entry_id.as_str()),
                    Some("assistant-99")
                );
            }
            _ => panic!("expected visible window"),
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
                active_streaming_tail: None,
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
                assert_eq!(delta.active_streaming_tail, None);
            }
            _ => panic!("expected delta payload"),
        }
    }
}
