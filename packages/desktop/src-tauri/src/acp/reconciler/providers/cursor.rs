//! Cursor adapter for tool name normalization.
//!
//! Cursor uses Anthropic API format plus provider-specific aliases.
//! This adapter handles Cursor-owned names first, then falls back to the
//! shared chat-agent vocabulary for neutral tool normalization.

use super::any_eq;
use super::shared_chat::normalize_shared_chat_tool_name;
use crate::acp::session_update::ToolKind;

/// Adapter for normalizing Cursor tool names.
pub struct CursorAdapter;

impl CursorAdapter {
    /// Normalize Cursor tool names to canonical form.
    ///
    /// Cursor uses Anthropic API format with some custom tool names:
    /// - "codebase_search" for searching the codebase
    /// - "file_editor" for editing files
    ///
    /// Shared chat-style tool names are normalized via the neutral shared table.
    pub fn normalize(name: &str) -> ToolKind {
        if any_eq(
            name,
            &[
                "codebase_search",
                "codebasesearch",
                "search_codebase",
                "searchcodebase",
                "codebase search",
                "grepped",
            ],
        ) {
            return ToolKind::Search;
        }
        if any_eq(
            name,
            &["ls_dir", "list_dir", "listdir", "ls dir", "list directory"],
        ) {
            return ToolKind::Glob;
        }
        if any_eq(
            name,
            &["file_editor", "fileeditor", "code_editor", "codeeditor"],
        ) {
            return ToolKind::Edit;
        }
        if any_eq(name, &["str replace", "strreplace"]) {
            return ToolKind::Edit;
        }
        if any_eq(name, &["edit file", "editfile"]) {
            return ToolKind::Edit;
        }
        if any_eq(name, &["read file", "readfile"]) {
            return ToolKind::Read;
        }
        if any_eq(name, &["delete file", "deletefile"]) {
            return ToolKind::Delete;
        }
        if any_eq(name, &["apply_patch", "applypatch", "apply patch"]) {
            return ToolKind::Edit;
        }
        if any_eq(
            name,
            &["file_reader", "filereader", "code_reader", "codereader"],
        ) {
            return ToolKind::Read;
        }
        if any_eq(name, &["view_image", "viewimage"]) {
            return ToolKind::Read;
        }
        if any_eq(
            name,
            &[
                "run_terminal_cmd",
                "runterminalcmd",
                "terminal_command",
                "terminalcommand",
                "exec_command",
                "execcommand",
                "write_stdin",
                "writestdin",
            ],
        ) {
            return ToolKind::Execute;
        }
        if any_eq(
            name,
            &[
                "cursor/create_plan",
                "_cursor/create_plan",
                "create_plan",
                "createplan",
            ],
        ) {
            return ToolKind::CreatePlan;
        }
        if any_eq(
            name,
            &[
                "cursor/update_todos",
                "_cursor/update_todos",
                "update_todos",
                "updatetodos",
            ],
        ) {
            return ToolKind::Todo;
        }

        normalize_shared_chat_tool_name(name)
    }

    pub fn is_web_search_tool_call_id(id: &str) -> bool {
        id.starts_with("web_search_") || id.starts_with("ws_")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn normalizes_cursor_specific_tools() {
        assert_eq!(
            CursorAdapter::normalize("codebase_search"),
            ToolKind::Search
        );
        assert_eq!(CursorAdapter::normalize("file_editor"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("file_reader"), ToolKind::Read);
        assert_eq!(
            CursorAdapter::normalize("run_terminal_cmd"),
            ToolKind::Execute
        );
    }

    #[test]
    fn normalizes_cursor_update_todos_to_todo_write() {
        // Cursor sends _toolName "updateTodos" inside rawInput for todo management
        assert_eq!(CursorAdapter::normalize("updateTodos"), ToolKind::Todo);
        assert_eq!(CursorAdapter::normalize("update_todos"), ToolKind::Todo);
        assert_eq!(
            CursorAdapter::normalize("cursor/update_todos"),
            ToolKind::Todo
        );
        assert_eq!(CursorAdapter::normalize("updateTodos"), ToolKind::Todo);
    }

    #[test]
    fn normalizes_standard_tools_via_shared_chat_vocabulary() {
        assert_eq!(CursorAdapter::normalize("Read"), ToolKind::Read);
        assert_eq!(CursorAdapter::normalize("Edit"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("Bash"), ToolKind::Execute);
        assert_eq!(CursorAdapter::normalize("Glob"), ToolKind::Glob);
        assert_eq!(CursorAdapter::normalize("WebFetch"), ToolKind::Fetch);
    }

    #[test]
    fn handles_mcp_prefixed_tools_via_shared_chat_vocabulary() {
        assert_eq!(CursorAdapter::normalize("mcp__acp__Read"), ToolKind::Read);
        assert_eq!(
            CursorAdapter::normalize("mcp__acp__Bash"),
            ToolKind::Execute
        );
    }

    #[test]
    fn maps_to_correct_tool_kind() {
        assert_eq!(
            CursorAdapter::normalize("codebase_search"),
            ToolKind::Search
        );
        assert_eq!(CursorAdapter::normalize("file_editor"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("Read"), ToolKind::Read);
    }

    #[test]
    fn returns_unknown_for_unrecognized_tools() {
        assert_eq!(
            CursorAdapter::normalize("custom_cursor_tool"),
            ToolKind::Other
        );
    }

    #[test]
    fn normalizes_apply_patch_to_edit() {
        assert_eq!(CursorAdapter::normalize("apply_patch"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("Apply Patch"), ToolKind::Edit);
    }

    #[test]
    fn normalizes_str_replace_to_edit() {
        assert_eq!(CursorAdapter::normalize("Str Replace"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("str replace"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("StrReplace"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("strreplace"), ToolKind::Edit);
    }

    #[test]
    fn normalizes_live_and_historical_tool_names() {
        // Read
        assert_eq!(CursorAdapter::normalize("Read File"), ToolKind::Read);
        assert_eq!(CursorAdapter::normalize("read file"), ToolKind::Read);
        assert_eq!(CursorAdapter::normalize("readfile"), ToolKind::Read);
        assert_eq!(CursorAdapter::normalize("view_image"), ToolKind::Read);
        assert_eq!(CursorAdapter::normalize("viewimage"), ToolKind::Read);

        // Edit
        assert_eq!(CursorAdapter::normalize("Edit File"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("edit file"), ToolKind::Edit);
        assert_eq!(CursorAdapter::normalize("editfile"), ToolKind::Edit);

        // Delete
        assert_eq!(CursorAdapter::normalize("Delete File"), ToolKind::Delete);
        assert_eq!(CursorAdapter::normalize("delete file"), ToolKind::Delete);
        assert_eq!(CursorAdapter::normalize("deletefile"), ToolKind::Delete);

        // Execute / Bash
        assert_eq!(CursorAdapter::normalize("exec_command"), ToolKind::Execute);
        assert_eq!(CursorAdapter::normalize("execcommand"), ToolKind::Execute);
        assert_eq!(CursorAdapter::normalize("write_stdin"), ToolKind::Execute);
        assert_eq!(CursorAdapter::normalize("writestdin"), ToolKind::Execute);

        // Search
        assert_eq!(
            CursorAdapter::normalize("Codebase Search"),
            ToolKind::Search
        );
        assert_eq!(
            CursorAdapter::normalize("codebase search"),
            ToolKind::Search
        );
        assert_eq!(CursorAdapter::normalize("codebasesearch"), ToolKind::Search);
    }
}
