//! Parser for OpenCode agent.

use crate::acp::parsers::adapters::OpenCodeAdapter;
use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::edit_normalizers::opencode::parse_edit_arguments;
use crate::acp::parsers::provider_capabilities::{ProviderCapabilities, provider_capabilities};
use crate::acp::parsers::types::{
    AgentParser, AgentType, ParseError, ParsedQuestion, ParsedQuestionOption, ParsedTodo,
    ParsedTodoStatus, ParsedUsageTelemetry, UpdateType, parse_common_update_type_name,
    parse_standard_usage_telemetry,
};
use crate::acp::session_update::{
    RawToolCallInput, RawToolCallUpdateInput, ToolArguments, ToolCallStatus, ToolKind,
    build_tool_call_from_raw, build_tool_call_update_from_raw,
};

pub struct OpenCodeParser;

impl AgentParser for OpenCodeParser {
    fn agent_type(&self) -> AgentType {
        AgentType::OpenCode
    }

    fn capabilities(&self) -> &'static ProviderCapabilities {
        provider_capabilities(AgentType::OpenCode)
    }

    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType> {
        OpenCodeParser.parse_update_type_name_impl(update_type)
    }

    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError> {
        OpenCodeParser.detect_update_type_impl(data)
    }

    fn parse_tool_call(
        &self,
        data: &serde_json::Value,
    ) -> Result<crate::acp::session_update::ToolCallData, ParseError> {
        let raw = OpenCodeParser.parse_tool_call_impl(data)?;
        Ok(build_tool_call_from_raw(self, raw))
    }

    fn parse_tool_call_update(
        &self,
        data: &serde_json::Value,
        session_id: Option<&str>,
    ) -> Result<crate::acp::session_update::ToolCallUpdateData, ParseError> {
        let raw = OpenCodeParser.parse_tool_call_update_impl(data)?;
        Ok(build_tool_call_update_from_raw(self, raw, session_id))
    }

    fn parse_questions(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>> {
        OpenCodeParser.parse_questions_impl(name, arguments)
    }

    fn parse_todos(&self, name: &str, arguments: &serde_json::Value) -> Option<Vec<ParsedTodo>> {
        OpenCodeParser.parse_todos_impl(name, arguments)
    }

    fn detect_tool_kind(&self, name: &str) -> ToolKind {
        OpenCodeAdapter::normalize(name)
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
        Some(parse_tool_kind_arguments(kind, raw_arguments))
    }

    fn parse_usage_telemetry(
        &self,
        data: &serde_json::Value,
        fallback_session_id: Option<&str>,
    ) -> Result<ParsedUsageTelemetry, ParseError> {
        OpenCodeParser.parse_usage_telemetry_impl(data, fallback_session_id)
    }
}

impl OpenCodeParser {
    pub fn parse_update_type_name_impl(&self, update_type: &str) -> Option<UpdateType> {
        parse_common_update_type_name(update_type).or(match update_type {
            "tool-invocation" => Some(UpdateType::ToolCall),
            "tool-result" => Some(UpdateType::ToolCallUpdate),
            "text" => Some(UpdateType::AgentMessageChunk),
            _ => None,
        })
    }

    pub fn detect_update_type_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<UpdateType, ParseError> {
        let type_str = data
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ParseError::MissingField("type".to_string()))?;

        self.parse_update_type_name_impl(type_str)
            .ok_or_else(|| ParseError::UnknownUpdateType(type_str.to_string()))
    }

    pub(crate) fn parse_tool_call_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallInput, ParseError> {
        let id = data
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("id".to_string()))?;

        let name = data
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("name".to_string()))?;

        let arguments = data
            .get("input")
            .or_else(|| data.get("arguments"))
            .cloned()
            .unwrap_or(serde_json::json!({}));

        let kind = OpenCodeAdapter::normalize(&name);

        Ok(RawToolCallInput {
            id,
            name,
            arguments,
            status: ToolCallStatus::Pending,
            kind: Some(kind),
            title: None,
            suppress_title_read_path_hint: false,
            parent_tool_use_id: None,
            task_children: None,
        })
    }

    pub(crate) fn parse_tool_call_update_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallUpdateInput, ParseError> {
        let id = data
            .get("toolUseId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("toolUseId".to_string()))?;

        let result = data.get("content").cloned();

        Ok(RawToolCallUpdateInput {
            id,
            status: Some(ToolCallStatus::Completed),
            result,
            content: None,
            title: None,
            locations: None,
            streaming_input_delta: None,
            tool_name: None,
            raw_input: None,
            kind: None,
        })
    }

    pub fn parse_questions_impl(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>> {
        let name_lower = name.to_lowercase();
        if name_lower != "question" && name_lower != "askuserquestion" {
            return None;
        }

        let get_field = |field: &str| -> Option<&serde_json::Value> {
            arguments
                .get(field)
                .or_else(|| arguments.get("raw").and_then(|r| r.get(field)))
        };

        let question_text = get_field("question").and_then(|q| q.as_str())?;

        let options = get_field("options")
            .and_then(|opts| opts.as_array())
            .map(|opts| {
                opts.iter()
                    .filter_map(|opt| {
                        let label = opt.as_str()?.to_string();
                        Some(ParsedQuestionOption {
                            label,
                            description: String::new(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let multi_select = false;

        Some(vec![ParsedQuestion {
            question: question_text.to_string(),
            header: String::new(),
            options,
            multi_select,
        }])
    }

    pub fn parse_todos_impl(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedTodo>> {
        let name_lower = name.to_lowercase();
        if name_lower != "todowrite" {
            return None;
        }

        let todos_array = arguments
            .get("todos")
            .or_else(|| arguments.get("raw").and_then(|r| r.get("todos")))
            .and_then(|v| v.as_array())?;

        if todos_array.is_empty() {
            return None;
        }

        let parsed_todos: Vec<ParsedTodo> = todos_array
            .iter()
            .filter_map(|t| {
                let content = t.get("content")?.as_str()?;
                let status_str = t.get("status")?.as_str()?;
                let status = match status_str {
                    "pending" => ParsedTodoStatus::Pending,
                    "in_progress" => ParsedTodoStatus::InProgress,
                    "completed" => ParsedTodoStatus::Completed,
                    "cancelled" => ParsedTodoStatus::Cancelled,
                    _ => return None,
                };

                Some(ParsedTodo {
                    content: content.to_string(),
                    active_form: content.to_string(),
                    status,
                })
            })
            .collect();

        if parsed_todos.is_empty() {
            None
        } else {
            Some(parsed_todos)
        }
    }

    pub fn parse_usage_telemetry_impl(
        &self,
        data: &serde_json::Value,
        fallback_session_id: Option<&str>,
    ) -> Result<ParsedUsageTelemetry, ParseError> {
        parse_standard_usage_telemetry(data, fallback_session_id)
    }
}
