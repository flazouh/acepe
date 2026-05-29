use crate::acp::client_session::SessionModes;
use crate::acp::lifecycle::SessionSupervisor;
use crate::acp::lifecycle::{FailureReason, LifecycleCheckpoint, LifecycleState};
use crate::acp::projections::{ProjectionRegistry, SessionSnapshot};
use crate::acp::session_state_engine::frontier::{
    decide_frontier_transition, SessionFrontierDecision,
};
use crate::acp::session_state_engine::graph::select_active_streaming_tail;
use crate::acp::session_state_engine::protocol::{
    AssistantTextDeltaPayload, ViewportBufferDelta, ViewportBufferDiagnostic, ViewportBufferPush,
    VisibleTranscriptWindowDiagnostic, VisibleTranscriptWindowPayload,
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
    TranscriptViewport, TranscriptViewportRow, ViewportBufferSlice, DEFAULT_BUFFER_OVERSCAN_ROWS,
};
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Viewport height used ONLY to bootstrap a brand-new `TranscriptViewport` when
/// the caller has not supplied a measured height (the streaming buffer producer
/// passes `None` to preserve canonical stored height). Once any command resizes
/// the viewport with a real measured height, that value persists and is never
/// overwritten by a streaming tick — this is the B3 fix that stops the producer
/// from clobbering the real height (which churned `viewport_revision` and
/// oscillated the buffer window indices into a spurious delta/push storm).
const BOOTSTRAP_VIEWPORT_HEIGHT_PX: u32 = 720;

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

/// What the producer last pushed/sent for a session's transcript buffer. The
/// next emission diffs against this to decide push vs delta vs skip, and to
/// assign a contiguous per-session `emission_seq`.
///
/// `emission_seq` is the SOLE apply-ordering authority on the consumer, because
/// `viewport_revision` does not advance on streaming row appends and therefore
/// cannot sequence the two independent delivery channels (command `invoke()`
/// replies and the live event stream).
#[derive(Debug, Clone)]
struct BufferEmissionRecord {
    start_index: usize,
    row_ids: Vec<String>,
    row_versions: Vec<String>,
    viewport_revision: i64,
    emission_seq: u64,
}

#[derive(Debug, Clone)]
pub struct SessionGraphRuntimeRegistry {
    supervisor: Arc<SessionSupervisor>,
    session_anchors: Arc<Mutex<HashMap<String, Arc<SessionAnchor>>>>,
    transcript_viewports: Arc<Mutex<HashMap<String, TranscriptViewport>>>,
    // LOCK ORDER: buffer_emissions -> transcript_viewports. Never acquire
    // transcript_viewports first and then buffer_emissions, or the buffer
    // emission method below will deadlock.
    buffer_emissions: Arc<Mutex<HashMap<String, BufferEmissionRecord>>>,
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
            buffer_emissions: Arc::new(Mutex::new(HashMap::new())),
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
        if let Ok(Some(envelope)) = self.build_or_advance_viewport_buffer_envelope(
            request.session_id,
            request.revision,
            request.projection_registry,
            request.transcript_projection_registry,
            None,
            None,
            None,
            None,
            false,
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

    /// Shared prologue + viewport mutation for every read-shaped viewport
    /// command. Reads the current canonical snapshots, resyncs the effective
    /// revision (never rejects on a stale claimed revision — see retry-storm
    /// note below), projects rows, then locks the viewport, applies scroll /
    /// height-confirmation, and hands a read-only view to `materialize` which
    /// produces the wire payload. The byte budget is enforced uniformly.
    ///
    /// Read-shaped viewport commands (resize, scroll, reveal, confirm-height)
    /// race the canonical revision: during streaming the transcript/graph
    /// revision bumps on every event, so any command the UI sends is already
    /// behind by the time it reaches the backend. Rejecting on a revision lag
    /// produced a retry storm — the UI re-issued the same stale revision, the
    /// layout never settled to canonical heights, and per-row observers kept
    /// re-measuring forever, pegging the main thread. Instead we resync: build
    /// against the CURRENT canonical snapshots and echo the current canonical
    /// revision so the UI adopts it and converges. Canonical order and identity
    /// always come from the current transcript snapshot, never from the
    /// command's claimed revision, and height confirmations stay version-guarded
    /// inside the viewport, so resync cannot corrupt state.
    /// Run the shared viewport prologue under the `transcript_viewports` lock
    /// (rebuild layout from canonical rows, conditionally resize, apply scroll
    /// intent + height confirmation) and hand a read-only context to
    /// `materialize`, which may return any `T`. Returns `T` alongside the
    /// computed `effective_revision` for envelope finalization.
    ///
    /// Unlike a payload-shaped closure this lets the buffer producer pull a
    /// `ViewportBufferSlice` (plus the canonical rows) back out of the locked
    /// region so it can classify push/delta/no-op ABOVE the closure — the
    /// no-op "emit nothing" outcome cannot be expressed by returning a payload.
    fn with_materialized_viewport<T, F>(
        &self,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: Option<u32>,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
        materialize: F,
    ) -> Result<(T, SessionGraphRevision), VisibleTranscriptWindowMiss>
    where
        F: FnOnce(ViewportMaterializeCtx<'_>) -> T,
    {
        let transcript_snapshot = transcript_projection_registry
            .snapshot_for_session(session_id)
            .ok_or(VisibleTranscriptWindowMiss::SessionNotAttached)?;
        let projection_snapshot = projection_registry.session_projection(session_id);
        let session_snapshot = projection_snapshot
            .session
            .ok_or(VisibleTranscriptWindowMiss::SessionNotAttached)?;
        let runtime_snapshot = self.snapshot_for_session(session_id);
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
        let materialized = {
            let mut viewports = self
                .transcript_viewports
                .lock()
                .expect("transcript_viewports mutex poisoned");
            if let Some(viewport) = viewports.get_mut(session_id) {
                let layout =
                    LayoutIndex::from_viewport_rows_preserving(rows.as_slice(), viewport.layout());
                viewport.replace_layout_preserving_viewport(layout);
                // `None` preserves the canonical stored height (streaming
                // producer); only a real command-measured height resizes.
                if let Some(height) = viewport_height_px {
                    viewport.resize(height);
                }
            } else {
                viewports.insert(
                    session_id.to_string(),
                    TranscriptViewport::new(
                        LayoutIndex::from_viewport_rows(rows.as_slice()),
                        viewport_height_px.unwrap_or(BOOTSTRAP_VIEWPORT_HEIGHT_PX),
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
            let height_diagnostic = height_confirmation.and_then(|confirmation| {
                let transition = viewport.confirm_height(
                    &confirmation.row_id,
                    &confirmation.row_version,
                    confirmation.height_px,
                );
                transition.height_confirmation.and_then(|outcome| {
                    (outcome != HeightConfirmationOutcome::Accepted).then(|| {
                        ViewportHeightDiagnostic {
                            code: height_confirmation_diagnostic_code(outcome).to_string(),
                            row_id: Some(confirmation.row_id),
                        }
                    })
                })
            });

            materialize(ViewportMaterializeCtx {
                session_id,
                effective_revision,
                rows: rows.as_slice(),
                viewport,
                height_diagnostic,
            })
        };
        Ok((materialized, effective_revision))
    }

    /// Wrap a materialized payload in a `SessionStateEnvelope` and enforce the
    /// per-payload byte budget. Shared by every viewport producer.
    fn finalize_viewport_envelope(
        &self,
        session_id: &str,
        effective_revision: SessionGraphRevision,
        payload: SessionStatePayload,
        budget_label: &str,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        let envelope = SessionStateEnvelope {
            session_id: session_id.to_string(),
            graph_revision: effective_revision.graph_revision,
            last_event_seq: effective_revision.last_event_seq,
            payload,
        };

        match session_state_envelope_byte_budget_status(&envelope) {
            Ok(_) => Ok(envelope),
            Err(status) => {
                tracing::warn!(
                    session_id,
                    kind = budget_label,
                    byte_len = status.byte_len,
                    max_bytes = status.max_bytes,
                    "viewport envelope exceeded byte budget; skipping"
                );
                Err(VisibleTranscriptWindowMiss::BudgetExceeded)
            }
        }
    }

    fn build_session_viewport_envelope_with<F>(
        &self,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: Option<u32>,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
        budget_label: &str,
        materialize: F,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss>
    where
        F: FnOnce(ViewportMaterializeCtx<'_>) -> SessionStatePayload,
    {
        let (payload, effective_revision) = self.with_materialized_viewport(
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            viewport_height_px,
            scroll_intent,
            height_confirmation,
            materialize,
        )?;
        self.finalize_viewport_envelope(session_id, effective_revision, payload, budget_label)
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
        self.build_session_viewport_envelope_with(
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            Some(viewport_height_px),
            scroll_intent,
            height_confirmation,
            "Visible transcript window",
            |ctx| {
                let window = ctx.viewport.window();
                let visible_rows =
                    ctx.rows[window.visible_start_index..window.visible_end_index].to_vec();
                let row_offsets_px = visible_rows
                    .iter()
                    .map(|row| ctx.viewport.layout().row_offset_px(&row.row_id).unwrap_or(0))
                    .collect();
                let diagnostics = ctx
                    .height_diagnostic
                    .map(|diagnostic| {
                        vec![VisibleTranscriptWindowDiagnostic {
                            code: diagnostic.code,
                            row_id: diagnostic.row_id,
                        }]
                    })
                    .unwrap_or_default();
                SessionStatePayload::VisibleTranscriptWindow {
                    window: VisibleTranscriptWindowPayload {
                        session_id: ctx.session_id.to_string(),
                        graph_revision: ctx.effective_revision,
                        viewport_revision: ctx.viewport.viewport_revision(),
                        total_height_px: window.total_height_px,
                        viewport_offset_px: window.offset_px,
                        visible_start_index: window.visible_start_index,
                        visible_end_index: window.visible_end_index,
                        rows: visible_rows,
                        row_offsets_px,
                        mode: window.mode,
                        diagnostics,
                    },
                }
            },
        )
    }

    /// Build a `ViewportBufferPush`: a large buffered slice the WebView resolves
    /// scroll offsets against locally, refilling only when nearing its bounds.
    /// `request_generation` echoes the UI's request id so late responses can be
    /// gated against newer live deltas. `scroll_top_target` carries the
    /// Rust-decided scroll position (initial open, reveal, follow-tail).
    pub fn build_viewport_buffer_push_envelope_for_session(
        &self,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: Option<u32>,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
        request_generation: Option<u64>,
        emission_seq: u64,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        self.build_session_viewport_envelope_with(
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            viewport_height_px,
            scroll_intent,
            height_confirmation,
            "Viewport buffer push",
            |ctx| {
                let slice = ctx.viewport.buffer_window(DEFAULT_BUFFER_OVERSCAN_ROWS);
                let rows = ctx.rows[slice.buffer_start_index..slice.buffer_end_index].to_vec();
                let diagnostics = ctx
                    .height_diagnostic
                    .map(|diagnostic| {
                        vec![ViewportBufferDiagnostic {
                            code: diagnostic.code,
                            row_id: diagnostic.row_id,
                        }]
                    })
                    .unwrap_or_default();
                SessionStatePayload::ViewportBufferPush {
                    push: ViewportBufferPush {
                        session_id: ctx.session_id.to_string(),
                        graph_revision: ctx.effective_revision,
                        viewport_revision: slice.viewport_revision,
                        emission_seq,
                        buffer_start_index: slice.buffer_start_index,
                        buffer_end_index: slice.buffer_end_index,
                        layout_row_count: slice.layout_row_count,
                        total_height_px: slice.total_height_px,
                        buffer_end_offset_px: slice.buffer_end_offset_px,
                        rows,
                        offsets_px: slice.offsets_px,
                        mode: slice.mode,
                        request_generation,
                        scroll_top_target: Some(slice.viewport_offset_px),
                        diagnostics,
                    },
                }
            },
        )
    }

    /// Stateful producer entry point for the push-a-working-set protocol. Diffs
    /// the freshly-materialized buffer slice against what was last emitted for
    /// this session and emits the cheapest correct payload:
    ///
    /// - no prior buffer, or a disjoint jump → `ViewportBufferPush` (all rows)
    /// - a contiguous slide / streaming tail-append → `ViewportBufferDelta`
    /// - an identical window → nothing (`Ok(None)`)
    ///
    /// `emission_seq` is bumped under the `buffer_emissions` lock on every
    /// emission and is the consumer's sole apply-ordering authority across the
    /// command-reply and event-stream channels.
    ///
    /// B4: an ACCEPTED height confirmation re-measures a row and shifts the
    /// absolute offsets of every row below it. A delta does not re-send
    /// surviving rows, so it would leave them at stale offsets. We therefore
    /// force a `FreshPush` (re-send all offsets) whenever a height confirmation
    /// was accepted. A rejected confirmation (`height_diag.is_some()`) changed
    /// nothing and falls through to normal classification.
    ///
    /// LOCK ORDER: acquires `buffer_emissions` then (inside the prologue)
    /// `transcript_viewports`. Never invert.
    pub fn build_or_advance_viewport_buffer_envelope(
        &self,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: Option<u32>,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
        request_generation: Option<u64>,
        force_fresh: bool,
    ) -> Result<Option<SessionStateEnvelope>, VisibleTranscriptWindowMiss> {
        let height_present = height_confirmation.is_some();

        let mut emissions = self
            .buffer_emissions
            .lock()
            .expect("buffer_emissions mutex poisoned");
        let prev = emissions.get(session_id).cloned();

        // Pull the slice + canonical rows + rejected-confirmation diagnostic out
        // of the locked prologue so we can classify above the closure.
        let ((slice, full_rows, height_diag), effective_revision) = self
            .with_materialized_viewport(
                session_id,
                revision,
                projection_registry,
                transcript_projection_registry,
                viewport_height_px,
                scroll_intent,
                height_confirmation,
                |ctx| {
                    let slice = ctx.viewport.buffer_window(DEFAULT_BUFFER_OVERSCAN_ROWS);
                    (slice, ctx.rows.to_vec(), ctx.height_diagnostic)
                },
            )?;

        let prev_window = prev.as_ref().map(|r| (r.start_index, r.row_ids.len()));
        let mut emission = classify_buffer_transition(prev_window, &slice);
        // Defensive correctness guard: if the buffer indices are identical but
        // the canonical viewport_revision advanced (e.g. an in-buffer layout /
        // total-height change that did not add or remove rows), a NoOp would
        // silently drop the update. Re-send the full slice so offsets and
        // total_height_px stay canonical.
        if matches!(emission, BufferEmission::NoOp)
            && prev
                .as_ref()
                .is_some_and(|r| r.viewport_revision != slice.viewport_revision)
        {
            emission = BufferEmission::FreshPush;
        }
        // B4: an accepted height confirmation must re-send all offsets.
        let height_accepted = height_present && height_diag.is_none();
        if height_accepted && prev.is_some() {
            emission = BufferEmission::FreshPush;
        }
        // Gap recovery / bootstrap: a forced request always re-sends the full
        // buffer (taking the next emission_seq) so the consumer can re-baseline
        // after a delta gap or a missed open push.
        if force_fresh {
            emission = BufferEmission::FreshPush;
        }
        // Identity guard: an index-window delta is only sound when the surviving
        // rows keep their row_ids. Mid-buffer layout mutation during streaming
        // (operations resolving, duplicate-id ordinals shifting) breaks that, so
        // fall back to a full push (always correct, overscan-bounded) rather than
        // emit a delta that would duplicate a row_id in the consumer's buffer.
        if matches!(emission, BufferEmission::Delta) {
            if let Some(record) = prev.as_ref() {
                if !buffer_delta_is_identity_consistent(
                    record.start_index,
                    &record.row_ids,
                    &record.row_versions,
                    &full_rows,
                    &slice,
                ) {
                    emission = BufferEmission::FreshPush;
                }
            }
        }

        let next_seq = prev.as_ref().map_or(0, |r| r.emission_seq + 1);

        // Scalars/ids captured before any move out of `slice`.
        let buffer_start_index = slice.buffer_start_index;
        let buffer_end_index = slice.buffer_end_index;
        let slice_viewport_revision = slice.viewport_revision;
        let buffered_row_ids: Vec<String> = full_rows[buffer_start_index..buffer_end_index]
            .iter()
            .map(|row| row.row_id.clone())
            .collect();
        let buffered_row_versions: Vec<String> = full_rows[buffer_start_index..buffer_end_index]
            .iter()
            .map(|row| row.version.clone())
            .collect();

        let payload = match emission {
            BufferEmission::NoOp => return Ok(None),
            BufferEmission::FreshPush => {
                let rows = full_rows[buffer_start_index..buffer_end_index].to_vec();
                let diagnostics = height_diag
                    .map(|diagnostic| {
                        vec![ViewportBufferDiagnostic {
                            code: diagnostic.code,
                            row_id: diagnostic.row_id,
                        }]
                    })
                    .unwrap_or_default();
                SessionStatePayload::ViewportBufferPush {
                    push: ViewportBufferPush {
                        session_id: session_id.to_string(),
                        graph_revision: effective_revision,
                        viewport_revision: slice.viewport_revision,
                        emission_seq: next_seq,
                        buffer_start_index: slice.buffer_start_index,
                        buffer_end_index: slice.buffer_end_index,
                        layout_row_count: slice.layout_row_count,
                        total_height_px: slice.total_height_px,
                        buffer_end_offset_px: slice.buffer_end_offset_px,
                        rows,
                        offsets_px: slice.offsets_px,
                        mode: slice.mode,
                        request_generation,
                        scroll_top_target: Some(slice.viewport_offset_px),
                        diagnostics,
                    },
                }
            }
            BufferEmission::Delta => {
                let p = prev
                    .as_ref()
                    .expect("classify_buffer_transition returns Delta only when prev exists");
                let delta = compute_buffer_delta(
                    session_id,
                    effective_revision,
                    next_seq,
                    p.viewport_revision,
                    p.start_index,
                    &p.row_ids,
                    &full_rows,
                    &slice,
                    None,
                    Some(slice.viewport_offset_px),
                );
                SessionStatePayload::ViewportBufferDelta { delta }
            }
        };

        emissions.insert(
            session_id.to_string(),
            BufferEmissionRecord {
                start_index: buffer_start_index,
                row_ids: buffered_row_ids,
                row_versions: buffered_row_versions,
                viewport_revision: slice_viewport_revision,
                emission_seq: next_seq,
            },
        );

        let envelope = self.finalize_viewport_envelope(
            session_id,
            effective_revision,
            payload,
            "Viewport buffer",
        )?;
        Ok(Some(envelope))
    }
}
/// incremental mutation from a previously-pushed buffer window to the current
/// `slice` over the full canonical `current_rows`.
///
/// `prev_start_index` / `prev_row_ids` describe the previous buffer (its first
/// absolute row index and its ordered row ids). Surviving rows keep their
/// absolute offsets, so prepended/appended offsets are read straight from
/// `slice.offsets_px`. In a normal slide exactly one of (prepend +
/// removed-from-bottom) [scroll up] or (append + removed-from-top) [scroll
/// down] is non-empty.
///
/// PRECONDITION: the index ranges must overlap (a contiguous slide). A
/// non-contiguous jump (`slice.buffer_start_index >= prev_end` or
/// `slice.buffer_end_index <= prev_start_index`) cannot be bridged by a delta;
/// the caller must emit a fresh `ViewportBufferPush` instead.
#[must_use]
pub fn compute_buffer_delta(
    session_id: &str,
    graph_revision: SessionGraphRevision,
    emission_seq: u64,
    from_viewport_revision: i64,
    prev_start_index: usize,
    prev_row_ids: &[String],
    current_rows: &[TranscriptViewportRow],
    slice: &ViewportBufferSlice,
    scroll_anchor_correction_px: Option<i64>,
    scroll_top_target: Option<u64>,
) -> ViewportBufferDelta {
    let c_start = slice.buffer_start_index;
    let c_end = slice.buffer_end_index;
    let p_start = prev_start_index;
    let p_end = prev_start_index + prev_row_ids.len();
    let buffer_len = c_end.saturating_sub(c_start);

    // Rows newly above the previous buffer top (scroll up). Mutually exclusive
    // with `removed_from_top`, since `c_start` cannot be both below and above
    // `p_start`.
    let prepend_count = p_start.saturating_sub(c_start).min(buffer_len);
    // Rows newly below the previous buffer bottom (scroll down / streaming
    // tail). Mutually exclusive with `removed_from_bottom`.
    let append_count = c_end.saturating_sub(p_end).min(buffer_len);

    let prepended_rows = current_rows[c_start..c_start + prepend_count].to_vec();
    let prepended_offsets_px = slice.offsets_px[0..prepend_count].to_vec();

    let append_local_start = buffer_len - append_count;
    let appended_rows = current_rows[c_end - append_count..c_end].to_vec();
    let appended_offsets_px = slice.offsets_px[append_local_start..buffer_len].to_vec();

    // Previous rows that fell off the top / bottom of the buffer.
    let removed_from_top = c_start.saturating_sub(p_start).min(prev_row_ids.len());
    let removed_from_bottom = p_end
        .saturating_sub(c_end)
        .min(prev_row_ids.len() - removed_from_top);
    let mut removed_row_ids = Vec::with_capacity(removed_from_top + removed_from_bottom);
    removed_row_ids.extend_from_slice(&prev_row_ids[0..removed_from_top]);
    removed_row_ids.extend_from_slice(&prev_row_ids[prev_row_ids.len() - removed_from_bottom..]);

    ViewportBufferDelta {
        session_id: session_id.to_string(),
        graph_revision,
        emission_seq,
        from_viewport_revision,
        to_viewport_revision: slice.viewport_revision,
        prepended_rows,
        prepended_offsets_px,
        appended_rows,
        appended_offsets_px,
        removed_row_ids,
        layout_row_count: slice.layout_row_count,
        total_height_px: slice.total_height_px,
        buffer_end_offset_px: slice.buffer_end_offset_px,
        scroll_anchor_correction_px,
        scroll_top_target,
        diagnostics: Vec::new(),
    }
}

/// Verifies that an index-window [`ViewportBufferDelta`] would be sound for this
/// transition: the rows that survive (by absolute index) must carry the SAME
/// `row_id`s in the previously-pushed buffer and in the current canonical
/// layout.
///
/// [`compute_buffer_delta`] and [`classify_buffer_transition`] reason purely
/// about absolute index windows, which assumes the canonical layout only
/// mutates at its edges (history prepended at the top, streaming tail appended
/// at the bottom). During streaming the layout also mutates *mid-buffer* —
/// operations resolve, interactions attach, and duplicate-id ordinals shift —
/// so the same absolute index can map to a different row across emissions. An
/// index-window diff cannot represent a mid-list insert/remove: it emits a
/// delta whose appended/prepended ids still collide with surviving ids, which
/// duplicates a `row_id` in the consumer's spliced buffer (a fatal
/// `each_key_duplicate`). When this returns `false` the caller MUST emit a
/// fresh [`crate::acp::session_state_engine::protocol::ViewportBufferPush`]
/// instead (always correct, overscan-bounded).
#[must_use]
fn buffer_delta_is_identity_consistent(
    prev_start_index: usize,
    prev_row_ids: &[String],
    prev_row_versions: &[String],
    current_rows: &[TranscriptViewportRow],
    slice: &ViewportBufferSlice,
) -> bool {
    let c_start = slice.buffer_start_index;
    let c_end = slice.buffer_end_index;
    let p_start = prev_start_index;
    let p_end = prev_start_index + prev_row_ids.len();
    let buffer_len = c_end.saturating_sub(c_start);

    // Index ranges accessed by `compute_buffer_delta` must be in bounds.
    if c_end > current_rows.len() {
        return false;
    }

    let prepend_count = p_start.saturating_sub(c_start).min(buffer_len);
    let append_count = c_end.saturating_sub(p_end).min(buffer_len);
    let removed_from_top = c_start.saturating_sub(p_start).min(prev_row_ids.len());

    let curr_surv_start = c_start + prepend_count;
    let curr_surv_end = c_end.saturating_sub(append_count);
    let survivor_len = curr_surv_end.saturating_sub(curr_surv_start);

    if removed_from_top + survivor_len > prev_row_ids.len() {
        return false;
    }

    for k in 0..survivor_len {
        let current = &current_rows[curr_surv_start + k];
        // Identity: a mismatched id means the layout mutated mid-buffer and an
        // index delta would duplicate a row_id (crash).
        if current.row_id != prev_row_ids[removed_from_top + k] {
            return false;
        }
        // Freshness: the consumer keeps its OWN prior survivor objects across a
        // delta. If a survivor's version changed (content/links/tail), the
        // delta would leave the consumer rendering stale state. Re-send the
        // whole buffer so the survivor's new content lands.
        if current.version != prev_row_versions[removed_from_top + k] {
            return false;
        }
    }
    true
}

/// The three mutually-exclusive outcomes of a scroll/refill intent, classified
/// purely from the new buffer slice's index window relative to the previously
/// pushed buffer. This is the producer-side "three outcomes" decision from the
/// push-a-working-set design: it decides what the WebView gets, never what it
/// renders.
///
/// Scope: this classifies the *scroll/refill* path only. Height-confirmation of
/// an off-buffer row keeps an identical index window yet still requires a delta
/// (to carry `scroll_anchor_correction_px`); that path emits `Delta`
/// unconditionally and does not consult this classifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferEmission {
    /// No prior buffer, or the new window is disjoint from the prior one (a
    /// non-contiguous jump such as jump-to-top or a far `revealRow`). A delta
    /// cannot bridge a non-contiguous jump, so emit a fresh `ViewportBufferPush`.
    FreshPush,
    /// The new window overlaps but is shifted from the prior one (a contiguous
    /// slide, or a streaming tail-append). Emit a `ViewportBufferDelta`.
    Delta,
    /// The new window is identical to the prior one — the scroll landed entirely
    /// inside the already-materialized buffer. Emit nothing (zero layout bytes).
    NoOp,
}

/// Classify a scroll/refill transition from the previously-pushed buffer window
/// `[prev_start_index, prev_start_index + prev_len)` to the freshly-computed
/// `slice`. See [`BufferEmission`] for the outcome semantics.
#[must_use]
pub fn classify_buffer_transition(
    prev: Option<(usize, usize)>,
    slice: &ViewportBufferSlice,
) -> BufferEmission {
    let Some((prev_start_index, prev_len)) = prev else {
        return BufferEmission::FreshPush;
    };
    let p_start = prev_start_index;
    let p_end = prev_start_index + prev_len;
    let c_start = slice.buffer_start_index;
    let c_end = slice.buffer_end_index;

    // Disjoint windows cannot be bridged by a delta.
    let overlaps = c_start < p_end && p_start < c_end;
    if !overlaps {
        return BufferEmission::FreshPush;
    }

    if c_start == p_start && c_end == p_end {
        return BufferEmission::NoOp;
    }

    BufferEmission::Delta
}

/// Neutral height-confirmation diagnostic produced by the shared viewport
/// prologue, mapped by each materializer into its payload-specific diagnostic.
struct ViewportHeightDiagnostic {
    code: String,
    row_id: Option<String>,
}

/// Read-only view handed to a viewport payload materializer after the shared
/// prologue has mutated the viewport under lock.
struct ViewportMaterializeCtx<'a> {
    session_id: &'a str,
    effective_revision: SessionGraphRevision,
    rows: &'a [TranscriptViewportRow],
    viewport: &'a TranscriptViewport,
    height_diagnostic: Option<ViewportHeightDiagnostic>,
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
    fn buffer_producer_with_none_height_preserves_canonical_height_without_revision_churn() {
        // B3 regression: the streaming buffer producer must pass `None` so it
        // preserves the canonical viewport height a real command measured —
        // never re-forcing a bootstrap height every tick, which oscillated
        // `viewport_revision` and the buffer window indices into a spurious
        // delta/push storm. A real command-measured resize still bumps.
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        projection_registry.register_session("session-h".to_string(), CanonicalAgentId::Cursor);
        let update = create_agent_message_chunk_update("session-h", Some("assistant-1"), "hello", 5);
        projection_registry.apply_session_update("session-h", &update);
        let _ = transcript_projection_registry.apply_session_update(7, &update);
        let revision = SessionGraphRevision::new(0, 7, 1);

        let push_revision = |height: Option<u32>| match runtime_registry
            .build_viewport_buffer_push_envelope_for_session(
                "session-h",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                height,
                None,
                None,
                None,
                0,
            )
            .expect("buffer push must materialize")
            .payload
        {
            SessionStatePayload::ViewportBufferPush { push } => push.viewport_revision,
            other => panic!("expected viewport buffer push payload, got {other:?}"),
        };

        // First push installs a real measured height of 900.
        let r1 = push_revision(Some(900));
        // Streaming ticks pass `None`: preserve the stored height, no churn.
        let r2 = push_revision(None);
        let r3 = push_revision(None);
        assert_eq!(r1, r2, "a None-height streaming tick must not churn the revision");
        assert_eq!(r2, r3, "repeated None-height ticks stay revision-stable");

        // A real command-measured resize to a DIFFERENT height bumps. This also
        // proves the stored height was 900 (not the bootstrap 720): resizing to
        // 720 would be a no-op if 720 were already stored.
        let r4 = push_revision(Some(720));
        assert!(
            r4 > r3,
            "a real resize away from the stored height must bump the revision"
        );
    }

    /// Seed `count` distinct assistant rows into a fresh registry trio and
    /// return the latest canonical revision. Each row is its own message id so
    /// the layout has `count` rows to slice/append against.
    fn seed_buffer_emission_session(
        runtime_registry: &SessionGraphRuntimeRegistry,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        session_id: &str,
        count: usize,
    ) -> SessionGraphRevision {
        let _ = runtime_registry;
        projection_registry.register_session(session_id.to_string(), CanonicalAgentId::Cursor);
        let mut tx_revision: i64 = 0;
        for index in 0..count {
            let message_id = format!("m{index}");
            let update = create_agent_message_chunk_update(
                session_id,
                Some(&message_id),
                "hello world",
                (index as u64) + 1,
            );
            projection_registry.apply_session_update(session_id, &update);
            tx_revision = (index as i64) + 1;
            let _ = transcript_projection_registry.apply_session_update(tx_revision, &update);
        }
        SessionGraphRevision::new(0, tx_revision, 1)
    }

    #[test]
    fn buffer_emission_first_call_is_fresh_push_with_seq_zero() {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &runtime_registry,
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let envelope = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first emission must materialize")
            .expect("first emission must produce a payload");

        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(push.emission_seq, 0, "first push baselines emission_seq at 0");
                assert_eq!(push.rows.len(), 3);
            }
            other => panic!("expected ViewportBufferPush, got {other:?}"),
        }
    }

    #[test]
    fn buffer_emission_identical_window_emits_nothing() {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &runtime_registry,
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let _ = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first emission")
            .expect("first push");

        // No new rows, identical height, no scroll -> identical window -> NoOp.
        let second = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("second emission must not error");
        assert!(second.is_none(), "an identical window must emit nothing");
    }

    #[test]
    fn buffer_emission_streaming_append_that_moves_tail_is_fresh_push_and_noop_does_not_consume_seq(
    ) {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &runtime_registry,
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        // seq 0 push.
        let _ = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");

        // A NoOp tick in between must NOT consume an emission_seq.
        assert!(runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("noop tick")
            .is_none());

        // Append a new tail row + advance the canonical transcript revision.
        let update = create_agent_message_chunk_update("s", Some("m_tail"), "more", 99);
        projection_registry.apply_session_update("s", &update);
        let _ = transcript_projection_registry.apply_session_update(50, &update);
        let revision2 = SessionGraphRevision::new(0, 50, 1);

        let envelope = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision2,
                &projection_registry,
                &transcript_projection_registry,
                None,
                None,
                None,
                None,
                false,
            )
            .expect("streaming emission")
            .expect("streaming append must emit a payload");

        // Appending a new trailing assistant row moves the active streaming tail off the
        // previous tail row, changing that survivor's content version. The delta wire cannot
        // express "a survivor changed" (only prepend/append/remove), so the identity guard
        // must promote to a FreshPush to avoid leaving the consumer rendering a stale
        // streaming-tail indicator. The intervening NoOp must still not have consumed a seq.
        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(
                    push.emission_seq, 1,
                    "fresh push seq is prev+1; the intervening NoOp must not have consumed a seq"
                );
                assert_eq!(
                    push.rows.len(),
                    4,
                    "fresh push re-sends the whole buffer incl. the de-tailed survivor and new tail"
                );
                assert!(
                    push.rows
                        .last()
                        .is_some_and(|row| row.active_streaming_tail.is_some()),
                    "the newly appended row is the streaming tail"
                );
                assert!(
                    push.rows[..push.rows.len() - 1]
                        .iter()
                        .all(|row| row.active_streaming_tail.is_none()),
                    "prior survivors are no longer the streaming tail"
                );
            }
            other => panic!("expected ViewportBufferPush, got {other:?}"),
        }
    }

    // Regression guard: the identity-soundness check must be SURGICAL. It promotes to a
    // FreshPush only when surviving rows actually drift (id or version). A pure scroll slide
    // over a layout larger than the overscan buffer leaves survivors byte-identical, so the
    // stateful emitter must still emit a real ViewportBufferDelta. This proves the guard did
    // not globally defeat the byte-optimal scroll-refill path while fixing the streaming crash.
    #[test]
    fn buffer_emission_scroll_slide_with_stable_survivors_still_emits_delta() {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        // 120 rows @ 120px each (1440px tall) far exceeds the 50-row overscan window, so a
        // scroll slides the buffer instead of always covering the whole layout.
        let revision = seed_buffer_emission_session(
            &runtime_registry,
            &projection_registry,
            &transcript_projection_registry,
            "s",
            120,
        );

        // seq 0 baseline push, following the tail at a fixed height.
        let baseline = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("baseline emission")
            .expect("baseline push");
        let baseline_end = match baseline.payload {
            SessionStatePayload::ViewportBufferPush { push } => push.buffer_end_index,
            other => panic!("expected baseline ViewportBufferPush, got {other:?}"),
        };

        // Scroll up ~10 rows. Same height (no height-confirm push), same content (no version
        // drift), window slides toward the top -> prepend-only delta with stable survivors.
        let envelope = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                Some(crate::acp::transcript_viewport::ScrollIntent::DetachAtOffset {
                    offset_px: 12_480,
                }),
                None,
                None,
                false,
            )
            .expect("scroll emission")
            .expect("scroll slide must emit a payload");

        match envelope.payload {
            SessionStatePayload::ViewportBufferDelta { delta } => {
                assert_eq!(
                    delta.emission_seq, 1,
                    "delta takes prev+1 after the baseline push"
                );
                assert!(
                    !delta.prepended_rows.is_empty(),
                    "scrolling up reveals earlier rows as a prepend"
                );
                assert!(
                    delta.appended_rows.is_empty() && delta.removed_row_ids.is_empty(),
                    "an upward scroll only prepends; survivors and tail are untouched"
                );
                let _ = baseline_end;
            }
            other => panic!(
                "scroll slide with stable survivors must stay a Delta, got {other:?}"
            ),
        }
    }

    #[test]
    fn buffer_emission_accepted_height_confirmation_forces_fresh_push() {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &runtime_registry,
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let first = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");
        let (row_id, row_version) = match first.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                let row = &push.rows[0];
                (row.row_id.clone(), row.version.clone())
            }
            other => panic!("expected push, got {other:?}"),
        };

        // Accepted height confirmation (valid row + version) shifts offsets of
        // every row below it. The window index range is unchanged, so the
        // classifier would say NoOp; B4 must force a FreshPush so all offsets
        // are re-sent. emission_seq must advance so the consumer rebaselines.
        let envelope = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(super::TranscriptViewportHeightConfirmation {
                    row_id,
                    row_version,
                    height_px: 321,
                }),
                None,
                false,
            )
            .expect("height-confirm emission")
            .expect("accepted height confirmation must emit a fresh push");

        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(push.emission_seq, 1, "forced push must advance the seq");
            }
            other => panic!("expected forced ViewportBufferPush, got {other:?}"),
        }
    }

    #[test]
    fn buffer_emission_rejected_height_confirmation_does_not_force_push() {
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &runtime_registry,
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let _ = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");

        // A rejected confirmation (bogus version) changed nothing; the safe gate
        // must NOT force a push for it (otherwise a stale-version retry storm
        // would each spawn a full re-push). Identical window -> NoOp.
        let second = runtime_registry
            .build_or_advance_viewport_buffer_envelope(
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(super::TranscriptViewportHeightConfirmation {
                    row_id: "m0".to_string(),
                    row_version: "definitely-not-the-current-version".to_string(),
                    height_px: 321,
                }),
                None,
                false,
            )
            .expect("rejected-confirm emission must not error");
        assert!(
            second.is_none(),
            "a rejected height confirmation must not force a fresh push"
        );
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

    use super::{buffer_delta_is_identity_consistent, compute_buffer_delta};
    use crate::acp::transcript_projection::TranscriptEntryRole;
    use crate::acp::transcript_viewport::{
        TranscriptViewportRow, TranscriptViewportRowContent, TranscriptViewportRowKind,
        ViewportBufferSlice, ViewportMode,
    };

    fn delta_row(index: usize) -> TranscriptViewportRow {
        TranscriptViewportRow {
            row_id: format!("transcript:row-{index}"),
            source_entry_id: format!("row-{index}"),
            kind: TranscriptViewportRowKind::AssistantText,
            version: format!("v-{index}"),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: Vec::new(),
            },
        }
    }

    const DELTA_ROW_HEIGHT_PX: u64 = 100;

    fn delta_layout(row_count: usize) -> Vec<TranscriptViewportRow> {
        (0..row_count).map(delta_row).collect()
    }

    fn delta_slice(
        start: usize,
        end: usize,
        layout_row_count: usize,
        viewport_revision: i64,
    ) -> ViewportBufferSlice {
        let offsets_px = (start..end)
            .map(|i| i as u64 * DELTA_ROW_HEIGHT_PX)
            .collect();
        ViewportBufferSlice {
            buffer_start_index: start,
            buffer_end_index: end,
            layout_row_count,
            offsets_px,
            total_height_px: layout_row_count as u64 * DELTA_ROW_HEIGHT_PX,
            buffer_end_offset_px: end as u64 * DELTA_ROW_HEIGHT_PX,
            viewport_offset_px: start as u64 * DELTA_ROW_HEIGHT_PX,
            mode: ViewportMode::FollowingTail,
            viewport_revision,
        }
    }

    fn row_ids(indices: std::ops::Range<usize>) -> Vec<String> {
        indices.map(|i| format!("transcript:row-{i}")).collect()
    }

    fn row_versions(indices: std::ops::Range<usize>) -> Vec<String> {
        indices.map(|i| format!("v-{i}")).collect()
    }

    #[test]
    fn compute_buffer_delta_scroll_down_appends_and_removes_top() {
        let layout = delta_layout(20);
        let prev_ids = row_ids(2..6);
        let slice = delta_slice(4, 8, 20, 5);

        let delta = compute_buffer_delta(
            "session-1",
            SessionGraphRevision::new(3, 3, 3),
            7,
            4,
            2,
            &prev_ids,
            &layout,
            &slice,
            None,
            Some(400),
        );

        assert_eq!(delta.emission_seq, 7);
        assert_eq!(delta.from_viewport_revision, 4);
        assert_eq!(delta.to_viewport_revision, 5);
        assert!(delta.prepended_rows.is_empty());
        assert_eq!(
            delta
                .appended_rows
                .iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["transcript:row-6", "transcript:row-7"]
        );
        assert_eq!(delta.appended_offsets_px, vec![600, 700]);
        assert_eq!(
            delta.removed_row_ids,
            vec!["transcript:row-2".to_string(), "transcript:row-3".to_string()]
        );
        assert_eq!(delta.layout_row_count, 20);
        assert_eq!(delta.buffer_end_offset_px, 800);
        assert_eq!(delta.scroll_top_target, Some(400));
    }

    #[test]
    fn compute_buffer_delta_scroll_up_prepends_and_removes_bottom() {
        let layout = delta_layout(30);
        let prev_ids = row_ids(10..14);
        let slice = delta_slice(8, 12, 30, 2);

        let delta = compute_buffer_delta(
            "session-1",
            SessionGraphRevision::new(1, 1, 1),
            12,
            1,
            10,
            &prev_ids,
            &layout,
            &slice,
            None,
            None,
        );

        assert_eq!(delta.emission_seq, 12);
        assert_eq!(
            delta
                .prepended_rows
                .iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["transcript:row-8", "transcript:row-9"]
        );
        assert_eq!(delta.prepended_offsets_px, vec![800, 900]);
        assert!(delta.appended_rows.is_empty());
        assert_eq!(
            delta.removed_row_ids,
            vec![
                "transcript:row-12".to_string(),
                "transcript:row-13".to_string()
            ]
        );
    }

    #[test]
    fn compute_buffer_delta_streaming_tail_appends_without_removals() {
        let layout = delta_layout(7);
        let prev_ids = row_ids(0..5);
        let slice = delta_slice(0, 7, 7, 2);

        let delta = compute_buffer_delta(
            "session-1",
            SessionGraphRevision::new(1, 1, 1),
            3,
            1,
            0,
            &prev_ids,
            &layout,
            &slice,
            None,
            None,
        );

        assert!(delta.prepended_rows.is_empty());
        assert!(delta.removed_row_ids.is_empty());
        assert_eq!(delta.emission_seq, 3);
        assert_eq!(
            delta
                .appended_rows
                .iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["transcript:row-5", "transcript:row-6"]
        );
        assert_eq!(delta.appended_offsets_px, vec![500, 600]);
        assert_eq!(delta.layout_row_count, 7);
    }

    #[test]
    fn compute_buffer_delta_no_movement_is_empty() {
        let layout = delta_layout(5);
        let prev_ids = row_ids(0..5);
        let slice = delta_slice(0, 5, 5, 9);

        let delta = compute_buffer_delta(
            "session-1",
            SessionGraphRevision::new(1, 1, 1),
            42,
            8,
            0,
            &prev_ids,
            &layout,
            &slice,
            None,
            None,
        );

        assert_eq!(delta.emission_seq, 42);
        assert!(delta.prepended_rows.is_empty());
        assert!(delta.appended_rows.is_empty());
        assert!(delta.removed_row_ids.is_empty());
        assert_eq!(delta.from_viewport_revision, 8);
        assert_eq!(delta.to_viewport_revision, 9);
    }

    #[test]
    fn buffer_delta_identity_consistent_accepts_clean_tail_append() {
        // Streaming tail-append: prev buffer [row-0..row-4], current grows to 7
        // rows, window [0,7). Survivors keep their ids and versions, so an index
        // delta is sound.
        let layout = delta_layout(7);
        let prev_ids = row_ids(0..5);
        let prev_versions = row_versions(0..5);
        let slice = delta_slice(0, 7, 7, 2);

        assert!(buffer_delta_is_identity_consistent(
            0,
            &prev_ids,
            &prev_versions,
            &layout,
            &slice
        ));
    }

    #[test]
    fn buffer_delta_identity_inconsistent_on_mid_buffer_insert() {
        // A row is inserted mid-buffer between emissions (e.g. an operation
        // resolves) and the tail-follow window shifts. The index-window delta
        // would keep `row-4` as a survivor AND re-append it, duplicating a
        // row_id in the consumer's spliced buffer. The producer must detect the
        // identity drift and fall back to a fresh push.
        let prev_ids = row_ids(0..5); // [row-0, row-1, row-2, row-3, row-4]
        let prev_versions = row_versions(0..5);
        let current = vec![
            delta_row(0),
            delta_row(99), // inserted mid-buffer
            delta_row(1),
            delta_row(2),
            delta_row(3),
            delta_row(4),
        ];
        // Window slid to [1,6): current buffer ids [row-99, row-1, row-2, row-3, row-4].
        let slice = delta_slice(1, 6, 6, 2);

        assert!(!buffer_delta_is_identity_consistent(
            0,
            &prev_ids,
            &prev_versions,
            &current,
            &slice
        ));
    }

    #[test]
    fn buffer_delta_identity_inconsistent_on_survivor_version_change() {
        // A survivor keeps its row_id but its content changed (new version). An
        // index delta would not re-send it, so the consumer would render stale
        // content. The producer must fall back to a fresh push.
        let layout = delta_layout(7);
        let prev_ids = row_ids(0..5);
        let mut prev_versions = row_versions(0..5);
        prev_versions[2] = "stale-version".to_string();
        let slice = delta_slice(0, 7, 7, 2);

        assert!(!buffer_delta_is_identity_consistent(
            0,
            &prev_ids,
            &prev_versions,
            &layout,
            &slice
        ));
    }

    use super::{classify_buffer_transition, BufferEmission};

    #[test]
    fn classify_buffer_transition_no_prior_is_fresh_push() {
        let slice = delta_slice(4, 8, 20, 5);
        assert_eq!(
            classify_buffer_transition(None, &slice),
            BufferEmission::FreshPush
        );
    }

    #[test]
    fn classify_buffer_transition_identical_window_is_noop() {
        let slice = delta_slice(4, 8, 20, 5);
        assert_eq!(
            classify_buffer_transition(Some((4, 4)), &slice),
            BufferEmission::NoOp
        );
    }

    #[test]
    fn classify_buffer_transition_overlapping_slide_is_delta() {
        let slice = delta_slice(4, 8, 20, 5);
        // Scroll down: prev [2,6) overlaps new [4,8).
        assert_eq!(
            classify_buffer_transition(Some((2, 4)), &slice),
            BufferEmission::Delta
        );
        // Streaming tail append: prev [4,7) overlaps new [4,8) (same start, grown end).
        assert_eq!(
            classify_buffer_transition(Some((4, 3)), &slice),
            BufferEmission::Delta
        );
    }

    #[test]
    fn classify_buffer_transition_disjoint_jump_is_fresh_push() {
        let slice = delta_slice(40, 44, 100, 7);
        // Prior buffer far above: prev [2,6) shares no rows with new [40,44).
        assert_eq!(
            classify_buffer_transition(Some((2, 4)), &slice),
            BufferEmission::FreshPush
        );
        // Adjacent-but-touching (prev_end == new_start) is still disjoint: prev
        // [36,40) and new [40,44) share no row index.
        assert_eq!(
            classify_buffer_transition(Some((36, 4)), &slice),
            BufferEmission::FreshPush
        );
    }
}
