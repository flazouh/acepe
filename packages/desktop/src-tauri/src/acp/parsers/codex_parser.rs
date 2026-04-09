//! Parser for Codex agent.

use crate::acp::parsers::adapters::CodexAdapter;
use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::edit_normalizers::codex::parse_edit_arguments;
use crate::acp::parsers::kind as kind_utils;
use crate::acp::parsers::provider_capabilities::{ProviderCapabilities, provider_capabilities};
use crate::acp::parsers::status as status_utils;
use crate::acp::parsers::types::{
    AgentParser, AgentType, ParseError, ParsedQuestion, ParsedTodo, ParsedUsageTelemetry,
    ParsedUsageTokens, UpdateType, parse_ask_user_question, parse_common_update_type_name,
    parse_standard_usage_telemetry, parse_todo_write,
};
use crate::acp::session_update::{
    RawToolCallInput, RawToolCallUpdateInput, ToolArguments, ToolCallStatus, ToolKind,
    build_tool_call_from_raw, build_tool_call_update_from_raw, tool_call_status_from_str,
};

/// Case-insensitive substring check using ASCII lowering.
fn contains_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    if needle.len() > haystack.len() {
        return false;
    }
    haystack
        .as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

pub struct CodexParser;

impl AgentParser for CodexParser {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn capabilities(&self) -> &'static ProviderCapabilities {
        provider_capabilities(AgentType::Codex)
    }

    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType> {
        CodexParser.parse_update_type_name_impl(update_type)
    }

    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError> {
        CodexParser.detect_update_type_impl(data)
    }

    fn parse_tool_call(
        &self,
        data: &serde_json::Value,
    ) -> Result<crate::acp::session_update::ToolCallData, ParseError> {
        let raw = CodexParser.parse_tool_call_impl(data)?;
        Ok(build_tool_call_from_raw(self, raw))
    }

    fn parse_tool_call_update(
        &self,
        data: &serde_json::Value,
        session_id: Option<&str>,
    ) -> Result<crate::acp::session_update::ToolCallUpdateData, ParseError> {
        let raw = CodexParser.parse_tool_call_update_impl(data)?;
        Ok(build_tool_call_update_from_raw(self, raw, session_id))
    }

    fn parse_questions(
        &self,
        name: &str,
        arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>> {
        CodexParser.parse_questions_impl(name, arguments)
    }

    fn parse_todos(&self, name: &str, arguments: &serde_json::Value) -> Option<Vec<ParsedTodo>> {
        CodexParser.parse_todos_impl(name, arguments)
    }

    fn detect_tool_kind(&self, name: &str) -> ToolKind {
        CodexAdapter::normalize(name)
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

        let inferred_kind = tool_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| self.detect_tool_kind(name))
            .filter(|k| *k != ToolKind::Other)
            .or_else(|| kind_hint.map(|hint| self.detect_tool_kind(hint)))
            .unwrap_or(ToolKind::Other);

        if inferred_kind != ToolKind::Edit {
            return Some(parse_tool_kind_arguments(inferred_kind, raw_arguments));
        }
        Some(parse_edit_arguments(raw_arguments))
    }

    fn parse_usage_telemetry(
        &self,
        data: &serde_json::Value,
        fallback_session_id: Option<&str>,
    ) -> Result<ParsedUsageTelemetry, ParseError> {
        CodexParser.parse_usage_telemetry_impl(data, fallback_session_id)
    }
}

impl CodexParser {
    /// Resolve the final `ToolKind` from payload, argument, and name-based signals,
    /// then promote to `WebSearch` when ID/title/arguments look like a web search.
    fn resolve_kind(
        payload_kind: Option<ToolKind>,
        argument_kind: Option<ToolKind>,
        normalized_name_kind: ToolKind,
        id: &str,
        title: Option<&str>,
        arguments: Option<&serde_json::Value>,
    ) -> ToolKind {
        let base = if normalized_name_kind == ToolKind::WebSearch
            || payload_kind == Some(ToolKind::WebSearch)
        {
            ToolKind::WebSearch
        } else {
            match (payload_kind, argument_kind) {
                (Some(ToolKind::Search), Some(kind_from_arguments))
                    if kind_from_arguments != ToolKind::Search =>
                {
                    kind_from_arguments
                }
                (Some(kind_from_payload), _) => kind_from_payload,
                (None, Some(kind_from_arguments)) => kind_from_arguments,
                (None, None) => normalized_name_kind,
            }
        };

        if matches!(base, ToolKind::Fetch | ToolKind::Search)
            && (kind_utils::is_web_search_id(id)
                || title.map(kind_utils::is_web_search_title).unwrap_or(false)
                || arguments
                    .map(kind_utils::looks_like_web_search_arguments)
                    .unwrap_or(false))
        {
            ToolKind::WebSearch
        } else {
            base
        }
    }

    pub fn parse_update_type_name_impl(&self, update_type: &str) -> Option<UpdateType> {
        parse_common_update_type_name(update_type).or(match update_type {
            "text" => Some(UpdateType::AgentMessageChunk),
            _ => None,
        })
    }

    fn infer_name(
        explicit_name: Option<&str>,
        id: &str,
        title: Option<&str>,
        inferred_kind: ToolKind,
    ) -> String {
        if let Some(name) = explicit_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return name.to_string();
        }

        if inferred_kind == ToolKind::WebSearch {
            return "WebSearch".to_string();
        }

        if let Some(title_value) = title.map(str::trim).filter(|value| !value.is_empty()) {
            if id.starts_with("web_search_") || kind_utils::is_web_search_title(title_value) {
                return "WebSearch".to_string();
            }
        }

        kind_utils::canonical_name_for_kind(inferred_kind).to_string()
    }

    fn merge_outer_arguments(raw: &serde_json::Value) -> serde_json::Value {
        let Some(inner) = raw.get("arguments").and_then(|value| value.as_object()) else {
            return raw.clone();
        };

        let mut merged = inner.clone();
        if let Some(server) = raw.get("server") {
            merged
                .entry("server".to_string())
                .or_insert_with(|| server.clone());
        }
        if let Some(tool) = raw.get("tool") {
            merged
                .entry("tool".to_string())
                .or_insert_with(|| tool.clone());
        }

        serde_json::Value::Object(merged)
    }

    fn infer_kind_from_arguments(arguments: &serde_json::Value) -> Option<ToolKind> {
        let obj = arguments.as_object()?;

        if let Some(kind) = Self::infer_kind_from_parsed_cmd(obj.get("parsed_cmd")) {
            return Some(kind);
        }

        if let Some(tool) = obj.get("tool").and_then(|value| value.as_str()) {
            if contains_ignore_ascii_case(tool, "read_mcp_resource") {
                return Some(ToolKind::Read);
            }
            if contains_ignore_ascii_case(tool, "list_mcp_resource")
                || contains_ignore_ascii_case(tool, "list_mcp_resources")
                || contains_ignore_ascii_case(tool, "list_mcp_resource_templates")
            {
                return Some(ToolKind::Execute);
            }
            if contains_ignore_ascii_case(tool, "mcp_resource") {
                return Some(ToolKind::Execute);
            }
        }

        if Self::is_apply_patch_command(obj.get("command"))
            || Self::is_apply_patch_command(obj.get("cmd"))
        {
            return Some(ToolKind::Edit);
        }

        let has_edit_fields = [
            "old_string",
            "oldString",
            "new_string",
            "newString",
            "content",
        ]
        .iter()
        .any(|key| obj.contains_key(*key));
        if has_edit_fields {
            return Some(ToolKind::Edit);
        }

        let has_command = ["command", "cmd"].iter().any(|key| match obj.get(*key) {
            Some(serde_json::Value::String(value)) => !value.trim().is_empty(),
            Some(serde_json::Value::Array(values)) => values.iter().any(|v| v.as_str().is_some()),
            _ => false,
        });
        if has_command {
            return Some(ToolKind::Execute);
        }

        let has_search_fields = ["query", "pattern"]
            .iter()
            .any(|key| obj.contains_key(*key));
        if has_search_fields {
            return Some(ToolKind::Search);
        }

        if let Some(uri) = obj
            .get("uri")
            .or_else(|| obj.get("url"))
            .and_then(|value| value.as_str())
        {
            let trimmed = uri.trim();
            if trimmed.starts_with("file://") {
                return Some(ToolKind::Read);
            }
            if !trimmed.is_empty() {
                return Some(ToolKind::Fetch);
            }
        }

        let has_path_fields = ["file_path", "filePath", "path"]
            .iter()
            .any(|key| obj.contains_key(*key));
        if has_path_fields {
            return Some(ToolKind::Read);
        }

        None
    }

    fn infer_kind_from_parsed_cmd(parsed_cmd: Option<&serde_json::Value>) -> Option<ToolKind> {
        let entries = parsed_cmd?.as_array()?;

        for entry in entries {
            let Some(kind) = entry.get("type").and_then(|value| value.as_str()) else {
                continue;
            };

            if kind.eq_ignore_ascii_case("edit")
                || kind.eq_ignore_ascii_case("write")
                || kind.eq_ignore_ascii_case("multi_edit")
                || kind.eq_ignore_ascii_case("multiedit")
                || kind.eq_ignore_ascii_case("apply_patch")
            {
                return Some(ToolKind::Edit);
            }
            if kind.eq_ignore_ascii_case("read") {
                return Some(ToolKind::Read);
            }
            if kind.eq_ignore_ascii_case("search") || kind.eq_ignore_ascii_case("grep") {
                return Some(ToolKind::Search);
            }
            if kind.eq_ignore_ascii_case("list_files")
                || kind.eq_ignore_ascii_case("list_file")
                || kind.eq_ignore_ascii_case("list_dir")
                || kind.eq_ignore_ascii_case("list_directory")
                || kind.eq_ignore_ascii_case("ls")
            {
                return Some(ToolKind::Execute);
            }
            if kind.eq_ignore_ascii_case("move")
                || kind.eq_ignore_ascii_case("mv")
                || kind.eq_ignore_ascii_case("rename")
            {
                return Some(ToolKind::Move);
            }
            if kind.eq_ignore_ascii_case("delete")
                || kind.eq_ignore_ascii_case("remove")
                || kind.eq_ignore_ascii_case("rm")
            {
                return Some(ToolKind::Delete);
            }
            if kind.eq_ignore_ascii_case("bash")
                || kind.eq_ignore_ascii_case("execute")
                || kind.eq_ignore_ascii_case("run")
                || kind.eq_ignore_ascii_case("shell")
            {
                return Some(ToolKind::Execute);
            }
        }

        None
    }

    fn is_apply_patch_command(command: Option<&serde_json::Value>) -> bool {
        let Some(command) = command else {
            return false;
        };

        if let Some(command_str) = command.as_str() {
            return contains_ignore_ascii_case(command_str, "apply_patch");
        }

        let Some(command_parts) = command.as_array() else {
            return false;
        };
        command_parts.iter().any(|part| {
            part.as_str()
                .map(|value| contains_ignore_ascii_case(value, "apply_patch"))
                .unwrap_or(false)
        })
    }

    fn add_mcp_command_if_missing(arguments: &mut serde_json::Value) {
        let Some(obj) = arguments.as_object_mut() else {
            return;
        };

        if obj.contains_key("command") || obj.contains_key("cmd") {
            return;
        }

        let Some(tool) = obj.get("tool").and_then(|value| value.as_str()) else {
            return;
        };

        let command = match obj.get("server").and_then(|value| value.as_str()) {
            Some(server) if !server.trim().is_empty() => format!("mcp {}/{}", server, tool),
            _ => format!("mcp {}", tool),
        };

        obj.insert("command".to_string(), serde_json::Value::String(command));
    }

    pub fn detect_update_type_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<UpdateType, ParseError> {
        crate::acp::parsers::acp_fields::detect_acp_update_type(data, |s| {
            self.parse_update_type_name_impl(s)
        })
    }

    pub(crate) fn parse_tool_call_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallInput, ParseError> {
        let id = data
            .get("toolCallId")
            .or_else(|| data.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("toolCallId or id".to_string()))?;

        let title = data
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let payload_kind = kind_utils::infer_kind_from_payload(
            &id,
            title.as_deref(),
            data.get("kind").and_then(|value| value.as_str()),
        );

        let raw_arguments = data
            .get("rawInput")
            .or_else(|| data.get("raw_input"))
            .or_else(|| data.get("input"))
            .cloned()
            .unwrap_or(serde_json::json!({}));
        let arguments = Self::merge_outer_arguments(&raw_arguments);

        let status = tool_call_status_from_str(
            data.get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("pending"),
        );

        let explicit_name = data.get("name").and_then(|value| value.as_str());
        let provisional_name = explicit_name
            .map(str::to_string)
            .or_else(|| title.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let normalized_name_kind = CodexAdapter::normalize(&provisional_name);
        let argument_kind = Self::infer_kind_from_arguments(&arguments);
        let inferred_kind = Self::resolve_kind(
            payload_kind,
            argument_kind,
            normalized_name_kind,
            &id,
            title.as_deref(),
            Some(&arguments),
        );
        let name = explicit_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "unknown".to_string());
        let kind = Some(inferred_kind);
        let mut arguments = if inferred_kind == ToolKind::Other {
            raw_arguments
        } else {
            arguments
        };
        if inferred_kind == ToolKind::WebSearch
            && arguments
                .as_object()
                .map(|obj| obj.is_empty())
                .unwrap_or(false)
        {
            if let Some(query) = title
                .as_deref()
                .filter(|value| !kind_utils::is_web_search_title(value))
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                arguments = serde_json::json!({ "query": query });
            }
        }
        if inferred_kind == ToolKind::Execute {
            Self::add_mcp_command_if_missing(&mut arguments);
        }

        Ok(RawToolCallInput {
            id,
            name,
            arguments,
            status,
            kind,
            title,
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
            .get("toolCallId")
            .or_else(|| data.get("tool_use_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("toolCallId or tool_use_id".to_string()))?;

        let result = data
            .get("rawOutput")
            .or_else(|| data.get("raw_output"))
            .or_else(|| data.get("output"))
            .or_else(|| data.get("content"))
            .cloned();

        // Resolve explicit status directly to ToolCallStatus, skipping the
        // intermediate String allocation that normalize_status would produce.
        let explicit_status = data.get("status").and_then(|v| v.as_str()).and_then(|s| {
            let parsed = tool_call_status_from_str(s);
            // tool_call_status_from_str returns Pending for unrecognised input.
            // Distinguish genuine "pending" from unknown values.
            if parsed != ToolCallStatus::Pending || s.trim().eq_ignore_ascii_case("pending") {
                Some(parsed)
            } else {
                None
            }
        });
        let inferred_status = status_utils::infer_status_from_result(result.as_ref());
        let status = match (explicit_status, inferred_status.as_deref()) {
            (_, Some("failed")) => ToolCallStatus::Failed,
            (Some(s), _) => s,
            (None, Some(s)) => tool_call_status_from_str(s),
            (None, None) => ToolCallStatus::Pending,
        };

        let title = data
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let mut raw_input = data
            .get("rawInput")
            .or_else(|| data.get("raw_input"))
            .or_else(|| data.get("input"))
            .cloned()
            .filter(|v| !v.is_null())
            .map(|value| Self::merge_outer_arguments(&value));

        let explicit_name = data.get("name").and_then(|value| value.as_str());
        let payload_kind = kind_utils::infer_kind_from_payload(
            &id,
            title.as_deref(),
            data.get("kind").and_then(|value| value.as_str()),
        );
        let provisional_name = explicit_name
            .map(str::to_string)
            .or_else(|| title.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let normalized_name_kind = CodexAdapter::normalize(&provisional_name);
        let argument_kind = raw_input.as_ref().and_then(Self::infer_kind_from_arguments);
        let inferred_kind = Self::resolve_kind(
            payload_kind,
            argument_kind,
            normalized_name_kind,
            &id,
            title.as_deref(),
            raw_input.as_ref(),
        );
        if inferred_kind == ToolKind::Execute {
            if let Some(arguments) = raw_input.as_mut() {
                Self::add_mcp_command_if_missing(arguments);
            }
        }
        let tool_name = Some(Self::infer_name(
            explicit_name,
            &id,
            title.as_deref(),
            inferred_kind,
        ));
        let kind = Some(inferred_kind);

        let locations = data.get("locations").cloned();

        if (id.starts_with("ws_") || id.starts_with("web_search_"))
            && status == ToolCallStatus::Completed
            && result.is_none()
        {
            tracing::debug!(
                tool_call_id = %id,
                title = ?title,
                "Codex web search completed without rawOutput/content payload"
            );
        }

        Ok(RawToolCallUpdateInput {
            id,
            status: Some(status),
            result,
            content: None,
            title,
            locations,
            streaming_input_delta: None,
            tool_name,
            raw_input,
            kind,
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

    /// Extract Codex-specific usage fields that appear in both the standard-telemetry
    /// branch and the fallback branch: `(used_total, cost_usd, context_window_size)`.
    fn extract_codex_usage_fields(
        data: &serde_json::Value,
    ) -> (Option<u64>, Option<f64>, Option<u64>) {
        let used_total = data
            .get("used")
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
            });

        let cost_usd = data
            .get("cost")
            .and_then(|value| value.get("amount"))
            .and_then(|value| value.as_f64())
            .or_else(|| data.get("costUsd").and_then(|value| value.as_f64()))
            .or_else(|| data.get("cost_usd").and_then(|value| value.as_f64()));

        let context_window_size = data
            .get("size")
            .and_then(|value| value.as_u64())
            .or_else(|| {
                data.get("contextWindowSize")
                    .and_then(|value| value.as_u64())
            })
            .or_else(|| {
                data.get("context_window_size")
                    .and_then(|value| value.as_u64())
            });

        (used_total, cost_usd, context_window_size)
    }

    pub fn parse_usage_telemetry_impl(
        &self,
        data: &serde_json::Value,
        fallback_session_id: Option<&str>,
    ) -> Result<ParsedUsageTelemetry, ParseError> {
        let (used_total, cost_usd, context_window_size) = Self::extract_codex_usage_fields(data);

        if let Ok(mut parsed) = parse_standard_usage_telemetry(data, fallback_session_id) {
            if parsed.tokens.total.is_none() {
                parsed.tokens.total = used_total;
            }
            if parsed.context_window_size.is_none() {
                parsed.context_window_size = context_window_size;
            }
            if parsed.cost_usd.is_none() {
                parsed.cost_usd = cost_usd;
            }
            return Ok(parsed);
        }

        let session_id = data
            .get("sessionId")
            .or_else(|| data.get("session_id"))
            .and_then(|value| value.as_str())
            .or(fallback_session_id)
            .ok_or_else(|| ParseError::MissingField("sessionId".to_string()))?
            .to_string();

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
                .unwrap_or("step")
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
            context_window_size,
        })
    }
}
