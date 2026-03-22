//! Shared ACP wire-format field name constants and extraction helpers.
//!
//! All agents that emit ACP-shaped payloads (toolCallId/rawInput/rawOutput)
//! share the same JSON field names. This module centralises those constants
//! so parsers never use raw string literals for field access.

use super::types::{ParseError, UpdateType};
use crate::acp::session_update::{tool_call_status_from_str, ToolCallStatus};

// ---------------------------------------------------------------------------
// Tool-call identity
// ---------------------------------------------------------------------------

pub const TOOL_CALL_ID: &str = "toolCallId";
pub const ID: &str = "id";
pub const TOOL_USE_ID: &str = "tool_use_id";

// ---------------------------------------------------------------------------
// Tool naming
// ---------------------------------------------------------------------------

pub const NAME: &str = "name";
pub const TITLE: &str = "title";
pub const KIND: &str = "kind";
/// Agent-embedded tool name inside rawInput (Cursor / Codex convention).
pub const RAW_TOOL_NAME: &str = "_toolName";

// ---------------------------------------------------------------------------
// Input variants
// ---------------------------------------------------------------------------

pub const RAW_INPUT: &str = "rawInput";
pub const RAW_INPUT_SNAKE: &str = "raw_input";
pub const INPUT: &str = "input";
pub const ARGUMENTS: &str = "arguments";

// ---------------------------------------------------------------------------
// Output / result variants
// ---------------------------------------------------------------------------

pub const RAW_OUTPUT: &str = "rawOutput";
pub const RAW_OUTPUT_SNAKE: &str = "raw_output";
pub const OUTPUT: &str = "output";
pub const CONTENT: &str = "content";
pub const RESULT: &str = "result";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

pub const STATUS: &str = "status";

// ---------------------------------------------------------------------------
// Session / update type
// ---------------------------------------------------------------------------

pub const SESSION_UPDATE: &str = "sessionUpdate";
pub const TYPE: &str = "type";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

pub const LOCATIONS: &str = "locations";

// ---------------------------------------------------------------------------
// Streaming meta (nested paths)
// ---------------------------------------------------------------------------

pub const META: &str = "_meta";
pub const META_CLAUDE_CODE: &str = "claudeCode";
pub const META_CURSOR: &str = "cursor";
pub const META_STREAMING_INPUT_DELTA: &str = "streamingInputDelta";
pub const META_TOOL_NAME: &str = "toolName";
pub const META_TOOL_RESPONSE: &str = "toolResponse";
pub const META_PARENT_TOOL_USE_ID: &str = "parentToolUseId";

// ---------------------------------------------------------------------------
// Tool argument field names (shared across agents)
// ---------------------------------------------------------------------------

/// File path field variants used across agents.
pub const FILE_PATH_KEYS: &[&str] = &["file_path", "filePath", "path"];
/// Edit old-string field variants.
pub const OLD_STRING_KEYS: &[&str] = &["old_string", "oldString", "oldText"];
/// Edit new-string field variants.
pub const NEW_STRING_KEYS: &[&str] = &["new_string", "newString", "newText"];
/// Command field variants for execute tools.
pub const COMMAND_KEYS: &[&str] = &["command", "cmd"];
/// Search query field variants.
pub const QUERY_KEYS: &[&str] = &["query", "pattern"];

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/// Extract a tool-call ID from an ACP payload.
///
/// Tries `toolCallId`, then `id`, then `tool_use_id`.
pub fn extract_tool_call_id(data: &serde_json::Value) -> Result<String, ParseError> {
    data.get(TOOL_CALL_ID)
        .or_else(|| data.get(ID))
        .or_else(|| data.get(TOOL_USE_ID))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ParseError::MissingField("toolCallId, id, or tool_use_id".to_string()))
}

/// Extract a title string from an ACP payload.
pub fn extract_title(data: &serde_json::Value) -> Option<String> {
    data.get(TITLE)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Extract raw input from an ACP payload.
///
/// Tries `rawInput`, then `raw_input`, then `input`.
pub fn extract_raw_input(data: &serde_json::Value) -> Option<serde_json::Value> {
    data.get(RAW_INPUT)
        .or_else(|| data.get(RAW_INPUT_SNAKE))
        .or_else(|| data.get(INPUT))
        .cloned()
        .filter(|v| !v.is_null())
}

/// Extract raw output from an ACP payload.
///
/// Tries `rawOutput`, then `raw_output`, then `output`, then `content`.
pub fn extract_raw_output(data: &serde_json::Value) -> Option<serde_json::Value> {
    data.get(RAW_OUTPUT)
        .or_else(|| data.get(RAW_OUTPUT_SNAKE))
        .or_else(|| data.get(OUTPUT))
        .or_else(|| data.get(CONTENT))
        .cloned()
}

/// Extract status string from an ACP payload.
pub fn extract_status(data: &serde_json::Value) -> Option<String> {
    data.get(STATUS)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Extract the explicit tool name from an ACP payload.
///
/// Checks top-level `name` first, then `rawInput._toolName`.
pub fn extract_tool_name<'a>(
    data: &'a serde_json::Value,
    raw_input: Option<&'a serde_json::Value>,
) -> Option<&'a str> {
    data.get(NAME).and_then(|v| v.as_str()).or_else(|| {
        raw_input
            .and_then(|ri| ri.get(RAW_TOOL_NAME))
            .and_then(|v| v.as_str())
    })
}

/// Extract kind hint string from an ACP payload.
pub fn extract_kind_hint(data: &serde_json::Value) -> Option<&str> {
    data.get(KIND).and_then(|v| v.as_str())
}

/// Extract streaming meta fields from a nested `_meta.<agent>` object.
///
/// Returns `(streaming_input_delta, tool_name)`.
pub fn extract_streaming_meta(
    data: &serde_json::Value,
    agent_key: &str,
) -> (Option<String>, Option<String>) {
    let meta = data.get(META).and_then(|m| m.get(agent_key));
    let delta = meta
        .and_then(|c| c.get(META_STREAMING_INPUT_DELTA))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let tool_name = meta
        .and_then(|c| c.get(META_TOOL_NAME))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    (delta, tool_name)
}

/// Check whether a payload has ACP-shape fields (toolCallId/rawInput/rawOutput/sessionUpdate).
pub fn is_acp_shaped(data: &serde_json::Value) -> bool {
    data.get(TOOL_CALL_ID).is_some()
        || data.get(RAW_INPUT).is_some()
        || data.get(RAW_OUTPUT).is_some()
        || data.get(SESSION_UPDATE).is_some()
}

/// Check whether a payload has ACP-shape fields suitable for tool_call detection.
pub fn is_acp_tool_call_shaped(data: &serde_json::Value) -> bool {
    data.get(TOOL_CALL_ID).is_some() || data.get(RAW_INPUT).is_some() || data.get(TITLE).is_some()
}

/// Check whether a payload has ACP-shape fields suitable for tool_call_update detection.
pub fn is_acp_tool_call_update_shaped(data: &serde_json::Value) -> bool {
    data.get(TOOL_CALL_ID).is_some()
        || data.get(RAW_OUTPUT).is_some()
        || data.get(RAW_INPUT).is_some()
}

// ---------------------------------------------------------------------------
// ACP update type detection (shared by Cursor and Codex)
// ---------------------------------------------------------------------------

/// Detect update type for ACP-shaped payloads (toolCallId, sessionUpdate, rawInput, rawOutput).
///
/// Uses `update_type_mapper` to resolve a `type` field string to `UpdateType`.
/// Callers pass their parser-specific mapper (e.g. `parse_update_type_name_impl`).
pub fn detect_acp_update_type(
    data: &serde_json::Value,
    update_type_mapper: impl Fn(&str) -> Option<UpdateType>,
) -> Result<UpdateType, ParseError> {
    let has_session_id = data.get("sessionId").is_some() || data.get("session_id").is_some();
    if has_session_id
        && (data.get("tokens").is_some()
            || data.get("used").is_some()
            || data.get("size").is_some()
            || data.get("cost").is_some()
            || data.get("costUsd").is_some()
            || data.get("cost_usd").is_some())
    {
        return Ok(UpdateType::UsageTelemetryUpdate);
    }

    if let Some(type_str) = data.get(TYPE).and_then(|v| v.as_str()) {
        return update_type_mapper(type_str)
            .ok_or_else(|| ParseError::UnknownUpdateType(type_str.to_string()));
    }

    if data.get(TOOL_CALL_ID).is_some() || data.get(TOOL_USE_ID).is_some() {
        let has_tool_input = data.get(RAW_INPUT).is_some()
            || data.get(RAW_INPUT_SNAKE).is_some()
            || data.get(INPUT).is_some()
            || data.get(ARGUMENTS).is_some();
        if has_tool_input {
            return Ok(UpdateType::ToolCall);
        }

        let has_update_payload = data.get(RAW_OUTPUT).is_some()
            || data.get(RAW_OUTPUT_SNAKE).is_some()
            || data.get(OUTPUT).is_some()
            || data.get(CONTENT).is_some()
            || data.get(RESULT).is_some()
            || data.get(LOCATIONS).is_some();
        if has_update_payload {
            return Ok(UpdateType::ToolCallUpdate);
        }

        if let Some(status_str) = data.get(STATUS).and_then(|value| value.as_str()) {
            let status = tool_call_status_from_str(status_str);
            // tool_call_status_from_str returns Pending for unrecognised strings,
            // so only act when the input genuinely matches a known synonym.
            let is_known = status != ToolCallStatus::Pending
                || status_str.trim().eq_ignore_ascii_case("pending");
            if is_known {
                if matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed) {
                    return Ok(UpdateType::ToolCallUpdate);
                }
                return Ok(UpdateType::ToolCall);
            }
        }

        if data.get(NAME).is_some() || data.get(KIND).is_some() || data.get(TITLE).is_some() {
            return Ok(UpdateType::ToolCall);
        }

        return Ok(UpdateType::ToolCallUpdate);
    }

    Err(ParseError::MissingField("type or toolCallId".to_string()))
}
