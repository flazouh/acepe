use crate::acp::client_session::SessionModes;
use crate::acp::lifecycle::SessionSupervisor;
use crate::acp::lifecycle::{FailureReason, LifecycleCheckpoint, LifecycleState};
use crate::acp::projections::{ProjectionRegistry, SessionSnapshot};
use crate::acp::session_state_engine::frontier::{
    decide_frontier_transition, SessionFrontierDecision,
};
use crate::acp::session_state_engine::graph::select_active_streaming_tail;
use crate::acp::session_state_engine::protocol::AssistantTextDeltaPayload;
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::{
    build_delta_envelope, CapabilityPreviewState, DeltaEnvelopeParts, DeltaSessionProjectionFields,
    SessionGraphRevision, SessionStateEnvelope, SessionStatePayload,
};
use crate::acp::session_update::{sanitize_config_options_for_canonical, SessionUpdate};
use crate::acp::transcript_projection::{
    TranscriptDelta, TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole,
    TranscriptProjectionRegistry, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug)]
struct SessionAnchor {
    started_at: Instant,
}

impl SessionAnchor {
    fn new() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }

    fn elapsed_ms(&self) -> u64 {
        let elapsed = self.started_at.elapsed();
        u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SessionGraphRuntimeSnapshot {
    pub graph_revision: i64,
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
}

impl Default for SessionGraphRuntimeSnapshot {
    fn default() -> Self {
        Self {
            graph_revision: 0,
            lifecycle: SessionGraphLifecycle::idle(),
            capabilities: SessionGraphCapabilities::empty(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionGraphRuntimeRegistry {
    supervisor: Arc<SessionSupervisor>,
    session_anchors: Arc<Mutex<HashMap<String, Arc<SessionAnchor>>>>,
}

#[derive(Clone, Copy)]
pub struct LiveSessionStateEnvelopeRequest<'a> {
    pub db: &'a DbConn,
    pub session_id: &'a str,
    pub update: &'a SessionUpdate,
    pub previous_revision: SessionGraphRevision,
    pub revision: SessionGraphRevision,
    pub projection_registry: &'a ProjectionRegistry,
    pub transcript_projection_registry: &'a TranscriptProjectionRegistry,
    pub transcript_delta: Option<&'a TranscriptDelta>,
}

impl SessionGraphRuntimeRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::with_supervisor(Arc::new(SessionSupervisor::new()))
    }

    #[must_use]
    pub fn with_supervisor(supervisor: Arc<SessionSupervisor>) -> Self {
        Self {
            supervisor,
            session_anchors: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns ms elapsed since the session anchor (created on first call).
    /// Monotonic per session under a single registry instance.
    pub fn record_chunk_timestamp(&self, session_id: &str) -> u64 {
        self.anchor_for(session_id).elapsed_ms()
    }

    fn anchor_for(&self, session_id: &str) -> Arc<SessionAnchor> {
        let mut guard = self
            .session_anchors
            .lock()
            .expect("session_anchors mutex poisoned");
        guard
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(SessionAnchor::new()))
            .clone()
    }

    #[must_use]
    pub fn supervisor(&self) -> &Arc<SessionSupervisor> {
        &self.supervisor
    }

    #[must_use]
    pub fn snapshot_for_session(&self, session_id: &str) -> SessionGraphRuntimeSnapshot {
        self.supervisor
            .snapshot_for_session(session_id)
            .map(|checkpoint| SessionGraphRuntimeSnapshot::from_checkpoint(&checkpoint))
            .unwrap_or_default()
    }

    pub fn restore_session_state(
        &self,
        session_id: String,
        graph_revision: i64,
        lifecycle: SessionGraphLifecycle,
        capabilities: SessionGraphCapabilities,
    ) {
        let checkpoint = SessionGraphRuntimeSnapshot {
            graph_revision,
            lifecycle,
            capabilities,
        }
        .into_checkpoint();
        if !self
            .supervisor
            .replace_checkpoint(session_id.clone(), checkpoint.clone())
        {
            let _ = self.supervisor.seed_checkpoint(session_id, checkpoint);
        }
    }

    pub fn remove_session(&self, session_id: &str) {
        self.supervisor.remove_session(session_id);
    }

    pub fn restore_session_checkpoint(&self, session_id: String, checkpoint: LifecycleCheckpoint) {
        if !self
            .supervisor
            .replace_checkpoint(session_id.clone(), checkpoint.clone())
        {
            let _ = self.supervisor.seed_checkpoint(session_id, checkpoint);
        }
    }

    pub fn apply_session_update_with_graph_seed(
        &self,
        session_id: &str,
        graph_revision_seed: i64,
        update: &SessionUpdate,
    ) -> i64 {
        let Some(checkpoint) = self.supervisor.snapshot_for_session(session_id) else {
            tracing::warn!(
                session_id,
                "Skipping runtime graph update for session without lifecycle checkpoint"
            );
            return graph_revision_seed;
        };
        let mut state = SessionGraphRuntimeSnapshot::from_checkpoint(&checkpoint);
        state.apply_update_with_graph_seed(graph_revision_seed, update);
        let graph_revision = state.graph_revision;
        let stored = self
            .supervisor
            .replace_checkpoint(session_id.to_string(), state.into_checkpoint());
        debug_assert!(stored, "snapshot existed before runtime graph update");
        graph_revision
    }

    pub fn apply_session_update(&self, session_id: &str, update: &SessionUpdate) -> i64 {
        self.apply_session_update_with_graph_seed(session_id, 0, update)
    }

    pub fn advance_graph_revision_with_seed(
        &self,
        session_id: &str,
        graph_revision_seed: i64,
    ) -> i64 {
        let Some(checkpoint) = self.supervisor.snapshot_for_session(session_id) else {
            tracing::warn!(
                session_id,
                "Skipping graph revision advance for session without lifecycle checkpoint"
            );
            return graph_revision_seed;
        };
        let mut state = SessionGraphRuntimeSnapshot::from_checkpoint(&checkpoint);
        state.graph_revision = state
            .graph_revision
            .max(graph_revision_seed)
            .saturating_add(1);
        let graph_revision = state.graph_revision;
        let stored = self
            .supervisor
            .replace_checkpoint(session_id.to_string(), state.into_checkpoint());
        debug_assert!(stored, "snapshot existed before graph revision advance");
        graph_revision
    }

    pub fn replace_capabilities_with_graph_seed(
        &self,
        session_id: &str,
        graph_revision_seed: i64,
        capabilities: SessionGraphCapabilities,
    ) -> i64 {
        let Some(checkpoint) = self.supervisor.snapshot_for_session(session_id) else {
            tracing::warn!(
                session_id,
                "Skipping capabilities replacement for session without lifecycle checkpoint"
            );
            return graph_revision_seed;
        };
        let mut state = SessionGraphRuntimeSnapshot::from_checkpoint(&checkpoint);
        state.graph_revision = state
            .graph_revision
            .max(graph_revision_seed)
            .saturating_add(1);
        state.capabilities = capabilities;
        let graph_revision = state.graph_revision;
        let stored = self
            .supervisor
            .replace_checkpoint(session_id.to_string(), state.into_checkpoint());
        debug_assert!(stored, "snapshot existed before capabilities replacement");
        graph_revision
    }

    #[must_use]
    pub fn build_capabilities_envelope(
        &self,
        session_id: &str,
        capabilities: SessionGraphCapabilities,
        revision: SessionGraphRevision,
        pending_mutation_id: Option<String>,
        preview_state: CapabilityPreviewState,
    ) -> SessionStateEnvelope {
        build_live_session_state_capabilities_envelope(
            session_id,
            capabilities,
            revision,
            pending_mutation_id,
            preview_state,
        )
    }

    pub async fn build_live_session_state_envelope(
        &self,
        request: LiveSessionStateEnvelopeRequest<'_>,
    ) -> Option<SessionStateEnvelope> {
        if should_emit_session_state_capabilities(request.update) {
            return Some(build_live_session_state_capabilities_envelope(
                request.session_id,
                self.snapshot_for_session(request.session_id).capabilities,
                request.revision,
                None,
                CapabilityPreviewState::Canonical,
            ));
        }

        if should_emit_turn_state_delta(request.update) {
            return self.build_turn_state_delta_envelope(&request).await;
        }

        if should_emit_session_state_snapshot(request.update) {
            return self
                .build_snapshot_envelope(
                    request.db,
                    request.session_id,
                    request.revision,
                    request.projection_registry,
                    request.transcript_projection_registry,
                )
                .await;
        }

        if let SessionUpdate::UsageTelemetryUpdate { data } = request.update {
            return Some(build_live_session_state_telemetry_envelope(
                &data.session_id,
                data.clone(),
                request.revision,
            ));
        }

        if let SessionUpdate::Plan { plan, .. } = request.update {
            return Some(build_live_session_state_plan_envelope(
                request.session_id,
                plan.clone(),
                request.revision,
            ));
        }

        if let Some(tool_call_id) = tool_call_id_for_operation_patch(request.update) {
            let transcript_operations = request
                .transcript_delta
                .map(|delta| delta.operations.clone())
                .unwrap_or_default();
            let is_transcript_bearing = !transcript_operations.is_empty();
            let current_frontier =
                current_frontier_from_previous_revision(request.previous_revision);

            return match decide_frontier_transition(
                current_frontier,
                request.revision,
                0,
                is_transcript_bearing,
            ) {
                SessionFrontierDecision::RequireSnapshot { .. } => {
                    self.build_snapshot_envelope(
                        request.db,
                        request.session_id,
                        request.revision,
                        request.projection_registry,
                        request.transcript_projection_registry,
                    )
                    .await
                }
                SessionFrontierDecision::AcceptDelta {
                    from_revision,
                    to_revision,
                } => {
                    let Some(operation) = request
                        .projection_registry
                        .operation_for_tool_call(request.session_id, tool_call_id)
                    else {
                        return self
                            .build_snapshot_envelope(
                                request.db,
                                request.session_id,
                                request.revision,
                                request.projection_registry,
                                request.transcript_projection_registry,
                            )
                            .await;
                    };
                    let projection = self.delta_projection_for_session(
                        request.session_id,
                        request.projection_registry,
                        request.transcript_projection_registry,
                    );
                    let mut changed_fields = vec![
                        "operations".to_string(),
                        "activity".to_string(),
                        "turnState".to_string(),
                        "activeTurnFailure".to_string(),
                        "lastTerminalTurnId".to_string(),
                        "lastAgentMessageId".to_string(),
                        "activeStreamingTail".to_string(),
                    ];
                    if is_transcript_bearing {
                        changed_fields.push("transcriptSnapshot".to_string());
                    }
                    Some(build_delta_envelope(DeltaEnvelopeParts {
                        session_id: request.session_id,
                        from_revision,
                        to_revision,
                        projection,
                        transcript_operations,
                        operation_patches: vec![operation],
                        interaction_patches: Vec::new(),
                        changed_fields,
                    }))
                }
            };
        }

        let delta = request.transcript_delta?;
        let is_transcript_bearing = !delta.operations.is_empty();
        let current_frontier = current_frontier_from_previous_revision(request.previous_revision);

        match decide_frontier_transition(
            current_frontier,
            request.revision,
            0,
            is_transcript_bearing,
        ) {
            SessionFrontierDecision::RequireSnapshot { .. } => {
                self.build_snapshot_envelope(
                    request.db,
                    request.session_id,
                    request.revision,
                    request.projection_registry,
                    request.transcript_projection_registry,
                )
                .await
            }
            SessionFrontierDecision::AcceptDelta {
                from_revision,
                to_revision,
            } if is_transcript_bearing => Some(build_live_session_state_delta_envelope(
                delta,
                from_revision,
                to_revision,
                self.delta_projection_for_session(
                    request.session_id,
                    request.projection_registry,
                    request.transcript_projection_registry,
                ),
            )),
            SessionFrontierDecision::AcceptDelta { .. } => None,
        }
    }

    #[must_use]
    pub fn build_assistant_text_delta_envelope(
        &self,
        request: LiveSessionStateEnvelopeRequest<'_>,
    ) -> Option<SessionStateEnvelope> {
        let snapshot = request
            .transcript_projection_registry
            .snapshot_for_session(request.session_id)?;
        build_assistant_text_delta_from_components(
            request.session_id,
            request.update,
            request.transcript_delta?,
            &snapshot,
            request.revision,
        )
    }

    pub async fn build_snapshot_envelope_for_session(
        &self,
        db: &DbConn,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
    ) -> Option<SessionStateEnvelope> {
        self.build_snapshot_envelope(
            db,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
        )
        .await
    }

    async fn build_turn_state_delta_envelope(
        &self,
        request: &LiveSessionStateEnvelopeRequest<'_>,
    ) -> Option<SessionStateEnvelope> {
        let transcript_operations = request
            .transcript_delta
            .map(|delta| delta.operations.clone())
            .unwrap_or_default();
        let is_transcript_bearing = !transcript_operations.is_empty();
        let current_frontier = current_frontier_from_previous_revision(request.previous_revision);

        match decide_frontier_transition(
            current_frontier,
            request.revision,
            0,
            is_transcript_bearing,
        ) {
            SessionFrontierDecision::RequireSnapshot { .. } => {
                self.build_snapshot_envelope(
                    request.db,
                    request.session_id,
                    request.revision,
                    request.projection_registry,
                    request.transcript_projection_registry,
                )
                .await
            }
            SessionFrontierDecision::AcceptDelta {
                from_revision,
                to_revision,
            } => {
                let mut changed_fields = vec![
                    "activity".to_string(),
                    "turnState".to_string(),
                    "activeTurnFailure".to_string(),
                    "lastTerminalTurnId".to_string(),
                    "lastAgentMessageId".to_string(),
                    "activeStreamingTail".to_string(),
                ];
                if is_transcript_bearing {
                    changed_fields.push("transcriptSnapshot".to_string());
                }
                let operation_patches = operation_patches_for_terminal_update(
                    request.session_id,
                    request.update,
                    request.projection_registry,
                );
                if !operation_patches.is_empty() {
                    changed_fields.push("operations".to_string());
                }

                Some(build_delta_envelope(DeltaEnvelopeParts {
                    session_id: request.session_id,
                    from_revision,
                    to_revision,
                    projection: self.delta_projection_for_session(
                        request.session_id,
                        request.projection_registry,
                        request.transcript_projection_registry,
                    ),
                    transcript_operations,
                    operation_patches,
                    interaction_patches: Vec::new(),
                    changed_fields,
                }))
            }
        }
    }

    async fn build_snapshot_envelope(
        &self,
        db: &DbConn,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
    ) -> Option<SessionStateEnvelope> {
        let metadata = match SessionMetadataRepository::get_by_id(db, session_id)
            .await
            .ok()
            .flatten()
        {
            Some(metadata) => metadata,
            None => {
                // No persisted metadata yet (e.g. pending-creation session whose
                // creation failed before promotion to DB). We can still emit a
                // canonical Lifecycle envelope so the frontend learns about the
                // authoritative lifecycle transition (e.g. Failed) without
                // requiring client-side synthesis. Skip when the runtime
                // lifecycle hasn't departed from its idle/reserved default —
                // there's nothing for the client to learn yet.
                let runtime_snapshot = self.snapshot_for_session(session_id);
                use crate::acp::lifecycle::LifecycleStatus;
                if matches!(
                    runtime_snapshot.lifecycle.status,
                    LifecycleStatus::Reserved | LifecycleStatus::Ready
                ) && runtime_snapshot.lifecycle.failure_reason.is_none()
                    && runtime_snapshot.lifecycle.detached_reason.is_none()
                {
                    return None;
                }
                return Some(SessionStateEnvelope {
                    session_id: session_id.to_string(),
                    graph_revision: revision.graph_revision,
                    last_event_seq: revision.last_event_seq,
                    payload: SessionStatePayload::Lifecycle {
                        lifecycle: runtime_snapshot.lifecycle,
                        revision,
                    },
                });
            }
        };
        let agent_id = metadata
            .agent_id_enum()
            .unwrap_or(CanonicalAgentId::parse(&metadata.agent_id));
        let transcript_snapshot = transcript_projection_registry
            .snapshot_for_session(session_id)
            .unwrap_or_else(|| crate::acp::transcript_projection::TranscriptSnapshot {
                revision: revision.transcript_revision,
                entries: Vec::new(),
            });
        let projection_snapshot = projection_registry.session_projection(session_id);
        let session_snapshot = projection_snapshot.session.unwrap_or_else(|| {
            SessionSnapshot::new(session_id.to_string(), Some(agent_id.clone()))
        });
        let runtime_snapshot = self.snapshot_for_session(session_id);
        let activity = select_session_graph_activity(
            &runtime_snapshot.lifecycle,
            &session_snapshot.turn_state,
            &projection_snapshot.operations,
            &projection_snapshot.interactions,
            session_snapshot.active_turn_failure.as_ref(),
        );
        let active_streaming_tail = select_active_streaming_tail(
            &session_snapshot.turn_state,
            &activity,
            &transcript_snapshot,
            session_snapshot.last_agent_message_id.as_deref(),
        );

        Some(SessionStateEnvelope {
            session_id: session_id.to_string(),
            graph_revision: revision.graph_revision,
            last_event_seq: revision.last_event_seq,
            payload: SessionStatePayload::Snapshot {
                graph: Box::new(crate::acp::session_state_engine::SessionStateGraph {
                    requested_session_id: session_id.to_string(),
                    canonical_session_id: session_id.to_string(),
                    is_alias: false,
                    agent_id,
                    project_path: metadata.project_path,
                    worktree_path: metadata.worktree_path,
                    source_path: SessionMetadataRepository::normalized_source_path(
                        &metadata.file_path,
                    ),
                    revision,
                    transcript_snapshot,
                    operations: projection_snapshot.operations,
                    interactions: projection_snapshot.interactions,
                    turn_state: session_snapshot.turn_state,
                    message_count: session_snapshot.message_count,
                    last_agent_message_id: session_snapshot.last_agent_message_id,
                    active_streaming_tail,
                    active_turn_failure: session_snapshot.active_turn_failure,
                    last_terminal_turn_id: session_snapshot.last_terminal_turn_id,
                    lifecycle: runtime_snapshot.lifecycle,
                    activity,
                    capabilities: runtime_snapshot.capabilities,
                }),
            },
        })
    }

    fn delta_projection_for_session(
        &self,
        session_id: &str,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
    ) -> DeltaSessionProjectionFields {
        let projection_snapshot = projection_registry.session_projection(session_id);
        let session_snapshot = projection_snapshot
            .session
            .unwrap_or_else(|| SessionSnapshot::new(session_id.to_string(), None));
        let runtime_snapshot = self.snapshot_for_session(session_id);
        let activity = select_session_graph_activity(
            &runtime_snapshot.lifecycle,
            &session_snapshot.turn_state,
            &projection_snapshot.operations,
            &projection_snapshot.interactions,
            session_snapshot.active_turn_failure.as_ref(),
        );
        let transcript_snapshot = transcript_projection_registry
            .snapshot_for_session(session_id)
            .unwrap_or_else(|| TranscriptSnapshot {
                revision: 0,
                entries: Vec::new(),
            });
        let active_streaming_tail = select_active_streaming_tail(
            &session_snapshot.turn_state,
            &activity,
            &transcript_snapshot,
            session_snapshot.last_agent_message_id.as_deref(),
        );
        DeltaSessionProjectionFields {
            activity,
            turn_state: session_snapshot.turn_state,
            active_turn_failure: session_snapshot.active_turn_failure,
            last_terminal_turn_id: session_snapshot.last_terminal_turn_id,
            last_agent_message_id: session_snapshot.last_agent_message_id,
            active_streaming_tail,
        }
    }
}

impl SessionGraphRuntimeSnapshot {
    pub(crate) fn apply_update_with_graph_seed(
        &mut self,
        graph_revision_seed: i64,
        update: &SessionUpdate,
    ) -> i64 {
        self.graph_revision = self
            .graph_revision
            .max(graph_revision_seed)
            .saturating_add(1);
        self.apply_update(update);
        self.graph_revision
    }

    pub(crate) fn apply_update(&mut self, update: &SessionUpdate) {
        match update {
            SessionUpdate::ConnectionComplete {
                models,
                modes,
                available_commands,
                config_options,
                autonomous_enabled,
                ..
            } => {
                self.lifecycle = SessionGraphLifecycle::ready();
                self.capabilities = SessionGraphCapabilities {
                    models: Some(models.clone()),
                    modes: Some(modes.clone()),
                    available_commands: available_commands.clone(),
                    config_options: sanitize_config_options_for_canonical(config_options.clone()),
                    autonomous_enabled: *autonomous_enabled,
                };
            }
            SessionUpdate::ConnectionFailed {
                error,
                failure_reason,
                ..
            } => {
                self.lifecycle = SessionGraphLifecycle::from_lifecycle_state(
                    LifecycleState::failed(*failure_reason, Some(error.clone())),
                );
            }
            SessionUpdate::TurnError { error, .. } => {
                if matches!(
                    self.lifecycle.status,
                    crate::acp::lifecycle::LifecycleStatus::Reserved
                        | crate::acp::lifecycle::LifecycleStatus::Activating
                ) {
                    let message = match error {
                        crate::acp::session_update::TurnErrorData::Legacy(msg) => msg.clone(),
                        crate::acp::session_update::TurnErrorData::Structured(info) => {
                            info.message.clone()
                        }
                    };
                    self.lifecycle = SessionGraphLifecycle::from_lifecycle_state(
                        LifecycleState::failed(FailureReason::ActivationFailed, Some(message)),
                    );
                }
            }
            SessionUpdate::AvailableCommandsUpdate { update, .. } => {
                self.capabilities.available_commands = update.available_commands.clone();
            }
            SessionUpdate::CurrentModeUpdate { update, .. } => {
                if let Some(modes) = self.capabilities.modes.as_mut() {
                    modes.current_mode_id = update.current_mode_id.clone();
                } else {
                    self.capabilities.modes = Some(SessionModes {
                        current_mode_id: update.current_mode_id.clone(),
                        available_modes: Vec::new(),
                    });
                }
            }
            SessionUpdate::ConfigOptionUpdate { update, .. } => {
                self.capabilities.config_options =
                    sanitize_config_options_for_canonical(update.config_options.clone());
            }
            _ => {}
        }
    }

    #[must_use]
    pub fn into_checkpoint(self) -> LifecycleCheckpoint {
        LifecycleCheckpoint::from_live_runtime(
            self.graph_revision,
            self.lifecycle,
            self.capabilities,
        )
    }

    #[must_use]
    pub fn from_checkpoint(checkpoint: &LifecycleCheckpoint) -> Self {
        Self {
            graph_revision: checkpoint.graph_revision,
            lifecycle: checkpoint.graph_lifecycle(),
            capabilities: checkpoint.capabilities.clone(),
        }
    }
}

impl Default for SessionGraphRuntimeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

fn build_live_session_state_delta_envelope(
    delta: &TranscriptDelta,
    from_revision: SessionGraphRevision,
    to_revision: SessionGraphRevision,
    projection: DeltaSessionProjectionFields,
) -> SessionStateEnvelope {
    build_delta_envelope(DeltaEnvelopeParts {
        session_id: &delta.session_id,
        from_revision,
        to_revision,
        projection,
        transcript_operations: delta.operations.clone(),
        operation_patches: Vec::new(),
        interaction_patches: Vec::new(),
        changed_fields: vec![
            "transcriptSnapshot".to_string(),
            "activity".to_string(),
            "turnState".to_string(),
            "activeTurnFailure".to_string(),
            "lastTerminalTurnId".to_string(),
            "lastAgentMessageId".to_string(),
            "activeStreamingTail".to_string(),
        ],
    })
}

fn build_assistant_text_delta_from_components(
    session_id: &str,
    update: &SessionUpdate,
    transcript_delta: &TranscriptDelta,
    snapshot: &TranscriptSnapshot,
    revision: SessionGraphRevision,
) -> Option<SessionStateEnvelope> {
    let SessionUpdate::AgentMessageChunk {
        chunk,
        produced_at_monotonic_ms: Some(produced_at_monotonic_ms),
        ..
    } = update
    else {
        return None;
    };
    let delta_text = assistant_text_from_update_chunk(chunk)?;
    let row_entry_id = assistant_row_entry_id(transcript_delta)?;
    let (row_index, row_entry) = snapshot.entries.iter().enumerate().find(|(_, entry)| {
        entry.role == TranscriptEntryRole::Assistant && entry.entry_id == row_entry_id
    })?;
    let total_chars = transcript_entry_text_char_count(row_entry);
    let delta_chars = delta_text.chars().count();
    let char_offset_chars = total_chars.saturating_sub(delta_chars);
    let char_offset = match u32::try_from(char_offset_chars) {
        Ok(value) => value,
        Err(_) => {
            tracing::error!(
                session_id,
                row_entry_id,
                char_offset_chars,
                "Assistant text delta char offset exceeded u32::MAX; skipping envelope"
            );
            return None;
        }
    };
    let row_id = sanitize_row_id(row_entry_id);
    let turn_id = assistant_turn_id_from_snapshot(snapshot, row_index, &row_id);
    Some(build_assistant_text_delta_state_envelope(
        session_id,
        revision,
        AssistantTextDeltaPayload {
            turn_id,
            row_id,
            char_offset,
            delta_text: delta_text.to_string(),
            produced_at_monotonic_ms: *produced_at_monotonic_ms,
            revision: revision.transcript_revision,
        },
    ))
}

fn build_assistant_text_delta_state_envelope(
    session_id: &str,
    revision: SessionGraphRevision,
    delta: AssistantTextDeltaPayload,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::AssistantTextDelta { delta },
    }
}

fn assistant_text_from_update_chunk(
    chunk: &crate::acp::session_update::ContentChunk,
) -> Option<&str> {
    match &chunk.content {
        crate::acp::types::ContentBlock::Text { text } => Some(text.as_str()),
        _ => None,
    }
}

fn assistant_row_entry_id(delta: &TranscriptDelta) -> Option<&str> {
    delta
        .operations
        .iter()
        .find_map(|operation| match operation {
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.role == TranscriptEntryRole::Assistant =>
            {
                Some(entry.entry_id.as_str())
            }
            TranscriptDeltaOperation::AppendSegment { entry_id, role, .. }
                if role == &TranscriptEntryRole::Assistant =>
            {
                Some(entry_id.as_str())
            }
            _ => None,
        })
}

fn transcript_entry_text_char_count(entry: &TranscriptEntry) -> usize {
    entry
        .segments
        .iter()
        .map(|segment| match segment {
            TranscriptSegment::Text { text, .. } => text.chars().count(),
            TranscriptSegment::Thought { text, .. } => text.chars().count(),
        })
        .sum()
}

fn assistant_turn_id_from_snapshot(
    snapshot: &TranscriptSnapshot,
    row_index: usize,
    sanitized_row_id: &str,
) -> String {
    snapshot
        .entries
        .iter()
        .take(row_index)
        .rev()
        .find(|entry| entry.role == TranscriptEntryRole::User)
        .map(|entry| entry.entry_id.clone())
        .unwrap_or_else(|| sanitized_row_id.to_string())
}

fn sanitize_row_id(row_id: &str) -> String {
    row_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn current_frontier_from_previous_revision(
    previous_revision: SessionGraphRevision,
) -> Option<SessionGraphRevision> {
    if previous_revision.graph_revision == 0
        && previous_revision.transcript_revision == 0
        && previous_revision.last_event_seq == 0
    {
        None
    } else {
        Some(previous_revision)
    }
}

fn tool_call_id_for_operation_patch(update: &SessionUpdate) -> Option<&str> {
    match update {
        SessionUpdate::ToolCall { tool_call, .. } => Some(tool_call.id.as_str()),
        SessionUpdate::ToolCallUpdate { update, .. } => Some(update.tool_call_id.as_str()),
        _ => None,
    }
}

fn build_live_session_state_telemetry_envelope(
    session_id: &str,
    telemetry: crate::acp::session_update::UsageTelemetryData,
    revision: SessionGraphRevision,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::Telemetry {
            telemetry,
            revision,
        },
    }
}

fn build_live_session_state_plan_envelope(
    session_id: &str,
    plan: crate::acp::session_update::PlanData,
    revision: SessionGraphRevision,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::Plan { plan, revision },
    }
}

fn build_live_session_state_capabilities_envelope(
    session_id: &str,
    capabilities: SessionGraphCapabilities,
    revision: SessionGraphRevision,
    pending_mutation_id: Option<String>,
    preview_state: CapabilityPreviewState,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::Capabilities {
            capabilities: Box::new(capabilities),
            revision,
            pending_mutation_id,
            preview_state,
        },
    }
}

fn should_emit_session_state_capabilities(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::AvailableCommandsUpdate { .. }
            | SessionUpdate::CurrentModeUpdate { .. }
            | SessionUpdate::ConfigOptionUpdate { .. }
    )
}

fn should_emit_session_state_snapshot(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::PermissionRequest { .. }
            | SessionUpdate::QuestionRequest { .. }
            | SessionUpdate::ConnectionComplete { .. }
            | SessionUpdate::ConnectionFailed { .. }
    )
}

fn should_emit_turn_state_delta(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::TurnComplete { .. }
            | SessionUpdate::TurnError { .. }
            | SessionUpdate::TurnCancelled { .. }
    )
}

fn operation_patches_for_terminal_update(
    session_id: &str,
    update: &SessionUpdate,
    projection_registry: &ProjectionRegistry,
) -> Vec<crate::acp::projections::OperationSnapshot> {
    if !matches!(update, SessionUpdate::TurnCancelled { .. }) {
        return Vec::new();
    }

    projection_registry.last_cancelled_operation_patches(session_id)
}

#[cfg(test)]
mod tests {
    use super::{
        build_assistant_text_delta_from_components, build_live_session_state_capabilities_envelope,
        build_live_session_state_delta_envelope, build_live_session_state_telemetry_envelope,
        CapabilityPreviewState, LiveSessionStateEnvelopeRequest, SessionGraphRuntimeRegistry,
    };

    #[test]
    fn record_chunk_timestamp_is_monotonic_per_session() {
        let registry = SessionGraphRuntimeRegistry::new();
        let session_id = "sess-mono-1";
        let t0 = registry.record_chunk_timestamp(session_id);
        let t1 = registry.record_chunk_timestamp(session_id);
        let t2 = registry.record_chunk_timestamp(session_id);
        assert!(t1 >= t0, "t1={t1} t0={t0} expected non-decreasing");
        assert!(t2 >= t1, "t2={t2} t1={t1} expected non-decreasing");
    }

    #[test]
    fn record_chunk_timestamp_isolates_sessions() {
        let registry = SessionGraphRuntimeRegistry::new();
        let _ = registry.record_chunk_timestamp("sess-a");
        std::thread::sleep(std::time::Duration::from_millis(2));
        let a_after_sleep = registry.record_chunk_timestamp("sess-a");
        let b_first = registry.record_chunk_timestamp("sess-b");
        // sess-a's anchor is older, so its elapsed time should be larger than sess-b's first sample.
        assert!(
            a_after_sleep > b_first,
            "a_after_sleep={a_after_sleep} b_first={b_first}"
        );
    }

    use crate::acp::client_session::{default_modes, default_session_model_state};
    use crate::acp::lifecycle::LifecycleStatus;
    use crate::acp::projections::ProjectionRegistry;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphActivityKind, SessionGraphCapabilities,
        SessionGraphLifecycle,
    };
    use crate::acp::session_state_engine::SessionStatePayload;
    use crate::acp::session_state_engine::{
        DeltaSessionProjectionFields, SessionGraphRevision, SessionStateEnvelope,
    };
    use crate::acp::session_update::{
        AvailableCommandsData, ConfigOptionData, ContentChunk, CurrentModeData, SessionUpdate,
        UsageTelemetryData, UsageTelemetryTokens,
    };
    use crate::acp::session_update::{
        PermissionData, QuestionData, QuestionItem, QuestionOption, ToolArguments, ToolCallData,
        ToolCallStatus, ToolCallUpdateData, ToolKind, TurnErrorData,
    };
    use crate::acp::transcript_projection::{
        TranscriptDelta, TranscriptDeltaOperation, TranscriptProjectionRegistry, TranscriptSnapshot,
    };
    use crate::acp::types::{CanonicalAgentId, ContentBlock};
    use crate::db::repository::SessionMetadataRepository;
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect test database");

        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("run migrations");

        db
    }

    async fn insert_session_metadata(db: &DbConn, session_id: &str) {
        SessionMetadataRepository::upsert(
            db,
            session_id.to_string(),
            "Session".to_string(),
            1,
            "/workspace/a".to_string(),
            CanonicalAgentId::Cursor.as_str().to_string(),
            "__session_registry__/session-1".to_string(),
            0,
            0,
        )
        .await
        .expect("insert session metadata");
    }

    fn seed_lifecycle(
        registry: &SessionGraphRuntimeRegistry,
        session_id: &str,
        graph_revision: i64,
    ) {
        registry.restore_session_state(
            session_id.to_string(),
            graph_revision,
            SessionGraphLifecycle::reserved(),
            SessionGraphCapabilities::empty(),
        );
    }

    fn create_completed_history_tool_call(index: usize) -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                &format!("history-tool-{index}"),
                &format!("echo history-{index}"),
                ToolCallStatus::Completed,
            ),
            session_id: Some("session-1".to_string()),
        }
    }

    fn create_active_tool_call_update() -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "active-tool",
                "bun test --filter long-session",
                ToolCallStatus::InProgress,
            ),
            session_id: Some("session-1".to_string()),
        }
    }

    fn create_active_tool_completion_update() -> SessionUpdate {
        SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "active-tool".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: Some(serde_json::json!({ "ok": true })),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn create_agent_message_chunk_update(
        session_id: &str,
        message_id: Option<&str>,
        text: &str,
        produced_at_monotonic_ms: u64,
    ) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: text.to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: message_id.map(str::to_string),
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: Some(produced_at_monotonic_ms),
        }
    }

    async fn build_delta_for_history_depth(
        db: &DbConn,
        history_count: usize,
        update_under_test: SessionUpdate,
        seed_active_tool: bool,
    ) -> SessionStateEnvelope {
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();

        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::Cursor);
        for index in 0..history_count {
            projection_registry
                .apply_session_update("session-1", &create_completed_history_tool_call(index));
        }
        if seed_active_tool {
            projection_registry
                .apply_session_update("session-1", &create_active_tool_call_update());
        }
        projection_registry.apply_session_update("session-1", &update_under_test);

        runtime_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db,
                session_id: "session-1",
                update: &update_under_test,
                previous_revision: SessionGraphRevision::new(10, 10, 10),
                revision: SessionGraphRevision::new(11, 10, 11),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: None,
            })
            .await
            .expect("hot tool delta envelope")
    }

    async fn build_snapshot_for_history_depth(
        db: &DbConn,
        history_count: usize,
        update_under_test: SessionUpdate,
    ) -> SessionStateEnvelope {
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();

        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::Cursor);
        for index in 0..history_count {
            let history_update = create_completed_history_tool_call(index);
            projection_registry.apply_session_update("session-1", &history_update);
            let _ = transcript_projection_registry
                .apply_session_update(index as i64 + 1, &history_update);
        }
        projection_registry.apply_session_update("session-1", &update_under_test);
        let _ = transcript_projection_registry
            .apply_session_update(history_count as i64 + 1, &update_under_test);
        runtime_registry.apply_session_update("session-1", &update_under_test);

        runtime_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db,
                session_id: "session-1",
                update: &update_under_test,
                previous_revision: SessionGraphRevision::new(
                    10,
                    history_count as i64,
                    history_count as i64,
                ),
                revision: SessionGraphRevision::new(
                    11,
                    history_count as i64 + 1,
                    history_count as i64 + 1,
                ),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: None,
            })
            .await
            .expect("snapshot envelope")
    }

    async fn build_turn_envelope_for_history_depth(
        db: &DbConn,
        history_count: usize,
        update_under_test: SessionUpdate,
    ) -> SessionStateEnvelope {
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();

        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::Cursor);
        for index in 0..history_count {
            let history_update = create_completed_history_tool_call(index);
            projection_registry.apply_session_update("session-1", &history_update);
            let _ = transcript_projection_registry
                .apply_session_update(index as i64 + 1, &history_update);
        }
        projection_registry.apply_session_update("session-1", &update_under_test);
        let transcript_delta = transcript_projection_registry
            .apply_session_update(history_count as i64 + 1, &update_under_test);
        runtime_registry.apply_session_update("session-1", &update_under_test);

        runtime_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db,
                session_id: "session-1",
                update: &update_under_test,
                previous_revision: SessionGraphRevision::new(
                    10,
                    history_count as i64,
                    history_count as i64,
                ),
                revision: SessionGraphRevision::new(
                    11,
                    history_count as i64 + 1,
                    history_count as i64 + 1,
                ),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: transcript_delta.as_ref(),
            })
            .await
            .expect("turn-state envelope")
    }

    fn build_assistant_text_delta_for_update(
        transcript_projection_registry: &TranscriptProjectionRegistry,
        _runtime_registry: &SessionGraphRuntimeRegistry,
        event_seq: i64,
        update: &SessionUpdate,
    ) -> SessionStateEnvelope {
        let session_id = update.session_id().expect("session id on assistant chunk");
        let transcript_delta = transcript_projection_registry
            .apply_session_update(event_seq, update)
            .expect("transcript delta");
        let snapshot = transcript_projection_registry
            .snapshot_for_session(session_id)
            .expect("transcript snapshot");
        build_assistant_text_delta_from_components(
            session_id,
            update,
            &transcript_delta,
            &snapshot,
            SessionGraphRevision::new(event_seq, event_seq, event_seq),
        )
        .expect("assistant text delta envelope")
    }

    #[test]
    fn assistant_text_delta_envelope_tracks_row_offsets_across_chunks() {
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let first = create_agent_message_chunk_update("session-1", Some("assistant-1"), "hello", 5);
        let second =
            create_agent_message_chunk_update("session-1", Some("assistant-1"), " world!", 7);
        let third =
            create_agent_message_chunk_update("session-1", Some("assistant-1"), " again", 9);

        let first_envelope = build_assistant_text_delta_for_update(
            &transcript_projection_registry,
            &runtime_registry,
            1,
            &first,
        );
        let second_envelope = build_assistant_text_delta_for_update(
            &transcript_projection_registry,
            &runtime_registry,
            2,
            &second,
        );
        let third_envelope = build_assistant_text_delta_for_update(
            &transcript_projection_registry,
            &runtime_registry,
            3,
            &third,
        );

        let offsets = [first_envelope, second_envelope, third_envelope]
            .into_iter()
            .map(|envelope| match envelope.payload {
                SessionStatePayload::AssistantTextDelta { delta } => delta.char_offset,
                other => panic!("expected assistant text delta payload, got {other:?}"),
            })
            .collect::<Vec<_>>();

        assert_eq!(offsets, vec![0, 5, 12]);
    }

    #[test]
    fn assistant_text_delta_envelope_sanitizes_row_id_and_keeps_empty_delta() {
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let first =
            create_agent_message_chunk_update("session-1", Some("assistant\n1"), "hello", 5);
        let second = create_agent_message_chunk_update("session-1", Some("assistant\n1"), "", 6);

        let _ = build_assistant_text_delta_for_update(
            &transcript_projection_registry,
            &runtime_registry,
            1,
            &first,
        );
        let second_envelope = build_assistant_text_delta_for_update(
            &transcript_projection_registry,
            &runtime_registry,
            2,
            &second,
        );

        match second_envelope.payload {
            SessionStatePayload::AssistantTextDelta { delta } => {
                assert_eq!(delta.row_id, "assistant-1");
                assert_eq!(delta.turn_id, "assistant-1");
                assert_eq!(delta.char_offset, 5);
                assert_eq!(delta.delta_text, "");
                assert_eq!(delta.produced_at_monotonic_ms, 6);
            }
            other => panic!("expected assistant text delta payload, got {other:?}"),
        }
    }

    fn assert_hot_tool_delta_contract(envelope: &SessionStateEnvelope) {
        match &envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.transcript_operations.len(), 0);
                assert_eq!(delta.operation_patches.len(), 1);
                assert_eq!(delta.interaction_patches.len(), 0);
                assert_eq!(
                    delta.changed_fields,
                    vec![
                        "operations".to_string(),
                        "activity".to_string(),
                        "turnState".to_string(),
                        "activeTurnFailure".to_string(),
                        "lastTerminalTurnId".to_string(),
                        "lastAgentMessageId".to_string(),
                        "activeStreamingTail".to_string(),
                    ]
                );
            }
            other => panic!("expected delta payload, got {:?}", other),
        }

        let value = serde_json::to_value(envelope).expect("serialize envelope to value");
        let payload = value
            .get("payload")
            .expect("payload")
            .as_object()
            .expect("payload object");
        assert_eq!(
            payload.get("kind").and_then(|kind| kind.as_str()),
            Some("delta")
        );
        assert!(payload.get("graph").is_none());
        assert!(payload.get("transcriptSnapshot").is_none());
    }

    fn assert_snapshot_payload_contract(
        surface: &str,
        envelope: &SessionStateEnvelope,
        expected_history_count: usize,
    ) {
        match &envelope.payload {
            SessionStatePayload::Snapshot { graph } => {
                assert_eq!(
                    graph.operations.len(),
                    expected_history_count,
                    "{surface} should carry the full operation history while it remains a snapshot surface"
                );
                assert!(
                    graph.transcript_snapshot.entries.len() >= expected_history_count,
                    "{surface} should carry the transcript history while it remains a snapshot surface"
                );
            }
            other => panic!("expected snapshot payload for {surface}, got {:?}", other),
        }
    }

    fn assert_turn_state_delta_contract(
        surface: &str,
        envelope: &SessionStateEnvelope,
        expected_transcript_operations: usize,
    ) {
        match &envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(
                    delta.transcript_operations.len(),
                    expected_transcript_operations,
                    "{surface} transcript delta shape changed"
                );
                assert_eq!(delta.operation_patches.len(), 0);
                assert_eq!(delta.interaction_patches.len(), 0);
                assert!(
                    delta.changed_fields.contains(&"activity".to_string()),
                    "{surface} delta should update activity"
                );
                assert!(
                    delta.changed_fields.contains(&"turnState".to_string()),
                    "{surface} delta should update turn state"
                );
                assert!(
                    delta
                        .changed_fields
                        .contains(&"activeTurnFailure".to_string()),
                    "{surface} delta should update active turn failure"
                );
                assert!(
                    delta
                        .changed_fields
                        .contains(&"lastTerminalTurnId".to_string()),
                    "{surface} delta should update terminal turn"
                );
            }
            other => panic!("expected turn-state delta for {surface}, got {:?}", other),
        }
    }

    async fn assert_snapshot_surface_scales_with_history(
        db: &DbConn,
        surface: &str,
        update_under_test: SessionUpdate,
    ) {
        let short_envelope =
            build_snapshot_for_history_depth(db, 4, update_under_test.clone()).await;
        let long_envelope = build_snapshot_for_history_depth(db, 300, update_under_test).await;
        assert_snapshot_payload_contract(surface, &short_envelope, 4);
        assert_snapshot_payload_contract(surface, &long_envelope, 300);
        let short_len = serialized_envelope_len(&short_envelope);
        let long_len = serialized_envelope_len(&long_envelope);
        assert!(
            long_len > short_len + 1024,
            "{surface} did not show measurable history scaling: short={short_len}, long={long_len}"
        );
    }

    async fn assert_turn_state_surface_stays_history_independent(
        db: &DbConn,
        surface: &str,
        update_under_test: SessionUpdate,
        expected_transcript_operations: usize,
    ) {
        let short_envelope =
            build_turn_envelope_for_history_depth(db, 4, update_under_test.clone()).await;
        let long_envelope =
            build_turn_envelope_for_history_depth(db, 300, update_under_test.clone()).await;
        let doubled_envelope =
            build_turn_envelope_for_history_depth(db, 600, update_under_test).await;
        assert_turn_state_delta_contract(surface, &short_envelope, expected_transcript_operations);
        assert_turn_state_delta_contract(surface, &long_envelope, expected_transcript_operations);
        assert_turn_state_delta_contract(
            surface,
            &doubled_envelope,
            expected_transcript_operations,
        );
        assert_history_independent_payload_size(&short_envelope, &long_envelope);
        assert_history_independent_payload_size(&short_envelope, &doubled_envelope);
    }

    fn serialized_envelope_len(envelope: &SessionStateEnvelope) -> usize {
        serde_json::to_string(envelope)
            .expect("serialize envelope")
            .len()
    }

    fn assert_history_independent_payload_size(
        short_envelope: &SessionStateEnvelope,
        long_envelope: &SessionStateEnvelope,
    ) {
        let short_len = serialized_envelope_len(short_envelope);
        let long_len = serialized_envelope_len(long_envelope);
        assert!(
            long_len <= short_len + 1024,
            "long hot delta payload grew too much: short={short_len}, long={long_len}"
        );
        assert!(
            long_len * 100 <= short_len * 110,
            "long hot delta payload exceeded relative budget: short={short_len}, long={long_len}"
        );
        assert!(
            long_len <= 64 * 1024,
            "normal hot delta payload exceeded absolute budget: len={long_len}"
        );
    }

    fn create_permission_request_update() -> SessionUpdate {
        SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(7),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                ),
                permission: "Read".to_string(),
                patterns: vec!["/workspace/a/README.md".to_string()],
                metadata: serde_json::json!({}),
                always: Vec::new(),
                auto_accepted: false,
                tool: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn create_question_request_update() -> SessionUpdate {
        SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: "question-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(8),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(8),
                ),
                questions: vec![QuestionItem {
                    question: "Proceed?".to_string(),
                    header: "Approval".to_string(),
                    options: vec![QuestionOption {
                        label: "Yes".to_string(),
                        description: "Continue".to_string(),
                    }],
                    multi_select: false,
                }],
                tool: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn create_turn_complete_update() -> SessionUpdate {
        SessionUpdate::TurnComplete {
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        }
    }

    fn create_turn_error_update() -> SessionUpdate {
        SessionUpdate::TurnError {
            error: TurnErrorData::Legacy("model stopped".to_string()),
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        }
    }

    fn create_turn_cancelled_update() -> SessionUpdate {
        SessionUpdate::TurnCancelled {
            session_id: Some("session-1".to_string()),
            turn_id: None,
        }
    }

    fn create_connection_complete_update() -> SessionUpdate {
        SessionUpdate::ConnectionComplete {
            session_id: "session-1".to_string(),
            attempt_id: 1,
            models: default_session_model_state(),
            modes: default_modes(),
            available_commands: Vec::new(),
            config_options: Vec::new(),
            autonomous_enabled: false,
        }
    }

    fn create_connection_failed_update() -> SessionUpdate {
        SessionUpdate::ConnectionFailed {
            session_id: "session-1".to_string(),
            attempt_id: 1,
            error: "connection failed".to_string(),
            failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
        }
    }

    fn create_execute_tool_call(id: &str, command: &str, status: ToolCallStatus) -> ToolCallData {
        ToolCallData {
            id: id.to_string(),
            name: "bash".to_string(),
            arguments: ToolArguments::Execute {
                command: Some(command.to_string()),
            },
            raw_input: None,
            status,
            result: None,
            kind: Some(ToolKind::Execute),
            title: Some("Run command".to_string()),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        }
    }

    #[test]
    fn registry_tracks_connection_and_capability_updates() {
        let registry = SessionGraphRuntimeRegistry::new();
        let session_id = "session-1";
        seed_lifecycle(&registry, session_id, 0);

        registry.apply_session_update(
            session_id,
            &SessionUpdate::ConnectionComplete {
                session_id: session_id.to_string(),
                attempt_id: 1,
                models: default_session_model_state(),
                modes: default_modes(),
                available_commands: Vec::new(),
                config_options: Vec::new(),
                autonomous_enabled: false,
            },
        );
        registry.apply_session_update(
            session_id,
            &SessionUpdate::CurrentModeUpdate {
                update: CurrentModeData {
                    current_mode_id: "plan".to_string(),
                },
                session_id: Some(session_id.to_string()),
            },
        );
        registry.apply_session_update(
            session_id,
            &SessionUpdate::AvailableCommandsUpdate {
                update: AvailableCommandsData {
                    available_commands: vec![crate::acp::session_update::AvailableCommand {
                        name: "compact".to_string(),
                        description: "Compact".to_string(),
                        input: None,
                    }],
                },
                session_id: Some(session_id.to_string()),
            },
        );
        registry.apply_session_update(
            session_id,
            &SessionUpdate::ConfigOptionUpdate {
                update: crate::acp::session_update::ConfigOptionUpdateData {
                    config_options: vec![ConfigOptionData {
                        id: "approval-policy".to_string(),
                        name: "approval-policy".to_string(),
                        category: "general".to_string(),
                        option_type: "string".to_string(),
                        description: None,
                        current_value: None,
                        options: Vec::new(),
                    }],
                },
                session_id: Some(session_id.to_string()),
            },
        );

        let snapshot = registry.snapshot_for_session(session_id);
        assert_eq!(snapshot.graph_revision, 4);
        assert_eq!(snapshot.lifecycle.status, LifecycleStatus::Ready);
        assert_eq!(
            snapshot
                .capabilities
                .modes
                .as_ref()
                .expect("modes")
                .current_mode_id,
            "plan"
        );
        assert_eq!(snapshot.capabilities.available_commands.len(), 1);
        assert_eq!(snapshot.capabilities.config_options.len(), 1);
        assert!(!snapshot.capabilities.autonomous_enabled);
    }

    #[test]
    fn registry_honors_seeded_graph_revision_for_runtime_only_mutations() {
        let registry = SessionGraphRuntimeRegistry::new();
        let session_id = "session-1";
        seed_lifecycle(&registry, session_id, 12);

        let graph_revision = registry.apply_session_update_with_graph_seed(
            session_id,
            12,
            &SessionUpdate::ConnectionFailed {
                session_id: session_id.to_string(),
                attempt_id: 1,
                error: "disconnected".to_string(),
                failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
            },
        );

        assert_eq!(graph_revision, 13);
        assert_eq!(registry.snapshot_for_session(session_id).graph_revision, 13);
    }

    #[test]
    fn connection_failed_envelope_failure_reason_propagates_to_lifecycle() {
        // GOD: lifecycle.failure_reason MUST come from the envelope, not be
        // hard-coded. Verifies both terminal (SessionGoneUpstream) and
        // retryable (ResumeFailed) classifications round-trip cleanly.
        for reason in [
            crate::acp::lifecycle::FailureReason::ResumeFailed,
            crate::acp::lifecycle::FailureReason::SessionGoneUpstream,
        ] {
            let registry = SessionGraphRuntimeRegistry::new();
            seed_lifecycle(&registry, "session-1", 0);
            registry.apply_session_update(
                "session-1",
                &SessionUpdate::ConnectionFailed {
                    session_id: "session-1".to_string(),
                    attempt_id: 1,
                    error: "boom".to_string(),
                    failure_reason: reason,
                },
            );

            let snapshot = registry.snapshot_for_session("session-1");
            assert_eq!(
                snapshot.lifecycle.failure_reason,
                Some(reason),
                "failure_reason must be carried through from envelope, not hard-coded"
            );
            assert_eq!(snapshot.lifecycle.error_message.as_deref(), Some("boom"));
        }
    }

    #[test]
    fn delta_envelope_preserves_frontier_decision_from_revision() {
        let delta = TranscriptDelta {
            event_seq: 21,
            session_id: "session-1".to_string(),
            snapshot_revision: 8,
            operations: vec![TranscriptDeltaOperation::ReplaceSnapshot {
                snapshot: TranscriptSnapshot {
                    revision: 8,
                    entries: Vec::new(),
                },
            }],
        };
        let from_revision = SessionGraphRevision::new(13, 7, 20);
        let to_revision = SessionGraphRevision::new(14, 8, 21);

        let envelope = build_live_session_state_delta_envelope(
            &delta,
            from_revision,
            to_revision,
            DeltaSessionProjectionFields {
                activity: SessionGraphActivity::idle(),
                turn_state: crate::acp::projections::SessionTurnState::Idle,
                active_turn_failure: None,
                last_terminal_turn_id: None,
                last_agent_message_id: Some("assistant-1".to_string()),
                active_streaming_tail: None,
            },
        );

        match envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.from_revision, from_revision);
                assert_eq!(delta.to_revision, to_revision);
                assert_eq!(delta.activity, SessionGraphActivity::idle());
                assert_eq!(
                    delta.turn_state,
                    crate::acp::projections::SessionTurnState::Idle
                );
                assert_eq!(delta.last_agent_message_id.as_deref(), Some("assistant-1"));
            }
            other => panic!("expected delta payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn tool_call_emits_bounded_delta_with_operation_patch_and_activity() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let update = SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "bun test", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        };

        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::Cursor);
        projection_registry.apply_session_update("session-1", &update);
        runtime_registry.apply_session_update(
            "session-1",
            &SessionUpdate::ConnectionComplete {
                session_id: "session-1".to_string(),
                attempt_id: 1,
                models: default_session_model_state(),
                modes: default_modes(),
                available_commands: Vec::new(),
                config_options: Vec::new(),
                autonomous_enabled: false,
            },
        );

        let envelope = runtime_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db: &db,
                session_id: "session-1",
                update: &update,
                previous_revision: SessionGraphRevision::new(6, 6, 6),
                revision: SessionGraphRevision::new(7, 6, 7),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: None,
            })
            .await
            .expect("tool call delta envelope");

        match envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.from_revision, SessionGraphRevision::new(6, 6, 6));
                assert_eq!(delta.to_revision, SessionGraphRevision::new(7, 6, 7));
                assert_eq!(delta.transcript_operations.len(), 0);
                assert_eq!(delta.operation_patches.len(), 1);
                assert_eq!(delta.operation_patches[0].tool_call_id, "tool-1");
                assert_eq!(
                    delta.activity.kind,
                    SessionGraphActivityKind::RunningOperation
                );
                assert_eq!(
                    delta.turn_state,
                    crate::acp::projections::SessionTurnState::Running
                );
                assert_eq!(delta.activity.active_operation_count, 1);
                assert_eq!(
                    delta.changed_fields,
                    vec![
                        "operations".to_string(),
                        "activity".to_string(),
                        "turnState".to_string(),
                        "activeTurnFailure".to_string(),
                        "lastTerminalTurnId".to_string(),
                        "lastAgentMessageId".to_string(),
                        "activeStreamingTail".to_string(),
                    ]
                );
                assert!(delta.last_agent_message_id.is_none());
            }
            other => panic!("expected delta payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn tool_call_update_emits_bounded_delta_with_updated_operation_patch() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let original_tool_call = SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "bun test", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        };
        let update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-1".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: Some(serde_json::json!({ "ok": true })),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        };

        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::Cursor);
        projection_registry.apply_session_update("session-1", &original_tool_call);
        projection_registry.apply_session_update("session-1", &update);

        let envelope = runtime_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db: &db,
                session_id: "session-1",
                update: &update,
                previous_revision: SessionGraphRevision::new(7, 6, 7),
                revision: SessionGraphRevision::new(8, 6, 8),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: None,
            })
            .await
            .expect("tool call update delta envelope");

        match envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.operation_patches.len(), 1);
                assert_eq!(delta.operation_patches[0].tool_call_id, "tool-1");
                assert_eq!(
                    delta.operation_patches[0].provider_status,
                    ToolCallStatus::Completed
                );
                assert_eq!(delta.activity.kind, SessionGraphActivityKind::AwaitingModel);
                assert_eq!(
                    delta.turn_state,
                    crate::acp::projections::SessionTurnState::Running
                );
            }
            other => panic!("expected delta payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn turn_cancelled_delta_carries_cancelled_operation_patch() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let active_tool_call = create_active_tool_call_update();
        let update = create_turn_cancelled_update();

        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::Cursor);
        projection_registry.apply_session_update("session-1", &active_tool_call);
        projection_registry.apply_session_update("session-1", &update);

        let envelope = runtime_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db: &db,
                session_id: "session-1",
                update: &update,
                previous_revision: SessionGraphRevision::new(7, 6, 7),
                revision: SessionGraphRevision::new(8, 6, 8),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: None,
            })
            .await
            .expect("turn cancelled delta envelope");

        match envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.operation_patches.len(), 1);
                assert_eq!(delta.operation_patches[0].tool_call_id, "active-tool");
                assert_eq!(
                    delta.operation_patches[0].operation_state,
                    crate::acp::projections::OperationState::Cancelled
                );
                assert_eq!(delta.activity.kind, SessionGraphActivityKind::Idle);
                assert_eq!(
                    delta.turn_state,
                    crate::acp::projections::SessionTurnState::Cancelled
                );
                assert!(
                    delta.changed_fields.contains(&"operations".to_string()),
                    "cancelled operation patches must mark operations as changed"
                );
            }
            other => panic!("expected delta payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn hot_tool_call_delta_payload_stays_history_independent() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;

        let short_envelope =
            build_delta_for_history_depth(&db, 4, create_active_tool_call_update(), false).await;
        let long_envelope =
            build_delta_for_history_depth(&db, 300, create_active_tool_call_update(), false).await;
        let doubled_envelope =
            build_delta_for_history_depth(&db, 600, create_active_tool_call_update(), false).await;

        assert_hot_tool_delta_contract(&short_envelope);
        assert_hot_tool_delta_contract(&long_envelope);
        assert_hot_tool_delta_contract(&doubled_envelope);
        match &long_envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.operation_patches[0].tool_call_id, "active-tool");
                assert_eq!(
                    delta.operation_patches[0].provider_status,
                    ToolCallStatus::InProgress
                );
            }
            other => panic!("expected delta payload, got {:?}", other),
        }
        assert_history_independent_payload_size(&short_envelope, &long_envelope);
        assert_history_independent_payload_size(&short_envelope, &doubled_envelope);
    }

    #[tokio::test]
    async fn hot_tool_call_update_delta_payload_stays_history_independent() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;

        let short_envelope =
            build_delta_for_history_depth(&db, 4, create_active_tool_completion_update(), true)
                .await;
        let long_envelope =
            build_delta_for_history_depth(&db, 300, create_active_tool_completion_update(), true)
                .await;
        let doubled_envelope =
            build_delta_for_history_depth(&db, 600, create_active_tool_completion_update(), true)
                .await;

        assert_hot_tool_delta_contract(&short_envelope);
        assert_hot_tool_delta_contract(&long_envelope);
        assert_hot_tool_delta_contract(&doubled_envelope);
        match &long_envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.operation_patches[0].tool_call_id, "active-tool");
                assert_eq!(
                    delta.operation_patches[0].provider_status,
                    ToolCallStatus::Completed
                );
            }
            other => panic!("expected delta payload, got {:?}", other),
        }
        assert_history_independent_payload_size(&short_envelope, &long_envelope);
        assert_history_independent_payload_size(&short_envelope, &doubled_envelope);
    }

    #[tokio::test]
    async fn non_turn_snapshot_payloads_are_measurable_history_scaling_surfaces() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;

        assert_snapshot_surface_scales_with_history(
            &db,
            "permission_request",
            create_permission_request_update(),
        )
        .await;
        assert_snapshot_surface_scales_with_history(
            &db,
            "question_request",
            create_question_request_update(),
        )
        .await;
        assert_snapshot_surface_scales_with_history(
            &db,
            "connection_complete",
            create_connection_complete_update(),
        )
        .await;
        assert_snapshot_surface_scales_with_history(
            &db,
            "connection_failed",
            create_connection_failed_update(),
        )
        .await;
    }

    #[tokio::test]
    async fn per_turn_terminal_updates_emit_history_independent_deltas() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;

        assert_turn_state_surface_stays_history_independent(
            &db,
            "turn_complete",
            create_turn_complete_update(),
            0,
        )
        .await;
        assert_turn_state_surface_stays_history_independent(
            &db,
            "turn_error",
            create_turn_error_update(),
            1,
        )
        .await;
        assert_turn_state_surface_stays_history_independent(
            &db,
            "turn_cancelled",
            create_turn_cancelled_update(),
            0,
        )
        .await;
    }

    #[tokio::test]
    async fn tool_call_delta_uses_snapshot_when_frontier_requires_repair() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let update = SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "bun test", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        };

        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::Cursor);
        projection_registry.apply_session_update("session-1", &update);

        let envelope = runtime_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db: &db,
                session_id: "session-1",
                update: &update,
                previous_revision: SessionGraphRevision::new(0, 0, 0),
                revision: SessionGraphRevision::new(7, 6, 7),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: None,
            })
            .await
            .expect("snapshot repair envelope");

        match envelope.payload {
            SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.revision, SessionGraphRevision::new(7, 6, 7));
                assert_eq!(graph.operations.len(), 1);
            }
            other => panic!("expected snapshot payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn missing_tool_operation_projection_falls_back_to_snapshot() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "missing-tool".to_string(),
                status: Some(ToolCallStatus::Completed),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        };

        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::Cursor);

        let envelope = runtime_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db: &db,
                session_id: "session-1",
                update: &update,
                previous_revision: SessionGraphRevision::new(7, 6, 7),
                revision: SessionGraphRevision::new(8, 6, 8),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: None,
            })
            .await
            .expect("snapshot fallback envelope");

        match envelope.payload {
            SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.revision, SessionGraphRevision::new(8, 6, 8));
                assert!(graph.operations.is_empty());
            }
            other => panic!("expected snapshot payload, got {:?}", other),
        }
    }

    #[test]
    fn telemetry_envelope_carries_canonical_usage_payload() {
        let revision = SessionGraphRevision::new(15, 8, 22);
        let envelope = build_live_session_state_telemetry_envelope(
            "session-1",
            UsageTelemetryData {
                session_id: "session-1".to_string(),
                event_id: Some("telemetry-1".to_string()),
                scope: "turn".to_string(),
                cost_usd: Some(0.42),
                tokens: UsageTelemetryTokens {
                    total: Some(1200),
                    input: Some(800),
                    output: Some(400),
                    cache_read: None,
                    cache_write: None,
                    reasoning: None,
                },
                source_model_id: None,
                timestamp_ms: Some(1_234),
                context_window_size: Some(200_000),
            },
            revision,
        );

        match envelope.payload {
            SessionStatePayload::Telemetry {
                telemetry,
                revision,
            } => {
                assert_eq!(telemetry.session_id, "session-1");
                assert_eq!(telemetry.event_id.as_deref(), Some("telemetry-1"));
                assert_eq!(telemetry.context_window_size, Some(200_000));
                assert_eq!(revision, SessionGraphRevision::new(15, 8, 22));
            }
            other => panic!("expected telemetry payload, got {:?}", other),
        }
    }

    #[test]
    fn capabilities_envelope_carries_revision_and_preview_metadata() {
        let revision = SessionGraphRevision::new(15, 8, 22);
        let envelope = build_live_session_state_capabilities_envelope(
            "session-1",
            SessionGraphCapabilities::empty(),
            revision,
            Some("mutation-1".to_string()),
            CapabilityPreviewState::Pending,
        );

        match envelope.payload {
            SessionStatePayload::Capabilities {
                revision,
                pending_mutation_id,
                preview_state,
                ..
            } => {
                assert_eq!(revision, SessionGraphRevision::new(15, 8, 22));
                assert_eq!(pending_mutation_id.as_deref(), Some("mutation-1"));
                assert_eq!(preview_state, CapabilityPreviewState::Pending);
            }
            other => panic!("expected capabilities payload, got {:?}", other),
        }
    }
}
