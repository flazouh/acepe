use crate::acp::session_update::ToolCallData;
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::SessionLifecycleState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct HistoryEntry {
    /// Database ID (UUID)
    pub id: String,
    pub display: String,
    pub timestamp: i64,
    pub project: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(default, rename = "pastedContents")]
    pub pasted_contents: serde_json::Value,

    // Additional fields needed by ThreadStore
    #[serde(rename = "agentId")]
    pub agent_id: CanonicalAgentId,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,

    /// Source file path for direct retrieval (JSON transcript, store.db, or state.vscdb)
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "sourcePath"
    )]
    pub source_path: Option<String>,

    /// Parent session ID for subsessions (OpenCode only).
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "parentId")]
    pub parent_id: Option<String>,

    /// Optional worktree path when session operates in a git worktree.
    /// Used for correct path conversion when creating checkpoints.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "worktreePath"
    )]
    pub worktree_path: Option<String>,

    /// Associated pull request number when session references a PR (e.g. from OpenCode).
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "prNumber")]
    pub pr_number: Option<i64>,

    /// Ownership mode for the session-linked PR.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "prLinkMode"
    )]
    pub pr_link_mode: Option<String>,

    /// Whether the worktree path stored for this session no longer exists on disk.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "worktreeDeleted"
    )]
    pub worktree_deleted: Option<bool>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "sessionLifecycleState"
    )]
    pub session_lifecycle_state: Option<SessionLifecycleState>,

    /// Per-project sequence ID for Acepe-native sessions (None for scanned sessions).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "sequenceId"
    )]
    pub sequence_id: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum SessionMessage {
    // Try Message first - it's more specific (requires message field)
    Message(Message),
    // QueueOperation is fallback for entries without message field
    QueueOperation(QueueOperation),
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct QueueOperation {
    #[serde(rename = "type")]
    pub op_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct Message {
    #[serde(rename = "type")]
    pub message_type: String,
    pub message: MessageContent,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub uuid: String,
    #[serde(rename = "parentUuid", skip_serializing_if = "Option::is_none")]
    pub parent_uuid: Option<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(rename = "gitBranch", skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(rename = "isMeta", skip_serializing_if = "Option::is_none")]
    pub is_meta: Option<bool>,
    #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    /// ID of the tool use this meta message is associated with (for skill content)
    #[serde(rename = "sourceToolUseID", skip_serializing_if = "Option::is_none")]
    pub source_tool_use_id: Option<String>,
}

/// Token usage statistics from API response
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct TokenUsage {
    #[serde(default)]
    pub input_tokens: i64,
    #[serde(default)]
    pub output_tokens: i64,
    #[serde(rename = "cache_read_input_tokens", default)]
    pub cache_read_tokens: i64,
    #[serde(rename = "cache_creation_input_tokens", default)]
    pub cache_creation_tokens: i64,
}

/// Full session data with ordered messages and metadata
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct FullSession {
    pub session_id: String,
    pub project_path: String,
    pub title: String,
    pub created_at: String,
    pub messages: Vec<OrderedMessage>,
    pub stats: SessionStats,
}

/// A message with ordering and full content
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct OrderedMessage {
    pub uuid: String,
    pub parent_uuid: Option<String>,
    pub role: String,
    pub timestamp: String,
    pub content_blocks: Vec<ContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub is_meta: bool,
    /// ID of the tool use this meta message is associated with (for skill content)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_tool_use_id: Option<String>,
    /// Tool use result data (for user messages that are tool results)
    /// Contains questions and answers for AskUserQuestion tool
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_result: Option<serde_json::Value>,
    /// UUID of the assistant message containing the tool use that this result is for
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_tool_assistant_uuid: Option<String>,
}

/// Statistics about the session
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct SessionStats {
    pub total_messages: usize,
    pub user_messages: usize,
    pub assistant_messages: usize,
    pub tool_uses: usize,
    pub tool_results: usize,
    pub thinking_blocks: usize,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct MessageContent {
    pub role: String,
    #[serde(deserialize_with = "deserialize_content")]
    pub content: Vec<ContentBlock>,
}

/// Deserializes content field which can be either a string or an array of ContentBlocks
fn deserialize_content<'de, D>(deserializer: D) -> Result<Vec<ContentBlock>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};
    use std::fmt;

    struct ContentVisitor;

    impl<'de> Visitor<'de> for ContentVisitor {
        type Value = Vec<ContentBlock>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a string or an array of content blocks")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            // Convert string to a Text ContentBlock
            Ok(vec![ContentBlock::Text {
                text: value.to_string(),
            }])
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            let mut vec = Vec::new();
            while let Some(elem) = seq.next_element()? {
                vec.push(elem);
            }
            Ok(vec)
        }
    }

    deserializer.deserialize_any(ContentVisitor)
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        signature: Option<String>,
    },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        #[serde(alias = "arguments")]
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        #[serde(deserialize_with = "deserialize_tool_result_content")]
        content: String,
    },
    /// Code attachment from Cursor transcripts.
    /// Represents attached code from `<code_selection>` blocks.
    #[serde(rename = "code_attachment")]
    CodeAttachment {
        /// The file path of the attached code
        path: String,
        /// The line range (e.g., "1-10")
        #[serde(skip_serializing_if = "Option::is_none")]
        lines: Option<String>,
        /// The actual code content
        content: String,
    },
}

/// Deserializes tool_result content which can be a string or an array
fn deserialize_tool_result_content<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};
    use std::fmt;

    struct ContentVisitor;

    impl<'de> Visitor<'de> for ContentVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a string or an array of content blocks")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            // For arrays, concatenate text from all blocks
            let mut result = String::new();
            while let Some(elem) = seq.next_element::<serde_json::Value>()? {
                if let Some(text) = elem.get("text").and_then(|v| v.as_str()) {
                    if !result.is_empty() {
                        result.push('\n');
                    }
                    result.push_str(text);
                }
            }
            Ok(result)
        }
    }

    deserializer.deserialize_any(ContentVisitor)
}

// ============================================
// STORED ENTRY TYPES
// ============================================
// These types represent the canonical storage format for session entries.

/// A content block in a user or assistant message.
/// Simplified version for storage/display.
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct StoredContentBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// A chunk of assistant message content (text or thought).
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct StoredAssistantChunk {
    #[serde(rename = "type")]
    pub chunk_type: String, // "message" or "thought"
    pub block: StoredContentBlock,
}

/// User message in a thread (simplified for storage).
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct StoredUserMessage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub content: StoredContentBlock,
    pub chunks: Vec<StoredContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sentAt")]
    pub sent_at: Option<String>,
}

/// Assistant message in a thread (simplified for storage).
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct StoredAssistantMessage {
    pub chunks: Vec<StoredAssistantChunk>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// User-friendly display name for the model (e.g., "Opus 4.5" instead of "claude-opus-4-5-20251101")
    #[serde(skip_serializing_if = "Option::is_none", rename = "displayModel")]
    pub display_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "receivedAt")]
    pub received_at: Option<String>,
}

/// Error entry stored in replayed session history.
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct StoredErrorMessage {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub kind: crate::acp::session_update::TurnErrorKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<crate::acp::session_update::TurnErrorSource>,
}

/// Answered question data from toolUseResult field in JSONL.
/// Stores both the questions and the user's answers.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuestionAnswer {
    /// The questions that were asked
    pub questions: Vec<crate::acp::session_update::QuestionItem>,
    /// Map of question text to answer(s) - value is string for single-select, array for multi-select
    pub answers: std::collections::HashMap<String, serde_json::Value>,
}

/// A single entry in the thread.
/// Discriminated union tagged by "type".
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum StoredEntry {
    User {
        id: String,
        message: StoredUserMessage,
        #[serde(skip_serializing_if = "Option::is_none")]
        timestamp: Option<String>,
    },
    Assistant {
        id: String,
        message: StoredAssistantMessage,
        #[serde(skip_serializing_if = "Option::is_none")]
        timestamp: Option<String>,
    },
    #[serde(rename = "tool_call")]
    ToolCall {
        id: String,
        message: ToolCallData,
        #[serde(skip_serializing_if = "Option::is_none")]
        timestamp: Option<String>,
    },
    Error {
        id: String,
        message: StoredErrorMessage,
        #[serde(skip_serializing_if = "Option::is_none")]
        timestamp: Option<String>,
    },
}

/// Response wrapper for get_startup_sessions.
///
/// Carries the hydrated session entries plus a mapping from any requested
/// alias IDs (provider_session_id values) to their canonical Acepe session IDs.
/// This allows the frontend to remap panel session references before validation.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StartupSessionsResponse {
    pub entries: Vec<HistoryEntry>,
    /// Maps requested alias ID -> canonical session ID for sessions that were
    /// matched by `provider_session_id` rather than the primary `id`.
    pub alias_remaps: std::collections::HashMap<String, String>,
}

/// Response for session plan request.
/// Returned by get_session_plan, get_plan_by_slug, list_plans commands.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionPlanResponse {
    /// Plan slug (filename without .md extension).
    pub slug: String,
    /// Full markdown content of the plan.
    pub content: String,
    /// Plan title (extracted from first # heading).
    pub title: String,
    /// Plan summary (first paragraph after title, if any).
    pub summary: Option<String>,
    /// Full file path to the plan file (for revealing in file manager).
    pub file_path: Option<String>,
}
