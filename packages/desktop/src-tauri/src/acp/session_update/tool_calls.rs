use super::deserialize::parser_error_to_de_error;
use super::types::{
    ToolArguments, ToolCallData, ToolCallLocation, ToolCallStatus, ToolCallUpdateData, ToolKind,
};
#[cfg(test)]
use crate::acp::agent_context::current_agent;
use crate::acp::parsers::{get_parser, AgentParser, AgentType};
use crate::acp::reconciler::session_tool::{
    classify_raw_tool_call, resolve_raw_tool_identity, ToolClassificationHints,
};
use serde_json::json;

/// Raw tool call update input used only for conversion to ToolCallUpdateData.
#[derive(Debug, Clone)]
pub(crate) struct RawToolCallUpdateInput {
    pub id: String,
    pub status: Option<ToolCallStatus>,
    pub result: Option<serde_json::Value>,
    pub content: Option<serde_json::Value>,
    pub title: Option<String>,
    pub locations: Option<serde_json::Value>,
    pub streaming_input_delta: Option<String>,
    pub tool_name: Option<String>,
    pub raw_input: Option<serde_json::Value>,
    pub kind: Option<ToolKind>,
}

/// Raw tool call input used only for conversion to ToolCallData.
/// Parsers produce this; build_tool_call_from_raw turns it into ToolCallData.
#[derive(Debug, Clone)]
pub(crate) struct RawToolCallInput {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
    pub status: ToolCallStatus,
    pub kind: Option<ToolKind>,
    pub title: Option<String>,
    pub suppress_title_read_path_hint: bool,
    pub parent_tool_use_id: Option<String>,
    pub task_children: Option<Vec<RawToolCallInput>>,
}
use crate::acp::types::ContentBlock;

#[cfg(test)]
pub(crate) fn parse_tool_call_from_acp<E>(data: &serde_json::Value) -> Result<ToolCallData, E>
where
    E: serde::de::Error,
{
    parse_tool_call_from_acp_with_agent(data, current_agent().unwrap_or(AgentType::ClaudeCode))
}

pub(crate) fn parse_tool_call_from_acp_with_agent<E>(
    data: &serde_json::Value,
    agent: AgentType,
) -> Result<ToolCallData, E>
where
    E: serde::de::Error,
{
    tracing::debug!(
        raw_data = %data,
        "Parsing tool_call from ACP format"
    );

    let parser = get_parser(agent);
    let tool_call = parser
        .parse_tool_call(data)
        .map_err(parser_error_to_de_error::<E>)?;

    tracing::debug!(
        tool_call_id = %tool_call.id,
        tool_name = %tool_call.name,
        tool_kind = ?tool_call.kind,
        tool_status = ?tool_call.status,
        tool_title = ?tool_call.title,
        "Successfully parsed tool_call"
    );

    Ok(tool_call)
}

/// Parse tool call update from ACP format
///
/// All agents go through their parser; streaming extraction is agent-specific.
/// ACP sends: { toolCallId, status, content: [{"type": "content", "content": {...}}], ... }
/// We need: ToolCallUpdateData { tool_call_id, status, content: Vec<ContentBlock>, ... }
#[cfg(test)]
pub(crate) fn parse_tool_call_update_from_acp<E>(
    data: &serde_json::Value,
    session_id: Option<&str>,
) -> Result<ToolCallUpdateData, E>
where
    E: serde::de::Error,
{
    parse_tool_call_update_from_acp_with_agent(
        data,
        session_id,
        current_agent().unwrap_or(AgentType::ClaudeCode),
    )
}

pub(crate) fn parse_tool_call_update_from_acp_with_agent<E>(
    data: &serde_json::Value,
    session_id: Option<&str>,
    agent: AgentType,
) -> Result<ToolCallUpdateData, E>
where
    E: serde::de::Error,
{
    let parser = get_parser(agent);
    parser
        .parse_tool_call_update(data, session_id)
        .map_err(parser_error_to_de_error::<E>)
}

/// Build ToolCallUpdateData from raw update, running streaming accumulator when parser
/// extracted streaming_input_delta and tool_name.
pub(crate) fn build_tool_call_update_from_raw(
    parser: &dyn AgentParser,
    raw: RawToolCallUpdateInput,
    session_id: Option<&str>,
) -> ToolCallUpdateData {
    let agent = parser.agent_type();
    let session_key = session_id.unwrap_or(raw.id.as_str());
    let tool_call_id = &raw.id;
    let provided_tool_name = raw.tool_name.as_deref().unwrap_or("");
    let tool_name = if provided_tool_name.eq_ignore_ascii_case("unknown") {
        ""
    } else {
        provided_tool_name
    };
    let status = raw.status;
    let is_terminal = status
        .as_ref()
        .is_some_and(|s| matches!(s, ToolCallStatus::Completed | ToolCallStatus::Failed));

    let (
        streaming_input_delta,
        normalized_todos,
        normalized_questions,
        streaming_arguments,
        final_streaming_plan,
    ) = if let Some(ref delta) = raw.streaming_input_delta {
        use crate::acp::streaming_accumulator::{
            finalize_plan_streaming_for_tool, get_session_streaming_state_mut,
            process_plan_streaming,
        };

        let session_state = get_session_streaming_state_mut(session_key);
        let normalized = session_state.accumulate_delta(tool_call_id, tool_name, delta, agent);
        let (todos, questions, streaming_args) = normalized
            .as_ref()
            .map(|n| {
                (
                    n.todos.clone(),
                    n.questions.clone(),
                    n.streaming_arguments.clone(),
                )
            })
            .unwrap_or((None, None, None));

        let effective_tool_name = normalized
            .as_ref()
            .and_then(|n| n.effective_tool_name.as_deref())
            .unwrap_or(tool_name);

        // Use the effective tool name (seeded from initial tool_call when omitted in deltas)
        // so plan detection still works for .claude/plans writes.
        let plan =
            process_plan_streaming(session_key, tool_call_id, effective_tool_name, delta, agent);

        // Drop the DashMap RefMut before cleanup_tool_streaming, which calls
        // SESSION_STREAMING_STATES.get() on the same key. Holding the write lock
        // across that call causes a deadlock on the same shard.
        drop(session_state);

        let final_plan = if is_terminal {
            crate::acp::streaming_accumulator::cleanup_tool_streaming(session_key, tool_call_id);
            finalize_plan_streaming_for_tool(session_key, tool_call_id).or(plan)
        } else {
            plan
        };

        (
            Some(delta.clone()),
            todos,
            questions,
            streaming_args,
            final_plan,
        )
    } else {
        // Fallback: detect plan writes from rawInput when streamingInputDelta is absent.
        // Claude Code sends rawInput with {file_path, content} on tool_call_update.
        let plan = raw
            .raw_input
            .as_ref()
            .and_then(|r| parser.extract_plan_from_raw_input(tool_name, r));

        if is_terminal {
            crate::acp::streaming_accumulator::cleanup_tool_streaming(session_key, tool_call_id);
        }
        (None, None, None, None, plan)
    };

    let locations = raw
        .locations
        .and_then(|value| serde_json::from_value::<Vec<ToolCallLocation>>(value).ok());

    let content = raw
        .content
        .as_ref()
        .or(raw.result.as_ref())
        .and_then(extract_content_blocks_from_value);

    let identity_hints = ToolClassificationHints {
        name: raw.tool_name.as_deref(),
        title: raw.title.as_deref(),
        kind: raw.kind,
        kind_hint: raw.kind.as_ref().map(ToolKind::as_str),
        locations: locations.as_deref(),
    };
    let classified_arguments = raw
        .raw_input
        .as_ref()
        .map(|input| classify_raw_tool_call(parser, tool_call_id, input, identity_hints));
    let arguments = classified_arguments
        .as_ref()
        .map(|classified| classified.arguments.clone());
    let result = normalize_count_only_search_result(raw.result, arguments.as_ref());

    let resolved_kind = classified_arguments
        .as_ref()
        .map(|classified| classified.kind)
        .or_else(|| {
            Some(
                resolve_raw_tool_identity(
                    parser,
                    tool_call_id,
                    raw.raw_input.as_ref(),
                    identity_hints,
                )
                .kind,
            )
        });

    let result = normalize_web_search_result(result, resolved_kind.as_ref());

    ToolCallUpdateData {
        tool_call_id: raw.id,
        status,
        result,
        content,
        raw_output: None,
        title: raw.title,
        locations,
        streaming_input_delta,
        normalized_todos,
        normalized_questions,
        streaming_arguments,
        streaming_plan: final_streaming_plan,
        arguments,
        failure_reason: None,
    }
}

fn normalize_count_only_search_result(
    result: Option<serde_json::Value>,
    _arguments: Option<&ToolArguments>,
) -> Option<serde_json::Value> {
    let Some(serde_json::Value::Object(mut object)) = result else {
        return result;
    };
    if object.contains_key("mode")
        || object.contains_key("content")
        || object.contains_key("filenames")
    {
        return Some(serde_json::Value::Object(object));
    }

    let total_files = object.get("totalFiles").and_then(|value| value.as_u64());
    let total_matches = object.get("totalMatches").and_then(|value| value.as_u64());
    if total_files.is_none() && total_matches.is_none() {
        return Some(serde_json::Value::Object(object));
    }

    object.insert(
        "mode".to_string(),
        serde_json::Value::String("count".to_string()),
    );
    if let Some(value) = total_files {
        object.insert(
            "numFiles".to_string(),
            serde_json::Value::Number(serde_json::Number::from(value)),
        );
    }
    if let Some(value) = total_matches {
        object.insert(
            "numMatches".to_string(),
            serde_json::Value::Number(serde_json::Number::from(value)),
        );
    }

    Some(serde_json::Value::Object(object))
}

// Web search results from Claude Code arrive as an array of {type, url, title,
// encrypted_content, page_age} objects. Reshape into {results: [...], summary: ""}
// so the frontend's parseWebSearchResult can render link cards directly.
fn normalize_web_search_result(
    result: Option<serde_json::Value>,
    kind: Option<&ToolKind>,
) -> Option<serde_json::Value> {
    if kind != Some(&ToolKind::WebSearch) {
        return result;
    }
    let Some(serde_json::Value::Array(items)) = result else {
        return result;
    };

    let results: Vec<serde_json::Value> = items
        .iter()
        .filter_map(|item| {
            let url = item.get("url").and_then(|v| v.as_str())?;
            if !(url.starts_with("http://") || url.starts_with("https://")) {
                return None;
            }
            let title = item.get("title").and_then(|v| v.as_str()).unwrap_or(url);
            let page_age = item.get("page_age").and_then(|v| v.as_str()).unwrap_or("");
            Some(json!({
                "title": title,
                "url": url,
                "page_age": page_age,
            }))
        })
        .collect();

    if results.is_empty() {
        return Some(serde_json::Value::Array(items));
    }

    Some(json!({
        "results": results,
        "summary": "",
    }))
}

pub(crate) fn build_tool_call_from_raw(
    parser: &dyn AgentParser,
    raw: RawToolCallInput,
) -> ToolCallData {
    let classified = classify_raw_tool_call(
        parser,
        &raw.id,
        &raw.arguments,
        ToolClassificationHints {
            name: Some(&raw.name),
            title: raw.title.as_deref(),
            kind: raw.kind,
            kind_hint: raw.kind.as_ref().map(ToolKind::as_str),
            locations: None,
        },
    );
    let mut arguments = classified.arguments;
    if let ToolArguments::Read {
        ref mut file_path, ..
    } = arguments
    {
        if file_path.is_none() && !raw.suppress_title_read_path_hint {
            *file_path = raw.title.as_deref().and_then(extract_file_path_from_title);
        }
    }
    if let ToolArguments::Execute { ref mut command } = arguments {
        if command.is_none() {
            *command = raw.title.as_deref().and_then(extract_backtick_command);
        }
    }
    let status = raw.status;

    ToolCallData {
        id: raw.id.clone(),
        name: classified.name,
        arguments,
        raw_input: Some(raw.arguments.clone()),
        status,
        result: None,
        kind: Some(classified.kind),
        title: raw.title,
        locations: None,
        skill_meta: None,
        normalized_questions: classified.normalized_questions,
        normalized_todos: classified.normalized_todos,
        normalized_todo_update: classified.normalized_todo_update,
        parent_tool_use_id: raw.parent_tool_use_id,
        question_answer: None,
        awaiting_plan_approval: false,
        plan_approval_request_id: None,
        task_children: raw.task_children.map(|children| {
            children
                .into_iter()
                .map(|child| build_tool_call_from_raw(parser, child))
                .collect()
        }),
    }
}

/// Extract a file path from a tool-call title like "View Image /path/to/file.png" or "Read /path".
/// Returns None for "Read Lints" so that tool is not treated as reading a file named "Lints".
fn extract_file_path_from_title(title: &str) -> Option<String> {
    if title.trim().eq_ignore_ascii_case("Read Lints") {
        return None;
    }
    let prefixes = ["View Image ", "Read ", "View "];
    for prefix in prefixes {
        if let Some(path) = title.strip_prefix(prefix) {
            let trimmed = path.trim();
            if !trimmed.is_empty() && !is_generic_file_placeholder(trimmed) {
                return Some(trimmed.to_string());
            }
        }
    }
    // Fallback: if title looks like an absolute path
    let trimmed = title.trim();
    if trimmed.starts_with('/') {
        return Some(trimmed.to_string());
    }
    None
}

fn is_generic_file_placeholder(path: &str) -> bool {
    path.trim_matches('`').eq_ignore_ascii_case("file")
}

/// Extract a command from a backtick-wrapped title like "`cd /path && cargo test 2>&1`".
fn extract_backtick_command(title: &str) -> Option<String> {
    let trimmed = title.trim();
    if trimmed.len() > 2 && trimmed.starts_with('`') && trimmed.ends_with('`') {
        Some(trimmed[1..trimmed.len() - 1].to_string())
    } else {
        None
    }
}

fn extract_content_blocks_from_value(value: &serde_json::Value) -> Option<Vec<ContentBlock>> {
    let array = value.as_array()?;
    let content = array
        .iter()
        .filter_map(|item| {
            if let Some(inner) = item.get("content") {
                serde_json::from_value::<ContentBlock>(inner.clone()).ok()
            } else {
                serde_json::from_value::<ContentBlock>(item.clone()).ok()
            }
        })
        .collect::<Vec<_>>();

    if content.is_empty() {
        None
    } else {
        Some(content)
    }
}

pub fn tool_call_status_from_str(status_str: &str) -> ToolCallStatus {
    let s = status_str.trim();
    if s.eq_ignore_ascii_case("pending") {
        ToolCallStatus::Pending
    } else if s.eq_ignore_ascii_case("in_progress")
        || s.eq_ignore_ascii_case("inprogress")
        || s.eq_ignore_ascii_case("running")
        || s.eq_ignore_ascii_case("started")
    {
        ToolCallStatus::InProgress
    } else if s.eq_ignore_ascii_case("completed")
        || s.eq_ignore_ascii_case("complete")
        || s.eq_ignore_ascii_case("success")
        || s.eq_ignore_ascii_case("succeeded")
        || s.eq_ignore_ascii_case("done")
        || s.eq_ignore_ascii_case("ok")
    {
        ToolCallStatus::Completed
    } else if s.eq_ignore_ascii_case("failed")
        || s.eq_ignore_ascii_case("fail")
        || s.eq_ignore_ascii_case("error")
        || s.eq_ignore_ascii_case("errored")
        || s.eq_ignore_ascii_case("cancelled")
        || s.eq_ignore_ascii_case("canceled")
        || s.eq_ignore_ascii_case("interrupted")
        || s.eq_ignore_ascii_case("aborted")
        || s.eq_ignore_ascii_case("timed_out")
        || s.eq_ignore_ascii_case("timeout")
    {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Pending
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::agent_context::with_agent;
    use crate::acp::client_updates::process_through_reconciler;
    use crate::acp::parsers::{AgentType, CodexParser, CursorParser};
    use crate::acp::session_update::SessionUpdate;
    use crate::acp::streaming_accumulator::cleanup_session_streaming;
    use crate::acp::task_reconciler::TaskReconciler;
    use serde_json::json;
    use std::sync::{Arc as StdArc, Mutex};

    /// Helper: build a tool call from raw input with the given kind hint and title.
    fn build_with_kind_and_title(kind: &str, title: Option<&str>) -> ToolCallData {
        let parser = get_parser(current_agent().unwrap_or(AgentType::ClaudeCode));
        let raw = RawToolCallInput {
            id: "test-id".to_string(),
            name: String::new(),
            arguments: json!({}),
            status: ToolCallStatus::Pending,
            kind: Some(parser.detect_tool_kind(kind)),
            title: title.map(|t| t.to_string()),
            suppress_title_read_path_hint: false,
            parent_tool_use_id: None,
            task_children: None,
        };
        build_tool_call_from_raw(parser, raw)
    }

    // -------------------------------------------------------------------------
    // Phase 0.4: Characterization tests for build_tool_call_from_parsed pipeline
    // -------------------------------------------------------------------------

    #[test]
    fn cursor_full_pipeline_acp_tool_call_builds_tool_call_data() {
        let parser = &CursorParser as &dyn AgentParser;
        let data = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tool_cursor_1",
            "kind": "read",
            "status": "pending",
            "title": "Read main.rs",
            "name": "Read",
            "rawInput": { "path": "/tmp/main.rs" }
        });
        let tc = parser.parse_tool_call(&data).expect("parse_tool_call");

        assert_eq!(tc.id, "tool_cursor_1");
        assert_eq!(tc.name, "Read");
        assert_eq!(tc.status, ToolCallStatus::Pending);
        assert_eq!(tc.title.as_deref(), Some("Read main.rs"));
        assert_eq!(tc.kind, Some(ToolKind::Read));
        assert!(matches!(tc.arguments, ToolArguments::Read { .. }));
        assert!(tc.result.is_none());
        assert!(tc.parent_tool_use_id.is_none());
        assert!(tc.task_children.is_none());
    }

    #[test]
    fn cursor_full_pipeline_legacy_tool_use_builds_tool_call_data() {
        let parser = &CursorParser as &dyn AgentParser;
        let data = json!({
            "type": "tool_use",
            "id": "tool_legacy_1",
            "name": "Edit",
            "input": { "file_path": "/src/lib.rs", "old_string": "foo", "new_string": "bar" }
        });
        let tc = parser.parse_tool_call(&data).expect("parse_tool_call");

        assert_eq!(tc.id, "tool_legacy_1");
        assert_eq!(tc.name, "Edit");
        assert_eq!(tc.status, ToolCallStatus::Pending);
        assert_eq!(tc.kind, Some(ToolKind::Edit));
        assert!(matches!(tc.arguments, ToolArguments::Edit { .. }));
    }

    #[test]
    fn codex_full_pipeline_acp_tool_call_builds_tool_call_data() {
        let parser = &CodexParser as &dyn AgentParser;
        let data = json!({
            "toolCallId": "tool_codex_1",
            "title": "Run command",
            "name": "codex.execute",
            "kind": "execute",
            "status": "in_progress",
            "rawInput": { "command": "echo ok" }
        });
        let tc = parser.parse_tool_call(&data).expect("parse_tool_call");

        assert_eq!(tc.id, "tool_codex_1");
        assert_eq!(tc.name, "codex.execute");
        assert_eq!(tc.status, ToolCallStatus::InProgress);
        assert_eq!(tc.title.as_deref(), Some("Run command"));
        assert_eq!(tc.kind, Some(ToolKind::Execute));
        assert!(matches!(tc.arguments, ToolArguments::Execute { .. }));
    }

    #[test]
    fn empty_raw_input_execute_produces_execute_arguments() {
        let tc = build_with_kind_and_title("execute", None);
        assert!(
            matches!(tc.arguments, ToolArguments::Execute { .. }),
            "Expected Execute variant, got {:?}",
            tc.arguments.tool_kind()
        );
    }

    #[test]
    fn empty_raw_input_execute_with_backtick_title_extracts_command() {
        let tc = build_with_kind_and_title("execute", Some("`cd /path && cargo test 2>&1`"));
        match &tc.arguments {
            ToolArguments::Execute { command } => {
                assert_eq!(command.as_deref(), Some("cd /path && cargo test 2>&1"));
            }
            other => panic!("Expected Execute, got {:?}", other.tool_kind()),
        }
    }

    #[test]
    fn empty_raw_input_execute_plain_title_no_command() {
        let tc = build_with_kind_and_title("execute", Some("Terminal"));
        match &tc.arguments {
            ToolArguments::Execute { command } => {
                assert_eq!(command, &None);
            }
            other => panic!("Expected Execute, got {:?}", other.tool_kind()),
        }
    }

    #[test]
    fn empty_raw_input_search_produces_search_arguments() {
        let tc = build_with_kind_and_title("search", None);
        assert!(
            matches!(tc.arguments, ToolArguments::Search { .. }),
            "Expected Search variant, got {:?}",
            tc.arguments.tool_kind()
        );
    }

    #[test]
    fn empty_raw_input_edit_produces_edit_arguments() {
        let tc = build_with_kind_and_title("edit", None);
        assert!(
            matches!(tc.arguments, ToolArguments::Edit { .. }),
            "Expected Edit variant, got {:?}",
            tc.arguments.tool_kind()
        );
    }

    #[test]
    fn empty_raw_input_glob_produces_glob_arguments() {
        let tc = build_with_kind_and_title("glob", None);
        assert!(
            matches!(tc.arguments, ToolArguments::Glob { .. }),
            "Expected Glob variant, got {:?}",
            tc.arguments.tool_kind()
        );
    }

    #[test]
    fn empty_raw_input_fetch_produces_fetch_arguments() {
        let tc = build_with_kind_and_title("fetch", None);
        assert!(
            matches!(tc.arguments, ToolArguments::Fetch { .. }),
            "Expected Fetch variant, got {:?}",
            tc.arguments.tool_kind()
        );
    }

    #[test]
    fn empty_raw_input_other_produces_other_arguments() {
        // "other" kind hint now normalizes to Unclassified (Other is an internal sentinel
        // that gets promoted to Unclassified at the identity-resolution boundary).
        let tc = build_with_kind_and_title("other", None);
        assert!(
            matches!(tc.arguments, ToolArguments::Unclassified { .. }),
            "Expected Unclassified variant, got {:?}",
            tc.arguments.tool_kind()
        );
    }

    #[test]
    fn empty_raw_input_read_with_title_extracts_file_path() {
        let tc = build_with_kind_and_title("read", Some("Read /etc/hosts"));
        match &tc.arguments {
            ToolArguments::Read { file_path, .. } => {
                assert_eq!(file_path.as_deref(), Some("/etc/hosts"));
            }
            other => panic!("Expected Read, got {:?}", other.tool_kind()),
        }
    }

    #[test]
    fn build_tool_call_from_raw_preserves_canonical_raw_input() {
        let parser = get_parser(current_agent().unwrap_or(AgentType::ClaudeCode));
        let raw = RawToolCallInput {
            id: "toolu_raw_input".to_string(),
            name: "Bash".to_string(),
            arguments: json!({
                "command": "echo hi",
                "description": "Say hi"
            }),
            status: ToolCallStatus::InProgress,
            kind: Some(ToolKind::Execute),
            title: None,
            suppress_title_read_path_hint: false,
            parent_tool_use_id: None,
            task_children: None,
        };

        let tool_call = build_tool_call_from_raw(parser, raw);

        assert_eq!(
            tool_call.raw_input,
            Some(json!({
                "command": "echo hi",
                "description": "Say hi"
            }))
        );
    }

    #[test]
    fn build_tool_call_from_raw_repairs_missing_read_path_from_title_after_partial_parse() {
        let parser = &CursorParser as &dyn AgentParser;
        let raw = RawToolCallInput {
            id: "toolu_partial_read".to_string(),
            name: "Read".to_string(),
            arguments: json!({
                "offset": 0,
                "limit": 200
            }),
            status: ToolCallStatus::Pending,
            kind: Some(ToolKind::Read),
            title: Some("Read /repo/src/lib.rs".to_string()),
            suppress_title_read_path_hint: false,
            parent_tool_use_id: None,
            task_children: None,
        };

        let tool_call = build_tool_call_from_raw(parser, raw);

        match tool_call.arguments {
            ToolArguments::Read { file_path, .. } => {
                assert_eq!(file_path.as_deref(), Some("/repo/src/lib.rs"));
            }
            other => panic!("expected Read arguments, got {:?}", other),
        }
    }

    // --- extract_backtick_command unit tests ---

    #[test]
    fn backtick_command_extracts_inner() {
        assert_eq!(
            extract_backtick_command("`ls -la`"),
            Some("ls -la".to_string())
        );
    }

    #[test]
    fn backtick_command_with_whitespace() {
        assert_eq!(
            extract_backtick_command("  `cargo test`  "),
            Some("cargo test".to_string())
        );
    }

    #[test]
    fn backtick_command_no_backticks() {
        assert_eq!(extract_backtick_command("Terminal"), None);
    }

    #[test]
    fn backtick_command_single_backtick() {
        assert_eq!(extract_backtick_command("`"), None);
    }

    #[test]
    fn backtick_command_empty_between_backticks() {
        assert_eq!(extract_backtick_command("``"), None);
    }

    fn seed_tool_name_via_reconciler(session_id: &str, tool_call_id: &str, tool_name: &str) {
        let reconciler = StdArc::new(Mutex::new(TaskReconciler::new()));
        let update = SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: tool_call_id.to_string(),
                name: tool_name.to_string(),
                arguments: ToolArguments::Other { raw: json!({}) },
                raw_input: Some(json!({})),
                status: ToolCallStatus::Pending,
                result: None,
                kind: Some(ToolKind::Other),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some(session_id.to_string()),
        };

        let _ = process_through_reconciler(&update, &reconciler, AgentType::Codex, None);
    }

    #[test]
    fn codex_streaming_update_prefers_explicit_agent_seed_over_current_agent() {
        with_agent(AgentType::ClaudeCode, || {
            let session_id = "codex-streaming-explicit-agent";
            let tool_call_id = "tool-codex-exec";
            cleanup_session_streaming(session_id);
            seed_tool_name_via_reconciler(session_id, tool_call_id, "functions.exec_command");

            let update = build_tool_call_update_from_raw(
                get_parser(AgentType::Codex),
                RawToolCallUpdateInput {
                    id: tool_call_id.to_string(),
                    status: Some(ToolCallStatus::InProgress),
                    result: None,
                    content: None,
                    title: None,
                    locations: None,
                    streaming_input_delta: Some(r#"{"command":"ls -la"}"#.to_string()),
                    tool_name: None,
                    raw_input: None,
                    kind: Some(ToolKind::Execute),
                },
                Some(session_id),
            );

            match update
                .streaming_arguments
                .expect("streaming arguments should use the Codex parser")
            {
                ToolArguments::Execute { command } => {
                    assert_eq!(command.as_deref(), Some("ls -la"));
                }
                other => panic!("expected Execute arguments, got {:?}", other),
            }

            cleanup_session_streaming(session_id);
        });
    }

    #[test]
    fn codex_streaming_overflow_reuses_cached_value_with_explicit_agent() {
        with_agent(AgentType::ClaudeCode, || {
            let session_id = "codex-streaming-explicit-agent-overflow";
            let tool_call_id = "tool-codex-exec-overflow";
            cleanup_session_streaming(session_id);
            seed_tool_name_via_reconciler(session_id, tool_call_id, "functions.exec_command");

            let first = build_tool_call_update_from_raw(
                get_parser(AgentType::Codex),
                RawToolCallUpdateInput {
                    id: tool_call_id.to_string(),
                    status: Some(ToolCallStatus::InProgress),
                    result: None,
                    content: None,
                    title: None,
                    locations: None,
                    streaming_input_delta: Some(r#"{"command":"pwd"}"#.to_string()),
                    tool_name: None,
                    raw_input: None,
                    kind: Some(ToolKind::Execute),
                },
                Some(session_id),
            );

            assert!(matches!(
                first.streaming_arguments,
                Some(ToolArguments::Execute { .. })
            ));

            let overflow = build_tool_call_update_from_raw(
                get_parser(AgentType::Codex),
                RawToolCallUpdateInput {
                    id: tool_call_id.to_string(),
                    status: Some(ToolCallStatus::InProgress),
                    result: None,
                    content: None,
                    title: None,
                    locations: None,
                    streaming_input_delta: Some("x".repeat(1_048_576)),
                    tool_name: None,
                    raw_input: None,
                    kind: Some(ToolKind::Execute),
                },
                Some(session_id),
            );

            match overflow
                .streaming_arguments
                .expect("cached streaming arguments should stay Execute")
            {
                ToolArguments::Execute { command } => {
                    assert_eq!(command.as_deref(), Some("pwd"));
                }
                other => panic!("expected cached Execute arguments, got {:?}", other),
            }

            cleanup_session_streaming(session_id);
        });
    }
}
