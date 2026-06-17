use std::path::Path;

use tauri::{AppHandle, Manager};

use crate::acp::mcp_catalog::{
    build_composer_mcp_catalog, is_mcp_slash_command, load_configured_mcp_server_names,
    BuildComposerMcpCatalogInput, ComposerMcpCatalog,
};
use crate::acp::provider::AgentProvider;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::session_update::AvailableCommand;

pub async fn resolve_composer_mcp_catalog(
    app: &AppHandle,
    provider: &dyn AgentProvider,
    cwd: &Path,
    session_id: Option<&str>,
) -> ComposerMcpCatalog {
    let configured_server_names = load_configured_mcp_server_names(cwd);
    let had_config_servers = !configured_server_names.is_empty();

    let mut available_commands = resolve_available_commands(app, provider, cwd, session_id).await;
    let had_session_commands = !available_commands.is_empty();

    let live_server_statuses = provider
        .get_live_mcp_server_statuses(app, session_id)
        .await;
    let had_live_statuses = !live_server_statuses.is_empty();

    available_commands.retain(|command| is_mcp_slash_command(&command.name));

    build_composer_mcp_catalog(BuildComposerMcpCatalogInput {
        configured_server_names,
        available_commands,
        live_server_statuses,
        had_config_servers,
        had_live_statuses,
        had_session_commands,
    })
}

async fn resolve_available_commands(
    app: &AppHandle,
    provider: &dyn AgentProvider,
    cwd: &Path,
    session_id: Option<&str>,
) -> Vec<AvailableCommand> {
    if let Some(session_id) = session_id {
        if let Some(registry) = app.try_state::<std::sync::Arc<SessionGraphRuntimeRegistry>>() {
            let snapshot = registry.snapshot_for_session(session_id);
            if let Some(commands) = snapshot.capabilities.available_commands {
                return commands;
            }
        }
    }

    provider
        .list_session_commands(Some(app), Some(cwd))
        .await
        .unwrap_or_default()
}
