//! Canonical tool argument parsing helpers.
//!
//! These functions normalise the many different argument shapes sent by
//! agents (Claude Code, Cursor, Codex, OpenCode) into a unified
//! `ToolArguments` enum used by the frontend.

use crate::acp::parsers::argument_enrichment::{
    parse_parsed_cmd_move, parse_parsed_cmd_path, parse_parsed_cmd_query,
};
use crate::acp::session_update::{
    EditEntry, ToolArguments, ToolKind, ToolSourceContext, ToolSourceRange,
};

pub(crate) fn extract_parser_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
    })
}

pub(crate) fn extract_parser_string_list(
    value: &serde_json::Value,
    keys: &[&str],
) -> Option<Vec<String>> {
    keys.iter().find_map(|key| {
        let items = value.get(key)?.as_array()?;
        let values: Vec<String> = items
            .iter()
            .filter_map(|item| item.as_str())
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect();

        if values.is_empty() {
            return None;
        }

        Some(values)
    })
}

pub(crate) fn extract_parser_bool(value: &serde_json::Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(serde_json::Value::as_bool))
}

pub(crate) fn extract_parser_i64(value: &serde_json::Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(serde_json::Value::as_i64))
}

fn has_plan_payload(raw_arguments: &serde_json::Value) -> bool {
    extract_parser_string(raw_arguments, &["plan", "content", "planMarkdown"]).is_some()
}

fn extract_plan_title_from_markdown(plan: &str) -> Option<String> {
    for line in plan.lines() {
        let trimmed = line.trim();
        let heading_level = trimmed.chars().take_while(|ch| *ch == '#').count();
        if heading_level == 0 || heading_level > 6 {
            continue;
        }

        let title = trimmed
            .get(heading_level..)?
            .trim()
            .trim_end_matches('#')
            .trim();
        if !title.is_empty() {
            return Some(title.to_string());
        }
    }

    None
}

fn parse_plan_mode_arguments(raw_arguments: &serde_json::Value) -> ToolArguments {
    let plan = extract_parser_string(raw_arguments, &["plan", "content", "planMarkdown"]);
    let title = extract_parser_string(raw_arguments, &["title"])
        .or_else(|| plan.as_deref().and_then(extract_plan_title_from_markdown));

    ToolArguments::PlanMode {
        mode: extract_parser_string(raw_arguments, &["mode", "modeId"]),
        plan,
        plan_file_path: extract_parser_string(
            raw_arguments,
            &[
                "planFilePath",
                "planPath",
                "filePath",
                "plan_file_path",
                "file_path",
                "path",
            ],
        ),
        title,
    }
}

pub(crate) fn parse_generic_edit_arguments(raw_arguments: &serde_json::Value) -> ToolArguments {
    let file_path = extract_parser_string(raw_arguments, &["file_path", "filePath", "path"]);
    let move_from = extract_parser_string(raw_arguments, &["move_from", "moveFrom"]);
    let old_string = extract_parser_string(
        raw_arguments,
        &["old_string", "oldString", "oldText", "old_str"],
    );
    let new_string = extract_parser_string(
        raw_arguments,
        &["new_string", "newString", "newText", "new_str"],
    );
    let content = extract_parser_string(raw_arguments, &["content"]);

    ToolArguments::Edit {
        edits: vec![EditEntry {
            file_path,
            move_from,
            old_string,
            new_string,
            content,
        }],
    }
}

pub(crate) fn parse_parser_command_string(
    value: &serde_json::Value,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        if let Some(raw_value) = value.get(key) {
            if let Some(command) = raw_value.as_str() {
                let trimmed = command.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }

            if let Some(parts) = raw_value.as_array() {
                let command_parts: Vec<&str> =
                    parts.iter().filter_map(|part| part.as_str()).collect();
                if command_parts.is_empty() {
                    continue;
                }
                if command_parts.len() >= 3 && command_parts[1] == "-lc" {
                    let trimmed = command_parts[2].trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
                let joined = command_parts.join(" ").trim().to_string();
                if !joined.is_empty() {
                    return Some(joined);
                }
            }
        }
    }
    None
}

pub(crate) fn parse_parser_first_item_string(
    value: &serde_json::Value,
    list_key: &str,
    field_keys: &[&str],
) -> Option<String> {
    let items = value.get(list_key)?.as_array()?;
    let first = items.first()?;
    extract_parser_string(first, field_keys)
}

pub(crate) fn parse_parser_string_from_nested_object(
    value: &serde_json::Value,
    object_key: &str,
    field_keys: &[&str],
) -> Option<String> {
    let nested = value.get(object_key)?;
    extract_parser_string(nested, field_keys)
}

pub(crate) fn parse_parser_first_item_string_from_nested_list(
    value: &serde_json::Value,
    object_key: &str,
    list_key: &str,
) -> Option<String> {
    let nested = value.get(object_key)?;
    let items = nested.get(list_key)?.as_array()?;
    let first = items.first()?.as_str()?.trim();
    if first.is_empty() {
        return None;
    }
    Some(first.to_string())
}

pub(crate) fn parse_parser_string_or_json(
    value: &serde_json::Value,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        let Some(raw_value) = value.get(key) else {
            continue;
        };
        if let Some(string_value) = raw_value.as_str() {
            let trimmed = string_value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
            continue;
        }
        if raw_value.is_null() {
            continue;
        }
        if let Ok(serialized) = serde_json::to_string(raw_value) {
            let trimmed = serialized.trim();
            if !trimmed.is_empty() && trimmed != "null" {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

pub(crate) fn parse_parser_file_uri_path(value: &serde_json::Value) -> Option<String> {
    let uri = extract_parser_string(value, &["uri"])?;
    let stripped = uri.trim().strip_prefix("file://")?;
    let path = stripped.trim();
    if path.is_empty() {
        return None;
    }
    Some(path.to_string())
}

pub(crate) fn parse_parser_search_query_from_url(url: &str) -> Option<String> {
    let (base, query_string) = url.split_once('?')?;
    let lower_base = base.to_ascii_lowercase();
    let looks_like_search_path = lower_base.ends_with("/search")
        || lower_base.contains("/search/")
        || lower_base.ends_with("/find")
        || lower_base.contains("/find/");
    if !looks_like_search_path {
        return None;
    }
    for segment in query_string.split('&') {
        let (key, value) = segment.split_once('=').unwrap_or((segment, ""));
        if !matches!(key, "q" | "query" | "p") || value.is_empty() {
            continue;
        }
        let plus_decoded = value.replace('+', " ");
        if let Ok(decoded) = urlencoding::decode(&plus_decoded) {
            let trimmed = decoded.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        let trimmed = plus_decoded.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

pub(crate) fn parse_parser_search_query_from_url_value(
    value: &serde_json::Value,
) -> Option<String> {
    let url = extract_parser_string(value, &["url"])?;
    parse_parser_search_query_from_url(&url)
}

pub(crate) fn parse_parser_skill_shape(
    raw: &serde_json::Value,
) -> (Option<String>, Option<String>) {
    (
        extract_parser_string(raw, &["skill_name", "skill", "name"]),
        parse_parser_string_or_json(raw, &["args", "skill_args", "skillArgs"]),
    )
}

fn parse_view_range(raw: &serde_json::Value) -> Option<ToolSourceRange> {
    let obj = raw.get("view_range").or_else(|| raw.get("viewRange"))?;
    let start_line = obj
        .get("start_line")
        .or_else(|| obj.get("startLine"))
        .or_else(|| obj.get("start"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let end_line = obj
        .get("end_line")
        .or_else(|| obj.get("endLine"))
        .or_else(|| obj.get("end"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    if start_line.is_none() && end_line.is_none() {
        return None;
    }
    Some(ToolSourceRange {
        start_line,
        end_line,
    })
}

/// Structured read metadata (R13): excerpts, line ranges, optional alternate path keys.
pub(crate) fn parse_read_source_context(
    file_path: &Option<String>,
    raw: &serde_json::Value,
) -> Option<ToolSourceContext> {
    let view_range = parse_view_range(raw);
    let excerpt = extract_parser_string(raw, &["excerpt", "lines", "snippet", "text"])
        .filter(|s| !s.is_empty());
    let path = extract_parser_string(raw, &["path", "source_path", "sourcePath"])
        .or_else(|| file_path.clone());

    if view_range.is_none() && excerpt.is_none() {
        return None;
    }

    Some(ToolSourceContext {
        path,
        view_range,
        excerpt,
    })
}

pub(crate) fn parse_tool_kind_arguments(
    kind: ToolKind,
    raw_arguments: &serde_json::Value,
) -> ToolArguments {
    match kind {
        ToolKind::Read => {
            let file_path =
                extract_parser_string(raw_arguments, &["file_path", "filePath", "path"])
                    .or_else(|| parse_parser_file_uri_path(raw_arguments))
                    .or_else(|| parse_parsed_cmd_path(raw_arguments, &["read"]));
            let source_context = parse_read_source_context(&file_path, raw_arguments);
            ToolArguments::Read {
                file_path,
                source_context,
            }
        }
        ToolKind::ReadLints => ToolArguments::ReadLints {
            raw: raw_arguments.clone(),
        },
        ToolKind::Edit => parse_generic_edit_arguments(raw_arguments),
        ToolKind::Execute => ToolArguments::Execute {
            command: parse_parser_command_string(raw_arguments, &["command", "cmd"]),
        },
        ToolKind::ShellInput => ToolArguments::ShellInput {
            shell_id: extract_parser_string(raw_arguments, &["shellId", "shell_id", "shell"]),
            input: extract_parser_string(raw_arguments, &["input", "text", "chars"]),
        },
        ToolKind::Search => ToolArguments::Search {
            query: extract_parser_string(raw_arguments, &["query", "pattern"])
                .or_else(|| {
                    parse_parser_first_item_string(
                        raw_arguments,
                        "find",
                        &["pattern", "query", "q"],
                    )
                })
                .or_else(|| parse_parsed_cmd_query(raw_arguments, &["search", "grep"])),
            file_path: extract_parser_string(raw_arguments, &["file_path", "filePath", "path"])
                .or_else(|| parse_parsed_cmd_path(raw_arguments, &["search", "grep"])),
        },
        ToolKind::Glob => ToolArguments::Glob {
            pattern: extract_parser_string(
                raw_arguments,
                &["pattern", "query", "glob_pattern", "globPattern"],
            ),
            path: extract_parser_string(
                raw_arguments,
                &[
                    "path",
                    "file_path",
                    "filePath",
                    "target_directory",
                    "targetDirectory",
                ],
            ),
        },
        ToolKind::Fetch => {
            // Upgrade to WebSearch if the URL is a search URL (e.g. github.com/search?q=...)
            if let Some(query) = parse_parser_search_query_from_url_value(raw_arguments) {
                return ToolArguments::WebSearch { query: Some(query) };
            }
            ToolArguments::Fetch {
                url: extract_parser_string(raw_arguments, &["url", "ref_id"])
                    .or_else(|| parse_parser_first_item_string(raw_arguments, "open", &["ref_id"]))
                    .or_else(|| parse_parser_first_item_string(raw_arguments, "click", &["ref_id"]))
                    .or_else(|| {
                        parse_parser_first_item_string(raw_arguments, "screenshot", &["ref_id"])
                    }),
            }
        }
        ToolKind::WebSearch => ToolArguments::WebSearch {
            query: extract_parser_string(raw_arguments, &["query", "q"])
                .or_else(|| {
                    parse_parser_string_from_nested_object(raw_arguments, "action", &["query", "q"])
                })
                .or_else(|| {
                    parse_parser_first_item_string_from_nested_list(
                        raw_arguments,
                        "action",
                        "queries",
                    )
                })
                .or_else(|| parse_parser_first_item_string(raw_arguments, "search_query", &["q"]))
                .or_else(|| parse_parser_first_item_string(raw_arguments, "image_query", &["q"]))
                .or_else(|| parse_parser_first_item_string(raw_arguments, "finance", &["ticker"]))
                .or_else(|| parse_parser_first_item_string(raw_arguments, "weather", &["location"]))
                .or_else(|| {
                    parse_parser_first_item_string(raw_arguments, "sports", &["league", "team"])
                })
                .or_else(|| parse_parser_first_item_string(raw_arguments, "time", &["utc_offset"]))
                .or_else(|| parse_parser_search_query_from_url_value(raw_arguments)),
        },
        ToolKind::Sql => ToolArguments::Sql {
            query: extract_parser_string(raw_arguments, &["query", "sql", "statement"]),
            description: extract_parser_string(raw_arguments, &["description"]),
        },
        ToolKind::TaskOutput => ToolArguments::TaskOutput {
            task_id: extract_parser_string(raw_arguments, &["task_id", "taskId"]),
            timeout: raw_arguments.get("timeout").and_then(|v| v.as_u64()),
        },
        ToolKind::Think
        | ToolKind::Task
        | ToolKind::Todo
        | ToolKind::Question
        | ToolKind::Skill => {
            let (skill, skill_args) = parse_parser_skill_shape(raw_arguments);
            ToolArguments::Think {
                description: extract_parser_string(raw_arguments, &["description"]),
                prompt: extract_parser_string(raw_arguments, &["prompt"]),
                subagent_type: extract_parser_string(
                    raw_arguments,
                    &["subagent_type", "subagentType", "agent_type", "agentType"],
                ),
                skill,
                skill_args,
                raw: Some(raw_arguments.clone()),
            }
        }
        ToolKind::Move => {
            let parsed_cmd_move = parse_parsed_cmd_move(raw_arguments);
            ToolArguments::Move {
                from: extract_parser_string(raw_arguments, &["from", "source"])
                    .or_else(|| parsed_cmd_move.as_ref().and_then(|(from, _)| from.clone())),
                to: extract_parser_string(raw_arguments, &["to", "destination"])
                    .or_else(|| parsed_cmd_move.as_ref().and_then(|(_, to)| to.clone())),
            }
        }
        ToolKind::Delete => ToolArguments::Delete {
            file_path: extract_parser_string(raw_arguments, &["file_path", "filePath", "path"])
                .or_else(|| parse_parsed_cmd_path(raw_arguments, &["delete", "remove", "rm"]))
                .or_else(|| {
                    extract_parser_string_list(raw_arguments, &["file_paths", "filePaths", "paths"])
                        .and_then(|paths| paths.first().cloned())
                }),
            file_paths: extract_parser_string_list(
                raw_arguments,
                &["file_paths", "filePaths", "paths"],
            ),
        },
        ToolKind::ExitPlanMode | ToolKind::CreatePlan if has_plan_payload(raw_arguments) => {
            parse_plan_mode_arguments(raw_arguments)
        }
        ToolKind::EnterPlanMode | ToolKind::ExitPlanMode | ToolKind::CreatePlan => {
            parse_plan_mode_arguments(raw_arguments)
        }
        ToolKind::ToolSearch => ToolArguments::ToolSearch {
            query: extract_parser_string(raw_arguments, &["query"]),
            max_results: raw_arguments.get("max_results").and_then(|v| v.as_u64()),
        },
        ToolKind::Browser => ToolArguments::Browser {
            raw: raw_arguments.clone(),
            action: extract_parser_string(raw_arguments, &["action"]),
            selector: extract_parser_string(raw_arguments, &["selector"]),
            script: extract_parser_string(raw_arguments, &["script"]),
        },
        ToolKind::Computer => ToolArguments::Computer {
            verb: extract_parser_string(raw_arguments, &["v", "verb", "action"]),
            target_id: extract_parser_string(
                raw_arguments,
                &[
                    "t",
                    "target_id",
                    "targetId",
                    "target",
                    "element_id",
                    "elementId",
                ],
            ),
            epoch: extract_parser_string(
                raw_arguments,
                &["e", "epoch", "snapshot_epoch", "snapshotEpoch"],
            ),
            text: extract_parser_string(raw_arguments, &["txt", "text"]),
            key: extract_parser_string(raw_arguments, &["k", "key"]),
            delta_x: extract_parser_i64(raw_arguments, &["dx", "delta_x", "deltaX"]),
            delta_y: extract_parser_i64(raw_arguments, &["dy", "delta_y", "deltaY"]),
            include_bounds: extract_parser_bool(
                raw_arguments,
                &[
                    "b",
                    "include_bounds",
                    "includeBounds",
                    "with_bounds",
                    "withBounds",
                ],
            ),
            include_screenshot: extract_parser_bool(
                raw_arguments,
                &[
                    "s",
                    "include_screenshot",
                    "includeScreenshot",
                    "with_screenshot",
                    "withScreenshot",
                ],
            ),
        },
        ToolKind::Unclassified => ToolArguments::Unclassified {
            provider_name: extract_parser_string(
                raw_arguments,
                &[
                    "provider_name",
                    "providerName",
                    "raw_name",
                    "rawName",
                    "name",
                ],
            )
            .unwrap_or_default(),
            provider_kind_hint: extract_parser_string(
                raw_arguments,
                &[
                    "provider_kind_hint",
                    "providerKindHint",
                    "raw_kind_hint",
                    "rawKindHint",
                    "kind_hint",
                    "kindHint",
                ],
            ),
            title: extract_parser_string(raw_arguments, &["title"]),
            arguments_preview: parse_parser_string_or_json(
                raw_arguments,
                &["arguments_preview", "argumentsPreview"],
            ),
            signals_tried: extract_parser_string_list(
                raw_arguments,
                &["signals_tried", "signalsTried"],
            )
            .unwrap_or_default(),
        },
        ToolKind::Other => ToolArguments::Other {
            raw: raw_arguments.clone(),
            intent: extract_parser_string(raw_arguments, &["intent"]),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_browser_display_fields_from_raw_arguments() {
        let args = parse_tool_kind_arguments(
            ToolKind::Browser,
            &json!({
                "action": "click",
                "selector": "[data-testid='submit']",
                "script": "document.body.innerText",
            }),
        );

        match args {
            ToolArguments::Browser {
                action,
                selector,
                script,
                ..
            } => {
                assert_eq!(action.as_deref(), Some("click"));
                assert_eq!(selector.as_deref(), Some("[data-testid='submit']"));
                assert_eq!(script.as_deref(), Some("document.body.innerText"));
            }
            other => panic!("expected browser arguments, got {other:?}"),
        }
    }

    #[test]
    fn parses_computer_action_fields_from_raw_arguments() {
        let args = parse_tool_kind_arguments(
            ToolKind::Computer,
            &json!({
                "v": "click",
                "t": "e_4f2",
                "e": "s_912",
                "txt": "hello",
                "k": "enter",
                "dx": 8,
                "dy": -4,
                "b": true,
                "s": false,
            }),
        );

        match args {
            ToolArguments::Computer {
                verb,
                target_id,
                epoch,
                text,
                key,
                delta_x,
                delta_y,
                include_bounds,
                include_screenshot,
            } => {
                assert_eq!(verb.as_deref(), Some("click"));
                assert_eq!(target_id.as_deref(), Some("e_4f2"));
                assert_eq!(epoch.as_deref(), Some("s_912"));
                assert_eq!(text.as_deref(), Some("hello"));
                assert_eq!(key.as_deref(), Some("enter"));
                assert_eq!(delta_x, Some(8));
                assert_eq!(delta_y, Some(-4));
                assert_eq!(include_bounds, Some(true));
                assert_eq!(include_screenshot, Some(false));
            }
            other => panic!("expected computer arguments, got {other:?}"),
        }
    }

    #[test]
    fn parses_other_display_intent_from_raw_arguments() {
        let args = parse_tool_kind_arguments(
            ToolKind::Other,
            &json!({
                "intent": "Viewing extracted lines",
            }),
        );

        match args {
            ToolArguments::Other { intent, .. } => {
                assert_eq!(intent.as_deref(), Some("Viewing extracted lines"));
            }
            other => panic!("expected other arguments, got {other:?}"),
        }
    }
}
