//! OpenCode adapter for tool name normalization.
//!
//! OpenCode uses tool names like "readFile", "writeFile", "bash", "glob", etc.
//! Tool names follow camelCase convention.

use super::any_eq;
use crate::acp::session_update::ToolKind;

/// Adapter for normalizing OpenCode tool names.
pub struct OpenCodeAdapter;

impl OpenCodeAdapter {
    /// Normalize OpenCode tool names to canonical form.
    ///
    /// OpenCode uses camelCase tool names like:
    /// - "readFile", "writeFile", "bash", "glob"
    /// - May also use alternative names like "cat", "curl"
    pub fn normalize(name: &str) -> ToolKind {
        if any_eq(
            name,
            &[
                "read",
                "readfile",
                "read_file",
                "cat",
                "view",
                "viewfile",
                "view_file",
            ],
        ) {
            return ToolKind::Read;
        }
        if any_eq(
            name,
            &["read_lints", "readlints", "read-lints", "read lints"],
        ) {
            return ToolKind::ReadLints;
        }
        if any_eq(
            name,
            &[
                "edit",
                "editfile",
                "edit_file",
                "modify",
                "modifyfile",
                "modify_file",
            ],
        ) {
            return ToolKind::Edit;
        }
        if any_eq(
            name,
            &[
                "write",
                "writefile",
                "write_file",
                "create",
                "createfile",
                "create_file",
            ],
        ) {
            return ToolKind::Edit;
        }
        if any_eq(
            name,
            &[
                "replace",
                "str_replace",
                "str_replace_editor",
                "apply_patch",
                "apply patch",
                "patch",
                "patchfile",
                "patch_file",
            ],
        ) {
            return ToolKind::Edit;
        }
        if any_eq(
            name,
            &[
                "bash",
                "shell",
                "exec",
                "execute",
                "run",
                "command",
                "runcommand",
                "run_command",
            ],
        ) {
            return ToolKind::Execute;
        }
        if any_eq(name, &["kill", "killshell", "kill_shell", "terminate"]) {
            return ToolKind::Execute;
        }
        if any_eq(
            name,
            &[
                "glob",
                "ls",
                "list",
                "listfiles",
                "list_files",
                "listdir",
                "list_dir",
            ],
        ) {
            return ToolKind::Glob;
        }
        if any_eq(
            name,
            &[
                "grep",
                "search",
                "searchfiles",
                "search_files",
                "ripgrep",
                "rg",
            ],
        ) {
            return ToolKind::Search;
        }
        if any_eq(
            name,
            &[
                "find",
                "findfile",
                "find_file",
                "findfiles",
                "find_files",
                "locate",
            ],
        ) {
            return ToolKind::Glob;
        }
        if any_eq(
            name,
            &[
                "fetch",
                "http",
                "curl",
                "request",
                "httpget",
                "http_get",
                "httpfetch",
                "http_fetch",
                "webfetch",
                "web_fetch",
            ],
        ) {
            return ToolKind::Fetch;
        }
        if any_eq(
            name,
            &[
                "websearch",
                "web_search",
                "search_web",
                "googlesearch",
                "google_search",
            ],
        ) {
            return ToolKind::WebSearch;
        }
        if any_eq(
            name,
            &[
                "think",
                "reason",
                "task",
                "spawn",
                "agent",
                "subagent",
                "delegate",
                "spawntask",
                "spawn_task",
            ],
        ) {
            return ToolKind::Task;
        }
        if any_eq(name, &["taskoutput", "task_output", "get_task_output"]) {
            return ToolKind::TaskOutput;
        }
        if any_eq(
            name,
            &[
                "todo",
                "todowrite",
                "todo_write",
                "todos",
                "tasklist",
                "task_list",
            ],
        ) {
            return ToolKind::Todo;
        }
        if any_eq(
            name,
            &[
                "ask",
                "askuser",
                "ask_user",
                "question",
                "prompt",
                "askuserquestion",
                "ask_user_question",
            ],
        ) {
            return ToolKind::Question;
        }
        if any_eq(name, &["skill", "capability", "useskill", "use_skill"]) {
            return ToolKind::Skill;
        }
        if any_eq(
            name,
            &[
                "planmode",
                "plan_mode",
                "plan",
                "enterplan",
                "enter_plan",
                "enterplanmode",
                "enter_plan_mode",
            ],
        ) {
            return ToolKind::EnterPlanMode;
        }
        if any_eq(
            name,
            &[
                "exitplan",
                "exit_plan",
                "execute_plan",
                "executeplan",
                "exitplanmode",
                "exit_plan_mode",
            ],
        ) {
            return ToolKind::ExitPlanMode;
        }
        if any_eq(name, &["createplan", "create_plan"]) {
            return ToolKind::CreatePlan;
        }
        if any_eq(name, &["toolsearch", "tool_search"]) {
            return ToolKind::ToolSearch;
        }
        if any_eq(
            name,
            &[
                "move",
                "mv",
                "rename",
                "movefile",
                "move_file",
                "renamefile",
                "rename_file",
            ],
        ) {
            return ToolKind::Move;
        }
        if any_eq(
            name,
            &[
                "delete",
                "rm",
                "remove",
                "unlink",
                "deletefile",
                "delete_file",
                "removefile",
                "remove_file",
            ],
        ) {
            return ToolKind::Delete;
        }
        if any_eq(
            name,
            &[
                "notebookread",
                "notebook_read",
                "readnotebook",
                "read_notebook",
            ],
        ) {
            return ToolKind::Read;
        }
        if any_eq(
            name,
            &[
                "notebookedit",
                "notebook_edit",
                "editnotebook",
                "edit_notebook",
            ],
        ) {
            return ToolKind::Edit;
        }

        ToolKind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn normalizes_read_variants() {
        assert_eq!(OpenCodeAdapter::normalize("read"), ToolKind::Read);
        assert_eq!(OpenCodeAdapter::normalize("readFile"), ToolKind::Read);
        assert_eq!(OpenCodeAdapter::normalize("read_file"), ToolKind::Read);
        assert_eq!(OpenCodeAdapter::normalize("cat"), ToolKind::Read);
        assert_eq!(OpenCodeAdapter::normalize("view"), ToolKind::Read);
        assert_eq!(
            OpenCodeAdapter::normalize("read_lints"),
            ToolKind::ReadLints
        );
    }

    #[test]
    fn normalizes_edit_variants() {
        assert_eq!(OpenCodeAdapter::normalize("edit"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("editFile"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("modify"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("replace"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("apply_patch"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("Apply Patch"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("patch"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("str_replace"), ToolKind::Edit);
        assert_eq!(
            OpenCodeAdapter::normalize("str_replace_editor"),
            ToolKind::Edit
        );
    }

    #[test]
    fn normalizes_write_variants() {
        assert_eq!(OpenCodeAdapter::normalize("write"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("writeFile"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("create"), ToolKind::Edit);
    }

    #[test]
    fn normalizes_bash_variants() {
        assert_eq!(OpenCodeAdapter::normalize("bash"), ToolKind::Execute);
        assert_eq!(OpenCodeAdapter::normalize("shell"), ToolKind::Execute);
        assert_eq!(OpenCodeAdapter::normalize("exec"), ToolKind::Execute);
        assert_eq!(OpenCodeAdapter::normalize("execute"), ToolKind::Execute);
        assert_eq!(OpenCodeAdapter::normalize("run"), ToolKind::Execute);
        assert_eq!(OpenCodeAdapter::normalize("command"), ToolKind::Execute);
    }

    #[test]
    fn normalizes_kill_shell() {
        assert_eq!(OpenCodeAdapter::normalize("kill"), ToolKind::Execute);
        assert_eq!(OpenCodeAdapter::normalize("killShell"), ToolKind::Execute);
        assert_eq!(OpenCodeAdapter::normalize("terminate"), ToolKind::Execute);
    }

    #[test]
    fn normalizes_search_tools() {
        assert_eq!(OpenCodeAdapter::normalize("glob"), ToolKind::Glob);
        assert_eq!(OpenCodeAdapter::normalize("ls"), ToolKind::Glob);
        assert_eq!(OpenCodeAdapter::normalize("list"), ToolKind::Glob);
        assert_eq!(OpenCodeAdapter::normalize("listFiles"), ToolKind::Glob);
        assert_eq!(OpenCodeAdapter::normalize("grep"), ToolKind::Search);
        assert_eq!(OpenCodeAdapter::normalize("search"), ToolKind::Search);
        assert_eq!(OpenCodeAdapter::normalize("ripgrep"), ToolKind::Search);
        assert_eq!(OpenCodeAdapter::normalize("find"), ToolKind::Glob);
        assert_eq!(OpenCodeAdapter::normalize("locate"), ToolKind::Glob);
    }

    #[test]
    fn normalizes_web_tools() {
        assert_eq!(OpenCodeAdapter::normalize("fetch"), ToolKind::Fetch);
        assert_eq!(OpenCodeAdapter::normalize("http"), ToolKind::Fetch);
        assert_eq!(OpenCodeAdapter::normalize("curl"), ToolKind::Fetch);
        assert_eq!(OpenCodeAdapter::normalize("request"), ToolKind::Fetch);
        assert_eq!(OpenCodeAdapter::normalize("webSearch"), ToolKind::WebSearch);
        assert_eq!(
            OpenCodeAdapter::normalize("search_web"),
            ToolKind::WebSearch
        );
    }

    #[test]
    fn normalizes_think_tools() {
        assert_eq!(OpenCodeAdapter::normalize("task"), ToolKind::Task);
        assert_eq!(OpenCodeAdapter::normalize("spawn"), ToolKind::Task);
        assert_eq!(OpenCodeAdapter::normalize("delegate"), ToolKind::Task);
        assert_eq!(OpenCodeAdapter::normalize("todo"), ToolKind::Todo);
        assert_eq!(OpenCodeAdapter::normalize("todoWrite"), ToolKind::Todo);
        assert_eq!(OpenCodeAdapter::normalize("ask"), ToolKind::Question);
        assert_eq!(OpenCodeAdapter::normalize("askUser"), ToolKind::Question);
        assert_eq!(OpenCodeAdapter::normalize("question"), ToolKind::Question);
        assert_eq!(OpenCodeAdapter::normalize("skill"), ToolKind::Skill);
    }

    #[test]
    fn normalizes_mode_tools() {
        assert_eq!(
            OpenCodeAdapter::normalize("planMode"),
            ToolKind::EnterPlanMode
        );
        assert_eq!(OpenCodeAdapter::normalize("plan"), ToolKind::EnterPlanMode);
        assert_eq!(
            OpenCodeAdapter::normalize("enterPlan"),
            ToolKind::EnterPlanMode
        );
        assert_eq!(
            OpenCodeAdapter::normalize("exitPlan"),
            ToolKind::ExitPlanMode
        );
        assert_eq!(
            OpenCodeAdapter::normalize("execute_plan"),
            ToolKind::ExitPlanMode
        );
    }

    #[test]
    fn normalizes_file_operations() {
        assert_eq!(OpenCodeAdapter::normalize("move"), ToolKind::Move);
        assert_eq!(OpenCodeAdapter::normalize("mv"), ToolKind::Move);
        assert_eq!(OpenCodeAdapter::normalize("rename"), ToolKind::Move);
        assert_eq!(OpenCodeAdapter::normalize("delete"), ToolKind::Delete);
        assert_eq!(OpenCodeAdapter::normalize("rm"), ToolKind::Delete);
        assert_eq!(OpenCodeAdapter::normalize("remove"), ToolKind::Delete);
        assert_eq!(OpenCodeAdapter::normalize("unlink"), ToolKind::Delete);
    }

    #[test]
    fn returns_unknown_for_unrecognized_tools() {
        assert_eq!(OpenCodeAdapter::normalize("customTool"), ToolKind::Other);
        assert_eq!(OpenCodeAdapter::normalize("mySpecialTool"), ToolKind::Other);
    }

    #[test]
    fn maps_to_correct_tool_kind() {
        assert_eq!(OpenCodeAdapter::normalize("readFile"), ToolKind::Read);
        assert_eq!(OpenCodeAdapter::normalize("editFile"), ToolKind::Edit);
        assert_eq!(OpenCodeAdapter::normalize("bash"), ToolKind::Execute);
        assert_eq!(OpenCodeAdapter::normalize("glob"), ToolKind::Glob);
        assert_eq!(OpenCodeAdapter::normalize("fetch"), ToolKind::Fetch);
        assert_eq!(OpenCodeAdapter::normalize("task"), ToolKind::Task);
        assert_eq!(
            OpenCodeAdapter::normalize("planMode"),
            ToolKind::EnterPlanMode
        );
        assert_eq!(OpenCodeAdapter::normalize("move"), ToolKind::Move);
        assert_eq!(OpenCodeAdapter::normalize("delete"), ToolKind::Delete);
    }
}
