//! Shared tool-name normalization for chat-style ACP agents.
//!
//! Multiple agents emit the same user-facing tool names even when they are
//! distinct providers. Keep that shared vocabulary here so provider adapters
//! can depend on neutral ownership instead of each other.

use super::any_eq;
use crate::acp::reconciler::kind_payload::is_browser_tool_name;
use crate::acp::session_update::ToolKind;

pub(crate) fn normalize_shared_chat_tool_name(name: &str) -> ToolKind {
    let clean_name = if name.starts_with("mcp__") {
        name.rsplit("__").next().unwrap_or(name)
    } else {
        name
    };

    if is_browser_tool_name(clean_name) || is_browser_tool_name(name) {
        return ToolKind::Browser;
    }

    if any_eq(clean_name, &["read", "readfile", "read_file", "view"]) {
        return ToolKind::Read;
    }
    if any_eq(
        clean_name,
        &["read_lints", "readlints", "read-lints", "read lints"],
    ) {
        return ToolKind::ReadLints;
    }
    if clean_name.eq_ignore_ascii_case("notebookread") {
        return ToolKind::Read;
    }
    if any_eq(
        clean_name,
        &[
            "edit",
            "editfile",
            "edit_file",
            "str_replace_editor",
            "str_replace",
            "apply_patch",
            "applypatch",
            "apply patch",
        ],
    ) {
        return ToolKind::Edit;
    }
    if any_eq(clean_name, &["write", "writefile", "write_file"]) {
        return ToolKind::Edit;
    }
    if clean_name.eq_ignore_ascii_case("notebookedit") {
        return ToolKind::Edit;
    }
    if any_eq(clean_name, &["bash", "execute", "run", "shell", "terminal"]) {
        return ToolKind::Execute;
    }
    if any_eq(clean_name, &["killshell", "killbash"]) {
        return ToolKind::Execute;
    }
    if any_eq(clean_name, &["glob", "ls"]) {
        return ToolKind::Glob;
    }
    if any_eq(clean_name, &["grep", "rg", "ripgrep", "search"]) {
        return ToolKind::Search;
    }
    if clean_name.eq_ignore_ascii_case("find") {
        return ToolKind::Glob;
    }
    if any_eq(clean_name, &["webfetch", "fetch", "http"]) {
        return ToolKind::Fetch;
    }
    if any_eq(clean_name, &["websearch", "web_search", "web"]) {
        return ToolKind::WebSearch;
    }
    if any_eq(clean_name, &["think", "task", "spawn", "agent", "subagent"]) {
        return ToolKind::Task;
    }
    if any_eq(clean_name, &["taskoutput", "task_output"]) {
        return ToolKind::TaskOutput;
    }
    if any_eq(
        clean_name,
        &[
            "todowrite",
            "todo_write",
            "todo",
            "todoread",
            "updatetodos",
            "update_todos",
            "marktodo",
            "mark_todo",
            "tasklist",
            "task_list",
            "todos",
        ],
    ) {
        return ToolKind::Todo;
    }
    if any_eq(clean_name, &["askuser", "askuserquestion", "question"]) {
        return ToolKind::Question;
    }
    if clean_name.eq_ignore_ascii_case("skill") {
        return ToolKind::Skill;
    }
    if any_eq(clean_name, &["enterplanmode", "enter_plan_mode"]) {
        return ToolKind::EnterPlanMode;
    }
    if any_eq(clean_name, &["exitplanmode", "exit_plan_mode"]) {
        return ToolKind::ExitPlanMode;
    }
    if any_eq(clean_name, &["createplan", "create_plan"]) {
        return ToolKind::CreatePlan;
    }
    if any_eq(clean_name, &["toolsearch", "tool_search"]) {
        return ToolKind::ToolSearch;
    }
    if any_eq(clean_name, &["move", "mv", "rename"]) {
        return ToolKind::Move;
    }
    if any_eq(clean_name, &["delete", "rm", "remove"]) {
        return ToolKind::Delete;
    }

    ToolKind::Other
}

#[cfg(test)]
mod tests {
    use super::normalize_shared_chat_tool_name;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn maps_rg_and_ripgrep_to_search() {
        assert_eq!(normalize_shared_chat_tool_name("rg"), ToolKind::Search);
        assert_eq!(normalize_shared_chat_tool_name("ripgrep"), ToolKind::Search);
    }

    #[test]
    fn maps_view_to_read() {
        assert_eq!(normalize_shared_chat_tool_name("view"), ToolKind::Read);
    }

    #[test]
    fn maps_read_lints_to_canonical_kind() {
        assert_eq!(
            normalize_shared_chat_tool_name("read_lints"),
            ToolKind::ReadLints
        );
        assert_eq!(
            normalize_shared_chat_tool_name("Read Lints"),
            ToolKind::ReadLints
        );
    }

    #[test]
    fn maps_copilot_todo_aliases_to_todo() {
        assert_eq!(
            normalize_shared_chat_tool_name("update_todos"),
            ToolKind::Todo
        );
        assert_eq!(normalize_shared_chat_tool_name("mark_todo"), ToolKind::Todo);
    }

    #[test]
    fn maps_mcp_browser_tool_names_to_browser() {
        assert_eq!(
            normalize_shared_chat_tool_name("mcp__tauri__webview_execute_js"),
            ToolKind::Browser
        );
        assert_eq!(
            normalize_shared_chat_tool_name("mcp__tauri__driver_session"),
            ToolKind::Browser
        );
        assert_eq!(
            normalize_shared_chat_tool_name("mcp__tauri__read_logs"),
            ToolKind::Browser
        );
    }
}
