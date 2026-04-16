use super::conversion::convert_message_part_delta_to_session_update;
use super::*;
use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolCallStatus, ToolKind, TurnErrorData, TurnErrorKind,
    TurnErrorSource,
};
use crate::acp::types::ContentBlock;
use serde_json::json;
use serde_json::Value;
use std::sync::{LazyLock, Mutex};

static CACHE_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn reset_caches() -> std::sync::MutexGuard<'static, ()> {
    let guard = CACHE_TEST_LOCK.lock().unwrap();
    clear_message_role_cache();
    clear_message_part_text_cache();
    guard
}

/// Test that session.status event is routed correctly
#[test]
fn test_session_status_event_routing() {
    let event = EventEnvelope {
        event_type: "session.status".to_string(),
        properties: json!({
            "sessionID": "ses_test",
            "status": {"state": "busy"}
        }),
    };

    assert_eq!(event.event_type, "session.status");
    assert!(event.properties.get("sessionID").is_some());
    assert!(event.properties.get("status").is_some());
}

/// Test that session.error event is routed correctly
#[test]
fn test_session_error_event_routing() {
    let event = EventEnvelope {
        event_type: "session.error".to_string(),
        properties: json!({
            "sessionID": "ses_test",
            "error": {"message": "Something went wrong"}
        }),
    };

    assert_eq!(event.event_type, "session.error");
    assert!(event.properties.get("sessionID").is_some());
}

/// Test that session.deleted event is routed correctly
#[test]
fn test_session_deleted_event_routing() {
    let event = EventEnvelope {
        event_type: "session.deleted".to_string(),
        properties: json!({
            "sessionID": "ses_test",
            "info": {"id": "ses_test"}
        }),
    };

    assert_eq!(event.event_type, "session.deleted");
}

/// Test that message.removed event is routed correctly
#[test]
fn test_message_removed_event_routing() {
    let event = EventEnvelope {
        event_type: "message.removed".to_string(),
        properties: json!({
            "sessionID": "ses_test",
            "messageID": "msg_123"
        }),
    };

    assert_eq!(event.event_type, "message.removed");
}

/// Test that message.part.removed event is routed correctly
#[test]
fn test_message_part_removed_event_routing() {
    let event = EventEnvelope {
        event_type: "message.part.removed".to_string(),
        properties: json!({
            "sessionID": "ses_test",
            "messageID": "msg_123",
            "partID": "prt_456"
        }),
    };

    assert_eq!(event.event_type, "message.part.removed");
}

/// Test that question.rejected event is routed correctly
#[test]
fn test_question_rejected_event_routing() {
    let event = EventEnvelope {
        event_type: "question.rejected".to_string(),
        properties: json!({
            "sessionID": "ses_test",
            "requestID": "req_123"
        }),
    };

    assert_eq!(event.event_type, "question.rejected");
}

/// Test that todo.updated event is routed correctly
#[test]
fn test_todo_updated_event_routing() {
    let event = EventEnvelope {
        event_type: "todo.updated".to_string(),
        properties: json!({
            "sessionID": "ses_test",
            "todos": [
                {"id": "todo_1", "content": "Test task", "status": "pending"}
            ]
        }),
    };

    assert_eq!(event.event_type, "todo.updated");
    assert!(event.properties.get("todos").is_some());
}

/// Test that informational events have correct types
#[test]
fn test_informational_events() {
    let events = vec![
        "server.connected",
        "server.heartbeat",
        "file.watcher.updated",
    ];

    for event_type in events {
        let event = EventEnvelope {
            event_type: event_type.to_string(),
            properties: json!({}),
        };
        assert_eq!(event.event_type, event_type);
    }
}

/// Test event envelope parsing
#[test]
fn test_event_envelope_parsing() {
    let json = r#"{"type": "message.updated", "properties": {"sessionID": "test"}}"#;
    let event: EventEnvelope = serde_json::from_str(json).unwrap();
    assert_eq!(event.event_type, "message.updated");
    assert_eq!(event.properties.get("sessionID").unwrap(), "test");
}

/// Test multiplexed event envelope parsing
#[test]
fn test_multiplexed_event_envelope_parsing() {
    let json = r#"{"directory": "/test", "payload": {"type": "message.updated", "properties": {"sessionID": "test"}}}"#;
    let event: MultiplexedEventEnvelope = serde_json::from_str(json).unwrap();
    assert_eq!(event.directory, Some("/test".to_string()));
    assert_eq!(event.payload.event_type, "message.updated");
}

/// Test that session.status is included in session update events
#[test]
fn test_session_status_in_session_updates() {
    // session.status should be handled alongside session.updated, session.idle, etc.
    let status_event = EventEnvelope {
        event_type: "session.status".to_string(),
        properties: json!({
            "sessionID": "ses_test",
            "status": {"state": "idle"}
        }),
    };

    // These events should all emit "acp-session-update"
    let session_update_events = [
        "session.updated",
        "session.idle",
        "session.status",
        "message.updated",
        "message.part.delta",
        "message.part.updated",
    ];

    assert!(session_update_events.contains(&status_event.event_type.as_str()));
}

/// Test conversion of message.part.updated with text part to AgentMessageChunk
#[test]
fn test_convert_text_part_to_agent_message_chunk() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Hello, how can I help?"
        },
        "delta": "Hello"
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            session_id,
        } => {
            assert_eq!(part_id, None);
            assert_eq!(message_id, Some("msg_456".to_string()));
            assert_eq!(session_id, Some("ses_abc".to_string()));
            match chunk.content {
                ContentBlock::Text { text } => assert_eq!(text, "Hello"), // delta is used when present
                _ => panic!("Expected Text block"),
            }
        }
        _ => panic!("Expected AgentMessageChunk"),
    }
}

/// Test conversion of message.part.updated with reasoning part to AgentThoughtChunk
#[test]
fn test_convert_reasoning_part_to_agent_thought_chunk() {
    let properties = json!({
        "part": {
            "id": "prt_reason",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "reasoning",
            "text": "Let me analyze this problem..."
        },
        "delta": "Let me analyze"
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::AgentThoughtChunk {
            chunk,
            part_id,
            message_id,
            session_id,
        } => {
            assert_eq!(part_id, None);
            assert_eq!(message_id, Some("msg_456".to_string()));
            assert_eq!(session_id, Some("ses_abc".to_string()));
            match chunk.content {
                ContentBlock::Text { text } => assert_eq!(text, "Let me analyze"), // delta is used when present
                _ => panic!("Expected Text block"),
            }
        }
        _ => panic!("Expected AgentThoughtChunk"),
    }
}

/// Test conversion falls back to part.text when delta is not present
#[test]
fn test_convert_text_part_falls_back_to_text_when_no_delta() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Complete message"
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            session_id,
        } => {
            assert_eq!(part_id, None);
            assert_eq!(message_id, Some("msg_456".to_string()));
            assert_eq!(session_id, Some("ses_abc".to_string()));
            match chunk.content {
                ContentBlock::Text { text } => assert_eq!(text, "Complete message"), // falls back to text
                _ => panic!("Expected Text block"),
            }
        }
        _ => panic!("Expected AgentMessageChunk"),
    }
}

/// Test conversion of message.part.updated with tool invocation to ToolCall
#[test]
fn test_convert_tool_invocation_to_tool_call() {
    let properties = json!({
        "part": {
            "id": "call_func_1",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool-invocation",
            "name": "bash",
            "arguments": {
                "command": "ls -la",
                "description": "List files"
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => {
            assert_eq!(tool_call.id, "call_func_1");
            assert_eq!(tool_call.name, "bash");
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected ToolCall"),
    }
}

/// Test conversion of message.part.updated with tool result to ToolCallUpdate
#[test]
fn test_convert_tool_result_to_tool_call_update() {
    let properties = json!({
        "part": {
            "id": "call_func_1",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool-result",
            "state": {
                "status": "completed",
                "output": "file1.txt file2.txt"
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCallUpdate { update, session_id } => {
            assert_eq!(update.tool_call_id, "call_func_1");
            assert!(matches!(update.status, Some(ToolCallStatus::Completed)));
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected ToolCallUpdate"),
    }
}

/// Test that message.part.updated with reason: "stop" (completion event) returns None
#[test]
fn test_convert_completion_event_returns_none() {
    let properties = json!({
        "part": {
            "id": "prt_completion",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "reason": "stop",
            "cost": 0.0041877
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_none());
}

/// Test that message.part.updated without type field falls back to empty string
#[test]
fn test_convert_part_without_type_returns_none() {
    let properties = json!({
        "part": {
            "id": "prt_no_type",
            "sessionID": "ses_abc",
            "messageID": "msg_456"
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_none());
}

/// Test that message.part.updated with user role returns None
#[test]
fn test_convert_user_role_returns_none() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Hello from user"
        },
        "info": {
            "role": "user"
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_none(), "User role messages should return None");
}

/// Test that message.part.updated with user role at top level returns None
#[test]
fn test_convert_user_role_at_top_level_returns_none() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Hello from user"
        },
        "role": "user"
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(
        result.is_none(),
        "User role at top level should return None"
    );
}

/// Test that message.part.updated with user role on part returns None
#[test]
fn test_convert_user_role_on_part_returns_none() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Hello from user",
            "role": "user"
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_none(), "User role on part should be filtered");
}

/// Test conversion of session.status with idle state to TurnComplete
#[test]
fn test_convert_session_status_idle_to_turn_complete() {
    let properties = json!({
        "sessionID": "ses_abc",
        "status": {
            "state": "idle"
        }
    });

    let result = convert_session_status_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::TurnComplete { session_id, .. } => {
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected TurnComplete"),
    }
}

/// Test conversion of session.status with idle type to TurnComplete
#[test]
fn test_convert_session_status_idle_type_to_turn_complete() {
    let properties = json!({
        "sessionID": "ses_abc",
        "status": {
            "type": "idle"
        }
    });

    let result = convert_session_status_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::TurnComplete { session_id, .. } => {
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected TurnComplete"),
    }
}

/// Test that session.status with busy state returns None
#[test]
fn test_convert_session_status_busy_returns_none() {
    let properties = json!({
        "sessionID": "ses_abc",
        "status": {
            "state": "busy"
        }
    });

    let result = convert_session_status_to_session_update(&properties);
    assert!(result.is_none());
}

/// Test conversion of session.idle event to TurnComplete
#[test]
fn test_convert_session_idle_to_turn_complete() {
    let properties = json!({
        "sessionID": "ses_abc"
    });

    let result = convert_session_idle_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::TurnComplete { session_id, .. } => {
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected TurnComplete"),
    }
}

/// Test conversion of session.idle with camelCase sessionId to TurnComplete
#[test]
fn test_convert_session_idle_with_session_id_to_turn_complete() {
    let properties = json!({
        "sessionId": "ses_abc"
    });

    let result = convert_session_idle_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::TurnComplete { session_id, .. } => {
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected TurnComplete"),
    }
}

/// Test conversion of session.error with nested data message to TurnError
#[test]
fn test_convert_session_error_with_nested_message_to_turn_error() {
    let properties = json!({
        "sessionID": "ses_abc",
        "error": {
            "name": "UnknownError",
            "data": {
                "message": "Model not found: moonshotai/kimi-k2.5."
            }
        }
    });

    let result = convert_session_error_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::TurnError { error, session_id, .. } => {
            assert_eq!(session_id, Some("ses_abc".to_string()));
            match error {
                TurnErrorData::Structured(info) => {
                    assert_eq!(info.message, "Model not found: moonshotai/kimi-k2.5.");
                    assert_eq!(info.kind, TurnErrorKind::Recoverable);
                    assert_eq!(info.source, Some(TurnErrorSource::Process));
                }
                TurnErrorData::Legacy(_) => panic!("Expected structured turn error"),
            }
        }
        _ => panic!("Expected TurnError"),
    }
}

/// Test conversion of session.error without error message to fallback TurnError
#[test]
fn test_convert_session_error_without_message_uses_fallback() {
    let properties = json!({
        "sessionID": "ses_abc",
        "error": {
            "name": "UnknownError"
        }
    });

    let result = convert_session_error_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::TurnError { error, session_id, .. } => {
            assert_eq!(session_id, Some("ses_abc".to_string()));
            match error {
                TurnErrorData::Structured(info) => {
                    assert_eq!(info.message, "OpenCode session failed");
                }
                TurnErrorData::Legacy(_) => panic!("Expected structured turn error"),
            }
        }
        _ => panic!("Expected TurnError"),
    }
}

/// Test conversion of question.asked to QuestionRequest
#[test]
fn test_convert_question_asked_to_question_request() {
    let properties = json!({
        "id": "ques_123",
        "sessionID": "ses_abc",
        "questions": [
            {
                "question": "What should I do?",
                "header": "Choose an option",
                "options": [
                    {"label": "Option A", "description": "Do A"},
                    {"label": "Option B", "description": "Do B"}
                ],
                "multiSelect": false
            }
        ]
    });

    let result = convert_question_asked_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::QuestionRequest {
            question,
            session_id,
        } => {
            assert_eq!(question.id, "ques_123");
            assert_eq!(question.session_id, "ses_abc");
            assert_eq!(question.questions.len(), 1);
            assert_eq!(question.questions[0].question, "What should I do?");
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected QuestionRequest"),
    }
}

/// Test conversion of permission.asked to PermissionRequest
#[test]
fn test_convert_permission_asked_to_permission_request() {
    let properties = json!({
        "id": "perm_123",
        "sessionID": "ses_abc",
        "permission": "Read",
        "patterns": ["*.txt", "*.md"],
        "metadata": {},
        "always": []
    });

    let result = convert_permission_asked_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::PermissionRequest {
            permission,
            session_id,
        } => {
            assert_eq!(permission.id, "perm_123");
            assert_eq!(permission.session_id, "ses_abc");
            assert_eq!(permission.permission, "Read");
            assert_eq!(permission.patterns, vec!["*.txt", "*.md"]);
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected PermissionRequest"),
    }
}

/// Test tool kind detection using OpenCodeParser
#[test]
fn test_detect_tool_kind() {
    use crate::acp::parsers::{AgentParser, OpenCodeParser};
    assert_eq!(OpenCodeParser.detect_tool_kind("bash"), ToolKind::Execute);
    assert_eq!(OpenCodeParser.detect_tool_kind("ReadFile"), ToolKind::Read);
    assert_eq!(OpenCodeParser.detect_tool_kind("EditFile"), ToolKind::Edit);
    assert_eq!(
        OpenCodeParser.detect_tool_kind("apply_patch"),
        ToolKind::Edit
    );
    assert_eq!(
        OpenCodeParser.detect_tool_kind("find_files"),
        ToolKind::Glob
    );
    assert_eq!(
        OpenCodeParser.detect_tool_kind("http_fetch"),
        ToolKind::Fetch
    );
    assert_eq!(OpenCodeParser.detect_tool_kind("think"), ToolKind::Task);
    assert_eq!(
        OpenCodeParser.detect_tool_kind("UnknownTool"),
        ToolKind::Other
    );
}

/// Test conversion of tool part using OpenCode's actual format (tool field, callID, state.input)
#[test]
fn test_convert_tool_part_with_opencode_format() {
    let properties = json!({
        "part": {
            "id": "prt_abc123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_webfetch_1",
            "tool": "webfetch",
            "state": {
                "status": "pending",
                "input": {
                    "url": "https://example.com",
                    "format": "markdown"
                }
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => {
            assert_eq!(tool_call.id, "call_webfetch_1");
            assert_eq!(tool_call.name, "webfetch");
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected ToolCall"),
    }
}

#[test]
fn test_convert_apply_patch_tool_part_to_edit_tool_call() {
    let properties = json!({
        "part": {
            "id": "prt_apply_patch_1",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_apply_patch_1",
            "tool": "apply_patch",
            "state": {
                "status": "pending",
                "input": {
                    "patch_text": "*** Begin Patch\n*** Update File: CLAUDE.md\n@@\n-Look at AGENTS.md\n+Read `AGENTS.md` first and follow its project-specific rules.\n*** End Patch"
                }
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => {
            assert_eq!(tool_call.id, "call_apply_patch_1");
            assert_eq!(tool_call.name, "apply_patch");
            assert_eq!(tool_call.kind, Some(ToolKind::Edit));
            assert_eq!(session_id, Some("ses_abc".to_string()));

            match tool_call.arguments {
                ToolArguments::Edit { edits } => {
                    assert_eq!(edits.len(), 1);
                    assert_eq!(edits[0].file_path.as_deref(), Some("CLAUDE.md"));
                }
                other => panic!("Expected Edit arguments, got {other:?}"),
            }
        }
        _ => panic!("Expected ToolCall"),
    }
}

#[test]
fn test_convert_apply_patch_tool_part_to_edit_tool_call_with_patch_text_camel_case() {
    let properties = json!({
        "part": {
            "id": "prt_apply_patch_2",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_apply_patch_2",
            "tool": "apply_patch",
            "state": {
                "status": "running",
                "input": {
                    "patchText": "*** Begin Patch\n*** Add File: link.txt\n+https://example.com\n*** End Patch"
                }
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall { tool_call, .. } => match tool_call.arguments {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(edits[0].file_path.as_deref(), Some("link.txt"));
            }
            other => panic!("Expected Edit arguments, got {other:?}"),
        },
        _ => panic!("Expected ToolCall"),
    }
}

#[test]
fn test_convert_tool_part_webfetch_search_url_maps_to_web_search() {
    let properties = json!({
        "part": {
            "id": "prt_search_1",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_webfetch_search_1",
            "tool": "webfetch",
            "state": {
                "status": "pending",
                "input": {
                    "url": "https://github.com/search?q=CLAUDE.md+boris&type=code",
                    "format": "markdown"
                }
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall { tool_call, .. } => {
            assert_eq!(tool_call.kind, Some(ToolKind::WebSearch));
            match tool_call.arguments {
                crate::acp::session_update::ToolArguments::WebSearch { query } => {
                    assert_eq!(query, Some("CLAUDE.md boris".to_string()));
                }
                _ => panic!("Expected web search arguments"),
            }
        }
        _ => panic!("Expected ToolCall"),
    }
}

#[test]
fn test_convert_tool_part_task_maps_to_think() {
    let _guard = reset_caches();
    let properties = json!({
        "part": {
            "id": "prt_task_1",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_task_1",
            "tool": "task",
            "state": {
                "status": "running",
                "input": {
                    "description": "Investigate bug",
                    "prompt": "Check the logs",
                    "subagent_type": "research"
                }
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => {
            assert_eq!(tool_call.id, "call_task_1");
            assert_eq!(tool_call.name, "task");
            assert_eq!(tool_call.kind, Some(ToolKind::Task));
            assert_eq!(session_id, Some("ses_abc".to_string()));

            match tool_call.arguments {
                ToolArguments::Think {
                    description,
                    prompt,
                    subagent_type,
                    ..
                } => {
                    assert_eq!(description, Some("Investigate bug".to_string()));
                    assert_eq!(prompt, Some("Check the logs".to_string()));
                    assert_eq!(subagent_type, Some("research".to_string()));
                }
                _ => panic!("Expected Think arguments"),
            }
        }
        _ => panic!("Expected ToolCall"),
    }
}

#[test]
fn test_task_metadata_summary_builds_children() {
    let properties = json!({
        "part": {
            "id": "prt_task_1",
            "sessionID": "ses_1",
            "messageID": "msg_1",
            "type": "tool",
            "callID": "call_task_1",
            "tool": "task",
            "state": {
                "status": "running",
                "input": {
                    "description": "Do work",
                    "subagent_type": "research"
                },
                "metadata": {
                    "summary": [
                        { "tool": "Read", "state": { "status": "completed", "title": "Read src/main.ts" } },
                        { "tool": "Edit", "state": { "status": "running", "title": "Edit src/main.ts" } }
                    ]
                }
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall { tool_call, .. } => {
            let children = tool_call.task_children.expect("children");
            assert_eq!(children.len(), 2);
            assert_eq!(children[0].name, "Read");
            assert_eq!(children[1].name, "Edit");
        }
        _ => panic!("Expected ToolCall"),
    }
}

/// Test conversion of tool result using callID for matching
#[test]
fn test_convert_tool_result_with_call_id() {
    let properties = json!({
        "part": {
            "id": "prt_result_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool-result",
            "callID": "call_webfetch_1",
            "state": {
                "status": "completed",
                "output": "# Fetched content\nHello world"
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCallUpdate { update, session_id } => {
            assert_eq!(update.tool_call_id, "call_webfetch_1");
            assert!(matches!(update.status, Some(ToolCallStatus::Completed)));
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected ToolCallUpdate"),
    }
}

/// Test backwards compatibility with legacy format using 'name' field
#[test]
fn test_convert_tool_part_legacy_name_field() {
    let properties = json!({
        "part": {
            "id": "call_func_1",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool-invocation",
            "name": "bash",
            "arguments": {
                "command": "ls -la"
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => {
            assert_eq!(tool_call.id, "call_func_1");
            assert_eq!(tool_call.name, "bash");
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected ToolCall"),
    }
}

/// Test that 'tool' field takes precedence over 'name' field
#[test]
fn test_tool_field_takes_precedence_over_name() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_123",
            "tool": "webfetch",
            "name": "old_name",
            "state": {
                "status": "pending",
                "input": {}
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall { tool_call, .. } => {
            assert_eq!(tool_call.name, "webfetch");
        }
        _ => panic!("Expected ToolCall"),
    }
}

/// Test that state.input takes precedence over top-level input
#[test]
fn test_state_input_takes_precedence() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_123",
            "tool": "read",
            "input": {
                "filePath": "/old/path"
            },
            "state": {
                "status": "pending",
                "input": {
                    "filePath": "/correct/path"
                }
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall { tool_call, .. } => match &tool_call.arguments {
            crate::acp::session_update::ToolArguments::Read { file_path } => {
                assert_eq!(file_path.as_deref(), Some("/correct/path"));
            }
            _ => panic!("Expected Read arguments"),
        },
        _ => panic!("Expected ToolCall"),
    }
}

/// Test tool completion via state.status = "completed"
#[test]
fn test_tool_completion_via_state_status() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_webfetch_1",
            "tool": "webfetch",
            "state": {
                "status": "completed",
                "input": {
                    "url": "https://example.com"
                },
                "output": "# Example Page\nContent here"
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCallUpdate { update, session_id } => {
            assert_eq!(update.tool_call_id, "call_webfetch_1");
            assert!(matches!(update.status, Some(ToolCallStatus::Completed)));
            assert_eq!(
                update.result,
                Some(Value::String("# Example Page\nContent here".to_string()))
            );
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected ToolCallUpdate"),
    }
}

/// Test tool error via state.status = "error"
#[test]
fn test_tool_error_via_state_status() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_webfetch_1",
            "tool": "webfetch",
            "state": {
                "status": "error",
                "input": {
                    "url": "https://invalid-url.example"
                },
                "error": "Connection timeout: Failed to resolve hostname"
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCallUpdate { update, session_id } => {
            assert_eq!(update.tool_call_id, "call_webfetch_1");
            assert!(matches!(update.status, Some(ToolCallStatus::Failed)));
            assert_eq!(
                update.result,
                Some(Value::String(
                    "Connection timeout: Failed to resolve hostname".to_string()
                ))
            );
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected ToolCallUpdate"),
    }
}

/// Test tool running state still creates ToolCall
#[test]
fn test_tool_running_state_creates_tool_call() {
    let properties = json!({
        "part": {
            "id": "prt_123",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "tool",
            "callID": "call_bash_1",
            "tool": "bash",
            "state": {
                "status": "running",
                "input": {
                    "command": "npm install"
                }
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } => {
            assert_eq!(tool_call.id, "call_bash_1");
            assert_eq!(tool_call.name, "bash");
            assert_eq!(session_id, Some("ses_abc".to_string()));
        }
        _ => panic!("Expected ToolCall"),
    }
}

/// Test that message.updated caches role for filtering user message parts
#[test]
fn test_message_updated_role_cache_filters_user_part() {
    let _guard = reset_caches();

    let message_updated = json!({
        "info": {
            "id": "msg_user_1",
            "role": "user"
        }
    });

    cache_message_role_from_update(&message_updated);

    let properties = json!({
        "part": {
            "id": "prt_user_1",
            "sessionID": "ses_abc",
            "messageID": "msg_user_1",
            "type": "text",
            "text": "Hi"
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(
        result.is_none(),
        "User message parts should be filtered when role is cached"
    );
}

/// Test that full text updates after deltas do not re-emit duplicate content
#[test]
fn test_streaming_dedupes_full_text_after_deltas() {
    let _guard = reset_caches();

    let first = json!({
        "part": {
            "id": "prt_stream",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Hello"
        },
        "delta": "Hello"
    });

    let second = json!({
        "part": {
            "id": "prt_stream",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Hello"
        }
    });

    let first_result = convert_message_part_to_session_update(&first);
    assert!(first_result.is_some());

    let second_result = convert_message_part_to_session_update(&second);
    assert!(
        second_result.is_none(),
        "Duplicate full text should be suppressed"
    );
}

/// Test that full text updates emit only the suffix after prior deltas
#[test]
fn test_streaming_emits_suffix_when_full_text_extends_cache() {
    let _guard = reset_caches();

    let first = json!({
        "part": {
            "id": "prt_stream_suffix",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Hello"
        },
        "delta": "Hello"
    });

    let second = json!({
        "part": {
            "id": "prt_stream_suffix",
            "sessionID": "ses_abc",
            "messageID": "msg_456",
            "type": "text",
            "text": "Hello world"
        }
    });

    let _ = convert_message_part_to_session_update(&first);
    let second_result = convert_message_part_to_session_update(&second);
    assert!(second_result.is_some());

    match second_result.unwrap() {
        SessionUpdate::AgentMessageChunk { chunk, .. } => match chunk.content {
            ContentBlock::Text { text } => assert_eq!(text, " world"),
            _ => panic!("Expected Text block"),
        },
        _ => panic!("Expected AgentMessageChunk"),
    }
}

/// Test that text continues streaming when OpenCode changes part IDs mid-message.
#[test]
fn test_streaming_survives_part_id_rotation_with_same_message() {
    let _guard = reset_caches();

    let first = json!({
        "part": {
            "id": "prt_stream_a",
            "sessionID": "ses_abc",
            "messageID": "msg_rotate_1",
            "type": "text",
            "text": "Planning moves"
        },
        "delta": "Planning moves"
    });

    let second = json!({
        "part": {
            "id": "prt_stream_b",
            "sessionID": "ses_abc",
            "messageID": "msg_rotate_1",
            "type": "text",
            "text": "Planning moves\n\nHere is the actual answer."
        }
    });

    let first_result = convert_message_part_to_session_update(&first);
    assert!(first_result.is_some());

    let second_result = convert_message_part_to_session_update(&second);
    assert!(second_result.is_some());

    match second_result.unwrap() {
        SessionUpdate::AgentMessageChunk { chunk, .. } => match chunk.content {
            ContentBlock::Text { text } => {
                assert_eq!(text, "\n\nHere is the actual answer.");
            }
            _ => panic!("Expected Text block"),
        },
        _ => panic!("Expected AgentMessageChunk"),
    }
}

#[test]
fn test_message_part_delta_streams_reasoning_from_cached_part_type() {
    let _guard = reset_caches();

    let updated = json!({
        "part": {
            "id": "prt_reason_delta",
            "sessionID": "ses_abc",
            "messageID": "msg_reason_delta",
            "type": "reasoning"
        }
    });

    let delta = json!({
        "partID": "prt_reason_delta",
        "messageID": "msg_reason_delta",
        "sessionID": "ses_abc",
        "field": "text",
        "delta": "Thinking"
    });

    let updated_result = convert_message_part_to_session_update(&updated);
    assert!(updated_result.is_none());

    let delta_result = convert_message_part_delta_to_session_update(&delta);
    assert!(delta_result.is_some());

    match delta_result.unwrap() {
        SessionUpdate::AgentThoughtChunk { chunk, .. } => match chunk.content {
            ContentBlock::Text { text } => assert_eq!(text, "Thinking"),
            _ => panic!("Expected Text block"),
        },
        _ => panic!("Expected AgentThoughtChunk"),
    }
}

#[test]
fn test_message_part_delta_streams_text_chunks_directly() {
    let _guard = reset_caches();

    let updated = json!({
        "part": {
            "id": "prt_text_delta",
            "sessionID": "ses_abc",
            "messageID": "msg_text_delta",
            "type": "text"
        }
    });

    let delta = json!({
        "partID": "prt_text_delta",
        "messageID": "msg_text_delta",
        "sessionID": "ses_abc",
        "field": "text",
        "delta": "Hello"
    });

    let updated_result = convert_message_part_to_session_update(&updated);
    assert!(updated_result.is_none());

    let delta_result = convert_message_part_delta_to_session_update(&delta);
    assert!(delta_result.is_some());

    match delta_result.unwrap() {
        SessionUpdate::AgentMessageChunk { chunk, .. } => match chunk.content {
            ContentBlock::Text { text } => assert_eq!(text, "Hello"),
            _ => panic!("Expected Text block"),
        },
        _ => panic!("Expected AgentMessageChunk"),
    }
}

/// Test that step-finish emits UsageTelemetryUpdate with part.id as event_id
#[test]
fn test_step_finish_emits_usage_telemetry_update() {
    let properties = json!({
        "part": {
            "id": "prt_step_finish_1",
            "sessionID": "ses_telemetry",
            "messageID": "msg_789",
            "type": "step-finish",
            "cost": 0.0025,
            "tokens": {
                "total": 1500,
                "input": 1000,
                "output": 500,
                "cacheRead": 0,
                "cacheWrite": 0
            }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(
        result.is_some(),
        "step-finish should emit UsageTelemetryUpdate"
    );

    match result.unwrap() {
        SessionUpdate::UsageTelemetryUpdate { data } => {
            assert_eq!(data.session_id, "ses_telemetry");
            assert_eq!(data.event_id, Some("prt_step_finish_1".to_string()));
            assert_eq!(data.scope, "step");
            assert_eq!(data.cost_usd, Some(0.0025));
            assert_eq!(data.tokens.total, Some(1500));
            assert_eq!(data.tokens.input, Some(1000));
            assert_eq!(data.tokens.output, Some(500));
            assert_eq!(data.tokens.cache_read, Some(0));
            assert_eq!(data.tokens.cache_write, Some(0));
        }
        _ => panic!("Expected UsageTelemetryUpdate"),
    }
}

/// Test that step-finish without cost still emits telemetry with tokens
#[test]
fn test_step_finish_without_cost_emits_telemetry() {
    let properties = json!({
        "part": {
            "id": "prt_no_cost",
            "sessionID": "ses_abc",
            "messageID": "msg_1",
            "type": "step-finish",
            "tokens": { "total": 500 }
        }
    });

    let result = convert_message_part_to_session_update(&properties);
    assert!(result.is_some());

    match result.unwrap() {
        SessionUpdate::UsageTelemetryUpdate { data } => {
            assert_eq!(data.cost_usd, None);
            assert_eq!(data.tokens.total, Some(500));
        }
        _ => panic!("Expected UsageTelemetryUpdate"),
    }
}
