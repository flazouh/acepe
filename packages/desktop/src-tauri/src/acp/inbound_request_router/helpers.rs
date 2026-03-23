use crate::acp::parsers::{get_parser, AgentType};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::types::{PermissionOptionRaw, TerminalRequestParamsRaw};
use super::InboundRoutingDecision;

pub(super) fn invalid_params(message: &str) -> InboundRoutingDecision {
    InboundRoutingDecision::Handle(json!({
        "error": {
            "code": -32602,
            "message": message
        }
    }))
}

pub(super) fn request_error(message: String) -> InboundRoutingDecision {
    InboundRoutingDecision::Handle(json!({
        "error": {
            "code": -32000,
            "message": message
        }
    }))
}

pub(super) fn parse_params<T: for<'de> Deserialize<'de>>(
    params: &Value,
) -> Result<T, serde_json::Error> {
    serde_json::from_value(params.clone())
}

fn normalize_tool_name(tool_name: &str) -> String {
    tool_name
        .rsplit("__")
        .next()
        .unwrap_or(tool_name)
        .to_lowercase()
}

fn is_tcc_sensitive_tool_name(tool_name: &str) -> bool {
    matches!(
        normalize_tool_name(tool_name).as_str(),
        "take_screenshot"
            | "simulate_mouse_movement"
            | "simulate_text_input"
            | "send_text_to_element"
    )
}

pub(super) fn should_auto_deny_tcc_permission(
    tool_name: &str,
    platform: &str,
    allow_automation_tools_env: Option<&str>,
) -> bool {
    platform == "macos"
        && allow_automation_tools_env != Some("1")
        && is_tcc_sensitive_tool_name(tool_name)
}

pub(super) fn resolve_reject_option_id(options: &[PermissionOptionRaw]) -> String {
    options
        .iter()
        .find(|option| {
            option
                .kind
                .as_deref()
                .is_some_and(|kind| kind.starts_with("reject"))
        })
        .and_then(|option| option.option_id.clone())
        .unwrap_or_else(|| "reject".to_string())
}

pub(super) fn build_permission_request_log_payload(
    method: &str,
    raw_params: &Value,
    tool_name: Option<&str>,
    tool_title: Option<&str>,
    parsed_arguments: Option<&Value>,
    blocked: bool,
    auto_reject_option_id: Option<&str>,
) -> Value {
    let mut payload = json!({
        "event": "permission.request.received",
        "method": method,
        "toolCall": {
            "name": tool_name,
            "title": tool_title
        },
        "blocked": blocked,
        "rawParams": raw_params
    });

    if let Some(object) = payload.as_object_mut() {
        if let Some(arguments) = parsed_arguments {
            object.insert("parsedArguments".to_string(), arguments.clone());
        }
        if let Some(option_id) = auto_reject_option_id {
            object.insert(
                "autoRejectOptionId".to_string(),
                Value::String(option_id.to_string()),
            );
        }
    }

    payload
}

pub(super) fn terminal_app_handle(
    app_handle: Option<&AppHandle>,
) -> Result<AppHandle, InboundRoutingDecision> {
    app_handle
        .cloned()
        .ok_or_else(|| request_error("Terminal manager unavailable".to_string()))
}

pub(super) fn parse_terminal_request_params(
    params: &Value,
) -> Result<(String, String), InboundRoutingDecision> {
    let parsed: TerminalRequestParamsRaw = parse_params(params)
        .map_err(|_| invalid_params("Invalid params: sessionId and terminalId required"))?;

    let session_id = parsed
        .session_id
        .ok_or_else(|| invalid_params("Invalid params: sessionId and terminalId required"))?;
    let terminal_id = parsed
        .terminal_id
        .ok_or_else(|| invalid_params("Invalid params: sessionId and terminalId required"))?;

    Ok((session_id, terminal_id))
}

/// Parse permission rawInput into typed ToolArguments via agent-specific parser.
pub(super) fn parse_permission_tool_arguments(
    tool_name: Option<&str>,
    raw_input: Value,
    kind_hint: Option<&str>,
    agent_type: AgentType,
) -> Option<Value> {
    if raw_input.is_null() {
        return None;
    }

    let parser = get_parser(agent_type);
    let effective_name = tool_name.map(str::trim).filter(|name| !name.is_empty());
    let args = parser.parse_typed_tool_arguments(effective_name, &raw_input, kind_hint)?;
    serde_json::to_value(&args)
        .inspect_err(
            |e| tracing::warn!(error = %e, "Failed to serialize parsed permission arguments"),
        )
        .ok()
}

/// Extract web search query from a permission's parsed arguments or title.
///
/// Primary: uses already-serialized typed arguments (`{"WebSearch": {"query": "..."}}`).
/// Fallback: parses `forwarded["/params/toolCall/title"]` via the Cursor title prefix.
pub(crate) fn extract_query_from_synthetic_permission(
    parsed_arguments: &Option<Value>,
    forwarded: &Value,
) -> Option<String> {
    // Primary: use already-parsed typed arguments.
    if let Some(args) = parsed_arguments {
        if let Some(query) = args.pointer("/WebSearch/query").and_then(|v| v.as_str()) {
            if !query.is_empty() {
                return Some(query.to_string());
            }
        }
    }
    // Fallback: parse title field "Web search: <query>"
    if let Some(title) = forwarded
        .pointer("/params/toolCall/title")
        .and_then(|v| v.as_str())
    {
        return extract_query_from_permission_title(title);
    }
    None
}

/// Extract query from a Cursor-style permission title: "Web search: <query>".
pub(crate) fn extract_query_from_permission_title(title: &str) -> Option<String> {
    // The prefix "Web search: " is 12 ASCII bytes — case-insensitive check, then
    // slice from the original title to preserve the query's original casing.
    const PREFIX: &str = "web search: ";
    if title.len() < PREFIX.len() {
        return None;
    }
    if !title[..PREFIX.len()].eq_ignore_ascii_case(PREFIX) {
        return None;
    }
    let query = title[PREFIX.len()..].trim();
    if query.is_empty() {
        tracing::warn!(title = %title, "Web search permission title has empty query after prefix strip");
        return None;
    }
    Some(query.to_string())
}
