use crate::acp::client::AcpClient;
use crate::acp::client_trait::{AgentClient, CommunicationMode};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::opencode::{OpenCodeHttpClient, OpenCodeManagerRegistry};
use crate::acp::registry::AgentRegistry;
use crate::acp::types::CanonicalAgentId;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::time::{timeout, Duration};

const CLIENT_START_TIMEOUT: Duration = Duration::from_secs(30);

/// Create a new client for the given agent.
///
/// The `cwd` parameter specifies the working directory where the subprocess will be spawned.
/// This ensures the agent runs in the correct project/worktree directory.
pub async fn create_client(
    registry: &AgentRegistry,
    opencode_manager_registry: &Arc<OpenCodeManagerRegistry>,
    agent_id: CanonicalAgentId,
    app_handle: AppHandle,
    cwd: PathBuf,
) -> AcpResult<Box<dyn AgentClient>> {
    tracing::info!(agent_id = %agent_id.as_str(), cwd = %cwd.display(), "Creating new client for session");

    let provider = registry
        .get(&agent_id)
        .ok_or_else(|| AcpError::AgentNotFound(agent_id.as_str().to_string()))?
        .clone();

    let client: Box<dyn AgentClient> = match provider.communication_mode() {
        CommunicationMode::Subprocess => {
            tracing::debug!(
                "Creating ACP client for {} in {}",
                agent_id.as_str(),
                cwd.display()
            );
            let mut client = AcpClient::new_with_provider(provider, Some(app_handle), cwd)
                .map_err(|e| {
                    AcpError::InvalidState(format!("Failed to create ACP client: {}", e))
                })?;
            timeout(CLIENT_START_TIMEOUT, client.start())
                .await
                .map_err(|_| {
                    AcpError::InvalidState("Client start timed out after 30s".to_string())
                })?
                .map_err(|e| {
                    AcpError::InvalidState(format!("Failed to start ACP client: {}", e))
                })?;
            Box::new(client)
        }
        CommunicationMode::CcSdk => {
            tracing::debug!(
                "Creating cc-sdk client for {} in {}",
                agent_id.as_str(),
                cwd.display()
            );
            let mut client = crate::acp::client::cc_sdk_client::CcSdkClaudeClient::new(
                provider, app_handle, cwd,
            )?;
            timeout(CLIENT_START_TIMEOUT, client.start())
                .await
                .map_err(|_| {
                    AcpError::InvalidState("cc-sdk client start timed out after 30s".to_string())
                })?
                .map_err(|e| {
                    AcpError::InvalidState(format!("Failed to start cc-sdk client: {}", e))
                })?;
            Box::new(client)
        }
        CommunicationMode::Http => {
            let (project_key, manager) = opencode_manager_registry
                .get_or_start(&cwd)
                .await
                .map_err(|error| {
                    AcpError::InvalidState(format!(
                        "Failed to resolve OpenCode manager for {}: {}",
                        cwd.display(),
                        error
                    ))
                })?;
            tracing::debug!(
                agent_id = %agent_id.as_str(),
                project_key = %project_key,
                "Creating OpenCode HTTP client"
            );
            let mut client = OpenCodeHttpClient::new(manager, project_key)?;
            timeout(CLIENT_START_TIMEOUT, client.start())
                .await
                .map_err(|_| {
                    AcpError::InvalidState("OpenCode client start timed out after 30s".to_string())
                })?
                .map_err(|e| {
                    AcpError::InvalidState(format!("Failed to start OpenCode client: {}", e))
                })?;
            Box::new(client)
        }
    };

    tracing::info!(agent_id = %agent_id.as_str(), "Client created and started");
    Ok(client)
}
