//! Parser for Claude Code agent.

use crate::acp::parsers::adapters::ClaudeCodeAdapter;
use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::edit_normalizers::claude_code::parse_edit_arguments;
use crate::acp::parsers::kind::infer_kind_from_payload;
use crate::acp::parsers::provider_capabilities::{ProviderCapabilities, provider_capabilities};
use crate::acp::parsers::shared_chat::{
    detect_update_type, infer_tool_kind_from_raw_arguments, parse_tool_call_update,
    parse_update_type_name, parse_usage_telemetry,
};
use crate::acp::parsers::types::{
    AgentParser, AgentType, ParseError, ParsedQuestion, ParsedTodo, ParsedUsageTelemetry,
    UpdateType, extract_plan_from_raw_input_impl, parse_ask_user_question, parse_todo_write,
};
use crate::acp::session_update::{
    PlanData, RawToolCallInput, ToolArguments, ToolKind, build_tool_call_from_raw,
    build_tool_call_update_from_raw, tool_call_status_from_str,
};

pub struct ClaudeCodeParser;
impl AgentParser for ClaudeCodeParser {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn capabilities(&self) -> &'static ProviderCapabilities {
        provider_capabilities(AgentType::ClaudeCode)
    }

    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType> {
        parse_update_type_name(update_type)
    }

    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError> {
        detect_update_type(data)
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
        let raw = parse_tool_call_update(data, ClaudeCodeAdapter::normalize)?;
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
            .filter(|k| *k != ToolKind::Other)
        {
            kind
        } else if let Some(kind) = kind_hint
            .map(str::trim)
            .filter(|hint| !hint.is_empty())
            .map(|hint| self.detect_tool_kind(hint))
            .filter(|k| *k != ToolKind::Other)
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

impl ClaudeCodeParser {
    pub(crate) fn parse_tool_call_impl(
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
            .unwrap_or(ToolKind::Other);

        let name = explicit_name
            .clone()
            .unwrap_or_else(|| "unknown".to_string());

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
            suppress_title_read_path_hint: false,
            parent_tool_use_id,
            task_children: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::acp::parsers::shared_chat::parse_usage_telemetry;

    #[test]
    fn parses_context_window_from_result_model_usage() {
        let parsed = parse_usage_telemetry(
            &serde_json::json!({
                "type": "result",
                "session_id": "ses-123",
                "usage": {
                    "input_tokens": 3,
                    "output_tokens": 5
                },
                "modelUsage": {
                    "claude-sonnet-4-6": {
                        "contextWindow": 200000,
                        "maxOutputTokens": 32000
                    }
                }
            }),
            None,
        )
        .expect("result telemetry should parse");

        assert_eq!(parsed.session_id, "ses-123");
        assert_eq!(parsed.context_window_size, Some(200000));
    }
}
