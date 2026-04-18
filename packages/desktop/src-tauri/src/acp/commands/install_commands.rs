use super::*;
use crate::commands::observability::{expected_acp_command_result, CommandResult};

/// Install an agent by downloading from the ACP registry.
///
/// Blocking — frontend shows spinner via progress events on `agent-install:progress`.
#[tauri::command]
#[specta::specta]
pub async fn acp_install_agent(app: AppHandle, agent_id: String) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_install_agent",
        async {
            tracing::info!(agent_id = %agent_id, "acp_install_agent called");

            let canonical = CanonicalAgentId::parse(&agent_id);

            if !crate::acp::agent_installer::can_auto_install(&canonical) {
                return Err(SerializableAcpError::InvalidState {
                    message: format!("Agent '{}' cannot be installed automatically", agent_id),
                });
            }

            crate::acp::agent_installer::install_agent(canonical, app)
                .await
                .map(|_path| ())
                .map_err(|e| {
                    tracing::error!(agent_id = %agent_id, error = %e, "Agent installation failed");
                    SerializableAcpError::from(e)
                })
        }
        .await,
    )
}

/// Uninstall a previously downloaded agent.
///
/// Async for consistency with Tauri command convention (all commands are async).
#[tauri::command]
#[specta::specta]
pub async fn acp_uninstall_agent(agent_id: String) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_uninstall_agent",
        async {
            tracing::info!(agent_id = %agent_id, "acp_uninstall_agent called");

            let canonical = CanonicalAgentId::parse(&agent_id);

            if !crate::acp::agent_installer::can_auto_install(&canonical) {
                return Err(SerializableAcpError::InvalidState {
                    message: format!("Agent '{}' cannot be uninstalled automatically", agent_id),
                });
            }

            crate::acp::agent_installer::uninstall(&canonical).map_err(|e| {
                tracing::error!(agent_id = %agent_id, error = %e, "Agent uninstall failed");
                SerializableAcpError::from(e)
            })
        }
        .await,
    )
}
