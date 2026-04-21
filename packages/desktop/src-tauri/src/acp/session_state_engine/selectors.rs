use crate::acp::client_session::{SessionModelState, SessionModes};
use crate::acp::session_update::{AvailableCommand, ConfigOptionData};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionGraphLifecycleStatus {
    Idle,
    Connecting,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphLifecycle {
    pub status: SessionGraphLifecycleStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub can_reconnect: bool,
}

impl SessionGraphLifecycle {
    pub fn idle() -> Self {
        Self {
            status: SessionGraphLifecycleStatus::Idle,
            error_message: None,
            can_reconnect: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<SessionModelState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<SessionModes>,
    #[serde(default)]
    pub available_commands: Vec<AvailableCommand>,
    #[serde(default)]
    pub config_options: Vec<ConfigOptionData>,
    #[serde(default)]
    pub autonomous_enabled: bool,
}

impl SessionGraphCapabilities {
    pub fn empty() -> Self {
        Self {
            models: None,
            modes: None,
            available_commands: Vec::new(),
            config_options: Vec::new(),
            autonomous_enabled: false,
        }
    }
}
