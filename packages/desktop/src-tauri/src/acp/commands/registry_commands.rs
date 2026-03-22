use super::*;

/// List all available agents
#[tauri::command]
#[specta::specta]
pub async fn acp_list_agents(app: AppHandle) -> Result<Vec<AgentInfo>, SerializableAcpError> {
    tracing::debug!("acp_list_agents called");
    let registry = app.state::<Arc<AgentRegistry>>();

    let agents = registry.list_all_for_ui();
    tracing::info!(count = %agents.len(), agent_ids = ?agents.iter().map(|a| &a.id).collect::<Vec<_>>(), "acp_list_agents returning agents");
    Ok(agents)
}

/// Register a custom agent
#[tauri::command]
#[specta::specta]
pub async fn acp_register_custom_agent(
    app: AppHandle,
    config: CustomAgentConfig,
) -> Result<(), SerializableAcpError> {
    tracing::info!(agent_id = %config.id, "acp_register_custom_agent called");
    let registry = app.state::<Arc<AgentRegistry>>();

    registry.register_custom(config).map_err(|e| {
        tracing::error!(error = %e, "Register custom agent failed");
        SerializableAcpError::ProtocolError {
            message: format!("Register custom agent failed: {}", e),
        }
    })
}
