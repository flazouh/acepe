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
use crate::acp::session_update::ToolKind;

/// Adapter for normalizing Codex tool names.
pub struct CodexAdapter;

impl CodexAdapter {
    /// Normalize Codex tool names to canonical form.
    ///
    /// Codex format is not fully specified yet.
    /// This handles known Codex-specific tool names and delegates
    /// to ClaudeCodeAdapter for standard tools.
    pub fn normalize(name: &str) -> ToolKind {
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
            return ToolKind::Edit;
        }
        if any_eq(
            without_prefix,
            &["code_read", "coderead", "read_code", "readcode"],
        ) {
            return ToolKind::Read;
        }
        if any_eq(
            without_prefix,
            &["write_stdin", "writestdin", "functions.write_stdin"],
        ) {
            return ToolKind::Execute;
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
            return ToolKind::Execute;
        }
        if any_eq(without_prefix, &["functions.apply_patch", "apply_patch"]) {
            return ToolKind::Edit;
        }
        if any_eq(
            without_prefix,
            &["functions.read_mcp_resource", "functions.view_image"],
        ) {
            return ToolKind::Read;
        }
        if without_prefix.eq_ignore_ascii_case("functions.request_user_input") {
            return ToolKind::Question;
        }
        if without_prefix.eq_ignore_ascii_case("functions.update_plan") {
            return ToolKind::Task;
        }
        if without_prefix.eq_ignore_ascii_case("functions.enter_plan_mode") {
            return ToolKind::EnterPlanMode;
        }
        if without_prefix.eq_ignore_ascii_case("functions.exit_plan_mode") {
            return ToolKind::ExitPlanMode;
        }
        if any_eq(
            without_prefix,
            &["functions.create_plan", "createplan", "create_plan"],
        ) {
            return ToolKind::CreatePlan;
        }
        if any_eq(
            without_prefix,
            &["code_search", "codesearch", "search_code", "searchcode"],
        ) {
            return ToolKind::Search;
        }
        if any_eq(without_prefix, &["search", "web.find"]) {
            return ToolKind::Search;
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
            return ToolKind::WebSearch;
        }
        if any_eq(without_prefix, &["web.open", "web.click", "web.screenshot"]) {
            return ToolKind::Fetch;
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
        assert_eq!(CodexAdapter::normalize("code_edit"), ToolKind::Edit);
        assert_eq!(CodexAdapter::normalize("code_read"), ToolKind::Read);
        assert_eq!(CodexAdapter::normalize("run_command"), ToolKind::Execute);
        assert_eq!(CodexAdapter::normalize("exec_command"), ToolKind::Execute);
        assert_eq!(CodexAdapter::normalize("code_search"), ToolKind::Search);
    }

    #[test]
    fn normalizes_codex_prefixed_tools() {
        assert_eq!(CodexAdapter::normalize("codex.execute"), ToolKind::Execute);
        assert_eq!(CodexAdapter::normalize("codex.read"), ToolKind::Read);
        assert_eq!(CodexAdapter::normalize("codex.edit"), ToolKind::Edit);
        assert_eq!(CodexAdapter::normalize("codex.search"), ToolKind::Search);
        assert_eq!(CodexAdapter::normalize("codex_search"), ToolKind::Search);
    }

    #[test]
    fn delegates_standard_tools_to_claude_code() {
        assert_eq!(CodexAdapter::normalize("Read"), ToolKind::Read);
        assert_eq!(CodexAdapter::normalize("Edit"), ToolKind::Edit);
        assert_eq!(CodexAdapter::normalize("Bash"), ToolKind::Execute);
        assert_eq!(CodexAdapter::normalize("Glob"), ToolKind::Glob);
        assert_eq!(CodexAdapter::normalize("WebFetch"), ToolKind::Fetch);
    }

    #[test]
    fn handles_mcp_prefixed_tools_via_delegation() {
        assert_eq!(CodexAdapter::normalize("mcp__acp__Read"), ToolKind::Read);
        assert_eq!(CodexAdapter::normalize("mcp__acp__Bash"), ToolKind::Execute);
    }

    #[test]
    fn maps_to_correct_tool_kind() {
        assert_eq!(CodexAdapter::normalize("code_edit"), ToolKind::Edit);
        assert_eq!(CodexAdapter::normalize("code_read"), ToolKind::Read);
        assert_eq!(CodexAdapter::normalize("run_command"), ToolKind::Execute);
        assert_eq!(CodexAdapter::normalize("code_search"), ToolKind::Search);
    }

    #[test]
    fn returns_unknown_for_unrecognized_tools() {
        assert_eq!(
            CodexAdapter::normalize("custom_codex_tool"),
            ToolKind::Other
        );
    }

    #[test]
    fn normalizes_shell_command() {
        // Phase 1: Critical fix - shell_command was not mapped
        assert_eq!(CodexAdapter::normalize("shell_command"), ToolKind::Execute);
        assert_eq!(CodexAdapter::normalize("shell_command"), ToolKind::Execute);
    }

    #[test]
    fn normalizes_write_stdin() {
        // write_stdin writes to a running terminal session
        assert_eq!(CodexAdapter::normalize("write_stdin"), ToolKind::Execute);
    }

    #[test]
    fn normalizes_apply_patch_variants() {
        assert_eq!(
            CodexAdapter::normalize("functions.apply_patch"),
            ToolKind::Edit
        );
        assert_eq!(CodexAdapter::normalize("apply_patch"), ToolKind::Edit);
    }

    #[test]
    fn exec_command_maps_correctly() {
        // Verify exec_command maps to Bash, not Unknown
        let tool = CodexAdapter::normalize("exec_command");
        assert_eq!(tool, ToolKind::Execute);
        assert_ne!(
            tool,
            ToolKind::Other,
            "exec_command should not map to Other"
        );
    }

    #[test]
    fn all_phase_1_critical_tools_map_correctly() {
        // Test matrix for all critical tools from Phase 1
        let test_cases = vec![
            ("shell_command", ToolKind::Execute),
            ("exec_command", ToolKind::Execute),
            ("write_stdin", ToolKind::Execute),
            ("shellcommand", ToolKind::Execute),
            ("writestdin", ToolKind::Execute),
            ("execcommand", ToolKind::Execute),
        ];

        for (name, expected_kind) in test_cases {
            assert_eq!(
                CodexAdapter::normalize(name),
                expected_kind,
                "Tool normalization failed for: {}",
                name
            );
        }
    }

    #[test]
    fn normalizes_functions_tools() {
        let test_cases = vec![
            ("functions.exec_command", ToolKind::Execute),
            ("functions.write_stdin", ToolKind::Execute),
            ("functions.list_mcp_resources", ToolKind::Execute),
            ("functions.list_mcp_resource_templates", ToolKind::Execute),
            ("functions.read_mcp_resource", ToolKind::Read),
            ("functions.update_plan", ToolKind::Task),
            ("functions.request_user_input", ToolKind::Question),
            ("functions.enter_plan_mode", ToolKind::EnterPlanMode),
            ("functions.exit_plan_mode", ToolKind::ExitPlanMode),
            ("functions.view_image", ToolKind::Read),
            ("functions.apply_patch", ToolKind::Edit),
        ];

        for (name, expected_kind) in test_cases {
            assert_eq!(
                CodexAdapter::normalize(name),
                expected_kind,
                "Tool normalization failed for: {}",
                name
            );
        }
    }

    #[test]
    fn normalizes_web_tools() {
        let test_cases = vec![
            ("web.search_query", ToolKind::WebSearch),
            ("web.image_query", ToolKind::WebSearch),
            ("web.open", ToolKind::Fetch),
            ("web.click", ToolKind::Fetch),
            ("web.find", ToolKind::Search),
            ("web.screenshot", ToolKind::Fetch),
            ("web.finance", ToolKind::WebSearch),
            ("web.weather", ToolKind::WebSearch),
            ("web.sports", ToolKind::WebSearch),
            ("web.time", ToolKind::WebSearch),
        ];

        for (name, expected_kind) in test_cases {
            assert_eq!(
                CodexAdapter::normalize(name),
                expected_kind,
                "Tool normalization failed for: {}",
                name
            );
        }
    }
}
