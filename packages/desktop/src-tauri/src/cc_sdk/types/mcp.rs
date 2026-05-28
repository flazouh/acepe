//! MCP (Model Context Protocol) and thinking-config types.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// MCP server connection status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpConnectionStatus {
    /// Server is connected
    Connected,
    /// Connection failed
    Failed,
    /// Server needs authentication
    NeedsAuth,
    /// Connection pending
    Pending,
    /// Server is disabled
    Disabled,
}

/// MCP tool annotations (capabilities/restrictions)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolAnnotations {
    /// Whether the tool is read-only
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    /// Whether the tool is destructive
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destructive: Option<bool>,
    /// Whether the tool makes open-world requests
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_world: Option<bool>,
}

/// MCP tool information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    /// Tool name
    pub name: String,
    /// Tool description
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Tool annotations
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotations: Option<McpToolAnnotations>,
}

/// MCP server info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInfo {
    /// Server name
    pub name: String,
    /// Server version
    pub version: String,
}

/// MCP server runtime status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    /// Server name
    pub name: String,
    /// Connection status
    pub status: McpConnectionStatus,
    /// Server info (when connected)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_info: Option<McpServerInfo>,
    /// Error message (when failed)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Available tools
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<McpToolInfo>>,
}

// ============================================================================
// Thinking Configuration (Python SDK parity)
// ============================================================================

/// Thinking configuration for Claude's reasoning
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ThinkingConfig {
    /// Adaptive thinking — Claude decides how much to think
    Adaptive,
    /// Enabled with a specific token budget
    Enabled {
        /// Maximum tokens for thinking
        budget_tokens: i32,
    },
    /// Thinking disabled
    Disabled,
}

/// MCP (Model Context Protocol) server configuration
#[derive(Clone)]
pub enum McpServerConfig {
    /// Standard I/O based MCP server
    Stdio {
        /// Command to execute
        command: String,
        /// Command arguments
        args: Option<Vec<String>>,
        /// Environment variables
        env: Option<HashMap<String, String>>,
    },
    /// Server-Sent Events based MCP server
    Sse {
        /// Server URL
        url: String,
        /// HTTP headers
        headers: Option<HashMap<String, String>>,
    },
    /// HTTP-based MCP server
    Http {
        /// Server URL
        url: String,
        /// HTTP headers
        headers: Option<HashMap<String, String>>,
    },
    /// SDK MCP server (in-process)
    Sdk {
        /// Server name
        name: String,
        /// Server instance
        instance: Arc<dyn std::any::Any + Send + Sync>,
    },
}

impl std::fmt::Debug for McpServerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Stdio { command, args, env } => f
                .debug_struct("Stdio")
                .field("command", command)
                .field("args", args)
                .field("env", env)
                .finish(),
            Self::Sse { url, headers } => f
                .debug_struct("Sse")
                .field("url", url)
                .field("headers", headers)
                .finish(),
            Self::Http { url, headers } => f
                .debug_struct("Http")
                .field("url", url)
                .field("headers", headers)
                .finish(),
            Self::Sdk { name, .. } => f
                .debug_struct("Sdk")
                .field("name", name)
                .field("instance", &"<Arc<dyn Any>>")
                .finish(),
        }
    }
}

impl Serialize for McpServerConfig {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(None)?;

        match self {
            Self::Stdio { command, args, env } => {
                map.serialize_entry("type", "stdio")?;
                map.serialize_entry("command", command)?;
                if let Some(args) = args {
                    map.serialize_entry("args", args)?;
                }
                if let Some(env) = env {
                    map.serialize_entry("env", env)?;
                }
            }
            Self::Sse { url, headers } => {
                map.serialize_entry("type", "sse")?;
                map.serialize_entry("url", url)?;
                if let Some(headers) = headers {
                    map.serialize_entry("headers", headers)?;
                }
            }
            Self::Http { url, headers } => {
                map.serialize_entry("type", "http")?;
                map.serialize_entry("url", url)?;
                if let Some(headers) = headers {
                    map.serialize_entry("headers", headers)?;
                }
            }
            Self::Sdk { name, .. } => {
                map.serialize_entry("type", "sdk")?;
                map.serialize_entry("name", name)?;
            }
        }

        map.end()
    }
}

impl<'de> Deserialize<'de> for McpServerConfig {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(tag = "type", rename_all = "lowercase")]
        enum McpServerConfigHelper {
            Stdio {
                command: String,
                #[serde(skip_serializing_if = "Option::is_none")]
                args: Option<Vec<String>>,
                #[serde(skip_serializing_if = "Option::is_none")]
                env: Option<HashMap<String, String>>,
            },
            Sse {
                url: String,
                #[serde(skip_serializing_if = "Option::is_none")]
                headers: Option<HashMap<String, String>>,
            },
            Http {
                url: String,
                #[serde(skip_serializing_if = "Option::is_none")]
                headers: Option<HashMap<String, String>>,
            },
        }

        let helper = McpServerConfigHelper::deserialize(deserializer)?;
        Ok(match helper {
            McpServerConfigHelper::Stdio { command, args, env } => {
                McpServerConfig::Stdio { command, args, env }
            }
            McpServerConfigHelper::Sse { url, headers } => McpServerConfig::Sse { url, headers },
            McpServerConfigHelper::Http { url, headers } => McpServerConfig::Http { url, headers },
        })
    }
}
