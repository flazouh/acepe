use super::*;

impl ProjectionRegistry {

    #[must_use]
    pub fn operation_for_tool_call(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> Option<OperationSnapshot> {
        let operation_id = self.lookup_operation_id_by_tool_call(session_id, tool_call_id)?;
        self.operations_by_id
            .get(&operation_id)
            .map(|snapshot| snapshot.clone())
    }

    pub fn relink_tool_call_to_transcript_entry(
        &self,
        session_id: &str,
        tool_call_id: &str,
        entry_id: &str,
    ) {
        let Some(operation_id) = self.lookup_operation_id_by_tool_call(session_id, tool_call_id)
        else {
            return;
        };
        if let Some(mut operation) = self.operations_by_id.get_mut(&operation_id) {
            operation.source_link =
                OperationSourceLink::transcript_linked(entry_id.to_string());
        }
    }

    pub(crate) fn lookup_operation_id_by_tool_call(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> Option<String> {
        let direct_key = create_session_tool_key(session_id, tool_call_id);
        if let Some(operation_id) = self.operation_id_by_tool_key.get(&direct_key) {
            return Some(operation_id.value().clone());
        }

        let normalized_tool_call_id = normalize_operation_ingress_tool_call_id(tool_call_id);
        if normalized_tool_call_id == tool_call_id {
            return None;
        }

        self.operation_id_by_tool_key
            .get(&create_session_tool_key(
                session_id,
                &normalized_tool_call_id,
            ))
            .map(|operation_id| operation_id.value().clone())
    }

    #[must_use]
    pub fn operation(&self, operation_id: &str) -> Option<OperationSnapshot> {
        self.operations_by_id
            .get(operation_id)
            .map(|snapshot| snapshot.clone())
    }

    #[must_use]
    pub fn session_operations(&self, session_id: &str) -> Vec<OperationSnapshot> {
        let Some(operation_ids) = self.session_operation_ids.get(session_id) else {
            return Vec::new();
        };

        operation_ids
            .iter()
            .filter_map(|operation_id| {
                self.operations_by_id
                    .get(operation_id)
                    .map(|snapshot| snapshot.clone())
            })
            .collect()
    }

    #[must_use]
    pub fn last_cancelled_operation_patches(&self, session_id: &str) -> Vec<OperationSnapshot> {
        let Some(operation_ids) = self.last_cancelled_operation_ids.get(session_id) else {
            return Vec::new();
        };

        operation_ids
            .iter()
            .filter_map(|operation_id| {
                self.operations_by_id
                    .get(operation_id)
                    .map(|snapshot| snapshot.clone())
            })
            .collect()
    }

    #[must_use]
    pub fn interaction(&self, interaction_id: &str) -> Option<InteractionSnapshot> {
        self.interactions_by_id
            .get(interaction_id)
            .map(|interaction| interaction.clone())
    }

    #[must_use]
    pub fn session_interactions(&self, session_id: &str) -> Vec<InteractionSnapshot> {
        let Some(interaction_ids) = self.session_interaction_ids.get(session_id) else {
            return Vec::new();
        };

        interaction_ids
            .iter()
            .filter_map(|interaction_id| {
                self.interactions_by_id
                    .get(interaction_id)
                    .map(|interaction| interaction.clone())
            })
            .collect()
    }

    #[must_use]
    pub fn session_projection(&self, session_id: &str) -> SessionProjectionSnapshot {
        SessionProjectionSnapshot {
            session: self.snapshot_for_session(session_id),
            operations: self.session_operations(session_id),
            interactions: self.session_interactions(session_id),
            runtime: None,
        }
    }

    #[must_use]
    pub fn interaction_for_request_id(
        &self,
        session_id: &str,
        request_id: u64,
    ) -> Option<InteractionSnapshot> {
        let interaction_id = self
            .interaction_id_by_request_key
            .get(&create_session_request_key(session_id, request_id))
            .map(|entry| entry.value().clone())?;
        self.interaction(&interaction_id)
    }

    pub fn resolve_interaction(
        &self,
        session_id: &str,
        interaction_id: &str,
        state: InteractionState,
        response: InteractionResponse,
    ) -> Option<InteractionSnapshot> {
        let responded_at_event_seq = self.advance_session_event_seq(session_id);
        let mut interaction = self
            .interactions_by_id
            .get(interaction_id)
            .map(|entry| entry.clone())?;
        if interaction.session_id != session_id {
            return None;
        }

        interaction.state = state;
        interaction.responded_at_event_seq = Some(responded_at_event_seq);
        interaction.response = Some(response);
        self.interactions_by_id
            .insert(interaction_id.to_string(), interaction.clone());
        self.advance_operation_after_interaction_resolution(&interaction);
        Some(interaction)
    }

    pub fn import_interaction_snapshot(&self, interaction: InteractionSnapshot) {
        self.upsert_interaction(interaction);
    }

    pub fn import_interaction_snapshot_at_event_seq(
        &self,
        interaction: InteractionSnapshot,
        event_seq: i64,
    ) {
        let session_id = interaction.session_id.clone();
        self.upsert_interaction(interaction);
        let mut snapshot = self
            .snapshots
            .entry(session_id.clone())
            .or_insert_with(|| SessionSnapshot::new(session_id, None));
        snapshot.last_event_seq = snapshot.last_event_seq.max(event_seq);
    }

    pub fn resolve_interaction_by_request_id(
        &self,
        session_id: &str,
        request_id: u64,
        state: InteractionState,
        response: InteractionResponse,
    ) -> Option<InteractionSnapshot> {
        let interaction_id = self
            .interaction_id_by_request_key
            .get(&create_session_request_key(session_id, request_id))
            .map(|entry| entry.value().clone())?;
        self.resolve_interaction(session_id, &interaction_id, state, response)
    }

    pub(crate) fn import_thread_snapshot(
        &self,
        session_id: &str,
        agent_id: Option<CanonicalAgentId>,
        thread_snapshot: &SessionThreadSnapshot,
    ) {
        let mut snapshot = SessionSnapshot::new(session_id.to_string(), agent_id);
        let mut assistant_boundary_entry_count = 0usize;
        let mut transcript_entry_count = 0usize;
        let mut seen_tool_call_ids = std::collections::HashSet::new();

        for entry in &thread_snapshot.entries {
            snapshot.last_event_seq = snapshot.last_event_seq.saturating_add(1);

            match entry {
                StoredEntry::User { .. } => {
                    self.cancel_active_tool_calls_for_historical_boundary(
                        session_id,
                        &snapshot.active_tool_call_ids,
                    );
                    snapshot.active_tool_call_ids.clear();
                    if snapshot.active_turn_failure.is_some() {
                        let mut guard = TerminalTurnGuard::from_snapshot(&snapshot);
                        guard.reset_to_running_turn();
                        guard.write_to_snapshot(&mut snapshot);
                    }
                    snapshot.message_count = snapshot.message_count.saturating_add(1);
                    note_imported_transcript_boundary(
                        TranscriptEntryRole::User,
                        &mut transcript_entry_count,
                        &mut assistant_boundary_entry_count,
                    );
                }
                StoredEntry::Assistant { .. } => {
                    self.cancel_active_tool_calls_for_historical_boundary(
                        session_id,
                        &snapshot.active_tool_call_ids,
                    );
                    snapshot.active_tool_call_ids.clear();
                    if snapshot.active_turn_failure.is_some() {
                        let mut guard = TerminalTurnGuard::from_snapshot(&snapshot);
                        guard.reset_to_running_turn();
                        guard.write_to_snapshot(&mut snapshot);
                    }
                    snapshot.message_count = snapshot.message_count.saturating_add(1);
                    note_imported_transcript_boundary(
                        TranscriptEntryRole::Assistant,
                        &mut transcript_entry_count,
                        &mut assistant_boundary_entry_count,
                    );
                }
                StoredEntry::ToolCall { message, .. } => {
                    let message = normalize_tool_call_for_operation_ingress(message);
                    if should_skip_unanswered_question_tool_operation(&message) {
                        continue;
                    }
                    let normalized_tool_call_id = normalize_tool_call_id(&message.id);
                    if !seen_tool_call_ids.insert(normalized_tool_call_id) {
                        continue;
                    }
                    if snapshot.active_turn_failure.is_some() {
                        let mut guard = TerminalTurnGuard::from_snapshot(&snapshot);
                        guard.reset_to_running_turn();
                        guard.write_to_snapshot(&mut snapshot);
                    }
                    upsert_active_tool_call(&mut snapshot.active_tool_call_ids, &message.id);
                    if is_terminal_tool_call_status(&message.status) {
                        mark_tool_call_completed(&mut snapshot, &message.id);
                    }

                    let entry_id = live_tool_entry_id_for_tool_call(
                        assistant_boundary_entry_count,
                        &message.id,
                    );
                    self.upsert_tool_call_projection(
                        session_id,
                        &message,
                        None,
                        message.parent_tool_use_id.clone(),
                        OperationSourceLink::transcript_linked(entry_id),
                    );
                    self.register_plan_approval_interaction(session_id, &message);
                    self.register_converted_question_interaction(
                        session_id,
                        &message,
                        snapshot.last_event_seq,
                    );
                    note_imported_transcript_boundary(
                        TranscriptEntryRole::Tool,
                        &mut transcript_entry_count,
                        &mut assistant_boundary_entry_count,
                    );
                }
                StoredEntry::Error { message, .. } => {
                    snapshot.active_turn_failure = Some(convert_stored_error_snapshot(message));
                    snapshot.last_terminal_turn_id = None;
                    snapshot.active_tool_call_ids.clear();
                    note_imported_transcript_boundary(
                        TranscriptEntryRole::Error,
                        &mut transcript_entry_count,
                        &mut assistant_boundary_entry_count,
                    );
                }
            }
        }

        if snapshot.active_turn_failure.is_some() {
            snapshot.turn_state = SessionTurnState::Failed;
        } else if !snapshot.active_tool_call_ids.is_empty() {
            snapshot.turn_state = SessionTurnState::Running;
        } else if snapshot.last_event_seq > 0 {
            snapshot.turn_state = SessionTurnState::Completed;
        }

        self.snapshots.insert(session_id.to_string(), snapshot);
    }

    pub(crate) fn upsert_tool_call_projection(
        &self,
        session_id: &str,
        tool_call: &ToolCallData,
        parent_operation_id: Option<String>,
        parent_tool_call_id: Option<String>,
        source_link: OperationSourceLink,
    ) -> OperationSnapshot {
        let normalized_tool_call = normalize_tool_call_for_operation_ingress(tool_call);
        let tool_call = &normalized_tool_call;
        let parent_tool_call_id =
            parent_tool_call_id.map(|id| normalize_operation_ingress_tool_call_id(&id));
        let operation_id = match build_validated_canonical_operation_id(session_id, &tool_call.id) {
            Ok(operation_id) => operation_id,
            Err(_) => {
                return self.upsert_rejected_tool_call_projection(
                    session_id,
                    tool_call,
                    parent_operation_id,
                    parent_tool_call_id,
                    OperationDegradationReason {
                        code: OperationDegradationCode::InvalidProvenanceKey,
                        detail: Some("Operation provenance key failed validation".to_string()),
                    },
                    source_link,
                );
            }
        };
        let existing = self
            .operations_by_id
            .get(&operation_id)
            .map(|operation| operation.clone());
        if existing.is_none() && !self.can_insert_operation(session_id) {
            return rejected_operation_snapshot(
                build_rejected_operation_id(session_id, &tool_call.id),
                session_id,
                tool_call,
                parent_operation_id,
                parent_tool_call_id,
                OperationDegradationReason {
                    code: OperationDegradationCode::MissingEvidence,
                    detail: Some(format!(
                        "Session operation limit of {MAX_SESSION_OPERATIONS} was reached"
                    )),
                },
                source_link,
            );
        }
        let resolved_parent_tool_call_id =
            tool_call.parent_tool_use_id.clone().or(parent_tool_call_id);
        let mut child_tool_call_ids = Vec::new();
        let mut child_operation_ids = Vec::new();

        if let Some(children) = tool_call.task_children.as_ref() {
            for child in children {
                let child_operation = self.upsert_tool_call_projection(
                    session_id,
                    child,
                    Some(operation_id.clone()),
                    Some(tool_call.id.clone()),
                    OperationSourceLink::synthetic("task_child_operation"),
                );
                child_tool_call_ids.push(child.id.clone());
                child_operation_ids.push(child_operation.id);
            }
        }
        let arguments = enrich_read_arguments_from_filesystem(tool_call.arguments.clone());

        let derived_operation_state = derive_operation_state(&tool_call.status);
        let mut new_operation_state = match existing.as_ref() {
            Some(operation) if is_terminal_operation_state(&operation.operation_state) => {
                operation.operation_state.clone()
            }
            _ => derived_operation_state.clone(),
        };
        if !is_terminal_operation_state(&new_operation_state)
            && self.has_pending_blocking_interaction_for_operation(session_id, &operation_id)
        {
            new_operation_state = OperationState::Blocked;
        }
        let operation = OperationSnapshot {
            id: operation_id.clone(),
            session_id: session_id.to_string(),
            tool_call_id: tool_call.id.clone(),
            name: tool_call.name.clone(),
            kind: tool_call.kind,
            provider_status: tool_call.status.clone(),
            title: tool_call.title.clone(),
            arguments: arguments.clone(),
            progressive_arguments: existing
                .as_ref()
                .and_then(|operation| operation.progressive_arguments.clone()),
            result: tool_call.result.clone(),
            command: extract_operation_command(
                Some(&arguments),
                existing
                    .as_ref()
                    .and_then(|operation| operation.progressive_arguments.as_ref()),
                tool_call.title.as_deref(),
            ),
            normalized_todos: tool_call.normalized_todos.clone(),
            parent_tool_call_id: resolved_parent_tool_call_id,
            parent_operation_id,
            child_tool_call_ids,
            child_operation_ids,
            operation_provenance_key: Some(tool_call.id.clone()),
            operation_state: new_operation_state,
            locations: tool_call
                .locations
                .clone()
                .or_else(|| existing.as_ref().and_then(|e| e.locations.clone())),
            skill_meta: tool_call
                .skill_meta
                .clone()
                .or_else(|| existing.as_ref().and_then(|e| e.skill_meta.clone())),
            normalized_questions: tool_call.normalized_questions.clone().or_else(|| {
                existing
                    .as_ref()
                    .and_then(|e| e.normalized_questions.clone())
            }),
            question_answer: tool_call
                .question_answer
                .clone()
                .or_else(|| existing.as_ref().and_then(|e| e.question_answer.clone())),
            awaiting_plan_approval: tool_call.awaiting_plan_approval,
            plan_approval_request_id: tool_call.plan_approval_request_id,
            started_at_ms: None,
            completed_at_ms: None,
            source_link,
            degradation_reason: None,
        };

        let operation = existing
            .as_ref()
            .map(|existing| merge_operation_snapshot_evidence(existing, operation.clone()))
            .unwrap_or(operation);

        self.operations_by_id
            .insert(operation_id.clone(), operation.clone());
        self.operation_id_by_tool_key.insert(
            create_session_tool_key(session_id, &tool_call.id),
            operation_id.clone(),
        );
        if let Some(provenance_key) = operation.operation_provenance_key.as_ref() {
            self.operation_id_by_tool_key.insert(
                create_session_tool_key(session_id, provenance_key),
                operation_id.clone(),
            );
        }
        self.insert_session_operation_id(session_id, &operation_id);

        operation
    }

    pub(crate) fn cancel_active_tool_calls_for_historical_boundary(
        &self,
        session_id: &str,
        active_tool_call_ids: &[String],
    ) {
        let _ = self.cancel_active_tool_calls(session_id, active_tool_call_ids);
    }

    pub(crate) fn cancel_active_tool_calls(
        &self,
        session_id: &str,
        active_tool_call_ids: &[String],
    ) -> Vec<String> {
        self.mark_pending_interactions_unresolved_for_historical_boundary(
            session_id,
            active_tool_call_ids,
        );
        let mut cancelled_operation_ids = Vec::new();
        for tool_call_id in active_tool_call_ids {
            let Some(operation_id) = self
                .operation_id_by_tool_key
                .get(&create_session_tool_key(session_id, tool_call_id))
                .map(|entry| entry.value().clone())
            else {
                continue;
            };
            if let Some(mut operation) = self.operations_by_id.get_mut(&operation_id) {
                if !is_terminal_operation_state(&operation.operation_state) {
                    operation.operation_state = OperationState::Cancelled;
                    cancelled_operation_ids.push(operation_id);
                }
            }
        }
        cancelled_operation_ids
    }

    pub(crate) fn mark_pending_interactions_unresolved_for_historical_boundary(
        &self,
        session_id: &str,
        active_tool_call_ids: &[String],
    ) {
        let Some(interaction_ids) = self.session_interaction_ids.get(session_id) else {
            return;
        };
        let interaction_ids: Vec<String> = interaction_ids.iter().cloned().collect();

        for interaction_id in interaction_ids {
            let Some(mut interaction) = self.interactions_by_id.get_mut(&interaction_id) else {
                continue;
            };
            if interaction.state != InteractionState::Pending {
                continue;
            }
            let Some(tool_reference) = interaction.tool_reference.as_ref() else {
                continue;
            };
            if !active_tool_call_ids
                .iter()
                .any(|tool_call_id| tool_call_id == &tool_reference.call_id)
            {
                continue;
            }

            interaction.state = InteractionState::Unresolved;
            interaction.reply_handler = None;
        }
    }

    pub(crate) fn upsert_rejected_tool_call_projection(
        &self,
        session_id: &str,
        tool_call: &ToolCallData,
        parent_operation_id: Option<String>,
        parent_tool_call_id: Option<String>,
        degradation_reason: OperationDegradationReason,
        source_link: OperationSourceLink,
    ) -> OperationSnapshot {
        let operation_id = build_rejected_operation_id(session_id, &tool_call.id);
        let existing = self
            .operations_by_id
            .get(&operation_id)
            .map(|operation| operation.clone());

        if existing.is_none() && !self.can_insert_operation(session_id) {
            return rejected_operation_snapshot(
                operation_id,
                session_id,
                tool_call,
                parent_operation_id,
                parent_tool_call_id,
                OperationDegradationReason {
                    code: OperationDegradationCode::MissingEvidence,
                    detail: Some(format!(
                        "Session operation limit of {MAX_SESSION_OPERATIONS} was reached"
                    )),
                },
                source_link,
            );
        }

        let operation = rejected_operation_snapshot(
            operation_id.clone(),
            session_id,
            tool_call,
            parent_operation_id,
            parent_tool_call_id,
            degradation_reason,
            source_link,
        );
        let operation = existing
            .as_ref()
            .map(|existing| merge_operation_snapshot_evidence(existing, operation.clone()))
            .unwrap_or(operation);

        self.operations_by_id
            .insert(operation_id.clone(), operation.clone());
        self.operation_id_by_tool_key.insert(
            create_session_tool_key(session_id, &tool_call.id),
            operation_id.clone(),
        );
        self.insert_session_operation_id(session_id, &operation_id);

        operation
    }

    pub(crate) fn apply_tool_call_update_projection(&self, session_id: &str, update: &ToolCallUpdateData) {
        let Some(operation_id) =
            self.lookup_operation_id_by_tool_call(session_id, &update.tool_call_id)
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

        let next_status = if is_claude_resumed_missing_tool_result_update(update) {
            ToolCallStatus::Completed
        } else {
            update
                .status
                .clone()
                .unwrap_or(existing.provider_status.clone())
        };
        let next_arguments =
            merge_update_arguments_with_existing(&existing.arguments, update.arguments.as_ref());
        let next_arguments = enrich_read_arguments_with_update_output(next_arguments, update);
        let next_progressive_arguments =
            if let Some(streaming_arguments) = update.streaming_arguments.clone() {
                Some(streaming_arguments)
            } else if update.arguments.is_some()
                || update
                    .status
                    .as_ref()
                    .is_some_and(is_terminal_tool_call_status)
            {
                None
            } else {
                existing.progressive_arguments.clone()
            };
        let next_title = update.title.clone().or(existing.title.clone());
        let next_result = update.result.clone().or(existing.result.clone());
        let next_normalized_todos = update
            .normalized_todos
            .clone()
            .or(existing.normalized_todos.clone());

        let derived_state = derive_operation_state(&next_status);
        let mut next_operation_state = if is_terminal_operation_state(&existing.operation_state) {
            existing.operation_state.clone()
        } else {
            derived_state
        };
        if !is_terminal_operation_state(&next_operation_state)
            && self.has_pending_blocking_interaction_for_operation(session_id, &operation_id)
        {
            next_operation_state = OperationState::Blocked;
        }

        let updated_operation = OperationSnapshot {
            id: existing.id.clone(),
            session_id: existing.session_id.clone(),
            tool_call_id: existing.tool_call_id.clone(),
            name: existing.name.clone(),
            kind: existing.kind,
            provider_status: next_status,
            title: next_title.clone(),
            arguments: next_arguments.clone(),
            progressive_arguments: next_progressive_arguments.clone(),
            result: next_result,
            command: extract_operation_command(
                Some(&next_arguments),
                next_progressive_arguments.as_ref(),
                next_title.as_deref(),
            ),
            normalized_todos: next_normalized_todos,
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
            awaiting_plan_approval: existing.awaiting_plan_approval,
            plan_approval_request_id: existing.plan_approval_request_id,
            started_at_ms: existing.started_at_ms,
            completed_at_ms: existing.completed_at_ms,
            source_link: existing.source_link.clone(),
            degradation_reason: existing.degradation_reason.clone(),
        };
        let merged_operation = merge_operation_snapshot_evidence(&existing, updated_operation);
        self.operations_by_id.insert(operation_id, merged_operation);
    }

}

fn note_imported_transcript_boundary(
    role: TranscriptEntryRole,
    transcript_entry_count: &mut usize,
    assistant_boundary_entry_count: &mut usize,
) {
    *transcript_entry_count = transcript_entry_count.saturating_add(1);
    if !matches!(role, TranscriptEntryRole::Assistant) {
        *assistant_boundary_entry_count = *transcript_entry_count;
    }
}
