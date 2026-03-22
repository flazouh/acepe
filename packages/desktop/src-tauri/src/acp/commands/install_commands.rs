use super::*;

/// Install an agent by downloading from the ACP registry.
///
/// Blocking — frontend shows spinner via progress events on `agent-install:progress`.
#[tauri::command]
#[specta::specta]
pub async fn acp_install_agent(
    app: AppHandle,
    agent_id: String,
) -> Result<(), SerializableAcpError> {
    tracing::info!(agent_id = %agent_id, "acp_install_agent called");

    let canonical = CanonicalAgentId::parse(&agent_id);

    // Only Cursor and OpenCode are installable
    match &canonical {
        CanonicalAgentId::Cursor | CanonicalAgentId::OpenCode => {}
        _ => {
            return Err(SerializableAcpError::InvalidState {
                message: format!(
                    "Agent '{}' is not installable (bundled or unknown)",
                    agent_id
                ),
            });
        }
    }

    crate::acp::agent_installer::install_agent(canonical, app)
        .await
        .map(|_path| ())
        .map_err(|e| {
            tracing::error!(agent_id = %agent_id, error = %e, "Agent installation failed");
            SerializableAcpError::from(e)
        })
}

/// Uninstall a previously downloaded agent.
///
/// Async for consistency with Tauri command convention (all commands are async).
#[tauri::command]
#[specta::specta]
pub async fn acp_uninstall_agent(agent_id: String) -> Result<(), SerializableAcpError> {
    tracing::info!(agent_id = %agent_id, "acp_uninstall_agent called");

    let canonical = CanonicalAgentId::parse(&agent_id);

    match &canonical {
        CanonicalAgentId::Cursor | CanonicalAgentId::OpenCode => {}
        _ => {
            return Err(SerializableAcpError::InvalidState {
                message: format!("Agent '{}' is not uninstallable", agent_id),
            });
        }
    }

    crate::acp::agent_installer::uninstall(&canonical).map_err(|e| {
        tracing::error!(agent_id = %agent_id, error = %e, "Agent uninstall failed");
        SerializableAcpError::from(e)
    })
}
