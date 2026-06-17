use super::*;
use crate::acp::mcp_catalog::{resolve_composer_mcp_catalog, ComposerMcpCatalog};
use crate::acp::types::CanonicalAgentId;
use crate::commands::observability::{expected_acp_command_result, CommandResult};

#[tauri::command]
#[specta::specta]
pub async fn acp_get_composer_mcp_catalog(
    app: AppHandle,
    cwd: String,
    agent_id: String,
    session_id: Option<String>,
) -> CommandResult<ComposerMcpCatalog> {
    expected_acp_command_result("acp_get_composer_mcp_catalog", async {
        let canonical_agent_id = CanonicalAgentId::parse(&agent_id);
        let registry = app.state::<Arc<AgentRegistry>>();
        let Some(provider) = registry.get(&canonical_agent_id) else {
            tracing::warn!(requested_agent = %agent_id, "Unknown agent requested composer MCP catalog");
            return Ok(ComposerMcpCatalog::empty());
        };

        let canonical_cwd = validate_session_cwd(&cwd, ProjectAccessReason::Other)?;
        let session_id_ref = session_id.as_deref();
        let catalog = resolve_composer_mcp_catalog(
            &app,
            provider.as_ref(),
            canonical_cwd.as_path(),
            session_id_ref,
        )
        .await;

        tracing::info!(
            agent_id = %agent_id,
            cwd = %canonical_cwd.display(),
            session_id = ?session_id,
            server_count = catalog.servers.len(),
            "acp_get_composer_mcp_catalog returning catalog"
        );

        Ok(catalog)
    }
    .await)
}
