use super::projection_apply_router::{
    route_projection_apply, ProjectionApplyArm, ProjectionApplyRoute,
};
use super::*;

impl ProjectionRegistry {
    pub fn new() -> Self {
        Self {
            snapshots: Arc::new(DashMap::new()),
            operations_by_id: Arc::new(DashMap::new()),
            operation_id_by_tool_key: Arc::new(DashMap::new()),
            session_operation_ids: Arc::new(DashMap::new()),
            last_cancelled_operation_ids: Arc::new(DashMap::new()),
            interactions_by_id: Arc::new(DashMap::new()),
            interaction_id_by_request_key: Arc::new(DashMap::new()),
            session_interaction_ids: Arc::new(DashMap::new()),
        }
    }

    pub fn register_session(&self, session_id: String, agent_id: CanonicalAgentId) {
        let _ = self
            .snapshots
            .entry(session_id.clone())
            .and_modify(|snapshot| {
                snapshot.agent_id = Some(agent_id.clone());
            })
            .or_insert_with(|| SessionSnapshot::new(session_id, Some(agent_id)));
    }

    pub fn restore_session_projection(&self, projection: SessionProjectionSnapshot) {
        let session_id = projection
            .session
            .as_ref()
            .map(|session| session.session_id.clone())
            .or_else(|| {
                projection
                    .operations
                    .first()
                    .map(|operation| operation.session_id.clone())
            })
            .or_else(|| {
                projection
                    .interactions
                    .first()
                    .map(|interaction| interaction.session_id.clone())
            });
        let Some(session_id) = session_id else {
            return;
        };

        self.remove_session(&session_id);
        if let Some(session) = projection.session {
            self.snapshots.insert(session_id.clone(), session);
        }
        for operation in projection.operations {
            let operation_id = operation.id.clone();
            let operation = self
                .operations_by_id
                .get(&operation_id)
                .map(|existing| merge_operation_snapshot_evidence(&existing, operation.clone()))
                .unwrap_or(operation);
            self.operations_by_id
                .insert(operation.id.clone(), operation.clone());
            self.operation_id_by_tool_key.insert(
                create_session_tool_key(&session_id, &operation.tool_call_id),
                operation.id.clone(),
            );
            if let Some(provenance_key) = operation.operation_provenance_key.as_ref() {
                self.operation_id_by_tool_key.insert(
                    create_session_tool_key(&session_id, provenance_key),
                    operation.id.clone(),
                );
            }
            self.insert_session_operation_id(&session_id, &operation.id);
        }
        for interaction in projection.interactions {
            self.upsert_interaction(interaction);
        }
    }

    #[must_use]
    pub fn project_thread_snapshot(
        session_id: &str,
        agent_id: Option<CanonicalAgentId>,
        thread_snapshot: &SessionThreadSnapshot,
    ) -> SessionProjectionSnapshot {
        let registry = Self::new();
        registry.import_thread_snapshot(session_id, agent_id, thread_snapshot);
        registry.session_projection(session_id)
    }

    pub fn remove_session(&self, session_id: &str) {
        self.snapshots.remove(session_id);
        self.last_cancelled_operation_ids.remove(session_id);
        if let Some((_, operation_ids)) = self.session_operation_ids.remove(session_id) {
            for operation_id in operation_ids {
                if let Some((_, operation)) = self.operations_by_id.remove(&operation_id) {
                    self.operation_id_by_tool_key
                        .remove(&create_session_tool_key(
                            session_id,
                            &operation.tool_call_id,
                        ));
                    if let Some(provenance_key) = operation.operation_provenance_key.as_ref() {
                        self.operation_id_by_tool_key
                            .remove(&create_session_tool_key(session_id, provenance_key));
                    }
                }
            }
        }
        if let Some((_, interaction_ids)) = self.session_interaction_ids.remove(session_id) {
            for interaction_id in interaction_ids {
                if let Some((_, interaction)) = self.interactions_by_id.remove(&interaction_id) {
                    if let Some(request_id) = interaction.json_rpc_request_id {
                        self.interaction_id_by_request_key
                            .remove(&create_session_request_key(session_id, request_id));
                    }
                }
            }
        }
    }

    #[must_use]
    pub fn snapshot_for_session(&self, session_id: &str) -> Option<SessionSnapshot> {
        self.snapshots.get(session_id).map(|entry| entry.clone())
    }

    #[cfg(test)]
    pub(crate) fn set_last_event_seq_for_test(&self, session_id: &str, last_event_seq: i64) {
        if let Some(mut snapshot) = self.snapshots.get_mut(session_id) {
            snapshot.last_event_seq = last_event_seq;
        }
    }

    pub fn apply_session_update(&self, session_id: &str, update: &SessionUpdate) {
        let mut snapshot = self
            .snapshots
            .entry(session_id.to_string())
            .or_insert_with(|| SessionSnapshot::new(session_id.to_string(), None));

        snapshot.last_event_seq = snapshot.last_event_seq.saturating_add(1);

        let mut guard = TerminalTurnGuard::from_snapshot(&snapshot);
        let route = route_projection_apply(update, &guard);
        if let ProjectionApplyRoute::Apply(arm) = route {
            self.dispatch_projection_apply(session_id, update, &mut snapshot, arm);
            guard.advance(update);
        }
        guard.write_to_snapshot(&mut snapshot);
    }

    /// Pre-apply terminal-turn decision for live transcript dispatch (decide-then-advance).
    #[must_use]
    pub fn route_terminal_turn(&self, session_id: &str, update: &SessionUpdate) -> RouteDecision {
        let guard = self
            .snapshots
            .get(session_id)
            .map(|entry| TerminalTurnGuard::from_snapshot(&entry))
            .unwrap_or_else(|| TerminalTurnGuard::default());
        guard.route(update)
    }

    fn dispatch_projection_apply(
        &self,
        session_id: &str,
        update: &SessionUpdate,
        snapshot: &mut SessionSnapshot,
        arm: ProjectionApplyArm,
    ) {
        match arm {
            ProjectionApplyArm::UserMessageChunk => {
                snapshot.message_count = snapshot.message_count.saturating_add(1);
                snapshot.transcript_entry_count = snapshot.transcript_entry_count.saturating_add(1);
                snapshot.assistant_boundary_entry_count = snapshot.transcript_entry_count;
            }
            ProjectionApplyArm::AgentMessageChunk => {
                snapshot.message_count = snapshot.message_count.saturating_add(1);
                if snapshot.transcript_entry_count == snapshot.assistant_boundary_entry_count {
                    snapshot.transcript_entry_count =
                        snapshot.transcript_entry_count.saturating_add(1);
                }
            }
            ProjectionApplyArm::AgentThoughtChunk => {
                if snapshot.transcript_entry_count == snapshot.assistant_boundary_entry_count {
                    snapshot.transcript_entry_count =
                        snapshot.transcript_entry_count.saturating_add(1);
                }
            }
            ProjectionApplyArm::ToolCallAsConvertedQuestion => {
                let SessionUpdate::ToolCall { tool_call, .. } = update else {
                    return;
                };
                let tool_call = normalize_tool_call_for_operation_ingress(tool_call);
                self.register_converted_question_interaction(
                    session_id,
                    &tool_call,
                    snapshot.last_event_seq,
                );
            }
            ProjectionApplyArm::ToolCall => {
                let SessionUpdate::ToolCall { tool_call, .. } = update else {
                    return;
                };
                let entry_id = live_tool_entry_id_for_tool_call(
                    snapshot.assistant_boundary_entry_count,
                    &tool_call.id,
                );
                let tool_call = normalize_tool_call_for_operation_ingress(tool_call);
                upsert_active_tool_call(&mut snapshot.active_tool_call_ids, &tool_call.id);
                if is_terminal_tool_call_status(&tool_call.status) {
                    mark_tool_call_completed(snapshot, &tool_call.id);
                }
                self.upsert_tool_call_projection(
                    session_id,
                    &tool_call,
                    None,
                    tool_call.parent_tool_use_id.clone(),
                    OperationSourceLink::transcript_linked(entry_id),
                );
                self.register_plan_approval_interaction(session_id, &tool_call);
                snapshot.transcript_entry_count = snapshot.transcript_entry_count.saturating_add(1);
                snapshot.assistant_boundary_entry_count = snapshot.transcript_entry_count;
            }
            ProjectionApplyArm::ToolCallUpdate => {
                let SessionUpdate::ToolCallUpdate { update, .. } = update else {
                    return;
                };
                let update = normalize_tool_call_update_for_operation_ingress(update);
                upsert_active_tool_call(&mut snapshot.active_tool_call_ids, &update.tool_call_id);
                if update
                    .status
                    .as_ref()
                    .is_some_and(is_terminal_tool_call_status)
                {
                    mark_tool_call_completed(snapshot, &update.tool_call_id);
                }
                self.apply_tool_call_update_projection(session_id, &update);
            }
            ProjectionApplyArm::PermissionRequest => {
                let SessionUpdate::PermissionRequest { permission, .. } = update else {
                    return;
                };
                self.register_permission_interaction(permission, snapshot.last_event_seq);
            }
            ProjectionApplyArm::QuestionRequest => {
                let SessionUpdate::QuestionRequest { question, .. } = update else {
                    return;
                };
                self.register_question_interaction(question);
            }
            ProjectionApplyArm::TurnComplete => {
                let SessionUpdate::TurnComplete { .. } = update else {
                    return;
                };
                snapshot.active_tool_call_ids.clear();
            }
            ProjectionApplyArm::TurnError => {
                let SessionUpdate::TurnError { .. } = update else {
                    return;
                };
                snapshot.active_tool_call_ids.clear();
            }
            ProjectionApplyArm::TurnCancelled => {
                let SessionUpdate::TurnCancelled { .. } = update else {
                    return;
                };
                let cancelled_operation_ids =
                    self.cancel_active_tool_calls(session_id, &snapshot.active_tool_call_ids);
                self.last_cancelled_operation_ids
                    .insert(session_id.to_string(), cancelled_operation_ids);
                snapshot.active_tool_call_ids.clear();
            }
        }
    }

    pub fn apply_session_update_at_event_seq(
        &self,
        session_id: &str,
        event_seq: i64,
        update: &SessionUpdate,
    ) {
        if event_seq <= 0 {
            self.apply_session_update(session_id, update);
            return;
        }

        {
            let mut snapshot = self
                .snapshots
                .entry(session_id.to_string())
                .or_insert_with(|| SessionSnapshot::new(session_id.to_string(), None));
            if event_seq <= snapshot.last_event_seq {
                return;
            }
            snapshot.last_event_seq = event_seq.saturating_sub(1);
        }

        self.apply_session_update(session_id, update);

        if let Some(mut snapshot) = self.snapshots.get_mut(session_id) {
            snapshot.last_event_seq = event_seq;
        }
    }

    /// Single canonical entrypoint for applying a live domain event to all read models.
    ///
    /// **Idempotency**: if `event.seq > 0` and the session snapshot shows that `event.seq` is
    /// ≤ `last_event_seq`, the event has already been applied (duplicate delivery or stale
    /// out-of-order arrival) and is silently dropped.
    ///
    /// **Ordering**: after a successful application the session's `last_event_seq` is advanced
    /// to `event.seq` so subsequent duplicate delivery is rejected.
    ///
    /// **Projection bridge**: projection state is applied through `apply_session_update` using
    /// the paired raw `SessionUpdate`. This is intentional: the canonical domain event payload
    /// is a sequenced notification (lean identity + status only), not a full snapshot. The raw
    /// update carries the data needed by the low-level projection reducers (tool arguments,
    /// title, result, children). The canonical event provides the idempotency/ordering wrapper.
    pub fn apply_canonical_event(
        &self,
        session_id: &str,
        event: &crate::acp::domain_events::SessionDomainEvent,
        raw_update: &SessionUpdate,
    ) {
        // Idempotency gate: skip if this canonical seq has already been applied.
        if event.seq > 0 {
            if let Some(snapshot) = self.snapshots.get(session_id) {
                if event.seq <= snapshot.last_event_seq {
                    return;
                }
            }
        }

        // Apply projection state through the existing reducer bridge at the canonical
        // event frontier so transcript-linked operation ids match transcript rows.
        self.apply_session_update_at_event_seq(session_id, event.seq, raw_update);

        // Advance last_event_seq to the canonical sequence frontier so future
        // duplicates are rejected.  This overwrites the auto-incremented value
        // set by apply_session_update above.
        if event.seq > 0 {
            if let Some(mut snapshot) = self.snapshots.get_mut(session_id) {
                snapshot.last_event_seq = event.seq;
            }
        }
    }
}
