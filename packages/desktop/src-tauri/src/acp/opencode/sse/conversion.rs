use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

use crate::acp::parsers::{AgentParser, AgentType, OpenCodeParser};
use crate::acp::session_update::{
    parse_normalized_questions, parse_normalized_todos, ContentChunk, PermissionData, QuestionData,
    QuestionItem, QuestionOption, SessionUpdate, TodoItem, ToolArguments, ToolCallData,
    ToolCallStatus, ToolCallUpdateData, ToolKind, TurnErrorData, TurnErrorInfo, TurnErrorKind,
    TurnErrorSource, UsageTelemetryData, UsageTelemetryTokens,
};
use crate::acp::types::ContentBlock;

pub(super) enum PartConversionResult {
    Converted(Box<SessionUpdate>),
    Filtered(PartFilterReason),
    Failed(String),
}

#[cfg(test)]
impl PartConversionResult {
    pub(super) fn is_some(&self) -> bool {
        matches!(self, Self::Converted(_))
    }

    pub(super) fn is_none(&self) -> bool {
        !self.is_some()
    }

    pub(super) fn unwrap(self) -> SessionUpdate {
        match self {
            Self::Converted(update) => *update,
            Self::Filtered(reason) => panic!("called unwrap on Filtered result: {:?}", reason),
            Self::Failed(error) => panic!("called unwrap on Failed result: {}", error),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum PartFilterReason {
    StopReason,
    UserMessage,
    EmptyPart,
}

/// Maximum cache entries before eviction to prevent unbounded memory growth.
const MAX_CACHE_ENTRIES: usize = 10_000;
pub(super) const SSE_RECONNECT_BASE_DELAY_MS: u64 = 250;
pub(super) const SSE_RECONNECT_MAX_DELAY_MS: u64 = 10_000;
pub(super) const SSE_RECONNECT_JITTER_MS: u64 = 200;
pub(super) const SSE_MAX_CONSECUTIVE_READ_ERRORS: u32 = 5;

/// Global cache for message roles to track role consistency across SSE events.
/// OpenCode SSE events may not include the `role` field for all message parts.
/// This cache allows us to look up the role for a message_id when it's not provided.
/// Key: message_id (String), Value: role ("user" | "assistant")
static MESSAGE_ROLE_CACHE: LazyLock<RwLock<HashMap<String, String>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// Global cache for message part text to dedupe full-text snapshots after deltas.
/// Key: part_id (String), Value: last full text snapshot (String)
static MESSAGE_PART_TEXT_CACHE: LazyLock<RwLock<HashMap<String, String>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// Set the role for a specific message_id (used when role is explicitly provided)
fn set_message_role(message_id: &str, role: &str) {
    let mut cache = match MESSAGE_ROLE_CACHE.write() {
        Ok(cache) => cache,
        Err(error) => {
            tracing::error!(%error, "MESSAGE_ROLE_CACHE lock poisoned while setting message role");
            return;
        }
    };

    // Evict if cache exceeds limit to prevent unbounded growth
    if cache.len() >= MAX_CACHE_ENTRIES {
        tracing::warn!(
            cache_size = cache.len(),
            max_size = MAX_CACHE_ENTRIES,
            "MESSAGE_ROLE_CACHE exceeded limit, clearing to prevent memory growth"
        );
        cache.clear();
    }

    cache.insert(message_id.to_string(), role.to_string());
}

pub(super) fn cache_message_role_from_update(_properties: &Value) -> Option<()> {
    let info = _properties.get("info")?;
    let message_id = info.get("id")?.as_str()?;
    let role = info.get("role")?.as_str()?;
    set_message_role(message_id, role);
    Some(())
}

fn resolve_text_delta(
    part_id: &str,
    delta: Option<&str>,
    full_text: Option<&str>,
) -> Option<String> {
    let mut cache = match MESSAGE_PART_TEXT_CACHE.write() {
        Ok(cache) => cache,
        Err(error) => {
            tracing::error!(%error, "MESSAGE_PART_TEXT_CACHE lock poisoned while resolving text delta");
            return full_text
                .map(|text| text.to_string())
                .or_else(|| delta.map(|text| text.to_string()));
        }
    };

    // Evict if cache exceeds limit to prevent unbounded growth
    if cache.len() >= MAX_CACHE_ENTRIES {
        tracing::warn!(
            cache_size = cache.len(),
            max_size = MAX_CACHE_ENTRIES,
            "MESSAGE_PART_TEXT_CACHE exceeded limit, clearing to prevent memory growth"
        );
        cache.clear();
    }

    let cached = cache.get(part_id).cloned();

    if let Some(delta_text) = delta {
        let next_text = if let Some(full) = full_text {
            full.to_string()
        } else if let Some(prev) = cached {
            let mut next = prev;
            next.push_str(delta_text);
            next
        } else {
            delta_text.to_string()
        };
        cache.insert(part_id.to_string(), next_text);
        return Some(delta_text.to_string());
    }

    if let Some(full) = full_text {
        if let Some(prev) = cached {
            if full == prev {
                return None;
            }
            if let Some(suffix) = full.strip_prefix(&prev) {
                cache.insert(part_id.to_string(), full.to_string());
                return if suffix.is_empty() {
                    None
                } else {
                    Some(suffix.to_string())
                };
            }
        }

        cache.insert(part_id.to_string(), full.to_string());
        return Some(full.to_string());
    }

    None
}

/// Clear all cached roles (call when starting a new session)
pub(super) fn clear_message_role_cache() {
    if let Ok(mut cache) = MESSAGE_ROLE_CACHE.write() {
        cache.clear();
    } else {
        tracing::error!("MESSAGE_ROLE_CACHE lock poisoned while clearing role cache");
    }
    clear_message_part_text_cache();
}

/// Clear all cached message part text (call when starting a new session)
pub(super) fn clear_message_part_text_cache() {
    if let Ok(mut cache) = MESSAGE_PART_TEXT_CACHE.write() {
        cache.clear();
    } else {
        tracing::error!("MESSAGE_PART_TEXT_CACHE lock poisoned while clearing text cache");
    }
}

/// Clear cached roles across all sessions.
pub(super) fn clear_all_message_roles() {
    if let Ok(mut cache) = MESSAGE_ROLE_CACHE.write() {
        cache.clear();
    } else {
        tracing::error!("MESSAGE_ROLE_CACHE lock poisoned while clearing all roles");
    }
    clear_message_part_text_cache();
}

/// Extract normalized todos/questions from OpenCode tool input based on tool kind.
///
/// OpenCode sends full tool input in the `running` state, so we can extract
/// structured data immediately without needing a streaming accumulator.
fn extract_normalized_data(
    tool_kind: ToolKind,
    tool_name: &str,
    tool_input: &Value,
) -> (Option<Vec<TodoItem>>, Option<Vec<QuestionItem>>) {
    match tool_kind {
        ToolKind::Todo => {
            let todos = parse_normalized_todos(tool_name, tool_input, AgentType::OpenCode);
            (todos, None)
        }
        ToolKind::Question => {
            let questions = parse_normalized_questions(tool_name, tool_input, AgentType::OpenCode);
            (None, questions)
        }
        _ => (None, None),
    }
}

fn parse_opencode_tool_arguments(tool_name: &str, tool_input: &Value) -> ToolArguments {
    OpenCodeParser
        .parse_typed_tool_arguments(Some(tool_name), tool_input, None)
        .unwrap_or(ToolArguments::Other {
            raw: tool_input.clone(),
        })
}

fn resolve_opencode_tool_kind(tool_name: &str, arguments: &ToolArguments) -> ToolKind {
    let detected_kind = OpenCodeParser.detect_tool_kind(tool_name);
    let argument_kind = arguments.tool_kind();
    // When arguments were upgraded (e.g. Fetch URL → WebSearch), prefer argument_kind.
    // Otherwise prefer detected_kind for specificity (e.g. Task vs Think).
    if argument_kind == ToolKind::WebSearch && detected_kind == ToolKind::Fetch {
        argument_kind
    } else if detected_kind != ToolKind::Other {
        detected_kind
    } else {
        argument_kind
    }
}

/// Event envelope for SSE events
#[derive(Debug, Deserialize)]
pub(super) struct EventEnvelope {
    #[serde(rename = "type")]
    pub(super) event_type: String,
    #[serde(default)]
    pub(super) properties: Value,
}

/// Multiplexed event envelope (with directory scope)
#[derive(Debug, Deserialize)]
pub(super) struct MultiplexedEventEnvelope {
    #[serde(default)]
    #[allow(dead_code)]
    pub(super) directory: Option<String>,
    pub(super) payload: EventEnvelope,
}

/// OpenCode SSE event properties for message.part.updated
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageInfo {
    #[serde(default)]
    role: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagePartUpdatedEvent {
    part: OpenCodePart,
    #[serde(default)]
    delta: Option<String>,
    #[serde(default)]
    info: Option<MessageInfo>,
    #[serde(default)]
    role: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodePart {
    id: String,
    #[serde(rename = "sessionID")]
    session_id: String,
    #[serde(rename = "messageID")]
    message_id: String,
    #[serde(rename = "type", default)]
    part_type: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default, rename = "callID")]
    call_id: Option<String>,
    #[serde(default, alias = "arguments")]
    input: Option<Value>,
    #[serde(default)]
    state: Option<OpenCodeToolState>,
    /// Step/turn cost in USD (e.g. on step-finish or completion).
    #[serde(default)]
    cost: Option<f64>,
    /// Token counts (e.g. on step-finish). Shape: { total, input, output, cacheRead, cacheWrite, reasoning }.
    #[serde(default)]
    tokens: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeToolState {
    status: String,
    #[serde(default)]
    input: Option<Value>,
    #[serde(default)]
    output: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    metadata: Option<Value>,
}

/// OpenCode SSE event for question.asked
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuestionAskedEvent {
    id: String,
    #[serde(rename = "sessionID")]
    session_id: String,
    questions: Vec<OpenCodeQuestion>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeQuestion {
    question: String,
    header: String,
    options: Vec<OpenCodeQuestionOption>,
    #[serde(default)]
    multi_select: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeQuestionOption {
    label: String,
    description: String,
}

/// OpenCode SSE event for permission.asked
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionAskedEvent {
    id: String,
    #[serde(rename = "sessionID")]
    session_id: String,
    permission: String,
    #[serde(default)]
    patterns: Vec<String>,
    #[serde(default)]
    metadata: Value,
    #[serde(default)]
    always: Vec<String>,
}

/// Map OpenCode part.tokens (JSON object) to standardized UsageTelemetryTokens.
/// OpenCode sends flat keys (input, output, total) and nested tokens.cache.read / tokens.cache.write.
fn parse_opencode_tokens_to_telemetry(value: &Value) -> UsageTelemetryTokens {
    let obj = match value.as_object() {
        Some(o) => o,
        None => return UsageTelemetryTokens::default(),
    };
    let u64_key = |k: &str| obj.get(k).and_then(|v| v.as_u64());
    let cache_read = u64_key("cache_read")
        .or_else(|| u64_key("cacheRead"))
        .or_else(|| {
            obj.get("cache")
                .and_then(|c| c.get("read"))
                .and_then(|v| v.as_u64())
        });
    let cache_write = u64_key("cache_write")
        .or_else(|| u64_key("cacheWrite"))
        .or_else(|| {
            obj.get("cache")
                .and_then(|c| c.get("write"))
                .and_then(|v| v.as_u64())
        });
    UsageTelemetryTokens {
        total: u64_key("total").or_else(|| u64_key("total_tokens")),
        input: u64_key("input").or_else(|| u64_key("input_tokens")),
        output: u64_key("output").or_else(|| u64_key("output_tokens")),
        cache_read,
        cache_write,
        reasoning: u64_key("reasoning").or_else(|| u64_key("reasoning_tokens")),
    }
}

fn map_tool_status(status: &str) -> ToolCallStatus {
    match status {
        "completed" => ToolCallStatus::Completed,
        "error" => ToolCallStatus::Failed,
        "running" => ToolCallStatus::InProgress,
        _ => ToolCallStatus::Pending,
    }
}

fn parse_task_children_from_metadata(
    parent_id: &str,
    metadata: &Option<Value>,
) -> Option<Vec<ToolCallData>> {
    let summary = metadata.as_ref()?.get("summary")?.as_array()?;
    if summary.is_empty() {
        return None;
    }

    let mut children = Vec::with_capacity(summary.len());
    for (index, item) in summary.iter().enumerate() {
        let tool_name = item.get("tool").and_then(|v| v.as_str()).unwrap_or("Tool");
        let state = item.get("state");
        let title = state
            .and_then(|s| s.get("title"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let status = state
            .and_then(|s| s.get("status"))
            .and_then(|v| v.as_str())
            .unwrap_or("pending");

        // Extract input from state.input for proper argument parsing
        let tool_input = state
            .and_then(|s| s.get("input"))
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default()));

        let arguments = parse_opencode_tool_arguments(tool_name, &tool_input);
        let tool_kind = resolve_opencode_tool_kind(tool_name, &arguments);
        let (normalized_todos, normalized_questions) =
            extract_normalized_data(tool_kind, tool_name, &tool_input);

        children.push(ToolCallData {
            id: format!("{parent_id}:summary-{index}"),
            name: tool_name.to_string(),
            arguments,
            status: map_tool_status(status),
            result: None,
            kind: Some(tool_kind),
            title,
            locations: None,
            skill_meta: None,
            normalized_questions,
            normalized_todos,
            parent_tool_use_id: Some(parent_id.to_string()),
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        });
    }

    Some(children)
}

/// Convert OpenCode message.part.updated event to SessionUpdate
pub(super) fn convert_message_part_to_session_update(properties: &Value) -> PartConversionResult {
    let event: MessagePartUpdatedEvent = match serde_json::from_value(properties.clone()) {
        Ok(e) => e,
        Err(e) => return PartConversionResult::Failed(e.to_string()),
    };
    let part = event.part;

    if part.reason.as_deref() == Some("stop") {
        return PartConversionResult::Filtered(PartFilterReason::StopReason);
    }

    // Handle step-finish: emit standardized usage telemetry for spend/context UI
    if part.part_type.as_deref() == Some("step-finish") {
        let tokens = part
            .tokens
            .as_ref()
            .map(parse_opencode_tokens_to_telemetry)
            .unwrap_or_default();
        let data = UsageTelemetryData {
            session_id: part.session_id.clone(),
            event_id: Some(part.id.clone()),
            scope: "step".to_string(),
            cost_usd: part.cost,
            tokens,
            source_model_id: None,
            timestamp_ms: None,
            context_window_size: None,
        };
        return PartConversionResult::Converted(Box::new(SessionUpdate::UsageTelemetryUpdate {
            data,
        }));
    }

    // Resolve role for this message part
    // OpenCode SSE events may not include the `role` field for all message parts.
    // We use a cache to maintain role consistency across parts of the same message.
    let incoming_role = event
        .info
        .as_ref()
        .and_then(|i| i.role.as_deref())
        .or(event.role.as_deref())
        .or(part.role.as_deref());

    // Resolve role for this message part
    // OpenCode SSE events may not include the `role` field for all message parts.
    // We use a cache to maintain role consistency across parts of the same message.
    let resolved_role: Option<String> = {
        match MESSAGE_ROLE_CACHE.write() {
            Ok(mut cache) => {
                // If we have an incoming role, cache it for this message_id
                if let Some(role) = incoming_role {
                    cache.insert(part.message_id.clone(), role.to_string());
                    Some(role.to_string())
                } else {
                    // Fallback: look up cached role for this message_id (clone to extend lifetime)
                    cache.get(&part.message_id).cloned()
                }
            }
            Err(error) => {
                tracing::error!(%error, "MESSAGE_ROLE_CACHE lock poisoned while resolving role");
                incoming_role.map(|role| role.to_string())
            }
        }
    };

    let part_type = part.part_type.as_deref().unwrap_or("");

    // Filter user text/reasoning parts (matching OpenChamber behavior)
    if resolved_role.as_deref() == Some("user")
        && matches!(part_type, "text" | "step-start" | "reasoning")
    {
        tracing::trace!(
            message_id = %part.message_id,
            part_id = %part.id,
            role = "user",
            "Filtering user message part"
        );
        return PartConversionResult::Filtered(PartFilterReason::UserMessage);
    }

    match part_type {
        "text" | "step-start" => {
            let text =
                match resolve_text_delta(&part.id, event.delta.as_deref(), part.text.as_deref()) {
                    Some(t) => t,
                    None => return PartConversionResult::Filtered(PartFilterReason::EmptyPart),
                };
            PartConversionResult::Converted(Box::new(SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text { text },
                },
                part_id: None,
                message_id: Some(part.message_id),
                session_id: Some(part.session_id),
            }))
        }

        "reasoning" => {
            let text =
                match resolve_text_delta(&part.id, event.delta.as_deref(), part.text.as_deref()) {
                    Some(t) => t,
                    None => return PartConversionResult::Filtered(PartFilterReason::EmptyPart),
                };
            PartConversionResult::Converted(Box::new(SessionUpdate::AgentThoughtChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text { text },
                },
                part_id: None,
                message_id: Some(part.message_id),
                session_id: Some(part.session_id),
            }))
        }

        "tool" | "tool-invocation" => {
            let tool_name = part.tool.clone().or(part.name.clone()).unwrap_or_default();
            let tool_call_id = part.call_id.clone().unwrap_or_else(|| part.id.clone());
            let state_status = part.state.as_ref().map(|s| s.status.as_str());
            let state_input = part.state.as_ref().and_then(|s| s.input.clone());
            let state_output = part.state.as_ref().and_then(|s| s.output.clone());
            let state_error = part.state.as_ref().and_then(|s| s.error.clone());
            let state_metadata = part.state.as_ref().and_then(|s| s.metadata.clone());
            let tool_input = state_input
                .clone()
                .or(part.input.clone())
                .unwrap_or_else(|| Value::Object(Default::default()));

            let log_tool_call_id = tool_call_id.clone();
            let log_tool_name = tool_name.clone();

            tracing::debug!(
                part_id = %part.id,
                call_id = ?part.call_id,
                tool_name = %log_tool_name,
                tool_call_id = %log_tool_call_id,
                state_status = ?state_status,
                has_state_input = state_input.is_some(),
                has_state_output = state_output.is_some(),
                output_length = state_output.as_ref().map(|s| s.len()).unwrap_or(0),
                has_error = state_error.is_some(),
                "RECEIVED TOOL INVOCATION"
            );

            let arguments = parse_opencode_tool_arguments(&tool_name, &tool_input);
            let tool_kind = resolve_opencode_tool_kind(&tool_name, &arguments);

            match state_status {
                Some("completed") => {
                    let result = state_output.map(Value::String);
                    // Extract normalized data from tool input on completion
                    let (normalized_todos, normalized_questions) =
                        extract_normalized_data(tool_kind, &tool_name, &tool_input);
                    tracing::debug!(
                        tool_call_id = %log_tool_call_id,
                        tool_name = %log_tool_name,
                        result_length = result.as_ref().map(|v| v.as_str().map(|s| s.len()).unwrap_or(0)).unwrap_or(0),
                        has_normalized_todos = normalized_todos.is_some(),
                        "EMITTING TOOL CALL UPDATE (completed)"
                    );
                    PartConversionResult::Converted(Box::new(SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id,
                            status: Some(ToolCallStatus::Completed),
                            result,
                            content: None,
                            raw_output: None,
                            title: None,
                            locations: None,
                            streaming_input_delta: None,
                            normalized_todos,
                            normalized_questions,
                            streaming_arguments: None,
                            streaming_plan: None,
                            arguments: None,
                            failure_reason: None,
                        },
                        session_id: Some(part.session_id),
                    }))
                }
                Some("error") => {
                    let result = state_error.map(Value::String);
                    tracing::debug!(
                        tool_call_id = %log_tool_call_id,
                        tool_name = %log_tool_name,
                        "EMITTING TOOL CALL UPDATE (error)"
                    );
                    PartConversionResult::Converted(Box::new(SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id,
                            status: Some(ToolCallStatus::Failed),
                            result,
                            content: None,
                            raw_output: None,
                            title: None,
                            locations: None,
                            streaming_input_delta: None,
                            normalized_todos: None,
                            normalized_questions: None,
                            streaming_arguments: None,
                            streaming_plan: None,
                            arguments: None,
                            failure_reason: None,
                        },
                        session_id: Some(part.session_id),
                    }))
                }
                _ => {
                    let is_task_tool = tool_name.to_lowercase().contains("task");
                    let task_children = if is_task_tool {
                        parse_task_children_from_metadata(&tool_call_id, &state_metadata)
                    } else {
                        None
                    };
                    let (normalized_todos, normalized_questions) =
                        extract_normalized_data(tool_kind, &tool_name, &tool_input);
                    let tool_call = ToolCallData {
                        id: tool_call_id,
                        name: tool_name.clone(),
                        arguments,
                        status: ToolCallStatus::Pending,
                        kind: Some(tool_kind),
                        result: None,
                        title: None,
                        locations: None,
                        skill_meta: None,
                        normalized_questions,
                        normalized_todos,
                        parent_tool_use_id: None,
                        task_children,
                        question_answer: None,
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    };
                    tracing::debug!(
                        tool_call_id = %log_tool_call_id,
                        tool_name = %log_tool_name,
                        "EMITTING TOOL CALL"
                    );
                    PartConversionResult::Converted(Box::new(SessionUpdate::ToolCall {
                        tool_call,
                        session_id: Some(part.session_id),
                    }))
                }
            }
        }

        "tool-result" => {
            let tool_call_id = part.call_id.clone().unwrap_or_else(|| part.id.clone());
            let result = part
                .state
                .as_ref()
                .and_then(|s| s.output.as_ref())
                .map(|o| Value::String(o.clone()));

            tracing::debug!(
                part_id = %part.id,
                call_id = ?part.call_id,
                tool_call_id = %tool_call_id,
                has_result = result.is_some(),
                result_length = result.as_ref().map(|v| v.as_str().map(|s| s.len()).unwrap_or(0)).unwrap_or(0),
                "RECEIVED TOOL RESULT"
            );
            tracing::debug!(
                tool_call_id = %tool_call_id,
                "EMITTING TOOL CALL UPDATE (tool-result)"
            );

            PartConversionResult::Converted(Box::new(SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id,
                    status: Some(ToolCallStatus::Completed),
                    result,
                    content: None,
                    raw_output: None,
                    title: None,
                    locations: None,
                    streaming_input_delta: None,
                    normalized_todos: None,
                    normalized_questions: None,
                    streaming_arguments: None,
                    streaming_plan: None,
                    arguments: None,
                    failure_reason: None,
                },
                session_id: Some(part.session_id),
            }))
        }

        _ => {
            let has_state = part.state.is_some();
            let state_status = part.state.as_ref().map(|s| s.status.clone());
            let state_output = part.state.as_ref().and_then(|s| s.output.clone());

            tracing::trace!(
                part_id = %part.id,
                session_id = %part.session_id,
                part_type = ?part.part_type,
                has_state = has_state,
                state_status = ?state_status,
                has_state_output = state_output.is_some(),
                "UNHANDLED PART TYPE"
            );

            if let Some(text) = part.text {
                if !text.is_empty() {
                    let text_content = event
                        .delta
                        .as_ref()
                        .or(Some(&text))
                        .cloned()
                        .unwrap_or_default();
                    return PartConversionResult::Converted(Box::new(
                        SessionUpdate::AgentMessageChunk {
                            chunk: ContentChunk {
                                content: ContentBlock::Text { text: text_content },
                            },
                            part_id: Some(part.id),
                            message_id: Some(part.message_id),
                            session_id: Some(part.session_id),
                        },
                    ));
                }
            }
            PartConversionResult::Filtered(PartFilterReason::EmptyPart)
        }
    }
}

/// Convert OpenCode session.status event to SessionUpdate
pub(super) fn convert_session_status_to_session_update(
    properties: &Value,
) -> Option<SessionUpdate> {
    let session_id = properties
        .get("sessionID")
        .or_else(|| properties.get("sessionId"))
        .and_then(Value::as_str)?
        .to_string();

    let status = properties
        .get("status")
        .and_then(|s| s.get("state").or_else(|| s.get("type")))
        .and_then(Value::as_str)?;

    match status {
        "idle" => Some(SessionUpdate::TurnComplete {
            session_id: Some(session_id),
        }),
        _ => None,
    }
}

/// Convert OpenCode session.idle event to SessionUpdate
pub(super) fn convert_session_idle_to_session_update(properties: &Value) -> Option<SessionUpdate> {
    let session_id = properties
        .get("sessionID")
        .or_else(|| properties.get("sessionId"))
        .and_then(Value::as_str)?;
    Some(SessionUpdate::TurnComplete {
        session_id: Some(session_id.to_string()),
    })
}

fn extract_session_error_message(properties: &Value) -> Option<String> {
    let message = properties
        .get("error")
        .and_then(|error| {
            error
                .get("data")
                .and_then(|data| data.get("message"))
                .and_then(Value::as_str)
                .or_else(|| error.get("message").and_then(Value::as_str))
        })
        .or_else(|| properties.get("message").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    Some(message.to_string())
}

pub(super) fn convert_session_error_to_session_update(properties: &Value) -> Option<SessionUpdate> {
    let session_id = properties
        .get("sessionID")
        .or_else(|| properties.get("sessionId"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    Some(SessionUpdate::TurnError {
        error: TurnErrorData::Structured(TurnErrorInfo {
            message: extract_session_error_message(properties)
                .unwrap_or_else(|| "OpenCode session failed".to_string()),
            kind: TurnErrorKind::Recoverable,
            code: None,
            source: Some(TurnErrorSource::Process),
        }),
        session_id,
    })
}

/// Convert OpenCode question.asked event to SessionUpdate
pub(super) fn convert_question_asked_to_session_update(
    properties: &Value,
) -> Option<SessionUpdate> {
    let event: QuestionAskedEvent = match serde_json::from_value(properties.clone()) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(
                error = %e,
                properties = %properties,
                "Failed to deserialize question.asked event"
            );
            return None;
        }
    };

    let session_id = event.session_id.clone();

    let questions: Vec<QuestionItem> = event
        .questions
        .into_iter()
        .map(|q| QuestionItem {
            question: q.question,
            header: q.header,
            options: q
                .options
                .into_iter()
                .map(|o| QuestionOption {
                    label: o.label,
                    description: o.description,
                })
                .collect(),
            multi_select: q.multi_select,
        })
        .collect();

    Some(SessionUpdate::QuestionRequest {
        question: QuestionData {
            id: event.id,
            session_id: session_id.clone(),
            json_rpc_request_id: None,
            questions,
            tool: None,
        },
        session_id: Some(session_id),
    })
}

/// Convert OpenCode permission.asked event to SessionUpdate
///
/// Note: Unlike the ACP JSON-RPC path (which has `toolCall.name` for ToolKind detection),
/// OpenCode SSE permissions only carry a `permission` description string and raw `metadata`.
/// Without a tool name, we cannot reliably derive canonical typed tool arguments.
/// The frontend's legacy rawInput fallback in `merge-permission-args.ts` handles this path.
pub(super) fn convert_permission_asked_to_session_update(
    properties: &Value,
) -> Option<SessionUpdate> {
    let event: PermissionAskedEvent = serde_json::from_value(properties.clone()).ok()?;

    let session_id = event.session_id.clone();

    Some(SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: event.id,
            session_id: session_id.clone(),
            permission: event.permission,
            patterns: event.patterns,
            metadata: event.metadata,
            always: event.always,
            tool: None,
        },
        session_id: Some(session_id),
    })
}
