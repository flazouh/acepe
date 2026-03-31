//! Types for the agent parser system.
//!
//! This module defines the core types used by all agent parsers:
//! - `AgentType`: Identifies which agent we're parsing for
//! - `ParseError`: Errors that can occur during parsing
//! - `UpdateType`: The type of session update being parsed
//! - `AgentParser`: The trait all parsers must implement

use std::fmt;

use crate::acp::parsers::kind as kind_utils;
use crate::acp::session_update::{
    PlanConfidence, PlanData, PlanSource, ToolArguments, ToolCallData, ToolCallUpdateData,
    ToolKind, UsageTelemetryData, UsageTelemetryTokens,
};

// Re-import parser structs for get_parser factory
use crate::acp::parsers::claude_code_parser::ClaudeCodeParser;
use crate::acp::parsers::copilot_parser::CopilotParser;
use crate::acp::parsers::codex_parser::CodexParser;
use crate::acp::parsers::cursor_parser::CursorParser;
use crate::acp::parsers::opencode_parser::OpenCodeParser;

/// Identifies which agent we're parsing for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentType {
    ClaudeCode,
    Copilot,
    OpenCode,
    Cursor,
    Codex,
}

impl AgentType {
    /// String identifier for this agent type.
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "claude-code",
            AgentType::Copilot => "copilot",
            AgentType::OpenCode => "opencode",
            AgentType::Cursor => "cursor",
            AgentType::Codex => "codex",
        }
    }

    /// Plan file path patterns for this agent, if file-based plans are supported.
    ///
    /// Returns `(dir_pattern, ext_pattern)` used to match plan file paths.
    pub fn plan_file_patterns(&self) -> Option<(&'static str, &'static str)> {
        match self {
            AgentType::ClaudeCode => Some((".claude/plans/", ".md")),
            AgentType::Copilot => Some((".claude/plans/", ".md")),
            AgentType::Cursor => Some((".cursor/plans/", ".plan.md")),
            AgentType::OpenCode | AgentType::Codex => None,
        }
    }

    /// Convert from CanonicalAgentId to AgentType.
    pub fn from_canonical(canonical: &crate::acp::types::CanonicalAgentId) -> Self {
        match canonical {
            crate::acp::types::CanonicalAgentId::ClaudeCode => AgentType::ClaudeCode,
            crate::acp::types::CanonicalAgentId::Copilot => AgentType::Copilot,
            crate::acp::types::CanonicalAgentId::OpenCode => AgentType::OpenCode,
            crate::acp::types::CanonicalAgentId::Cursor => AgentType::Cursor,
            crate::acp::types::CanonicalAgentId::Codex => AgentType::Codex,
            crate::acp::types::CanonicalAgentId::Custom(_) => {
                // Custom agents default to ClaudeCode format for now
                AgentType::ClaudeCode
            }
        }
    }
}

/// Errors that can occur during parsing.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq)]
pub enum ParseError {
    /// A required field is missing from the input.
    MissingField(String),
    /// The input format is invalid.
    InvalidFormat(String),
    /// The update type is unknown.
    UnknownUpdateType(String),
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::MissingField(field) => write!(f, "Missing required field: {}", field),
            ParseError::InvalidFormat(msg) => write!(f, "Invalid format: {}", msg),
            ParseError::UnknownUpdateType(t) => write!(f, "Unknown update type: {}", t),
        }
    }
}

impl std::error::Error for ParseError {}

/// The type of session update being parsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateType {
    UserMessageChunk,
    AgentMessageChunk,
    AgentThoughtChunk,
    ToolCall,
    ToolCallUpdate,
    Plan,
    AvailableCommandsUpdate,
    CurrentModeUpdate,
    ConfigOptionUpdate,
    PermissionRequest,
    QuestionRequest,
    UsageTelemetryUpdate,
}

/// A single option in a question.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedQuestionOption {
    pub label: String,
    pub description: String,
}

/// A parsed question in unified format.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedQuestion {
    pub question: String,
    pub header: String,
    pub options: Vec<ParsedQuestionOption>,
    pub multi_select: bool,
}

/// Status of a todo item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParsedTodoStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

/// A parsed todo item in unified format.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTodo {
    pub content: String,
    pub active_form: String,
    pub status: ParsedTodoStatus,
}

/// Parsed token counts for usage telemetry.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedUsageTokens {
    pub total: Option<u64>,
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub cache_read: Option<u64>,
    pub cache_write: Option<u64>,
    pub reasoning: Option<u64>,
}

/// Parsed usage telemetry in a parser-owned canonical model.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedUsageTelemetry {
    pub session_id: String,
    pub event_id: Option<String>,
    pub scope: String,
    pub cost_usd: Option<f64>,
    pub tokens: ParsedUsageTokens,
    pub source_model_id: Option<String>,
    pub timestamp_ms: Option<i64>,
    pub context_window_size: Option<u64>,
}

impl ParsedUsageTelemetry {
    pub fn into_usage_telemetry_data(self) -> UsageTelemetryData {
        UsageTelemetryData {
            session_id: self.session_id,
            event_id: self.event_id,
            scope: self.scope,
            cost_usd: self.cost_usd,
            tokens: UsageTelemetryTokens {
                total: self.tokens.total,
                input: self.tokens.input,
                output: self.tokens.output,
                cache_read: self.tokens.cache_read,
                cache_write: self.tokens.cache_write,
                reasoning: self.tokens.reasoning,
            },
            source_model_id: self.source_model_id,
            timestamp_ms: self.timestamp_ms,
            context_window_size: self.context_window_size,
        }
    }
}

/// Maximum content size for non-streaming plan detection (matches streaming accumulator).
const MAX_PLAN_CONTENT_SIZE: usize = 1_048_576;

/// Shared helper for `extract_plan_from_raw_input` — builds `PlanData` from a Write/Edit
/// tool's `rawInput` when the file path matches an agent-specific plan directory pattern.
pub(crate) fn extract_plan_from_raw_input_impl(
    parser: &dyn AgentParser,
    tool_name: &str,
    raw_input: &serde_json::Value,
) -> Option<PlanData> {
    if !(tool_name.eq_ignore_ascii_case("write") || tool_name.eq_ignore_ascii_case("edit")) {
        return None;
    }
    let (dir_pattern, ext_pattern) = parser.agent_type().plan_file_patterns()?;
    let file_path = raw_input
        .get("file_path")
        .or_else(|| raw_input.get("filePath"))
        .and_then(|v| v.as_str())?;
    if !file_path.contains(dir_pattern) || !file_path.ends_with(ext_pattern) {
        return None;
    }
    let content = raw_input
        .get("content")
        .or_else(|| raw_input.get("new_string"))
        .or_else(|| raw_input.get("newString"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let content = if content.len() > MAX_PLAN_CONTENT_SIZE {
        &content[..MAX_PLAN_CONTENT_SIZE]
    } else {
        content
    };
    let title = content
        .lines()
        .find(|line| line.starts_with("# "))
        .map(|line| line.trim_start_matches("# ").to_string());
    let content_owned = content.to_string();
    Some(PlanData {
        steps: vec![],
        current_step: None,
        has_plan: true,
        streaming: false,
        content: Some(content_owned.clone()),
        content_markdown: Some(content_owned),
        file_path: Some(file_path.to_string()),
        title,
        source: Some(PlanSource::Deterministic),
        confidence: Some(PlanConfidence::High),
        agent_id: Some(parser.agent_type().as_str().to_string()),
        updated_at: Some(chrono::Utc::now().timestamp_millis()),
    })
}

/// Trait that all agent parsers must implement.
pub trait AgentParser: Send + Sync {
    fn agent_type(&self) -> AgentType;
    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType>;
    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError>;
    fn parse_tool_call(&self, data: &serde_json::Value) -> Result<ToolCallData, ParseError>;
    fn parse_tool_call_update(
        &self,
        data: &serde_json::Value,
        session_id: Option<&str>,
    ) -> Result<ToolCallUpdateData, ParseError>;
    fn parse_questions(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>>;
    fn parse_todos(&self, name: &str, arguments: &serde_json::Value) -> Option<Vec<ParsedTodo>>;
    fn detect_tool_kind(&self, name: &str) -> ToolKind;
    fn parse_typed_tool_arguments(
        &self,
        tool_name: Option<&str>,
        raw_arguments: &serde_json::Value,
        kind_hint: Option<&str>,
    ) -> Option<ToolArguments>;
    /// Infer a stable display name for tool UI rows.
    fn infer_tool_display_name(
        &self,
        tool_name: Option<&str>,
        raw_arguments: &serde_json::Value,
        kind_hint: Option<&str>,
    ) -> String {
        if let Some(name) = tool_name.map(str::trim).filter(|value| !value.is_empty()) {
            return name.to_string();
        }

        if let Some(arguments) = self.parse_typed_tool_arguments(None, raw_arguments, kind_hint) {
            return kind_utils::canonical_name_for_kind(arguments.tool_kind()).to_string();
        }

        if let Some(hint) = kind_hint.map(str::trim).filter(|value| !value.is_empty()) {
            return kind_utils::canonical_name_for_kind(self.detect_tool_kind(hint)).to_string();
        }

        "Tool".to_string()
    }
    fn parse_usage_telemetry(
        &self,
        data: &serde_json::Value,
        fallback_session_id: Option<&str>,
    ) -> Result<ParsedUsageTelemetry, ParseError>;
    fn extract_plan_from_raw_input(
        &self,
        _tool_name: &str,
        _raw_input: &serde_json::Value,
    ) -> Option<PlanData> {
        None
    }
}

// ---------------------------------------------------------------------------
// Shared helpers used by multiple parsers
// ---------------------------------------------------------------------------

pub(crate) fn parse_common_update_type_name(update_type: &str) -> Option<UpdateType> {
    match update_type {
        "userMessageChunk" | "user_message_chunk" => Some(UpdateType::UserMessageChunk),
        "agentMessageChunk" | "agent_message_chunk" => Some(UpdateType::AgentMessageChunk),
        "agentThoughtChunk" | "agent_thought_chunk" => Some(UpdateType::AgentThoughtChunk),
        "toolCall" | "tool_call" | "tool_use" => Some(UpdateType::ToolCall),
        "toolCallUpdate" | "tool_call_update" | "tool_result" => Some(UpdateType::ToolCallUpdate),
        "plan" => Some(UpdateType::Plan),
        "availableCommandsUpdate" | "available_commands_update" => {
            Some(UpdateType::AvailableCommandsUpdate)
        }
        "currentModeUpdate" | "current_mode_update" => Some(UpdateType::CurrentModeUpdate),
        "configOptionUpdate" | "config_option_update" => Some(UpdateType::ConfigOptionUpdate),
        "permissionRequest" | "permission_request" => Some(UpdateType::PermissionRequest),
        "questionRequest" | "question_request" => Some(UpdateType::QuestionRequest),
        "usageTelemetryUpdate" | "usage_telemetry_update" | "usageUpdate" | "usage_update" => {
            Some(UpdateType::UsageTelemetryUpdate)
        }
        _ => None,
    }
}

pub(crate) fn parse_standard_usage_telemetry(
    data: &serde_json::Value,
    fallback_session_id: Option<&str>,
) -> Result<ParsedUsageTelemetry, ParseError> {
    let mut usage: UsageTelemetryData = serde_json::from_value(data.clone())
        .map_err(|e| ParseError::InvalidFormat(format!("usage telemetry: {}", e)))?;

    if usage.session_id.is_empty() {
        let session_id =
            fallback_session_id.ok_or_else(|| ParseError::MissingField("sessionId".to_string()))?;
        usage.session_id = session_id.to_string();
    }

    Ok(ParsedUsageTelemetry {
        session_id: usage.session_id,
        event_id: usage.event_id,
        scope: usage.scope,
        cost_usd: usage.cost_usd,
        tokens: ParsedUsageTokens {
            total: usage.tokens.total,
            input: usage.tokens.input,
            output: usage.tokens.output,
            cache_read: usage.tokens.cache_read,
            cache_write: usage.tokens.cache_write,
            reasoning: usage.tokens.reasoning,
        },
        source_model_id: usage.source_model_id,
        timestamp_ms: usage.timestamp_ms,
        context_window_size: usage.context_window_size,
    })
}

/// Shared parsing for ask-user / question tools (Claude "AskUserQuestion", Codex "functions.request_user_input").
///
/// Returns `None` if `name` is not a question tool or the arguments do not contain a valid questions array.
/// For "AskUserQuestion", header and multiSelect are required; options require description.
/// For "functions.request_user_input", header/options/multi_select are optional with defaults.
pub(crate) fn parse_ask_user_question(
    name: &str,
    arguments: &serde_json::Value,
) -> Option<Vec<ParsedQuestion>> {
    let strict = name == "AskUserQuestion";
    if !strict && name != "functions.request_user_input" {
        return None;
    }

    let questions_array = arguments
        .get("questions")
        .or_else(|| arguments.get("raw").and_then(|r| r.get("questions")))
        .and_then(|v| v.as_array())?;

    if questions_array.is_empty() {
        return None;
    }

    let parsed: Vec<ParsedQuestion> = questions_array
        .iter()
        .filter_map(|q| {
            let question_text = q.get("question")?.as_str()?.trim();
            if question_text.is_empty() {
                return None;
            }
            let header = if strict {
                q.get("header")?.as_str()?.trim().to_string()
            } else {
                q.get("header")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or(question_text)
                    .to_string()
            };
            if strict && header.is_empty() {
                return None;
            }
            let options: Vec<ParsedQuestionOption> = q
                .get("options")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|opt| {
                            let label = opt.get("label")?.as_str()?.trim();
                            if label.is_empty() {
                                return None;
                            }
                            let description = if strict {
                                opt.get("description")?.as_str()?.to_string()
                            } else {
                                opt.get("description")
                                    .and_then(|v| v.as_str())
                                    .map(str::trim)
                                    .unwrap_or_default()
                                    .to_string()
                            };
                            Some(ParsedQuestionOption {
                                label: label.to_string(),
                                description,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let multi_select = if strict {
                q.get("multiSelect").and_then(|v| v.as_bool())?
            } else {
                q.get("multiSelect")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            };

            Some(ParsedQuestion {
                question: question_text.to_string(),
                header,
                options,
                multi_select,
            })
        })
        .collect();

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

/// Shared parsing for todo tools (Claude/Codex "TodoWrite" with `todos` array).
///
/// Returns `None` if `name` is not "TodoWrite" or the arguments do not contain a valid todos array.
pub(crate) fn parse_todo_write(
    name: &str,
    arguments: &serde_json::Value,
) -> Option<Vec<ParsedTodo>> {
    if name != "TodoWrite" {
        return None;
    }

    let todos_array = arguments
        .get("todos")
        .or_else(|| arguments.get("raw").and_then(|r| r.get("todos")))
        .and_then(|v| v.as_array())?;

    if todos_array.is_empty() {
        return None;
    }

    let parsed: Vec<ParsedTodo> = todos_array
        .iter()
        .filter_map(|t| {
            let content = t.get("content")?.as_str()?;
            let status_str = t.get("status")?.as_str()?;
            let status = match status_str {
                "pending" => ParsedTodoStatus::Pending,
                "in_progress" | "TODO_STATUS_IN_PROGRESS" => ParsedTodoStatus::InProgress,
                "completed" | "TODO_STATUS_COMPLETED" => ParsedTodoStatus::Completed,
                "cancelled" | "TODO_STATUS_CANCELLED" => ParsedTodoStatus::Cancelled,
                _ => return None,
            };
            let active_form = t.get("activeForm")?.as_str()?.to_string();

            Some(ParsedTodo {
                content: content.to_string(),
                active_form,
                status,
            })
        })
        .collect();

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/// Factory function to get a parser for a specific agent.
pub fn get_parser(agent: AgentType) -> &'static dyn AgentParser {
    match agent {
        AgentType::ClaudeCode => &ClaudeCodeParser,
        AgentType::Copilot => &CopilotParser,
        AgentType::OpenCode => &OpenCodeParser,
        AgentType::Cursor => &CursorParser,
        AgentType::Codex => &CodexParser,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    mod codex_parser {
        use super::*;
        use crate::acp::session_update::{ToolArguments, ToolCallStatus};

        #[test]
        fn codex_parses_acp_tool_call_payload() {
            let payload = json!({
                "toolCallId": "tool-1",
                "title": "Run command",
                "name": "codex.execute",
                "kind": "execute",
                "status": "in_progress",
                "rawInput": { "command": "echo ok" }
            });

            let parsed = CodexParser
                .parse_tool_call(&payload)
                .expect("parse should succeed");
            assert_eq!(parsed.id, "tool-1");
            assert_eq!(parsed.name, "codex.execute");
            assert_eq!(parsed.title, Some("Run command".to_string()));
            assert_eq!(parsed.status, ToolCallStatus::InProgress);
            assert_eq!(parsed.kind, Some(ToolKind::Execute));
            assert!(matches!(parsed.arguments, ToolArguments::Execute { .. }));
        }

        #[test]
        fn codex_preserves_web_search_kind_when_query_present() {
            let payload = json!({
                "toolCallId": "tool-web-1",
                "name": "WebSearch",
                "status": "pending",
                "rawInput": { "query": "svelte 5 runes" }
            });

            let parsed = CodexParser
                .parse_tool_call(&payload)
                .expect("parse should succeed");

            assert_eq!(parsed.kind, Some(ToolKind::WebSearch));
            assert!(matches!(parsed.arguments, ToolArguments::WebSearch { .. }));
        }

        #[test]
        fn codex_infers_web_search_from_kind_and_tool_call_id() {
            let payload = json!({
                "toolCallId": "web_search_8ad1453c-2615-4d7d-8a25-85206970565e",
                "kind": "search",
                "title": "Searching the Web",
                "status": "completed"
            });

            let parsed = CodexParser
                .parse_tool_call(&payload)
                .expect("parse should succeed");

            assert_eq!(parsed.name, "WebSearch");
            assert_eq!(parsed.kind, Some(ToolKind::WebSearch));
            assert!(matches!(parsed.arguments, ToolArguments::WebSearch { .. }));
        }

        #[test]
        fn codex_infers_web_search_when_fetch_kind_uses_ws_id_and_search_action() {
            let payload = json!({
                "toolCallId": "ws_0858e3ee568c89da016999952b3d008191abd78047065392c6",
                "kind": "fetch",
                "title": "Searching the Web",
                "status": "in_progress",
                "rawInput": {
                    "action": {
                        "type": "search",
                        "query": "OpenAI",
                        "queries": ["OpenAI"]
                    },
                    "query": "OpenAI"
                }
            });

            let parsed = CodexParser
                .parse_tool_call(&payload)
                .expect("parse should succeed");

            assert_eq!(parsed.name, "WebSearch");
            assert_eq!(parsed.kind, Some(ToolKind::WebSearch));
        }

        #[test]
        fn codex_maps_exec_command_to_execute_kind() {
            let payload = json!({
                "toolCallId": "tool-exec-1",
                "name": "exec_command",
                "status": "in_progress",
                "rawInput": { "cmd": "ls -la" }
            });

            let parsed = CodexParser
                .parse_tool_call(&payload)
                .expect("parse should succeed");

            assert_eq!(parsed.name, "exec_command");
            assert_eq!(parsed.kind, Some(ToolKind::Execute));
            assert!(matches!(parsed.arguments, ToolArguments::Execute { .. }));
        }

        #[test]
        fn codex_falls_back_to_kind_name_for_verbose_titles() {
            let payload = json!({
                "toolCallId": "tool-search-1",
                "title": "Search branch:main|branch: in desktop",
                "kind": "search",
                "status": "running"
            });

            let parsed = CodexParser
                .parse_tool_call(&payload)
                .expect("parse should succeed");

            assert_eq!(parsed.name, "Search");
            assert_eq!(parsed.kind, Some(ToolKind::Search));
        }

        #[test]
        fn codex_overrides_mislabeled_search_kind_for_list_files_commands() {
            let payload = json!({
                "toolCallId": "tool-list-1",
                "title": "List /Users/example/Documents/acepe",
                "kind": "search",
                "status": "in_progress",
                "rawInput": {
                    "command": ["/bin/zsh", "-lc", "ls"],
                    "parsed_cmd": [
                        {
                            "cmd": "ls",
                            "path": null,
                            "type": "list_files"
                        }
                    ]
                }
            });

            let parsed = CodexParser
                .parse_tool_call(&payload)
                .expect("parse should succeed");

            assert_eq!(parsed.name, "Run");
            assert_eq!(parsed.kind, Some(ToolKind::Execute));
        }

        #[test]
        fn codex_detects_pending_status_as_tool_call_without_raw_input() {
            let payload = json!({
                "toolCallId": "tool-search-2",
                "title": "Search branch:main",
                "status": "running"
            });

            let detected = CodexParser
                .detect_update_type(&payload)
                .expect("detect should succeed");

            assert_eq!(detected, UpdateType::ToolCall);
        }

        #[test]
        fn codex_infers_update_status_from_exit_code_object() {
            let payload = json!({
                "toolCallId": "tool-exec-2",
                "output": { "stdout": "ok", "exitCode": 0 }
            });

            let parsed = CodexParser
                .parse_tool_call_update(&payload, None)
                .expect("parse should succeed");

            assert_eq!(parsed.tool_call_id, "tool-exec-2");
            assert_eq!(parsed.status, Some(ToolCallStatus::Completed));
        }

        #[test]
        fn codex_infers_update_status_from_output_text() {
            let payload = json!({
                "toolCallId": "tool-exec-3",
                "rawOutput": "Process exited with code 127"
            });

            let parsed = CodexParser
                .parse_tool_call_update(&payload, None)
                .expect("parse should succeed");

            assert_eq!(parsed.status, Some(ToolCallStatus::Failed));
        }

        #[test]
        fn codex_tool_call_update_preserves_raw_input_and_infers_execute_kind() {
            let payload = json!({
                "toolCallId": "tool-exec-5",
                "status": "completed",
                "title": "exec_command",
                "rawInput": {
                    "cmd": "echo ok",
                    "workdir": "/tmp"
                }
            });

            let parsed = CodexParser
                .parse_tool_call_update(&payload, None)
                .expect("parse should succeed");

            assert_eq!(parsed.status, Some(ToolCallStatus::Completed));
            assert!(parsed.arguments.is_some());
            assert!(matches!(
                parsed.arguments.as_ref().unwrap(),
                ToolArguments::Execute { .. }
            ));
        }

        #[test]
        fn codex_tool_call_update_infers_edit_kind_from_raw_input_fields() {
            let payload = json!({
                "toolCallId": "tool-edit-6",
                "status": "completed",
                "rawInput": {
                    "file_path": "/tmp/file.ts",
                    "old_string": "const a = 1;",
                    "new_string": "const a = 2;"
                }
            });

            let parsed = CodexParser
                .parse_tool_call_update(&payload, None)
                .expect("parse should succeed");

            assert_eq!(parsed.status, Some(ToolCallStatus::Completed));
            assert!(parsed.arguments.is_some());
            assert!(matches!(
                parsed.arguments.as_ref().unwrap(),
                ToolArguments::Edit { .. }
            ));
        }

        #[test]
        fn codex_parse_typed_tool_arguments_extracts_changes_map_as_edit() {
            let raw = json!({
                "changes": {
                    "/Users/example/Downloads/sample-go-project/README.md": {
                        "type": "add",
                        "content": "# sample-go-project"
                    }
                }
            });

            let parsed = CodexParser
                .parse_typed_tool_arguments(Some("Edit"), &raw, Some("edit"))
                .expect("typed args should parse");

            match parsed {
                ToolArguments::Edit { edits } => {
                    let e = edits.first().expect("edit entry");
                    assert_eq!(
                        e.file_path.as_deref(),
                        Some("/Users/example/Downloads/sample-go-project/README.md")
                    );
                    assert_eq!(e.old_string, None);
                    assert_eq!(e.new_string.as_deref(), Some("# sample-go-project"));
                    assert_eq!(e.content.as_deref(), Some("# sample-go-project"));
                }
                other => panic!("expected edit arguments, got {:?}", other),
            }
        }

        #[test]
        fn codex_parse_typed_tool_arguments_extracts_old_new_content_changes_map_as_edit() {
            let raw = json!({
                "changes": {
                    "/Users/example/Downloads/sample-go-project/block.go": {
                        "old_content": "package main\n\nfunc main() {}\n",
                        "new_content": "package main\n\nfunc main() {\n\tprintln(\"hi\")\n}\n"
                    }
                }
            });

            let parsed = CodexParser
                .parse_typed_tool_arguments(Some("Edit"), &raw, Some("edit"))
                .expect("typed args should parse");

            match parsed {
                ToolArguments::Edit { edits } => {
                    let e = edits.first().expect("edit entry");
                    assert_eq!(
                        e.file_path.as_deref(),
                        Some("/Users/example/Downloads/sample-go-project/block.go")
                    );
                    assert_eq!(
                        e.old_string.as_deref(),
                        Some("package main\n\nfunc main() {}")
                    );
                    assert_eq!(
                        e.new_string.as_deref(),
                        Some("package main\n\nfunc main() {\n\tprintln(\"hi\")\n}")
                    );
                    assert_eq!(
                        e.content.as_deref(),
                        Some("package main\n\nfunc main() {\n\tprintln(\"hi\")\n}")
                    );
                }
                other => panic!("expected edit arguments, got {:?}", other),
            }
        }

        #[test]
        fn infer_tool_display_name_prefers_explicit_non_empty_name() {
            let raw = json!({
                "command": "ls -la"
            });

            let name =
                CodexParser.infer_tool_display_name(Some("exec_command"), &raw, Some("execute"));
            assert_eq!(name, "exec_command");
        }

        #[test]
        fn infer_tool_display_name_falls_back_to_parsed_kind_when_name_missing() {
            let raw = json!({
                "command": ["/bin/zsh", "-lc", "echo hello"]
            });

            let name = CodexParser.infer_tool_display_name(Some("   "), &raw, Some("execute"));
            assert_eq!(name, "Run");
        }

        #[test]
        fn adapter_conformance_parses_edit_arguments_across_agents() {
            let expected_path = "/tmp/readme.md";
            let expected_content = "# title";

            let cases: Vec<(&dyn AgentParser, &str, serde_json::Value, Option<&str>)> = vec![
                (
                    &ClaudeCodeParser,
                    "Edit",
                    json!({
                        "file_path": expected_path,
                        "content": expected_content
                    }),
                    Some("edit"),
                ),
                (
                    &OpenCodeParser,
                    "EditFile",
                    json!({
                        "filePath": expected_path,
                        "new_string": expected_content
                    }),
                    Some("edit"),
                ),
                (
                    &CursorParser,
                    "edit",
                    json!({
                        "path": expected_path,
                        "content": expected_content
                    }),
                    Some("edit"),
                ),
                (
                    &CodexParser,
                    "Edit",
                    json!({
                        "changes": {
                            expected_path: {
                                "type": "add",
                                "content": expected_content
                            }
                        }
                    }),
                    Some("edit"),
                ),
            ];

            for (parser, tool_name, raw, kind_hint) in cases {
                let parsed = parser
                    .parse_typed_tool_arguments(Some(tool_name), &raw, kind_hint)
                    .expect("typed args should parse");

                match parsed {
                    ToolArguments::Edit { edits } => {
                        let e = edits.first().expect("edit entry");
                        assert_eq!(e.file_path.as_deref(), Some(expected_path));
                        assert!(
                            e.content.as_deref() == Some(expected_content)
                                || e.new_string.as_deref() == Some(expected_content),
                            "expected content/new_string for parser {}",
                            parser.agent_type().as_str()
                        );
                    }
                    other => panic!(
                        "expected edit arguments for parser {}, got {:?}",
                        parser.agent_type().as_str(),
                        other
                    ),
                }
            }
        }

        #[test]
        fn adapter_conformance_parses_old_new_content_changes_map_for_all_agents() {
            let expected_path = "/tmp/block.go";
            let expected_old = "package main\n\nfunc main() {}";
            let expected_new = "package main\n\nfunc main() {\n\tprintln(\"hi\")\n}";
            let raw = json!({
                "changes": {
                    expected_path: {
                        "old_content": expected_old,
                        "new_content": expected_new
                    }
                }
            });

            let cases: Vec<(&dyn AgentParser, &str)> = vec![
                (&ClaudeCodeParser, "Edit"),
                (&OpenCodeParser, "EditFile"),
                (&CursorParser, "edit"),
                (&CodexParser, "Edit"),
            ];

            for (parser, tool_name) in cases {
                let parsed = parser
                    .parse_typed_tool_arguments(Some(tool_name), &raw, Some("edit"))
                    .expect("typed args should parse");

                match parsed {
                    ToolArguments::Edit { edits } => {
                        let e = edits.first().expect("edit entry");
                        assert_eq!(e.file_path.as_deref(), Some(expected_path));
                        assert_eq!(e.old_string.as_deref(), Some(expected_old));
                        assert_eq!(e.new_string.as_deref(), Some(expected_new));
                        assert_eq!(e.content.as_deref(), Some(expected_new));
                    }
                    other => panic!(
                        "expected edit arguments for parser {}, got {:?}",
                        parser.agent_type().as_str(),
                        other,
                    ),
                }
            }
        }

        #[test]
        fn codex_marks_completed_update_failed_when_output_has_command_not_found() {
            let payload = json!({
                "toolCallId": "tool-exec-4",
                "status": "completed",
                "rawOutput": {
                    "status": "completed",
                    "stdout": "zsh:1: command not found: rg\n",
                    "exit_code": 0
                }
            });

            let parsed = CodexParser
                .parse_tool_call_update(&payload, None)
                .expect("parse should succeed");

            assert_eq!(parsed.status, Some(ToolCallStatus::Failed));
        }

        #[test]
        fn codex_detects_usage_update_from_compact_payload() {
            let payload = json!({
                "sessionUpdate": "usage_update",
                "sessionId": "sess-codex-usage-compact",
                "used": 32451,
                "size": 258400
            });

            let detected = CodexParser
                .detect_update_type(&payload)
                .expect("detect should succeed");

            assert_eq!(detected, UpdateType::UsageTelemetryUpdate);
        }

        #[test]
        fn codex_parses_request_user_input_questions() {
            let name = "functions.request_user_input";
            let arguments = json!({
                "questions": [
                    {
                        "header": "Theme",
                        "question": "Which theme should we use?",
                        "options": [
                            { "label": "Light", "description": "Bright UI" },
                            { "label": "Dark", "description": "Dim UI" }
                        ]
                    }
                ]
            });

            let parsed = CodexParser
                .parse_questions(name, &arguments)
                .expect("questions should parse");
            assert_eq!(parsed.len(), 1);
            assert_eq!(parsed[0].header, "Theme");
            assert_eq!(parsed[0].question, "Which theme should we use?");
            assert_eq!(parsed[0].options.len(), 2);
            assert!(!parsed[0].multi_select);
        }
    }

    mod usage_telemetry_parser {
        use super::*;

        #[test]
        fn claude_parses_usage_update_payload() {
            let payload = json!({
                "sessionId": "sess-usage",
                "used": 3210,
                "size": 200000,
                "cost": { "amount": 0.0123, "currency": "USD" }
            });

            let parsed = ClaudeCodeParser
                .parse_usage_telemetry(&payload, None)
                .expect("usage should parse");

            assert_eq!(parsed.session_id, "sess-usage");
            assert_eq!(parsed.tokens.total, Some(3210));
            assert_eq!(parsed.cost_usd, Some(0.0123));
            assert_eq!(parsed.scope, "turn");
            assert_eq!(parsed.context_window_size, Some(200000));
        }

        #[test]
        fn claude_compaction_resets_usage_to_zero() {
            let payload = json!({
                "sessionId": "sess-reset",
                "compaction": true,
                "cost": { "amount": 0.0, "currency": "USD" }
            });

            let parsed = ClaudeCodeParser
                .parse_usage_telemetry(&payload, None)
                .expect("usage should parse");

            assert_eq!(parsed.session_id, "sess-reset");
            assert_eq!(parsed.tokens.total, Some(0));
        }

        #[test]
        fn codex_parses_standard_usage_payload() {
            let payload = json!({
                "sessionId": "sess-codex-usage",
                "scope": "step",
                "tokens": {
                    "total": 777,
                    "input": 600,
                    "output": 177
                },
                "costUsd": 0.001
            });

            let parsed = CodexParser
                .parse_usage_telemetry(&payload, None)
                .expect("usage should parse");

            assert_eq!(parsed.session_id, "sess-codex-usage");
            assert_eq!(parsed.scope, "step");
            assert_eq!(parsed.tokens.total, Some(777));
            assert_eq!(parsed.tokens.input, Some(600));
            assert_eq!(parsed.tokens.output, Some(177));
        }

        #[test]
        fn codex_parses_compact_usage_update_payload() {
            let payload = json!({
                "sessionId": "sess-codex-compact",
                "sessionUpdate": "usage_update",
                "used": 32451,
                "size": 258400
            });

            let parsed = CodexParser
                .parse_usage_telemetry(&payload, None)
                .expect("usage should parse");

            assert_eq!(parsed.session_id, "sess-codex-compact");
            assert_eq!(parsed.scope, "step");
            assert_eq!(parsed.tokens.total, Some(32451));
            assert_eq!(parsed.context_window_size, Some(258400));
        }
    }

    mod extract_plan_from_raw_input {
        use super::*;

        #[test]
        fn claude_code_detects_write_to_plan_file() {
            let parser = ClaudeCodeParser;
            let raw_input = json!({
                "file_path": "/Users/test/.claude/plans/my-plan.md",
                "content": "# My Plan\n\nStep 1: do something"
            });
            let plan = parser
                .extract_plan_from_raw_input("Write", &raw_input)
                .expect("should detect plan write");
            assert_eq!(plan.title.as_deref(), Some("My Plan"));
            assert_eq!(
                plan.file_path.as_deref(),
                Some("/Users/test/.claude/plans/my-plan.md")
            );
            assert_eq!(
                plan.content.as_deref(),
                Some("# My Plan\n\nStep 1: do something")
            );
            assert!(plan.has_plan);
            assert!(!plan.streaming);
            assert_eq!(plan.source, Some(PlanSource::Deterministic));
            assert_eq!(plan.confidence, Some(PlanConfidence::High));
        }

        #[test]
        fn claude_code_detects_edit_to_plan_file() {
            let parser = ClaudeCodeParser;
            let raw_input = json!({
                "file_path": "/Users/test/.claude/plans/my-plan.md",
                "new_string": "# Updated Plan\n\nNew content"
            });
            let plan = parser
                .extract_plan_from_raw_input("Edit", &raw_input)
                .expect("should detect plan edit");
            assert_eq!(plan.title.as_deref(), Some("Updated Plan"));
            assert_eq!(
                plan.content.as_deref(),
                Some("# Updated Plan\n\nNew content")
            );
        }

        #[test]
        fn claude_code_ignores_non_plan_file() {
            let parser = ClaudeCodeParser;
            let raw_input = json!({
                "file_path": "/tmp/foo.md",
                "content": "# Not a plan"
            });
            assert!(parser
                .extract_plan_from_raw_input("Write", &raw_input)
                .is_none());
        }

        #[test]
        fn claude_code_ignores_read_tool() {
            let parser = ClaudeCodeParser;
            let raw_input = json!({
                "file_path": "/Users/test/.claude/plans/my-plan.md"
            });
            assert!(parser
                .extract_plan_from_raw_input("Read", &raw_input)
                .is_none());
        }

        #[test]
        fn cursor_detects_write_to_plan_file() {
            let parser = CursorParser;
            let raw_input = json!({
                "file_path": "/Users/test/.cursor/plans/feature_abc123.plan.md",
                "content": "# Cursor Plan\n\nDo things"
            });
            let plan = parser
                .extract_plan_from_raw_input("Write", &raw_input)
                .expect("should detect cursor plan write");
            assert_eq!(plan.title.as_deref(), Some("Cursor Plan"));
            assert_eq!(
                plan.file_path.as_deref(),
                Some("/Users/test/.cursor/plans/feature_abc123.plan.md")
            );
        }

        #[test]
        fn cursor_ignores_non_plan_md() {
            let parser = CursorParser;
            let raw_input = json!({
                "file_path": "/Users/test/.cursor/plans/readme.md",
                "content": "not a plan file"
            });
            assert!(parser
                .extract_plan_from_raw_input("Write", &raw_input)
                .is_none());
        }

        #[test]
        fn opencode_returns_none() {
            let parser = OpenCodeParser;
            let raw_input = json!({
                "file_path": "/Users/test/.claude/plans/my-plan.md",
                "content": "# Plan"
            });
            assert!(parser
                .extract_plan_from_raw_input("Write", &raw_input)
                .is_none());
        }

        #[test]
        fn codex_returns_none() {
            let parser = CodexParser;
            let raw_input = json!({
                "file_path": "/Users/test/.claude/plans/my-plan.md",
                "content": "# Plan"
            });
            assert!(parser
                .extract_plan_from_raw_input("Write", &raw_input)
                .is_none());
        }
    }
}
