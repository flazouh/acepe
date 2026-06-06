//! SDK configuration: assistant-message errors, beta features, tools, plugins.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

/// Error types for assistant messages
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum AssistantMessageError {
    /// Authentication failed
    AuthenticationFailed,
    /// Billing error
    BillingError,
    /// Rate limited
    RateLimit,
    /// Invalid request
    InvalidRequest,
    /// Server error
    ServerError,
    /// Unknown error
    Unknown,
}

// ============================================================================
// SDK Beta Features (matching Python SDK v0.1.12+)
// ============================================================================

/// SDK Beta features - see https://docs.anthropic.com/en/api/beta-headers
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SdkBeta {
    /// Extended context window (1M tokens)
    #[serde(rename = "context-1m-2025-08-07")]
    Context1M,
}

impl std::fmt::Display for SdkBeta {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SdkBeta::Context1M => write!(f, "context-1m-2025-08-07"),
        }
    }
}

// ============================================================================
// Tools Configuration (matching Python SDK v0.1.12+)
// ============================================================================

/// Tools configuration for controlling available tools
///
/// This controls the base set of tools available to Claude, distinct from
/// `allowed_tools` which only controls auto-approval permissions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolsConfig {
    /// List of specific tool names to enable
    /// Example: `["Read", "Edit", "Bash"]`
    List(Vec<String>),
    /// Preset-based tools configuration
    Preset(ToolsPreset),
}

/// Tools preset configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsPreset {
    /// Type identifier (always "preset")
    #[serde(rename = "type")]
    pub preset_type: String,
    /// Preset name (e.g., "claude_code")
    pub preset: String,
}

impl ToolsConfig {
    /// Create a new tools list
    pub fn list(tools: Vec<String>) -> Self {
        ToolsConfig::List(tools)
    }

    /// Create an empty tools list (disables all built-in tools)
    pub fn none() -> Self {
        ToolsConfig::List(vec![])
    }

    /// Create the claude_code preset
    pub fn claude_code_preset() -> Self {
        ToolsConfig::Preset(ToolsPreset {
            preset_type: "preset".to_string(),
            preset: "claude_code".to_string(),
        })
    }
}

/// SDK plugin configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SdkPluginConfig {
    /// Local plugin loaded from filesystem path
    Local {
        /// Path to the plugin directory
        path: String,
    },
}

/// Control protocol format for sending messages
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ControlProtocolFormat {
    /// Legacy format: {"type":"sdk_control_request","request":{...}}
    #[default]
    Legacy,
    /// New format: {"type":"control","control":{...}}
    Control,
    /// Auto-detect based on CLI capabilities (default to Legacy for compatibility)
    Auto,
}
