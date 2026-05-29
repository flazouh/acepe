use crate::acp::client_session::SessionModes;
use crate::acp::lifecycle::SessionSupervisor;
use crate::acp::lifecycle::{FailureReason, LifecycleCheckpoint, LifecycleState};
use crate::acp::projections::{ProjectionRegistry, SessionSnapshot};
use crate::acp::session_state_engine::frontier::{
    decide_frontier_transition, SessionFrontierDecision,
};
use crate::acp::session_state_engine::graph::select_active_streaming_tail;
use crate::acp::session_state_engine::protocol::{
    AssistantTextDeltaPayload, VisibleTranscriptWindowDiagnostic, VisibleTranscriptWindowPayload,
};
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::{
    build_delta_envelope, session_state_envelope_byte_budget_status, CapabilityPreviewState,
    DeltaEnvelopeParts, DeltaSessionProjectionFields, SessionGraphRevision, SessionStateEnvelope,
    SessionStatePayload,
};
use crate::acp::session_update::{sanitize_config_options_for_canonical, SessionUpdate};
use crate::acp::transcript_projection::{
    TranscriptDelta, TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole,
    TranscriptProjectionRegistry, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::transcript_viewport::{
    project_transcript_viewport_rows, HeightConfirmationOutcome, LayoutIndex, ScrollIntent,
    TranscriptViewport,
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
    transcript_viewports: Arc<Mutex<HashMap<String, TranscriptViewport>>>,
}

/// Why the builder could not materialize a visible transcript window for a command.
///
/// Distinguishes the recoverable "no canonical state in this backend runtime" case
/// (which the frontend should respond to by re-attaching the session) from the
/// benign over-budget no-op, which the frontend swallows without re-attaching.
/// A lagging command revision is NOT a miss: the builder resyncs to current
/// canonical state and echoes the current revision so the UI converges.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VisibleTranscriptWindowMiss {
    /// No canonical transcript state exists for this session in the current backend
    /// runtime. Recoverable by re-attaching the session.
    SessionNotAttached,
    /// The materialized envelope exceeded the byte budget and was skipped.
    BudgetExceeded,
}

#[derive(Debug, Clone)]
pub struct TranscriptViewportHeightConfirmation {
    pub row_id: String,
    pub row_version: String,
    pub height_px: u32,
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
            transcript_viewports: Arc::new(Mutex::new(HashMap::new())),
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
        self.transcript_viewports
            .lock()
            .expect("transcript_viewports mutex poisoned")
            .remove(session_id);
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
        if should_emit_connection_complete(request.update) {
            return Some(build_live_session_state_capabilities_envelope(
                request.session_id,
                self.snapshot_for_session(request.session_id).capabilities,
                request.revision,
                None,
                CapabilityPreviewState::Canonical,
            ));
        }

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

        if should_emit_session_state_lifecycle(request.update) {
            return Some(build_live_session_state_lifecycle_envelope(
                request.session_id,
                self.snapshot_for_session(request.session_id).lifecycle,
                request.revision,
            ));
        }

        if let Some(interaction_id) = interaction_id_for_patch(request.update) {
            return self
                .build_interaction_delta_envelope(&request, interaction_id)
                .await;
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
                        "activeStreamingTail".to_string(),
                    ];
                    if is_transcript_bearing {
                        changed_fields.push("transcriptSnapshot".to_string());
                    }
                    let envelope = build_delta_envelope(DeltaEnvelopeParts {
                        session_id: request.session_id,
                        from_revision,
                        to_revision,
                        projection,
                        transcript_operations,
                        operation_patches: vec![operation],
                        interaction_patches: Vec::new(),
                        changed_fields,
                    });
                    self.delta_or_snapshot_repair(&request, envelope).await
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
            } if is_transcript_bearing => {
                let envelope = build_live_session_state_delta_envelope(
                    delta,
                    from_revision,
                    to_revision,
                    self.delta_projection_for_session(
                        request.session_id,
                        request.projection_registry,
                        request.transcript_projection_registry,
                    ),
                );
                self.delta_or_snapshot_repair(&request, envelope).await
            }
            SessionFrontierDecision::AcceptDelta { .. } => None,
        }
    }

    #[must_use]
    pub fn build_assistant_text_delta_envelopes(
        &self,
        request: LiveSessionStateEnvelopeRequest<'_>,
    ) -> Vec<SessionStateEnvelope> {
        let snapshot = request
            .transcript_projection_registry
            .snapshot_for_session(request.session_id);
        let Some(snapshot) = snapshot else {
            return Vec::new();
        };
        let Some(transcript_delta) = request.transcript_delta else {
            return Vec::new();
        };
        build_assistant_text_delta_from_components(
            request.session_id,
            request.update,
            transcript_delta,
            &snapshot,
            request.revision,
        )
    }

    #[must_use]
    pub fn build_additional_session_state_envelopes(
        &self,
        request: LiveSessionStateEnvelopeRequest<'_>,
    ) -> Vec<SessionStateEnvelope> {
        let mut envelopes = Vec::new();
        if should_emit_connection_complete(request.update) {
            envelopes.push(build_live_session_state_lifecycle_envelope(
                request.session_id,
                self.snapshot_for_session(request.session_id).lifecycle,
                request.revision,
            ));
        }
        envelopes.extend(self.build_assistant_text_delta_envelopes(request));
        if let Ok(envelope) = self.build_visible_transcript_window_envelope_for_session(
            request.session_id,
            request.revision,
            request.projection_registry,
            request.transcript_projection_registry,
            720,
            None,
            None,
        ) {
            envelopes.push(envelope);
        }
        envelopes
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

                let envelope = build_delta_envelope(DeltaEnvelopeParts {
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
                });
                self.delta_or_snapshot_repair(request, envelope).await
            }
        }
    }

    async fn build_interaction_delta_envelope(
        &self,
        request: &LiveSessionStateEnvelopeRequest<'_>,
        interaction_id: &str,
    ) -> Option<SessionStateEnvelope> {
        let current_frontier = current_frontier_from_previous_revision(request.previous_revision);

        match decide_frontier_transition(current_frontier, request.revision, 0, false) {
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
                let Some(interaction) = request.projection_registry.interaction(interaction_id)
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
                let operation_patches = interaction
                    .canonical_operation_id
                    .as_deref()
                    .and_then(|operation_id| request.projection_registry.operation(operation_id))
                    .into_iter()
                    .collect::<Vec<_>>();
                let mut changed_fields = vec![
                    "interactions".to_string(),
                    "activity".to_string(),
                    "turnState".to_string(),
                    "activeTurnFailure".to_string(),
                    "lastTerminalTurnId".to_string(),
                    "activeStreamingTail".to_string(),
                ];
                if !operation_patches.is_empty() {
                    changed_fields.push("operations".to_string());
                }

                let envelope = build_delta_envelope(DeltaEnvelopeParts {
                    session_id: request.session_id,
                    from_revision,
                    to_revision,
                    projection: self.delta_projection_for_session(
                        request.session_id,
                        request.projection_registry,
                        request.transcript_projection_registry,
                    ),
                    transcript_operations: Vec::new(),
                    operation_patches,
                    interaction_patches: vec![interaction],
                    changed_fields,
                });
                self.delta_or_snapshot_repair(request, envelope).await
            }
        }
    }

    async fn delta_or_snapshot_repair(
        &self,
        request: &LiveSessionStateEnvelopeRequest<'_>,
        envelope: SessionStateEnvelope,
    ) -> Option<SessionStateEnvelope> {
        let delta_status = match session_state_envelope_byte_budget_status(&envelope) {
            Ok(_) => return Some(envelope),
            Err(status) => status,
        };
        tracing::warn!(
            session_id = %envelope.session_id,
            graph_revision = envelope.graph_revision,
            last_event_seq = envelope.last_event_seq,
            kind = ?delta_status.kind,
            byte_len = delta_status.byte_len,
            max_bytes = delta_status.max_bytes,
            "Delta session-state envelope exceeded byte budget; trying snapshot repair"
        );

        let snapshot = self
            .build_snapshot_envelope(
                request.db,
                request.session_id,
                request.revision,
                request.projection_registry,
                request.transcript_projection_registry,
            )
            .await?;

        if let Err(snapshot_status) = session_state_envelope_byte_budget_status(&snapshot) {
            tracing::warn!(
                session_id = %snapshot.session_id,
                graph_revision = snapshot.graph_revision,
                last_event_seq = snapshot.last_event_seq,
                kind = ?snapshot_status.kind,
                byte_len = snapshot_status.byte_len,
                max_bytes = snapshot_status.max_bytes,
                "Snapshot repair session-state envelope also exceeded byte budget; skipping"
            );
            return None;
        }

        Some(snapshot)
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
                    sequence_id: metadata.sequence_id,
                    revision,
                    transcript_snapshot,
                    operations: projection_snapshot.operations,
                    interactions: projection_snapshot.interactions,
                    turn_state: session_snapshot.turn_state,
                    message_count: session_snapshot.message_count,
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
        );
        DeltaSessionProjectionFields {
            activity,
            turn_state: session_snapshot.turn_state,
            active_turn_failure: session_snapshot.active_turn_failure,
            last_terminal_turn_id: session_snapshot.last_terminal_turn_id,
            active_streaming_tail,
        }
    }

    pub fn build_visible_transcript_window_envelope_for_session(
        &self,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: u32,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        let transcript_snapshot = transcript_projection_registry
            .snapshot_for_session(session_id)
            .ok_or(VisibleTranscriptWindowMiss::SessionNotAttached)?;
        let projection_snapshot = projection_registry.session_projection(session_id);
        let session_snapshot = projection_snapshot
            .session
            .ok_or(VisibleTranscriptWindowMiss::SessionNotAttached)?;
        let runtime_snapshot = self.snapshot_for_session(session_id);
        // Read-shaped viewport commands (resize, scroll, reveal, confirm-height)
        // race the canonical revision: during streaming the transcript/graph
        // revision bumps on every event, so any command the UI sends is already
        // behind by the time it reaches the backend. Rejecting on a revision lag
        // produced a retry storm — the UI re-issued the same stale revision, the
        // layout never settled to canonical heights, and per-row observers kept
        // re-measuring forever, pegging the main thread. Instead we resync: build
        // against the CURRENT canonical snapshots and echo the current canonical
        // revision so the UI adopts it and converges. Canonical order and
        // identity always come from the current transcript snapshot, never from
        // the command's claimed revision, and height confirmations stay
        // version-guarded inside the viewport, so resync cannot corrupt state.
        let effective_revision = SessionGraphRevision {
            graph_revision: if runtime_snapshot.graph_revision != 0 {
                runtime_snapshot.graph_revision
            } else {
                revision.graph_revision
            },
            transcript_revision: transcript_snapshot.revision,
            last_event_seq: revision.last_event_seq.max(transcript_snapshot.revision),
        };
        let operations = projection_snapshot.operations.clone();
        let interactions = projection_snapshot.interactions.clone();
        let activity = select_session_graph_activity(
            &runtime_snapshot.lifecycle,
            &session_snapshot.turn_state,
            &operations,
            &interactions,
            session_snapshot.active_turn_failure.as_ref(),
        );
        let active_streaming_tail = select_active_streaming_tail(
            &session_snapshot.turn_state,
            &activity,
            &transcript_snapshot,
        );
        let rows = project_transcript_viewport_rows(
            &transcript_snapshot,
            &operations,
            &interactions,
            active_streaming_tail.as_ref(),
        );
        let mut diagnostics = Vec::new();
        let (window, visible_rows, row_offsets_px, viewport_revision) = {
            let mut viewports = self
                .transcript_viewports
                .lock()
                .expect("transcript_viewports mutex poisoned");
            if let Some(viewport) = viewports.get_mut(session_id) {
                let layout =
                    LayoutIndex::from_viewport_rows_preserving(rows.as_slice(), viewport.layout());
                viewport.replace_layout_preserving_viewport(layout);
                viewport.resize(viewport_height_px);
            } else {
                viewports.insert(
                    session_id.to_string(),
                    TranscriptViewport::new(
                        LayoutIndex::from_viewport_rows(rows.as_slice()),
                        viewport_height_px,
                    )
                    .with_viewport_revision(effective_revision.transcript_revision),
                );
            }

            let viewport = viewports
                .get_mut(session_id)
                .expect("viewport inserted before materialization");
            if let Some(intent) = scroll_intent {
                viewport.apply_scroll_intent(intent);
            }
            if let Some(confirmation) = height_confirmation {
                let transition = viewport.confirm_height(
                    &confirmation.row_id,
                    &confirmation.row_version,
                    confirmation.height_px,
                );
                if let Some(outcome) = transition.height_confirmation {
                    if outcome != HeightConfirmationOutcome::Accepted {
                        diagnostics.push(VisibleTranscriptWindowDiagnostic {
                            code: height_confirmation_diagnostic_code(outcome).to_string(),
                            row_id: Some(confirmation.row_id),
                        });
                    }
                }
                let window = transition.window;
                let visible_rows =
                    rows[window.visible_start_index..window.visible_end_index].to_vec();
                let row_offsets_px = visible_rows
                    .iter()
                    .map(|row| viewport.layout().row_offset_px(&row.row_id).unwrap_or(0))
                    .collect();
                (
                    window,
                    visible_rows,
                    row_offsets_px,
                    viewport.viewport_revision(),
                )
            } else {
                let window = viewport.window();
                let visible_rows =
                    rows[window.visible_start_index..window.visible_end_index].to_vec();
                let row_offsets_px = visible_rows
                    .iter()
                    .map(|row| viewport.layout().row_offset_px(&row.row_id).unwrap_or(0))
                    .collect();
                (
                    window,
                    visible_rows,
                    row_offsets_px,
                    viewport.viewport_revision(),
                )
            }
        };
        let envelope = SessionStateEnvelope {
            session_id: session_id.to_string(),
            graph_revision: effective_revision.graph_revision,
            last_event_seq: effective_revision.last_event_seq,
            payload: SessionStatePayload::VisibleTranscriptWindow {
                window: VisibleTranscriptWindowPayload {
                    session_id: session_id.to_string(),
                    graph_revision: effective_revision,
                    viewport_revision,
                    total_height_px: window.total_height_px,
                    viewport_offset_px: window.offset_px,
                    visible_start_index: window.visible_start_index,
                    visible_end_index: window.visible_end_index,
                    rows: visible_rows,
                    row_offsets_px,
                    mode: window.mode,
                    diagnostics,
                },
            },
        };

        match session_state_envelope_byte_budget_status(&envelope) {
            Ok(_) => Ok(envelope),
            Err(status) => {
                tracing::warn!(
                    session_id,
                    byte_len = status.byte_len,
                    max_bytes = status.max_bytes,
                    "Visible transcript window envelope exceeded byte budget; skipping"
                );
                Err(VisibleTranscriptWindowMiss::BudgetExceeded)
            }
        }
    }
}

fn height_confirmation_diagnostic_code(outcome: HeightConfirmationOutcome) -> &'static str {
    match outcome {
        HeightConfirmationOutcome::Accepted => "height_accepted",
        HeightConfirmationOutcome::StaleVersion => "stale_height_confirmation",
        HeightConfirmationOutcome::MissingRow => "missing_height_confirmation_row",
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
                    config_options: config_options
                        .clone()
                        .map(sanitize_config_options_for_canonical),
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
                self.capabilities.available_commands = Some(update.available_commands.clone());
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
                self.capabilities.config_options = Some(sanitize_config_options_for_canonical(
                    update.config_options.clone(),
                ));
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
) -> Vec<SessionStateEnvelope> {
    let SessionUpdate::AgentMessageChunk {
        chunk,
        produced_at_monotonic_ms: Some(produced_at_monotonic_ms),
        ..
    } = update
    else {
        return Vec::new();
    };
    let Some(delta_text) = assistant_text_from_update_chunk(chunk) else {
        return Vec::new();
    };
    let Some(row_entry_id) = assistant_row_entry_id(transcript_delta) else {
        return Vec::new();
    };
    let Some((row_index, row_entry)) = snapshot.entries.iter().enumerate().find(|(_, entry)| {
        entry.role == TranscriptEntryRole::Assistant && entry.entry_id == row_entry_id
    }) else {
        return Vec::new();
    };
    let total_chars = transcript_entry_text_char_count(row_entry);
    let delta_chars = delta_text.chars().count();
    let char_offset_chars = total_chars.saturating_sub(delta_chars);
    let start_char_offset = match u32::try_from(char_offset_chars) {
        Ok(value) => value,
        Err(_) => {
            tracing::error!(
                session_id,
                row_entry_id,
                char_offset_chars,
                "Assistant text delta char offset exceeded u32::MAX; skipping envelope"
            );
            return Vec::new();
        }
    };
    let row_id = sanitize_row_id(row_entry_id);
    let turn_id = assistant_turn_id_from_snapshot(snapshot, row_index, &row_id);
    build_budgeted_assistant_text_delta_state_envelopes(
        session_id,
        revision,
        turn_id,
        row_id,
        start_char_offset,
        delta_text,
        *produced_at_monotonic_ms,
    )
}

fn build_budgeted_assistant_text_delta_state_envelopes(
    session_id: &str,
    revision: SessionGraphRevision,
    turn_id: String,
    row_id: String,
    start_char_offset: u32,
    delta_text: &str,
    produced_at_monotonic_ms: u64,
) -> Vec<SessionStateEnvelope> {
    if delta_text.is_empty() {
        return vec![build_assistant_text_delta_state_envelope(
            session_id,
            revision,
            AssistantTextDeltaPayload {
                turn_id,
                row_id,
                char_offset: start_char_offset,
                delta_text: String::new(),
                produced_at_monotonic_ms,
                revision: revision.transcript_revision,
            },
        )];
    }

    const INITIAL_CHUNK_BYTES: usize = 6_000;
    let mut envelopes = Vec::new();
    let mut offset = 0;
    let mut char_offset = start_char_offset;

    while offset < delta_text.len() {
        let mut chunk_end = next_char_boundary(delta_text, offset, INITIAL_CHUNK_BYTES);
        let mut accepted = None;

        while chunk_end > offset {
            let chunk = &delta_text[offset..chunk_end];
            let envelope = build_assistant_text_delta_state_envelope(
                session_id,
                revision,
                AssistantTextDeltaPayload {
                    turn_id: turn_id.clone(),
                    row_id: row_id.clone(),
                    char_offset,
                    delta_text: chunk.to_string(),
                    produced_at_monotonic_ms,
                    revision: revision.transcript_revision,
                },
            );

            match session_state_envelope_byte_budget_status(&envelope) {
                Ok(_) => {
                    accepted = Some((envelope, chunk.chars().count()));
                    break;
                }
                Err(status) => {
                    if chunk.chars().count() <= 1 {
                        tracing::warn!(
                            session_id,
                            byte_len = status.byte_len,
                            max_bytes = status.max_bytes,
                            "Skipping assistant text delta chunk that cannot fit byte budget"
                        );
                        return envelopes;
                    }
                    chunk_end = previous_midpoint_char_boundary(delta_text, offset, chunk_end);
                }
            }
        }

        let Some((envelope, chunk_chars)) = accepted else {
            break;
        };
        envelopes.push(envelope);
        offset = chunk_end;
        char_offset = char_offset.saturating_add(chunk_chars as u32);
    }

    envelopes
}

fn next_char_boundary(value: &str, start: usize, max_bytes: usize) -> usize {
    let mut end = value.len().min(start.saturating_add(max_bytes));
    while end > start && !value.is_char_boundary(end) {
        end -= 1;
    }
    if end == start {
        value[start..]
            .char_indices()
            .nth(1)
            .map(|(index, _)| start + index)
            .unwrap_or(value.len())
    } else {
        end
    }
}

fn previous_midpoint_char_boundary(value: &str, start: usize, end: usize) -> usize {
    let mut midpoint = start + (end - start) / 2;
    while midpoint > start && !value.is_char_boundary(midpoint) {
        midpoint -= 1;
    }
    midpoint
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

fn build_live_session_state_lifecycle_envelope(
    session_id: &str,
    lifecycle: SessionGraphLifecycle,
    revision: SessionGraphRevision,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::Lifecycle {
            lifecycle,
            revision,
        },
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

fn should_emit_connection_complete(update: &SessionUpdate) -> bool {
    matches!(update, SessionUpdate::ConnectionComplete { .. })
}

fn should_emit_session_state_snapshot(_update: &SessionUpdate) -> bool {
    false
}

fn should_emit_session_state_lifecycle(update: &SessionUpdate) -> bool {
    matches!(update, SessionUpdate::ConnectionFailed { .. })
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

fn interaction_id_for_patch(update: &SessionUpdate) -> Option<&str> {
    match update {
        SessionUpdate::PermissionRequest { permission, .. } => Some(permission.id.as_str()),
        SessionUpdate::QuestionRequest { question, .. } => Some(question.id.as_str()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_assistant_text_delta_from_components, build_live_session_state_capabilities_envelope,
        build_live_session_state_delta_envelope, build_live_session_state_telemetry_envelope,
        session_state_envelope_byte_budget_status, CapabilityPreviewState,
        LiveSessionStateEnvelopeRequest, SessionGraphRuntimeRegistry, VisibleTranscriptWindowMiss,
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
        AvailableCommandsData, ConfigOptionData, ConfigOptionPresentation, ContentChunk,
        CurrentModeData, SessionUpdate, UsageTelemetryData, UsageTelemetryTokens,
    };
    use crate::acp::session_update::{
        InteractionReplyHandler, PermissionData, QuestionData, QuestionItem, QuestionOption,
        ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind, TurnErrorData,
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

    fn create_oversized_active_tool_completion_update() -> SessionUpdate {
        SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "active-tool".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: Some(serde_json::json!({ "stdout": "x".repeat(70_000) })),
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
        seed_lifecycle(&runtime_registry, "session-1", 10);

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
        .into_iter()
        .next()
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
    fn assistant_text_delta_envelope_keeps_empty_delta_for_live_event_row_id() {
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
                assert_eq!(delta.row_id, "assistant-event-1");
                assert_eq!(delta.turn_id, "assistant-event-1");
                assert_eq!(delta.char_offset, 5);
                assert_eq!(delta.delta_text, "");
                assert_eq!(delta.produced_at_monotonic_ms, 6);
            }
            other => panic!("expected assistant text delta payload, got {other:?}"),
        }
    }

    #[test]
    fn assistant_text_delta_envelope_splits_oversized_chunks_at_source() {
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let oversized_text = "x".repeat(8_000);
        let update =
            create_agent_message_chunk_update("session-1", Some("assistant-1"), &oversized_text, 5);
        let transcript_delta = transcript_projection_registry
            .apply_session_update(1, &update)
            .expect("transcript delta");
        let snapshot = transcript_projection_registry
            .snapshot_for_session("session-1")
            .expect("transcript snapshot");

        let envelopes = build_assistant_text_delta_from_components(
            "session-1",
            &update,
            &transcript_delta,
            &snapshot,
            SessionGraphRevision::new(1, 1, 1),
        );

        assert!(
            envelopes.len() > 1,
            "oversized assistant text deltas should be split, not dropped"
        );
        let mut reconstructed = String::new();
        for envelope in &envelopes {
            session_state_envelope_byte_budget_status(envelope)
                .expect("split assistant text delta should stay within budget");
            match &envelope.payload {
                SessionStatePayload::AssistantTextDelta { delta } => {
                    reconstructed.push_str(&delta.delta_text);
                }
                other => panic!("expected assistant text delta payload, got {other:?}"),
            }
        }
        assert_eq!(reconstructed, oversized_text);
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

    fn assert_interaction_delta_contract(
        surface: &str,
        envelope: &SessionStateEnvelope,
        expected_interaction_id: &str,
    ) {
        match &envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(
                    delta.transcript_operations.len(),
                    0,
                    "{surface} must not carry transcript work"
                );
                assert_eq!(delta.interaction_patches.len(), 1);
                assert_eq!(delta.interaction_patches[0].id, expected_interaction_id);
                assert_eq!(delta.operation_patches.len(), 0);
                assert!(
                    delta.changed_fields.contains(&"interactions".to_string()),
                    "{surface} delta should update interactions"
                );
                assert!(
                    delta.changed_fields.contains(&"activity".to_string()),
                    "{surface} delta should update activity"
                );
            }
            other => panic!("expected interaction delta for {surface}, got {:?}", other),
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

    async fn assert_lifecycle_surface_stays_history_independent(
        db: &DbConn,
        surface: &str,
        update_under_test: SessionUpdate,
    ) {
        let short_envelope =
            build_snapshot_for_history_depth(db, 4, update_under_test.clone()).await;
        let long_envelope =
            build_snapshot_for_history_depth(db, 300, update_under_test.clone()).await;
        let doubled_envelope = build_snapshot_for_history_depth(db, 600, update_under_test).await;
        for envelope in [&short_envelope, &long_envelope, &doubled_envelope] {
            match &envelope.payload {
                SessionStatePayload::Lifecycle { lifecycle, .. } => {
                    assert_eq!(
                        lifecycle.status,
                        crate::acp::lifecycle::LifecycleStatus::Failed,
                        "{surface} should carry lifecycle failure state"
                    );
                    assert!(
                        lifecycle.error_message.is_some(),
                        "{surface} should carry lifecycle error details"
                    );
                }
                other => panic!("expected lifecycle payload for {surface}, got {:?}", other),
            }
        }
        assert_history_independent_payload_size(&short_envelope, &long_envelope);
        assert_history_independent_payload_size(&short_envelope, &doubled_envelope);
    }

    async fn assert_capabilities_surface_stays_history_independent(
        db: &DbConn,
        surface: &str,
        update_under_test: SessionUpdate,
    ) {
        let short_envelope =
            build_snapshot_for_history_depth(db, 4, update_under_test.clone()).await;
        let long_envelope =
            build_snapshot_for_history_depth(db, 300, update_under_test.clone()).await;
        let doubled_envelope = build_snapshot_for_history_depth(db, 600, update_under_test).await;
        for envelope in [&short_envelope, &long_envelope, &doubled_envelope] {
            match &envelope.payload {
                SessionStatePayload::Capabilities { capabilities, .. } => {
                    assert!(
                        capabilities.models.is_some(),
                        "{surface} should carry canonical model capabilities"
                    );
                    assert!(
                        capabilities.modes.is_some(),
                        "{surface} should carry canonical mode capabilities"
                    );
                }
                other => panic!(
                    "expected capabilities payload for {surface}, got {:?}",
                    other
                ),
            }
        }
        assert_history_independent_payload_size(&short_envelope, &long_envelope);
        assert_history_independent_payload_size(&short_envelope, &doubled_envelope);
    }

    async fn assert_interaction_surface_stays_history_independent(
        db: &DbConn,
        surface: &str,
        update_under_test: SessionUpdate,
        expected_interaction_id: &str,
    ) {
        let short_envelope =
            build_snapshot_for_history_depth(db, 4, update_under_test.clone()).await;
        let long_envelope =
            build_snapshot_for_history_depth(db, 300, update_under_test.clone()).await;
        let doubled_envelope = build_snapshot_for_history_depth(db, 600, update_under_test).await;
        assert_interaction_delta_contract(surface, &short_envelope, expected_interaction_id);
        assert_interaction_delta_contract(surface, &long_envelope, expected_interaction_id);
        assert_interaction_delta_contract(surface, &doubled_envelope, expected_interaction_id);
        assert_history_independent_payload_size(&short_envelope, &long_envelope);
        assert_history_independent_payload_size(&short_envelope, &doubled_envelope);
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
            available_commands: Some(Vec::new()),
            config_options: Some(Vec::new()),
            autonomous_enabled: Some(false),
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
            diagnostic_input: None,
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

    fn create_read_tool_call(id: &str, file_path: &str, status: ToolCallStatus) -> ToolCallData {
        ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some(file_path.to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some(format!("Read {file_path}")),
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
                available_commands: Some(Vec::new()),
                config_options: Some(Vec::new()),
                autonomous_enabled: Some(false),
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
                        presentation: ConfigOptionPresentation::Advanced,
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
        assert_eq!(
            snapshot
                .capabilities
                .available_commands
                .as_ref()
                .expect("available commands")
                .len(),
            1
        );
        assert_eq!(
            snapshot
                .capabilities
                .config_options
                .as_ref()
                .expect("config options")
                .len(),
            1
        );
        assert_eq!(snapshot.capabilities.autonomous_enabled, Some(false));
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
                available_commands: Some(Vec::new()),
                config_options: Some(Vec::new()),
                autonomous_enabled: Some(false),
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
                        "activeStreamingTail".to_string(),
                    ]
                );
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
    async fn read_tool_call_update_delta_carries_source_excerpt_from_raw_output() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let original_tool_call = SessionUpdate::ToolCall {
            tool_call: create_read_tool_call(
                "tool-read",
                "/repo/src/lib.rs",
                ToolCallStatus::InProgress,
            ),
            session_id: Some("session-1".to_string()),
        };
        let update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-read".to_string(),
                status: Some(ToolCallStatus::Completed),
                raw_output: Some(serde_json::json!({
                    "content": "     1\tpub fn answer() -> i32 {\n     2\t    42\n     3\t}"
                })),
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
                assert_eq!(delta.operation_patches[0].tool_call_id, "tool-read");
                match &delta.operation_patches[0].arguments {
                    ToolArguments::Read { source_context, .. } => {
                        let source_context = source_context
                            .as_ref()
                            .expect("completed read patch should expose source context");
                        assert_eq!(
                            source_context.excerpt.as_deref(),
                            Some("     1\tpub fn answer() -> i32 {\n     2\t    42\n     3\t}")
                        );
                    }
                    other => panic!("expected read arguments, got {:?}", other),
                }
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
    async fn linked_interaction_delta_carries_blocked_operation_patch() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let active_tool_call = create_active_tool_call_update();
        let update = SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-linked".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(7),
                reply_handler: Some(InteractionReplyHandler::json_rpc(7)),
                permission: "Execute".to_string(),
                patterns: Vec::new(),
                metadata: serde_json::json!({}),
                always: Vec::new(),
                auto_accepted: false,
                tool: Some(crate::acp::session_update::ToolReference {
                    message_id: None,
                    call_id: "active-tool".to_string(),
                }),
            },
            session_id: Some("session-1".to_string()),
        };

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
            .expect("linked interaction delta envelope");

        match envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.interaction_patches.len(), 1);
                assert_eq!(delta.interaction_patches[0].id, "permission-linked");
                assert_eq!(delta.operation_patches.len(), 1);
                assert_eq!(delta.operation_patches[0].tool_call_id, "active-tool");
                assert_eq!(
                    delta.operation_patches[0].operation_state,
                    crate::acp::projections::OperationState::Blocked
                );
                assert!(delta.changed_fields.contains(&"interactions".to_string()));
                assert!(delta.changed_fields.contains(&"operations".to_string()));
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
    async fn oversized_hot_tool_delta_falls_back_to_bounded_snapshot_repair() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;

        let envelope = build_delta_for_history_depth(
            &db,
            4,
            create_oversized_active_tool_completion_update(),
            true,
        )
        .await;

        match &envelope.payload {
            SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.revision, SessionGraphRevision::new(11, 10, 11));
                assert!(graph
                    .operations
                    .iter()
                    .any(|operation| operation.tool_call_id == "active-tool"
                        && operation.provider_status == ToolCallStatus::Completed));
                assert!(serialized_envelope_len(&envelope) <= 2_000_000);
            }
            other => panic!("expected snapshot repair payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn interaction_requests_emit_history_independent_deltas() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;

        assert_interaction_surface_stays_history_independent(
            &db,
            "permission_request",
            create_permission_request_update(),
            "permission-1",
        )
        .await;
        assert_interaction_surface_stays_history_independent(
            &db,
            "question_request",
            create_question_request_update(),
            "question-1",
        )
        .await;
    }

    #[tokio::test]
    async fn connection_complete_emits_history_independent_capabilities() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;

        assert_capabilities_surface_stays_history_independent(
            &db,
            "connection_complete",
            create_connection_complete_update(),
        )
        .await;
    }

    #[tokio::test]
    async fn connection_failed_emits_history_independent_lifecycle() {
        let db = setup_test_db().await;
        insert_session_metadata(&db, "session-1").await;

        assert_lifecycle_surface_stays_history_independent(
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

    #[test]
    fn visible_window_builder_reports_session_not_attached_when_no_canonical_state() {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        let outcome = runtime_registry.build_visible_transcript_window_envelope_for_session(
            "unknown-session",
            SessionGraphRevision::new(1, 0, 1),
            &projection_registry,
            &transcript_projection_registry,
            720,
            None,
            None,
        );

        assert_eq!(
            outcome.unwrap_err(),
            VisibleTranscriptWindowMiss::SessionNotAttached
        );
    }

    #[test]
    fn visible_window_builder_resyncs_when_transcript_revision_behind() {
        // During streaming the canonical transcript revision bumps on every
        // event, so a viewport command racing the stream arrives with a lagging
        // transcript_revision. The builder must NOT hard-fail (that produced a
        // retry storm). It resyncs: builds against the current canonical
        // snapshot and echoes the current canonical revision so the UI converges.
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        projection_registry.register_session("session-stale".to_string(), CanonicalAgentId::Cursor);
        let update =
            create_agent_message_chunk_update("session-stale", Some("assistant-1"), "hello", 5);
        projection_registry.apply_session_update("session-stale", &update);
        // Drive the canonical transcript revision to 7.
        let _ = transcript_projection_registry.apply_session_update(7, &update);

        // Command carries a stale transcript_revision (4 < 7).
        let outcome = runtime_registry.build_visible_transcript_window_envelope_for_session(
            "session-stale",
            SessionGraphRevision::new(0, 4, 1),
            &projection_registry,
            &transcript_projection_registry,
            720,
            None,
            None,
        );

        let envelope = outcome.expect("stale transcript revision must resync, not reject");
        match envelope.payload {
            SessionStatePayload::VisibleTranscriptWindow { window } => {
                assert_eq!(
                    window.graph_revision.transcript_revision, 7,
                    "resynced window must echo the current canonical transcript revision"
                );
            }
            other => panic!("expected visible transcript window payload, got {other:?}"),
        }
    }

    #[test]
    fn visible_window_builder_resyncs_when_graph_revision_behind() {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        // Seed the runtime with a canonical graph revision of 5.
        runtime_registry.restore_session_checkpoint(
            "session-graph".to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                5,
                crate::acp::lifecycle::LifecycleState::ready(),
                SessionGraphCapabilities::empty(),
            ),
        );
        projection_registry.register_session("session-graph".to_string(), CanonicalAgentId::Cursor);
        let update =
            create_agent_message_chunk_update("session-graph", Some("assistant-1"), "hello", 5);
        projection_registry.apply_session_update("session-graph", &update);
        let _ = transcript_projection_registry.apply_session_update(7, &update);

        // Command carries the current transcript_revision but a stale graph_revision (0 < 5).
        let outcome = runtime_registry.build_visible_transcript_window_envelope_for_session(
            "session-graph",
            SessionGraphRevision::new(0, 7, 1),
            &projection_registry,
            &transcript_projection_registry,
            720,
            None,
            None,
        );

        let envelope = outcome.expect("stale graph revision must resync, not reject");
        match envelope.payload {
            SessionStatePayload::VisibleTranscriptWindow { window } => {
                assert_eq!(
                    window.graph_revision.graph_revision, 5,
                    "resynced window must echo the current canonical graph revision"
                );
                assert_eq!(window.graph_revision.transcript_revision, 7);
            }
            other => panic!("expected visible transcript window payload, got {other:?}"),
        }
    }

    #[test]
    fn visible_window_builder_requires_projection_session_even_when_transcript_present() {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        // Transcript snapshot is present and revision-aligned, but the projection
        // registry has no session snapshot for this id. The builder must miss as
        // SessionNotAttached rather than fabricate an empty session.
        transcript_projection_registry.restore_session_snapshot(
            "session-missing-projection".to_string(),
            TranscriptSnapshot {
                revision: 3,
                entries: Vec::new(),
            },
        );

        let outcome = runtime_registry.build_visible_transcript_window_envelope_for_session(
            "session-missing-projection",
            SessionGraphRevision::new(0, 3, 1),
            &projection_registry,
            &transcript_projection_registry,
            720,
            None,
            None,
        );

        assert_eq!(
            outcome.unwrap_err(),
            VisibleTranscriptWindowMiss::SessionNotAttached
        );
    }
}
