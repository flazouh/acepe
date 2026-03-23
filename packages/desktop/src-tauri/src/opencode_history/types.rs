//! OpenCode history types.
//!
//! These types represent OpenCode's storage file structure.
//! We reuse session_jsonl types for the output format (FullSession, OrderedMessage, etc.)
//! to maintain consistency with the frontend.

use serde::{Deserialize, Serialize};

/// OpenCode session file structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeSession {
    pub id: String,
    pub version: String,
    #[serde(rename = "projectID")]
    pub project_id: String, // "global" or hash
    pub directory: String,
    #[serde(default, rename = "parentID", skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub time: OpenCodeTime,
}

/// OpenCode time structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeTime {
    pub created: i64,
    #[serde(default)]
    pub updated: i64,
}

/// OpenCode project file structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeProject {
    pub id: String,       // Hash
    pub worktree: String, // Actual path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vcs: Option<String>,
    pub time: OpenCodeTime,
}

/// OpenCode message from HTTP API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeMessage {
    pub id: String,
    pub role: String, // "user" or "assistant"
    pub parts: Vec<OpenCodeMessagePart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

/// OpenCode message stored on disk (file-based storage)
/// Different from OpenCodeMessage which is from HTTP API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeStoredMessage {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    pub role: String, // "user" or "assistant"
    pub time: OpenCodeMessageTime,
    /// Mode of the message - "plan" indicates a plan message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// Agent that created the message - "plan" for plan agent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(rename = "modelID", skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(rename = "providerID", skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(rename = "parentID", skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<OpenCodeMessageSummary>,
}

/// OpenCode message time structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeMessageTime {
    pub created: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<i64>,
}

/// OpenCode message summary (for user messages)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeMessageSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// OpenCode message part stored on disk
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeStoredPart {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    #[serde(rename = "messageID")]
    pub message_id: String,
    #[serde(rename = "type")]
    pub part_type: String, // "text", "reasoning", "tool-invocation", "tool-result", "step-start", etc.
    /// Text content (for "text" and "reasoning" types)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Time information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<OpenCodePartTime>,
}

/// OpenCode part time structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodePartTime {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<i64>,
}

/// OpenCode message part
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OpenCodeMessagePart {
    Text {
        text: String,
    },
    #[serde(rename = "tool-invocation")]
    ToolInvocation {
        id: String,
        name: String,
        #[serde(alias = "arguments")]
        input: serde_json::Value,
        /// Tool state from API - contains status (completed/error/running/pending), output, error
        #[serde(skip_serializing_if = "Option::is_none")]
        state: Option<OpenCodeApiToolState>,
    },
    #[serde(rename = "tool-result")]
    ToolResult {
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        content: String,
    },
}

/// Response format from OpenCode HTTP API /session/:id/message endpoint
/// Returns array of { info: MessageInfo, parts: Part[] }
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeApiMessageResponse {
    pub info: OpenCodeApiMessageInfo,
    pub parts: Vec<OpenCodeApiPart>,
}

/// Info object from OpenCode API message response
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeApiMessageInfo {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    pub role: String,
    pub time: OpenCodeMessageTime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<OpenCodeMessageSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<OpenCodeApiModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
}

/// Model info from OpenCode API
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeApiModel {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    #[serde(rename = "modelID")]
    pub model_id: String,
}

/// Tool state from OpenCode API (for tool-invocation parts)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeApiToolState {
    pub status: String, // "pending", "running", "completed", "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// Part from OpenCode API message response (flat structure from JSON)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenCodeApiPart {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    #[serde(rename = "messageID")]
    pub message_id: String,
    #[serde(rename = "type")]
    pub part_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "callID")]
    pub call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "arguments")]
    pub input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<OpenCodePartTime>,
    /// Tool state (for tool-invocation parts) - contains status, input, output, error
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<OpenCodeApiToolState>,
}
