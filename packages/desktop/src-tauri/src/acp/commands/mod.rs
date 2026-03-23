use crate::acp::active_agent::ActiveAgent;
use crate::acp::client::{InitializeResponse, NewSessionResponse, ResumeSessionResponse};
use crate::acp::client_factory::create_client;
use crate::acp::client_trait::AgentClient;
use crate::acp::error::SerializableAcpError;
use crate::acp::event_hub::{AcpEventBridgeInfo, AcpEventHubState};
use crate::acp::opencode::OpenCodeManagerRegistry;
use crate::acp::providers::CustomAgentConfig;
use crate::acp::registry::{AgentInfo, AgentRegistry};
use crate::acp::session_registry::SessionRegistry;
use crate::acp::streaming_log::log_streaming_event;
use crate::acp::types::CanonicalAgentId;
use crate::acp::types::PromptRequest;
use crate::analytics;
use crate::path_safety::ProjectPathSafetyError;
use crate::project_access::{validate_project_directory_brokered, ProjectAccessReason};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Duration};

mod client_ops;
mod file_commands;
mod inbound_commands;
mod install_commands;
mod interaction_commands;
mod path_validation;
mod registry_commands;
mod session_commands;

#[cfg(test)]
mod tests;

use client_ops::{
    create_and_initialize_client, lock_session_client, resume_or_create_session_client,
};
pub use file_commands::{acp_read_text_file, acp_write_text_file};
pub use inbound_commands::{acp_reply_permission, acp_reply_question, acp_respond_inbound_request};
pub use install_commands::{acp_install_agent, acp_uninstall_agent};
pub use interaction_commands::{
    acp_cancel, acp_send_prompt, acp_set_config_option, acp_set_mode, acp_set_model,
};
use path_validation::{normalize_acp_path, validate_session_cwd};
pub use registry_commands::{acp_list_agents, acp_register_custom_agent};
pub use session_commands::{
    acp_close_session, acp_fork_session, acp_get_event_bridge_info, acp_initialize,
    acp_new_session, acp_resume_session,
};

type SessionClientMutex = TokioMutex<Box<dyn AgentClient + Send + Sync + 'static>>;
type SessionClientArc = Arc<SessionClientMutex>;

const SESSION_CLIENT_LOCK_TIMEOUT: Duration = Duration::from_secs(3);
const SESSION_CLIENT_OPERATION_TIMEOUT: Duration = Duration::from_secs(30);
const INBOUND_RESPONSE_TIMEOUT: Duration = Duration::from_secs(8);
