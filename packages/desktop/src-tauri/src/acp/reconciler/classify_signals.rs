//! Heuristic classification signals used by the shared reconciler (Unit 3).
//! Consolidates former `acp_kind`, `argument_shape`, `title_heuristic`, and `unclassified` modules.

use crate::acp::parsers::argument_enrichment::{
    parse_parsed_cmd_move, parse_parsed_cmd_path, parse_parsed_cmd_query,
};
use crate::acp::reconciler::kind_payload::has_sql_query_argument;
use crate::acp::reconciler::{RawClassificationInput, SignalName};
use crate::acp::session_update::{ToolArguments, ToolKind};

pub(crate) fn classify_kind_hint(kind_hint: Option<&str>) -> Option<ToolKind> {
    let kind = kind_hint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())?;

    match kind.as_str() {
        "other" => None,
        "read" => Some(ToolKind::Read),
        "edit" => Some(ToolKind::Edit),
        "execute" => Some(ToolKind::Execute),
        "search" => Some(ToolKind::Search),
        "glob" => Some(ToolKind::Glob),
        "fetch" => Some(ToolKind::Fetch),
        "web_search" | "websearch" | "web-search" => Some(ToolKind::WebSearch),
        "think" => Some(ToolKind::Think),
        "todo" => Some(ToolKind::Todo),
        "question" => Some(ToolKind::Question),
        "task" => Some(ToolKind::Task),
        "skill" => Some(ToolKind::Skill),
        "move" => Some(ToolKind::Move),
        "delete" => Some(ToolKind::Delete),
        "enter_plan_mode" | "enterplanmode" | "enter-plan-mode" => Some(ToolKind::EnterPlanMode),
        "exit_plan_mode" | "exitplanmode" | "exit-plan-mode" => Some(ToolKind::ExitPlanMode),
        "create_plan" | "createplan" | "create-plan" => Some(ToolKind::CreatePlan),
        "task_output" | "taskoutput" | "task-output" => Some(ToolKind::TaskOutput),
        "tool_search" | "toolsearch" | "tool-search" => Some(ToolKind::ToolSearch),
        "browser" => Some(ToolKind::Browser),
        "sql" => Some(ToolKind::Sql),
        "unclassified" => Some(ToolKind::Unclassified),
        _ => None,
    }
}

fn has_flag_like_keys(object: &serde_json::Map<String, serde_json::Value>) -> bool {
    object.keys().any(|key| key.starts_with('-'))
}

fn looks_like_glob_pattern(pattern: &str) -> bool {
    pattern.contains('*') || pattern.contains('?') || pattern.contains('[') || pattern.contains('{')
}

fn non_empty_string<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<&'a str> {
    object
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn looks_like_move_target(value: &str) -> bool {
    value.contains('/')
        || value.contains('\\')
        || value.contains('.')
        || value.starts_with('~')
        || value.starts_with("./")
        || value.starts_with("../")
}

fn has_move_shape(object: &serde_json::Map<String, serde_json::Value>) -> bool {
    [(
        non_empty_string(object, "from"),
        non_empty_string(object, "to"),
    )]
    .into_iter()
    .chain([(
        non_empty_string(object, "source"),
        non_empty_string(object, "destination"),
    )])
    .any(|(from, to)| {
        from.zip(to).is_some_and(|(from_value, to_value)| {
            looks_like_move_target(from_value) && looks_like_move_target(to_value)
        })
    })
}

pub(crate) fn classify_argument_shape(arguments: &serde_json::Value) -> Option<ToolKind> {
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

    if has_move_shape(object) {
        return Some(ToolKind::Move);
    }

    if parse_parsed_cmd_move(arguments).is_some() {
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

    let path_like_target = object.contains_key("path")
        || object.contains_key("file_path")
        || object.contains_key("filePath")
        || object.contains_key("target_directory")
        || object.contains_key("targetDirectory");
    let explicit_glob_pattern =
        object.contains_key("glob_pattern") || object.contains_key("globPattern");
    let wildcard_pattern = object
        .get("pattern")
        .and_then(|value| value.as_str())
        .is_some_and(looks_like_glob_pattern);
    let ripgrep_shape = object.contains_key("glob")
        || object.contains_key("output_mode")
        || has_flag_like_keys(object);
    if explicit_glob_pattern || (path_like_target && wildcard_pattern && !ripgrep_shape) {
        return Some(ToolKind::Glob);
    }

    if !ripgrep_shape && has_sql_query_argument(arguments) {
        return Some(ToolKind::Sql);
    }

    if parse_parsed_cmd_query(arguments, &["search", "grep"]).is_some() {
        return Some(ToolKind::Search);
    }

    if object.contains_key("pattern") || object.contains_key("query") {
        return Some(ToolKind::Search);
    }

    if parse_parsed_cmd_path(arguments, &["delete", "remove", "rm"]).is_some() {
        return Some(ToolKind::Delete);
    }

    if parse_parsed_cmd_path(arguments, &["read"]).is_some() {
        return Some(ToolKind::Read);
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

pub(crate) fn classify_title_heuristic(title: Option<&str>) -> Option<ToolKind> {
    let normalized = title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())?;

    if normalized.starts_with("viewing ")
        || normalized.starts_with("view ")
        || normalized.starts_with("read ")
    {
        return Some(ToolKind::Read);
    }

    None
}

const MAX_ARGUMENTS_PREVIEW_LEN: usize = 512;

fn preview_arguments(arguments: &serde_json::Value) -> Option<String> {
    if arguments.is_null() {
        return None;
    }

    let serialized = serde_json::to_string(arguments).ok()?;
    if serialized.is_empty() {
        return None;
    }

    if serialized.len() <= MAX_ARGUMENTS_PREVIEW_LEN {
        return Some(serialized);
    }

    let mut truncated = serialized
        .chars()
        .take(MAX_ARGUMENTS_PREVIEW_LEN.saturating_sub(3))
        .collect::<String>();
    truncated.push_str("...");
    Some(truncated)
}

pub(crate) fn build_unclassified(
    raw: &RawClassificationInput<'_>,
    signals_tried: &[SignalName],
) -> ToolArguments {
    ToolArguments::Unclassified {
        raw_name: raw.name.unwrap_or_default().trim().to_string(),
        raw_kind_hint: raw
            .kind_hint
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        title: raw
            .title
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        arguments_preview: preview_arguments(raw.arguments),
        signals_tried: signals_tried
            .iter()
            .map(|signal| signal.as_str().to_string())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_standard_acp_kind_hints() {
        assert_eq!(classify_kind_hint(Some("read")), Some(ToolKind::Read));
        assert_eq!(
            classify_kind_hint(Some("web_search")),
            Some(ToolKind::WebSearch)
        );
        assert_eq!(classify_kind_hint(Some("sql")), Some(ToolKind::Sql));
    }

    #[test]
    fn ignores_other_and_empty_kind_hints() {
        assert_eq!(classify_kind_hint(Some("other")), None);
        assert_eq!(classify_kind_hint(Some("   ")), None);
        assert_eq!(classify_kind_hint(None), None);
    }

    #[test]
    fn detects_sql_queries_before_generic_query_search() {
        assert_eq!(
            classify_argument_shape(
                &serde_json::json!({ "query": "UPDATE todos SET status = 'done'" })
            ),
            Some(ToolKind::Sql)
        );
    }

    #[test]
    fn detects_sql_before_description_task_shape() {
        assert_eq!(
            classify_argument_shape(&serde_json::json!({
                "description": "Mark all done",
                "query": "UPDATE todos SET status = 'done'"
            })),
            Some(ToolKind::Sql)
        );
    }

    #[test]
    fn does_not_misclassify_ripgrep_queries_for_sql_keywords_as_sql() {
        assert_eq!(
            classify_argument_shape(&serde_json::json!({
                "query": "SELECT",
                "glob": "**/*.ts",
                "output_mode": "content"
            })),
            Some(ToolKind::Search)
        );
    }

    #[test]
    fn detects_execute_shape() {
        assert_eq!(
            classify_argument_shape(&serde_json::json!({ "command": "ls -la" })),
            Some(ToolKind::Execute)
        );
    }

    #[test]
    fn detects_edit_shape() {
        assert_eq!(
            classify_argument_shape(&serde_json::json!({
                "file_path": "/tmp/file.rs",
                "old_string": "before",
                "new_string": "after"
            })),
            Some(ToolKind::Edit)
        );
    }

    #[test]
    fn detects_glob_before_search_for_wildcard_patterns() {
        assert_eq!(
            classify_argument_shape(&serde_json::json!({
                "path": "/repo",
                "pattern": "src/**/*.rs"
            })),
            Some(ToolKind::Glob)
        );
    }

    #[test]
    fn detects_move_when_both_targets_look_like_paths() {
        assert_eq!(
            classify_argument_shape(&serde_json::json!({
                "from": "/tmp/a",
                "to": "/tmp/b"
            })),
            Some(ToolKind::Move)
        );
    }

    #[test]
    fn detects_move_from_parsed_cmd_before_command_fallback() {
        assert_eq!(
            classify_argument_shape(&serde_json::json!({
                "command": ["/bin/zsh", "-lc", "mv /tmp/a /tmp/b"],
                "parsed_cmd": [
                    {
                        "type": "move",
                        "from": "/tmp/a",
                        "to": "/tmp/b"
                    }
                ]
            })),
            Some(ToolKind::Move)
        );
    }

    #[test]
    fn does_not_misclassify_non_path_source_destination_as_move() {
        assert_ne!(
            classify_argument_shape(&serde_json::json!({
                "source": "stderr",
                "destination": "stdout"
            })),
            Some(ToolKind::Move)
        );
    }

    #[test]
    fn infers_read_from_viewing_titles() {
        assert_eq!(
            classify_title_heuristic(Some("Viewing /tmp/file.rs")),
            Some(ToolKind::Read)
        );
        assert_eq!(
            classify_title_heuristic(Some("Read /tmp/file.rs")),
            Some(ToolKind::Read)
        );
    }

    #[test]
    fn ignores_non_matching_titles() {
        assert_eq!(classify_title_heuristic(Some("Apply Patch")), None);
        assert_eq!(classify_title_heuristic(None), None);
    }

    #[test]
    fn stringifies_signal_names_in_unclassified() {
        let arguments = build_unclassified(
            &RawClassificationInput {
                id: "tool-1",
                name: Some(""),
                title: Some("Mark all done"),
                kind_hint: Some("other"),
                arguments: &serde_json::json!({ "query": "UPDATE todos SET status='done'" }),
            },
            &[SignalName::ProviderName, SignalName::ArgumentShape],
        );

        match arguments {
            ToolArguments::Unclassified {
                raw_name,
                raw_kind_hint,
                title,
                arguments_preview,
                signals_tried,
            } => {
                assert!(raw_name.is_empty());
                assert_eq!(raw_kind_hint.as_deref(), Some("other"));
                assert_eq!(title.as_deref(), Some("Mark all done"));
                assert_eq!(
                    signals_tried,
                    vec!["provider_name".to_string(), "argument_shape".to_string()]
                );
                assert!(arguments_preview.is_some());
            }
            other => panic!("expected unclassified arguments, got {other:?}"),
        }
    }

    #[test]
    fn truncates_large_argument_previews() {
        let long_value = "x".repeat(600);
        let arguments = build_unclassified(
            &RawClassificationInput {
                id: "tool-2",
                name: Some("unknown"),
                title: None,
                kind_hint: Some("other"),
                arguments: &serde_json::json!({ "payload": long_value }),
            },
            &[SignalName::ProviderName],
        );

        match arguments {
            ToolArguments::Unclassified {
                arguments_preview: Some(arguments_preview),
                ..
            } => {
                assert!(arguments_preview.len() <= 512);
                assert!(arguments_preview.ends_with("..."));
            }
            other => panic!("expected truncated preview, got {other:?}"),
        }
    }
}
