//! Parser for Cursor agent.

use crate::acp::parsers::adapters::CursorAdapter;
use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::edit_normalizers::cursor::parse_edit_arguments;
use crate::acp::parsers::types::{
    extract_plan_from_raw_input_impl, parse_common_update_type_name,
    parse_standard_usage_telemetry, AgentParser, AgentType, ParseError, ParsedQuestion, ParsedTodo,
    ParsedUsageTelemetry, UpdateType,
};
use crate::acp::parsers::{acp_fields, kind as kind_utils};
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, tool_call_status_from_str, PlanData,
    RawToolCallInput, RawToolCallUpdateInput, ToolArguments, ToolCallStatus, ToolKind,
};

pub struct CursorParser;

impl AgentParser for CursorParser {
    fn agent_type(&self) -> AgentType {
        AgentType::Cursor
    }

    fn parse_update_type_name(&self, update_type: &str) -> Option<UpdateType> {
        CursorParser.parse_update_type_name_impl(update_type)
    }

    fn detect_update_type(&self, data: &serde_json::Value) -> Result<UpdateType, ParseError> {
        CursorParser.detect_update_type_impl(data)
    }

    fn parse_tool_call(
        &self,
        data: &serde_json::Value,
    ) -> Result<crate::acp::session_update::ToolCallData, ParseError> {
        let raw = CursorParser.parse_tool_call_impl(data)?;
        Ok(build_tool_call_from_raw(self, raw))
    }

    fn parse_tool_call_update(
        &self,
        data: &serde_json::Value,
        session_id: Option<&str>,
    ) -> Result<crate::acp::session_update::ToolCallUpdateData, ParseError> {
        let raw = CursorParser.parse_tool_call_update_impl(data)?;
        Ok(build_tool_call_update_from_raw(self, raw, session_id))
    }

    fn parse_questions(
        &self,
        _name: &str,
        _arguments: &serde_json::Value,
    ) -> Option<Vec<ParsedQuestion>> {
        None
    }

    fn parse_todos(&self, _name: &str, _arguments: &serde_json::Value) -> Option<Vec<ParsedTodo>> {
        None
    }

    fn detect_tool_kind(&self, name: &str) -> ToolKind {
        CursorAdapter::normalize(name)
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
        CursorParser.parse_usage_telemetry_impl(data, fallback_session_id)
    }

    fn extract_plan_from_raw_input(
        &self,
        tool_name: &str,
        raw_input: &serde_json::Value,
    ) -> Option<PlanData> {
        extract_plan_from_raw_input_impl(self, tool_name, raw_input)
    }
}

impl CursorParser {
    fn resolve_effective_tool_name(
        &self,
        explicit_name: Option<&str>,
        title: Option<&str>,
    ) -> String {
        explicit_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .or_else(|| title.and_then(Self::extract_tool_name_from_title))
            .or_else(|| title.map(str::to_string))
            .unwrap_or_else(|| "unknown".to_string())
    }

    fn extract_tool_name_from_title(title: &str) -> Option<String> {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return None;
        }

        let mut candidates: Vec<String> = Vec::new();
        candidates.push(trimmed.to_string());

        let before_backticks = trimmed.split('`').next().unwrap_or(trimmed).trim();
        if !before_backticks.is_empty() && before_backticks != trimmed {
            candidates.push(before_backticks.to_string());
        }

        let before_colon = before_backticks
            .split(':')
            .next()
            .unwrap_or(before_backticks)
            .trim();
        if !before_colon.is_empty() && before_colon != before_backticks {
            candidates.push(before_colon.to_string());
        }

        let words: Vec<&str> = before_colon.split_whitespace().collect();
        if let Some(first) = words.first() {
            candidates.push((*first).to_string());
        }
        if words.len() >= 2 {
            candidates.push(format!("{} {}", words[0], words[1]));
            candidates.push(format!("{}{}", words[0], words[1]));
        }
        if words.len() >= 3 {
            candidates.push(format!("{} {} {}", words[0], words[1], words[2]));
            candidates.push(format!("{}{}{}", words[0], words[1], words[2]));
        }

        candidates
            .into_iter()
            .find(|candidate| CursorAdapter::normalize(candidate) != ToolKind::Other)
    }

    fn extract_first_location_path(data: &serde_json::Value) -> Option<String> {
        data.get(acp_fields::LOCATIONS)
            .and_then(|value| value.as_array())
            .and_then(|locations| locations.first())
            .and_then(|location| location.get("path"))
            .and_then(|path| path.as_str())
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(str::to_string)
    }

    fn raw_arguments_have_path(raw_arguments: &serde_json::Value) -> bool {
        acp_fields::FILE_PATH_KEYS.iter().any(|key| {
            raw_arguments
                .get(key)
                .and_then(|value| value.as_str())
                .is_some_and(|value| !value.trim().is_empty())
        })
    }

    fn inject_location_path(
        raw_arguments: &mut serde_json::Value,
        kind: ToolKind,
        location_path: &str,
    ) {
        if Self::raw_arguments_have_path(raw_arguments) {
            return;
        }
        let Some(arguments) = raw_arguments.as_object_mut() else {
            return;
        };

        match kind {
            ToolKind::Read | ToolKind::Edit | ToolKind::Delete | ToolKind::Search => {
                arguments.insert(
                    "file_path".to_string(),
                    serde_json::Value::String(location_path.to_string()),
                );
            }
            ToolKind::Glob => {
                arguments.insert(
                    "path".to_string(),
                    serde_json::Value::String(location_path.to_string()),
                );
            }
            _ => {}
        }
    }

    pub fn parse_update_type_name_impl(&self, update_type: &str) -> Option<UpdateType> {
        parse_common_update_type_name(update_type).or(match update_type {
            "text" => Some(UpdateType::AgentMessageChunk),
            "thinking" => Some(UpdateType::AgentThoughtChunk),
            _ => None,
        })
    }

    pub fn detect_update_type_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<UpdateType, ParseError> {
        // Cursor ACP now emits Codex-like payloads in some flows
        if acp_fields::is_acp_shaped(data) {
            return acp_fields::detect_acp_update_type(data, |s| {
                self.parse_update_type_name_impl(s)
            });
        }

        let type_str = data
            .get(acp_fields::TYPE)
            .and_then(|v| v.as_str())
            .ok_or_else(|| ParseError::MissingField("type".to_string()))?;

        self.parse_update_type_name_impl(type_str)
            .ok_or_else(|| ParseError::UnknownUpdateType(type_str.to_string()))
    }

    pub(crate) fn parse_tool_call_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallInput, ParseError> {
        // Cursor ACP emits tool events with toolCallId/rawInput/title.
        if acp_fields::is_acp_tool_call_shaped(data) {
            return self.parse_acp_tool_call(data);
        }

        // Legacy Anthropic-API-style tool_use events
        let id = data
            .get(acp_fields::ID)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("id".to_string()))?;

        let name = data
            .get(acp_fields::NAME)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("name".to_string()))?;

        let arguments = data
            .get(acp_fields::INPUT)
            .cloned()
            .unwrap_or(serde_json::json!({}));
        let kind = CursorAdapter::normalize(&name);

        Ok(RawToolCallInput {
            id,
            name,
            arguments,
            status: ToolCallStatus::Pending,
            kind: Some(kind),
            title: None,
            parent_tool_use_id: None,
            task_children: None,
        })
    }

    /// Parse ACP-shaped tool_call (toolCallId/rawInput/title/kind).
    ///
    /// Kind resolution: prefer the specific kind derived from the tool name
    /// (e.g. "Find" → Glob, "updateTodos" → Todo), only falling back to the
    /// payload `kind` hint when the name doesn't resolve to a known tool.
    /// The payload hint is a coarse bucket (e.g. Cursor sends "search" for
    /// both Grep and Glob), so it must not override a specific name match.
    fn parse_acp_tool_call(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallInput, ParseError> {
        let id = acp_fields::extract_tool_call_id(data)?;
        let title = acp_fields::extract_title(data);
        let mut raw_arguments =
            acp_fields::extract_raw_input(data).unwrap_or(serde_json::json!({}));
        let status = tool_call_status_from_str(
            acp_fields::extract_status(data)
                .as_deref()
                .unwrap_or("pending"),
        );

        // Resolve tool name: top-level `name`, then rawInput._toolName, then title.
        let tool_name_ref = acp_fields::extract_tool_name(data, Some(&raw_arguments));
        let effective_name = self.resolve_effective_tool_name(tool_name_ref, title.as_deref());

        // Name-derived kind is specific; payload kind is a coarse fallback.
        let name_kind = CursorAdapter::normalize(&effective_name);
        let kind = if name_kind != ToolKind::Other {
            name_kind
        } else {
            let kind_hint = acp_fields::extract_kind_hint(data);
            kind_utils::infer_kind_from_payload(&id, title.as_deref(), kind_hint)
                .unwrap_or(name_kind)
        };

        if let Some(location_path) = Self::extract_first_location_path(data) {
            Self::inject_location_path(&mut raw_arguments, kind, &location_path);
        }

        let name = kind_utils::display_name_for_tool(kind, &effective_name);

        Ok(RawToolCallInput {
            id,
            name,
            arguments: raw_arguments,
            status,
            kind: Some(kind),
            title,
            parent_tool_use_id: None,
            task_children: None,
        })
    }

    pub(crate) fn parse_tool_call_update_impl(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallUpdateInput, ParseError> {
        // Cursor ACP emits tool update events with toolCallId/rawOutput/rawInput.
        if acp_fields::is_acp_tool_call_update_shaped(data) {
            return self.parse_acp_tool_call_update(data);
        }

        // Legacy Anthropic-API-style tool_result events
        let id = data
            .get(acp_fields::TOOL_USE_ID)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ParseError::MissingField("tool_use_id".to_string()))?;

        let result = data.get(acp_fields::CONTENT).cloned();
        let (streaming_input_delta, tool_name) =
            acp_fields::extract_streaming_meta(data, acp_fields::META_CURSOR);

        Ok(RawToolCallUpdateInput {
            id,
            status: Some(ToolCallStatus::Completed),
            result,
            content: None,
            title: None,
            locations: None,
            streaming_input_delta,
            tool_name,
            raw_input: None,
            kind: None,
        })
    }

    /// If result (or result.content) is an array whose first element looks like a diff object
    /// (path + oldText/newText), return it as raw_input so the shared pipeline can parse edit
    /// arguments.
    fn synthesize_edit_raw_input_from_result(
        result: Option<&serde_json::Value>,
    ) -> Option<serde_json::Value> {
        let result = result?;
        // rawOutput may wrap the diff array in a "content" sub-key, or be the array directly
        let content = result.get("content").unwrap_or(result);
        let first = content.as_array().and_then(|arr| arr.first())?;
        let obj = first.as_object()?;
        let has_path = acp_fields::FILE_PATH_KEYS.iter().any(|k| {
            obj.get(*k)
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.trim().is_empty())
        });
        let has_old_or_new = acp_fields::OLD_STRING_KEYS
            .iter()
            .any(|k| obj.contains_key(*k))
            || acp_fields::NEW_STRING_KEYS
                .iter()
                .any(|k| obj.contains_key(*k));
        if has_path && has_old_or_new {
            Some(first.clone())
        } else {
            None
        }
    }

    /// Parse ACP-shaped tool_call_update (toolCallId/rawOutput/rawInput).
    ///
    /// Same principle as parse_acp_tool_call: prefer name-derived kind,
    /// canonicalize name only when kind is known.
    ///
    /// When Cursor sends a completed edit with no rawInput, the diff lives in
    /// rawOutput/content as an array of diff objects. We synthesize raw_input
    /// from the first such object so the shared pipeline can produce typed
    /// edit arguments (old_string, new_string, path) for the UI.
    fn parse_acp_tool_call_update(
        &self,
        data: &serde_json::Value,
    ) -> Result<RawToolCallUpdateInput, ParseError> {
        let id = acp_fields::extract_tool_call_id(data)?;
        let result = acp_fields::extract_raw_output(data);
        let title = acp_fields::extract_title(data);
        let mut raw_input = acp_fields::extract_raw_input(data);
        let synthesized_edit = raw_input.is_none() && {
            raw_input = Self::synthesize_edit_raw_input_from_result(result.as_ref());
            raw_input.is_some()
        };

        // Resolve tool name: top-level `name`, then rawInput._toolName, then title.
        let tool_name_ref = acp_fields::extract_tool_name(data, raw_input.as_ref());
        let effective_name = self.resolve_effective_tool_name(tool_name_ref, title.as_deref());

        // If we synthesized raw_input from the diff result, we know it's an edit
        // even when the update payload has no name/title/kind.
        let kind = if synthesized_edit {
            ToolKind::Edit
        } else {
            CursorAdapter::normalize(&effective_name)
        };

        let tool_name = kind_utils::display_name_for_tool(kind, &effective_name);

        let status = Some(
            acp_fields::extract_status(data)
                .map(|s| tool_call_status_from_str(&s))
                .unwrap_or_else(|| {
                    if result.is_some() {
                        ToolCallStatus::Completed
                    } else {
                        ToolCallStatus::Pending
                    }
                }),
        );

        if let Some(location_path) = Self::extract_first_location_path(data) {
            if let Some(raw_arguments) = raw_input.as_mut() {
                Self::inject_location_path(raw_arguments, kind, &location_path);
            }
        }

        let locations = data.get(acp_fields::LOCATIONS).cloned();

        Ok(RawToolCallUpdateInput {
            id,
            status,
            result,
            content: None,
            title,
            locations,
            streaming_input_delta: None,
            tool_name: Some(tool_name),
            raw_input,
            kind: Some(kind),
        })
    }

    pub fn parse_usage_telemetry_impl(
        &self,
        data: &serde_json::Value,
        fallback_session_id: Option<&str>,
    ) -> Result<ParsedUsageTelemetry, ParseError> {
        parse_standard_usage_telemetry(data, fallback_session_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn synthesize_from_content_sub_key() {
        // rawOutput = { "content": [ { "file_path": "foo.rs", "oldText": "a", "newText": "b" } ] }
        let result = json!({
            "content": [
                { "file_path": "foo.rs", "oldText": "a", "newText": "b" }
            ]
        });
        let synthesized = CursorParser::synthesize_edit_raw_input_from_result(Some(&result));
        assert!(synthesized.is_some());
        let val = synthesized.unwrap();
        assert_eq!(val["file_path"], "foo.rs");
        assert_eq!(val["oldText"], "a");
    }

    #[test]
    fn synthesize_from_direct_array() {
        // rawOutput = [ { "path": "bar.ts", "old_string": "x", "new_string": "y" } ]
        let result = json!([
            { "path": "bar.ts", "old_string": "x", "new_string": "y" }
        ]);
        let synthesized = CursorParser::synthesize_edit_raw_input_from_result(Some(&result));
        assert!(synthesized.is_some());
        let val = synthesized.unwrap();
        assert_eq!(val["path"], "bar.ts");
        assert_eq!(val["old_string"], "x");
    }

    #[test]
    fn synthesize_returns_none_for_non_diff_array() {
        let result = json!([{ "message": "success" }]);
        assert!(CursorParser::synthesize_edit_raw_input_from_result(Some(&result)).is_none());
    }

    #[test]
    fn synthesize_returns_none_for_missing_path() {
        let result = json!([{ "oldText": "a", "newText": "b" }]);
        assert!(CursorParser::synthesize_edit_raw_input_from_result(Some(&result)).is_none());
    }

    #[test]
    fn synthesize_returns_none_for_none_input() {
        assert!(CursorParser::synthesize_edit_raw_input_from_result(None).is_none());
    }

    #[test]
    fn synthesize_returns_none_for_string_result() {
        let result = json!("just a string");
        assert!(CursorParser::synthesize_edit_raw_input_from_result(Some(&result)).is_none());
    }

    #[test]
    fn synthesize_returns_none_for_empty_path() {
        let result = json!([{ "file_path": "  ", "oldText": "a" }]);
        assert!(CursorParser::synthesize_edit_raw_input_from_result(Some(&result)).is_none());
    }

    /// Regression: Cursor sends edit completion with no rawInput and no title/name
    /// on the update. The diff lives in `content` (which extract_raw_output picks up).
    /// The parser must synthesize raw_input AND set kind=Edit so the UI gets edit args.
    #[test]
    fn cursor_edit_update_with_content_diff_produces_edit_kind() {
        // Mirrors the real Cursor payload from streaming logs
        let data = json!({
            "content": [{
                "newText": "hello world\n",
                "oldText": "hello\n",
                "path": "/tmp/README.md",
                "type": "diff"
            }],
            "sessionUpdate": "tool_call_update",
            "status": "completed",
            "toolCallId": "tool_test-edit-001"
        });

        let parser = CursorParser;
        let update = parser.parse_acp_tool_call_update(&data).unwrap();

        assert_eq!(update.id, "tool_test-edit-001");
        assert_eq!(update.status, Some(ToolCallStatus::Completed));
        assert_eq!(update.kind, Some(ToolKind::Edit));

        // raw_input should be the synthesized diff object
        let raw_input = update.raw_input.unwrap();
        assert_eq!(raw_input["path"], "/tmp/README.md");
        assert_eq!(raw_input["oldText"], "hello\n");
        assert_eq!(raw_input["newText"], "hello world\n");
    }

    /// When rawInput is already present, synthesize should not override it.
    #[test]
    fn cursor_edit_update_with_existing_raw_input_preserves_it() {
        let data = json!({
            "rawInput": {
                "file_path": "/tmp/foo.rs",
                "old_string": "a",
                "new_string": "b"
            },
            "content": [{
                "newText": "different",
                "oldText": "other",
                "path": "/tmp/other.rs",
                "type": "diff"
            }],
            "sessionUpdate": "tool_call_update",
            "status": "completed",
            "toolCallId": "tool_test-edit-002"
        });

        let parser = CursorParser;
        let update = parser.parse_acp_tool_call_update(&data).unwrap();

        // Should use the existing rawInput, not the synthesized one
        let raw_input = update.raw_input.unwrap();
        assert_eq!(raw_input["file_path"], "/tmp/foo.rs");
    }
}
