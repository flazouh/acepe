use super::*;

impl ProjectionRegistry {
    pub(crate) fn observe_session_event_seq(&self, session_id: &str, event_seq: i64) {
        let mut snapshot = self
            .snapshots
            .entry(session_id.to_string())
            .or_insert_with(|| SessionSnapshot::new(session_id.to_string(), None));
        snapshot.last_event_seq = snapshot.last_event_seq.max(event_seq);
    }

    pub(crate) fn register_permission_interaction(
        &self,
        permission: &PermissionData,
        event_seq: i64,
    ) {
        let interaction = InteractionSnapshot {
            id: permission.id.clone(),
            session_id: permission.session_id.clone(),
            kind: InteractionKind::Permission,
            state: if permission.auto_accepted {
                InteractionState::Approved
            } else {
                InteractionState::Pending
            },
            json_rpc_request_id: permission.json_rpc_request_id,
            reply_handler: permission.reply_handler.clone().or_else(|| {
                permission
                    .json_rpc_request_id
                    .map(InteractionReplyHandler::json_rpc)
                    .or_else(|| Some(InteractionReplyHandler::http(permission.id.clone())))
            }),
            tool_reference: permission.tool.clone(),
            responded_at_event_seq: permission.auto_accepted.then_some(event_seq),
            response: permission
                .auto_accepted
                .then_some(InteractionResponse::Permission {
                    accepted: true,
                    option_id: Some("allow".to_string()),
                    reply: Some("once".to_string()),
                }),
            payload: InteractionPayload::Permission(permission.clone()),
            canonical_operation_id: permission
                .tool
                .as_ref()
                .map(|t| build_canonical_operation_id(&permission.session_id, &t.call_id)),
        };
        self.upsert_interaction(interaction);
        self.enrich_exit_plan_operation_from_permission(permission);
    }

    pub(crate) fn enrich_exit_plan_operation_from_permission(&self, permission: &PermissionData) {
        if !is_exit_plan_permission(permission) {
            return;
        }

        let Some(tool_reference) = permission.tool.as_ref() else {
            return;
        };
        let Some(arguments) = read_exit_plan_arguments_from_permission(permission) else {
            return;
        };
        let Some(operation_id) =
            self.lookup_operation_id_by_tool_call(&permission.session_id, &tool_reference.call_id)
        else {
            return;
        };
        let Some(existing) = self
            .operations_by_id
            .get(&operation_id)
            .map(|operation| operation.clone())
        else {
            return;
        };

        let next_operation_state = if is_terminal_operation_state(&existing.operation_state) {
            existing.operation_state.clone()
        } else {
            OperationState::Blocked
        };
        let updated = OperationSnapshot {
            id: existing.id.clone(),
            session_id: existing.session_id.clone(),
            tool_call_id: existing.tool_call_id.clone(),
            name: existing.name.clone(),
            kind: Some(ToolKind::ExitPlanMode),
            provider_status: existing.provider_status.clone(),
            title: existing
                .title
                .clone()
                .or_else(|| Some("Plan ready".to_string())),
            arguments,
            progressive_arguments: existing.progressive_arguments.clone(),
            result: existing.result.clone(),
            computer_payload: None,
            command: existing.command.clone(),
            normalized_todos: existing.normalized_todos.clone(),
            parent_tool_call_id: existing.parent_tool_call_id.clone(),
            parent_operation_id: existing.parent_operation_id.clone(),
            child_tool_call_ids: existing.child_tool_call_ids.clone(),
            child_operation_ids: existing.child_operation_ids.clone(),
            operation_provenance_key: existing.operation_provenance_key.clone(),
            operation_state: next_operation_state,
            locations: existing.locations.clone(),
            skill_meta: existing.skill_meta.clone(),
            normalized_questions: existing.normalized_questions.clone(),
            question_answer: existing.question_answer.clone(),
            awaiting_plan_approval: true,
            plan_approval_request_id: permission
                .json_rpc_request_id
                .or(existing.plan_approval_request_id),
            started_at_ms: existing.started_at_ms,
            completed_at_ms: existing.completed_at_ms,
            source_link: existing.source_link.clone(),
            degradation_reason: existing.degradation_reason.clone(),
        };
        self.operations_by_id.insert(operation_id, updated);
    }

    pub(crate) fn register_question_interaction(&self, question: &QuestionData) {
        let interaction = InteractionSnapshot {
            id: question.id.clone(),
            session_id: question.session_id.clone(),
            kind: InteractionKind::Question,
            state: InteractionState::Pending,
            json_rpc_request_id: question.json_rpc_request_id,
            reply_handler: question.reply_handler.clone().or_else(|| {
                question
                    .json_rpc_request_id
                    .map(InteractionReplyHandler::json_rpc)
                    .or_else(|| Some(InteractionReplyHandler::http(question.id.clone())))
            }),
            tool_reference: question.tool.clone(),
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::Question(question.clone()),
            canonical_operation_id: question
                .tool
                .as_ref()
                .map(|t| build_canonical_operation_id(&question.session_id, &t.call_id)),
        };
        self.upsert_interaction(interaction);
    }

    pub(crate) fn register_computer_permission_interaction(
        &self,
        permission: ComputerPermissionData,
    ) {
        let canonical_operation_id = permission
            .tool
            .as_ref()
            .map(|tool| build_canonical_operation_id(&permission.session_id, &tool.call_id));
        let interaction = InteractionSnapshot {
            id: permission.id.clone(),
            session_id: permission.session_id.clone(),
            kind: InteractionKind::ComputerPermission,
            state: InteractionState::Pending,
            json_rpc_request_id: None,
            reply_handler: None,
            tool_reference: permission.tool.clone(),
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::ComputerPermission(permission),
            canonical_operation_id,
        };
        self.upsert_interaction(interaction);
    }

    pub(crate) fn register_plan_approval_interaction(
        &self,
        session_id: &str,
        tool_call: &ToolCallData,
    ) {
        if !tool_call.awaiting_plan_approval {
            return;
        }
        let Some(plan_approval_request_id) = tool_call.plan_approval_request_id else {
            return;
        };

        let interaction_id =
            build_plan_approval_interaction_id(session_id, &tool_call.id, plan_approval_request_id);
        let source = if tool_call.kind == Some(ToolKind::ExitPlanMode) {
            PlanApprovalSource::ExitPlanMode
        } else {
            PlanApprovalSource::CreatePlan
        };
        let interaction = InteractionSnapshot {
            id: interaction_id,
            session_id: session_id.to_string(),
            kind: InteractionKind::PlanApproval,
            state: InteractionState::Pending,
            json_rpc_request_id: Some(plan_approval_request_id),
            reply_handler: Some(InteractionReplyHandler::json_rpc(plan_approval_request_id)),
            tool_reference: Some(ToolReference {
                message_id: None,
                call_id: tool_call.id.clone(),
            }),
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::PlanApproval { source },
            canonical_operation_id: Some(build_canonical_operation_id(session_id, &tool_call.id)),
        };
        self.upsert_interaction(interaction);
    }

    pub(crate) fn register_converted_question_interaction(
        &self,
        session_id: &str,
        tool_call: &ToolCallData,
        event_seq: i64,
    ) {
        let question_items =
            if let Some(normalized_questions) = tool_call.normalized_questions.clone() {
                normalized_questions
            } else if let Some(question_answer) = tool_call.question_answer.clone() {
                question_answer.questions
            } else {
                return;
            };

        let question = QuestionData {
            id: tool_call.id.clone(),
            session_id: session_id.to_string(),
            json_rpc_request_id: None,
            reply_handler: Some(InteractionReplyHandler::http(tool_call.id.clone())),
            questions: question_items,
            tool: Some(ToolReference {
                message_id: None,
                call_id: tool_call.id.clone(),
            }),
        };

        let (state, responded_at_event_seq, response) =
            if let Some(question_answer) = tool_call.question_answer.as_ref() {
                let answers = serde_json::to_value(&question_answer.answers).unwrap_or(Value::Null);
                (
                    InteractionState::Answered,
                    Some(event_seq),
                    Some(InteractionResponse::Question { answers }),
                )
            } else {
                (InteractionState::Pending, None, None)
            };

        let interaction = InteractionSnapshot {
            id: question.id.clone(),
            session_id: session_id.to_string(),
            kind: InteractionKind::Question,
            state,
            json_rpc_request_id: None,
            reply_handler: question.reply_handler.clone(),
            tool_reference: question.tool.clone(),
            responded_at_event_seq,
            response,
            payload: InteractionPayload::Question(question),
            canonical_operation_id: Some(build_canonical_operation_id(session_id, &tool_call.id)),
        };
        self.upsert_interaction(interaction);
    }

    pub(crate) fn upsert_interaction(&self, interaction: InteractionSnapshot) {
        let interaction_id = interaction.id.clone();
        let session_id = interaction.session_id.clone();
        let request_id = interaction.json_rpc_request_id;
        self.interactions_by_id
            .insert(interaction_id.clone(), interaction.clone());
        self.block_operation_for_pending_interaction(&interaction);
        if let Some(request_id) = request_id {
            self.interaction_id_by_request_key.insert(
                create_session_request_key(&session_id, request_id),
                interaction_id.clone(),
            );
        }

        let mut interaction_ids = self.session_interaction_ids.entry(session_id).or_default();
        if interaction_ids
            .iter()
            .any(|candidate| candidate == &interaction_id)
        {
            return;
        }

        interaction_ids.push(interaction_id);
    }
}
