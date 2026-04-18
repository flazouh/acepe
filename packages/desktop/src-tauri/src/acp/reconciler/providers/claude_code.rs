//! Claude Code adapter for tool name normalization.
//!
//! Claude Code uses the shared chat-agent tool vocabulary and keeps provider
//! ownership here while delegating the common normalization table.

use crate::acp::session_update::ToolKind;

use super::shared_chat::normalize_shared_chat_tool_name;

/// Adapter for normalizing Claude Code tool names.
pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    /// Normalize Claude Code tool names to canonical form.
    ///
    /// Claude Code uses tool names like:
    /// - "Read", "Edit", "Bash", "Glob"
    /// - MCP prefixed: "mcp__acp__Read", "mcp__plugin_playwright__browser_click"
    pub fn normalize(name: &str) -> ToolKind {
        normalize_shared_chat_tool_name(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn normalizes_read_variants() {
        assert_eq!(ClaudeCodeAdapter::normalize("Read"), ToolKind::Read);
        assert_eq!(ClaudeCodeAdapter::normalize("read"), ToolKind::Read);
        assert_eq!(ClaudeCodeAdapter::normalize("ReadFile"), ToolKind::Read);
        assert_eq!(ClaudeCodeAdapter::normalize("read_file"), ToolKind::Read);
    }

    #[test]
    fn normalizes_edit_variants() {
        assert_eq!(ClaudeCodeAdapter::normalize("Edit"), ToolKind::Edit);
        assert_eq!(ClaudeCodeAdapter::normalize("edit"), ToolKind::Edit);
        assert_eq!(
            ClaudeCodeAdapter::normalize("str_replace_editor"),
            ToolKind::Edit
        );
        assert_eq!(ClaudeCodeAdapter::normalize("str_replace"), ToolKind::Edit);
        assert_eq!(ClaudeCodeAdapter::normalize("apply_patch"), ToolKind::Edit);
        assert_eq!(ClaudeCodeAdapter::normalize("Apply Patch"), ToolKind::Edit);
    }

    #[test]
    fn normalizes_write_variants() {
        assert_eq!(ClaudeCodeAdapter::normalize("Write"), ToolKind::Edit);
        assert_eq!(ClaudeCodeAdapter::normalize("write"), ToolKind::Edit);
        assert_eq!(ClaudeCodeAdapter::normalize("WriteFile"), ToolKind::Edit);
    }

    #[test]
    fn normalizes_bash_variants() {
        assert_eq!(ClaudeCodeAdapter::normalize("Bash"), ToolKind::Execute);
        assert_eq!(ClaudeCodeAdapter::normalize("bash"), ToolKind::Execute);
        assert_eq!(ClaudeCodeAdapter::normalize("execute"), ToolKind::Execute);
        assert_eq!(ClaudeCodeAdapter::normalize("run"), ToolKind::Execute);
        assert_eq!(ClaudeCodeAdapter::normalize("shell"), ToolKind::Execute);
        assert_eq!(ClaudeCodeAdapter::normalize("terminal"), ToolKind::Execute);
    }

    #[test]
    fn normalizes_kill_shell() {
        assert_eq!(ClaudeCodeAdapter::normalize("KillShell"), ToolKind::Execute);
        assert_eq!(ClaudeCodeAdapter::normalize("killbash"), ToolKind::Execute);
    }

    #[test]
    fn normalizes_search_tools() {
        assert_eq!(ClaudeCodeAdapter::normalize("Glob"), ToolKind::Glob);
        assert_eq!(ClaudeCodeAdapter::normalize("ls"), ToolKind::Glob);
        assert_eq!(ClaudeCodeAdapter::normalize("Grep"), ToolKind::Search);
        assert_eq!(ClaudeCodeAdapter::normalize("Find"), ToolKind::Glob);
    }

    #[test]
    fn normalizes_web_tools() {
        assert_eq!(ClaudeCodeAdapter::normalize("WebFetch"), ToolKind::Fetch);
        assert_eq!(ClaudeCodeAdapter::normalize("fetch"), ToolKind::Fetch);
        assert_eq!(
            ClaudeCodeAdapter::normalize("WebSearch"),
            ToolKind::WebSearch
        );
    }

    #[test]
    fn normalizes_think_tools() {
        assert_eq!(ClaudeCodeAdapter::normalize("Task"), ToolKind::Task);
        assert_eq!(ClaudeCodeAdapter::normalize("spawn"), ToolKind::Task);
        assert_eq!(ClaudeCodeAdapter::normalize("agent"), ToolKind::Task);
        assert_eq!(ClaudeCodeAdapter::normalize("subagent"), ToolKind::Task);
        assert_eq!(ClaudeCodeAdapter::normalize("TodoWrite"), ToolKind::Todo);
        assert_eq!(
            ClaudeCodeAdapter::normalize("AskUserQuestion"),
            ToolKind::Question
        );
        assert_eq!(ClaudeCodeAdapter::normalize("Skill"), ToolKind::Skill);
    }

    #[test]
    fn normalizes_mode_tools() {
        assert_eq!(
            ClaudeCodeAdapter::normalize("EnterPlanMode"),
            ToolKind::EnterPlanMode
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("enter_plan_mode"),
            ToolKind::EnterPlanMode
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("ExitPlanMode"),
            ToolKind::ExitPlanMode
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("exit_plan_mode"),
            ToolKind::ExitPlanMode
        );
    }

    #[test]
    fn normalizes_file_operations() {
        assert_eq!(ClaudeCodeAdapter::normalize("Move"), ToolKind::Move);
        assert_eq!(ClaudeCodeAdapter::normalize("mv"), ToolKind::Move);
        assert_eq!(ClaudeCodeAdapter::normalize("rename"), ToolKind::Move);
        assert_eq!(ClaudeCodeAdapter::normalize("Delete"), ToolKind::Delete);
        assert_eq!(ClaudeCodeAdapter::normalize("rm"), ToolKind::Delete);
        assert_eq!(ClaudeCodeAdapter::normalize("remove"), ToolKind::Delete);
    }

    #[test]
    fn normalizes_notebook_tools() {
        assert_eq!(ClaudeCodeAdapter::normalize("NotebookRead"), ToolKind::Read);
        assert_eq!(ClaudeCodeAdapter::normalize("NotebookEdit"), ToolKind::Edit);
    }

    #[test]
    fn strips_mcp_prefix() {
        assert_eq!(
            ClaudeCodeAdapter::normalize("mcp__acp__Read"),
            ToolKind::Read
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("mcp__acp__Bash"),
            ToolKind::Execute
        );
        assert_eq!(
            ClaudeCodeAdapter::normalize("mcp__plugin_playwright__browser_click"),
            ToolKind::Other
        );
    }

    #[test]
    fn returns_unknown_for_unrecognized_tools() {
        assert_eq!(ClaudeCodeAdapter::normalize("CustomTool"), ToolKind::Other);
        assert_eq!(
            ClaudeCodeAdapter::normalize("my_special_tool"),
            ToolKind::Other
        );
    }

    #[test]
    fn maps_to_correct_tool_kind() {
        assert_eq!(ClaudeCodeAdapter::normalize("Read"), ToolKind::Read);
        assert_eq!(ClaudeCodeAdapter::normalize("Edit"), ToolKind::Edit);
        assert_eq!(ClaudeCodeAdapter::normalize("Bash"), ToolKind::Execute);
        assert_eq!(ClaudeCodeAdapter::normalize("Glob"), ToolKind::Glob);
        assert_eq!(ClaudeCodeAdapter::normalize("WebFetch"), ToolKind::Fetch);
        assert_eq!(ClaudeCodeAdapter::normalize("Task"), ToolKind::Task);
        assert_eq!(
            ClaudeCodeAdapter::normalize("EnterPlanMode"),
            ToolKind::EnterPlanMode
        );
        assert_eq!(ClaudeCodeAdapter::normalize("Move"), ToolKind::Move);
        assert_eq!(ClaudeCodeAdapter::normalize("Delete"), ToolKind::Delete);
        assert_eq!(ClaudeCodeAdapter::normalize("Unknown"), ToolKind::Other);
    }
}
