use crate::acp::active_agent::ActiveAgent;
use crate::acp::client::{InitializeResponse, NewSessionResponse, ResumeSessionResponse};
use crate::acp::client_factory::create_client;
use crate::acp::client_trait::AgentClient;
use crate::acp::error::SerializableAcpError;
use crate::acp::event_hub::AcpEventBridgeInfo;
use crate::acp::opencode::OpenCodeManagerRegistry;
use crate::acp::providers::CustomAgentConfig;
use crate::acp::registry::{AgentInfo, AgentRegistry};
use crate::acp::session_registry::SessionRegistry;
use crate::acp::streaming_log::log_streaming_event;
use crate::acp::types::CanonicalAgentId;
use crate::acp::types::PromptRequest;
use crate::path_safety::ProjectPathSafetyError;
use crate::project_access::{validate_project_directory_brokered, ProjectAccessReason};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Duration};

mod authentication_commands;
mod client_ops;
mod computer_probe;
mod file_commands;
mod github_diff_commands;
mod github_issue_commands;
mod inbound_commands;
mod install_commands;
mod interaction_commands;
mod mcp_catalog;
mod path_validation;
mod preconnection_capabilities;
mod preconnection_commands;
mod registry_commands;
mod session_commands;
pub(crate) use session_commands::emit_lifecycle_event;
mod transcript_row_page_commands;
pub(crate) mod transcript_viewport_commands;

#[cfg(test)]
mod tests;

pub use authentication_commands::{acp_authenticate_agent, acp_cancel_agent_authentication};
use client_ops::{
    create_and_initialize_client, lock_session_client, resume_or_create_session_client,
};
pub use computer_probe::acp_probe_computer_use;
pub use file_commands::{acp_read_text_file, acp_write_text_file};
pub use github_diff_commands::{
    fetch_commit_diff, fetch_pr_diff, get_github_repo_context, git_working_file_diff,
    list_pull_requests,
};
pub use github_issue_commands::{
    check_github_auth, create_github_issue, create_issue_comment, get_github_issue,
    list_github_issues, list_issue_comments, search_github_issues, toggle_comment_reaction,
    toggle_issue_reaction,
};
pub use inbound_commands::{acp_reply_interaction, acp_respond_inbound_request};
pub use install_commands::{acp_install_agent, acp_uninstall_agent};
pub use interaction_commands::{
    acp_cancel, acp_send_prompt, acp_set_config_option, acp_set_mode, acp_set_model,
};
pub use mcp_catalog::acp_get_composer_mcp_catalog;
use path_validation::{normalize_acp_path, validate_session_cwd};
pub use preconnection_capabilities::acp_list_preconnection_capabilities;
pub use preconnection_commands::acp_list_preconnection_commands;
pub use registry_commands::{acp_list_agents, acp_register_custom_agent};
#[cfg(test)]
pub(crate) use session_commands::persist_session_metadata_for_cwd;
pub(crate) use session_commands::session_metadata_context_from_cwd;
pub use session_commands::{
    acp_close_session, acp_fork_session, acp_get_event_bridge_info,
    acp_get_session_connection_readiness, acp_get_session_state, acp_initialize, acp_new_session,
    acp_resume_session, acp_set_session_autonomous, acp_unarchive_session,
};
pub use transcript_row_page_commands::acp_read_transcript_row_page;
pub use transcript_viewport_commands::acp_request_transcript_viewport_buffer;

type SessionClientMutex = TokioMutex<Box<dyn AgentClient + Send + Sync + 'static>>;
type SessionClientArc = Arc<SessionClientMutex>;

const SESSION_CLIENT_LOCK_TIMEOUT: Duration = Duration::from_secs(3);
const SESSION_CLIENT_OPERATION_TIMEOUT: Duration = Duration::from_secs(30);
const INBOUND_RESPONSE_TIMEOUT: Duration = Duration::from_secs(8);
/// Single authoritative timeout for the entire async resume task.
/// Encompasses all sub-operations (lock, resume/create, seed, etc.).
const RESUME_SESSION_TIMEOUT: Duration = Duration::from_secs(45);
