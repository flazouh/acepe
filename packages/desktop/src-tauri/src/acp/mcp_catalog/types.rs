use serde::{Deserialize, Serialize};
use specta::Type;

use crate::acp::session_update::AvailableCommand;

/// How the composer MCP catalog was assembled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ComposerMcpCatalogSource {
    PreconnectionConfig,
    LiveSession,
    Mixed,
}

/// Connection status for a composer MCP server row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ComposerMcpConnectionStatus {
    Connected,
    Failed,
    NeedsAuth,
    Pending,
    Disabled,
    Unknown,
}

/// Selectable MCP tool row in the composer attach menu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ComposerMcpTool {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub insert_text: String,
}

/// MCP server group with slash commands and tools for the composer.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ComposerMcpServer {
    pub id: String,
    pub name: String,
    pub status: ComposerMcpConnectionStatus,
    pub error: Option<String>,
    pub tools: Vec<ComposerMcpTool>,
    pub slash_commands: Vec<AvailableCommand>,
}

/// Project-scoped MCP catalog for the composer attach menu.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ComposerMcpCatalog {
    pub source: ComposerMcpCatalogSource,
    pub servers: Vec<ComposerMcpServer>,
}

impl ComposerMcpCatalog {
    pub fn empty() -> Self {
        Self {
            source: ComposerMcpCatalogSource::PreconnectionConfig,
            servers: Vec::new(),
        }
    }
}
