use super::*;
use crate::acp::session_update::{ToolCallStatus, ToolKind};

mod claude_code_detect_update_type {
    use super::*;
    use serde_json::json;

    fn parser() -> ClaudeCodeParser {
        ClaudeCodeParser
    }

    #[test]
    fn detects_tool_call_by_meta_tool_name() {
        let data = json!({
            "toolCallId": "tool-123",
            "_meta": {
                "claudeCode": {
                    "toolName": "Read"
                }
            },
            "rawInput": {}
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCall));
    }

    #[test]
    fn detects_tool_call_by_raw_input_presence() {
        let data = json!({
            "toolCallId": "tool-123",
            "rawInput": { "file_path": "/test.rs" }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCall));
    }

    #[test]
    fn detects_tool_call_update_without_meta_or_raw_input() {
        let data = json!({
            "toolCallId": "tool-123",
            "status": "completed"
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCallUpdate));
    }

    #[test]
    fn detects_agent_message_chunk_by_explicit_type() {
        let data = json!({
            "type": "agentMessageChunk",
            "content": { "type": "text", "text": "Hello" }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::AgentMessageChunk));
    }

    #[test]
    fn detects_user_message_chunk_by_explicit_type() {
        let data = json!({
            "type": "userMessageChunk",
            "content": { "type": "text", "text": "Hi" }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::UserMessageChunk));
    }

    #[test]
    fn detects_agent_thought_chunk_by_explicit_type() {
        let data = json!({
            "type": "agentThoughtChunk",
            "content": { "type": "text", "text": "Thinking..." }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::AgentThoughtChunk));
    }

    #[test]
    fn detects_permission_request() {
        let data = json!({
            "type": "permissionRequest",
            "permissionRequest": {
                "id": "perm-1",
                "sessionId": "sess-1",
                "permission": "execute"
            }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::PermissionRequest));
    }

    #[test]
    fn detects_question_request() {
        let data = json!({
            "type": "questionRequest",
            "questionRequest": {
                "id": "q-1",
                "sessionId": "sess-1",
                "questions": []
            }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::QuestionRequest));
    }

    #[test]
    fn detects_available_commands_by_key() {
        let data = json!({
            "availableCommands": [
                { "name": "/help", "description": "Get help" }
            ]
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::AvailableCommandsUpdate));
    }

    #[test]
    fn detects_plan_by_key() {
        let data = json!({
            "plan": {
                "steps": []
            }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::Plan));
    }

    #[test]
    fn returns_error_for_unknown_type() {
        let data = json!({
            "unknownField": "value"
        });

        let result = parser().detect_update_type(&data);
        assert!(result.is_err());
    }
}

mod claude_code_parse_tool_call {
    use super::*;
    use serde_json::json;

    fn parser() -> ClaudeCodeParser {
        ClaudeCodeParser
    }

    #[test]
    fn extracts_id_from_tool_call_id() {
        let data = json!({
            "toolCallId": "tool-abc-123"
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool-abc-123");
    }

    #[test]
    fn extracts_name_from_meta_claude_code() {
        let data = json!({
            "toolCallId": "tool-1",
            "_meta": {
                "claudeCode": {
                    "toolName": "AskUserQuestion"
                }
            }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.name, "AskUserQuestion");
    }

    #[test]
    fn defaults_name_to_unknown_when_missing() {
        let data = json!({
            "toolCallId": "tool-1"
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.name, "Tool");
    }

    #[test]
    fn extracts_raw_input_as_arguments() {
        let data = json!({
            "toolCallId": "tool-1",
            "rawInput": {
                "file_path": "/test.rs"
            }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        let path = match &result.arguments {
            crate::acp::session_update::ToolArguments::Read { file_path, .. } => {
                file_path.as_deref()
            }
            crate::acp::session_update::ToolArguments::Other { raw } => {
                raw.get("file_path").and_then(|v| v.as_str())
            }
            _ => None,
        };
        assert_eq!(path, Some("/test.rs"));
    }

    #[test]
    fn extracts_status_pending() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "pending"
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.status, ToolCallStatus::Pending);
    }

    #[test]
    fn extracts_status_in_progress() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "in_progress"
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.status, ToolCallStatus::InProgress);
    }

    #[test]
    fn extracts_status_completed() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "completed"
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.status, ToolCallStatus::Completed);
    }

    #[test]
    fn defaults_status_to_pending() {
        let data = json!({
            "toolCallId": "tool-1"
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.status, ToolCallStatus::Pending);
    }

    #[test]
    fn derives_kind_from_tool_name_ignoring_incoming_kind() {
        // CLI may send incorrect kind (e.g., "think" for AskUserQuestion)
        // We always derive kind from tool name
        let data = json!({
            "toolCallId": "tool-1",
            "_meta": { "claudeCode": { "toolName": "AskUserQuestion" } },
            "kind": "think"  // This incorrect kind should be ignored
        });

        let result = parser().parse_tool_call(&data).unwrap();
        // Kind is derived from tool name, not from incoming data
        assert_eq!(result.kind, Some(ToolKind::Question));
    }

    #[test]
    fn extracts_title_from_data() {
        let data = json!({
            "toolCallId": "tool-1",
            "title": "Asking a question"
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.title, Some("Asking a question".to_string()));
    }

    #[test]
    fn fails_when_tool_call_id_missing() {
        let data = json!({
            "_meta": {
                "claudeCode": {
                    "toolName": "Read"
                }
            }
        });

        let result = parser().parse_tool_call(&data);
        assert!(result.is_err());
        assert!(matches!(result, Err(ParseError::MissingField(_))));
    }

    #[test]
    fn parses_full_tool_call() {
        let data = json!({
            "toolCallId": "toolu_123",
            "_meta": {
                "claudeCode": {
                    "toolName": "AskUserQuestion"
                }
            },
            "rawInput": {
                "questions": [{
                    "question": "What would you like?",
                    "header": "Task",
                    "options": [
                        { "label": "Option A", "description": "Do A" },
                        { "label": "Option B", "description": "Do B" }
                    ],
                    "multiSelect": false
                }]
            },
            "status": "pending",
            "kind": "think",  // CLI sends wrong kind, should be overridden
            "title": "Today's task"
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "toolu_123");
        assert_eq!(result.name, "AskUserQuestion");
        assert_eq!(result.status, ToolCallStatus::Pending);
        // Kind is always derived from tool name, ignoring CLI's incorrect "think"
        assert_eq!(result.kind, Some(ToolKind::Question));
        assert_eq!(result.title, Some("Today's task".to_string()));
        assert!(matches!(
            result.arguments,
            crate::acp::session_update::ToolArguments::Think { .. }
        ));
    }
}

mod claude_code_parse_tool_call_update {
    use super::*;
    use serde_json::json;

    fn parser() -> ClaudeCodeParser {
        ClaudeCodeParser
    }

    #[test]
    fn extracts_status_update_to_in_progress() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "in_progress"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.tool_call_id, "tool-1");
        assert_eq!(result.status, Some(ToolCallStatus::InProgress));
    }

    #[test]
    fn extracts_status_update_to_completed() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "completed"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.status, Some(ToolCallStatus::Completed));
    }

    #[test]
    fn extracts_status_update_to_failed() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "failed"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.status, Some(ToolCallStatus::Failed));
    }

    #[test]
    fn extracts_result_when_completed() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "completed",
            "result": {
                "type": "text",
                "text": "File read successfully"
            }
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert!(result.result.is_some());
        assert_eq!(
            result.result.unwrap().get("type").and_then(|v| v.as_str()),
            Some("text")
        );
    }

    #[test]
    fn result_is_none_when_not_present() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "in_progress"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert!(result.result.is_none());
    }

    #[test]
    fn extracts_title_update() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "in_progress",
            "title": "Reading file: test.rs"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.title, Some("Reading file: test.rs".to_string()));
    }

    #[test]
    fn title_is_none_when_not_present() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "in_progress"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert!(result.title.is_none());
    }

    #[test]
    fn extracts_locations() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "completed",
            "locations": [
                { "path": "test.rs" }
            ]
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert!(result.locations.is_some());
        let locations = result.locations.unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].path, "test.rs");
    }

    #[test]
    fn locations_is_none_when_not_present() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "completed"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert!(result.locations.is_none());
    }

    #[test]
    fn fails_when_tool_call_id_missing() {
        let data = json!({
            "status": "completed"
        });

        let result = parser().parse_tool_call_update(&data, None);
        assert!(result.is_err());
        assert!(matches!(result, Err(ParseError::MissingField(_))));
    }

    #[test]
    fn parses_full_update_with_all_fields() {
        let data = json!({
            "toolCallId": "toolu_123",
            "status": "completed",
            "result": {
                "type": "text",
                "text": "Success"
            },
            "title": "Completed task",
            "locations": [
                { "path": "main.rs" }
            ]
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.tool_call_id, "toolu_123");
        assert_eq!(result.status, Some(ToolCallStatus::Completed));
        assert!(result.result.is_some());
        assert_eq!(result.title, Some("Completed task".to_string()));
        assert!(result.locations.is_some());
        assert!(result.streaming_input_delta.is_none());
    }

    #[test]
    fn extracts_streaming_input_delta_and_tool_name_from_meta() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "in_progress",
            "_meta": {
                "claudeCode": {
                    "toolName": "Read",
                    "streamingInputDelta": "{\"file_path\": \"/tmp"
                }
            }
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(
            result.streaming_input_delta.as_deref(),
            Some("{\"file_path\": \"/tmp")
        );
    }

    #[test]
    fn extracts_result_from_raw_output_preferred_over_result() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "completed",
            "result": { "legacy": true },
            "rawOutput": "stdout from bash"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(
            result.result.as_ref().and_then(|v| v.as_str()),
            Some("stdout from bash")
        );
    }

    #[test]
    fn extracts_result_from_meta_tool_response() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "completed",
            "_meta": {
                "claudeCode": {
                    "toolResponse": { "exitCode": 0, "stdout": "ok" }
                }
            }
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        let resp = result.result.as_ref().expect("should have result");
        assert_eq!(resp.get("exitCode").and_then(|v| v.as_i64()), Some(0));
    }

    #[test]
    fn extracts_content_blocks() {
        let data = json!({
            "toolCallId": "tool-1",
            "status": "completed",
            "content": [
                { "type": "content", "content": { "type": "text", "text": "Hello" } }
            ]
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert!(result.content.is_some());
        let content = result.content.unwrap();
        assert_eq!(content.len(), 1);
        assert!(matches!(
            content[0],
            crate::acp::types::ContentBlock::Text { .. }
        ));
        if let crate::acp::types::ContentBlock::Text { text } = &content[0] {
            assert_eq!(text, "Hello");
        }
    }
}

mod claude_code_parse_question {
    use super::*;
    use serde_json::json;

    fn parser() -> ClaudeCodeParser {
        ClaudeCodeParser
    }

    #[test]
    fn parses_single_question_with_options() {
        let name = "AskUserQuestion";
        let arguments = json!({
                "questions": [{
                    "question": "Which approach?",
                    "header": "Architecture",
                    "options": [
                        { "label": "Option A", "description": "Use pattern A" },
                        { "label": "Option B", "description": "Use pattern B" }
                    ],
                    "multiSelect": false
                }]
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());

        let questions = result.unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "Which approach?");
        assert_eq!(questions[0].header, "Architecture");
        assert_eq!(questions[0].options.len(), 2);
        assert_eq!(questions[0].options[0].label, "Option A");
        assert_eq!(questions[0].options[0].description, "Use pattern A");
        assert!(!questions[0].multi_select);
    }

    #[test]
    fn parses_multi_select_question() {
        let name = "AskUserQuestion";
        let arguments = json!({
                "questions": [{
                    "question": "Select features",
                    "header": "Features",
                    "options": [
                        { "label": "Feature A", "description": "Enable A" },
                        { "label": "Feature B", "description": "Enable B" }
                    ],
                    "multiSelect": true
                }]
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());

        let questions = result.unwrap();
        assert!(questions[0].multi_select);
    }

    #[test]
    fn parses_multiple_questions() {
        let name = "AskUserQuestion";
        let arguments = json!({
                "questions": [
                    {
                        "question": "First question?",
                        "header": "Q1",
                        "options": [{ "label": "Yes", "description": "Confirm" }, { "label": "No", "description": "Deny" }],
                        "multiSelect": false
                    },
                    {
                        "question": "Second question?",
                        "header": "Q2",
                        "options": [{ "label": "A", "description": "Choose A" }, { "label": "B", "description": "Choose B" }],
                        "multiSelect": false
                    }
                ]
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());

        let questions = result.unwrap();
        assert_eq!(questions.len(), 2);
        assert_eq!(questions[0].question, "First question?");
        assert_eq!(questions[1].question, "Second question?");
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
    fn returns_none_when_questions_array_missing() {
        let name = "AskUserQuestion";
        let arguments = json!({
                "other_field": "value"
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_when_questions_array_empty() {
        let name = "AskUserQuestion";
        let arguments = json!({
                "questions": []
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn rejects_question_without_required_header() {
        let name = "AskUserQuestion";
        let arguments = json!({
                "questions": [{
                    "question": "Simple question?",
                    "multiSelect": false,
                    "options": [{ "label": "Yes", "description": "Confirm" }]
                }]
        });

        // Missing header field should cause question to be rejected
        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn rejects_option_without_required_description() {
        let name = "AskUserQuestion";
        let arguments = json!({
                "questions": [{
                    "question": "Pick one",
                    "header": "Choice",
                    "multiSelect": false,
                    "options": [
                        { "label": "Choice A" },
                        { "label": "Choice B", "description": "Has description" }
                    ]
                }]
        });

        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_some());

        // Options without description are filtered out
        let options = &result.unwrap()[0].options;
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].description, "Has description");
    }

    #[test]
    fn rejects_question_without_required_multi_select() {
        let name = "AskUserQuestion";
        let arguments = json!({
                "questions": [{
                    "question": "Question without multiSelect field",
                    "header": "Test",
                    "options": [{ "label": "A", "description": "Option A" }]
                }]
        });

        // Missing multiSelect field should cause question to be rejected
        let result = parser().parse_questions(name, &arguments);
        assert!(result.is_none());
    }
}

// ===========================================
// Claude Code todo parsing tests
// ===========================================

mod claude_code_parse_todo {
    use super::*;
    use serde_json::json;

    fn parser() -> ClaudeCodeParser {
        ClaudeCodeParser
    }

    #[test]
    fn parses_single_todo_with_all_fields() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [{
                    "content": "Run tests",
                    "activeForm": "Running tests",
                    "status": "in_progress"
                }]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].content, "Run tests");
        assert_eq!(todos[0].active_form, "Running tests");
        assert_eq!(todos[0].status, ParsedTodoStatus::InProgress);
    }

    #[test]
    fn rejects_todo_without_required_active_form() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [{
                    "content": "Fix bug",
                    "status": "pending"
                }]
        });

        // Missing activeForm should cause todo to be rejected, resulting in None
        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn parses_only_valid_todos_with_active_form() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [
                    { "content": "Task 1", "status": "completed", "activeForm": "Completing Task 1" },
                    { "content": "Task 2", "status": "in_progress", "activeForm": "Working on Task 2" },
                    { "content": "Task 3", "status": "pending" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        // Only 2 todos are valid (have activeForm), Task 3 is filtered out
        assert_eq!(todos.len(), 2);

        assert_eq!(todos[0].content, "Task 1");
        assert_eq!(todos[0].status, ParsedTodoStatus::Completed);
        assert_eq!(todos[0].active_form, "Completing Task 1");

        assert_eq!(todos[1].content, "Task 2");
        assert_eq!(todos[1].status, ParsedTodoStatus::InProgress);
        assert_eq!(todos[1].active_form, "Working on Task 2");
    }

    #[test]
    fn parses_all_status_values() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [
                    { "content": "Pending task", "status": "pending", "activeForm": "Pending task" },
                    { "content": "In progress task", "status": "in_progress", "activeForm": "Working on task" },
                    { "content": "Completed task", "status": "completed", "activeForm": "Completed task" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos[0].status, ParsedTodoStatus::Pending);
        assert_eq!(todos[1].status, ParsedTodoStatus::InProgress);
        assert_eq!(todos[2].status, ParsedTodoStatus::Completed);
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
    fn returns_none_when_todos_array_missing() {
        let name = "TodoWrite";
        let arguments = json!({
                "other_field": "value"
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_when_todos_array_empty() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": []
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn skips_todo_with_invalid_status() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [
                    { "content": "Valid task", "status": "pending", "activeForm": "Valid task" },
                    { "content": "Invalid task", "status": "unknown_status", "activeForm": "Invalid" },
                    { "content": "Another valid task", "status": "completed", "activeForm": "Another" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        // Should only have 2 valid todos, skipping the one with invalid status
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].content, "Valid task");
        assert_eq!(todos[1].content, "Another valid task");
    }

    #[test]
    fn skips_todo_without_content() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [
                    { "content": "Valid task", "status": "pending", "activeForm": "Valid" },
                    { "status": "in_progress", "activeForm": "Working" },  // Missing content
                    { "content": "Another valid task", "status": "completed", "activeForm": "Done" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        // Should only have 2 valid todos
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].content, "Valid task");
        assert_eq!(todos[1].content, "Another valid task");
    }

    #[test]
    fn skips_todo_without_status() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [
                    { "content": "Valid task", "status": "pending", "activeForm": "Valid" },
                    { "content": "No status task", "activeForm": "Missing status" },  // Missing status
                    { "content": "Another valid task", "status": "completed", "activeForm": "Done" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        // Should only have 2 valid todos
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].content, "Valid task");
        assert_eq!(todos[1].content, "Another valid task");
    }

    #[test]
    fn returns_none_when_all_todos_invalid() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [
                    { "content": "No status" },
                    { "status": "pending" },
                    { "content": "Invalid status", "status": "bad" }
                ]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn handles_todos_not_array() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": "not an array"
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none());
    }

    #[test]
    fn handles_complex_content_text() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [{
                    "content": "Fix bug in src/lib/acp/components/tool-calls/todo-inline.svelte:42",
                    "activeForm": "Fixing bug in todo-inline.svelte",
                    "status": "in_progress"
                }]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(
            todos[0].content,
            "Fix bug in src/lib/acp/components/tool-calls/todo-inline.svelte:42"
        );
    }

    #[test]
    fn handles_unicode_in_content() {
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [{
                    "content": "修复 bug 在 测试文件中 🐛",
                    "activeForm": "正在修复 bug 🔧",
                    "status": "in_progress"
                }]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos[0].content, "修复 bug 在 测试文件中 🐛");
        assert_eq!(todos[0].active_form, "正在修复 bug 🔧");
    }

    #[test]
    fn case_sensitivity_for_tool_name() {
        // Tool name must be exactly "TodoWrite"
        let name = "todowrite"; // lowercase
        let arguments = json!({
                "todos": [{
                    "content": "Task",
                    "status": "pending"
                }]
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_none()); // Should not match
    }

    #[test]
    fn case_sensitivity_for_status() {
        // Status values must be lowercase
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [{
                    "content": "Task with uppercase status",
                    "status": "PENDING"  // Should not match
                }]
        });

        let result = parser().parse_todos(name, &arguments);
        // All todos invalid due to case mismatch
        assert!(result.is_none());
    }

    #[test]
    fn parses_todos_nested_in_raw_field() {
        // When data is deserialized from storage, todos are nested inside raw field
        let name = "TodoWrite";
        let arguments = json!({
                "kind": "think",
                "raw": {
                    "todos": [{
                        "content": "Run tests",
                        "activeForm": "Running tests",
                        "status": "in_progress"
                    }]
                }
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].content, "Run tests");
        assert_eq!(todos[0].active_form, "Running tests");
        assert_eq!(todos[0].status, ParsedTodoStatus::InProgress);
    }

    #[test]
    fn prefers_root_level_todos_over_nested() {
        // If both root-level and nested todos exist, root-level takes precedence
        let name = "TodoWrite";
        let arguments = json!({
                "todos": [{
                    "content": "Root level task",
                    "activeForm": "Root task",
                    "status": "pending"
                }],
                "raw": {
                    "todos": [{
                        "content": "Nested task",
                        "activeForm": "Nested",
                        "status": "completed"
                    }]
                }
        });

        let result = parser().parse_todos(name, &arguments);
        assert!(result.is_some());

        let todos = result.unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].content, "Root level task");
    }
}
