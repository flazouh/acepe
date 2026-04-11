use serde::{Deserialize, Serialize};
use specta::Type;

/// Tool reference for permission/question requests.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolReference {
    pub message_id: String,
    pub call_id: String,
}

/// Explicit reply routing metadata for a canonical interaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InteractionReplyHandlerKind {
    JsonRpc,
    Http,
}

/// Backend-owned reply handler metadata for interaction replies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InteractionReplyHandler {
    pub kind: InteractionReplyHandlerKind,
    pub request_id: String,
}

impl InteractionReplyHandler {
    #[must_use]
    pub fn json_rpc(request_id: u64) -> Self {
        Self {
            kind: InteractionReplyHandlerKind::JsonRpc,
            request_id: request_id.to_string(),
        }
    }

    #[must_use]
    pub fn http(request_id: impl Into<String>) -> Self {
        Self {
            kind: InteractionReplyHandlerKind::Http,
            request_id: request_id.into(),
        }
    }
}

/// Permission request data.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PermissionData {
    pub id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_rpc_request_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_handler: Option<InteractionReplyHandler>,
    pub permission: String,
    pub patterns: Vec<String>,
    pub metadata: serde_json::Value,
    pub always: Vec<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub auto_accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolReference>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Question option.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}

/// Question item.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QuestionItem {
    pub question: String,
    pub header: String,
    pub options: Vec<QuestionOption>,
    pub multi_select: bool,
}

/// Question request data.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QuestionData {
    pub id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_rpc_request_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_handler: Option<InteractionReplyHandler>,
    pub questions: Vec<QuestionItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolReference>,
}

/// Todo item status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

/// Todo item.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub content: String,
    pub active_form: String,
    pub status: TodoStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
}

/// Turn error severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TurnErrorKind {
    Recoverable,
    Fatal,
}

/// Turn error source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TurnErrorSource {
    JsonRpc,
    Transport,
    Process,
    Unknown,
}

/// Structured turn error payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TurnErrorInfo {
    pub message: String,
    pub kind: TurnErrorKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<TurnErrorSource>,
}

/// Turn error payload for compatibility during rollout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum TurnErrorData {
    Legacy(String),
    Structured(TurnErrorInfo),
}

/// Token counts for usage telemetry (generic, adapter-agnostic).
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UsageTelemetryTokens {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<u64>,
}

/// Payload for usage telemetry session update (generic, not provider-specific).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UsageTelemetryData {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    /// Scope of the telemetry (e.g. "step", later "turn").
    #[serde(default = "default_telemetry_scope")]
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(default)]
    pub tokens: UsageTelemetryTokens,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<i64>,
    /// Context window size reported by the agent (e.g. from usage_update `size` field).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_size: Option<u64>,
}

fn default_telemetry_scope() -> String {
    "step".to_string()
}
