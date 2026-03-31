use crate::acp::session_update::{
    ContentChunk, PermissionData, QuestionData, QuestionItem, QuestionOption, SessionUpdate,
    ToolReference, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
};
use crate::acp::types::ContentBlock;
use serde_json::Value;

const COMMAND_APPROVAL_METHOD: &str = "item/commandExecution/requestApproval";
const FILE_READ_APPROVAL_METHOD: &str = "item/fileRead/requestApproval";
const FILE_CHANGE_APPROVAL_METHOD: &str = "item/fileChange/requestApproval";
const USER_INPUT_REQUEST_METHOD: &str = "item/tool/requestUserInput";
const AGENT_MESSAGE_DELTA_METHOD: &str = "item/agentMessage/delta";
const REASONING_TEXT_DELTA_METHOD: &str = "item/reasoning/textDelta";
const REASONING_SUMMARY_DELTA_METHOD: &str = "item/reasoning/summaryTextDelta";
const TURN_COMPLETED_METHOD: &str = "turn/completed";
const ERROR_METHOD: &str = "error";

pub fn translate_codex_native_server_message(
    session_id: &str,
    message: &Value,
) -> Vec<SessionUpdate> {
    if message.get("result").is_some() || message.get("error").is_some() {
        return Vec::new();
    }

    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return Vec::new();
    };

    let params = message.get("params").and_then(Value::as_object);

    match method {
        AGENT_MESSAGE_DELTA_METHOD => translate_text_delta(session_id, params, false),
        REASONING_TEXT_DELTA_METHOD | REASONING_SUMMARY_DELTA_METHOD => {
            translate_text_delta(session_id, params, true)
        }
        COMMAND_APPROVAL_METHOD | FILE_READ_APPROVAL_METHOD | FILE_CHANGE_APPROVAL_METHOD => {
            translate_permission_request(session_id, message, method, params)
        }
        USER_INPUT_REQUEST_METHOD => translate_question_request(session_id, message, params),
        TURN_COMPLETED_METHOD => translate_turn_completed(session_id, params),
        ERROR_METHOD => translate_error_notification(session_id, params),
        _ => Vec::new(),
    }
}

fn translate_text_delta(
    session_id: &str,
    params: Option<&serde_json::Map<String, Value>>,
    is_thought: bool,
) -> Vec<SessionUpdate> {
    let Some(params) = params else {
        return Vec::new();
    };

    let Some(delta) = get_non_empty_string(params.get("delta")) else {
        return Vec::new();
    };

    let item_id = get_non_empty_string(params.get("itemId")).map(ToOwned::to_owned);
    let update = if is_thought {
        SessionUpdate::AgentThoughtChunk {
            chunk: text_chunk(delta),
            part_id: item_id.clone(),
            message_id: item_id,
            session_id: Some(session_id.to_string()),
        }
    } else {
        SessionUpdate::AgentMessageChunk {
            chunk: text_chunk(delta),
            part_id: item_id.clone(),
            message_id: item_id,
            session_id: Some(session_id.to_string()),
        }
    };

    vec![update]
}

fn translate_permission_request(
    session_id: &str,
    message: &Value,
    method: &str,
    params: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(request_id) = stringify_jsonrpc_id(message.get("id")) else {
        return Vec::new();
    };
    let Some(params) = params else {
        return Vec::new();
    };

    let item_id = get_non_empty_string(params.get("itemId")).map(ToOwned::to_owned);

    vec![SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: request_id,
            session_id: session_id.to_string(),
            permission: permission_label(method, params),
            patterns: permission_patterns(params),
            metadata: Value::Object(params.clone()),
            always: permission_always_options(method),
            tool: item_id.map(|call_id| ToolReference {
                message_id: String::new(),
                call_id,
            }),
        },
        session_id: Some(session_id.to_string()),
    }]
}

fn translate_question_request(
    session_id: &str,
    message: &Value,
    params: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(params) = params else {
        return Vec::new();
    };

    let questions = parse_questions(params);
    if questions.is_empty() {
        return Vec::new();
    }

    let request_id = message.get("id");
    let question_id = stringify_jsonrpc_id(request_id).unwrap_or_else(|| {
        get_non_empty_string(params.get("itemId"))
            .unwrap_or("codex-user-input")
            .to_string()
    });
    let item_id = get_non_empty_string(params.get("itemId")).map(ToOwned::to_owned);

    vec![SessionUpdate::QuestionRequest {
        question: QuestionData {
            id: question_id,
            session_id: session_id.to_string(),
            json_rpc_request_id: None,
            questions,
            tool: item_id.map(|call_id| ToolReference {
                message_id: String::new(),
                call_id,
            }),
        },
        session_id: Some(session_id.to_string()),
    }]
}

fn translate_turn_completed(
    session_id: &str,
    params: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(params) = params else {
        return vec![SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
        }];
    };

    let turn = params.get("turn").and_then(Value::as_object);
    let status = turn
        .and_then(|entry| entry.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("completed");

    if status == "failed" {
        let error_message = turn
            .and_then(|entry| entry.get("error"))
            .and_then(Value::as_object)
            .and_then(|entry| get_non_empty_string(entry.get("message")))
            .unwrap_or("Codex turn failed")
            .to_string();

        return vec![SessionUpdate::TurnError {
            error: TurnErrorData::Structured(TurnErrorInfo {
                message: error_message,
                kind: TurnErrorKind::Fatal,
                code: None,
                source: Some(TurnErrorSource::Process),
            }),
            session_id: Some(session_id.to_string()),
        }];
    }

    vec![SessionUpdate::TurnComplete {
        session_id: Some(session_id.to_string()),
    }]
}

fn translate_error_notification(
    session_id: &str,
    params: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(params) = params else {
        return Vec::new();
    };

    if params
        .get("willRetry")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Vec::new();
    }

    let message = params
        .get("error")
        .and_then(Value::as_object)
        .and_then(|entry| get_non_empty_string(entry.get("message")))
        .unwrap_or("Codex transport error")
        .to_string();
    let code = params
        .get("error")
        .and_then(Value::as_object)
        .and_then(|entry| entry.get("code"))
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok());

    vec![SessionUpdate::TurnError {
        error: TurnErrorData::Structured(TurnErrorInfo {
            message,
            kind: TurnErrorKind::Fatal,
            code,
            source: Some(TurnErrorSource::Transport),
        }),
        session_id: Some(session_id.to_string()),
    }]
}

fn parse_questions(params: &serde_json::Map<String, Value>) -> Vec<QuestionItem> {
    let Some(entries) = params.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };

    entries
        .iter()
        .filter_map(|entry| {
            let question = entry.as_object()?;
            let header = get_non_empty_string(question.get("header"))?.to_string();
            let prompt = get_non_empty_string(question.get("question"))?.to_string();
            let options = question
                .get("options")
                .and_then(Value::as_array)
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|option| {
                            let option = option.as_object()?;
                            let label = get_non_empty_string(option.get("label"))?.to_string();
                            let description =
                                get_non_empty_string(option.get("description"))?.to_string();
                            Some(QuestionOption { label, description })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if options.is_empty() {
                return None;
            }

            Some(QuestionItem {
                question: prompt,
                header,
                options,
                multi_select: question
                    .get("multiSelect")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

fn permission_label(method: &str, params: &serde_json::Map<String, Value>) -> String {
    match method {
        COMMAND_APPROVAL_METHOD => get_non_empty_string(params.get("command"))
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "CommandExecution".to_string()),
        FILE_READ_APPROVAL_METHOD => permission_path_label("Read", params),
        FILE_CHANGE_APPROVAL_METHOD => permission_path_label("Edit", params),
        _ => "Permission".to_string(),
    }
}

fn permission_path_label(prefix: &str, params: &serde_json::Map<String, Value>) -> String {
    let path = get_non_empty_string(params.get("filePath"))
        .or_else(|| get_non_empty_string(params.get("path")));

    match path {
        Some(path) => format!("{} {}", prefix, path),
        None => prefix.to_string(),
    }
}

fn permission_patterns(params: &serde_json::Map<String, Value>) -> Vec<String> {
    ["command", "filePath", "path", "query", "prompt", "reason"]
        .into_iter()
        .filter_map(|key| get_non_empty_string(params.get(key)))
        .map(ToOwned::to_owned)
        .collect()
}

fn permission_always_options(method: &str) -> Vec<String> {
    match method {
        COMMAND_APPROVAL_METHOD | FILE_READ_APPROVAL_METHOD | FILE_CHANGE_APPROVAL_METHOD => {
            vec!["allow_always".to_string()]
        }
        _ => Vec::new(),
    }
}

fn stringify_jsonrpc_id(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text.clone()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    }
}

fn get_non_empty_string(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn text_chunk(text: &str) -> ContentChunk {
    ContentChunk {
        content: ContentBlock::Text {
            text: text.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::translate_codex_native_server_message;
    use crate::acp::session_update::{SessionUpdate, TurnErrorData};
    use crate::acp::types::ContentBlock;
    use serde_json::json;

    #[test]
    fn translates_agent_message_delta_into_stream_chunk() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "itemId": "msg-1",
                    "delta": "working"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            } => {
                match &chunk.content {
                    ContentBlock::Text { text } => assert_eq!(text, "working"),
                    other => panic!("unexpected content block: {other:?}"),
                }
                assert_eq!(part_id.as_deref(), Some("msg-1"));
                assert_eq!(message_id.as_deref(), Some("msg-1"));
                assert_eq!(session_id.as_deref(), Some("session-1"));
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_reasoning_delta_into_thought_chunk() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "item/reasoning/textDelta",
                "params": {
                    "itemId": "reason-1",
                    "delta": "Thinking"
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
                    ContentBlock::Text { text } => assert_eq!(text, "Thinking"),
                    other => panic!("unexpected content block: {other:?}"),
                }
                assert_eq!(message_id.as_deref(), Some("reason-1"));
                assert_eq!(session_id.as_deref(), Some("session-1"));
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_permission_requests_with_jsonrpc_ids() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "id": 42,
                "method": "item/fileRead/requestApproval",
                "params": {
                    "itemId": "tool-1",
                    "path": "src/lib.rs"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::PermissionRequest { permission, .. } => {
                assert_eq!(permission.id, "42");
                assert_eq!(permission.permission, "Read src/lib.rs");
                assert_eq!(permission.patterns, vec!["src/lib.rs"]);
                assert_eq!(
                    permission.tool.as_ref().map(|tool| tool.call_id.as_str()),
                    Some("tool-1")
                );
                assert_eq!(permission.always, vec!["allow_always"]);
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_user_input_requests_into_questions() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "item/tool/requestUserInput",
                "params": {
                    "itemId": "tool-question-1",
                    "questions": [
                        {
                            "id": "scope",
                            "header": "Scope",
                            "question": "Apply to?",
                            "multiSelect": true,
                            "options": [
                                { "label": "File", "description": "This file only" },
                                { "label": "Project", "description": "Whole project" }
                            ]
                        }
                    ]
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::QuestionRequest { question, .. } => {
                assert_eq!(question.id, "7");
                assert_eq!(question.json_rpc_request_id, None);
                assert_eq!(question.questions.len(), 1);
                assert_eq!(question.questions[0].header, "Scope");
                assert_eq!(question.questions[0].question, "Apply to?");
                assert!(question.questions[0].multi_select);
                assert_eq!(question.questions[0].options.len(), 2);
                assert_eq!(
                    question.tool.as_ref().map(|tool| tool.call_id.as_str()),
                    Some("tool-question-1")
                );
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_completed_turns_into_turn_complete() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "turn/completed",
                "params": {
                    "turn": { "id": "turn-1", "status": "completed" }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        assert!(matches!(
            updates[0],
            SessionUpdate::TurnComplete {
                session_id: Some(ref session_id)
            } if session_id == "session-1"
        ));
    }

    #[test]
    fn translates_failed_turns_into_structured_errors() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "turn/completed",
                "params": {
                    "turn": {
                        "id": "turn-1",
                        "status": "failed",
                        "error": { "message": "Boom" }
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::TurnError { error, session_id } => {
                match error {
                    TurnErrorData::Structured(info) => assert_eq!(info.message, "Boom"),
                    other => panic!("unexpected error payload: {other:?}"),
                }
                assert_eq!(session_id.as_deref(), Some("session-1"));
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn ignores_retryable_transport_errors() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "error",
                "params": {
                    "willRetry": true,
                    "error": { "message": "temporary" }
                }
            }),
        );

        assert!(updates.is_empty());
    }
}
