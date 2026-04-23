use crate::acp::client_errors::{is_method_not_found_error, is_session_not_found_error};
use crate::acp::client_loop::{
    spawn_death_monitor, spawn_stderr_reader, spawn_stdout_reader, DeathMonitorContext,
    StdoutLoopContext,
};
use crate::acp::client_rpc;
use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::drain_permissions_as_failed;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::permission_tracker::{PermissionTracker, WebSearchDedup};
use crate::acp::provider::AgentProvider;
use crate::acp::provider_extensions::InboundResponseAdapter;
use crate::acp::session_update::{SessionUpdate, ToolCallStatus, ToolCallUpdateData};
use crate::acp::types::PromptRequest;
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, DispatchPolicy};
use sea_orm::DbConn;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc as StdArc;
use tauri::{AppHandle, Manager};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

mod auth;
pub mod cc_sdk_client;
pub mod codex_native_client;
pub mod codex_native_config;
pub mod codex_native_events;
pub mod forge_protocol;
mod lifecycle;
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
    AvailableMode, AvailableModel, InitializeResponse, ListSessionsResponse, NewSessionResponse,
    ResumeSessionResponse, SessionInfo, SessionModelState, SessionModes,
};

use replay_guard::ReplayGuard;

/// Request timeout in seconds for JSON-RPC requests
const REQUEST_TIMEOUT_SECS: u64 = 30;
/// Max bytes we include from subprocess output in logs.
const MAX_LOGGED_SUBPROCESS_LINE_BYTES: usize = 512;
type AgentEnvOverrides = crate::acp::runtime_resolver::AgentEnvOverrides;

pub(crate) struct PendingRequestEntry {
    pub generation: u64,
    pub sender: oneshot::Sender<Value>,
}

pub(crate) struct PromptRequestSession {
    pub generation: u64,
    pub session_id: String,
}

async fn load_saved_agent_env_overrides(
    app_handle: &AppHandle,
) -> Result<AgentEnvOverrides, String> {
    crate::acp::runtime_resolver::load_saved_agent_env_overrides(app_handle).await
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
