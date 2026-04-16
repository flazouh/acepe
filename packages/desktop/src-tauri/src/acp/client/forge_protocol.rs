use crate::acp::session_update::{
    ContentChunk, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData,
    ToolKind, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
};
use crate::acp::types::ContentBlock;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgeEventFrame {
    #[serde(rename = "type")]
    frame_type: String,
    event: String,
    #[serde(default)]
    turn_id: Option<String>,
    payload: Value,
}

pub fn translate_forge_event(session_id: &str, frame: &Value) -> Vec<SessionUpdate> {
    let Ok(frame) = serde_json::from_value::<ForgeEventFrame>(frame.clone()) else {
        return Vec::new();
    };

    if frame.frame_type != "event" {
        return Vec::new();
    }

    let payload = frame.payload.as_object();

    match frame.event.as_str() {
        "message.delta" => {
            translate_text_delta(session_id, frame.turn_id.as_deref(), payload, false)
        }
        "reasoning.delta" => {
            translate_text_delta(session_id, frame.turn_id.as_deref(), payload, true)
        }
        "tool.started" => translate_tool_started(session_id, payload),
        "tool.finished" => translate_tool_finished(session_id, payload),
        "turn.completed" => vec![SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: frame.turn_id,
        }],
        "turn.failed" => translate_turn_failed(session_id, frame.turn_id.as_deref(), payload),
        _ => Vec::new(),
    }
}

fn translate_text_delta(
    session_id: &str,
    turn_id: Option<&str>,
    payload: Option<&serde_json::Map<String, Value>>,
    is_thought: bool,
) -> Vec<SessionUpdate> {
    let Some(payload) = payload else {
        return Vec::new();
    };

    let text = if is_thought {
        get_non_empty_string(payload.get("deltaText"))
    } else {
        get_non_empty_string(payload.get("deltaMarkdown"))
    };
    let Some(text) = text else {
        return Vec::new();
    };

    let message_id = turn_id.map(ToOwned::to_owned);
    let chunk = ContentChunk {
        content: ContentBlock::Text {
            text: text.to_string(),
        },
        aggregation_hint: None,
    };

    let update = if is_thought {
        SessionUpdate::AgentThoughtChunk {
            chunk,
            part_id: message_id.clone(),
            message_id,
            session_id: Some(session_id.to_string()),
        }
    } else {
        SessionUpdate::AgentMessageChunk {
            chunk,
            part_id: message_id.clone(),
            message_id,
            session_id: Some(session_id.to_string()),
        }
    };

    vec![update]
}

fn translate_tool_started(
    session_id: &str,
    payload: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(payload) = payload else {
        return Vec::new();
    };

    let Some(tool_call_id) = get_non_empty_string(payload.get("toolCallId")) else {
        return Vec::new();
    };
    let tool_name = get_non_empty_string(payload.get("toolName")).unwrap_or("Forge Tool");
    let arguments = match get_non_empty_string(payload.get("argumentsText")) {
        Some(arguments_text) => ToolArguments::Other {
            raw: json!({ "argumentsText": arguments_text }),
        },
        None => ToolArguments::Other { raw: json!({}) },
    };

    vec![SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: tool_call_id.to_string(),
            name: tool_name.to_string(),
            arguments,
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Other),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        session_id: Some(session_id.to_string()),
    }]
}

fn translate_tool_finished(
    session_id: &str,
    payload: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(payload) = payload else {
        return Vec::new();
    };

    let Some(tool_call_id) = get_non_empty_string(payload.get("toolCallId")) else {
        return Vec::new();
    };

    let status = match get_non_empty_string(payload.get("status")) {
        Some("completed") => Some(ToolCallStatus::Completed),
        Some("failed") => Some(ToolCallStatus::Failed),
        Some("cancelled") => Some(ToolCallStatus::Failed),
        _ => None,
    };
    let result = get_non_empty_string(payload.get("resultText")).map(|text| json!(text));
    let failure_reason = match get_non_empty_string(payload.get("status")) {
        Some("cancelled") => Some(
            get_non_empty_string(payload.get("errorMessage"))
                .unwrap_or("Tool cancelled")
                .to_string(),
        ),
        Some("failed") => get_non_empty_string(payload.get("errorMessage")).map(ToOwned::to_owned),
        _ => None,
    };

    vec![SessionUpdate::ToolCallUpdate {
        update: ToolCallUpdateData {
            tool_call_id: tool_call_id.to_string(),
            status,
            result,
            failure_reason,
            ..ToolCallUpdateData::default()
        },
        session_id: Some(session_id.to_string()),
    }]
}

fn translate_turn_failed(
    session_id: &str,
    turn_id: Option<&str>,
    payload: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(payload) = payload else {
        return Vec::new();
    };

    let message = get_non_empty_string(payload.get("message"))
        .unwrap_or("Forge turn failed")
        .to_string();
    let retryable = payload
        .get("retryable")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    vec![SessionUpdate::TurnError {
        error: TurnErrorData::Structured(TurnErrorInfo {
            message,
            kind: if retryable {
                TurnErrorKind::Recoverable
            } else {
                TurnErrorKind::Fatal
            },
            code: None,
            source: Some(TurnErrorSource::Process),
        }),
        session_id: Some(session_id.to_string()),
        turn_id: turn_id.map(ToOwned::to_owned),
    }]
}

fn get_non_empty_string(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use crate::acp::session_update::{SessionUpdate, ToolCallStatus, TurnErrorData, TurnErrorKind};
    use crate::acp::types::ContentBlock;
    use serde_json::json;

    use super::translate_forge_event;

    #[test]
    fn translates_message_delta_into_agent_message_chunk() {
        let updates = translate_forge_event(
            "session-1",
            &json!({
                "type": "event",
                "event": "message.delta",
                "providerSessionId": "forge-session-1",
                "turnId": "turn-1",
                "payload": {
                    "deltaMarkdown": "Working"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::AgentMessageChunk {
                chunk,
                message_id,
                session_id,
                ..
            } => {
                match &chunk.content {
                    ContentBlock::Text { text } => assert_eq!(text, "Working"),
                    other => panic!("unexpected content block: {other:?}"),
                }
                assert_eq!(message_id.as_deref(), Some("turn-1"));
                assert_eq!(session_id.as_deref(), Some("session-1"));
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_reasoning_delta_into_agent_thought_chunk() {
        let updates = translate_forge_event(
            "session-1",
            &json!({
                "type": "event",
                "event": "reasoning.delta",
                "providerSessionId": "forge-session-1",
                "turnId": "turn-1",
                "payload": {
                    "deltaText": "Need to inspect the repo"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::AgentThoughtChunk {
                chunk,
                message_id,
                session_id,
                ..
            } => {
                match &chunk.content {
                    ContentBlock::Text { text } => assert_eq!(text, "Need to inspect the repo"),
                    other => panic!("unexpected content block: {other:?}"),
                }
                assert_eq!(message_id.as_deref(), Some("turn-1"));
                assert_eq!(session_id.as_deref(), Some("session-1"));
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_tool_started_into_tool_call() {
        let updates = translate_forge_event(
            "session-1",
            &json!({
                "type": "event",
                "event": "tool.started",
                "providerSessionId": "forge-session-1",
                "turnId": "turn-1",
                "payload": {
                    "toolCallId": "tool-1",
                    "toolName": "bash",
                    "argumentsText": "echo hello"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCall {
                tool_call,
                session_id,
            } => {
                assert_eq!(tool_call.id, "tool-1");
                assert_eq!(tool_call.name, "bash");
                assert_eq!(tool_call.status, ToolCallStatus::Pending);
                assert_eq!(session_id.as_deref(), Some("session-1"));
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_completed_tool_finished_into_tool_call_update() {
        let updates = translate_forge_event(
            "session-1",
            &json!({
                "type": "event",
                "event": "tool.finished",
                "providerSessionId": "forge-session-1",
                "turnId": "turn-1",
                "payload": {
                    "toolCallId": "tool-1",
                    "status": "completed",
                    "resultText": "done",
                    "errorMessage": null
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate { update, session_id } => {
                assert_eq!(update.tool_call_id, "tool-1");
                assert_eq!(update.status, Some(ToolCallStatus::Completed));
                assert_eq!(update.result, Some(json!("done")));
                assert_eq!(session_id.as_deref(), Some("session-1"));
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_turn_completed_into_turn_complete() {
        let updates = translate_forge_event(
            "session-1",
            &json!({
                "type": "event",
                "event": "turn.completed",
                "providerSessionId": "forge-session-1",
                "turnId": "turn-1",
                "payload": {
                    "stopReason": "end_turn",
                    "usage": {
                        "inputTokens": 10,
                        "outputTokens": 5
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        assert!(matches!(
            updates[0],
            SessionUpdate::TurnComplete {
                session_id: Some(ref session_id),
                turn_id: Some(ref turn_id)
            } if session_id == "session-1" && turn_id == "turn-1"
        ));
    }

    #[test]
    fn translates_turn_failed_into_structured_turn_error() {
        let updates = translate_forge_event(
            "session-1",
            &json!({
                "type": "event",
                "event": "turn.failed",
                "providerSessionId": "forge-session-1",
                "turnId": "turn-1",
                "payload": {
                    "code": "session_busy",
                    "message": "Session busy",
                    "retryable": true
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::TurnError {
                error,
                session_id,
                turn_id,
            } => {
                match error {
                    TurnErrorData::Structured(info) => {
                        assert_eq!(info.message, "Session busy");
                        assert_eq!(info.kind, TurnErrorKind::Recoverable);
                    }
                    TurnErrorData::Legacy(other) => panic!("unexpected legacy error: {other}"),
                }
                assert_eq!(session_id.as_deref(), Some("session-1"));
                assert_eq!(turn_id.as_deref(), Some("turn-1"));
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }
}
