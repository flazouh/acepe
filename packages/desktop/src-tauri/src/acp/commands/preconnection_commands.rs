use super::*;
use crate::acp::provider::PreconnectionSlashMode;
use crate::acp::session_update::AvailableCommand;

fn resolve_preconnection_cwd(
    mode: PreconnectionSlashMode,
    cwd: &str,
) -> Result<Option<PathBuf>, SerializableAcpError> {
    match mode {
        PreconnectionSlashMode::ProjectScoped => {
            validate_session_cwd(cwd, ProjectAccessReason::Other).map(Some)
        }
        PreconnectionSlashMode::StartupGlobal | PreconnectionSlashMode::Unsupported => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn acp_list_preconnection_commands(
    app: AppHandle,
    cwd: String,
    agent_id: String,
) -> Result<Vec<AvailableCommand>, SerializableAcpError> {
    tracing::info!(cwd = %cwd, agent_id = %agent_id, "acp_list_preconnection_commands called");

    let canonical_agent_id = CanonicalAgentId::parse(&agent_id);
    let registry = app.state::<Arc<AgentRegistry>>();
    let Some(provider) = registry.get(&canonical_agent_id) else {
        tracing::warn!(requested_agent = %agent_id, "Unknown agent requested preconnection commands");
        return Ok(Vec::new());
    };

    let cwd = resolve_preconnection_cwd(provider.frontend_projection().preconnection_slash_mode, &cwd)?;
    let commands = provider
        .list_preconnection_commands(&app, cwd.as_deref())
        .await
        .map_err(|message| SerializableAcpError::InvalidState { message })?;

    tracing::info!(
        commands_count = commands.len(),
        command_names = ?commands.iter().map(|command| command.name.clone()).collect::<Vec<_>>(),
        "acp_list_preconnection_commands returning commands"
    );

    Ok(commands)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_preconnection_cwd_allows_empty_for_startup_global_loading() {
        let cwd = resolve_preconnection_cwd(PreconnectionSlashMode::StartupGlobal, "")
            .expect("startup-global should not require cwd");

        assert_eq!(cwd, None);
    }

    #[test]
    fn resolve_preconnection_cwd_requires_directory_for_project_scoped_loading() {
        let temp = tempdir().expect("temp dir");
        let expected_cwd = std::fs::canonicalize(temp.path()).expect("canonicalize temp dir");

        let cwd = resolve_preconnection_cwd(
            PreconnectionSlashMode::ProjectScoped,
            temp.path().to_string_lossy().as_ref(),
        )
        .expect("project-scoped should accept a valid cwd");

        assert_eq!(cwd, Some(expected_cwd));
        assert!(
            resolve_preconnection_cwd(PreconnectionSlashMode::ProjectScoped, "").is_err(),
            "project-scoped loading must reject missing cwd"
        );
    }
}
