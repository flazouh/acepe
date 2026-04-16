use serde::Deserialize;

use super::content::deserialize_content_chunk;
use super::tool_calls::{
    parse_tool_call_from_acp_with_agent, parse_tool_call_update_from_acp_with_agent,
};
use super::types::{
    AvailableCommandsData, ConfigOptionUpdateData, CurrentModeData, PermissionData, PlanData,
    PlanStep, QuestionData, SessionUpdate, ToolCallData, TurnErrorData,
};
use super::usage::parse_usage_telemetry_data_with_agent;
use crate::acp::agent_context::{current_agent, with_agent};
use crate::acp::parsers::{get_parser, AgentType, ParseError, UpdateType};

#[derive(Deserialize)]
struct RawSessionUpdate {
    #[serde(rename = "type")]
    type_field: Option<String>,
    #[serde(rename = "sessionUpdate")]
    session_update_field: Option<String>,
    #[serde(flatten)]
    data: serde_json::Value,
}

impl<'de> serde::Deserialize<'de> for SessionUpdate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw: RawSessionUpdate = serde::Deserialize::deserialize(deserializer)?;
        parse_raw_session_update::<D::Error>(raw, deserialize_agent_context::<D::Error>()?)
    }
}

pub(crate) fn parse_session_update_with_agent<E>(
    data: &serde_json::Value,
    agent: AgentType,
) -> Result<SessionUpdate, E>
where
    E: serde::de::Error,
{
    parse_raw_session_update(
        RawSessionUpdate {
            type_field: data
                .get("type")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            session_update_field: data
                .get("sessionUpdate")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            data: data.clone(),
        },
        agent,
    )
}

fn parse_raw_session_update<E>(raw: RawSessionUpdate, agent: AgentType) -> Result<SessionUpdate, E>
where
    E: serde::de::Error,
{
    let session_id = raw
        .data
        .get("sessionId")
        .or_else(|| raw.data.get("session_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let turn_id = raw
        .data
        .get("turnId")
        .or_else(|| raw.data.get("turn_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let update_type = extract_update_type_with_agent::<E>(
        &raw.data,
        &raw.type_field,
        &raw.session_update_field,
        agent,
    )?;

    match update_type.as_str() {
        "userMessageChunk" => {
            let chunk = deserialize_content_chunk::<E>(&raw.data)?;
            Ok(SessionUpdate::UserMessageChunk { chunk, session_id })
        }
        "agentMessageChunk" => {
            let chunk = deserialize_content_chunk::<E>(&raw.data)?;
            let message_id = raw
                .data
                .get("messageId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let part_id = raw
                .data
                .get("partId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Ok(SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            })
        }
        "agentThoughtChunk" => {
            let chunk = deserialize_content_chunk::<E>(&raw.data)?;
            let message_id = raw
                .data
                .get("messageId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let part_id = raw
                .data
                .get("partId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Ok(SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            })
        }
        "toolCall" => {
            let tool_call = if let Some(serialized_tool_call) = raw
                .data
                .get("tool_call")
                .or_else(|| raw.data.get("toolCall"))
                .cloned()
            {
                deserialize_serialized_tool_call_with_agent::<E>(serialized_tool_call, agent)?
            } else {
                parse_tool_call_from_acp_with_agent::<E>(&raw.data, agent)?
            };
            tracing::debug!(
                session_id = ?session_id,
                tool_call_id = %tool_call.id,
                tool_name = %tool_call.name,
                status = ?tool_call.status,
                "Received toolCall sessionUpdate"
            );
            Ok(SessionUpdate::ToolCall {
                tool_call,
                session_id,
            })
        }
        "toolCallUpdate" => {
            let update = if let Some(serialized_update) = raw.data.get("update").cloned() {
                serde_json::from_value(serialized_update).map_err(|error| {
                    serde::de::Error::custom(format!(
                        "Invalid serialized tool call update: {}",
                        error
                    ))
                })?
            } else {
                parse_tool_call_update_from_acp_with_agent::<E>(
                    &raw.data,
                    session_id.as_deref(),
                    agent,
                )?
            };
            tracing::debug!(
                session_id = ?session_id,
                tool_call_id = %update.tool_call_id,
                status = ?update.status,
                "Received toolCallUpdate sessionUpdate"
            );
            Ok(SessionUpdate::ToolCallUpdate { update, session_id })
        }
        "plan" => {
            let plan: PlanData = if let Some(plan_value) = raw.data.get("plan") {
                serde_json::from_value(plan_value.clone())
                    .map_err(|e| serde::de::Error::custom(format!("Invalid plan: {}", e)))?
            } else if let Some(entries) = raw.data.get("entries") {
                let steps: Vec<PlanStep> = serde_json::from_value(entries.clone())
                    .map_err(|e| serde::de::Error::custom(format!("Invalid entries: {}", e)))?;
                PlanData::from_steps(steps)
            } else {
                return Err(serde::de::Error::custom(
                    "Missing plan field (no 'plan' or 'entries' key)",
                ));
            };
            Ok(SessionUpdate::Plan { plan, session_id })
        }
        "availableCommandsUpdate" => {
            let update_value = require_first_present::<E>(
                &raw.data,
                &[
                    "availableCommandsUpdate",
                    "availableCommands",
                    "available_commands_update",
                    "available_commands",
                ],
                "Missing available commands field",
            )?;
            let update_value = normalize_array_or_object_payload(
                update_value,
                "availableCommands",
                "available_commands",
            );

            let update: AvailableCommandsData =
                serde_json::from_value(update_value).map_err(|e| {
                    serde::de::Error::custom(format!("Invalid available commands: {}", e))
                })?;
            Ok(SessionUpdate::AvailableCommandsUpdate { update, session_id })
        }
        "currentModeUpdate" => {
            let update_value = require_first_present::<E>(
                &raw.data,
                &[
                    "currentModeUpdate",
                    "currentMode",
                    "current_mode_update",
                    "current_mode",
                ],
                "Missing current mode field",
            )?;
            let update_value = normalize_string_or_object_payload(
                update_value,
                "currentModeId",
                "current_mode_id",
            );

            let update: CurrentModeData = serde_json::from_value(update_value)
                .map_err(|e| serde::de::Error::custom(format!("Invalid current mode: {}", e)))?;
            Ok(SessionUpdate::CurrentModeUpdate { update, session_id })
        }
        "configOptionUpdate" => {
            let update_value = require_first_present::<E>(
                &raw.data,
                &[
                    "configOptionUpdate",
                    "configOptions",
                    "config_option_update",
                    "config_options",
                ],
                "Missing config option field",
            )?;
            let update_value =
                normalize_array_or_object_payload(update_value, "configOptions", "config_options");

            let update: ConfigOptionUpdateData =
                serde_json::from_value(update_value).map_err(|e| {
                    serde::de::Error::custom(format!("Invalid config option update: {}", e))
                })?;
            Ok(SessionUpdate::ConfigOptionUpdate { update, session_id })
        }
        "permissionRequest" => {
            let permission_value = raw
                .data
                .get("permissionRequest")
                .cloned()
                .ok_or_else(|| serde::de::Error::custom("Missing permission field"))?;
            let permission: PermissionData = serde_json::from_value(permission_value)
                .map_err(|e| serde::de::Error::custom(format!("Invalid permission: {}", e)))?;
            Ok(SessionUpdate::PermissionRequest {
                permission,
                session_id,
            })
        }
        "questionRequest" => {
            let question_value = raw
                .data
                .get("questionRequest")
                .cloned()
                .ok_or_else(|| serde::de::Error::custom("Missing question field"))?;
            let question: QuestionData = serde_json::from_value(question_value)
                .map_err(|e| serde::de::Error::custom(format!("Invalid question: {}", e)))?;
            Ok(SessionUpdate::QuestionRequest {
                question,
                session_id,
            })
        }
        "turnComplete" => Ok(SessionUpdate::TurnComplete {
            session_id,
            turn_id,
        }),
        "turnError" => {
            let error = raw
                .data
                .get("error")
                .cloned()
                .or_else(|| raw.data.get("message").cloned())
                .map(serde_json::from_value::<TurnErrorData>)
                .transpose()
                .map_err(|e| serde::de::Error::custom(format!("Invalid turn error: {}", e)))?
                .unwrap_or_else(|| TurnErrorData::Legacy("Unknown error".to_string()));

            Ok(SessionUpdate::TurnError {
                error,
                session_id,
                turn_id,
            })
        }
        "usageTelemetryUpdate" => {
            let data = parse_usage_telemetry_data_with_agent::<E>(
                &raw.data,
                session_id.as_deref(),
                agent,
            )?;
            Ok(SessionUpdate::UsageTelemetryUpdate { data })
        }
        _ => Err(serde::de::Error::custom(format!(
            "Unknown session update type: {}",
            update_type
        ))),
    }
}

fn deserialize_agent_context<E>() -> Result<AgentType, E>
where
    E: serde::de::Error,
{
    #[cfg(test)]
    {
        return Ok(current_agent().unwrap_or(AgentType::ClaudeCode));
    }

    #[cfg(not(test))]
    {
        current_agent().ok_or_else(|| {
            serde::de::Error::custom("Missing agent context for SessionUpdate deserialization")
        })
    }
}

fn deserialize_serialized_tool_call_with_agent<E>(
    value: serde_json::Value,
    agent: AgentType,
) -> Result<ToolCallData, E>
where
    E: serde::de::Error,
{
    // Serialized tool_call payloads still flow through ToolCallData's legacy Deserialize impl.
    with_agent(agent, || serde_json::from_value(value)).map_err(|error| {
        serde::de::Error::custom(format!("Invalid serialized tool call: {}", error))
    })
}

/// Extract update type using the same logic as TypeScript type-normalizer.
///
/// Uses the parser architecture (`crate::acp::parsers`) for agent-agnostic parsing.
/// First checks explicit type fields as a fast-path, then delegates to the
/// appropriate parser (ClaudeCodeParser, OpenCodeParser, etc.) for the provided agent.
#[cfg(test)]
pub(crate) fn extract_update_type<E>(
    data: &serde_json::Value,
    type_field: &Option<String>,
    session_update_field: &Option<String>,
) -> Result<String, E>
where
    E: serde::de::Error,
{
    extract_update_type_with_agent(
        data,
        type_field,
        session_update_field,
        current_agent().unwrap_or(AgentType::ClaudeCode),
    )
}

fn extract_update_type_with_agent<E>(
    data: &serde_json::Value,
    type_field: &Option<String>,
    session_update_field: &Option<String>,
    agent: AgentType,
) -> Result<String, E>
where
    E: serde::de::Error,
{
    let parser = get_parser(agent);

    if let Some(type_str) = type_field {
        if matches!(type_str.as_str(), "turnComplete" | "turn_complete") {
            return Ok("turnComplete".to_string());
        }
        if matches!(type_str.as_str(), "turnError" | "turn_error") {
            return Ok("turnError".to_string());
        }
        if let Some(update_type) = parser.parse_update_type_name(type_str) {
            return Ok(update_type_to_string(update_type).to_string());
        }
    }

    if let Some(update_str) = session_update_field {
        if matches!(update_str.as_str(), "turnComplete" | "turn_complete") {
            return Ok("turnComplete".to_string());
        }
        if matches!(update_str.as_str(), "turnError" | "turn_error") {
            return Ok("turnError".to_string());
        }
        if let Some(update_type) = parser.parse_update_type_name(update_str) {
            return Ok(update_type_to_string(update_type).to_string());
        }
    }

    let update_type = parser
        .detect_update_type(data)
        .map_err(parser_error_to_de_error::<E>)?;

    Ok(update_type_to_string(update_type).to_string())
}

pub(crate) fn update_type_to_string(update_type: UpdateType) -> &'static str {
    match update_type {
        UpdateType::UserMessageChunk => "userMessageChunk",
        UpdateType::AgentMessageChunk => "agentMessageChunk",
        UpdateType::AgentThoughtChunk => "agentThoughtChunk",
        UpdateType::ToolCall => "toolCall",
        UpdateType::ToolCallUpdate => "toolCallUpdate",
        UpdateType::Plan => "plan",
        UpdateType::AvailableCommandsUpdate => "availableCommandsUpdate",
        UpdateType::CurrentModeUpdate => "currentModeUpdate",
        UpdateType::ConfigOptionUpdate => "configOptionUpdate",
        UpdateType::PermissionRequest => "permissionRequest",
        UpdateType::QuestionRequest => "questionRequest",
        UpdateType::UsageTelemetryUpdate => "usageTelemetryUpdate",
    }
}

pub(crate) fn parser_error_to_de_error<E>(error: ParseError) -> E
where
    E: serde::de::Error,
{
    E::custom(format!("Parser error: {}", error))
}

fn require_first_present<E>(
    data: &serde_json::Value,
    keys: &[&str],
    missing_message: &str,
) -> Result<serde_json::Value, E>
where
    E: serde::de::Error,
{
    find_first_present(data, keys)
        .ok_or_else(|| serde::de::Error::custom(missing_message.to_string()))
}

fn find_first_present(data: &serde_json::Value, keys: &[&str]) -> Option<serde_json::Value> {
    keys.iter().find_map(|key| data.get(*key).cloned())
}

fn normalize_array_or_object_payload(
    value: serde_json::Value,
    canonical_key: &str,
    legacy_key: &str,
) -> serde_json::Value {
    if value.is_array() {
        return serde_json::json!({ canonical_key: value });
    }

    remap_object_key_if_needed(value, canonical_key, legacy_key)
}

fn normalize_string_or_object_payload(
    value: serde_json::Value,
    canonical_key: &str,
    legacy_key: &str,
) -> serde_json::Value {
    if let Some(string_value) = value.as_str() {
        return serde_json::json!({ canonical_key: string_value });
    }

    remap_object_key_if_needed(value, canonical_key, legacy_key)
}

fn remap_object_key_if_needed(
    value: serde_json::Value,
    canonical_key: &str,
    legacy_key: &str,
) -> serde_json::Value {
    if let Some(obj) = value.as_object() {
        if obj.contains_key(legacy_key) && !obj.contains_key(canonical_key) {
            let mut normalized = obj.clone();
            if let Some(legacy_value) = normalized.remove(legacy_key) {
                normalized.insert(canonical_key.to_string(), legacy_value);
            }
            return serde_json::Value::Object(normalized);
        }
    }

    value
}
