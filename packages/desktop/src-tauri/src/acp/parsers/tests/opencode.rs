use super::*;
use crate::acp::session_update::ToolCallStatus;

mod opencode_detect_update_type {
    use super::*;
    use serde_json::json;

    fn parser() -> OpenCodeParser {
        OpenCodeParser
    }

    #[test]
    fn detects_tool_invocation_by_type_field() {
        let data = json!({
            "id": "tool-123",
            "type": "tool-invocation",
            "name": "Read",
            "input": { "file_path": "/test.rs" }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCall));
    }

    #[test]
    fn detects_tool_result_by_type_field() {
        let data = json!({
            "type": "tool-result",
            "toolUseId": "tool-123",
            "content": "File contents here"
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCallUpdate));
    }

    #[test]
    fn detects_text_part_as_agent_message() {
        let data = json!({
            "type": "text",
            "text": "Hello, I can help with that."
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::AgentMessageChunk));
    }

    #[test]
    fn returns_error_for_unknown_type() {
        let data = json!({
            "type": "unknown-type",
            "data": "value"
        });

        let result = parser().detect_update_type(&data);
        assert!(result.is_err());
    }
}

mod opencode_parse_tool_call {
    use super::*;
    use serde_json::json;

    fn parser() -> OpenCodeParser {
        OpenCodeParser
    }

    #[test]
    fn extracts_id_name_and_input() {
        let data = json!({
            "id": "tool-abc-123",
            "type": "tool-invocation",
            "name": "Read",
            "input": {
                "file_path": "/src/main.rs"
            }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool-abc-123");
        assert_eq!(result.name, "Read");
        assert!(matches!(
            result.arguments,
            crate::acp::session_update::ToolArguments::Read { .. }
        ));
        assert_eq!(
            match &result.arguments {
                crate::acp::session_update::ToolArguments::Read { file_path, .. } =>
                    file_path.as_deref(),
                _ => None,
            },
            Some("/src/main.rs")
        );
        assert_eq!(result.status, ToolCallStatus::Pending);
    }

    #[test]
    fn normalizes_apply_patch_to_edit_with_patch_text_arguments() {
        let data = json!({
            "id": "tool-apply-patch-1",
            "type": "tool-invocation",
            "name": "apply_patch",
            "input": {
                "patch_text": "*** Begin Patch\n*** Update File: CLAUDE.md\n@@\n-Look at AGENTS.md\n+Read `AGENTS.md` first and follow its project-specific rules.\n*** End Patch"
            }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.name, "apply_patch");
        assert_eq!(
            result.kind,
            Some(crate::acp::session_update::ToolKind::Edit)
        );

        match result.arguments {
            crate::acp::session_update::ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(edits[0].file_path().map(String::as_str), Some("CLAUDE.md"));
            }
            other => panic!("Expected Edit arguments, got {other:?}"),
        }
    }

    #[test]
    fn normalizes_apply_patch_to_edit_with_patch_text_camel_case_arguments() {
        let data = json!({
            "id": "tool-apply-patch-2",
            "type": "tool-invocation",
            "name": "apply_patch",
            "input": {
                "patchText": "*** Begin Patch\n*** Add File: link.txt\n+https://example.com\n*** End Patch"
            }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.name, "apply_patch");
        assert_eq!(
            result.kind,
            Some(crate::acp::session_update::ToolKind::Edit)
        );

        match result.arguments {
            crate::acp::session_update::ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(edits[0].file_path().map(String::as_str), Some("link.txt"));
            }
            other => panic!("Expected Edit arguments, got {other:?}"),
        }
    }

    #[test]
    fn fails_when_id_missing() {
        let data = json!({
            "type": "tool-invocation",
            "name": "Read"
        });

        let result = parser().parse_tool_call(&data);
        assert!(result.is_err());
    }

    #[test]
    fn fails_when_name_missing() {
        let data = json!({
            "id": "tool-1",
            "type": "tool-invocation"
        });

        let result = parser().parse_tool_call(&data);
        assert!(result.is_err());
    }
}

mod opencode_parse_tool_call_update {
    use super::*;
    use serde_json::json;

    fn parser() -> OpenCodeParser {
        OpenCodeParser
    }

    #[test]
    fn extracts_tool_result() {
        let data = json!({
            "type": "tool-result",
            "toolUseId": "tool-123",
            "content": "File read successfully"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.tool_call_id, "tool-123");
        assert_eq!(result.status, Some(ToolCallStatus::Completed));
        assert!(result.result.is_some());
    }

    #[test]
    fn fails_when_tool_use_id_missing() {
        let data = json!({
            "type": "tool-result",
            "content": "Data"
        });

        let result = parser().parse_tool_call_update(&data, None);
        assert!(result.is_err());
    }
}

mod opencode_parse_todo {
    use super::*;
    use serde_json::json;

    fn parser() -> OpenCodeParser {
        OpenCodeParser
    }

    #[test]
    fn parses_single_todo_with_all_fields() {
        let name = "todowrite"; // OpenCode uses lowercase
        let arguments = json!({
            "todos": [{
                "id": "1",
                "content": "Example task",
                "status": "pending",
                "priority": "medium"
            }]
        });
        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].content, "Example task");
        assert_eq!(todos[0].status, ParsedTodoStatus::Pending);
        // OpenCode doesn't have activeForm, so content is used as fallback
        assert_eq!(todos[0].active_form, "Example task");
    }

    #[test]
    fn parses_all_status_values_including_cancelled() {
        let name = "todowrite";
        let arguments = json!({
                "todos": [
                    { "id": "1", "content": "Pending", "status": "pending", "priority": "high" },
                    { "id": "2", "content": "In progress", "status": "in_progress", "priority": "medium" },
                    { "id": "3", "content": "Completed", "status": "completed", "priority": "low" },
                    { "id": "4", "content": "Cancelled", "status": "cancelled", "priority": "low" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos.len(), 4);
        assert_eq!(todos[0].status, ParsedTodoStatus::Pending);
        assert_eq!(todos[1].status, ParsedTodoStatus::InProgress);
        assert_eq!(todos[2].status, ParsedTodoStatus::Completed);
        assert_eq!(todos[3].status, ParsedTodoStatus::Cancelled);
    }

    #[test]
    fn matches_tool_name_case_insensitively() {
        // OpenCode uses lowercase "todowrite"
        let name = "TodoWrite"; // Mixed case
        let arguments = json!({
                "todos": [{
                    "id": "1",
                    "content": "Task",
                    "status": "pending",
                    "priority": "medium"
                }]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());
    }

    #[test]
    fn returns_none_for_non_todo_tool() {
        let name = "Read";
        let arguments = json!({
                "file_path": "/test.rs"
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_when_todos_array_empty() {
        let name = "todowrite";
        let arguments = json!({
                "todos": []
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn skips_todo_with_invalid_status() {
        let name = "todowrite";
        let arguments = json!({
                "todos": [
                    { "id": "1", "content": "Valid", "status": "pending", "priority": "high" },
                    { "id": "2", "content": "Invalid", "status": "unknown", "priority": "high" },
                    { "id": "3", "content": "Also valid", "status": "completed", "priority": "low" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].content, "Valid");
        assert_eq!(todos[1].content, "Also valid");
    }

    #[test]
    fn skips_todo_without_content() {
        let name = "todowrite";
        let arguments = json!({
                "todos": [
                    { "id": "1", "content": "Has content", "status": "pending", "priority": "high" },
                    { "id": "2", "status": "pending", "priority": "high" },  // Missing content
                    { "id": "3", "content": "Also has content", "status": "completed", "priority": "low" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos.len(), 2);
    }

    #[test]
    fn skips_todo_without_status() {
        let name = "todowrite";
        let arguments = json!({
                "todos": [
                    { "id": "1", "content": "Has status", "status": "pending", "priority": "high" },
                    { "id": "2", "content": "No status", "priority": "high" },  // Missing status
                    { "id": "3", "content": "Also has status", "status": "completed", "priority": "low" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos.len(), 2);
    }

    #[test]
    fn ignores_priority_and_id_fields() {
        // Priority and id are OpenCode-specific, we don't extract them to ParsedTodo
        let name = "todowrite";
        let arguments = json!({
                "todos": [{
                    "id": "custom-id-123",
                    "content": "Task",
                    "status": "pending",
                    "priority": "high"
                }]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        // We just verify content and status are correct
        // id and priority are agent-specific and not in ParsedTodo
        assert_eq!(todos[0].content, "Task");
        assert_eq!(todos[0].status, ParsedTodoStatus::Pending);
    }

    #[test]
    fn handles_todoread_tool() {
        // todoread is a different tool, should not be parsed
        let name = "todoread";
        let arguments = json!({});
        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none());
    }
}

// ===========================================
// OpenCode question parsing tests
// ===========================================

mod opencode_parse_question {
    use super::*;
    use serde_json::json;

    fn parser() -> OpenCodeParser {
        OpenCodeParser
    }

    #[test]
    fn parses_question_tool_with_options() {
        // OpenCode sends questions via a "Question" tool
        let name = "Question";
        let arguments = json!({
            "question": "What would you like?",
            "options": ["Option A", "Option B", "Option C"]
        });
        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());

        let questions = result.unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "What would you like?");
        assert_eq!(questions[0].options.len(), 3);
        assert_eq!(questions[0].options[0].label, "Option A");
        // OpenCode doesn't provide descriptions, so we use empty string as fallback
        assert!(questions[0].options[0].description.is_empty());
    }

    #[test]
    fn parses_question_with_string_options() {
        let name = "Question";
        let arguments = json!({
                "question": "Choose one",
                "options": ["Yes", "No"]
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());

        let questions = result.unwrap();
        assert_eq!(questions[0].options[0].label, "Yes");
        assert_eq!(questions[0].options[1].label, "No");
    }

    #[test]
    fn returns_none_for_non_question_tool() {
        let name = "Read";
        let arguments = json!({
                "file_path": "/test.rs"
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_when_question_field_missing() {
        let name = "Question";
        let arguments = json!({
                "options": ["A", "B"]
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn handles_question_without_options() {
        // OpenCode might send a free-form question without options
        let name = "Question";
        let arguments = json!({
                "question": "What should I do next?"
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());

        let questions = result.unwrap();
        assert_eq!(questions[0].question, "What should I do next?");
        assert!(questions[0].options.is_empty());
    }

    #[test]
    fn opencode_questions_are_single_select_by_default() {
        let name = "Question";
        let arguments = json!({
                "question": "Pick one",
                "options": ["A", "B"]
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());
        assert!(!result.unwrap()[0].multi_select);
    }

    #[test]
    fn parses_ask_user_question_tool_name() {
        // OpenCode might also use AskUserQuestion tool name
        let name = "AskUserQuestion";
        let arguments = json!({
                "question": "Select option",
                "options": ["X", "Y"]
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());
    }
}
