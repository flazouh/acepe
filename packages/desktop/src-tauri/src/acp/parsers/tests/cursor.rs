use super::*;
use crate::acp::session_update::{ToolCallStatus, ToolKind};

mod cursor_detect_update_type {
    use super::*;
    use serde_json::json;

    fn parser() -> CursorParser {
        CursorParser
    }

    #[test]
    fn detects_tool_use_by_type_field() {
        let data = json!({
            "type": "tool_use",
            "id": "tool-123",
            "name": "Read",
            "input": { "file_path": "/test.rs" }
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCall));
    }

    #[test]
    fn detects_tool_result_by_type_field() {
        let data = json!({
            "type": "tool_result",
            "tool_use_id": "tool-123",
            "content": "File contents here"
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCallUpdate));
    }

    #[test]
    fn detects_text_block_as_agent_message() {
        let data = json!({
            "type": "text",
            "text": "Hello, I can help."
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::AgentMessageChunk));
    }

    #[test]
    fn detects_thinking_block_as_agent_thought() {
        let data = json!({
            "type": "thinking",
            "thinking": "Let me analyze this..."
        });

        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::AgentThoughtChunk));
    }

    #[test]
    fn returns_error_for_unknown_type() {
        let data = json!({
            "type": "unknown",
            "data": "value"
        });

        let result = parser().detect_update_type(&data);
        assert!(result.is_err());
    }
}

mod cursor_parse_tool_call {
    use super::*;
    use serde_json::json;

    fn parser() -> CursorParser {
        CursorParser
    }

    #[test]
    fn extracts_id_name_and_input() {
        let data = json!({
            "type": "tool_use",
            "id": "tool-abc-123",
            "name": "Edit",
            "input": {
                "file_path": "/src/main.rs",
                "old_string": "foo",
                "new_string": "bar"
            }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool-abc-123");
        assert_eq!(result.name, "Edit");
        assert!(matches!(
            result.arguments,
            crate::acp::session_update::ToolArguments::Edit { .. }
        ));
        assert_eq!(result.status, ToolCallStatus::Pending);
    }

    #[test]
    fn fails_when_id_missing() {
        let data = json!({
            "type": "tool_use",
            "name": "Read"
        });

        let result = parser().parse_tool_call(&data);
        assert!(result.is_err());
    }

    #[test]
    fn fails_when_name_missing() {
        let data = json!({
            "type": "tool_use",
            "id": "tool-1"
        });

        let result = parser().parse_tool_call(&data);
        assert!(result.is_err());
    }

    #[test]
    fn supports_acp_shape_tool_call_payload() {
        let data = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tool_123",
            "kind": "read",
            "status": "pending",
            "title": "Read main.go",
            "rawInput": { "path": "/tmp/main.go" }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool_123");
        assert_eq!(result.name, "Read");
        assert_eq!(result.status, ToolCallStatus::Pending);
        assert_eq!(result.title.as_deref(), Some("Read main.go"));
    }

    #[test]
    fn extracts_tool_name_from_raw_input() {
        // Cursor sends _toolName inside rawInput for tools like createPlan
        let data = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tool_abc",
            "kind": "other",
            "status": "pending",
            "title": "Create Plan",
            "rawInput": { "_toolName": "createPlan" }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool_abc");
        // The parser preserves the provider's explicit tool name while normalizing kind.
        assert_eq!(result.name, "createPlan");
        assert_eq!(result.title.as_deref(), Some("Create Plan"));
        assert_eq!(result.kind, Some(ToolKind::CreatePlan));
    }

    #[test]
    fn maps_update_todos_to_todo_kind() {
        // Cursor sends _toolName "updateTodos" inside rawInput for todo management.
        // Previously this fell through to kind=other because the adapter didn't map it.
        let data = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tool_todo_1",
            "kind": "other",
            "status": "pending",
            "title": "Update TODOs: Add unit tests",
            "rawInput": {
                "_toolName": "updateTodos",
                "todos": [{"content": "Add unit tests", "id": "1", "status": "TODO_STATUS_IN_PROGRESS"}]
            }
        });

        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool_todo_1");
        assert_eq!(result.name, "updateTodos");
        assert_eq!(result.kind, Some(ToolKind::Todo));
    }
}

mod cursor_parse_tool_call_update {
    use super::*;
    use serde_json::json;

    fn parser() -> CursorParser {
        CursorParser
    }

    #[test]
    fn extracts_tool_result() {
        let data = json!({
            "type": "tool_result",
            "tool_use_id": "tool-123",
            "content": "File edited successfully"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.tool_call_id, "tool-123");
        assert_eq!(result.status, Some(ToolCallStatus::Completed));
        assert!(result.result.is_some());
    }

    #[test]
    fn fails_when_tool_use_id_missing() {
        let data = json!({
            "type": "tool_result",
            "content": "Data"
        });

        let result = parser().parse_tool_call_update(&data, None);
        assert!(result.is_err());
    }

    #[test]
    fn extracts_streaming_fields_from_meta_cursor_when_present() {
        let data = json!({
            "tool_use_id": "toolu_456",
            "content": "Result",
            "_meta": {
                "cursor": {
                    "streamingInputDelta": "{\"file_path\": \"/tmp",
                    "toolName": "Read"
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
    fn returns_none_for_streaming_when_meta_cursor_absent() {
        let data = json!({
            "tool_use_id": "tool-123",
            "content": "Data"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert!(result.streaming_input_delta.is_none());
    }

    #[test]
    fn supports_acp_shape_tool_call_update_payload() {
        let data = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tool_123",
            "status": "completed",
            "rawOutput": { "totalFiles": 8, "truncated": false }
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.tool_call_id, "tool_123");
        assert_eq!(result.status, Some(ToolCallStatus::Completed));
        assert!(result.result.is_some());
    }

    #[test]
    fn extracts_tool_name_from_raw_input_in_update() {
        let data = json!({
            "toolCallId": "tool_abc",
            "status": "completed",
            "rawInput": { "_toolName": "createPlan", "name": "My Plan" },
            "title": "Create Plan"
        });

        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.tool_call_id, "tool_abc");
        assert_eq!(result.title.as_deref(), Some("Create Plan"));
    }
}

// ===========================================
// Classification overlap: type vs toolCallId vs sessionUpdate
// ===========================================

mod cursor_detect_classification_overlap {
    use super::*;
    use serde_json::json;

    fn parser() -> CursorParser {
        CursorParser
    }

    /// #1: type absent, toolCallId absent, sessionUpdate absent → MissingField error.
    #[test]
    fn no_type_no_tool_call_id_no_session_update_fails() {
        let data = json!({ "title": "irrelevant" });
        let result = parser().detect_update_type(&data);
        assert!(result.is_err());
        assert!(matches!(result, Err(ParseError::MissingField(_))));
    }

    /// #2: type present, toolCallId absent, sessionUpdate absent → type drives result (ToolCall).
    #[test]
    fn type_only_no_tool_call_id_no_session_update_detects_tool_call() {
        let data = json!({
            "type": "tool_use",
            "id": "tool-1",
            "name": "Read",
            "input": {}
        });
        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCall));
    }

    /// #3: type absent, toolCallId present, sessionUpdate absent → ACP path; toolCallId + rawInput → ToolCall.
    #[test]
    fn tool_call_id_only_no_type_no_session_update_detects_tool_call() {
        let data = json!({
            "toolCallId": "tool_abc",
            "rawInput": { "path": "/tmp/bar" }
        });
        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCall));
    }

    /// #3b: type absent, toolCallId present, sessionUpdate present; rawOutput → ToolCallUpdate.
    #[test]
    fn tool_call_id_and_session_update_no_type_detects_tool_call_update() {
        let data = json!({
            "toolCallId": "tool_abc",
            "sessionUpdate": "tool_call_update",
            "rawOutput": "done"
        });
        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCallUpdate));
    }

    /// #4: type present, toolCallId present, sessionUpdate absent → ACP/codex path wins (toolCallId triggers delegation).
    #[test]
    fn type_and_tool_call_id_no_session_update_detects_tool_call() {
        let data = json!({
            "type": "tool_use",
            "toolCallId": "tool_xyz",
            "title": "Read file",
            "rawInput": { "path": "/tmp/foo" }
        });
        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCall));
    }

    /// #5: type present, toolCallId present, sessionUpdate present → ACP path (codex); type drives result.
    #[test]
    fn type_and_tool_call_id_and_session_update_detects_tool_call() {
        let data = json!({
            "type": "tool_use",
            "toolCallId": "tool_xyz",
            "sessionUpdate": "tool_call",
            "title": "Read file",
            "rawInput": { "path": "/tmp/foo" }
        });
        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCall));
    }

    /// #6: type absent, toolCallId absent, sessionUpdate present → ACP path; no toolCallId so Codex returns MissingField.
    #[test]
    fn session_update_only_no_type_no_tool_call_id_fails() {
        let data = json!({
            "sessionUpdate": "tool_call"
        });
        let result = parser().detect_update_type(&data);
        assert!(result.is_err());
    }

    /// #7: type present, toolCallId absent, sessionUpdate present → ACP path; type drives result.
    #[test]
    fn type_and_session_update_no_tool_call_id_uses_type() {
        let data = json!({
            "type": "tool_result",
            "sessionUpdate": "tool_call_update",
            "content": "done"
        });
        let result = parser().detect_update_type(&data);
        assert_eq!(result, Ok(UpdateType::ToolCallUpdate));
    }
}

// ===========================================
// Boundary / edge case tests
// ===========================================

mod cursor_boundary_edge_cases {
    use super::*;
    use serde_json::json;

    fn parser() -> CursorParser {
        CursorParser
    }

    /// Empty string toolCallId: current behavior is parser accepts it (id becomes "").
    #[test]
    fn empty_string_tool_call_id_parses_with_empty_id() {
        let data = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "",
            "kind": "read",
            "status": "pending",
            "rawInput": {}
        });
        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "");
    }

    #[test]
    fn null_title_acp_tool_call_parses() {
        let data = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tool_1",
            "kind": "read",
            "status": "pending",
            "title": null,
            "rawInput": { "path": "/tmp/f" }
        });
        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool_1");
        assert!(result.title.is_none());
    }

    #[test]
    fn null_name_legacy_tool_use_fails() {
        let data = json!({
            "type": "tool_use",
            "id": "tool_1",
            "name": null,
            "input": {}
        });
        let result = parser().parse_tool_call(&data);
        assert!(result.is_err());
    }

    #[test]
    fn null_status_acp_tool_call_update_parses() {
        let data = json!({
            "toolCallId": "tool_1",
            "status": null,
            "rawOutput": { "ok": true }
        });
        let result = parser().parse_tool_call_update(&data, None).unwrap();
        assert_eq!(result.tool_call_id, "tool_1");
        assert_eq!(result.status, Some(ToolCallStatus::Completed));
    }

    #[test]
    fn raw_input_array_tolerated_acp_tool_call() {
        let data = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tool_1",
            "kind": "other",
            "status": "pending",
            "rawInput": []
        });
        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool_1");
        assert!(matches!(
            result.arguments,
            crate::acp::session_update::ToolArguments::Other { .. }
        ));
    }

    #[test]
    fn unknown_fields_ignored_forward_compat() {
        let data = json!({
            "type": "tool_use",
            "id": "tool_1",
            "name": "Read",
            "input": { "path": "/tmp/f" },
            "unknownField": "ignored",
            "futureField": 42
        });
        let result = parser().parse_tool_call(&data).unwrap();
        assert_eq!(result.id, "tool_1");
        assert_eq!(result.name, "Read");
    }
}

// ===========================================
// Golden file fixtures (Phase 0.5)
// ===========================================

mod cursor_golden_fixtures {
    use super::*;

    const FIXTURE_ACP_TOOL_CALL: &str = include_str!("fixtures/cursor_acp_tool_call.json");

    #[test]
    fn golden_acp_tool_call() {
        let data: serde_json::Value = serde_json::from_str(FIXTURE_ACP_TOOL_CALL).unwrap();
        let parsed = CursorParser.parse_tool_call(&data).unwrap();
        insta::assert_debug_snapshot!(parsed);
    }
}

// ===========================================
// ParsedQuestion types tests
// ===========================================
