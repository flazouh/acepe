//! Shared parsing helpers for chat-style JSON-RPC session/update agents.
//!
//! Some providers emit the same transport envelope and metadata shape even when
//! they are distinct products. Keep that shared wire-format parsing here so
//! provider modules only own provider-specific decisions.

use crate::acp::parsers::types::{
    parse_common_update_type_name, ParseError, ParsedUsageTelemetry, ParsedUsageTokens, UpdateType,
};
use crate::acp::session_update::{tool_call_status_from_str, RawToolCallUpdateInput, ToolKind};

pub(crate) fn infer_tool_kind_from_raw_arguments(
    raw_arguments: &serde_json::Value,
) -> Option<ToolKind> {
    let object = raw_arguments.as_object()?;

    if object.contains_key("file_path")
        || object.contains_key("filePath")
        || object.contains_key("path")
        || object.contains_key("query")
        || object.contains_key("cmd")
        || object.contains_key("command")
        || object.contains_key("pattern")
        || object.contains_key("url")
        || object.contains_key("from")
        || object.contains_key("to")
        || object.contains_key("source")
        || object.contains_key("destination")
    {
        return None;
    }

    if object.contains_key("description")
        || object.contains_key("prompt")
        || object.contains_key("agent_type")
        || object.contains_key("agentType")
        || object.contains_key("subagent_type")
        || object.contains_key("subagentType")
    {
        return Some(ToolKind::Task);
    }

    if object.contains_key("questions") {
        return Some(ToolKind::Question);
    }

    if object.contains_key("todos") {
        return Some(ToolKind::Todo);
    }

    if object.contains_key("task_id") || object.contains_key("taskId") {
        return Some(ToolKind::TaskOutput);
    }

    if object.contains_key("skill")
        || object.contains_key("skill_name")
        || object.contains_key("skillName")
        || object.contains_key("skill_args")
        || object.contains_key("skillArgs")
    {
        return Some(ToolKind::Skill);
    }

    None
}

pub(crate) fn parse_update_type_name(update_type: &str) -> Option<UpdateType> {
    match update_type {
        "usageUpdate" | "usage_update" => Some(UpdateType::UsageTelemetryUpdate),
        other => parse_common_update_type_name(other),
    }
}

pub(crate) fn detect_update_type(data: &serde_json::Value) -> Result<UpdateType, ParseError> {
    if data.get("used").is_some() || data.get("size").is_some() || data.get("cost").is_some() {
        return Ok(UpdateType::UsageTelemetryUpdate);
    }

    if let Some(type_str) = data.get("type").and_then(|v| v.as_str()) {
        return parse_update_type_name(type_str)
            .ok_or_else(|| ParseError::UnknownUpdateType(type_str.to_string()));
    }

    if let Some(session_update_str) = data.get("sessionUpdate").and_then(|v| v.as_str()) {
        if let Some(update_type) = parse_update_type_name(session_update_str) {
            return Ok(update_type);
        }
    }

    if data.get("availableCommands").is_some() {
        return Ok(UpdateType::AvailableCommandsUpdate);
    }

    if data.get("configOptions").is_some() {
        return Ok(UpdateType::ConfigOptionUpdate);
    }

    if data.get("plan").is_some() {
        return Ok(UpdateType::Plan);
    }

    if data.get("toolCallId").is_some() {
        let has_tool_name = data
            .get("_meta")
            .and_then(|m| m.get("claudeCode"))
            .and_then(|c| c.get("toolName"))
            .is_some();
        let has_raw_input = data.get("rawInput").is_some();

        if has_tool_name || has_raw_input {
            return Ok(UpdateType::ToolCall);
        }
        return Ok(UpdateType::ToolCallUpdate);
    }

    if let Some(object) = data.as_object() {
        for key in object.keys() {
            let update_type = match key.as_str() {
                "userMessageChunk" => Some(UpdateType::UserMessageChunk),
                "agentMessageChunk" => Some(UpdateType::AgentMessageChunk),
                "agentThoughtChunk" => Some(UpdateType::AgentThoughtChunk),
                "toolCall" => Some(UpdateType::ToolCall),
                "plan" => Some(UpdateType::Plan),
                "permissionRequest" => Some(UpdateType::PermissionRequest),
                "questionRequest" => Some(UpdateType::QuestionRequest),
                "usageTelemetryUpdate" | "usageUpdate" | "usage_update" => {
                    Some(UpdateType::UsageTelemetryUpdate)
                }
                _ => None,
            };
            if let Some(update_type) = update_type {
                return Ok(update_type);
            }
        }
    }

    Err(ParseError::UnknownUpdateType(
        "Could not determine update type".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::infer_tool_kind_from_raw_arguments;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn description_and_query_do_not_infer_task_kind() {
        let inferred = infer_tool_kind_from_raw_arguments(&serde_json::json!({
            "description": "Create planning todos",
            "query": "INSERT INTO todos VALUES ('todo-1')"
        }));

        assert_ne!(inferred, Some(ToolKind::Task));
    }
}

pub(crate) fn parse_tool_call_update(
    data: &serde_json::Value,
    normalize_tool_kind: fn(&str) -> ToolKind,
) -> Result<RawToolCallUpdateInput, ParseError> {
    let id = data
        .get("toolCallId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ParseError::MissingField("toolCallId".to_string()))?;

    let status = data
        .get("status")
        .and_then(|v| v.as_str())
        .map(tool_call_status_from_str);

    let result = data
        .get("rawOutput")
        .cloned()
        .or_else(|| {
            data.get("_meta")
                .and_then(|m| m.get("claudeCode"))
                .and_then(|c| c.get("toolResponse"))
                .cloned()
        })
        .or_else(|| data.get("result").cloned());

    let content = data.get("content").cloned();
    let title = data
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let locations = data.get("locations").cloned();
    let streaming_input_delta = data
        .get("_meta")
        .and_then(|m| m.get("claudeCode"))
        .and_then(|c| c.get("streamingInputDelta"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let tool_name = data
        .get("_meta")
        .and_then(|m| m.get("claudeCode"))
        .and_then(|c| c.get("toolName"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let raw_input = data.get("rawInput").cloned().filter(|v| !v.is_null());
    let kind = data
        .get("kind")
        .and_then(|v| v.as_str())
        .map(normalize_tool_kind);

    Ok(RawToolCallUpdateInput {
        id,
        status,
        result,
        content,
        title,
        locations,
        streaming_input_delta,
        tool_name,
        raw_input,
        kind,
    })
}

fn extract_result_context_window(data: &serde_json::Value) -> Option<u64> {
    let model_usage = data.get("modelUsage")?.as_object()?;

    model_usage
        .values()
        .filter_map(|entry| entry.get("contextWindow").and_then(|value| value.as_u64()))
        .max()
}

pub(crate) fn parse_usage_telemetry(
    data: &serde_json::Value,
    fallback_session_id: Option<&str>,
) -> Result<ParsedUsageTelemetry, ParseError> {
    let session_id = data
        .get("sessionId")
        .or_else(|| data.get("session_id"))
        .and_then(|value| value.as_str())
        .or(fallback_session_id)
        .ok_or_else(|| ParseError::MissingField("sessionId".to_string()))?
        .to_string();

    let compaction_reset = data
        .get("compaction")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let used_total = if compaction_reset {
        Some(0)
    } else {
        data.get("used")
            .and_then(|value| value.as_u64())
            .or_else(|| {
                data.get("latestUsage")
                    .and_then(|value| value.get("used"))
                    .and_then(|value| value.as_u64())
            })
            .or_else(|| {
                data.get("latest_usage")
                    .and_then(|value| value.get("used"))
                    .and_then(|value| value.as_u64())
            })
    };

    let cost_usd = data
        .get("cost")
        .and_then(|value| value.get("amount"))
        .and_then(|value| value.as_f64())
        .or_else(|| data.get("costUsd").and_then(|value| value.as_f64()))
        .or_else(|| data.get("cost_usd").and_then(|value| value.as_f64()));

    Ok(ParsedUsageTelemetry {
        session_id,
        event_id: data
            .get("eventId")
            .or_else(|| data.get("event_id"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        scope: data
            .get("scope")
            .and_then(|value| value.as_str())
            .unwrap_or("turn")
            .to_string(),
        cost_usd,
        tokens: ParsedUsageTokens {
            total: used_total,
            ..ParsedUsageTokens::default()
        },
        source_model_id: data
            .get("sourceModelId")
            .or_else(|| data.get("source_model_id"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        timestamp_ms: data
            .get("timestampMs")
            .or_else(|| data.get("timestamp_ms"))
            .and_then(|value| value.as_i64()),
        context_window_size: data
            .get("size")
            .and_then(|value| value.as_u64())
            .or_else(|| extract_result_context_window(data)),
    })
}
