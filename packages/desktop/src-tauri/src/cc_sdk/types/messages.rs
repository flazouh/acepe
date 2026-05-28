//! Message and content-block types: tasks, Message variants, UserMessage, AssistantMessage, content blocks.

#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

use super::rate_limit::RateLimitInfo;
use super::sdk_config::AssistantMessageError;

/// Usage statistics for a task
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TaskUsage {
    /// Total tokens used
    #[serde(default)]
    pub total_tokens: u64,
    /// Number of tool uses
    #[serde(default)]
    pub tool_uses: u64,
    /// Duration in milliseconds
    #[serde(default)]
    pub duration_ms: u64,
}

/// Task completion status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    /// Task completed successfully
    Completed,
    /// Task failed
    Failed,
    /// Task was stopped
    Stopped,
}

/// Task started message data
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskStartedMessage {
    /// Task ID
    pub task_id: String,
    /// Task description
    pub description: String,
    /// Unique message ID
    pub uuid: String,
    /// Session ID
    pub session_id: String,
    /// Associated tool use ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    /// Task type
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_type: Option<String>,
}

/// Task progress message data
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskProgressMessage {
    /// Task ID
    pub task_id: String,
    /// Task description/status
    pub description: String,
    /// Usage statistics
    #[serde(default)]
    pub usage: TaskUsage,
    /// Unique message ID
    pub uuid: String,
    /// Session ID
    pub session_id: String,
    /// Associated tool use ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    /// Name of last tool used
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_tool_name: Option<String>,
}

/// Task notification (completion) message data
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskNotificationMessage {
    /// Task ID
    pub task_id: String,
    /// Task completion status
    pub status: TaskStatus,
    /// Output file path
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_file: Option<String>,
    /// Summary of task results
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Unique message ID
    pub uuid: String,
    /// Session ID
    pub session_id: String,
    /// Associated tool use ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    /// Usage statistics
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TaskUsage>,
}

/// Main message type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Message {
    /// User message
    User {
        /// Message content
        message: UserMessage,
    },
    /// Assistant message
    Assistant {
        /// Message content
        message: AssistantMessage,
    },
    /// System message
    System {
        /// Subtype of system message
        subtype: String,
        /// Additional data
        data: serde_json::Value,
    },
    /// Result message indicating end of turn
    Result {
        /// Result subtype
        subtype: String,
        /// Duration in milliseconds
        duration_ms: i64,
        /// API duration in milliseconds
        duration_api_ms: i64,
        /// Whether an error occurred
        is_error: bool,
        /// Number of turns
        num_turns: i32,
        /// Session ID
        session_id: String,
        /// Total cost in USD
        #[serde(skip_serializing_if = "Option::is_none")]
        total_cost_usd: Option<f64>,
        /// Usage statistics
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<serde_json::Value>,
        /// Per-model usage metadata emitted by the Claude CLI result payload.
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "modelUsage",
            alias = "modelUsage"
        )]
        model_usage: Option<serde_json::Value>,
        /// Result message
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<String>,
        /// Structured output (when output_format is set)
        /// Contains the validated JSON response matching the schema
        #[serde(skip_serializing_if = "Option::is_none", alias = "structuredOutput")]
        structured_output: Option<serde_json::Value>,
        /// Reason the conversation stopped
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
    },

    /// Stream event from the CLI
    #[serde(rename = "stream_event")]
    StreamEvent {
        /// Unique message ID
        uuid: String,
        /// Session ID
        session_id: String,
        /// Event data
        event: serde_json::Value,
        /// Parent tool use ID (for subagent events)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },

    /// Rate limit notification
    #[serde(rename = "rate_limit")]
    RateLimit {
        /// Rate limit details
        rate_limit_info: RateLimitInfo,
        /// Unique message ID
        uuid: String,
        /// Session ID
        session_id: String,
    },

    /// Unknown message type (forward compatibility)
    /// Not deserialized by serde — constructed by message_parser
    #[serde(skip)]
    Unknown {
        /// Original message type string
        msg_type: String,
        /// Raw JSON data
        raw: serde_json::Value,
    },
}

impl Message {
    /// Try to extract a TaskStartedMessage from a System message
    pub fn as_task_started(&self) -> Option<TaskStartedMessage> {
        if let Message::System { subtype, data } = self {
            if subtype == "task_started" {
                return serde_json::from_value(data.clone()).ok();
            }
        }
        None
    }

    /// Try to extract a TaskProgressMessage from a System message
    pub fn as_task_progress(&self) -> Option<TaskProgressMessage> {
        if let Message::System { subtype, data } = self {
            if subtype == "task_progress" {
                return serde_json::from_value(data.clone()).ok();
            }
        }
        None
    }

    /// Try to extract a TaskNotificationMessage from a System message
    pub fn as_task_notification(&self) -> Option<TaskNotificationMessage> {
        if let Message::System { subtype, data } = self {
            if subtype == "task_notification" {
                return serde_json::from_value(data.clone()).ok();
            }
        }
        None
    }
}

/// User message content
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UserMessage {
    /// Message content
    pub content: String,
}

/// Assistant message content
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AssistantMessage {
    /// Content blocks
    pub content: Vec<ContentBlock>,
    /// Model that generated this message
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Token usage statistics
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<serde_json::Value>,
    /// Error information if the message failed
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<AssistantMessageError>,
    /// Parent tool use ID (for subagent messages)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
}

/// Result message (re-export for convenience)  
pub use Message::Result as ResultMessage;
/// System message (re-export for convenience)
pub use Message::System as SystemMessage;

/// Content block types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ContentBlock {
    /// Text content
    Text(TextContent),
    /// Thinking content
    Thinking(ThinkingContent),
    /// Tool use request
    ToolUse(ToolUseContent),
    /// Tool result
    ToolResult(ToolResultContent),
}

/// Text content block
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextContent {
    /// Text content
    pub text: String,
}

/// Thinking content block
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThinkingContent {
    /// Thinking content
    pub thinking: String,
    /// Signature
    pub signature: String,
}

/// Tool use content block
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolUseContent {
    /// Tool use ID
    pub id: String,
    /// Tool name
    pub name: String,
    /// Tool input parameters
    pub input: serde_json::Value,
}

/// Tool result content block
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolResultContent {
    /// Tool use ID this result corresponds to
    pub tool_use_id: String,
    /// Result content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<ContentValue>,
    /// Whether this is an error result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// Content value for tool results
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ContentValue {
    /// Text content
    Text(String),
    /// Structured content
    Structured(Vec<serde_json::Value>),
}

/// User content structure for internal use
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserContent {
    /// Role (always "user")
    pub role: String,
    /// Message content
    pub content: String,
}

/// Assistant content structure for internal use
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantContent {
    /// Role (always "assistant")
    pub role: String,
    /// Content blocks
    pub content: Vec<ContentBlock>,
}
