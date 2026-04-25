use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::protocol::SessionStateDelta;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
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
    PatchOperationState {
        operation_id: String,
        new_state: crate::acp::projections::OperationState,
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
                        delta.to_revision.transcript_revision,
                    );
                }
                for operation in delta.operation_patches {
                    upsert_operation_patch(&mut graph.operations, operation);
                }
                for interaction in delta.interaction_patches {
                    upsert_interaction_patch(&mut graph.interactions, interaction);
                }
                graph.activity = select_session_graph_activity(
                    &graph.lifecycle,
                    &graph.turn_state,
                    &graph.operations,
                    &graph.interactions,
                    graph.active_turn_failure.as_ref(),
                );
                graph.revision = delta.to_revision;
            }
            SessionStateGraphMutation::UpdateLifecycle {
                lifecycle,
                revision,
            } => {
                graph.lifecycle = lifecycle;
                graph.activity = select_session_graph_activity(
                    &graph.lifecycle,
                    &graph.turn_state,
                    &graph.operations,
                    &graph.interactions,
                    graph.active_turn_failure.as_ref(),
                );
                graph.revision = revision;
            }
            SessionStateGraphMutation::UpdateCapabilities {
                capabilities,
                revision,
            } => {
                graph.capabilities = *capabilities;
                graph.revision = revision;
            }
            SessionStateGraphMutation::PatchOperationState {
                operation_id,
                new_state,
            } => {
                if let Some(op) = graph.operations.iter_mut().find(|o| o.id == operation_id) {
                    let is_terminal = op
                        .operation_state
                        .as_ref()
                        .map(is_terminal_operation_state)
                        .unwrap_or(false);
                    if !is_terminal {
                        op.operation_state = Some(new_state);
                    }
                }
            }
        }
    }
}

fn upsert_operation_patch(
    operations: &mut Vec<crate::acp::projections::OperationSnapshot>,
    operation: crate::acp::projections::OperationSnapshot,
) {
    if let Some(existing) = operations
        .iter_mut()
        .find(|existing| existing.id == operation.id)
    {
        if is_terminal_operation_snapshot(existing) && !is_terminal_operation_snapshot(&operation) {
            return;
        }
        *existing = operation;
        return;
    }

    operations.push(operation);
}

fn is_terminal_operation_snapshot(operation: &crate::acp::projections::OperationSnapshot) -> bool {
    if operation
        .operation_state
        .as_ref()
        .is_some_and(is_terminal_operation_state)
    {
        return true;
    }

    matches!(
        operation.status,
        crate::acp::session_update::ToolCallStatus::Completed
            | crate::acp::session_update::ToolCallStatus::Failed
    )
}

fn is_terminal_operation_state(state: &crate::acp::projections::OperationState) -> bool {
    matches!(
        state,
        crate::acp::projections::OperationState::Completed
            | crate::acp::projections::OperationState::Failed
            | crate::acp::projections::OperationState::Cancelled
            | crate::acp::projections::OperationState::Degraded
    )
}

fn upsert_interaction_patch(
    interactions: &mut Vec<crate::acp::projections::InteractionSnapshot>,
    interaction: crate::acp::projections::InteractionSnapshot,
) {
    if let Some(existing) = interactions
        .iter_mut()
        .find(|existing| existing.id == interaction.id)
    {
        *existing = interaction;
        return;
    }

    interactions.push(interaction);
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
        SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
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
            activity: SessionGraphActivity::idle(),
            capabilities: SessionGraphCapabilities::empty(),
        }
    }

    fn operation_snapshot(
        id: &str,
        tool_call_id: &str,
        status: crate::acp::session_update::ToolCallStatus,
        operation_state: crate::acp::projections::OperationState,
    ) -> crate::acp::projections::OperationSnapshot {
        use crate::acp::session_update::{ToolArguments, ToolKind};
        use serde_json::json;

        crate::acp::projections::OperationSnapshot {
            id: id.to_string(),
            session_id: "session-1".to_string(),
            tool_call_id: tool_call_id.to_string(),
            name: "bash".to_string(),
            kind: Some(ToolKind::Execute),
            status,
            title: None,
            arguments: ToolArguments::Other { raw: json!({}) },
            progressive_arguments: None,
            result: None,
            command: None,
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: vec![],
            child_operation_ids: vec![],
            operation_provenance_key: Some(tool_call_id.to_string()),
            operation_state: Some(operation_state),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_entry_id: None,
            degradation_reason: None,
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
            operation_patches: Vec::new(),
            interaction_patches: Vec::new(),
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
            operation_patches: Vec::new(),
            interaction_patches: Vec::new(),
            changed_fields: vec!["transcriptSnapshot".to_string()],
        };

        SessionStateReducer::apply(&mut graph, SessionStateGraphMutation::ApplyDelta { delta });

        assert_eq!(graph.transcript_snapshot, replacement_snapshot);
        assert_eq!(graph.revision, SessionGraphRevision::new(5, 5, 5));
    }

    #[test]
    fn reducer_uses_transcript_revision_for_transcript_snapshot_updates() {
        let mut graph = base_graph();
        let delta = SessionStateDelta {
            from_revision: SessionGraphRevision::new(1, 1, 1),
            to_revision: SessionGraphRevision::new(10, 4, 10),
            transcript_operations: vec![TranscriptDeltaOperation::AppendSegment {
                entry_id: "assistant-1".to_string(),
                role: TranscriptEntryRole::Assistant,
                segment: TranscriptSegment::Text {
                    segment_id: "assistant-1:segment:2".to_string(),
                    text: " world".to_string(),
                },
            }],
            operation_patches: Vec::new(),
            interaction_patches: Vec::new(),
            changed_fields: vec!["transcriptSnapshot".to_string()],
        };

        SessionStateReducer::apply(&mut graph, SessionStateGraphMutation::ApplyDelta { delta });

        assert_eq!(graph.revision, SessionGraphRevision::new(10, 4, 10));
        assert_eq!(graph.transcript_snapshot.revision, 4);
        assert_eq!(graph.transcript_snapshot.entries[0].segments.len(), 2);
    }

    #[test]
    fn patch_operation_state_respects_terminal_states() {
        use crate::acp::projections::{OperationSnapshot, OperationState};
        use crate::acp::session_update::{ToolArguments, ToolCallStatus, ToolKind};
        use serde_json::json;

        let mut graph = base_graph();
        let op = OperationSnapshot {
            id: "session-1:op-1".to_string(),
            session_id: "session-1".to_string(),
            tool_call_id: "op-1".to_string(),
            name: "bash".to_string(),
            kind: Some(ToolKind::Execute),
            status: ToolCallStatus::Completed,
            title: None,
            arguments: ToolArguments::Other { raw: json!({}) },
            progressive_arguments: None,
            result: None,
            command: None,
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: vec![],
            child_operation_ids: vec![],
            operation_provenance_key: Some("op-1".to_string()),
            operation_state: Some(OperationState::Completed),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_entry_id: None,
            degradation_reason: None,
        };
        graph.operations.push(op);

        SessionStateReducer::apply(
            &mut graph,
            SessionStateGraphMutation::PatchOperationState {
                operation_id: "session-1:op-1".to_string(),
                new_state: OperationState::Running,
            },
        );
        assert_eq!(
            graph.operations[0].operation_state,
            Some(OperationState::Completed),
            "terminal state must not be regressed"
        );

        let mut graph2 = base_graph();
        let op2 = OperationSnapshot {
            id: "session-1:op-2".to_string(),
            session_id: "session-1".to_string(),
            tool_call_id: "op-2".to_string(),
            name: "bash".to_string(),
            kind: Some(ToolKind::Execute),
            status: ToolCallStatus::InProgress,
            title: None,
            arguments: ToolArguments::Other { raw: json!({}) },
            progressive_arguments: None,
            result: None,
            command: None,
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: vec![],
            child_operation_ids: vec![],
            operation_provenance_key: Some("op-2".to_string()),
            operation_state: Some(OperationState::Running),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_entry_id: None,
            degradation_reason: None,
        };
        graph2.operations.push(op2);

        SessionStateReducer::apply(
            &mut graph2,
            SessionStateGraphMutation::PatchOperationState {
                operation_id: "session-1:op-2".to_string(),
                new_state: OperationState::Completed,
            },
        );
        assert_eq!(
            graph2.operations[0].operation_state,
            Some(OperationState::Completed),
            "non-terminal state should transition to Completed"
        );
    }

    #[test]
    fn operation_patches_do_not_regress_terminal_operations() {
        use crate::acp::projections::OperationState;
        use crate::acp::session_update::ToolCallStatus;

        let mut graph = base_graph();
        graph.operations.push(operation_snapshot(
            "session-1:op-1",
            "op-1",
            ToolCallStatus::Completed,
            OperationState::Completed,
        ));

        let delta = SessionStateDelta {
            from_revision: SessionGraphRevision::new(1, 1, 1),
            to_revision: SessionGraphRevision::new(2, 1, 2),
            transcript_operations: Vec::new(),
            operation_patches: vec![operation_snapshot(
                "session-1:op-1",
                "op-1",
                ToolCallStatus::InProgress,
                OperationState::Running,
            )],
            interaction_patches: Vec::new(),
            changed_fields: vec!["operations".to_string()],
        };

        SessionStateReducer::apply(&mut graph, SessionStateGraphMutation::ApplyDelta { delta });

        assert_eq!(graph.operations.len(), 1);
        assert_eq!(
            graph.operations[0].operation_state,
            Some(OperationState::Completed)
        );
        assert_eq!(graph.operations[0].status, ToolCallStatus::Completed);
    }
}
