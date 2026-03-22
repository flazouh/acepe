//! Parser for Claude Code agent.

use crate::acp::parsers::adapters::ClaudeCodeAdapter;
use crate::acp::parsers::arguments::parse_canonical_tool_arguments;
use crate::acp::parsers::edit_normalizers::claude_code::parse_edit_arguments;
use crate::acp::parsers::types::{
    extract_plan_from_raw_input_impl, parse_ask_user_question, parse_common_update_type_name,
    parse_todo_write, AgentParser, AgentType, ParseError, ParsedQuestion, ParsedTodo,
    ParsedUsageTelemetry, ParsedUsageTokens, UpdateType,
};
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, tool_call_status_from_str, PlanData,
    RawToolCallInput, RawToolCallUpdateInput, ToolArguments, ToolKind,
};

pub struct ClaudeCodeParser;

impl AgentParser for ClaudeCodeParser {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType> {
        ClaudeCodeParser.parse_update_type_name_impl(update_type)
    }

    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError> {
        ClaudeCodeParser.detect_update_type_impl(data)
    }

    fn parse_tool_call(
        &self,
        data: &serde_json::Value,
    ) -> Result<crate::acp::session_update::ToolCallData, ParseError> {
        let raw = ClaudeCodeParser.parse_tool_call_impl(data)?;
        Ok(build_tool_call_from_raw(self, raw))
    }

    fn parse_tool_call_update(
        &self,
        data: &serde_json::Value,
        session_id: Option<&str>,
    ) -> Result<crate::acp::session_update::ToolCallUpdateData, ParseError> {
        let raw = ClaudeCodeParser.parse_tool_call_update_impl(data)?;
        Ok(build_tool_call_update_from_raw(self, raw, session_id))
    }

    fn parse_questions(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>> {
        ClaudeCodeParser.parse_questions_impl(name, arguments)
    }

    fn parse_todos(&self, name: &str, arguments: &serde_json::Value) -> Option<Vec<ParsedTodo>> {
        ClaudeCodeParser.parse_todos_impl(name, arguments)
    }

    fn detect_tool_kind(&self, name: &str) -> ToolKind {
        ToolKind::from(ClaudeCodeAdapter::normalize(name))
    }

    fn parse_typed_tool_arguments(
        &self,
        tool_name: Option<&str>,
        raw_arguments: &serde_json::Value,
        kind_hint: Option<&str>,
    ) -> Option<ToolArguments> {
        if raw_arguments.is_null() || raw_arguments.as_object().is_some_and(|obj| obj.is_empty()) {
            return None;
        }
        let kind = tool_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| self.detect_tool_kind(name))
            .filter(|k| *k != ToolKind::Other)
            .or_else(|| kind_hint.map(|hint| self.detect_tool_kind(hint)))
            .unwrap_or(ToolKind::Other);
        if kind == ToolKind::Edit {
            return Some(parse_edit_arguments(raw_arguments));
        }
        Some(parse_canonical_tool_arguments(kind, raw_arguments))
    }

    fn parse_usage_telemetry(
        &self,
        data: &serde_json::Value,
        fallback_session_id: Option<&str>,
    ) -> Result<ParsedUsageTelemetry, ParseError> {
        ClaudeCodeParser.parse_usage_telemetry_impl(data, fallback_session_id)
    }

    fn extract_plan_from_raw_input(
        &self,
        tool_name: &str,
        raw_input: &serde_json::Value,
    ) -> Option<PlanData> {
        extract_plan_from_raw_input_impl(self, tool_name, raw_input)
    }
}

impl ClaudeCodeParser {
    pub fn parse_update_type_name_impl(&self, update_type: &str) -> Option<UpdateType> {
        match update_type {
            "usageUpdate" | "usage_update" => Some(UpdateType::UsageTelemetryUpdate),
            other => parse_common_update_type_name(other),
        }
    }

    pub fn detect_update_type_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<UpdateType, ParseError> {
        if data.get("used").is_some() || data.get("size").is_some() || data.get("cost").is_some() {
            return Ok(UpdateType::UsageTelemetryUpdate);
        }

        if let Some(type_str) = data.get("type").and_then(|v| v.as_str()) {
            return self
                .parse_update_type_name_impl(type_str)
                .ok_or_else(|| ParseError::UnknownUpdateType(type_str.to_string()));
        }

        if let Some(session_update_str) = data.get("sessionUpdate").and_then(|v| v.as_str()) {
            if let Some(update_type) = self.parse_update_type_name_impl(session_update_str) {
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

        for key in data.as_object().map(|o| o.keys()).into_iter().flatten() {
            if let Some(update_type) = self.type_from_property_key(key) {
                return Ok(update_type);
            }
        }

        Err(ParseError::UnknownUpdateType(
            "Could not determine update type".to_string(),
        ))
    }

    fn type_from_property_key(&self, key: &str) -> Option<UpdateType> {
        match key {
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
        }
    }

    pub(crate) fn parse_tool_call_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallInput, ParseError> {
        let id = data
            .get("toolCallId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("toolCallId".to_string()))?;

        let name = data
            .get("_meta")
            .and_then(|m| m.get("claudeCode"))
            .and_then(|c| c.get("toolName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let arguments = data
            .get("rawInput")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        let status = tool_call_status_from_str(
            data.get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending"),
        );

        let kind = Some(ToolKind::from(ClaudeCodeAdapter::normalize(&name)));

        let title = data
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let parent_tool_use_id = data
            .get("_meta")
            .and_then(|m| m.get("claudeCode"))
            .and_then(|m| m.get("parentToolUseId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(RawToolCallInput {
            id,
            name,
            arguments,
            status,
            kind,
            title,
            parent_tool_use_id,
            task_children: None,
        })
    }

    pub fn parse_questions_impl(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>> {
        parse_ask_user_question(name, arguments)
    }

    pub fn parse_todos_impl(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedTodo>> {
        parse_todo_write(name, arguments)
    }

    pub(crate) fn parse_tool_call_update_impl(
        &self,
        data: &serde_json::Value,
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
            .map(|s| ToolKind::from(ClaudeCodeAdapter::normalize(s)));

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

    pub fn parse_usage_telemetry_impl(
        &self,
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
            context_window_size: data.get("size").and_then(|value| value.as_u64()),
        })
    }
}
