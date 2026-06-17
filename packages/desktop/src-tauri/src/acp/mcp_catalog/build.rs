use std::collections::BTreeMap;

use crate::acp::session_update::AvailableCommand;
use crate::cc_sdk::{McpConnectionStatus, McpServerStatus, McpToolInfo};

use super::types::{
    ComposerMcpCatalog, ComposerMcpCatalogSource, ComposerMcpConnectionStatus, ComposerMcpServer,
    ComposerMcpTool,
};

pub fn build_composer_mcp_catalog(input: BuildComposerMcpCatalogInput) -> ComposerMcpCatalog {
    let mut server_names: Vec<String> = input
        .configured_server_names
        .into_iter()
        .chain(parse_mcp_slash_server_names_from_commands(
            &input.available_commands,
        ))
        .chain(
            input
                .live_server_statuses
                .iter()
                .map(|status| status.name.clone()),
        )
        .collect();
    server_names.sort();
    server_names.dedup();

    if server_names.is_empty() {
        return ComposerMcpCatalog::empty();
    }

    let live_by_name = input
        .live_server_statuses
        .into_iter()
        .map(|status| (status.name.clone(), status))
        .collect::<BTreeMap<_, _>>();

    let mut slash_by_server = group_mcp_slash_commands(&input.available_commands);
    let mut servers = Vec::with_capacity(server_names.len());

    for server_name in server_names {
        let live_status = live_by_name.get(&server_name);
        let slash_commands = slash_by_server.remove(&server_name).unwrap_or_default();
        let tools = live_status
            .and_then(|status| status.tools.as_ref())
            .map(|tools| tools.iter().map(|tool| map_tool(&server_name, tool)).collect())
            .unwrap_or_default();

        servers.push(ComposerMcpServer {
            id: server_name.clone(),
            name: server_name.clone(),
            status: live_status
                .map(|status| map_connection_status(&status.status))
                .unwrap_or(ComposerMcpConnectionStatus::Unknown),
            error: live_status.and_then(|status| status.error.clone()),
            tools,
            slash_commands,
        });
    }

    let source = resolve_catalog_source(
        input.had_config_servers,
        input.had_live_statuses,
        input.had_session_commands,
    );

    ComposerMcpCatalog { source, servers }
}

pub struct BuildComposerMcpCatalogInput {
    pub configured_server_names: Vec<String>,
    pub available_commands: Vec<AvailableCommand>,
    pub live_server_statuses: Vec<McpServerStatus>,
    pub had_config_servers: bool,
    pub had_live_statuses: bool,
    pub had_session_commands: bool,
}

fn resolve_catalog_source(
    had_config: bool,
    had_live: bool,
    had_session_commands: bool,
) -> ComposerMcpCatalogSource {
    if had_live || had_session_commands {
        if had_config {
            ComposerMcpCatalogSource::Mixed
        } else {
            ComposerMcpCatalogSource::LiveSession
        }
    } else {
        ComposerMcpCatalogSource::PreconnectionConfig
    }
}

fn map_connection_status(status: &McpConnectionStatus) -> ComposerMcpConnectionStatus {
    match status {
        McpConnectionStatus::Connected => ComposerMcpConnectionStatus::Connected,
        McpConnectionStatus::Failed => ComposerMcpConnectionStatus::Failed,
        McpConnectionStatus::NeedsAuth => ComposerMcpConnectionStatus::NeedsAuth,
        McpConnectionStatus::Pending => ComposerMcpConnectionStatus::Pending,
        McpConnectionStatus::Disabled => ComposerMcpConnectionStatus::Disabled,
    }
}

fn map_tool(server_name: &str, tool: &McpToolInfo) -> ComposerMcpTool {
    let insert_text = format!("@[command:/mcp:{server_name}/{}]", tool.name);
    ComposerMcpTool {
        id: format!("{server_name}::{}" , tool.name),
        name: tool.name.clone(),
        description: tool.description.clone(),
        insert_text,
    }
}

fn group_mcp_slash_commands(
    commands: &[AvailableCommand],
) -> BTreeMap<String, Vec<AvailableCommand>> {
    let mut grouped = BTreeMap::new();
    for command in commands {
        if let Some(server_name) = parse_mcp_slash_server_name(&command.name) {
            grouped
                .entry(server_name)
                .or_insert_with(Vec::new)
                .push(command.clone());
        }
    }
    grouped
}

fn parse_mcp_slash_server_names_from_commands(commands: &[AvailableCommand]) -> Vec<String> {
    commands
        .iter()
        .filter_map(|command| parse_mcp_slash_server_name(&command.name))
        .collect()
}

pub fn parse_mcp_slash_server_name(command_name: &str) -> Option<String> {
    let remainder = command_name.strip_prefix("mcp:")?;
    if remainder.is_empty() {
        return None;
    }
    let server_name = remainder
        .split(':')
        .next()
        .unwrap_or(remainder)
        .trim();
    if server_name.is_empty() {
        None
    } else {
        Some(server_name.to_string())
    }
}

pub fn is_mcp_slash_command(command_name: &str) -> bool {
    parse_mcp_slash_server_name(command_name).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_mcp_slash_commands_by_server() {
        let catalog = build_composer_mcp_catalog(BuildComposerMcpCatalogInput {
            configured_server_names: vec!["github".to_string()],
            available_commands: vec![
                AvailableCommand {
                    name: "mcp:github".to_string(),
                    description: "GitHub MCP".to_string(),
                    input: None,
                },
                AvailableCommand {
                    name: "mcp:linear".to_string(),
                    description: "Linear MCP".to_string(),
                    input: None,
                },
            ],
            live_server_statuses: Vec::new(),
            had_config_servers: true,
            had_live_statuses: false,
            had_session_commands: true,
        });

        assert_eq!(catalog.servers.len(), 2);
        assert_eq!(catalog.servers[0].name, "github");
        assert_eq!(catalog.servers[0].slash_commands.len(), 1);
        assert_eq!(catalog.servers[1].name, "linear");
    }

    #[test]
    fn maps_live_tools_with_insert_text() {
        let catalog = build_composer_mcp_catalog(BuildComposerMcpCatalogInput {
            configured_server_names: vec!["github".to_string()],
            available_commands: Vec::new(),
            live_server_statuses: vec![McpServerStatus {
                name: "github".to_string(),
                status: McpConnectionStatus::Connected,
                server_info: None,
                error: None,
                tools: Some(vec![McpToolInfo {
                    name: "search_issues".to_string(),
                    description: Some("Search issues".to_string()),
                    annotations: None,
                }]),
            }],
            had_config_servers: true,
            had_live_statuses: true,
            had_session_commands: false,
        });

        assert_eq!(catalog.source, ComposerMcpCatalogSource::Mixed);
        assert_eq!(catalog.servers.len(), 1);
        assert_eq!(catalog.servers[0].status, ComposerMcpConnectionStatus::Connected);
        assert_eq!(catalog.servers[0].tools.len(), 1);
        assert_eq!(
            catalog.servers[0].tools[0].insert_text,
            "@[command:/mcp:github/search_issues]"
        );
    }
}
