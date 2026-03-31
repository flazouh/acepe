use super::*;
use crate::acp::opencode::OpenCodeHttpClient;
use crate::acp::session_update::AvailableCommand;

#[tauri::command]
#[specta::specta]
pub async fn acp_list_preconnection_commands(
    app: AppHandle,
    cwd: String,
    agent_id: String,
) -> Result<Vec<AvailableCommand>, SerializableAcpError> {
    tracing::info!(cwd = %cwd, agent_id = %agent_id, "acp_list_preconnection_commands called");
    let agent_id = CanonicalAgentId::parse(&agent_id);
    if agent_id != CanonicalAgentId::OpenCode {
        tracing::info!(requested_agent = %agent_id.as_str(), "Skipping preconnection commands for unsupported agent");
        return Ok(Vec::new());
    }

    let cwd = validate_session_cwd(&cwd, ProjectAccessReason::Other)?;
    let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();

    let (project_key, manager) = opencode_manager.get_or_start(&cwd).await.map_err(|error| {
        SerializableAcpError::InvalidState {
            message: format!("Failed to get OpenCode manager: {}", error),
        }
    })?;

    let mut client =
        OpenCodeHttpClient::new(manager, project_key).map_err(SerializableAcpError::from)?;

    let commands = client
        .list_preconnection_commands(cwd.to_string_lossy().to_string())
        .await
        .map_err(SerializableAcpError::from)?;

    tracing::info!(
        commands_count = commands.len(),
        command_names = ?commands.iter().map(|command| command.name.clone()).collect::<Vec<_>>(),
        "acp_list_preconnection_commands returning commands"
    );

    Ok(commands)
}
