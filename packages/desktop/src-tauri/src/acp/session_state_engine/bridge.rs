use crate::acp::session_open_snapshot::SessionOpenFound;
use crate::acp::session_state_engine::envelope::{
    session_state_envelope_byte_budget_status, SessionStateEnvelope,
};
use crate::acp::session_state_engine::graph::ActiveStreamingTail;
use crate::acp::session_state_engine::protocol::{SessionStateDelta, SessionStatePayload};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::SessionGraphActivity;
use crate::acp::session_state_engine::session_state_field::SessionStateField;
use crate::acp::session_state_engine::snapshot_builder::build_graph_from_open_found;
use crate::acp::session_wire_compaction::{
    compact_actionable_operations_for_ipc, compact_operations_for_ipc,
    OPERATION_LIST_ACTIONABLE_COMPACTION_THRESHOLD,
};
use crate::acp::transcript_projection::TranscriptDeltaOperation;

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
    pub changed_fields: Vec<SessionStateField>,
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

pub fn compact_oversized_snapshot_envelope(envelope: SessionStateEnvelope) -> SessionStateEnvelope {
    if session_state_envelope_byte_budget_status(&envelope).is_ok() {
        return envelope;
    }

    let SessionStateEnvelope {
        session_id,
        graph_revision,
        last_event_seq,
        payload,
    } = envelope;

    let SessionStatePayload::Snapshot { graph } = payload else {
        return SessionStateEnvelope {
            session_id,
            graph_revision,
            last_event_seq,
            payload,
        };
    };

    if graph.transcript_snapshot.entries.is_empty() {
        return SessionStateEnvelope {
            session_id,
            graph_revision,
            last_event_seq,
            payload: SessionStatePayload::Snapshot { graph },
        };
    }

    let full_entry_count = graph.transcript_snapshot.entries.len();
    let mut compact_graph = *graph;
    let full_operation_count = compact_graph.operations.len();
    compact_graph.transcript_snapshot.entries.clear();
    if full_operation_count > OPERATION_LIST_ACTIONABLE_COMPACTION_THRESHOLD {
        compact_graph.operations = compact_actionable_operations_for_ipc(compact_graph.operations);
    }
    let mut compact_envelope = SessionStateEnvelope {
        session_id,
        graph_revision,
        last_event_seq,
        payload: SessionStatePayload::Snapshot {
            graph: Box::new(compact_graph),
        },
    };

    if session_state_envelope_byte_budget_status(&compact_envelope).is_err() {
        let SessionStateEnvelope {
            session_id,
            graph_revision,
            last_event_seq,
            payload,
        } = compact_envelope;
        let SessionStatePayload::Snapshot { graph } = payload else {
            return SessionStateEnvelope {
                session_id,
                graph_revision,
                last_event_seq,
                payload,
            };
        };
        let mut compact_graph = *graph;
        compact_graph.operations = compact_operations_for_ipc(compact_graph.operations);
        compact_envelope = SessionStateEnvelope {
            session_id,
            graph_revision,
            last_event_seq,
            payload: SessionStatePayload::Snapshot {
                graph: Box::new(compact_graph),
            },
        };
    }

    if session_state_envelope_byte_budget_status(&compact_envelope).is_err() {
        let SessionStateEnvelope {
            session_id,
            graph_revision,
            last_event_seq,
            payload,
        } = compact_envelope;
        let SessionStatePayload::Snapshot { graph } = payload else {
            return SessionStateEnvelope {
                session_id,
                graph_revision,
                last_event_seq,
                payload,
            };
        };
        let mut compact_graph = *graph;
        compact_graph.operations = compact_actionable_operations_for_ipc(compact_graph.operations);
        compact_envelope = SessionStateEnvelope {
            session_id,
            graph_revision,
            last_event_seq,
            payload: SessionStatePayload::Snapshot {
                graph: Box::new(compact_graph),
            },
        };
    }

    if session_state_envelope_byte_budget_status(&compact_envelope).is_err() {
        let SessionStateEnvelope {
            session_id,
            graph_revision,
            last_event_seq,
            payload,
        } = compact_envelope;
        let SessionStatePayload::Snapshot { graph } = payload else {
            return SessionStateEnvelope {
                session_id,
                graph_revision,
                last_event_seq,
                payload,
            };
        };
        let mut compact_graph = *graph;
        compact_graph.operations.clear();
        compact_envelope = SessionStateEnvelope {
            session_id,
            graph_revision,
            last_event_seq,
            payload: SessionStatePayload::Snapshot {
                graph: Box::new(compact_graph),
            },
        };
    }

    tracing::warn!(
        session_id = %compact_envelope.session_id,
        graph_revision = compact_envelope.graph_revision,
        last_event_seq = compact_envelope.last_event_seq,
        full_entry_count,
        full_operation_count,
        "Compacted oversized session-state snapshot transcript body; viewport rows remain authoritative"
    );

    compact_envelope
}

pub fn build_budgeted_snapshot_envelope(found: &SessionOpenFound) -> SessionStateEnvelope {
    compact_oversized_snapshot_envelope(build_snapshot_envelope(found))
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
    use crate::acp::projections::{
        OperationSnapshot, OperationSourceLink, OperationState, SessionTurnState,
    };
    use crate::acp::session_open_snapshot::SessionOpenFound;
    use crate::acp::session_state_engine::protocol::SessionStatePayload;
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
    };
    use crate::acp::session_state_engine::session_state_envelope_byte_budget_status;
    use crate::acp::session_update::{ToolArguments, ToolCallStatus, ToolKind};
    use crate::acp::transcript_projection::{
        TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole, TranscriptSegment,
        TranscriptSnapshot,
    };
    use crate::acp::types::CanonicalAgentId;

    use super::{
        build_budgeted_snapshot_envelope, build_delta_envelope, build_snapshot_envelope,
        DeltaEnvelopeParts, DeltaSessionProjectionFields, SessionStateField,
    };

    fn large_operation(session_id: &str) -> OperationSnapshot {
        OperationSnapshot {
            id: "op-large".to_string(),
            session_id: session_id.to_string(),
            tool_call_id: "tool-large".to_string(),
            name: "Read".to_string(),
            kind: Some(ToolKind::Read),
            provider_status: ToolCallStatus::Completed,
            title: Some("Large read".to_string()),
            arguments: ToolArguments::Other {
                raw: serde_json::json!({
                    "payload": "x".repeat(2_100_000)
                }),
                intent: None,
            },
            progressive_arguments: Some(ToolArguments::Other {
                raw: serde_json::json!({
                    "payload": "x".repeat(2_100_000)
                }),
                intent: None,
            }),
            result: Some(serde_json::json!({
                "content": "x".repeat(2_100_000)
            })),
            computer_payload: None,
            command: Some("x".repeat(2_100_000)),
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: Vec::new(),
            child_operation_ids: Vec::new(),
            operation_provenance_key: None,
            operation_state: OperationState::Completed,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_link: OperationSourceLink::Synthetic {
                reason: "test".to_string(),
            },
            degradation_reason: None,
        }
    }

    fn completed_operation_with_payload(session_id: &str, index: usize) -> OperationSnapshot {
        OperationSnapshot {
            id: format!("op-{index}"),
            session_id: session_id.to_string(),
            tool_call_id: format!("tool-{index}"),
            name: "Read".to_string(),
            kind: Some(ToolKind::Read),
            provider_status: ToolCallStatus::Completed,
            title: Some("Historical read".to_string()),
            arguments: ToolArguments::Other {
                raw: serde_json::json!({
                    "payload": "x".repeat(3_000)
                }),
                intent: None,
            },
            progressive_arguments: None,
            result: Some(serde_json::json!({
                "content": "x".repeat(3_000)
            })),
            computer_payload: None,
            command: Some("x".repeat(1_024)),
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: Vec::new(),
            child_operation_ids: Vec::new(),
            operation_provenance_key: None,
            operation_state: OperationState::Completed,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_link: OperationSourceLink::Synthetic {
                reason: "test".to_string(),
            },
            degradation_reason: None,
        }
    }

    fn running_operation(session_id: &str) -> OperationSnapshot {
        let mut operation = completed_operation_with_payload(session_id, 10_000);
        operation.id = "op-running".to_string();
        operation.tool_call_id = "tool-running".to_string();
        operation.provider_status = ToolCallStatus::InProgress;
        operation.operation_state = OperationState::Running;
        operation
    }

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
            open_path: crate::acp::session_open_snapshot::SessionOpenPath::CompatSnapshot,
            initial_transcript_row_page: None,
            initial_viewport_envelope: None,
            open_result_timing: None,
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
            changed_fields: vec![SessionStateField::TranscriptSnapshot],
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

    #[test]
    fn budgeted_snapshot_preserves_revision_while_compacting_large_transcript_body() {
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
                entries: vec![TranscriptEntry {
                    entry_id: "assistant-1".to_string(),
                    role: TranscriptEntryRole::Assistant,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: "assistant-1:text:0".to_string(),
                        text: "x".repeat(2_100_000),
                    }],
                    attempt_id: None,
                    timestamp_ms: None,
                }],
            },
            session_title: "Session 1".to_string(),
            operations: vec![large_operation("canonical-1")],
            interactions: Vec::new(),
            turn_state: SessionTurnState::Idle,
            message_count: 1,
            activity: SessionGraphActivity::idle(),
            active_streaming_tail: None,
            lifecycle: SessionGraphLifecycle::idle(),
            capabilities: SessionGraphCapabilities::empty(),
            open_path: crate::acp::session_open_snapshot::SessionOpenPath::CompatSnapshot,
            initial_transcript_row_page: None,
            initial_viewport_envelope: None,
            open_result_timing: None,
            active_turn_failure: None,
            last_terminal_turn_id: None,
        };

        let envelope = build_budgeted_snapshot_envelope(&found);

        assert!(session_state_envelope_byte_budget_status(&envelope).is_ok());
        match envelope.payload {
            SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.transcript_snapshot.revision, 3);
                assert!(graph.transcript_snapshot.entries.is_empty());
                assert_eq!(graph.message_count, 1);
                assert_eq!(graph.operations.len(), 1);
                assert!(
                    serde_json::to_vec(&graph.operations[0])
                        .expect("operation serializes")
                        .len()
                        < 32_000
                );
            }
            _ => panic!("expected snapshot payload"),
        }
    }

    #[test]
    fn budgeted_snapshot_drops_historical_operations_when_compacted_snapshot_stays_oversized() {
        let session_id = "canonical-many-ops";
        let mut operations: Vec<OperationSnapshot> = (0..4_000)
            .map(|index| completed_operation_with_payload(session_id, index))
            .collect();
        operations.push(running_operation(session_id));
        let found = SessionOpenFound {
            requested_session_id: "requested-many-ops".to_string(),
            canonical_session_id: session_id.to_string(),
            is_alias: false,
            last_event_seq: 11,
            graph_revision: 9,
            open_token: "open-token-many-ops".to_string(),
            agent_id: CanonicalAgentId::Cursor,
            project_path: "/workspace/a".to_string(),
            worktree_path: None,
            source_path: None,
            sequence_id: None,
            transcript_snapshot: TranscriptSnapshot {
                revision: 3,
                entries: vec![TranscriptEntry {
                    entry_id: "assistant-1".to_string(),
                    role: TranscriptEntryRole::Assistant,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: "assistant-1:text:0".to_string(),
                        text: "x".repeat(2_100_000),
                    }],
                    attempt_id: None,
                    timestamp_ms: None,
                }],
            },
            session_title: "Session 1".to_string(),
            operations,
            interactions: Vec::new(),
            turn_state: SessionTurnState::Idle,
            message_count: 1,
            activity: SessionGraphActivity::idle(),
            active_streaming_tail: None,
            lifecycle: SessionGraphLifecycle::idle(),
            capabilities: SessionGraphCapabilities::empty(),
            open_path: crate::acp::session_open_snapshot::SessionOpenPath::CompatSnapshot,
            initial_transcript_row_page: None,
            initial_viewport_envelope: None,
            open_result_timing: None,
            active_turn_failure: None,
            last_terminal_turn_id: None,
        };

        let envelope = build_budgeted_snapshot_envelope(&found);

        assert!(session_state_envelope_byte_budget_status(&envelope).is_ok());
        match envelope.payload {
            SessionStatePayload::Snapshot { graph } => {
                assert!(graph.transcript_snapshot.entries.is_empty());
                assert_eq!(graph.operations.len(), 1);
                assert_eq!(graph.operations[0].id, "op-running");
            }
            _ => panic!("expected snapshot payload"),
        }
    }
}
