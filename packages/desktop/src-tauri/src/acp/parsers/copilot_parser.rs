//! Parser for GitHub Copilot ACP events.

use crate::acp::parsers::adapters::CopilotAdapter;
use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::edit_normalizers::copilot::parse_edit_arguments;
use crate::acp::parsers::kind::infer_kind_from_payload;
use crate::acp::parsers::provider_capabilities::{provider_capabilities, ProviderCapabilities};
use crate::acp::parsers::shared_chat::{
    detect_update_type, infer_tool_kind_from_raw_arguments, parse_tool_call_update,
    parse_update_type_name, parse_usage_telemetry,
};
use crate::acp::parsers::types::{
    extract_plan_from_raw_input_impl, parse_ask_user_question, parse_todo_write, AgentParser,
    AgentType, ParseError, ParsedQuestion, ParsedTodo, ParsedUsageTelemetry, UpdateType,
};
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, tool_call_status_from_str, PlanData,
    RawToolCallInput, ToolArguments, ToolCallData, ToolCallUpdateData, ToolKind,
};

pub struct CopilotParser;

impl AgentParser for CopilotParser {
    fn agent_type(&self) -> AgentType {
        AgentType::Copilot
    }

    fn capabilities(&self) -> &'static ProviderCapabilities {
        provider_capabilities(AgentType::Copilot)
    }

    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType> {
        parse_update_type_name(update_type)
    }

    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError> {
        detect_update_type(data)
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
        let raw = parse_tool_call_update(data, CopilotAdapter::normalize)?;
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
        CopilotAdapter::normalize(name)
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
        parse_usage_telemetry(data, fallback_session_id)
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

        let provider_declared_kind = infer_tool_kind_from_raw_arguments(&arguments)
            .or_else(|| kind_hint.map(|hint| CopilotAdapter::normalize(hint)));

        let parent_tool_use_id = data
            .get("_meta")
            .and_then(|m| m.get("claudeCode"))
            .and_then(|m| m.get("parentToolUseId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(RawToolCallInput {
            id,
            provider_tool_name: explicit_name,
            provider_declared_kind,
            arguments,
            status,
            title,
            suppress_title_read_path_hint: false,
            parent_tool_use_id,
            task_children: None,
        })
    }
}
