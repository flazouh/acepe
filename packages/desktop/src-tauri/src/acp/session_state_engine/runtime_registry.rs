use crate::acp::client_session::SessionModes;
use crate::acp::lifecycle::LifecycleCheckpoint;
use crate::acp::lifecycle::SessionSupervisor;
use crate::acp::projections::{ProjectionRegistry, SessionSnapshot};
use crate::acp::session_state_engine::frontier::{
    decide_frontier_transition, SessionFrontierDecision,
};
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
    SessionGraphLifecycleStatus,
};
use crate::acp::session_state_engine::{
    build_delta_envelope, CapabilityPreviewState, SessionGraphRevision, SessionStateEnvelope,
    SessionStatePayload,
};
use crate::acp::session_update::SessionUpdate;
use crate::acp::transcript_projection::{TranscriptDelta, TranscriptProjectionRegistry};
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
}

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
        Self { supervisor }
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
        self.supervisor
            .replace_checkpoint_for_compat(session_id, checkpoint);
    }

    pub fn remove_session(&self, session_id: &str) {
        self.supervisor.remove_session(session_id);
    }

    pub fn restore_session_checkpoint(&self, session_id: String, checkpoint: LifecycleCheckpoint) {
        self.supervisor
            .replace_checkpoint_for_compat(session_id, checkpoint);
    }

    pub fn apply_session_update_with_graph_seed(
        &self,
        session_id: &str,
        graph_revision_seed: i64,
        update: &SessionUpdate,
    ) -> i64 {
        let mut state = self.snapshot_for_session(session_id);
        state.apply_update_with_graph_seed(graph_revision_seed, update);
        let graph_revision = state.graph_revision;
        self.supervisor
            .replace_checkpoint_for_compat(session_id.to_string(), state.into_checkpoint());
        graph_revision
    }

    pub fn apply_session_update(&self, session_id: &str, update: &SessionUpdate) -> i64 {
        self.apply_session_update_with_graph_seed(session_id, 0, update)
    }

    pub fn replace_capabilities_with_graph_seed(
        &self,
        session_id: &str,
        graph_revision_seed: i64,
        capabilities: SessionGraphCapabilities,
    ) -> i64 {
        let mut state = self.snapshot_for_session(session_id);
        state.graph_revision = state
            .graph_revision
            .max(graph_revision_seed)
            .saturating_add(1);
        state.capabilities = capabilities;
        let graph_revision = state.graph_revision;
        self.supervisor
            .replace_checkpoint_for_compat(session_id.to_string(), state.into_checkpoint());
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

        let delta = request.transcript_delta?;
        let is_transcript_bearing = !delta.operations.is_empty();
        let current_frontier = if request.previous_revision.graph_revision == 0
            && request.previous_revision.transcript_revision == 0
            && request.previous_revision.last_event_seq == 0
        {
            None
        } else {
            Some(request.previous_revision)
        };

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
            )),
            SessionFrontierDecision::AcceptDelta { .. } => None,
        }
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

    async fn build_snapshot_envelope(
        &self,
        db: &DbConn,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
    ) -> Option<SessionStateEnvelope> {
        let metadata = SessionMetadataRepository::get_by_id(db, session_id)
            .await
            .ok()
            .flatten()?;
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
                    active_turn_failure: session_snapshot.active_turn_failure,
                    last_terminal_turn_id: session_snapshot.last_terminal_turn_id,
                    lifecycle: runtime_snapshot.lifecycle,
                    activity,
                    capabilities: runtime_snapshot.capabilities,
                }),
            },
        })
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
                self.lifecycle = SessionGraphLifecycle {
                    status: SessionGraphLifecycleStatus::Ready,
                    error_message: None,
                    can_reconnect: true,
                };
                self.capabilities = SessionGraphCapabilities {
                    models: Some(models.clone()),
                    modes: Some(modes.clone()),
                    available_commands: available_commands.clone(),
                    config_options: config_options.clone(),
                    autonomous_enabled: *autonomous_enabled,
                };
            }
            SessionUpdate::ConnectionFailed { error, .. } => {
                self.lifecycle = SessionGraphLifecycle {
                    status: SessionGraphLifecycleStatus::Error,
                    error_message: Some(error.clone()),
                    can_reconnect: true,
                };
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
                self.capabilities.config_options = update.config_options.clone();
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
            lifecycle: checkpoint.compat_graph_lifecycle(),
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
) -> SessionStateEnvelope {
    build_delta_envelope(
        &delta.session_id,
        from_revision,
        to_revision,
        delta.operations.clone(),
        vec!["transcriptSnapshot".to_string()],
    )
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
        SessionUpdate::ToolCall { .. }
            | SessionUpdate::ToolCallUpdate { .. }
            | SessionUpdate::PermissionRequest { .. }
            | SessionUpdate::QuestionRequest { .. }
            | SessionUpdate::TurnComplete { .. }
            | SessionUpdate::TurnError { .. }
            | SessionUpdate::ConnectionComplete { .. }
            | SessionUpdate::ConnectionFailed { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::{
        build_live_session_state_capabilities_envelope, build_live_session_state_delta_envelope,
        build_live_session_state_telemetry_envelope, CapabilityPreviewState,
        SessionGraphRuntimeRegistry,
    };
    use crate::acp::client_session::{default_modes, default_session_model_state};
    use crate::acp::session_state_engine::selectors::SessionGraphCapabilities;
    use crate::acp::session_state_engine::selectors::SessionGraphLifecycleStatus;
    use crate::acp::session_state_engine::SessionGraphRevision;
    use crate::acp::session_state_engine::SessionStatePayload;
    use crate::acp::session_update::{
        AvailableCommandsData, ConfigOptionData, CurrentModeData, SessionUpdate,
        UsageTelemetryData, UsageTelemetryTokens,
    };
    use crate::acp::transcript_projection::{
        TranscriptDelta, TranscriptDeltaOperation, TranscriptSnapshot,
    };

    #[test]
    fn registry_tracks_connection_and_capability_updates() {
        let registry = SessionGraphRuntimeRegistry::new();
        let session_id = "session-1";

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
        assert_eq!(
            snapshot.lifecycle.status,
            SessionGraphLifecycleStatus::Ready
        );
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

        let graph_revision = registry.apply_session_update_with_graph_seed(
            session_id,
            12,
            &SessionUpdate::ConnectionFailed {
                session_id: session_id.to_string(),
                attempt_id: 1,
                error: "disconnected".to_string(),
            },
        );

        assert_eq!(graph_revision, 13);
        assert_eq!(registry.snapshot_for_session(session_id).graph_revision, 13);
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

        let envelope = build_live_session_state_delta_envelope(&delta, from_revision, to_revision);

        match envelope.payload {
            SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.from_revision, from_revision);
                assert_eq!(delta.to_revision, to_revision);
            }
            other => panic!("expected delta payload, got {:?}", other),
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
