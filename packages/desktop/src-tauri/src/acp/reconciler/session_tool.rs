//! Live tool identity resolution and typed argument parsing for session surfaces (Unit 3).
//!
//! Orchestrates provider name detection (`super::providers`), ACP payload hints (`kind_payload`),
//! argument shape (`classify_signals`), and parser-specific `parse_typed_tool_arguments`.

use super::classify_signals::build_unclassified;
use super::classify_signals::classify_argument_shape;
use super::kind_payload::{
    canonical_name_for_kind, is_browser_tool_name, is_web_search_title,
    looks_like_web_search_arguments,
};
use super::providers;
use super::{RawClassificationInput, SignalName};
use crate::acp::parsers::{get_parser, AgentParser, AgentType};
use crate::acp::session_update::{
    derive_normalized_questions_and_todos, QuestionItem, TodoItem, TodoUpdate, ToolArguments,
    ToolCallLocation, ToolKind,
};

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
    /// Parsed todo items when the tool is a TodoWrite-family tool (e.g. Copilot `update_todos`).
    pub normalized_todos: Option<Vec<TodoItem>>,
    /// Semantic todo update payload when a tool mutates todo state.
    pub normalized_todo_update: Option<TodoUpdate>,
    /// Parsed question items when the tool is a question-type tool.
    pub normalized_questions: Option<Vec<QuestionItem>>,
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
    classify_argument_shape(arguments)
}

fn apply_web_search_promotion(
    agent: AgentType,
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
        && (providers::is_web_search_tool_call_id(agent, id)
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
    let classification_arguments = raw_arguments.unwrap_or(&serde_json::Value::Null);
    let base_output = providers::classify(
        parser.agent_type(),
        &RawClassificationInput {
            id,
            name: hints.name,
            title: hints.title,
            kind_hint: hints.kind_hint,
            arguments: classification_arguments,
        },
    );

    let detected_kind = explicit_name
        .map(|name| providers::detect_tool_kind(parser.agent_type(), name))
        .filter(|kind| !matches!(*kind, ToolKind::Other | ToolKind::Unclassified));

    let classified_kind = match base_output.kind {
        ToolKind::Other | ToolKind::Unclassified => None,
        kind => Some(kind),
    };
    let hinted_kind = hints
        .kind
        .filter(|kind| !matches!(*kind, ToolKind::Other | ToolKind::Unclassified));

    let argument_kind = raw_arguments
        .and_then(infer_kind_from_serialized_arguments)
        .filter(|kind| *kind != ToolKind::Other);

    let generic_read_source = detected_kind
        .or(classified_kind)
        .or(hinted_kind)
        .filter(|kind| *kind == ToolKind::Read);
    let promoted_argument_kind = match (generic_read_source, argument_kind) {
        (
            Some(ToolKind::Read),
            Some(kind @ (ToolKind::Glob | ToolKind::Search | ToolKind::Edit)),
        ) => Some(kind),
        _ => None,
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

    let kind = promoted_argument_kind
        .or(classified_kind)
        .or(hinted_kind)
        .or(location_kind)
        .or(title_read_kind)
        .unwrap_or(base_output.kind);
    let kind =
        apply_web_search_promotion(parser.agent_type(), kind, id, hints.title, raw_arguments);

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
    let kind = if kind == ToolKind::Other {
        ToolKind::Unclassified
    } else {
        kind
    };

    let name = if let Some(name) = explicit_name {
        if let Some(original_kind) = detected_kind {
            let original_canonical = canonical_tool_call_name_for_kind(original_kind);
            if kind != original_kind && name.eq_ignore_ascii_case(original_canonical) {
                canonical_tool_call_name_for_kind(kind).to_string()
            } else {
                name.to_string()
            }
        } else {
            name.to_string()
        }
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
    raw_name: Option<&str>,
    title: Option<&str>,
    kind_hint: Option<&str>,
) -> ToolArguments {
    if identity.kind == ToolKind::Sql {
        return ToolArguments::from_raw(identity.kind, raw_arguments.clone());
    }

    if identity.kind == ToolKind::Unclassified {
        return build_unclassified(
            &RawClassificationInput {
                id: "",
                name: raw_name,
                title,
                kind_hint,
                arguments: raw_arguments,
            },
            &[
                SignalName::ProviderName,
                SignalName::ArgumentShape,
                SignalName::AcpKindHint,
                SignalName::TitleHeuristic,
            ],
        );
    }

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
        hints.name,
        hints.title,
        hints.kind_hint,
    );
    let kind = promote_kind(identity.kind, arguments.tool_kind());
    let name = if is_unknown_tool_name(&identity.name)
        && !matches!(kind, ToolKind::Other | ToolKind::Unclassified)
    {
        canonical_tool_call_name_for_kind(kind).to_string()
    } else {
        identity.name
    };

    let (normalized_questions, normalized_todos, normalized_todo_update) =
        derive_normalized_questions_and_todos(&name, raw_arguments, parser.agent_type());

    ClassifiedToolData {
        name,
        kind,
        arguments,
        normalized_todos,
        normalized_todo_update,
        normalized_questions,
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
        hints.name,
        hints.title,
        hints.kind_hint,
    );
    let kind = promote_kind(identity.kind, arguments.tool_kind());
    let name = if is_unknown_tool_name(&identity.name)
        && !matches!(kind, ToolKind::Other | ToolKind::Unclassified)
    {
        canonical_tool_call_name_for_kind(kind).to_string()
    } else {
        identity.name
    };

    let (normalized_questions, normalized_todos, normalized_todo_update) =
        derive_normalized_questions_and_todos(&name, raw_arguments, agent);

    ClassifiedToolData {
        name,
        kind,
        arguments,
        normalized_todos,
        normalized_todo_update,
        normalized_questions,
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
    fn raw_generic_read_name_with_path_and_pattern_promotes_to_glob() {
        let parser = CopilotParser;
        let classified = classify_raw_tool_call(
            &parser,
            "tool-read-glob",
            &serde_json::json!({
                "path": "/Users/alex/Documents/acepe",
                "pattern": "packages/**/*agent-panel*"
            }),
            ToolClassificationHints {
                name: Some("Read"),
                title: Some("Read"),
                kind: Some(ToolKind::Read),
                kind_hint: Some("read"),
                locations: None,
            },
        );

        assert_eq!(classified.kind, ToolKind::Glob);
        assert_eq!(classified.name, "Find");
        match classified.arguments {
            ToolArguments::Glob { pattern, path } => {
                assert_eq!(pattern.as_deref(), Some("packages/**/*agent-panel*"));
                assert_eq!(path.as_deref(), Some("/Users/alex/Documents/acepe"));
            }
            other => panic!("expected glob arguments, got {other:?}"),
        }
    }

    #[test]
    fn raw_generic_read_name_with_ripgrep_shape_promotes_to_search() {
        let parser = CopilotParser;
        let classified = classify_raw_tool_call(
            &parser,
            "tool-read-grep",
            &serde_json::json!({
                "pattern": "ProjectHeader",
                "glob": "packages/desktop/src/lib/acp/components/session-list/session-list-ui.svelte",
                "output_mode": "content",
                "-n": true,
                "-A": 5
            }),
            ToolClassificationHints {
                name: Some("Read"),
                title: Some("Read"),
                kind: Some(ToolKind::Read),
                kind_hint: Some("read"),
                locations: None,
            },
        );

        assert_eq!(classified.kind, ToolKind::Search);
        assert_eq!(classified.name, "Search");
        match classified.arguments {
            ToolArguments::Search { query, file_path } => {
                assert_eq!(query.as_deref(), Some("ProjectHeader"));
                assert!(file_path.is_none());
            }
            other => panic!("expected search arguments, got {other:?}"),
        }
    }

    #[test]
    fn raw_unknown_name_with_generic_read_hint_and_ripgrep_shape_promotes_to_search() {
        let parser = CopilotParser;
        let classified = classify_raw_tool_call(
            &parser,
            "tool-read-grep-hint",
            &serde_json::json!({
                "pattern": "sentry",
                "glob": "**/Cargo.toml",
                "output_mode": "content",
                "-i": true
            }),
            ToolClassificationHints {
                name: Some("unknown"),
                title: Some("Searching for 'sentry'"),
                kind: Some(ToolKind::Read),
                kind_hint: Some("read"),
                locations: None,
            },
        );

        assert_eq!(classified.kind, ToolKind::Search);
        assert_eq!(classified.name, "Search");
        match classified.arguments {
            ToolArguments::Search { query, file_path } => {
                assert_eq!(query.as_deref(), Some("sentry"));
                assert!(file_path.is_none());
            }
            other => panic!("expected search arguments, got {other:?}"),
        }
    }

    #[test]
    fn serialized_todo_sql_does_not_promote_to_task() {
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
        assert_eq!(classified.kind, ToolKind::Todo);
        assert!(matches!(
            classified.arguments,
            ToolArguments::Think { raw: Some(_), .. }
        ));
    }

    #[test]
    fn serialized_unclassified_tools_keep_unclassified_arguments() {
        let classified = classify_serialized_tool_call(
            AgentType::Copilot,
            "tool-opaque",
            &serde_json::json!({
                "opaque": { "nested": true },
                "label": "mystery"
            }),
            ToolClassificationHints {
                name: Some("unknown"),
                title: Some("Mystery tool"),
                kind: Some(ToolKind::Unclassified),
                kind_hint: Some("unclassified"),
                locations: None,
            },
        );

        assert_eq!(classified.kind, ToolKind::Unclassified);
        assert!(matches!(
            classified.arguments,
            ToolArguments::Unclassified {
                signals_tried: _,
                arguments_preview: Some(_),
                ..
            }
        ));
    }

    #[test]
    fn raw_argument_shape_beats_generic_read_hint_when_provider_name_is_unknown() {
        let parser = CopilotParser;
        let classified = classify_raw_tool_call(
            &parser,
            "tool-exec",
            &serde_json::json!({
                "command": "git status"
            }),
            ToolClassificationHints {
                name: Some("unknown"),
                title: Some("Run"),
                kind: Some(ToolKind::Read),
                kind_hint: Some("read"),
                locations: None,
            },
        );

        assert_eq!(classified.kind, ToolKind::Execute);
        assert_eq!(classified.name, "Run");
        assert!(matches!(
            classified.arguments,
            ToolArguments::Execute {
                command: Some(_),
                ..
            }
        ));
    }
}
