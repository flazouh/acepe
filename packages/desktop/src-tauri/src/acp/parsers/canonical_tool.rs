//! Canonical tool types and mapping to ToolKind.
//!
//! This module provides a unified representation of tools across all agents.
//! Each agent normalizes their tool names to the `CanonicalTool` enum,
//! which is then mapped to `ToolKind` for UI routing.

use crate::acp::session_update::ToolKind;

/// Canonical tool types across all agents.
///
/// Each agent normalizes their tool names to this enum.
/// This provides a single source of truth for tool classification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonicalTool {
    // File Operations
    Read,
    Write,
    Edit,
    Move,
    Delete,

    // Execution
    Bash,
    KillShell,

    // Search
    Glob,
    Grep,
    Find,

    // Web
    WebFetch,
    WebSearch,

    // Agent/Thinking
    Task,
    TodoWrite,
    AskUserQuestion,
    Skill,

    // Mode
    EnterPlanMode,
    ExitPlanMode,
    CreatePlan,

    // Notebook
    NotebookRead,
    NotebookEdit,

    // Unknown tool - preserves original name
    Unknown(String),
}

impl From<CanonicalTool> for ToolKind {
    fn from(tool: CanonicalTool) -> Self {
        match tool {
            // Read operations
            CanonicalTool::Read | CanonicalTool::NotebookRead => ToolKind::Read,

            // Edit operations (includes write)
            CanonicalTool::Write | CanonicalTool::Edit | CanonicalTool::NotebookEdit => {
                ToolKind::Edit
            }

            // Execute operations
            CanonicalTool::Bash | CanonicalTool::KillShell => ToolKind::Execute,

            // Search operations
            CanonicalTool::Grep => ToolKind::Search,
            CanonicalTool::Glob | CanonicalTool::Find => ToolKind::Glob,

            // Web operations
            CanonicalTool::WebFetch => ToolKind::Fetch,
            CanonicalTool::WebSearch => ToolKind::WebSearch,

            // Agent operations - each has its own kind for direct UI routing
            CanonicalTool::Task => ToolKind::Task,
            CanonicalTool::TodoWrite => ToolKind::Todo,
            CanonicalTool::AskUserQuestion => ToolKind::Question,
            CanonicalTool::Skill => ToolKind::Skill,

            // Mode switching
            CanonicalTool::EnterPlanMode => ToolKind::EnterPlanMode,
            CanonicalTool::ExitPlanMode => ToolKind::ExitPlanMode,
            CanonicalTool::CreatePlan => ToolKind::CreatePlan,

            // File operations
            CanonicalTool::Move => ToolKind::Move,
            CanonicalTool::Delete => ToolKind::Delete,

            // Unknown
            CanonicalTool::Unknown(_) => ToolKind::Other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_read_to_read_kind() {
        assert_eq!(ToolKind::from(CanonicalTool::Read), ToolKind::Read);
        assert_eq!(ToolKind::from(CanonicalTool::NotebookRead), ToolKind::Read);
    }

    #[test]
    fn maps_edit_and_write_to_edit_kind() {
        assert_eq!(ToolKind::from(CanonicalTool::Edit), ToolKind::Edit);
        assert_eq!(ToolKind::from(CanonicalTool::Write), ToolKind::Edit);
        assert_eq!(ToolKind::from(CanonicalTool::NotebookEdit), ToolKind::Edit);
    }

    #[test]
    fn maps_bash_to_execute_kind() {
        assert_eq!(ToolKind::from(CanonicalTool::Bash), ToolKind::Execute);
        assert_eq!(ToolKind::from(CanonicalTool::KillShell), ToolKind::Execute);
    }

    #[test]
    fn maps_grep_to_search_kind() {
        assert_eq!(ToolKind::from(CanonicalTool::Grep), ToolKind::Search);
    }

    #[test]
    fn maps_glob_and_find_to_glob_kind() {
        assert_eq!(ToolKind::from(CanonicalTool::Glob), ToolKind::Glob);
        assert_eq!(ToolKind::from(CanonicalTool::Find), ToolKind::Glob);
    }

    #[test]
    fn maps_web_fetch_to_fetch_kind() {
        assert_eq!(ToolKind::from(CanonicalTool::WebFetch), ToolKind::Fetch);
    }

    #[test]
    fn maps_web_search_to_web_search_kind() {
        assert_eq!(
            ToolKind::from(CanonicalTool::WebSearch),
            ToolKind::WebSearch
        );
    }

    #[test]
    fn maps_agent_tools_to_specific_kinds() {
        assert_eq!(ToolKind::from(CanonicalTool::Task), ToolKind::Task);
        assert_eq!(ToolKind::from(CanonicalTool::TodoWrite), ToolKind::Todo);
        assert_eq!(
            ToolKind::from(CanonicalTool::AskUserQuestion),
            ToolKind::Question
        );
        assert_eq!(ToolKind::from(CanonicalTool::Skill), ToolKind::Skill);
    }

    #[test]
    fn maps_mode_tools_to_separate_kinds() {
        assert_eq!(
            ToolKind::from(CanonicalTool::EnterPlanMode),
            ToolKind::EnterPlanMode
        );
        assert_eq!(
            ToolKind::from(CanonicalTool::ExitPlanMode),
            ToolKind::ExitPlanMode
        );
        assert_eq!(
            ToolKind::from(CanonicalTool::CreatePlan),
            ToolKind::CreatePlan
        );
    }

    #[test]
    fn maps_file_operation_tools() {
        assert_eq!(ToolKind::from(CanonicalTool::Move), ToolKind::Move);
        assert_eq!(ToolKind::from(CanonicalTool::Delete), ToolKind::Delete);
    }

    #[test]
    fn maps_unknown_to_other_kind() {
        assert_eq!(
            ToolKind::from(CanonicalTool::Unknown("custom".to_string())),
            ToolKind::Other
        );
    }
}
