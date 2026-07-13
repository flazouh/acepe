//! Cursor history types.
//!
//! These types represent Cursor's internal storage format.
//! We reuse session_jsonl types for the output format (FullSession, OrderedMessage, etc.)
//! to maintain consistency with the frontend.

use serde::{Deserialize, Serialize};

/// Cursor workspace information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorWorkspace {
    /// Workspace hash (directory name in workspaceStorage)
    pub hash: String,
    /// Resolved path to the workspace folder
    pub folder_path: Option<String>,
    /// Path to the workspace's state.vscdb
    pub db_path: String,
}

/// Raw chat entry from Cursor's SQLite storage.
/// This represents a single conversation stored in the composerChatViewPane keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorChatEntry {
    /// Chat ID (UUID from the key)
    pub id: String,
    /// Chat title or first message excerpt
    pub title: Option<String>,
    /// Workspace path this chat belongs to
    pub workspace_path: Option<String>,
    /// Creation timestamp (if available)
    pub created_at: Option<i64>,
    /// Last update timestamp
    pub updated_at: Option<i64>,
    /// Number of messages
    pub message_count: usize,
    /// Source path (store.db for SQLite, transcript path for JSON, state.vscdb for workspace)
    #[serde(default)]
    pub source_path: Option<String>,
}

/// Raw message from Cursor's chat storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorMessage {
    /// Role: "user" or "assistant"
    pub role: String,
    /// Message content (could be text or structured)
    pub content: CursorMessageContent,
    /// Optional model name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Timestamp when this message was created
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

/// Content of a Cursor message.
/// Cursor can store content as plain text or as structured content blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CursorMessageContent {
    /// Plain text content
    Text(String),
    /// Array of content blocks (similar to Claude API format)
    Blocks(Vec<CursorContentBlock>),
}

impl CursorMessageContent {
    /// Extract text from the content, handling both formats.
    pub fn as_text(&self) -> String {
        match self {
            CursorMessageContent::Text(s) => s.clone(),
            CursorMessageContent::Blocks(blocks) => blocks
                .iter()
                .filter_map(|b| match b {
                    CursorContentBlock::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }
}

/// Content block in a Cursor message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CursorContentBlock {
    /// Text content
    Text { text: String },
    /// Tool use request
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: serde_json::Value,
    },
    /// Tool result
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
    },
    /// Thinking block (if Cursor supports extended thinking)
    Thinking {
        thinking: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        signature: Option<String>,
    },
}

/// Cursor conversation (full chat with messages).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorConversation {
    /// Conversation ID
    pub id: String,
    /// Title (from Claude's summary or first user message)
    pub title: String,
    /// All messages in order
    pub messages: Vec<CursorMessage>,
    /// Workspace/project path
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    /// Creation timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    /// Last update timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

/// Statistics about database access.
#[derive(Debug, Clone, Default)]
pub struct CursorDbStats {
    /// Number of chats discovered
    pub chats_found: usize,
    /// Number of chats successfully parsed
    pub chats_parsed: usize,
    /// Number of parse errors
    pub parse_errors: usize,
    /// Whether the database was locked
    pub was_locked: bool,
}
