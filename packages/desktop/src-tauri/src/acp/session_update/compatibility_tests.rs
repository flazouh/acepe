use super::*;
use crate::acp::agent_context::with_agent;
use crate::acp::parsers::AgentType;
use crate::acp::types::ContentBlock;
use serde_json::json;

#[test]
fn test_content_chunk_direct_format() {
    let json = json!({
        "content": {
            "type": "text",
            "text": "Hello world"
        }
    });

    let chunk: ContentChunk = serde_json::from_value(json).unwrap();
    match chunk.content {
        ContentBlock::Text { text } => assert_eq!(text, "Hello world"),
        _ => panic!("Expected text content"),
    }
}

#[test]
fn test_plan_step_status() {
    let json = json!("pending");
    let status: PlanStepStatus = serde_json::from_value(json).unwrap();
    assert!(matches!(status, PlanStepStatus::Pending));

    let json = json!("completed");
    let status: PlanStepStatus = serde_json::from_value(json).unwrap();
    assert!(matches!(status, PlanStepStatus::Completed));
}

#[test]
fn test_plan_step() {
    let json = json!({
        "description": "Test step",
        "status": "in_progress"
    });

    let step: PlanStep = serde_json::from_value(json).unwrap();
    assert_eq!(step.description, "Test step");
    assert!(matches!(step.status, PlanStepStatus::InProgress));
}

#[test]
fn test_plan_data() {
    let json = json!({
        "steps": [
            {
                "description": "Step 1",
                "status": "pending"
            },
            {
                "description": "Step 2",
                "status": "completed"
            }
        ],
        "currentStep": 1
    });

    let plan: PlanData = serde_json::from_value(json).unwrap();
    assert_eq!(plan.steps.len(), 2);
    assert_eq!(plan.current_step, Some(1));
}

#[test]
fn test_available_command() {
    let json = json!({
        "name": "help",
        "description": "Show help",
        "input": {
            "hint": "topic"
        }
    });

    let cmd: AvailableCommand = serde_json::from_value(json).unwrap();
    assert_eq!(cmd.name, "help");
    assert_eq!(cmd.description, "Show help");
    assert!(cmd.input.is_some());
}

#[test]
fn test_current_mode_data() {
    let json = json!({
        "currentModeId": "code"
    });

    let mode: CurrentModeData = serde_json::from_value(json).unwrap();
    assert_eq!(mode.current_mode_id, "code");
}

#[test]
fn test_permission_data() {
    let json = json!({
        "id": "perm-123",
        "sessionId": "sess-456",
        "permission": "fs.read",
        "patterns": ["*.txt"],
        "metadata": {},
        "always": [],
        "tool": {
            "messageId": "msg-789",
            "callId": "call-101"
        }
    });

    let perm: PermissionData = serde_json::from_value(json).unwrap();
    assert_eq!(perm.id, "perm-123");
    assert_eq!(perm.session_id, "sess-456");
    assert_eq!(perm.permission, "fs.read");
    assert!(perm.tool.is_some());
}

#[test]
fn test_question_data() {
    let json = json!({
        "id": "q-123",
        "sessionId": "sess-456",
        "questions": [
            {
                "question": "What is your name?",
                "header": "Name Question",
                "options": [
                    {
                        "label": "Alice",
                        "description": "First option"
                    }
                ],
                "multiSelect": false
            }
        ]
    });

    let question: QuestionData = serde_json::from_value(json).unwrap();
    assert_eq!(question.id, "q-123");
    assert_eq!(question.questions.len(), 1);
    assert_eq!(question.questions[0].question, "What is your name?");
}

#[test]
fn test_session_update_user_message_chunk_camel_case() {
    let json = json!({
        "type": "userMessageChunk",
        "content": {
            "type": "text",
            "text": "Hello world"
        },
        "sessionId": "sess-123"
    });

    let update: SessionUpdate = serde_json::from_value(json).unwrap();
    match update {
        SessionUpdate::UserMessageChunk { chunk, session_id } => {
            assert_eq!(session_id, Some("sess-123".to_string()));
            match chunk.content {
                ContentBlock::Text { text } => assert_eq!(text, "Hello world"),
                _ => panic!("Expected text content"),
            }
        }
        _ => panic!("Expected UserMessageChunk"),
    }
}

#[test]
fn test_session_update_user_message_chunk_snake_case() {
    let json = json!({
        "sessionUpdate": "user_message_chunk",
        "content": {
            "type": "text",
            "text": "Hello world"
        }
    });

    let update: SessionUpdate = serde_json::from_value(json).unwrap();
    match update {
        SessionUpdate::UserMessageChunk { chunk, session_id } => {
            assert_eq!(session_id, None);
            match chunk.content {
                ContentBlock::Text { text } => assert_eq!(text, "Hello world"),
                _ => panic!("Expected text content"),
            }
        }
        _ => panic!("Expected UserMessageChunk"),
    }
}

#[test]
fn test_session_update_nested_chunk_format() {
    let json = json!({
        "type": "userMessageChunk",
        "chunk": {
            "content": {
                "type": "text",
                "text": "Nested content"
            }
        }
    });

    let update: SessionUpdate = serde_json::from_value(json).unwrap();
    match update {
        SessionUpdate::UserMessageChunk {
            chunk,
            session_id: _,
        } => match chunk.content {
            ContentBlock::Text { text } => assert_eq!(text, "Nested content"),
            _ => panic!("Expected text content"),
        },
        _ => panic!("Expected UserMessageChunk"),
    }
}

#[test]
fn test_session_update_plan() {
    let json = json!({
        "type": "plan",
        "plan": {
            "steps": [
                {
                    "description": "Step 1",
                    "status": "completed"
                }
            ],
            "currentStep": 0
        },
        "sessionId": "sess-456"
    });

    let update: SessionUpdate = serde_json::from_value(json).unwrap();
    match update {
        SessionUpdate::Plan { plan, session_id } => {
            assert_eq!(session_id, Some("sess-456".to_string()));
            assert_eq!(plan.steps.len(), 1);
            assert_eq!(plan.steps[0].description, "Step 1");
            assert!(matches!(plan.steps[0].status, PlanStepStatus::Completed));
            assert_eq!(plan.current_step, Some(0));
        }
        _ => panic!("Expected Plan"),
    }
}

#[test]
fn test_session_update_tool_call() {
    // ACP format uses toolCallId and _meta.claudeCode.toolName
    let json = json!({
        "type": "toolCall",
        "toolCallId": "call-123",
        "_meta": {
            "claudeCode": {
                "toolName": "run_terminal_cmd"
            }
        },
        "rawInput": {
            "command": "ls -la"
        },
        "status": "completed",
        "kind": "execute"
    });

    let update: SessionUpdate = serde_json::from_value(json).unwrap();
    match update {
        SessionUpdate::ToolCall {
            tool_call,
            session_id: _,
        } => {
            assert_eq!(tool_call.id, "call-123");
            assert_eq!(tool_call.name, "run_terminal_cmd");
            assert!(matches!(tool_call.status, ToolCallStatus::Completed));
        }
        _ => panic!("Expected ToolCall"),
    }
}

/// Test parsing the exact ACP format with snake_case sessionUpdate field
/// This matches what the Claude ACP agent actually sends
#[test]
fn test_session_update_tool_call_acp_format() {
    // Exact format from acp-agent.ts toAcpNotifications() for tool_use
    let json = json!({
        "sessionUpdate": "tool_call",
        "toolCallId": "toolu_016jRdp79JqqfcH22yvZLkF3",
        "_meta": {
            "claudeCode": {
                "toolName": "mcp__acp__Read"
            }
        },
        "rawInput": {
            "file_path": "/Users/example/Documents/acepe/packages/desktop/src/lib/test-file.ts"
        },
        "status": "pending",
        "kind": "read",
        "title": "Read /Users/example/Documents/acepe/packages/desktop/src/lib/test-file.ts",
        "locations": [
            {"path": "/Users/example/Documents/acepe/packages/desktop/src/lib/test-file.ts", "line": 0}
        ],
        "content": []
    });

    let update: SessionUpdate = serde_json::from_value(json).unwrap();
    match update {
        SessionUpdate::ToolCall {
            tool_call,
            session_id: _,
        } => {
            assert_eq!(tool_call.id, "toolu_016jRdp79JqqfcH22yvZLkF3");
            assert_eq!(tool_call.name, "mcp__acp__Read");
            assert!(matches!(tool_call.status, ToolCallStatus::Pending));
            assert_eq!(tool_call.kind, Some(ToolKind::Read));
            assert_eq!(
                tool_call.title,
                Some(
                    "Read /Users/example/Documents/acepe/packages/desktop/src/lib/test-file.ts"
                        .to_string()
                )
            );
        }
        _ => panic!("Expected ToolCall, got {:?}", update),
    }
}

/// Test parsing the Edit tool call format
#[test]
fn test_session_update_tool_call_edit() {
    let json = json!({
        "sessionUpdate": "tool_call",
        "toolCallId": "toolu_01SYJ3hktXpiGHpucHrjNj7U",
        "_meta": {
            "claudeCode": {
                "toolName": "mcp__acp__Edit"
            }
        },
        "rawInput": {
            "file_path": "/path/to/file.ts",
            "old_string": "function multiply",
            "new_string": "function multiply\n\nfunction subtract"
        },
        "status": "pending",
        "kind": "edit"
    });

    let update: SessionUpdate = serde_json::from_value(json).unwrap();
    match update {
        SessionUpdate::ToolCall {
            tool_call,
            session_id: _,
        } => {
            assert_eq!(tool_call.name, "mcp__acp__Edit");
            assert_eq!(tool_call.kind, Some(ToolKind::Edit));
            match &tool_call.arguments {
                ToolArguments::Edit { edits } => {
                    let e = edits.first().expect("edit entry");
                    assert_eq!(e.file_path.as_deref(), Some("/path/to/file.ts"));
                    assert!(e.old_string.as_ref().unwrap().contains("multiply"));
                    assert!(e.new_string.as_ref().unwrap().contains("subtract"));
                }
                _ => panic!("Expected Edit arguments"),
            }
        }
        _ => panic!("Expected ToolCall"),
    }
}

#[test]
fn test_tool_arguments_read() {
    let raw = json!({"file_path": "/tmp/test.txt"});
    let args = ToolArguments::from_raw(ToolKind::Read, raw);
    match args {
        ToolArguments::Read { file_path } => {
            assert_eq!(file_path, Some("/tmp/test.txt".to_string()));
        }
        _ => panic!("Expected Read variant"),
    }
}

#[test]
fn test_tool_arguments_read_aliases() {
    let raw = json!({"filePath": "/tmp/test.txt"});
    let args = ToolArguments::from_raw(ToolKind::Read, raw);
    match args {
        ToolArguments::Read { file_path } => {
            assert_eq!(file_path, Some("/tmp/test.txt".to_string()));
        }
        _ => panic!("Expected Read variant"),
    }

    let raw = json!({"path": "/tmp/test.txt"});
    let args = ToolArguments::from_raw(ToolKind::Read, raw);
    match args {
        ToolArguments::Read { file_path } => {
            assert_eq!(file_path, Some("/tmp/test.txt".to_string()));
        }
        _ => panic!("Expected Read variant"),
    }
}

#[test]
fn test_tool_arguments_edit() {
    let raw = json!({
        "filePath": "/tmp/file.txt",
        "old_string": "old content",
        "new_string": "new content",
        "content": "replacement content"
    });
    let args = ToolArguments::from_raw(ToolKind::Edit, raw);
    match args {
        ToolArguments::Edit { edits } => {
            let e = edits.first().expect("edit entry");
            assert_eq!(e.file_path, Some("/tmp/file.txt".to_string()));
            assert_eq!(e.old_string, Some("old content".to_string()));
            assert_eq!(e.new_string, Some("new content".to_string()));
            assert_eq!(e.content, Some("replacement content".to_string()));
        }
        _ => panic!("Expected Edit variant"),
    }
}

#[test]
fn test_tool_arguments_execute() {
    let raw = json!({"command": "ls -la"});
    let args = ToolArguments::from_raw(ToolKind::Execute, raw);
    match args {
        ToolArguments::Execute { command } => {
            assert_eq!(command, Some("ls -la".to_string()));
        }
        _ => panic!("Expected Execute variant"),
    }

    let raw = json!({"cmd": "pwd"});
    let args = ToolArguments::from_raw(ToolKind::Execute, raw);
    match args {
        ToolArguments::Execute { command } => {
            assert_eq!(command, Some("pwd".to_string()));
        }
        _ => panic!("Expected Execute variant"),
    }
}

#[test]
fn test_tool_arguments_search() {
    let raw = json!({
        "query": "search term",
        "file_path": "/tmp/test.txt"
    });
    let args = ToolArguments::from_raw(ToolKind::Search, raw);
    match args {
        ToolArguments::Search { query, file_path } => {
            assert_eq!(query, Some("search term".to_string()));
            assert_eq!(file_path, Some("/tmp/test.txt".to_string()));
        }
        _ => panic!("Expected Search variant"),
    }

    let raw = json!({"pattern": "grep pattern"});
    let args = ToolArguments::from_raw(ToolKind::Search, raw);
    match args {
        ToolArguments::Search { query, file_path } => {
            assert_eq!(query, Some("grep pattern".to_string()));
            assert!(file_path.is_none());
        }
        _ => panic!("Expected Search variant"),
    }
}

#[test]
fn test_tool_arguments_fetch() {
    let raw = json!({"url": "https://example.com"});
    let args = ToolArguments::from_raw(ToolKind::Fetch, raw);
    match args {
        ToolArguments::Fetch { url } => {
            assert_eq!(url, Some("https://example.com".to_string()));
        }
        _ => panic!("Expected Fetch variant"),
    }
}

#[test]
fn test_tool_arguments_think_generic() {
    let raw = json!({"description": "This is a generic think tool"});
    let args = ToolArguments::from_raw(ToolKind::Think, raw);
    match args {
        ToolArguments::Think {
            description,
            prompt,
            subagent_type,
            skill,
            skill_args,
            raw: raw_data,
        } => {
            assert_eq!(
                description,
                Some("This is a generic think tool".to_string())
            );
            assert!(prompt.is_none());
            assert!(subagent_type.is_none());
            assert!(skill.is_none());
            assert!(skill_args.is_none());
            assert!(raw_data.is_some());
        }
        _ => panic!("Expected Think variant"),
    }
}

#[test]
fn test_tool_arguments_think_with_subagent() {
    let raw = json!({
        "subagent_type": "assistant",
        "description": "Help with coding",
        "prompt": "Fix this bug"
    });
    let args = ToolArguments::from_raw(ToolKind::Think, raw);
    match args {
        ToolArguments::Think {
            description,
            prompt,
            subagent_type,
            skill,
            skill_args,
            raw: raw_data,
        } => {
            assert_eq!(description, Some("Help with coding".to_string()));
            assert_eq!(prompt, Some("Fix this bug".to_string()));
            assert_eq!(subagent_type, Some("assistant".to_string()));
            assert!(skill.is_none());
            assert!(skill_args.is_none());
            assert!(raw_data.is_some());
        }
        _ => panic!("Expected Think variant"),
    }
}

#[test]
fn test_tool_arguments_think_with_skill() {
    let raw = json!({
        "skill": "brainstorming",
        "args": "some arguments"
    });
    let args = ToolArguments::from_raw(ToolKind::Think, raw);
    match args {
        ToolArguments::Think {
            description,
            prompt,
            subagent_type,
            skill,
            skill_args,
            raw: raw_data,
        } => {
            assert!(description.is_none());
            assert!(prompt.is_none());
            assert!(subagent_type.is_none());
            assert_eq!(skill, Some("brainstorming".to_string()));
            assert_eq!(skill_args, Some("some arguments".to_string()));
            assert!(raw_data.is_some());
        }
        _ => panic!("Expected Think variant"),
    }
}

#[test]
fn test_tool_arguments_move() {
    let raw = json!({
        "from": "/tmp/old.txt",
        "to": "/tmp/new.txt"
    });
    let args = ToolArguments::from_raw(ToolKind::Move, raw);
    match args {
        ToolArguments::Move { from, to } => {
            assert_eq!(from, Some("/tmp/old.txt".to_string()));
            assert_eq!(to, Some("/tmp/new.txt".to_string()));
        }
        _ => panic!("Expected Move variant"),
    }

    let raw = json!({
        "source": "/tmp/src.txt",
        "destination": "/tmp/dst.txt"
    });
    let args = ToolArguments::from_raw(ToolKind::Move, raw);
    match args {
        ToolArguments::Move { from, to } => {
            assert_eq!(from, Some("/tmp/src.txt".to_string()));
            assert_eq!(to, Some("/tmp/dst.txt".to_string()));
        }
        _ => panic!("Expected Move variant"),
    }
}

#[test]
fn test_tool_arguments_delete() {
    let raw = json!({"file_path": "/tmp/delete.txt"});
    let args = ToolArguments::from_raw(ToolKind::Delete, raw);
    match args {
        ToolArguments::Delete {
            file_path,
            file_paths,
        } => {
            assert_eq!(file_path, Some("/tmp/delete.txt".to_string()));
            assert!(file_paths.is_none());
        }
        _ => panic!("Expected Delete variant"),
    }
}

#[test]
fn test_tool_arguments_enter_plan_mode() {
    let raw = json!({"mode": "code"});
    let args = ToolArguments::from_raw(ToolKind::EnterPlanMode, raw);
    match args {
        ToolArguments::PlanMode { mode } => {
            assert_eq!(mode, Some("code".to_string()));
        }
        _ => panic!("Expected PlanMode variant"),
    }
}

#[test]
fn test_tool_arguments_exit_plan_mode() {
    let raw = json!({"modeId": "write"});
    let args = ToolArguments::from_raw(ToolKind::ExitPlanMode, raw);
    match args {
        ToolArguments::PlanMode { mode } => {
            assert_eq!(mode, Some("write".to_string()));
        }
        _ => panic!("Expected PlanMode variant"),
    }
}

#[test]
fn test_tool_arguments_other() {
    let raw = json!({"custom_field": "custom_value"});
    let args = ToolArguments::from_raw(ToolKind::Other, raw.clone());
    match args {
        ToolArguments::Other { raw: raw_data } => {
            assert_eq!(raw_data, raw);
        }
        _ => panic!("Expected Other variant"),
    }
}

#[test]
fn test_tool_call_data_deserialize_with_nested_todos() {
    // This simulates the format when loading stored session data
    // Todos are nested inside arguments.raw.todos
    let json = json!({
        "id": "toolu_015iUjJsFGKqH15doqZ3675Z",
        "name": "TodoWrite",
        "arguments": {
            "kind": "think",
            "raw": {
                "todos": [
                    {
                        "content": "Run tests",
                        "activeForm": "Running tests",
                        "status": "in_progress"
                    },
                    {
                        "content": "Fix bugs",
                        "activeForm": "Fixing bugs",
                        "status": "pending"
                    }
                ]
            }
        },
        "status": "completed",
        "kind": "think"
    });

    let tool_call: ToolCallData = with_agent(AgentType::ClaudeCode, || serde_json::from_value(json))
        .unwrap();

    // Verify basic fields
    assert_eq!(tool_call.id, "toolu_015iUjJsFGKqH15doqZ3675Z");
    assert_eq!(tool_call.name, "TodoWrite");

    // Verify normalizedTodos was populated by the deserializer
    let todos = tool_call
        .normalized_todos
        .expect("normalizedTodos should be populated");
    assert_eq!(todos.len(), 2);

    assert_eq!(todos[0].content, "Run tests");
    assert_eq!(todos[0].active_form, "Running tests");
    assert!(matches!(todos[0].status, TodoStatus::InProgress));

    assert_eq!(todos[1].content, "Fix bugs");
    assert_eq!(todos[1].active_form, "Fixing bugs");
    assert!(matches!(todos[1].status, TodoStatus::Pending));
}

#[test]
fn test_tool_call_data_deserialize_with_root_level_todos() {
    // This simulates the format from live ACP updates
    // Todos are at the root level of arguments
    let json = json!({
        "id": "tool-123",
        "name": "TodoWrite",
        "arguments": {
            "todos": [
                {
                    "content": "Task 1",
                    "activeForm": "Working on Task 1",
                    "status": "completed"
                }
            ]
        },
        "status": "completed",
        "kind": "think"
    });

    let tool_call: ToolCallData = with_agent(AgentType::ClaudeCode, || serde_json::from_value(json))
        .unwrap();

    let todos = tool_call
        .normalized_todos
        .expect("normalizedTodos should be populated");
    assert_eq!(todos.len(), 1);
    assert_eq!(todos[0].content, "Task 1");
    assert!(matches!(todos[0].status, TodoStatus::Completed));
}
