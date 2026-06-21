use super::*;

impl ProjectionRegistry {
    pub(crate) fn insert_session_operation_id(&self, session_id: &str, operation_id: &str) {
        let mut operation_ids = self
            .session_operation_ids
            .entry(session_id.to_string())
            .or_default();
        if operation_ids
            .iter()
            .any(|candidate| candidate == operation_id)
        {
            return;
        }

        operation_ids.push(operation_id.to_string());
    }

    pub(crate) fn can_insert_operation(&self, session_id: &str) -> bool {
        self.session_operation_ids
            .get(session_id)
            .map(|operation_ids| operation_ids.len() < MAX_SESSION_OPERATIONS)
            .unwrap_or(true)
    }

    pub(crate) fn patch_operation_state(
        &self,
        operation_id: &str,
        new_state: OperationState,
    ) -> Option<OperationSnapshot> {
        let existing = self
            .operations_by_id
            .get(operation_id)
            .map(|operation| operation.clone())?;
        if is_terminal_operation_state(&existing.operation_state) {
            return Some(existing);
        }

        let mut updated = OperationSnapshot {
            id: existing.id.clone(),
            session_id: existing.session_id.clone(),
            tool_call_id: existing.tool_call_id.clone(),
            name: existing.name.clone(),
            kind: existing.kind,
            provider_status: existing.provider_status.clone(),
            title: existing.title.clone(),
            arguments: existing.arguments.clone(),
            progressive_arguments: existing.progressive_arguments.clone(),
            result: existing.result.clone(),
            command: existing.command.clone(),
            normalized_todos: existing.normalized_todos.clone(),
            parent_tool_call_id: existing.parent_tool_call_id.clone(),
            parent_operation_id: existing.parent_operation_id.clone(),
            child_tool_call_ids: existing.child_tool_call_ids.clone(),
            child_operation_ids: existing.child_operation_ids.clone(),
            operation_provenance_key: existing.operation_provenance_key.clone(),
            operation_state: new_state,
            locations: existing.locations.clone(),
            skill_meta: existing.skill_meta.clone(),
            normalized_questions: existing.normalized_questions.clone(),
            question_answer: existing.question_answer.clone(),
            awaiting_plan_approval: existing.awaiting_plan_approval,
            plan_approval_request_id: existing.plan_approval_request_id,
            started_at_ms: existing.started_at_ms,
            completed_at_ms: existing.completed_at_ms,
            source_link: existing.source_link.clone(),
            degradation_reason: existing.degradation_reason.clone(),
        };
        apply_operation_lifecycle_timing(
            Some(&existing),
            &mut updated,
            crate::acp::session_state_engine::timing::wall_clock_ms(),
        );
        self.operations_by_id
            .insert(operation_id.to_string(), updated.clone());
        Some(updated)
    }

    pub(crate) fn has_pending_blocking_interaction_for_operation(
        &self,
        session_id: &str,
        operation_id: &str,
    ) -> bool {
        let Some(interaction_ids) = self.session_interaction_ids.get(session_id) else {
            return false;
        };

        interaction_ids.iter().any(|interaction_id| {
            self.interactions_by_id
                .get(interaction_id)
                .is_some_and(|interaction| {
                    interaction.state == InteractionState::Pending
                        && interaction.canonical_operation_id.as_deref() == Some(operation_id)
                })
        })
    }

    pub(crate) fn block_operation_for_pending_interaction(
        &self,
        interaction: &InteractionSnapshot,
    ) {
        if interaction.state != InteractionState::Pending {
            return;
        }

        let Some(operation_id) = interaction.canonical_operation_id.as_deref() else {
            return;
        };

        let _ = self.patch_operation_state(operation_id, OperationState::Blocked);
    }

    pub(crate) fn advance_operation_after_interaction_resolution(
        &self,
        interaction: &InteractionSnapshot,
    ) {
        let Some(operation_id) = interaction.canonical_operation_id.as_deref() else {
            return;
        };

        match interaction.state {
            InteractionState::Approved | InteractionState::Answered => {
                if !self.has_pending_blocking_interaction_for_operation(
                    &interaction.session_id,
                    operation_id,
                ) {
                    let _ = self.patch_operation_state(operation_id, OperationState::Running);
                }
            }
            InteractionState::Rejected | InteractionState::Unresolved => {
                let _ = self.patch_operation_state(operation_id, OperationState::Cancelled);
            }
            InteractionState::Pending => {}
        }
    }
}
