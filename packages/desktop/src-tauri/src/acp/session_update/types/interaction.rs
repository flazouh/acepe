use serde::{Deserialize, Serialize};
use specta::Type;

/// Tool reference for permission/question requests.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolReference {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}

/// Question item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
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

/// Semantic todo update operation derived from provider tool calls.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TodoUpdateOperation {
    Replace,
    Upsert,
    SetStatus,
    SetStatusByFilter,
}

/// Canonical todo update payload, independent from provider transport details.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoUpdate {
    pub operation: TodoUpdateOperation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<TodoItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_statuses: Option<Vec<TodoStatus>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_status: Option<TodoStatus>,
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
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_error_code"
    )]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<TurnErrorSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

const PROVIDER_ERROR_MESSAGE_CHARS: usize = 240;
const PROVIDER_ERROR_CODE_CHARS: usize = 120;
const PROVIDER_DIAGNOSTIC_STRING_CHARS: usize = 2_048;
const PROVIDER_DIAGNOSTIC_MAX_DEPTH: usize = 4;
const PROVIDER_DIAGNOSTIC_MAX_ITEMS: usize = 16;
const PROVIDER_DIAGNOSTIC_MAX_CHARS: usize = 8_192;
const PROVIDER_DIAGNOSTIC_TRUNCATED_SUFFIX: &str = "\n[diagnostics truncated]";

impl TurnErrorInfo {
    /// Build a bounded, display-safe canonical failure from provider-controlled JSON.
    #[must_use]
    pub(crate) fn from_provider_error(
        properties: &serde_json::Value,
        kind: TurnErrorKind,
        source: TurnErrorSource,
        fallback_message: &str,
    ) -> Self {
        let error = properties.get("error");
        let error_name = error
            .and_then(|value| value.get("name"))
            .and_then(serde_json::Value::as_str)
            .and_then(|value| normalize_provider_text(value, PROVIDER_ERROR_CODE_CHARS));
        let message = error
            .and_then(|value| value.get("data"))
            .and_then(|value| value.get("message"))
            .and_then(serde_json::Value::as_str)
            .or_else(|| {
                error
                    .and_then(|value| value.get("message"))
                    .and_then(serde_json::Value::as_str)
            })
            .or_else(|| {
                properties
                    .get("message")
                    .and_then(serde_json::Value::as_str)
            })
            .and_then(|value| normalize_provider_text(value, PROVIDER_ERROR_MESSAGE_CHARS))
            .or_else(|| error_name.clone())
            .unwrap_or_else(|| fallback_message.to_string());
        let code =
            extract_provider_error_code(properties, error_name).filter(|value| value != &message);

        Self {
            message,
            kind,
            code,
            source: Some(source),
            details: extract_provider_error_details(properties),
        }
    }
}

fn normalize_provider_text(value: &str, max_chars: usize) -> Option<String> {
    let filtered = value
        .chars()
        .filter(|character| {
            matches!(character, '\n' | '\r' | '\t')
                || (!character.is_control()
                    && !matches!(*character as u32, 0x202A..=0x202E | 0x2066..=0x2069))
        })
        .collect::<String>();
    let trimmed = filtered.trim();
    if trimmed.is_empty() {
        return None;
    }

    let char_count = trimmed.chars().count();
    if char_count <= max_chars {
        return Some(trimmed.to_string());
    }

    let mut truncated = trimmed
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    Some(truncated)
}

fn extract_provider_error_code(
    properties: &serde_json::Value,
    error_name: Option<String>,
) -> Option<String> {
    properties
        .get("error")
        .and_then(|error| error.get("code"))
        .or_else(|| properties.get("code"))
        .and_then(|value| match value {
            serde_json::Value::String(value) => {
                normalize_provider_text(value, PROVIDER_ERROR_CODE_CHARS)
            }
            serde_json::Value::Number(value) => Some(value.to_string()),
            _ => None,
        })
        .or(error_name)
}

fn sanitize_provider_diagnostic(
    value: &serde_json::Value,
    depth: usize,
) -> Option<serde_json::Value> {
    if depth > PROVIDER_DIAGNOSTIC_MAX_DEPTH {
        return Some(serde_json::Value::String(
            "[diagnostics truncated]".to_string(),
        ));
    }

    match value {
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
            Some(value.clone())
        }
        serde_json::Value::String(value) => {
            normalize_provider_text(value, PROVIDER_DIAGNOSTIC_STRING_CHARS)
                .map(serde_json::Value::String)
        }
        serde_json::Value::Array(values) => Some(serde_json::Value::Array(
            values
                .iter()
                .take(PROVIDER_DIAGNOSTIC_MAX_ITEMS)
                .filter_map(|value| sanitize_provider_diagnostic(value, depth + 1))
                .collect(),
        )),
        serde_json::Value::Object(object) => {
            // Dedicated canonical fields already carry the root name, code, and message.
            // Nested causes may retain those same safe facts because they describe another error.
            const ROOT_FIELDS: [&str; 3] = ["type", "status", "cause"];
            const NESTED_FIELDS: [&str; 6] = ["name", "code", "type", "status", "message", "cause"];
            let allowed_fields: &[&str] = if depth == 0 {
                &ROOT_FIELDS
            } else {
                &NESTED_FIELDS
            };
            let sanitized = allowed_fields
                .iter()
                .filter_map(|field| {
                    object
                        .get(*field)
                        .and_then(|value| sanitize_provider_diagnostic(value, depth + 1))
                        .map(|value| ((*field).to_string(), value))
                })
                .collect::<serde_json::Map<String, serde_json::Value>>();
            (!sanitized.is_empty()).then_some(serde_json::Value::Object(sanitized))
        }
    }
}

fn extract_provider_error_details(properties: &serde_json::Value) -> Option<String> {
    let sanitized = sanitize_provider_diagnostic(properties.get("error")?, 0)?;
    let serialized = serde_json::to_string_pretty(&sanitized).ok()?;
    if serialized.chars().count() <= PROVIDER_DIAGNOSTIC_MAX_CHARS {
        return Some(serialized);
    }

    let retained_chars = PROVIDER_DIAGNOSTIC_MAX_CHARS
        .saturating_sub(PROVIDER_DIAGNOSTIC_TRUNCATED_SUFFIX.chars().count());
    let mut truncated = serialized.chars().take(retained_chars).collect::<String>();
    truncated.push_str(PROVIDER_DIAGNOSTIC_TRUNCATED_SUFFIX);
    Some(truncated)
}

fn deserialize_optional_error_code<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(value)) => Ok(Some(value)),
        Some(serde_json::Value::Number(value)) => Ok(Some(value.to_string())),
        Some(_) => Err(serde::de::Error::custom(
            "turn error code must be a string or number",
        )),
    }
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
    /// When set, this telemetry belongs to a spawned sub-agent rather than the
    /// top-level session turn. The id is the parent `Task` tool-call id, used to
    /// aggregate per-sub-agent usage downstream. `None` = session-level telemetry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
}

fn default_telemetry_scope() -> String {
    "step".to_string()
}
