use super::{
    adapt_cursor_response, cursor_extension_kind, is_cursor_extension_pre_tool,
    normalize_cursor_extension, CursorExtensionKind, CURSOR_ASK_QUESTION, CURSOR_CREATE_PLAN,
    CURSOR_GENERATE_IMAGE, CURSOR_UPDATE_TODOS,
};
use crate::acp::provider_extensions::{
    InboundResponseAdapter, QuestionOptionResponseAdapter, QuestionResponseAdapter,
};
use crate::acp::session_update::{SessionUpdate, ToolKind};
use crate::acp::types::ContentBlock;
use serde_json::json;

#[test]
fn normalizes_cursor_ask_question_to_canonical_question_request() {
    let event = normalize_cursor_extension(
        CURSOR_ASK_QUESTION,
        &json!({
            "toolCallId": "tool-1",
            "title": "Pick one",
            "questions": [{
                "id": "question-1",
                "prompt": "Select an option",
                "options": [
                    { "id": "a", "label": "Option A" },
                    { "id": "b", "label": "Option B" }
                ],
                "allowMultiple": false
            }]
        }),
        Some(42),
        Some("session-1"),
    )
    .expect("event should normalize");

    match &event.updates[0] {
        SessionUpdate::QuestionRequest { question, .. } => {
            assert_eq!(question.json_rpc_request_id, Some(42));
            assert_eq!(
                question.reply_handler,
                Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(42))
            );
            assert_eq!(question.questions[0].question, "Select an option");
            assert_eq!(question.questions[0].options[0].label, "Option A");
            let tool_ref = question
                .tool
                .as_ref()
                .expect("tool reference should be set");
            assert_eq!(tool_ref.call_id, "tool-1");
        }
        other => panic!("unexpected update: {other:?}"),
    }

    match event.response_adapter {
        Some(InboundResponseAdapter::AskQuestion { questions }) => {
            assert_eq!(questions[0].question_id, "question-1");
            assert_eq!(questions[0].options[0].option_id, "a");
        }
        other => panic!("unexpected adapter: {other:?}"),
    }
}

#[test]
fn rejects_cursor_extension_without_active_session_id() {
    let error = normalize_cursor_extension(
        CURSOR_UPDATE_TODOS,
        &json!({
            "toolCallId": "tool-1",
            "todos": []
        }),
        None,
        None,
    )
    .expect_err("missing session id should be rejected");

    assert!(error.contains("requires an active session id"));
}

#[test]
fn normalizes_cursor_create_plan_to_plan_and_question_updates() {
    let event = normalize_cursor_extension(
        CURSOR_CREATE_PLAN,
        &json!({
            "toolCallId": "plan-tool",
            "name": "Implementation Plan",
            "overview": "Approve this plan",
            "plan": "# Plan",
            "todos": [{ "content": "Ship it", "status": "pending" }],
            "planUri": "/tmp/plan.md"
        }),
        Some(7),
        Some("session-1"),
    )
    .expect("event should normalize");

    assert_eq!(event.updates.len(), 2);
    match &event.updates[1] {
        SessionUpdate::ToolCall { tool_call, .. } => {
            assert_eq!(tool_call.id, "plan-tool");
            assert!(tool_call.awaiting_plan_approval);
            assert_eq!(tool_call.plan_approval_request_id, Some(7));
            assert_eq!(tool_call.kind, Some(ToolKind::CreatePlan));
        }
        other => panic!("unexpected update: {other:?}"),
    }

    match event.response_adapter {
        Some(InboundResponseAdapter::CreatePlan { plan_uri }) => {
            assert_eq!(plan_uri.as_deref(), Some("/tmp/plan.md"));
        }
        other => panic!("unexpected adapter: {other:?}"),
    }
}

#[test]
fn adapts_cursor_question_response_from_generic_answers() {
    let adapter = InboundResponseAdapter::AskQuestion {
        questions: vec![QuestionResponseAdapter {
            question: "Select an option".to_string(),
            question_id: "question-1".to_string(),
            options: vec![
                QuestionOptionResponseAdapter {
                    label: "Option A".to_string(),
                    option_id: "a".to_string(),
                },
                QuestionOptionResponseAdapter {
                    label: "Option B".to_string(),
                    option_id: "b".to_string(),
                },
            ],
        }],
    };

    let adapted = adapt_cursor_response(
        &adapter,
        &json!({
            "outcome": { "outcome": "selected", "optionId": "allow" },
            "_meta": { "answers": { "Select an option": "Option B" } }
        }),
    );

    assert_eq!(
        adapted,
        json!({
            "outcome": {
                "outcome": "answered",
                "answers": [{
                    "questionId": "question-1",
                    "selectedOptionIds": ["b"]
                }]
            }
        })
    );
}

#[test]
fn adapts_cursor_plan_response_approved() {
    let adapter = InboundResponseAdapter::CreatePlan {
        plan_uri: Some("/tmp/plan.md".to_string()),
    };

    let adapted = adapt_cursor_response(&adapter, &json!({ "approved": true }));

    assert_eq!(
        adapted,
        json!({
            "outcome": {
                "outcome": "accepted",
                "planUri": "/tmp/plan.md"
            }
        })
    );
}

#[test]
fn adapts_cursor_plan_response_rejected() {
    let adapter = InboundResponseAdapter::CreatePlan {
        plan_uri: Some("/tmp/plan.md".to_string()),
    };

    let adapted = adapt_cursor_response(&adapter, &json!({ "approved": false }));

    assert_eq!(
        adapted,
        json!({
            "outcome": {
                "outcome": "rejected",
                "reason": "User rejected plan",
            }
        })
    );
}

#[test]
fn normalizes_cursor_generate_image_to_image_chunk() {
    let event = normalize_cursor_extension(
        CURSOR_GENERATE_IMAGE,
        &json!({
            "toolCallId": "image-tool",
            "filePath": "/tmp/example.png"
        }),
        None,
        Some("session-1"),
    )
    .expect("event should normalize");

    match &event.updates[0] {
        SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
            ContentBlock::Image { uri, mime_type, .. } => {
                assert_eq!(uri.as_deref(), Some("/tmp/example.png"));
                assert_eq!(mime_type, "image/png");
            }
            other => panic!("unexpected content: {other:?}"),
        },
        other => panic!("unexpected update: {other:?}"),
    }
}

#[test]
fn recognizes_underscore_prefixed_cursor_methods() {
    assert_eq!(
        cursor_extension_kind("_cursor/create_plan"),
        Some(CursorExtensionKind::Request)
    );
    assert_eq!(
        cursor_extension_kind("_cursor/ask_question"),
        Some(CursorExtensionKind::Request)
    );
    assert_eq!(
        cursor_extension_kind("_cursor/update_todos"),
        Some(CursorExtensionKind::Notification)
    );
    assert_eq!(
        cursor_extension_kind("_cursor/task"),
        Some(CursorExtensionKind::Notification)
    );
    assert_eq!(
        cursor_extension_kind("_cursor/generate_image"),
        Some(CursorExtensionKind::Notification)
    );
}

#[test]
fn detects_cursor_extension_pre_tool_notifications() {
    assert!(is_cursor_extension_pre_tool(&json!({
        "method": "session/update",
        "params": {
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "rawInput": { "_toolName": "createPlan" },
                "kind": "other",
                "status": "pending",
                "title": "Create Plan",
                "toolCallId": "tool_abc"
            }
        }
    })));

    assert!(is_cursor_extension_pre_tool(&json!({
        "method": "session/update",
        "params": {
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "rawInput": { "_toolName": "askQuestion" },
                "kind": "think",
                "status": "pending",
                "title": "Ask Question",
                "toolCallId": "tool_def"
            }
        }
    })));

    assert!(is_cursor_extension_pre_tool(&json!({
        "method": "session/update",
        "params": {
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "rawInput": { "_toolName": "generateImage" },
                "kind": "other",
                "status": "pending",
                "toolCallId": "tool_ghi"
            }
        }
    })));
}

#[test]
fn does_not_suppress_regular_tool_calls() {
    assert!(!is_cursor_extension_pre_tool(&json!({
        "method": "session/update",
        "params": {
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "rawInput": {},
                "kind": "read",
                "status": "pending",
                "title": "Read File",
                "toolCallId": "tool_xyz"
            }
        }
    })));

    assert!(!is_cursor_extension_pre_tool(&json!({
        "method": "session/update",
        "params": {
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "rawInput": { "_toolName": "unknownTool" },
                "kind": "other",
                "status": "pending",
                "toolCallId": "tool_unk"
            }
        }
    })));

    assert!(!is_cursor_extension_pre_tool(&json!({
        "method": "session/update",
        "params": {
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call_update",
                "rawInput": { "_toolName": "createPlan" },
                "toolCallId": "tool_abc"
            }
        }
    })));

    assert!(!is_cursor_extension_pre_tool(&json!({
        "method": "session/update",
        "params": { "sessionId": "s1" }
    })));
}

#[test]
fn normalizes_underscore_prefixed_create_plan() {
    let event = normalize_cursor_extension(
        "_cursor/create_plan",
        &json!({
            "toolCallId": "plan-tool",
            "name": "My Plan",
            "overview": "Approve this",
            "todos": [{ "content": "Step 1", "status": "incomplete" }]
        }),
        Some(1),
        Some("session-1"),
    )
    .expect("underscore-prefixed method should normalize");

    assert!(!event.updates.is_empty());
    assert!(event.response_adapter.is_some());
}
