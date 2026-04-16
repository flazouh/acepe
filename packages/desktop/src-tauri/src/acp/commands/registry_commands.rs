use super::*;
use crate::commands::observability::{expected_acp_command_result, CommandResult};

/// List all available agents
#[tauri::command]
#[specta::specta]
pub async fn acp_list_agents(app: AppHandle) -> CommandResult<Vec<AgentInfo>> {
    expected_acp_command_result("acp_list_agents", async {
    tracing::debug!("acp_list_agents called");
    let registry = app.state::<Arc<AgentRegistry>>();

    let agents = registry.list_all_for_ui();
    tracing::info!(count = %agents.len(), agent_ids = ?agents.iter().map(|a| &a.id).collect::<Vec<_>>(), "acp_list_agents returning agents");
    Ok(agents)
    }
    .await)
}

/// Register a custom agent
#[tauri::command]
#[specta::specta]
pub async fn acp_register_custom_agent(
    app: AppHandle,
    config: CustomAgentConfig,
) -> CommandResult<()> {
    expected_acp_command_result("acp_register_custom_agent", async {
    tracing::info!(agent_id = %config.id, "acp_register_custom_agent called");
    let registry = app.state::<Arc<AgentRegistry>>();

    registry.register_custom(config).map_err(|e| {
        tracing::error!(error = %e, "Register custom agent failed");
        SerializableAcpError::ProtocolError {
            message: format!("Register custom agent failed: {}", e),
        }
    })
    }
    .await)
}
