//! ACP `kind` field inference, browser/search heuristics, and markdown-safe canonical names.
//!
//! Lives under `reconciler/` (Unit 3) so parsers remain transport/shape-only — they re-export or call
//! into here instead of owning semantic policy in `parsers/kind`.

use crate::acp::session_update::ToolKind;
use crate::acp::{parsers::AgentType, reconciler::providers};

/// Infer `ToolKind` from an ACP payload's `kind` field value.
///
/// The `kind` field is a hint string sent by the agent (e.g. `"read"`, `"edit"`).
/// When the kind is `"search"` and contextual signals indicate a web search,
/// returns `ToolKind::WebSearch` instead.
pub fn infer_kind_from_payload(
    id: &str,
    title: Option<&str>,
    kind_value: Option<&str>,
) -> Option<ToolKind> {
    infer_kind_from_payload_for_agent(AgentType::ClaudeCode, id, title, kind_value)
}

pub fn infer_kind_from_payload_for_agent(
    agent: AgentType,
    id: &str,
    title: Option<&str>,
    kind_value: Option<&str>,
) -> Option<ToolKind> {
    let kind_opt: Option<String> = kind_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|s| s.to_lowercase());

    // When kind is "other" or missing, infer from title (safety net for live + historical)
    if kind_opt.as_deref() == Some("other") || kind_opt.is_none() {
        if let Some(t) = title {
            let t = t.trim().to_lowercase();
            // Edit
            if t == "apply patch"
                || t == "apply_patch"
                || t == "str replace"
                || t == "strreplace"
                || t == "edit file"
                || t == "editfile"
            {
                return Some(ToolKind::Edit);
            }
            // Read
            if t == "read file" || t == "readfile" || t == "view_image" || t == "viewimage" {
                return Some(ToolKind::Read);
            }
            // Delete
            if t == "delete file" || t == "deletefile" {
                return Some(ToolKind::Delete);
            }
            // Execute / terminal
            if t == "exec_command"
                || t == "execcommand"
                || t == "write_stdin"
                || t == "writestdin"
                || t == "terminal"
                || t == "run terminal cmd"
            {
                return Some(ToolKind::Execute);
            }
            // Search (codebase)
            if t == "codebase search"
                || t == "codebasesearch"
                || t == "grep"
                || t == "rg"
                || t == "ripgrep"
            {
                return Some(ToolKind::Search);
            }
            // Browser / webview automation
            if is_browser_tool_name(&t) {
                return Some(ToolKind::Browser);
            }
        }
    }

    let kind = kind_opt?;

    let is_web_search = providers::is_web_search_tool_call_id(agent, id)
        || title.map(is_web_search_title).unwrap_or(false);

    match kind.as_str() {
        "read" => Some(ToolKind::Read),
        "edit" => Some(ToolKind::Edit),
        "execute" => Some(ToolKind::Execute),
        "search" => Some(if is_web_search {
            ToolKind::WebSearch
        } else {
            ToolKind::Search
        }),
        "read_lints" | "readlints" | "read-lints" => Some(ToolKind::ReadLints),
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

/// Canonical display name for a `ToolKind`.
///
/// Used by the frontend's `formatOtherToolName()` to produce human-readable titles.
pub fn canonical_name_for_kind(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::Read => "Read",
        ToolKind::ReadLints => "Read Lints",
        ToolKind::Edit => "Edit",
        ToolKind::Execute => "Run",
        ToolKind::Search => "Search",
        ToolKind::Glob => "Find",
        ToolKind::Fetch => "Fetch",
        ToolKind::WebSearch => "Web Search",
        ToolKind::Think => "Think",
        ToolKind::Todo => "Todo",
        ToolKind::Question => "Question",
        ToolKind::Task => "Task",
        ToolKind::Skill => "Skill",
        ToolKind::Move => "Move",
        ToolKind::Delete => "Delete",
        ToolKind::EnterPlanMode => "Plan",
        ToolKind::ExitPlanMode => "Plan",
        ToolKind::CreatePlan => "Create Plan",
        ToolKind::TaskOutput => "Task Output",
        ToolKind::ToolSearch => "Tool Search",
        ToolKind::Browser => "Browser",
        ToolKind::Sql => "SQL",
        ToolKind::Unclassified => "Tool",
        ToolKind::Other => "Tool",
    }
}

/// Return the canonical display name for a known tool kind,
/// or fall back to the raw name for unknown tools.
pub fn display_name_for_tool(kind: ToolKind, raw_name: &str) -> String {
    if kind != ToolKind::Other {
        canonical_name_for_kind(kind).to_string()
    } else {
        raw_name.to_string()
    }
}

/// Browser tool name patterns from MCP bridge naming conventions.
const BROWSER_TOOL_SEGMENTS: &[&str] = &[
    "webview_screenshot",
    "webview_find_element",
    "webview_interact",
    "webview_keyboard",
    "webview_wait_for",
    "webview_get_styles",
    "webview_execute_js",
    "webview_dom_snapshot",
    "webview_select_element",
    "webview_get_pointed_element",
    "ipc_execute_command",
    "ipc_monitor",
    "ipc_get_captured",
    "ipc_emit_event",
    "ipc_get_backend_state",
    "driver_session",
    "manage_window",
    "read_logs",
    "list_devices",
];

/// Check whether a tool name looks like a browser/webview automation tool.
///
/// Handles MCP naming conventions: `mcp__server__func`, `server-func`, or plain `func`.
pub fn is_browser_tool_name(name: &str) -> bool {
    let lower = name.to_lowercase();

    // Extract the function segment from MCP naming: mcp__server__func → func, server-func → func
    let func_segment = if lower.contains("__") {
        lower.rsplit("__").next().unwrap_or(&lower)
    } else {
        &lower
    };

    BROWSER_TOOL_SEGMENTS
        .iter()
        .any(|segment| func_segment == *segment || lower.ends_with(segment))
}

/// Check whether a title string indicates a web search.
pub fn is_web_search_title(title: &str) -> bool {
    title.to_lowercase().contains("searching the web")
}

pub(crate) fn has_sql_query_argument(arguments: &serde_json::Value) -> bool {
    let Some(query) = arguments
        .as_object()
        .and_then(|object| object.get("query"))
        .and_then(|value| value.as_str())
    else {
        return false;
    };

    let trimmed = query.trim_start();
    if trimmed.is_empty() {
        return false;
    }

    let upper = trimmed.to_ascii_uppercase();
    [
        "SELECT", "UPDATE", "INSERT", "DELETE", "CREATE", "ALTER", "DROP", "WITH", "PRAGMA",
        "EXPLAIN", "BEGIN", "COMMIT", "ROLLBACK",
    ]
    .iter()
    .any(|keyword| upper.starts_with(keyword))
}

/// Check whether arguments contain web-search signals.
pub fn looks_like_web_search_arguments(arguments: &serde_json::Value) -> bool {
    if has_sql_query_argument(arguments) {
        return false;
    }

    let Some(obj) = arguments.as_object() else {
        return false;
    };

    if let Some(action) = obj.get("action").and_then(|value| value.as_object()) {
        if action.get("type").and_then(|value| value.as_str()) == Some("search") {
            return true;
        }
        if action.get("query").is_some() || action.get("queries").is_some() {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_basic_kinds() {
        assert_eq!(
            infer_kind_from_payload("id", None, Some("read")),
            Some(ToolKind::Read)
        );
        assert_eq!(
            infer_kind_from_payload("id", None, Some("edit")),
            Some(ToolKind::Edit)
        );
        assert_eq!(
            infer_kind_from_payload("id", None, Some("execute")),
            Some(ToolKind::Execute)
        );
        assert_eq!(
            infer_kind_from_payload("id", None, Some("sql")),
            Some(ToolKind::Sql)
        );
        assert_eq!(infer_kind_from_payload("id", None, Some("other")), None);
    }

    #[test]
    fn generic_search_id_does_not_imply_web_search() {
        assert_eq!(
            infer_kind_from_payload("ws_123", None, Some("search")),
            Some(ToolKind::Search)
        );
    }

    #[test]
    fn cursor_search_id_becomes_web_search() {
        assert_eq!(
            infer_kind_from_payload_for_agent(AgentType::Cursor, "ws_123", None, Some("search")),
            Some(ToolKind::WebSearch)
        );
    }

    #[test]
    fn returns_none_for_empty_kind() {
        assert_eq!(infer_kind_from_payload("id", None, Some("")), None);
        assert_eq!(infer_kind_from_payload("id", None, None), None);
    }

    #[test]
    fn infers_edit_from_apply_patch_title_when_kind_other_or_missing() {
        assert_eq!(
            infer_kind_from_payload("id", Some("Apply Patch"), Some("other")),
            Some(ToolKind::Edit)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("Apply Patch"), None),
            Some(ToolKind::Edit)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("apply_patch"), Some("other")),
            Some(ToolKind::Edit)
        );
    }

    #[test]
    fn infers_edit_from_str_replace_or_edit_file_title_when_kind_other_or_missing() {
        assert_eq!(
            infer_kind_from_payload("id", Some("Str Replace"), Some("other")),
            Some(ToolKind::Edit)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("str replace"), None),
            Some(ToolKind::Edit)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("strreplace"), Some("other")),
            Some(ToolKind::Edit)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("Edit File"), Some("other")),
            Some(ToolKind::Edit)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("editfile"), None),
            Some(ToolKind::Edit)
        );
    }

    #[test]
    fn infers_read_delete_execute_search_from_title_when_kind_other_or_missing() {
        assert_eq!(
            infer_kind_from_payload("id", Some("Read File"), Some("other")),
            Some(ToolKind::Read)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("view_image"), None),
            Some(ToolKind::Read)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("Delete File"), Some("other")),
            Some(ToolKind::Delete)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("exec_command"), Some("other")),
            Some(ToolKind::Execute)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("write_stdin"), None),
            Some(ToolKind::Execute)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("Codebase Search"), Some("other")),
            Some(ToolKind::Search)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("rg"), Some("other")),
            Some(ToolKind::Search)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("ripgrep"), None),
            Some(ToolKind::Search)
        );
    }

    #[test]
    fn canonical_names_round_trip() {
        assert_eq!(canonical_name_for_kind(ToolKind::Read), "Read");
        assert_eq!(canonical_name_for_kind(ToolKind::Execute), "Run");
        assert_eq!(canonical_name_for_kind(ToolKind::Glob), "Find");
        assert_eq!(canonical_name_for_kind(ToolKind::WebSearch), "Web Search");
        assert_eq!(canonical_name_for_kind(ToolKind::CreatePlan), "Create Plan");
        assert_eq!(canonical_name_for_kind(ToolKind::TaskOutput), "Task Output");
        assert_eq!(canonical_name_for_kind(ToolKind::Browser), "Browser");
        assert_eq!(canonical_name_for_kind(ToolKind::Sql), "SQL");
        assert_eq!(canonical_name_for_kind(ToolKind::Unclassified), "Tool");
        assert_eq!(canonical_name_for_kind(ToolKind::Other), "Tool");
    }

    #[test]
    fn detects_browser_tool_names() {
        assert!(is_browser_tool_name("mcp__tauri__webview_screenshot"));
        assert!(is_browser_tool_name("mcp__tauri__driver_session"));
        assert!(is_browser_tool_name("mcp__tauri__ipc_execute_command"));
        assert!(is_browser_tool_name("mcp__tauri__manage_window"));
        assert!(is_browser_tool_name("mcp__tauri__read_logs"));
        assert!(is_browser_tool_name("webview_execute_js"));
        assert!(is_browser_tool_name("webview_dom_snapshot"));
        assert!(is_browser_tool_name("tauri-webview_interact"));
        assert!(!is_browser_tool_name("read_file"));
        assert!(!is_browser_tool_name("bash"));
        assert!(!is_browser_tool_name("mcp__server__some_tool"));
    }

    #[test]
    fn infers_browser_from_title_when_kind_other() {
        assert_eq!(
            infer_kind_from_payload("id", Some("webview_screenshot"), Some("other")),
            Some(ToolKind::Browser)
        );
        assert_eq!(
            infer_kind_from_payload("id", Some("driver_session"), None),
            Some(ToolKind::Browser)
        );
    }

    #[test]
    fn sql_queries_do_not_look_like_web_search_arguments() {
        assert!(!looks_like_web_search_arguments(&serde_json::json!({
            "description": "Check todo completion",
            "query": "SELECT COUNT(*) AS done_count FROM todos WHERE status = 'done';"
        })));
        assert!(has_sql_query_argument(&serde_json::json!({
            "query": "UPDATE todos SET status = 'done' WHERE id = 'todo-1';"
        })));
    }
}
