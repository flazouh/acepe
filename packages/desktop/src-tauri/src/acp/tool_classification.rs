use crate::acp::parsers::kind::{
    canonical_name_for_kind, infer_kind_from_payload, is_browser_tool_name, is_web_search_id,
    is_web_search_title, looks_like_web_search_arguments,
};
use crate::acp::parsers::{get_parser, AgentParser, AgentType};
use crate::acp::session_update::{ToolArguments, ToolCallLocation, ToolKind};

#[derive(Debug, Clone, Copy)]
pub(crate) struct ToolClassificationHints<'a> {
    pub name: Option<&'a str>,
    pub title: Option<&'a str>,
    pub kind: Option<ToolKind>,
    pub kind_hint: Option<&'a str>,
    pub locations: Option<&'a [ToolCallLocation]>,
}

#[derive(Debug, Clone)]
pub(crate) struct ToolIdentity {
    pub name: String,
    pub kind: ToolKind,
}

#[derive(Debug, Clone)]
pub(crate) struct ClassifiedToolData {
    pub name: String,
    pub kind: ToolKind,
    pub arguments: ToolArguments,
}

pub(crate) fn is_unknown_tool_name(name: &str) -> bool {
    let trimmed = name.trim();
    trimmed.is_empty() || trimmed.eq_ignore_ascii_case("unknown")
}

fn canonical_tool_call_name_for_kind(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::WebSearch => "WebSearch",
        _ => canonical_name_for_kind(kind),
    }
}

fn usable_tool_name(name: Option<&str>) -> Option<&str> {
    name.map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| !is_unknown_tool_name(value))
}

fn infer_kind_from_serialized_arguments(arguments: &serde_json::Value) -> Option<ToolKind> {
    let object = arguments.as_object()?;

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

    if object.contains_key("from")
        || object.contains_key("to")
        || object.contains_key("source")
        || object.contains_key("destination")
    {
        return Some(ToolKind::Move);
    }

    let has_edit_markers = object.contains_key("old_string")
        || object.contains_key("oldString")
        || object.contains_key("old_str")
        || object.contains_key("oldText")
        || object.contains_key("new_string")
        || object.contains_key("newString")
        || object.contains_key("new_str")
        || object.contains_key("newText")
        || (object.contains_key("content")
            && (object.contains_key("file_path")
                || object.contains_key("filePath")
                || object.contains_key("path")));
    if has_edit_markers {
        return Some(ToolKind::Edit);
    }

    if object.contains_key("query") || object.contains_key("pattern") {
        return Some(ToolKind::Search);
    }

    if object.contains_key("command") || object.contains_key("cmd") {
        return Some(ToolKind::Execute);
    }

    if object.contains_key("url") {
        return Some(ToolKind::Fetch);
    }

    if object.contains_key("file_path")
        || object.contains_key("filePath")
        || object.contains_key("path")
        || object.contains_key("uri")
    {
        return Some(ToolKind::Read);
    }

    if object.contains_key("description")
        || object.contains_key("prompt")
        || object.contains_key("agent_type")
        || object.contains_key("agentType")
        || object.contains_key("subagent_type")
        || object.contains_key("subagentType")
    {
        return Some(ToolKind::Task);
    }

    None
}

fn apply_web_search_promotion(
    kind: ToolKind,
    id: &str,
    title: Option<&str>,
    raw_arguments: Option<&serde_json::Value>,
) -> ToolKind {
    let argument_implied_web_search = matches!(kind, ToolKind::Fetch | ToolKind::Other)
        && raw_arguments
            .map(looks_like_web_search_arguments)
            .unwrap_or(false);
    if matches!(kind, ToolKind::Fetch | ToolKind::Search | ToolKind::Other)
        && (is_web_search_id(id)
            || title.map(is_web_search_title).unwrap_or(false)
            || argument_implied_web_search)
    {
        ToolKind::WebSearch
    } else {
        kind
    }
}

fn resolve_identity_impl(
    parser: &dyn AgentParser,
    id: &str,
    raw_arguments: Option<&serde_json::Value>,
    hints: ToolClassificationHints<'_>,
    serialized: bool,
) -> ToolIdentity {
    let explicit_name = usable_tool_name(hints.name);

    let detected_kind = explicit_name
        .map(|name| parser.detect_tool_kind(name))
        .filter(|kind| *kind != ToolKind::Other);

    let hint_kind = hints.kind.filter(|kind| *kind != ToolKind::Other);
    let payload_kind = infer_kind_from_payload(id, hints.title, hints.kind_hint)
        .filter(|kind| *kind != ToolKind::Other);

    let serialized_kind = if serialized {
        raw_arguments
            .and_then(infer_kind_from_serialized_arguments)
            .filter(|kind| *kind != ToolKind::Other)
    } else {
        None
    };

    let location_kind = if serialized && hints.locations.is_some_and(|entries| !entries.is_empty())
    {
        Some(ToolKind::Read)
    } else {
        None
    };

    let title_read_kind = if serialized {
        hints.title.and_then(|title_value| {
            let lower = title_value.trim().to_ascii_lowercase();
            if lower.starts_with("viewing ")
                || lower.starts_with("view ")
                || lower.starts_with("read ")
            {
                Some(ToolKind::Read)
            } else {
                None
            }
        })
    } else {
        None
    };

    let kind = detected_kind
        .or(hint_kind)
        .or(payload_kind)
        .or(serialized_kind)
        .or(location_kind)
        .or(title_read_kind)
        .unwrap_or(ToolKind::Other);
    let kind = apply_web_search_promotion(kind, id, hints.title, raw_arguments);

    let name_is_browser = explicit_name.map(is_browser_tool_name).unwrap_or(false);
    let title_is_browser = hints.title.map(is_browser_tool_name).unwrap_or(false);
    let id_is_browser = is_browser_tool_name(id);
    let kind = if (name_is_browser || title_is_browser || id_is_browser)
        && matches!(
            kind,
            ToolKind::Other
                | ToolKind::Read
                | ToolKind::Execute
                | ToolKind::Search
                | ToolKind::Fetch
        ) {
        ToolKind::Browser
    } else {
        kind
    };

    let name = if let Some(name) = explicit_name {
        name.to_string()
    } else if kind != ToolKind::Other {
        canonical_tool_call_name_for_kind(kind).to_string()
    } else {
        hints
            .name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "unknown".to_string())
    };

    ToolIdentity { name, kind }
}

fn parse_arguments_once(
    parser: &dyn AgentParser,
    raw_arguments: &serde_json::Value,
    identity: &ToolIdentity,
    title: Option<&str>,
    kind_hint: Option<&str>,
) -> ToolArguments {
    let parse_name = if is_unknown_tool_name(&identity.name) {
        title
    } else {
        Some(identity.name.as_str())
    };
    let parse_kind_hint = if identity.kind == ToolKind::Other {
        kind_hint
    } else {
        Some(identity.kind.as_str())
    };

    parser
        .parse_typed_tool_arguments(parse_name, raw_arguments, parse_kind_hint)
        .unwrap_or_else(|| {
            if identity.kind == ToolKind::Other {
                ToolArguments::Other {
                    raw: raw_arguments.clone(),
                }
            } else {
                ToolArguments::from_raw(identity.kind, raw_arguments.clone())
            }
        })
}

fn promote_kind(base_kind: ToolKind, argument_kind: ToolKind) -> ToolKind {
    if argument_kind == ToolKind::Other {
        return base_kind;
    }

    match base_kind {
        ToolKind::Other => argument_kind,
        ToolKind::Edit if argument_kind != ToolKind::Edit => argument_kind,
        ToolKind::Search if argument_kind != ToolKind::Search => argument_kind,
        ToolKind::Fetch if argument_kind == ToolKind::WebSearch => argument_kind,
        _ => base_kind,
    }
}

pub(crate) fn resolve_raw_tool_identity(
    parser: &dyn AgentParser,
    id: &str,
    raw_arguments: Option<&serde_json::Value>,
    hints: ToolClassificationHints<'_>,
) -> ToolIdentity {
    resolve_identity_impl(parser, id, raw_arguments, hints, false)
}

pub(crate) fn classify_raw_tool_call(
    parser: &dyn AgentParser,
    id: &str,
    raw_arguments: &serde_json::Value,
    hints: ToolClassificationHints<'_>,
) -> ClassifiedToolData {
    let identity = resolve_raw_tool_identity(parser, id, Some(raw_arguments), hints);
    let arguments = parse_arguments_once(
        parser,
        raw_arguments,
        &identity,
        hints.title,
        hints.kind_hint,
    );
    let kind = promote_kind(identity.kind, arguments.tool_kind());
    let name = if is_unknown_tool_name(&identity.name) && kind != ToolKind::Other {
        canonical_tool_call_name_for_kind(kind).to_string()
    } else {
        identity.name
    };

    ClassifiedToolData {
        name,
        kind,
        arguments,
    }
}

pub(crate) fn classify_serialized_tool_call(
    agent: AgentType,
    id: &str,
    raw_arguments: &serde_json::Value,
    hints: ToolClassificationHints<'_>,
) -> ClassifiedToolData {
    let parser = get_parser(agent);
    let identity = resolve_identity_impl(parser, id, Some(raw_arguments), hints, true);
    let arguments = parse_arguments_once(
        parser,
        raw_arguments,
        &identity,
        hints.title,
        hints.kind_hint,
    );
    let kind = promote_kind(identity.kind, arguments.tool_kind());
    let name = if is_unknown_tool_name(&identity.name) && kind != ToolKind::Other {
        canonical_tool_call_name_for_kind(kind).to_string()
    } else {
        identity.name
    };

    ClassifiedToolData {
        name,
        kind,
        arguments,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::{AgentType, CopilotParser};

    #[test]
    fn raw_classification_promotes_unknown_rg_title_to_search() {
        let parser = CopilotParser;
        let classified = classify_raw_tool_call(
            &parser,
            "tool-rg",
            &serde_json::json!({ "query": "tool_call", "path": "/tmp" }),
            ToolClassificationHints {
                name: Some("unknown"),
                title: Some("rg"),
                kind: Some(ToolKind::Other),
                kind_hint: Some("other"),
                locations: None,
            },
        );

        assert_eq!(classified.kind, ToolKind::Search);
        assert_eq!(classified.name, "Search");
    }

    #[test]
    fn serialized_classification_uses_locations_as_read_fallback() {
        let classified = classify_serialized_tool_call(
            AgentType::Copilot,
            "tool-read",
            &serde_json::json!({ "raw": {} }),
            ToolClassificationHints {
                name: Some("unknown"),
                title: Some("Viewing /tmp/file.rs"),
                kind: None,
                kind_hint: None,
                locations: Some(&[ToolCallLocation {
                    path: "/tmp/file.rs".to_string(),
                }]),
            },
        );

        assert_eq!(classified.kind, ToolKind::Read);
        assert_eq!(classified.name, "Read");
    }

    #[test]
    fn raw_browser_tool_name_overrides_generic_read_hint() {
        let parser = CopilotParser;
        let classified = classify_raw_tool_call(
            &parser,
            "tool-browser",
            &serde_json::json!({ "source": "console" }),
            ToolClassificationHints {
                name: Some("mcp__tauri__read_logs"),
                title: Some("mcp__tauri__read_logs"),
                kind: Some(ToolKind::Read),
                kind_hint: Some("read"),
                locations: None,
            },
        );

        assert_eq!(classified.kind, ToolKind::Browser);
        assert_eq!(classified.name, "mcp__tauri__read_logs");
    }

    #[test]
    fn raw_old_str_and_new_str_markers_infer_edit_kind() {
        let parser = CopilotParser;
        let classified = classify_raw_tool_call(
            &parser,
            "tool-edit",
            &serde_json::json!({
                "path": "/tmp/file.ts",
                "old_str": "const value = 1;",
                "new_str": "const value = 2;"
            }),
            ToolClassificationHints {
                name: Some("unknown"),
                title: Some("Editing /tmp/file.ts"),
                kind: Some(ToolKind::Other),
                kind_hint: Some("other"),
                locations: None,
            },
        );

        assert_eq!(classified.kind, ToolKind::Edit);
        assert_eq!(classified.name, "Edit");
    }

    #[test]
    fn serialized_description_and_query_do_not_promote_to_task() {
        let classified = classify_serialized_tool_call(
            AgentType::Copilot,
            "tool-sql",
            &serde_json::json!({
                "description": "Create planning todos",
                "query": "INSERT INTO todos VALUES ('todo-1')"
            }),
            ToolClassificationHints {
                name: Some("unknown"),
                title: Some("Create planning todos"),
                kind: Some(ToolKind::Other),
                kind_hint: Some("other"),
                locations: None,
            },
        );

        assert_ne!(classified.kind, ToolKind::Task);
    }
}
