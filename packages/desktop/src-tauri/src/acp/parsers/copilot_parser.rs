//! Parser for GitHub Copilot ACP events.

use crate::acp::parsers::adapters::ClaudeCodeAdapter;
use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::edit_normalizers::claude_code::parse_edit_arguments;
use crate::acp::parsers::kind::{canonical_name_for_kind, infer_kind_from_payload};
use crate::acp::parsers::types::{
    extract_plan_from_raw_input_impl, parse_ask_user_question, parse_todo_write, AgentParser,
    AgentType, ParseError, ParsedQuestion, ParsedTodo, ParsedUsageTelemetry, UpdateType,
};
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, tool_call_status_from_str, PlanData,
    RawToolCallInput, ToolArguments, ToolCallData, ToolCallUpdateData, ToolKind,
};

use super::claude_code_parser::ClaudeCodeParser;

pub struct CopilotParser;

fn infer_tool_kind_from_raw_arguments(raw_arguments: &serde_json::Value) -> Option<ToolKind> {
    let object = raw_arguments.as_object()?;

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

impl AgentParser for CopilotParser {
    fn agent_type(&self) -> AgentType {
        AgentType::Copilot
    }

    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType> {
        ClaudeCodeParser.parse_update_type_name_impl(update_type)
    }

    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError> {
        ClaudeCodeParser.detect_update_type_impl(data)
    }

    fn parse_tool_call(&self, data: &serde_json::Value) -> Result<ToolCallData, ParseError> {
        let raw = self.parse_tool_call_impl(data)?;
        Ok(build_tool_call_from_raw(self, raw))
    }

    fn parse_tool_call_update(
        &self,
        data: &serde_json::Value,
        session_id: Option<&str>,
    ) -> Result<ToolCallUpdateData, ParseError> {
        let raw = ClaudeCodeParser.parse_tool_call_update_impl(data)?;
        Ok(build_tool_call_update_from_raw(self, raw, session_id))
    }

    fn parse_questions(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>> {
        parse_ask_user_question(name, arguments)
    }

    fn parse_todos(&self, name: &str, arguments: &serde_json::Value) -> Option<Vec<ParsedTodo>> {
        parse_todo_write(name, arguments)
    }

    fn detect_tool_kind(&self, name: &str) -> ToolKind {
        ClaudeCodeAdapter::normalize(name)
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

        let kind_from_raw_arguments = infer_tool_kind_from_raw_arguments(raw_arguments);

        let kind = if let Some(kind) = tool_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| self.detect_tool_kind(name))
            .filter(|kind| *kind != ToolKind::Other)
        {
            kind
        } else if let Some(kind) = kind_hint
            .and_then(|hint| infer_kind_from_payload("", None, Some(hint)))
            .filter(|kind| *kind != ToolKind::Other)
        {
            if matches!(kind, ToolKind::Think) {
                kind_from_raw_arguments.unwrap_or(kind)
            } else {
                kind
            }
        } else {
            kind_from_raw_arguments.unwrap_or(ToolKind::Other)
        };

        if kind == ToolKind::Edit {
            return Some(parse_edit_arguments(raw_arguments));
        }

        Some(parse_tool_kind_arguments(kind, raw_arguments))
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

impl CopilotParser {
    fn parse_tool_call_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallInput, ParseError> {
        let id = data
            .get("toolCallId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("toolCallId".to_string()))?;

        let title = data
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let arguments = data
            .get("rawInput")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        let kind_hint = data.get("kind").and_then(|v| v.as_str());

        let explicit_name = data
            .get("_meta")
            .and_then(|m| m.get("claudeCode"))
            .and_then(|c| c.get("toolName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let status = tool_call_status_from_str(
            data.get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending"),
        );

        let kind = explicit_name
            .as_deref()
            .map(ClaudeCodeAdapter::normalize)
            .filter(|kind| *kind != ToolKind::Other)
            .or_else(|| infer_kind_from_payload(&id, title.as_deref(), kind_hint))
            .or_else(|| infer_tool_kind_from_raw_arguments(&arguments))
            .or_else(|| {
                self.parse_typed_tool_arguments(None, &arguments, kind_hint)
                    .map(|parsed_arguments| parsed_arguments.tool_kind())
                    .filter(|kind| *kind != ToolKind::Other)
            })
            .unwrap_or(ToolKind::Other);

        let name = explicit_name.unwrap_or_else(|| {
            if kind == ToolKind::Other {
                "unknown".to_string()
            } else {
                canonical_name_for_kind(kind).to_string()
            }
        });

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
            kind: Some(kind),
            title,
            parent_tool_use_id,
            task_children: None,
        })
    }
}
