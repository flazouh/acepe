//! SDK control protocol types: request/response variants used over the wire.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::permission::PermissionUpdate;

/// SDK Control Protocol - Interrupt request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDKControlInterruptRequest {
    /// Subtype
    pub subtype: String, // "interrupt"
}

/// SDK Control Protocol - Permission request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDKControlPermissionRequest {
    /// Subtype
    pub subtype: String, // "can_use_tool"
    /// Tool name
    #[serde(alias = "toolName")]
    pub tool_name: String,
    /// Tool input
    pub input: serde_json::Value,
    /// Permission suggestions
    #[serde(
        skip_serializing_if = "Option::is_none",
        alias = "permissionSuggestions"
    )]
    pub permission_suggestions: Option<Vec<PermissionUpdate>>,
    /// Blocked path
    #[serde(skip_serializing_if = "Option::is_none", alias = "blockedPath")]
    pub blocked_path: Option<String>,
}

/// SDK Control Protocol - Initialize request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDKControlInitializeRequest {
    /// Subtype
    pub subtype: String, // "initialize"
    /// Hooks configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hooks: Option<HashMap<String, serde_json::Value>>,
}

/// SDK Control Protocol - Set permission mode request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SDKControlSetPermissionModeRequest {
    /// Subtype
    pub subtype: String, // "set_permission_mode"
    /// Permission mode
    pub mode: String,
}

/// SDK Control Protocol - Set model request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SDKControlSetModelRequest {
    /// Subtype
    pub subtype: String, // "set_model"
    /// Model to set (None to clear)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// SDK Hook callback request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDKHookCallbackRequest {
    /// Subtype
    pub subtype: String, // "hook_callback"
    /// Callback ID
    #[serde(alias = "callbackId")]
    pub callback_id: String,
    /// Input data
    pub input: serde_json::Value,
    /// Tool use ID
    #[serde(skip_serializing_if = "Option::is_none", alias = "toolUseId")]
    pub tool_use_id: Option<String>,
}

/// SDK Control Protocol - MCP message request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDKControlMcpMessageRequest {
    /// Subtype
    pub subtype: String, // "mcp_message"
    /// MCP server name
    #[serde(
        rename = "server_name",
        alias = "mcpServerName",
        alias = "mcp_server_name"
    )]
    pub mcp_server_name: String,
    /// Message to send
    pub message: serde_json::Value,
}

/// SDK Control Protocol - Rewind files request (Python SDK v0.1.14+)
///
/// Rewinds tracked files to their state at a specific user message.
/// Requires `enable_file_checkpointing` to be enabled.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDKControlRewindFilesRequest {
    /// Subtype (always "rewind_files")
    pub subtype: String,
    /// UUID of the user message to rewind to
    #[serde(alias = "userMessageId")]
    pub user_message_id: String,
}

impl SDKControlRewindFilesRequest {
    /// Create a new rewind files request
    pub fn new(user_message_id: impl Into<String>) -> Self {
        Self {
            subtype: "rewind_files".to_string(),
            user_message_id: user_message_id.into(),
        }
    }
}

/// SDK Control Protocol request types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SDKControlRequest {
    /// Interrupt request
    #[serde(rename = "interrupt")]
    Interrupt(SDKControlInterruptRequest),
    /// Permission request
    #[serde(rename = "can_use_tool")]
    CanUseTool(SDKControlPermissionRequest),
    /// Initialize request
    #[serde(rename = "initialize")]
    Initialize(SDKControlInitializeRequest),
    /// Set permission mode
    #[serde(rename = "set_permission_mode")]
    SetPermissionMode(SDKControlSetPermissionModeRequest),
    /// Set model
    #[serde(rename = "set_model")]
    SetModel(SDKControlSetModelRequest),
    /// Hook callback
    #[serde(rename = "hook_callback")]
    HookCallback(SDKHookCallbackRequest),
    /// MCP message
    #[serde(rename = "mcp_message")]
    McpMessage(SDKControlMcpMessageRequest),
    /// Rewind files (Python SDK v0.1.14+)
    #[serde(rename = "rewind_files")]
    RewindFiles(SDKControlRewindFilesRequest),
}

/// Control request types (legacy, keeping for compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ControlRequest {
    /// Interrupt the current operation
    Interrupt {
        /// Request ID
        request_id: String,
    },
}

/// Control response types (legacy, keeping for compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ControlResponse {
    /// Interrupt acknowledged
    InterruptAck {
        /// Request ID
        request_id: String,
        /// Whether interrupt was successful
        success: bool,
    },
}
