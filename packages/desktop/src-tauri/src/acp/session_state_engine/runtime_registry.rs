use crate::acp::client_session::SessionModes;
use crate::acp::projections::{ProjectionRegistry, SessionSnapshot};
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle, SessionGraphLifecycleStatus,
};
use crate::acp::session_state_engine::{
    build_delta_envelope, SessionGraphRevision, SessionStateEnvelope, SessionStatePayload,
};
use crate::acp::session_update::SessionUpdate;
use crate::acp::transcript_projection::{TranscriptDelta, TranscriptProjectionRegistry};
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::SessionMetadataRepository;
use dashmap::DashMap;
use sea_orm::DbConn;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct SessionGraphRuntimeSnapshot {
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
}

impl Default for SessionGraphRuntimeSnapshot {
    fn default() -> Self {
        Self {
            lifecycle: SessionGraphLifecycle::idle(),
            capabilities: SessionGraphCapabilities::empty(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SessionGraphRuntimeRegistry {
    sessions: Arc<DashMap<String, SessionGraphRuntimeSnapshot>>,
}

pub struct LiveSessionStateEnvelopeRequest<'a> {
    pub db: &'a DbConn,
    pub session_id: &'a str,
    pub update: &'a SessionUpdate,
    pub revision: SessionGraphRevision,
    pub projection_registry: &'a ProjectionRegistry,
    pub transcript_projection_registry: &'a TranscriptProjectionRegistry,
    pub transcript_delta: Option<&'a TranscriptDelta>,
}

impl SessionGraphRuntimeRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
        }
    }

    #[must_use]
    pub fn snapshot_for_session(&self, session_id: &str) -> SessionGraphRuntimeSnapshot {
        self.sessions
            .get(session_id)
            .map(|entry| entry.clone())
            .unwrap_or_default()
    }

    pub fn restore_session_state(
        &self,
        session_id: String,
        lifecycle: SessionGraphLifecycle,
        capabilities: SessionGraphCapabilities,
    ) {
        self.sessions.insert(
            session_id,
            SessionGraphRuntimeSnapshot {
                lifecycle,
                capabilities,
            },
        );
    }

    pub fn remove_session(&self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    pub fn apply_session_update(&self, session_id: &str, update: &SessionUpdate) {
        let mut state = self.sessions.entry(session_id.to_string()).or_default();

        match update {
            SessionUpdate::ConnectionComplete {
                models,
                modes,
                available_commands,
                config_options,
                ..
            } => {
                state.lifecycle = SessionGraphLifecycle {
                    status: SessionGraphLifecycleStatus::Ready,
                    error_message: None,
                    can_reconnect: true,
                };
                state.capabilities = SessionGraphCapabilities {
                    models: Some(models.clone()),
                    modes: Some(modes.clone()),
                    available_commands: available_commands.clone(),
                    config_options: config_options.clone(),
                };
            }
            SessionUpdate::ConnectionFailed { error, .. } => {
                state.lifecycle = SessionGraphLifecycle {
                    status: SessionGraphLifecycleStatus::Error,
                    error_message: Some(error.clone()),
                    can_reconnect: true,
                };
            }
            SessionUpdate::AvailableCommandsUpdate { update, .. } => {
                state.capabilities.available_commands = update.available_commands.clone();
            }
            SessionUpdate::CurrentModeUpdate { update, .. } => {
                if let Some(modes) = state.capabilities.modes.as_mut() {
                    modes.current_mode_id = update.current_mode_id.clone();
                } else {
                    state.capabilities.modes = Some(SessionModes {
                        current_mode_id: update.current_mode_id.clone(),
                        available_modes: Vec::new(),
                    });
                }
            }
            SessionUpdate::ConfigOptionUpdate { update, .. } => {
                state.capabilities.config_options = update.config_options.clone();
            }
            _ => {}
        }
    }

    pub async fn build_live_session_state_envelope(
        &self,
        request: LiveSessionStateEnvelopeRequest<'_>,
    ) -> Option<SessionStateEnvelope> {
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

        request
            .transcript_delta
            .map(|delta| build_live_session_state_delta_envelope(delta, request.revision))
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
                    capabilities: runtime_snapshot.capabilities,
                }),
            },
        })
    }
}

fn build_live_session_state_delta_envelope(
    delta: &TranscriptDelta,
    revision: SessionGraphRevision,
) -> SessionStateEnvelope {
    let from_revision = SessionGraphRevision::new(
        revision.graph_revision.saturating_sub(1),
        delta.snapshot_revision.saturating_sub(1),
        delta.event_seq.saturating_sub(1),
    );
    build_delta_envelope(
        &delta.session_id,
        from_revision,
        revision,
        delta.operations.clone(),
        vec!["transcriptSnapshot".to_string()],
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
            | SessionUpdate::AvailableCommandsUpdate { .. }
            | SessionUpdate::CurrentModeUpdate { .. }
            | SessionUpdate::ConfigOptionUpdate { .. }
            | SessionUpdate::ConnectionComplete { .. }
            | SessionUpdate::ConnectionFailed { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::SessionGraphRuntimeRegistry;
    use crate::acp::client_session::{default_modes, default_session_model_state};
    use crate::acp::session_state_engine::selectors::SessionGraphLifecycleStatus;
    use crate::acp::session_update::{
        AvailableCommandsData, ConfigOptionData, CurrentModeData, SessionUpdate,
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
    }
}
