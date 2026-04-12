//! Canonical tool argument parsing helpers.
//!
//! These functions normalise the many different argument shapes sent by
//! agents (Claude Code, Cursor, Codex, OpenCode) into a unified
//! `ToolArguments` enum used by the frontend.

use crate::acp::parsers::argument_enrichment::{
    parse_parsed_cmd_move, parse_parsed_cmd_path, parse_parsed_cmd_query,
};
use crate::acp::session_update::{EditDelta, ToolArguments, ToolKind};

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

pub(crate) fn parse_generic_edit_arguments(raw_arguments: &serde_json::Value) -> ToolArguments {
    let file_path = extract_parser_string(raw_arguments, &["file_path", "filePath", "path"]);
    let move_from = extract_parser_string(raw_arguments, &["move_from", "moveFrom"]);
    let old_string = extract_parser_string(raw_arguments, &["old_string", "oldString", "oldText"]);
    let new_string = extract_parser_string(raw_arguments, &["new_string", "newString", "newText"]);
    let content = extract_parser_string(raw_arguments, &["content"]);

    ToolArguments::Edit {
        edits: vec![if content.is_some() && new_string.is_none() {
            EditDelta::WriteFile {
                file_path,
                move_from,
                previous_content: old_string,
                content,
            }
        } else {
            EditDelta::ReplaceText {
                file_path,
                move_from,
                old_text: old_string,
                new_text: new_string.or(content),
            }
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

pub(crate) fn parse_tool_kind_arguments(
    kind: ToolKind,
    raw_arguments: &serde_json::Value,
) -> ToolArguments {
    match kind {
        ToolKind::Read => ToolArguments::Read {
            file_path: extract_parser_string(raw_arguments, &["file_path", "filePath", "path"])
                .or_else(|| parse_parser_file_uri_path(raw_arguments))
                .or_else(|| parse_parsed_cmd_path(raw_arguments, &["read"])),
        },
        ToolKind::Edit => parse_generic_edit_arguments(raw_arguments),
        ToolKind::Execute => ToolArguments::Execute {
            command: parse_parser_command_string(raw_arguments, &["command", "cmd"]),
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
        ToolKind::EnterPlanMode | ToolKind::ExitPlanMode | ToolKind::CreatePlan => {
            ToolArguments::PlanMode {
                mode: extract_parser_string(raw_arguments, &["mode", "modeId"]),
            }
        }
        ToolKind::ToolSearch => ToolArguments::ToolSearch {
            query: extract_parser_string(raw_arguments, &["query"]),
            max_results: raw_arguments.get("max_results").and_then(|v| v.as_u64()),
        },
        ToolKind::Browser => ToolArguments::Browser {
            raw: raw_arguments.clone(),
        },
        ToolKind::Other => ToolArguments::Other {
            raw: raw_arguments.clone(),
        },
    }
}
