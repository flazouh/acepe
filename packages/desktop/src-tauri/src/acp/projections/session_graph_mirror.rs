use super::*;
use crate::acp::session_state_engine::SessionStateGraph;
use crate::acp::transcript_projection::assistant_boundary_entry_count_from_transcript_entries;

impl ProjectionRegistry {
    /// Replaces compatibility read models with an exact projection of the canonical graph.
    ///
    /// This registry remains a legacy row-ledger/read surface. It does not own session truth and
    /// must never parse provider updates while mirroring the graph.
    pub fn mirror_session_graph(&self, graph: &SessionStateGraph) {
        let _write_guard = self.projection_write_guard();
        let session_id = graph.canonical_session_id.as_str();
        self.remove_session(session_id);

        let active_tool_call_ids = graph
            .operations
            .iter()
            .filter(|operation| {
                matches!(
                    operation.operation_state,
                    OperationState::Pending | OperationState::Running | OperationState::Blocked
                )
            })
            .map(|operation| operation.tool_call_id.clone())
            .collect();
        let completed_tool_call_ids = graph
            .operations
            .iter()
            .filter(|operation| is_terminal_operation_state(&operation.operation_state))
            .map(|operation| operation.tool_call_id.clone())
            .collect();

        self.snapshots.insert(
            session_id.to_string(),
            SessionSnapshot {
                session_id: session_id.to_string(),
                agent_id: Some(graph.agent_id.clone()),
                last_event_seq: graph.revision.last_event_seq,
                turn_state: graph.turn_state.clone(),
                message_count: graph.message_count,
                active_tool_call_ids,
                completed_tool_call_ids,
                active_turn_failure: graph.active_turn_failure.clone(),
                last_terminal_turn_id: graph.last_terminal_turn_id.clone(),
                assistant_boundary_entry_count:
                    assistant_boundary_entry_count_from_transcript_entries(
                        &graph.transcript_snapshot.entries,
                    ),
                transcript_entry_count: graph.transcript_snapshot.entries.len(),
            },
        );

        for operation in &graph.operations {
            self.operations_by_id
                .insert(operation.id.clone(), operation.clone());
            self.operation_id_by_tool_key.insert(
                create_session_tool_key(session_id, &operation.tool_call_id),
                operation.id.clone(),
            );
            if let Some(provenance_key) = operation.operation_provenance_key.as_ref() {
                self.operation_id_by_tool_key.insert(
                    create_session_tool_key(session_id, provenance_key),
                    operation.id.clone(),
                );
            }
            self.insert_session_operation_id(session_id, &operation.id);
        }

        for interaction in &graph.interactions {
            self.interactions_by_id
                .insert(interaction.id.clone(), interaction.clone());
            if let Some(request_id) = interaction.json_rpc_request_id {
                self.interaction_id_by_request_key.insert(
                    create_session_request_key(session_id, request_id),
                    interaction.id.clone(),
                );
            }
            let mut interaction_ids = self
                .session_interaction_ids
                .entry(session_id.to_string())
                .or_default();
            interaction_ids.push(interaction.id.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::acp::session::engine::fold::{fold_full, FoldContext};
    use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
    use crate::acp::session_update::{ToolArguments, ToolCallStatus, ToolKind};
    use crate::acp::transcript_projection::assistant_boundary_entry_count_from_transcript_entries;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier};

    fn event(provider_seq: u64, kind: ProviderEventKind) -> ProviderEvent {
        ProviderEvent {
            source: CanonicalAgentId::ClaudeCode,
            provider_seq,
            provider_row_id: format!("row-{provider_seq}"),
            timestamp_ms: None,
            kind,
        }
    }

    fn operation(
        session_id: &str,
        tool_call_id: &str,
        provenance_key: &str,
        operation_state: OperationState,
    ) -> OperationSnapshot {
        OperationSnapshot {
            id: build_canonical_operation_id(session_id, provenance_key),
            session_id: session_id.to_string(),
            tool_call_id: tool_call_id.to_string(),
            name: "bash".to_string(),
            kind: Some(ToolKind::Execute),
            provider_status: if operation_state == OperationState::Completed {
                ToolCallStatus::Completed
            } else {
                ToolCallStatus::InProgress
            },
            title: Some("Run command".to_string()),
            arguments: ToolArguments::Execute {
                command: Some("bun test".to_string()),
            },
            progressive_arguments: None,
            result: None,
            computer_payload: None,
            command: Some("bun test".to_string()),
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: Vec::new(),
            child_operation_ids: Vec::new(),
            operation_provenance_key: Some(provenance_key.to_string()),
            operation_state,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_link: OperationSourceLink::synthetic("mirror test"),
            degradation_reason: None,
        }
    }

    fn interaction(session_id: &str, id: &str, request_id: u64) -> InteractionSnapshot {
        InteractionSnapshot {
            id: id.to_string(),
            session_id: session_id.to_string(),
            kind: InteractionKind::PlanApproval,
            state: InteractionState::Pending,
            json_rpc_request_id: Some(request_id),
            reply_handler: None,
            tool_reference: None,
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::PlanApproval {
                source: PlanApprovalSource::CreatePlan,
            },
            canonical_operation_id: None,
        }
    }

    fn graph() -> crate::acp::session_state_engine::SessionStateGraph {
        let mut graph = fold_full(
            &[
                event(
                    1,
                    ProviderEventKind::UserText {
                        text: "Ship it".to_string(),
                        attempt_id: None,
                    },
                ),
                event(
                    2,
                    ProviderEventKind::AssistantText {
                        text: "Working".to_string(),
                    },
                ),
            ],
            &FoldContext::new("session-1", CanonicalAgentId::ClaudeCode, "/project"),
        );
        graph.revision = crate::acp::session_state_engine::SessionGraphRevision::new(12, 8, 41);
        graph.transcript_snapshot.revision = 8;
        graph.turn_state = SessionTurnState::Running;
        graph.last_terminal_turn_id = Some("turn-previous".to_string());
        graph
    }

    fn graph_generation(
        generation: i64,
        item_count: usize,
    ) -> crate::acp::session_state_engine::SessionStateGraph {
        let mut graph = graph();
        graph.revision = crate::acp::session_state_engine::SessionGraphRevision::new(
            generation, generation, generation,
        );
        graph.operations = (0..item_count)
            .map(|index| {
                operation(
                    "session-1",
                    &format!("tool-{generation}-{index}"),
                    &format!("provider-{generation}-{index}"),
                    OperationState::Running,
                )
            })
            .collect();
        graph.interactions = (0..item_count)
            .map(|index| {
                interaction(
                    "session-1",
                    &format!("interaction-{generation}-{index}"),
                    generation as u64 * 10_000 + index as u64,
                )
            })
            .collect();
        graph
    }

    fn assert_complete_generation(projection: &SessionProjectionSnapshot) {
        let snapshot = projection
            .session
            .as_ref()
            .expect("a mirrored session must never disappear from a concurrent read");
        let expected_count = match snapshot.last_event_seq {
            101 => 1,
            202 => 1_000,
            generation => panic!("unexpected projection generation {generation}"),
        };

        assert_eq!(projection.operations.len(), expected_count);
        assert_eq!(projection.interactions.len(), expected_count);
        assert!(projection.operations.iter().all(|operation| operation
            .tool_call_id
            .starts_with(&format!("tool-{}-", snapshot.last_event_seq))));
        assert!(projection.interactions.iter().all(|interaction| interaction
            .id
            .starts_with(&format!("interaction-{}-", snapshot.last_event_seq))));
    }

    #[test]
    fn mirror_session_graph_replaces_read_models_and_lookup_indexes_from_canonical_graph() {
        let registry = ProjectionRegistry::new();
        let mut first = graph();
        first.operations = vec![operation(
            "session-1",
            "tool-old",
            "provider-old",
            OperationState::Running,
        )];
        first.interactions = vec![interaction("session-1", "interaction-old", 10)];
        registry.mirror_session_graph(&first);

        let mut canonical = graph();
        canonical.operations = vec![
            operation(
                "session-1",
                "tool-active",
                "provider-active",
                OperationState::Blocked,
            ),
            operation(
                "session-1",
                "tool-done",
                "provider-done",
                OperationState::Completed,
            ),
        ];
        canonical.interactions = vec![interaction("session-1", "interaction-new", 20)];

        registry.mirror_session_graph(&canonical);

        let projection = registry.session_projection("session-1");
        let snapshot = projection.session.expect("mirrored session snapshot");
        assert_eq!(snapshot.session_id, "session-1");
        assert_eq!(snapshot.agent_id, Some(CanonicalAgentId::ClaudeCode));
        assert_eq!(snapshot.last_event_seq, 41);
        assert_eq!(snapshot.turn_state, SessionTurnState::Running);
        assert_eq!(snapshot.message_count, 2);
        assert_eq!(snapshot.active_tool_call_ids, vec!["tool-active"]);
        assert_eq!(snapshot.completed_tool_call_ids, vec!["tool-done"]);
        assert_eq!(
            snapshot.last_terminal_turn_id.as_deref(),
            Some("turn-previous")
        );
        assert_eq!(
            snapshot.assistant_boundary_entry_count,
            assistant_boundary_entry_count_from_transcript_entries(
                &canonical.transcript_snapshot.entries
            )
        );
        assert_eq!(
            snapshot.transcript_entry_count,
            canonical.transcript_snapshot.entries.len()
        );
        assert_eq!(projection.operations.len(), 2);
        assert_eq!(projection.operations[0].id, canonical.operations[0].id);
        assert_eq!(projection.operations[1].id, canonical.operations[1].id);
        assert_eq!(projection.interactions.len(), 1);
        assert_eq!(projection.interactions[0].id, "interaction-new");

        assert!(registry
            .operation_for_tool_call("session-1", "tool-old")
            .is_none());
        assert!(registry.interaction("interaction-old").is_none());
        assert!(registry
            .interaction_for_request_id("session-1", 10)
            .is_none());
        assert_eq!(
            registry
                .operation_for_tool_call("session-1", "provider-active")
                .expect("provenance lookup index")
                .tool_call_id,
            "tool-active"
        );
        assert_eq!(
            registry
                .interaction_for_request_id("session-1", 20)
                .expect("request lookup index")
                .id,
            "interaction-new"
        );
    }

    #[test]
    fn concurrent_session_projection_reads_observe_one_complete_mirror_generation() {
        let registry = Arc::new(ProjectionRegistry::new());
        let small = graph_generation(101, 1);
        let large = graph_generation(202, 1_000);
        registry.mirror_session_graph(&small);

        let start = Arc::new(Barrier::new(2));
        let writer_done = Arc::new(AtomicBool::new(false));
        let writer_registry = Arc::clone(&registry);
        let writer_start = Arc::clone(&start);
        let writer_done_flag = Arc::clone(&writer_done);
        let writer = std::thread::spawn(move || {
            writer_start.wait();
            for _ in 0..20 {
                writer_registry.mirror_session_graph(&large);
                writer_registry.mirror_session_graph(&small);
            }
            writer_done_flag.store(true, Ordering::Release);
        });

        start.wait();
        while !writer_done.load(Ordering::Acquire) {
            assert_complete_generation(&registry.session_projection("session-1"));
            std::thread::yield_now();
        }
        writer.join().expect("mirror writer should finish");
        assert_complete_generation(&registry.session_projection("session-1"));
    }
}
