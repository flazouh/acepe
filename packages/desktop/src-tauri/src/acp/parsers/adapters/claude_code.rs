//! Claude Code adapter for tool name normalization.
//!
//! Claude Code uses tool names like "Read", "Edit", "Bash", "Glob", etc.
//! This adapter normalizes these names to the canonical `CanonicalTool` enum.

use super::any_eq;
use crate::acp::parsers::canonical_tool::CanonicalTool;

/// Adapter for normalizing Claude Code tool names.
pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    /// Normalize Claude Code tool names to canonical form.
    ///
    /// Claude Code uses tool names like:
    /// - "Read", "Edit", "Bash", "Glob"
    /// - MCP prefixed: "mcp__acp__Read", "mcp__plugin_playwright__browser_click"
    pub fn normalize(name: &str) -> CanonicalTool {
        // Strip MCP prefix: "mcp__acp__Bash" -> "Bash"
        let clean_name = if name.starts_with("mcp__") {
            name.rsplit("__").next().unwrap_or(name)
        } else {
            name
        };

        if any_eq(clean_name, &["read", "readfile", "read_file"]) {
            return CanonicalTool::Read;
        }
        if clean_name.eq_ignore_ascii_case("notebookread") {
            return CanonicalTool::NotebookRead;
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
            return CanonicalTool::Edit;
        }
        if any_eq(clean_name, &["write", "writefile", "write_file"]) {
            return CanonicalTool::Write;
        }
        if clean_name.eq_ignore_ascii_case("notebookedit") {
            return CanonicalTool::NotebookEdit;
        }
        if any_eq(clean_name, &["bash", "execute", "run", "shell", "terminal"]) {
            return CanonicalTool::Bash;
        }
        if any_eq(clean_name, &["killshell", "killbash"]) {
            return CanonicalTool::KillShell;
        }
        if any_eq(clean_name, &["glob", "ls"]) {
            return CanonicalTool::Glob;
        }
        if any_eq(clean_name, &["grep", "search"]) {
            return CanonicalTool::Grep;
        }
        if clean_name.eq_ignore_ascii_case("find") {
            return CanonicalTool::Find;
        }
        if any_eq(clean_name, &["webfetch", "fetch", "http"]) {
            return CanonicalTool::WebFetch;
        }
        if any_eq(clean_name, &["websearch", "web_search", "web"]) {
            return CanonicalTool::WebSearch;
        }
        if any_eq(clean_name, &["think", "task", "spawn", "agent", "subagent"]) {
            return CanonicalTool::Task;
        }
        if any_eq(clean_name, &["todowrite", "todo", "todoread"]) {
            return CanonicalTool::TodoWrite;
        }
        if any_eq(clean_name, &["askuser", "askuserquestion", "question"]) {
            return CanonicalTool::AskUserQuestion;
        }
        if clean_name.eq_ignore_ascii_case("skill") {
            return CanonicalTool::Skill;
        }
        if any_eq(clean_name, &["enterplanmode", "enter_plan_mode"]) {
            return CanonicalTool::EnterPlanMode;
        }
        if any_eq(clean_name, &["exitplanmode", "exit_plan_mode"]) {
            return CanonicalTool::ExitPlanMode;
        }
        if any_eq(clean_name, &["createplan", "create_plan"]) {
            return CanonicalTool::CreatePlan;
        }
        if any_eq(clean_name, &["move", "mv", "rename"]) {
            return CanonicalTool::Move;
        }
        if any_eq(clean_name, &["delete", "rm", "remove"]) {
            return CanonicalTool::Delete;
        }

        CanonicalTool::Unknown(name.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn normalizes_read_variants() {
        assert_eq!(ClaudeCodeAdapter::normalize("Read"), CanonicalTool::Read);
        assert_eq!(ClaudeCodeAdapter::normalize("read"), CanonicalTool::Read);
        assert_eq!(
            ClaudeCodeAdapter::normalize("ReadFile"),
            CanonicalTool::Read
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("read_file"),
            CanonicalTool::Read
        );
    }

    #[test]
    fn normalizes_edit_variants() {
        assert_eq!(ClaudeCodeAdapter::normalize("Edit"), CanonicalTool::Edit);
        assert_eq!(ClaudeCodeAdapter::normalize("edit"), CanonicalTool::Edit);
        assert_eq!(
            ClaudeCodeAdapter::normalize("str_replace_editor"),
            CanonicalTool::Edit
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("str_replace"),
            CanonicalTool::Edit
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("apply_patch"),
            CanonicalTool::Edit
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("Apply Patch"),
            CanonicalTool::Edit
        );
    }

    #[test]
    fn normalizes_write_variants() {
        assert_eq!(ClaudeCodeAdapter::normalize("Write"), CanonicalTool::Write);
        assert_eq!(ClaudeCodeAdapter::normalize("write"), CanonicalTool::Write);
        assert_eq!(
            ClaudeCodeAdapter::normalize("WriteFile"),
            CanonicalTool::Write
        );
    }

    #[test]
    fn normalizes_bash_variants() {
        assert_eq!(ClaudeCodeAdapter::normalize("Bash"), CanonicalTool::Bash);
        assert_eq!(ClaudeCodeAdapter::normalize("bash"), CanonicalTool::Bash);
        assert_eq!(ClaudeCodeAdapter::normalize("execute"), CanonicalTool::Bash);
        assert_eq!(ClaudeCodeAdapter::normalize("run"), CanonicalTool::Bash);
        assert_eq!(ClaudeCodeAdapter::normalize("shell"), CanonicalTool::Bash);
        assert_eq!(
            ClaudeCodeAdapter::normalize("terminal"),
            CanonicalTool::Bash
        );
    }

    #[test]
    fn normalizes_kill_shell() {
        assert_eq!(
            ClaudeCodeAdapter::normalize("KillShell"),
            CanonicalTool::KillShell
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("killbash"),
            CanonicalTool::KillShell
        );
    }

    #[test]
    fn normalizes_search_tools() {
        assert_eq!(ClaudeCodeAdapter::normalize("Glob"), CanonicalTool::Glob);
        assert_eq!(ClaudeCodeAdapter::normalize("ls"), CanonicalTool::Glob);
        assert_eq!(ClaudeCodeAdapter::normalize("Grep"), CanonicalTool::Grep);
        assert_eq!(ClaudeCodeAdapter::normalize("Find"), CanonicalTool::Find);
    }

    #[test]
    fn normalizes_web_tools() {
        assert_eq!(
            ClaudeCodeAdapter::normalize("WebFetch"),
            CanonicalTool::WebFetch
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("fetch"),
            CanonicalTool::WebFetch
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("WebSearch"),
            CanonicalTool::WebSearch
        );
    }

    #[test]
    fn normalizes_think_tools() {
        assert_eq!(ClaudeCodeAdapter::normalize("Task"), CanonicalTool::Task);
        assert_eq!(ClaudeCodeAdapter::normalize("spawn"), CanonicalTool::Task);
        assert_eq!(ClaudeCodeAdapter::normalize("agent"), CanonicalTool::Task);
        assert_eq!(
            ClaudeCodeAdapter::normalize("subagent"),
            CanonicalTool::Task
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("TodoWrite"),
            CanonicalTool::TodoWrite
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("AskUserQuestion"),
            CanonicalTool::AskUserQuestion
        );
        assert_eq!(ClaudeCodeAdapter::normalize("Skill"), CanonicalTool::Skill);
    }

    #[test]
    fn normalizes_mode_tools() {
        assert_eq!(
            ClaudeCodeAdapter::normalize("EnterPlanMode"),
            CanonicalTool::EnterPlanMode
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("enter_plan_mode"),
            CanonicalTool::EnterPlanMode
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("ExitPlanMode"),
            CanonicalTool::ExitPlanMode
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("exit_plan_mode"),
            CanonicalTool::ExitPlanMode
        );
    }

    #[test]
    fn normalizes_file_operations() {
        assert_eq!(ClaudeCodeAdapter::normalize("Move"), CanonicalTool::Move);
        assert_eq!(ClaudeCodeAdapter::normalize("mv"), CanonicalTool::Move);
        assert_eq!(ClaudeCodeAdapter::normalize("rename"), CanonicalTool::Move);
        assert_eq!(
            ClaudeCodeAdapter::normalize("Delete"),
            CanonicalTool::Delete
        );
        assert_eq!(ClaudeCodeAdapter::normalize("rm"), CanonicalTool::Delete);
        assert_eq!(
            ClaudeCodeAdapter::normalize("remove"),
            CanonicalTool::Delete
        );
    }

    #[test]
    fn normalizes_notebook_tools() {
        assert_eq!(
            ClaudeCodeAdapter::normalize("NotebookRead"),
            CanonicalTool::NotebookRead
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("NotebookEdit"),
            CanonicalTool::NotebookEdit
        );
    }

    #[test]
    fn strips_mcp_prefix() {
        assert_eq!(
            ClaudeCodeAdapter::normalize("mcp__acp__Read"),
            CanonicalTool::Read
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("mcp__acp__Bash"),
            CanonicalTool::Bash
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("mcp__plugin_playwright__browser_click"),
            CanonicalTool::Unknown("mcp__plugin_playwright__browser_click".to_string())
        );
    }

    #[test]
    fn returns_unknown_for_unrecognized_tools() {
        assert_eq!(
            ClaudeCodeAdapter::normalize("CustomTool"),
            CanonicalTool::Unknown("CustomTool".to_string())
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("my_special_tool"),
            CanonicalTool::Unknown("my_special_tool".to_string())
        );
    }

    #[test]
    fn maps_to_correct_tool_kind() {
        let tool = ClaudeCodeAdapter::normalize("Read");
        assert_eq!(ToolKind::from(tool), ToolKind::Read);

        let tool = ClaudeCodeAdapter::normalize("Edit");
        assert_eq!(ToolKind::from(tool), ToolKind::Edit);

        let tool = ClaudeCodeAdapter::normalize("Bash");
        assert_eq!(ToolKind::from(tool), ToolKind::Execute);

        let tool = ClaudeCodeAdapter::normalize("Glob");
        assert_eq!(ToolKind::from(tool), ToolKind::Glob);

        let tool = ClaudeCodeAdapter::normalize("WebFetch");
        assert_eq!(ToolKind::from(tool), ToolKind::Fetch);

        let tool = ClaudeCodeAdapter::normalize("Task");
        assert_eq!(ToolKind::from(tool), ToolKind::Task);

        let tool = ClaudeCodeAdapter::normalize("EnterPlanMode");
        assert_eq!(ToolKind::from(tool), ToolKind::EnterPlanMode);

        let tool = ClaudeCodeAdapter::normalize("Move");
        assert_eq!(ToolKind::from(tool), ToolKind::Move);

        let tool = ClaudeCodeAdapter::normalize("Delete");
        assert_eq!(ToolKind::from(tool), ToolKind::Delete);

        let tool = ClaudeCodeAdapter::normalize("Unknown");
        assert_eq!(ToolKind::from(tool), ToolKind::Other);
    }
}
