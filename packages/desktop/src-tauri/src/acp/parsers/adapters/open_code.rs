//! OpenCode adapter for tool name normalization.
//!
//! OpenCode uses tool names like "readFile", "writeFile", "bash", "glob", etc.
//! Tool names follow camelCase convention.

use super::any_eq;
use crate::acp::parsers::canonical_tool::CanonicalTool;

/// Adapter for normalizing OpenCode tool names.
pub struct OpenCodeAdapter;

impl OpenCodeAdapter {
    /// Normalize OpenCode tool names to canonical form.
    ///
    /// OpenCode uses camelCase tool names like:
    /// - "readFile", "writeFile", "bash", "glob"
    /// - May also use alternative names like "cat", "curl"
    pub fn normalize(name: &str) -> CanonicalTool {
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
            return CanonicalTool::Read;
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
            return CanonicalTool::Edit;
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
            return CanonicalTool::Write;
        }
        if any_eq(
            name,
            &[
                "replace",
                "str_replace",
                "str_replace_editor",
                "patch",
                "patchfile",
                "patch_file",
            ],
        ) {
            return CanonicalTool::Edit;
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
            return CanonicalTool::Bash;
        }
        if any_eq(name, &["kill", "killshell", "kill_shell", "terminate"]) {
            return CanonicalTool::KillShell;
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
            return CanonicalTool::Glob;
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
            return CanonicalTool::Grep;
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
            return CanonicalTool::Find;
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
            return CanonicalTool::WebFetch;
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
            return CanonicalTool::WebSearch;
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
            return CanonicalTool::Task;
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
            return CanonicalTool::TodoWrite;
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
            return CanonicalTool::AskUserQuestion;
        }
        if any_eq(name, &["skill", "capability", "useskill", "use_skill"]) {
            return CanonicalTool::Skill;
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
            return CanonicalTool::EnterPlanMode;
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
            return CanonicalTool::ExitPlanMode;
        }
        if any_eq(name, &["createplan", "create_plan"]) {
            return CanonicalTool::CreatePlan;
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
            return CanonicalTool::Move;
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
            return CanonicalTool::Delete;
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
            return CanonicalTool::NotebookRead;
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
            return CanonicalTool::NotebookEdit;
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
        assert_eq!(OpenCodeAdapter::normalize("read"), CanonicalTool::Read);
        assert_eq!(OpenCodeAdapter::normalize("readFile"), CanonicalTool::Read);
        assert_eq!(OpenCodeAdapter::normalize("read_file"), CanonicalTool::Read);
        assert_eq!(OpenCodeAdapter::normalize("cat"), CanonicalTool::Read);
        assert_eq!(OpenCodeAdapter::normalize("view"), CanonicalTool::Read);
    }

    #[test]
    fn normalizes_edit_variants() {
        assert_eq!(OpenCodeAdapter::normalize("edit"), CanonicalTool::Edit);
        assert_eq!(OpenCodeAdapter::normalize("editFile"), CanonicalTool::Edit);
        assert_eq!(OpenCodeAdapter::normalize("modify"), CanonicalTool::Edit);
        assert_eq!(OpenCodeAdapter::normalize("replace"), CanonicalTool::Edit);
        assert_eq!(OpenCodeAdapter::normalize("patch"), CanonicalTool::Edit);
        assert_eq!(
            OpenCodeAdapter::normalize("str_replace"),
            CanonicalTool::Edit
        );
        assert_eq!(
            OpenCodeAdapter::normalize("str_replace_editor"),
            CanonicalTool::Edit
        );
    }

    #[test]
    fn normalizes_write_variants() {
        assert_eq!(OpenCodeAdapter::normalize("write"), CanonicalTool::Write);
        assert_eq!(
            OpenCodeAdapter::normalize("writeFile"),
            CanonicalTool::Write
        );
        assert_eq!(OpenCodeAdapter::normalize("create"), CanonicalTool::Write);
    }

    #[test]
    fn normalizes_bash_variants() {
        assert_eq!(OpenCodeAdapter::normalize("bash"), CanonicalTool::Bash);
        assert_eq!(OpenCodeAdapter::normalize("shell"), CanonicalTool::Bash);
        assert_eq!(OpenCodeAdapter::normalize("exec"), CanonicalTool::Bash);
        assert_eq!(OpenCodeAdapter::normalize("execute"), CanonicalTool::Bash);
        assert_eq!(OpenCodeAdapter::normalize("run"), CanonicalTool::Bash);
        assert_eq!(OpenCodeAdapter::normalize("command"), CanonicalTool::Bash);
    }

    #[test]
    fn normalizes_kill_shell() {
        assert_eq!(OpenCodeAdapter::normalize("kill"), CanonicalTool::KillShell);
        assert_eq!(
            OpenCodeAdapter::normalize("killShell"),
            CanonicalTool::KillShell
        );
        assert_eq!(
            OpenCodeAdapter::normalize("terminate"),
            CanonicalTool::KillShell
        );
    }

    #[test]
    fn normalizes_search_tools() {
        assert_eq!(OpenCodeAdapter::normalize("glob"), CanonicalTool::Glob);
        assert_eq!(OpenCodeAdapter::normalize("ls"), CanonicalTool::Glob);
        assert_eq!(OpenCodeAdapter::normalize("list"), CanonicalTool::Glob);
        assert_eq!(OpenCodeAdapter::normalize("listFiles"), CanonicalTool::Glob);
        assert_eq!(OpenCodeAdapter::normalize("grep"), CanonicalTool::Grep);
        assert_eq!(OpenCodeAdapter::normalize("search"), CanonicalTool::Grep);
        assert_eq!(OpenCodeAdapter::normalize("ripgrep"), CanonicalTool::Grep);
        assert_eq!(OpenCodeAdapter::normalize("find"), CanonicalTool::Find);
        assert_eq!(OpenCodeAdapter::normalize("locate"), CanonicalTool::Find);
    }

    #[test]
    fn normalizes_web_tools() {
        assert_eq!(OpenCodeAdapter::normalize("fetch"), CanonicalTool::WebFetch);
        assert_eq!(OpenCodeAdapter::normalize("http"), CanonicalTool::WebFetch);
        assert_eq!(OpenCodeAdapter::normalize("curl"), CanonicalTool::WebFetch);
        assert_eq!(
            OpenCodeAdapter::normalize("request"),
            CanonicalTool::WebFetch
        );
        assert_eq!(
            OpenCodeAdapter::normalize("webSearch"),
            CanonicalTool::WebSearch
        );
        assert_eq!(
            OpenCodeAdapter::normalize("search_web"),
            CanonicalTool::WebSearch
        );
    }

    #[test]
    fn normalizes_think_tools() {
        assert_eq!(OpenCodeAdapter::normalize("task"), CanonicalTool::Task);
        assert_eq!(OpenCodeAdapter::normalize("spawn"), CanonicalTool::Task);
        assert_eq!(OpenCodeAdapter::normalize("delegate"), CanonicalTool::Task);
        assert_eq!(OpenCodeAdapter::normalize("todo"), CanonicalTool::TodoWrite);
        assert_eq!(
            OpenCodeAdapter::normalize("todoWrite"),
            CanonicalTool::TodoWrite
        );
        assert_eq!(
            OpenCodeAdapter::normalize("ask"),
            CanonicalTool::AskUserQuestion
        );
        assert_eq!(
            OpenCodeAdapter::normalize("askUser"),
            CanonicalTool::AskUserQuestion
        );
        assert_eq!(
            OpenCodeAdapter::normalize("question"),
            CanonicalTool::AskUserQuestion
        );
        assert_eq!(OpenCodeAdapter::normalize("skill"), CanonicalTool::Skill);
    }

    #[test]
    fn normalizes_mode_tools() {
        assert_eq!(
            OpenCodeAdapter::normalize("planMode"),
            CanonicalTool::EnterPlanMode
        );
        assert_eq!(
            OpenCodeAdapter::normalize("plan"),
            CanonicalTool::EnterPlanMode
        );
        assert_eq!(
            OpenCodeAdapter::normalize("enterPlan"),
            CanonicalTool::EnterPlanMode
        );
        assert_eq!(
            OpenCodeAdapter::normalize("exitPlan"),
            CanonicalTool::ExitPlanMode
        );
        assert_eq!(
            OpenCodeAdapter::normalize("execute_plan"),
            CanonicalTool::ExitPlanMode
        );
    }

    #[test]
    fn normalizes_file_operations() {
        assert_eq!(OpenCodeAdapter::normalize("move"), CanonicalTool::Move);
        assert_eq!(OpenCodeAdapter::normalize("mv"), CanonicalTool::Move);
        assert_eq!(OpenCodeAdapter::normalize("rename"), CanonicalTool::Move);
        assert_eq!(OpenCodeAdapter::normalize("delete"), CanonicalTool::Delete);
        assert_eq!(OpenCodeAdapter::normalize("rm"), CanonicalTool::Delete);
        assert_eq!(OpenCodeAdapter::normalize("remove"), CanonicalTool::Delete);
        assert_eq!(OpenCodeAdapter::normalize("unlink"), CanonicalTool::Delete);
    }

    #[test]
    fn returns_unknown_for_unrecognized_tools() {
        assert_eq!(
            OpenCodeAdapter::normalize("customTool"),
            CanonicalTool::Unknown("customTool".to_string())
        );
        assert_eq!(
            OpenCodeAdapter::normalize("mySpecialTool"),
            CanonicalTool::Unknown("mySpecialTool".to_string())
        );
    }

    #[test]
    fn maps_to_correct_tool_kind() {
        let tool = OpenCodeAdapter::normalize("readFile");
        assert_eq!(ToolKind::from(tool), ToolKind::Read);

        let tool = OpenCodeAdapter::normalize("editFile");
        assert_eq!(ToolKind::from(tool), ToolKind::Edit);

        let tool = OpenCodeAdapter::normalize("bash");
        assert_eq!(ToolKind::from(tool), ToolKind::Execute);

        let tool = OpenCodeAdapter::normalize("glob");
        assert_eq!(ToolKind::from(tool), ToolKind::Glob);

        let tool = OpenCodeAdapter::normalize("fetch");
        assert_eq!(ToolKind::from(tool), ToolKind::Fetch);

        let tool = OpenCodeAdapter::normalize("task");
        assert_eq!(ToolKind::from(tool), ToolKind::Task);

        let tool = OpenCodeAdapter::normalize("planMode");
        assert_eq!(ToolKind::from(tool), ToolKind::EnterPlanMode);

        let tool = OpenCodeAdapter::normalize("move");
        assert_eq!(ToolKind::from(tool), ToolKind::Move);

        let tool = OpenCodeAdapter::normalize("delete");
        assert_eq!(ToolKind::from(tool), ToolKind::Delete);
    }
}
