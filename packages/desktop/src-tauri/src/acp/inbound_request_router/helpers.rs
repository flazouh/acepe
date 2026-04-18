use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::reconciler::providers;
use crate::acp::reconciler::session_tool::{classify_raw_tool_call, ToolClassificationHints};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::types::TerminalRequestParamsRaw;
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

#[allow(clippy::result_large_err)]
pub(super) fn terminal_app_handle(
    app_handle: Option<&AppHandle>,
) -> Result<AppHandle, InboundRoutingDecision> {
    app_handle
        .cloned()
        .ok_or_else(|| request_error("Terminal manager unavailable".to_string()))
}

#[allow(clippy::result_large_err)]
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
    tool_call_id: &str,
    tool_name: Option<&str>,
    tool_title: Option<&str>,
    raw_input: Value,
    kind_hint: Option<&str>,
    agent_type: AgentType,
) -> Option<Value> {
    if raw_input.is_null() {
        return None;
    }

    let parser = get_parser(agent_type);
    let effective_name = tool_name.map(str::trim).filter(|name| !name.is_empty());
    let effective_title = tool_title.map(str::trim).filter(|title| !title.is_empty());
    let args = classify_raw_tool_call(
        parser,
        tool_call_id,
        &raw_input,
        ToolClassificationHints {
            name: effective_name,
            title: effective_title,
            kind: kind_hint.map(|kind| providers::detect_tool_kind(agent_type, kind)),
            kind_hint,
            locations: None,
        },
    )
    .arguments;
    serde_json::to_value(&args)
        .inspect_err(
            |e| tracing::warn!(error = %e, "Failed to serialize parsed permission arguments"),
        )
        .ok()
}
