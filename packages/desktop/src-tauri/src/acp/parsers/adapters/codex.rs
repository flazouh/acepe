//! Codex adapter for tool name normalization.
//!
//! Codex format is not fully specified yet.
//! This adapter handles Codex-specific tool names and delegates
//! to ClaudeCodeAdapter for standard tools.
//!
//! ## Codex Tool Name Patterns
//!
//! Codex uses snake_case tool names with optional `codex.` or `codex_` prefix:
//!
//! ### Execution Tools
//! - `shell_command` → Bash → Execute kind
//! - `exec_command` → Bash → Execute kind
//! - `run_command` → Bash → Execute kind
//! - `execute_command` → Bash → Execute kind
//!
//! ### File Operations
//! - `code_read` → Read → Read kind
//! - `code_edit` → Edit → Edit kind
//! - `write_stdin` → Write → Edit kind (for stdin input operations)
//!
//! ### Search Operations
//! - `code_search` → Grep → Search kind
//! - `search` → Grep → Search kind
//!
//! ### Namespace Prefixes
//! Tool names may be prefixed:
//! - `codex.execute_command` → stripped to `execute_command`
//! - `codex_exec_command` → stripped to `exec_command`
//!
//! Unknown tools delegate to `ClaudeCodeAdapter` for standard ACP tools.

use super::any_eq;
use super::claude_code::ClaudeCodeAdapter;
use crate::acp::parsers::canonical_tool::CanonicalTool;

/// Adapter for normalizing Codex tool names.
pub struct CodexAdapter;

impl CodexAdapter {
    /// Normalize Codex tool names to canonical form.
    ///
    /// Codex format is not fully specified yet.
    /// This handles known Codex-specific tool names and delegates
    /// to ClaudeCodeAdapter for standard tools.
    pub fn normalize(name: &str) -> CanonicalTool {
        let trimmed = name.trim();
        // Strip Codex namespace prefix (e.g., "codex.execute") before matching.
        let without_prefix = trimmed
            .strip_prefix("codex.")
            .or_else(|| trimmed.strip_prefix("codex_"))
            .unwrap_or(trimmed);

        if any_eq(
            without_prefix,
            &["code_edit", "codeedit", "edit_code", "editcode"],
        ) {
            return CanonicalTool::Edit;
        }
        if any_eq(
            without_prefix,
            &["code_read", "coderead", "read_code", "readcode"],
        ) {
            return CanonicalTool::Read;
        }
        if any_eq(
            without_prefix,
            &["write_stdin", "writestdin", "functions.write_stdin"],
        ) {
            return CanonicalTool::Bash;
        }
        if any_eq(
            without_prefix,
            &[
                "shell_command",
                "shellcommand",
                "run_command",
                "runcommand",
                "execute_command",
                "executecommand",
                "exec_command",
                "execcommand",
                "functions.exec_command",
                "functions.list_mcp_resources",
                "functions.list_mcp_resource_templates",
                "functions.mcp__context7__resolve-library-id",
                "functions.mcp__context7__query-docs",
            ],
        ) {
            return CanonicalTool::Bash;
        }
        if any_eq(without_prefix, &["functions.apply_patch", "apply_patch"]) {
            return CanonicalTool::Edit;
        }
        if any_eq(
            without_prefix,
            &["functions.read_mcp_resource", "functions.view_image"],
        ) {
            return CanonicalTool::Read;
        }
        if without_prefix.eq_ignore_ascii_case("functions.request_user_input") {
            return CanonicalTool::AskUserQuestion;
        }
        if without_prefix.eq_ignore_ascii_case("functions.update_plan") {
            return CanonicalTool::Task;
        }
        if without_prefix.eq_ignore_ascii_case("functions.enter_plan_mode") {
            return CanonicalTool::EnterPlanMode;
        }
        if without_prefix.eq_ignore_ascii_case("functions.exit_plan_mode") {
            return CanonicalTool::ExitPlanMode;
        }
        if any_eq(
            without_prefix,
            &["functions.create_plan", "createplan", "create_plan"],
        ) {
            return CanonicalTool::CreatePlan;
        }
        if any_eq(
            without_prefix,
            &["code_search", "codesearch", "search_code", "searchcode"],
        ) {
            return CanonicalTool::Grep;
        }
        if any_eq(without_prefix, &["search", "web.find"]) {
            return CanonicalTool::Grep;
        }
        if any_eq(
            without_prefix,
            &[
                "web.search_query",
                "web.image_query",
                "web.finance",
                "web.weather",
                "web.sports",
                "web.time",
            ],
        ) {
            return CanonicalTool::WebSearch;
        }
        if any_eq(without_prefix, &["web.open", "web.click", "web.screenshot"]) {
            return CanonicalTool::WebFetch;
        }

        ClaudeCodeAdapter::normalize(without_prefix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn normalizes_codex_specific_tools() {
        assert_eq!(CodexAdapter::normalize("code_edit"), CanonicalTool::Edit);
        assert_eq!(CodexAdapter::normalize("code_read"), CanonicalTool::Read);
        assert_eq!(CodexAdapter::normalize("run_command"), CanonicalTool::Bash);
        assert_eq!(CodexAdapter::normalize("exec_command"), CanonicalTool::Bash);
        assert_eq!(CodexAdapter::normalize("code_search"), CanonicalTool::Grep);
    }

    #[test]
    fn normalizes_codex_prefixed_tools() {
        assert_eq!(
            CodexAdapter::normalize("codex.execute"),
            CanonicalTool::Bash
        );
        assert_eq!(CodexAdapter::normalize("codex.read"), CanonicalTool::Read);
        assert_eq!(CodexAdapter::normalize("codex.edit"), CanonicalTool::Edit);
        assert_eq!(CodexAdapter::normalize("codex.search"), CanonicalTool::Grep);
        assert_eq!(CodexAdapter::normalize("codex_search"), CanonicalTool::Grep);
    }

    #[test]
    fn delegates_standard_tools_to_claude_code() {
        assert_eq!(CodexAdapter::normalize("Read"), CanonicalTool::Read);
        assert_eq!(CodexAdapter::normalize("Edit"), CanonicalTool::Edit);
        assert_eq!(CodexAdapter::normalize("Bash"), CanonicalTool::Bash);
        assert_eq!(CodexAdapter::normalize("Glob"), CanonicalTool::Glob);
        assert_eq!(CodexAdapter::normalize("WebFetch"), CanonicalTool::WebFetch);
    }

    #[test]
    fn handles_mcp_prefixed_tools_via_delegation() {
        assert_eq!(
            CodexAdapter::normalize("mcp__acp__Read"),
            CanonicalTool::Read
        );
        assert_eq!(
            CodexAdapter::normalize("mcp__acp__Bash"),
            CanonicalTool::Bash
        );
    }

    #[test]
    fn maps_to_correct_tool_kind() {
        let tool = CodexAdapter::normalize("code_edit");
        assert_eq!(ToolKind::from(tool), ToolKind::Edit);

        let tool = CodexAdapter::normalize("code_read");
        assert_eq!(ToolKind::from(tool), ToolKind::Read);

        let tool = CodexAdapter::normalize("run_command");
        assert_eq!(ToolKind::from(tool), ToolKind::Execute);

        let tool = CodexAdapter::normalize("code_search");
        assert_eq!(ToolKind::from(tool), ToolKind::Search);
    }

    #[test]
    fn returns_unknown_for_unrecognized_tools() {
        assert_eq!(
            CodexAdapter::normalize("custom_codex_tool"),
            CanonicalTool::Unknown("custom_codex_tool".to_string())
        );
    }

    #[test]
    fn normalizes_shell_command() {
        // Phase 1: Critical fix - shell_command was not mapped
        assert_eq!(
            CodexAdapter::normalize("shell_command"),
            CanonicalTool::Bash
        );
        assert_eq!(
            ToolKind::from(CodexAdapter::normalize("shell_command")),
            ToolKind::Execute
        );
    }

    #[test]
    fn normalizes_write_stdin() {
        // write_stdin writes to a running terminal session
        assert_eq!(CodexAdapter::normalize("write_stdin"), CanonicalTool::Bash);
        assert_eq!(
            ToolKind::from(CodexAdapter::normalize("write_stdin")),
            ToolKind::Execute
        );
    }

    #[test]
    fn normalizes_apply_patch_variants() {
        assert_eq!(
            CodexAdapter::normalize("functions.apply_patch"),
            CanonicalTool::Edit
        );
        assert_eq!(CodexAdapter::normalize("apply_patch"), CanonicalTool::Edit);
        assert_eq!(
            ToolKind::from(CodexAdapter::normalize("apply_patch")),
            ToolKind::Edit
        );
    }

    #[test]
    fn exec_command_maps_correctly() {
        // Verify exec_command maps to Bash, not Unknown
        let tool = CodexAdapter::normalize("exec_command");
        assert_eq!(tool, CanonicalTool::Bash);
        assert_ne!(
            tool,
            CanonicalTool::Unknown("exec_command".to_string()),
            "exec_command should not map to Unknown"
        );
    }

    #[test]
    fn all_phase_1_critical_tools_map_correctly() {
        // Test matrix for all critical tools from Phase 1
        let test_cases = vec![
            ("shell_command", CanonicalTool::Bash, ToolKind::Execute),
            ("exec_command", CanonicalTool::Bash, ToolKind::Execute),
            ("write_stdin", CanonicalTool::Bash, ToolKind::Execute),
            ("shellcommand", CanonicalTool::Bash, ToolKind::Execute),
            ("writestdin", CanonicalTool::Bash, ToolKind::Execute),
            ("execcommand", CanonicalTool::Bash, ToolKind::Execute),
        ];

        for (name, expected_tool, expected_kind) in test_cases {
            let tool = CodexAdapter::normalize(name);
            assert_eq!(
                tool, expected_tool,
                "Tool normalization failed for: {}",
                name
            );
            assert_eq!(
                ToolKind::from(tool.clone()),
                expected_kind,
                "ToolKind mapping failed for: {}",
                name
            );
        }
    }

    #[test]
    fn normalizes_functions_tools() {
        let test_cases = vec![
            (
                "functions.exec_command",
                CanonicalTool::Bash,
                ToolKind::Execute,
            ),
            (
                "functions.write_stdin",
                CanonicalTool::Bash,
                ToolKind::Execute,
            ),
            (
                "functions.list_mcp_resources",
                CanonicalTool::Bash,
                ToolKind::Execute,
            ),
            (
                "functions.list_mcp_resource_templates",
                CanonicalTool::Bash,
                ToolKind::Execute,
            ),
            (
                "functions.read_mcp_resource",
                CanonicalTool::Read,
                ToolKind::Read,
            ),
            ("functions.update_plan", CanonicalTool::Task, ToolKind::Task),
            (
                "functions.request_user_input",
                CanonicalTool::AskUserQuestion,
                ToolKind::Question,
            ),
            (
                "functions.enter_plan_mode",
                CanonicalTool::EnterPlanMode,
                ToolKind::EnterPlanMode,
            ),
            (
                "functions.exit_plan_mode",
                CanonicalTool::ExitPlanMode,
                ToolKind::ExitPlanMode,
            ),
            ("functions.view_image", CanonicalTool::Read, ToolKind::Read),
            ("functions.apply_patch", CanonicalTool::Edit, ToolKind::Edit),
        ];

        for (name, expected_tool, expected_kind) in test_cases {
            let tool = CodexAdapter::normalize(name);
            assert_eq!(
                tool, expected_tool,
                "Tool normalization failed for: {}",
                name
            );
            assert_eq!(
                ToolKind::from(tool),
                expected_kind,
                "ToolKind mapping failed for: {}",
                name
            );
        }
    }

    #[test]
    fn normalizes_web_tools() {
        let test_cases = vec![
            (
                "web.search_query",
                CanonicalTool::WebSearch,
                ToolKind::WebSearch,
            ),
            (
                "web.image_query",
                CanonicalTool::WebSearch,
                ToolKind::WebSearch,
            ),
            ("web.open", CanonicalTool::WebFetch, ToolKind::Fetch),
            ("web.click", CanonicalTool::WebFetch, ToolKind::Fetch),
            ("web.find", CanonicalTool::Grep, ToolKind::Search),
            ("web.screenshot", CanonicalTool::WebFetch, ToolKind::Fetch),
            ("web.finance", CanonicalTool::WebSearch, ToolKind::WebSearch),
            ("web.weather", CanonicalTool::WebSearch, ToolKind::WebSearch),
            ("web.sports", CanonicalTool::WebSearch, ToolKind::WebSearch),
            ("web.time", CanonicalTool::WebSearch, ToolKind::WebSearch),
        ];

        for (name, expected_tool, expected_kind) in test_cases {
            let tool = CodexAdapter::normalize(name);
            assert_eq!(
                tool, expected_tool,
                "Tool normalization failed for: {}",
                name
            );
            assert_eq!(
                ToolKind::from(tool),
                expected_kind,
                "ToolKind mapping failed for: {}",
                name
            );
        }
    }
}
