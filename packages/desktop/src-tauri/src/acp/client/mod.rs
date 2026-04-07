use crate::acp::client_errors::{is_method_not_found_error, is_session_not_found_error};
use crate::acp::client_loop::{
    spawn_death_monitor, spawn_stderr_reader, spawn_stdout_reader, DeathMonitorContext,
    StdoutLoopContext,
};
use crate::acp::client_rpc;
use crate::acp::client_session::{apply_provider_model_fallback, parse_model_discovery_output};
use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::{drain_permissions_as_failed, truncate_for_log};
use crate::acp::cursor_extensions::CursorResponseAdapter;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::model_display::get_transformer;
use crate::acp::parsers::AgentType;
use crate::acp::permission_tracker::{PermissionTracker, WebSearchDedup};
use crate::acp::provider::AgentProvider;
use crate::acp::session_update::{SessionUpdate, ToolCallStatus, ToolCallUpdateData};
use crate::acp::types::PromptRequest;
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, DispatchPolicy};
use crate::db::repository::AppSettingsRepository;
use sea_orm::DbConn;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc as StdArc;
use tauri::{AppHandle, Manager};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};

mod auth;
pub mod cc_sdk_client;
pub mod codex_native_client;
pub mod codex_native_config;
pub mod codex_native_events;
pub mod forge_protocol;
mod lifecycle;
mod model_discovery;
mod prompt_ops;
mod replay_guard;
mod rpc_io;
mod session_config;
mod session_lifecycle;
mod state;
mod trait_impl;

#[cfg(test)]
mod tests;

pub use state::AcpClient;

pub use crate::acp::client_session::{
    AvailableMode, AvailableModel, ExecutionProfileRequest, InitializeResponse,
    ListSessionsResponse, NewSessionResponse, ResumeSessionResponse, SessionInfo,
    SessionModelState, SessionModes,
};

use replay_guard::ReplayGuard;

/// Request timeout in seconds for JSON-RPC requests
const REQUEST_TIMEOUT_SECS: u64 = 30;
/// Max bytes we include from subprocess output in logs.
const MAX_LOGGED_SUBPROCESS_LINE_BYTES: usize = 512;
const AGENT_ENV_OVERRIDES_KEY: &str = "agent_env_overrides";

type AgentEnvOverrides = HashMap<String, HashMap<String, String>>;

pub(crate) struct PendingRequestEntry {
    pub generation: u64,
    pub sender: oneshot::Sender<Value>,
}

pub(crate) struct PromptRequestSession {
    pub generation: u64,
    pub session_id: String,
}

fn is_protected_agent_env_override_key(key: &str) -> bool {
    key == "PATH" || crate::shell_env::is_denied_env_key(key)
}

async fn load_saved_agent_env_overrides(
    app_handle: &AppHandle,
) -> Result<AgentEnvOverrides, String> {
    let db = app_handle.state::<DbConn>();
    let raw = AppSettingsRepository::get(db.inner(), AGENT_ENV_OVERRIDES_KEY)
        .await
        .map_err(|error| error.to_string())?;

    match raw {
        Some(json) => {
            serde_json::from_str::<AgentEnvOverrides>(&json).map_err(|error| error.to_string())
        }
        None => Ok(HashMap::new()),
    }
}

fn apply_saved_agent_env_overrides(
    agent_id: &str,
    mut base_env: HashMap<String, String>,
    overrides: &AgentEnvOverrides,
) -> HashMap<String, String> {
    let Some(agent_overrides) = overrides.get(agent_id) else {
        return base_env;
    };

    for (key, value) in agent_overrides {
        if is_protected_agent_env_override_key(key) {
            continue;
        }
        base_env.insert(key.clone(), value.clone());
    }

    base_env
}

/// ACP Protocol method names
/// See: https://agentclientprotocol.com/protocol/
mod acp_methods {
    pub const INITIALIZE: &str = "initialize";
    pub const AUTHENTICATE: &str = "authenticate";
    pub const SESSION_NEW: &str = "session/new";
    pub const SESSION_RESUME: &str = "session/resume";
    pub const SESSION_LOAD: &str = "session/load";
    pub const SESSION_FORK: &str = "session/fork";
    pub const SESSION_SET_MODEL: &str = "session/set_model";
    pub const SESSION_SET_MODE: &str = "session/set_mode";
    pub const SESSION_SET_CONFIG_OPTION: &str = "session/set_config_option";
    pub const PROMPT: &str = "session/prompt";
    pub const SESSION_CANCEL: &str = "session/cancel";
    pub const SESSION_LIST: &str = "session/list";
}
