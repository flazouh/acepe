use crate::acp::client_session::SessionModes;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle, SessionGraphLifecycleStatus,
};
use crate::acp::session_update::SessionUpdate;
use dashmap::DashMap;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct SessionGraphRuntimeSnapshot {
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
    last_attempt_id: Option<u64>,
}

impl Default for SessionGraphRuntimeSnapshot {
    fn default() -> Self {
        Self {
            lifecycle: SessionGraphLifecycle::idle(),
            capabilities: SessionGraphCapabilities::empty(),
            last_attempt_id: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SessionGraphRuntimeRegistry {
    sessions: Arc<DashMap<String, SessionGraphRuntimeSnapshot>>,
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
                last_attempt_id: None,
            },
        );
    }

    pub fn remove_session(&self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    pub fn apply_session_update(&self, session_id: &str, update: &SessionUpdate) {
        let mut state = self
            .sessions
            .entry(session_id.to_string())
            .or_insert_with(SessionGraphRuntimeSnapshot::default);

        match update {
            SessionUpdate::ConnectionComplete {
                attempt_id,
                models,
                modes,
                available_commands,
                config_options,
                ..
            } => {
                if state
                    .last_attempt_id
                    .is_some_and(|current_attempt_id| *attempt_id < current_attempt_id)
                {
                    return;
                }
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
                state.last_attempt_id = Some(*attempt_id);
            }
            SessionUpdate::ConnectionFailed {
                attempt_id, error, ..
            } => {
                if state
                    .last_attempt_id
                    .is_some_and(|current_attempt_id| *attempt_id < current_attempt_id)
                {
                    return;
                }
                state.lifecycle = SessionGraphLifecycle {
                    status: SessionGraphLifecycleStatus::Error,
                    error_message: Some(error.clone()),
                    can_reconnect: true,
                };
                state.last_attempt_id = Some(*attempt_id);
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

    #[test]
    fn registry_ignores_stale_connection_attempts() {
        let registry = SessionGraphRuntimeRegistry::new();
        let session_id = "session-1";

        registry.apply_session_update(
            session_id,
            &SessionUpdate::ConnectionComplete {
                session_id: session_id.to_string(),
                attempt_id: 2,
                models: default_session_model_state(),
                modes: default_modes(),
                available_commands: Vec::new(),
                config_options: Vec::new(),
                autonomous_enabled: false,
            },
        );
        registry.apply_session_update(
            session_id,
            &SessionUpdate::ConnectionFailed {
                session_id: session_id.to_string(),
                attempt_id: 1,
                error: "stale".to_string(),
            },
        );

        let snapshot = registry.snapshot_for_session(session_id);
        assert_eq!(
            snapshot.lifecycle.status,
            SessionGraphLifecycleStatus::Ready
        );
        assert_eq!(snapshot.lifecycle.error_message, None);
    }
}
