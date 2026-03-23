//! Cursor adapter for tool name normalization.
//!
//! Cursor uses Anthropic API format, similar to Claude Code.
//! This adapter handles Cursor-specific tool names and delegates
//! to ClaudeCodeAdapter for standard tools.

use super::any_eq;
use super::claude_code::ClaudeCodeAdapter;
use crate::acp::parsers::canonical_tool::CanonicalTool;

/// Adapter for normalizing Cursor tool names.
pub struct CursorAdapter;

impl CursorAdapter {
    /// Normalize Cursor tool names to canonical form.
    ///
    /// Cursor uses Anthropic API format with some custom tool names:
    /// - "codebase_search" for searching the codebase
    /// - "file_editor" for editing files
    ///
    /// For standard tools, delegates to ClaudeCodeAdapter.
    pub fn normalize(name: &str) -> CanonicalTool {
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
            return CanonicalTool::Grep;
        }
        if any_eq(
            name,
            &["ls_dir", "list_dir", "listdir", "ls dir", "list directory"],
        ) {
            return CanonicalTool::Glob;
        }
        if any_eq(
            name,
            &["file_editor", "fileeditor", "code_editor", "codeeditor"],
        ) {
            return CanonicalTool::Edit;
        }
        if any_eq(name, &["str replace", "strreplace"]) {
            return CanonicalTool::Edit;
        }
        if any_eq(name, &["edit file", "editfile"]) {
            return CanonicalTool::Edit;
        }
        if any_eq(name, &["read file", "readfile"]) {
            return CanonicalTool::Read;
        }
        if any_eq(name, &["delete file", "deletefile"]) {
            return CanonicalTool::Delete;
        }
        if any_eq(name, &["apply_patch", "applypatch", "apply patch"]) {
            return CanonicalTool::Edit;
        }
        if any_eq(
            name,
            &["file_reader", "filereader", "code_reader", "codereader"],
        ) {
            return CanonicalTool::Read;
        }
        if any_eq(name, &["view_image", "viewimage"]) {
            return CanonicalTool::Read;
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
            return CanonicalTool::Bash;
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
            return CanonicalTool::CreatePlan;
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
            return CanonicalTool::TodoWrite;
        }

        ClaudeCodeAdapter::normalize(name)
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
            CanonicalTool::Grep
        );
        assert_eq!(CursorAdapter::normalize("file_editor"), CanonicalTool::Edit);
        assert_eq!(CursorAdapter::normalize("file_reader"), CanonicalTool::Read);
        assert_eq!(
            CursorAdapter::normalize("run_terminal_cmd"),
            CanonicalTool::Bash
        );
    }

    #[test]
    fn normalizes_cursor_update_todos_to_todo_write() {
        // Cursor sends _toolName "updateTodos" inside rawInput for todo management
        assert_eq!(
            CursorAdapter::normalize("updateTodos"),
            CanonicalTool::TodoWrite
        );
        assert_eq!(
            CursorAdapter::normalize("update_todos"),
            CanonicalTool::TodoWrite
        );
        assert_eq!(
            CursorAdapter::normalize("cursor/update_todos"),
            CanonicalTool::TodoWrite
        );
        assert_eq!(
            ToolKind::from(CursorAdapter::normalize("updateTodos")),
            ToolKind::Todo
        );
    }

    #[test]
    fn delegates_standard_tools_to_claude_code() {
        assert_eq!(CursorAdapter::normalize("Read"), CanonicalTool::Read);
        assert_eq!(CursorAdapter::normalize("Edit"), CanonicalTool::Edit);
        assert_eq!(CursorAdapter::normalize("Bash"), CanonicalTool::Bash);
        assert_eq!(CursorAdapter::normalize("Glob"), CanonicalTool::Glob);
        assert_eq!(
            CursorAdapter::normalize("WebFetch"),
            CanonicalTool::WebFetch
        );
    }

    #[test]
    fn handles_mcp_prefixed_tools_via_delegation() {
        assert_eq!(
            CursorAdapter::normalize("mcp__acp__Read"),
            CanonicalTool::Read
        );
        assert_eq!(
            CursorAdapter::normalize("mcp__acp__Bash"),
            CanonicalTool::Bash
        );
    }

    #[test]
    fn maps_to_correct_tool_kind() {
        let tool = CursorAdapter::normalize("codebase_search");
        assert_eq!(ToolKind::from(tool), ToolKind::Search);

        let tool = CursorAdapter::normalize("file_editor");
        assert_eq!(ToolKind::from(tool), ToolKind::Edit);

        let tool = CursorAdapter::normalize("Read");
        assert_eq!(ToolKind::from(tool), ToolKind::Read);
    }

    #[test]
    fn returns_unknown_for_unrecognized_tools() {
        assert_eq!(
            CursorAdapter::normalize("custom_cursor_tool"),
            CanonicalTool::Unknown("custom_cursor_tool".to_string())
        );
    }

    #[test]
    fn normalizes_apply_patch_to_edit() {
        assert_eq!(CursorAdapter::normalize("apply_patch"), CanonicalTool::Edit);
        assert_eq!(CursorAdapter::normalize("Apply Patch"), CanonicalTool::Edit);
        assert_eq!(
            ToolKind::from(CursorAdapter::normalize("apply_patch")),
            ToolKind::Edit
        );
    }

    #[test]
    fn normalizes_str_replace_to_edit() {
        assert_eq!(CursorAdapter::normalize("Str Replace"), CanonicalTool::Edit);
        assert_eq!(CursorAdapter::normalize("str replace"), CanonicalTool::Edit);
        assert_eq!(CursorAdapter::normalize("StrReplace"), CanonicalTool::Edit);
        assert_eq!(CursorAdapter::normalize("strreplace"), CanonicalTool::Edit);
        assert_eq!(
            ToolKind::from(CursorAdapter::normalize("Str Replace")),
            ToolKind::Edit
        );
    }

    #[test]
    fn normalizes_live_and_historical_tool_names() {
        // Read
        assert_eq!(CursorAdapter::normalize("Read File"), CanonicalTool::Read);
        assert_eq!(CursorAdapter::normalize("read file"), CanonicalTool::Read);
        assert_eq!(CursorAdapter::normalize("readfile"), CanonicalTool::Read);
        assert_eq!(CursorAdapter::normalize("view_image"), CanonicalTool::Read);
        assert_eq!(CursorAdapter::normalize("viewimage"), CanonicalTool::Read);

        // Edit
        assert_eq!(CursorAdapter::normalize("Edit File"), CanonicalTool::Edit);
        assert_eq!(CursorAdapter::normalize("edit file"), CanonicalTool::Edit);
        assert_eq!(CursorAdapter::normalize("editfile"), CanonicalTool::Edit);

        // Delete
        assert_eq!(
            CursorAdapter::normalize("Delete File"),
            CanonicalTool::Delete
        );
        assert_eq!(
            CursorAdapter::normalize("delete file"),
            CanonicalTool::Delete
        );
        assert_eq!(
            CursorAdapter::normalize("deletefile"),
            CanonicalTool::Delete
        );

        // Execute / Bash
        assert_eq!(
            CursorAdapter::normalize("exec_command"),
            CanonicalTool::Bash
        );
        assert_eq!(CursorAdapter::normalize("execcommand"), CanonicalTool::Bash);
        assert_eq!(CursorAdapter::normalize("write_stdin"), CanonicalTool::Bash);
        assert_eq!(CursorAdapter::normalize("writestdin"), CanonicalTool::Bash);

        // Search
        assert_eq!(
            CursorAdapter::normalize("Codebase Search"),
            CanonicalTool::Grep
        );
        assert_eq!(
            CursorAdapter::normalize("codebase search"),
            CanonicalTool::Grep
        );
        assert_eq!(
            CursorAdapter::normalize("codebasesearch"),
            CanonicalTool::Grep
        );
    }
}
