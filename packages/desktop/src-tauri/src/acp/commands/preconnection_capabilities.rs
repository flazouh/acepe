use super::*;
use crate::acp::capability_resolution::ResolvedCapabilities;
use crate::acp::provider::PreconnectionCapabilityMode;
use crate::commands::observability::{expected_acp_command_result, CommandResult};

fn resolve_preconnection_capability_cwd(
    mode: PreconnectionCapabilityMode,
    cwd: &str,
) -> Result<Option<PathBuf>, SerializableAcpError> {
    match mode {
        PreconnectionCapabilityMode::ProjectScoped => {
            validate_session_cwd(cwd, ProjectAccessReason::Other).map(Some)
        }
        PreconnectionCapabilityMode::StartupGlobal | PreconnectionCapabilityMode::Unsupported => {
            Ok(None)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn acp_list_preconnection_capabilities(
    app: AppHandle,
    cwd: String,
    agent_id: String,
) -> CommandResult<ResolvedCapabilities> {
    expected_acp_command_result("acp_list_preconnection_capabilities", async {
        let canonical_agent_id = CanonicalAgentId::parse(&agent_id);
        let registry = app.state::<Arc<AgentRegistry>>();
        let Some(provider) = registry.get(&canonical_agent_id) else {
            tracing::warn!(
                requested_agent = %agent_id,
                "Unknown agent requested preconnection capabilities"
            );
            return Err(SerializableAcpError::InvalidState {
                message: format!("Unknown agent requested preconnection capabilities: {agent_id}"),
            });
        };

        let provider_metadata = provider.frontend_projection();
        let cwd = resolve_preconnection_capability_cwd(
            provider_metadata.preconnection_capability_mode,
            &cwd,
        )?;
        Ok(provider.list_preconnection_capabilities(&app, cwd.as_deref()).await)
    }
    .await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_preconnection_capability_cwd_allows_empty_for_startup_global_loading() {
        let cwd =
            resolve_preconnection_capability_cwd(PreconnectionCapabilityMode::StartupGlobal, "")
                .expect("startup-global should not require cwd");

        assert_eq!(cwd, None);
    }

    #[test]
    fn resolve_preconnection_capability_cwd_requires_directory_for_project_scoped_loading() {
        let temp = tempdir().expect("temp dir");
        let expected_cwd = std::fs::canonicalize(temp.path()).expect("canonicalize temp dir");

        let cwd = resolve_preconnection_capability_cwd(
            PreconnectionCapabilityMode::ProjectScoped,
            temp.path().to_string_lossy().as_ref(),
        )
        .expect("project-scoped should accept a valid cwd");

        assert_eq!(cwd, Some(expected_cwd));
        assert!(
            resolve_preconnection_capability_cwd(PreconnectionCapabilityMode::ProjectScoped, "")
                .is_err(),
            "project-scoped loading must reject missing cwd"
        );
    }
}
