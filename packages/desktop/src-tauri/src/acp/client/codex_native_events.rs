use crate::acp::parsers::AgentType;
use crate::acp::session_update::{
    ContentChunk, PermissionData, QuestionData, QuestionItem, QuestionOption, SessionUpdate,
    ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind, ToolReference,
    TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
};
use crate::acp::session_update_parser::{parse_session_update_notification_with_agent, ParseResult};
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
const SESSION_UPDATE_METHOD: &str = "session/update";
const ITEM_STARTED_METHOD: &str = "item/started";
const ITEM_COMPLETED_METHOD: &str = "item/completed";
const COMMAND_OUTPUT_DELTA_METHOD: &str = "item/commandExecution/outputDelta";

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
        SESSION_UPDATE_METHOD => translate_session_update(session_id, message),
        ITEM_STARTED_METHOD => translate_item_started(session_id, params),
        ITEM_COMPLETED_METHOD => translate_item_completed(session_id, params),
        COMMAND_OUTPUT_DELTA_METHOD => translate_command_output_delta(session_id, params),
        _ => {
            tracing::debug!(
                method = %method,
                session_id = %session_id,
                "Unhandled Codex native method"
            );
            Vec::new()
        }
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

    let Some(delta) = get_text_content(params.get("delta")) else {
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

/// Route `session/update` notifications through the existing session update parser,
/// which delegates to `CodexParser` for tool call/update parsing. The Acepe session
/// ID is injected into the params so downstream consumers receive the correct ID
/// regardless of what the Codex app-server sends.
fn translate_session_update(session_id: &str, message: &Value) -> Vec<SessionUpdate> {
    let enriched = inject_session_id(message, session_id);
    match parse_session_update_notification_with_agent(AgentType::Codex, &enriched) {
        ParseResult::Typed(update) => {
            let update = override_session_id(*update, session_id);
            vec![update]
        }
        ParseResult::Raw {
            error,
            update_type,
            ..
        } => {
            tracing::warn!(
                session_id = %session_id,
                update_type = %update_type,
                error = %error,
                "Failed to parse Codex session/update notification"
            );
            Vec::new()
        }
        ParseResult::NotSessionUpdate => Vec::new(),
    }
}

/// Translate `item/started` into a `ToolCall` when the item is a tool execution.
/// Non-tool item types (userMessage, reasoning, agentMessage) are ignored because
/// they are already handled by their own dedicated delta methods.
fn translate_item_started(
    session_id: &str,
    params: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(item) = params.and_then(|p| p.get("item")).and_then(Value::as_object) else {
        return Vec::new();
    };

    let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
    if !is_tool_item_type(item_type) {
        return Vec::new();
    }

    let Some(id) = item.get("id").and_then(Value::as_str) else {
        return Vec::new();
    };

    let (name, kind, arguments, title) = extract_tool_fields(item_type, item);

    let status = match item.get("status").and_then(Value::as_str) {
        Some("completed") => ToolCallStatus::Completed,
        Some("failed") => ToolCallStatus::Failed,
        _ => ToolCallStatus::InProgress,
    };

    vec![SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: id.to_string(),
            name,
            arguments,
            status,
            result: None,
            kind: Some(kind),
            title: Some(title),
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

/// Translate `item/completed` into a `ToolCallUpdate` when the item is a tool execution.
fn translate_item_completed(
    session_id: &str,
    params: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(item) = params.and_then(|p| p.get("item")).and_then(Value::as_object) else {
        return Vec::new();
    };

    let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
    if !is_tool_item_type(item_type) {
        return Vec::new();
    }

    let Some(id) = item.get("id").and_then(Value::as_str) else {
        return Vec::new();
    };

    let (_name, _kind, arguments, title) = extract_tool_fields(item_type, item);

    let status = match item.get("status").and_then(Value::as_str) {
        Some("failed") => ToolCallStatus::Failed,
        _ => ToolCallStatus::Completed,
    };

    let result = item
        .get("aggregatedOutput")
        .filter(|v| !v.is_null())
        .cloned()
        .or_else(|| {
            item.get("exitCode")
                .filter(|v| !v.is_null())
                .map(|exit_code| {
                    serde_json::json!({ "exitCode": exit_code })
                })
        });

    vec![SessionUpdate::ToolCallUpdate {
        update: ToolCallUpdateData {
            tool_call_id: id.to_string(),
            status: Some(status),
            result,
            title: Some(title),
            arguments: Some(arguments),
            ..ToolCallUpdateData::default()
        },
        session_id: Some(session_id.to_string()),
    }]
}

/// Translate `item/commandExecution/outputDelta` into a streaming `ToolCallUpdate`.
fn translate_command_output_delta(
    session_id: &str,
    params: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(params) = params else {
        return Vec::new();
    };

    let Some(item_id) = get_non_empty_string(params.get("itemId")) else {
        return Vec::new();
    };

    let Some(delta) = get_text_content(params.get("delta")) else {
        return Vec::new();
    };

    vec![SessionUpdate::ToolCallUpdate {
        update: ToolCallUpdateData {
            tool_call_id: item_id.to_string(),
            streaming_input_delta: Some(delta.to_string()),
            ..ToolCallUpdateData::default()
        },
        session_id: Some(session_id.to_string()),
    }]
}

/// Check if an item type represents a tool call (not a message or reasoning block).
fn is_tool_item_type(item_type: &str) -> bool {
    matches!(
        item_type,
        "commandExecution" | "fileRead" | "fileChange" | "fileSearch" | "codeEdit"
    )
}

/// Extract unified tool fields from a Codex item payload.
fn extract_tool_fields(
    item_type: &str,
    item: &serde_json::Map<String, Value>,
) -> (String, ToolKind, ToolArguments, String) {
    match item_type {
        "commandExecution" => {
            let display_command = item
                .get("commandActions")
                .and_then(Value::as_array)
                .and_then(|actions| actions.first())
                .and_then(|action| action.get("command"))
                .and_then(Value::as_str)
                .or_else(|| item.get("command").and_then(Value::as_str))
                .unwrap_or("")
                .to_string();

            (
                "Execute".to_string(),
                ToolKind::Execute,
                ToolArguments::Execute {
                    command: Some(display_command.clone()),
                },
                display_command,
            )
        }
        "fileRead" => {
            let path = item
                .get("filePath")
                .or_else(|| item.get("path"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            (
                "Read".to_string(),
                ToolKind::Read,
                ToolArguments::Read {
                    file_path: Some(path.clone()),
                },
                format!("Read {path}"),
            )
        }
        "fileChange" => {
            let path = item
                .get("filePath")
                .or_else(|| item.get("path"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            (
                "Edit".to_string(),
                ToolKind::Edit,
                ToolArguments::Edit {
                    edits: vec![crate::acp::session_update::EditEntry {
                        file_path: Some(path.clone()),
                        old_string: None,
                        new_string: None,
                        content: None,
                    }],
                },
                format!("Edit {path}"),
            )
        }
        _ => {
            // fileSearch, codeEdit, or future types
            let label = item
                .get("title")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(item_type)
                .to_string();

            (
                item_type.to_string(),
                ToolKind::Other,
                ToolArguments::Other {
                    raw: serde_json::Value::Object(item.clone()),
                },
                label,
            )
        }
    }
}

/// Inject our Acepe session ID into the notification params so the parser picks it up.
fn inject_session_id(message: &Value, session_id: &str) -> Value {
    let mut enriched = message.clone();
    if let Some(params) = enriched.get_mut("params").and_then(Value::as_object_mut) {
        params.insert(
            "sessionId".to_string(),
            Value::String(session_id.to_string()),
        );
        if let Some(update) = params.get_mut("update").and_then(Value::as_object_mut) {
            update.insert(
                "sessionId".to_string(),
                Value::String(session_id.to_string()),
            );
        }
    }
    enriched
}

/// Ensure the parsed SessionUpdate carries the Acepe session ID.
fn override_session_id(update: SessionUpdate, session_id: &str) -> SessionUpdate {
    let sid = Some(session_id.to_string());
    match update {
        SessionUpdate::ToolCall {
            tool_call,
            session_id: _,
        } => SessionUpdate::ToolCall {
            tool_call,
            session_id: sid,
        },
        SessionUpdate::ToolCallUpdate {
            update,
            session_id: _,
        } => SessionUpdate::ToolCallUpdate {
            update,
            session_id: sid,
        },
        SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            session_id: _,
        } => SessionUpdate::AgentMessageChunk {
            chunk,
            part_id,
            message_id,
            session_id: sid,
        },
        SessionUpdate::AgentThoughtChunk {
            chunk,
            part_id,
            message_id,
            session_id: _,
        } => SessionUpdate::AgentThoughtChunk {
            chunk,
            part_id,
            message_id,
            session_id: sid,
        },
        SessionUpdate::UsageTelemetryUpdate { mut data } => {
            data.session_id = session_id.to_string();
            SessionUpdate::UsageTelemetryUpdate { data }
        }
        SessionUpdate::TurnComplete { session_id: _ } => SessionUpdate::TurnComplete {
            session_id: sid,
        },
        SessionUpdate::TurnError {
            error,
            session_id: _,
        } => SessionUpdate::TurnError {
            error,
            session_id: sid,
        },
        // For variants that already carry their own session context or don't need
        // override (Plan, AvailableCommandsUpdate, ConfigOptionUpdate, etc.),
        // return as-is since their session_id comes from the params injection.
        other => other,
    }
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

/// Like `get_non_empty_string` but preserves whitespace.
/// Text deltas from LLMs carry leading spaces as part of their tokens
/// (e.g. `" world"`), so trimming destroys inter-word spacing.
fn get_text_content(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
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
    fn preserves_leading_whitespace_in_text_deltas() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "item/agentMessage/delta",
                "params": {
                    "itemId": "msg-1",
                    "delta": " world"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::AgentMessageChunk { chunk, .. } => {
                match &chunk.content {
                    ContentBlock::Text { text } => assert_eq!(text, " world"),
                    other => panic!("unexpected content block: {other:?}"),
                }
            }
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn preserves_whitespace_only_deltas() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "item/agentMessage/delta",
                "params": {
                    "itemId": "msg-1",
                    "delta": "\n"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::AgentMessageChunk { chunk, .. } => {
                match &chunk.content {
                    ContentBlock::Text { text } => assert_eq!(text, "\n"),
                    other => panic!("unexpected content block: {other:?}"),
                }
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

    #[test]
    fn routes_session_update_tool_call_to_parser() {
        let updates = translate_codex_native_server_message(
            "session-codex-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "codex-thread-1",
                    "update": {
                        "sessionUpdate": "tool_call",
                        "toolCallId": "tool-read-1",
                        "title": "Read file",
                        "kind": "read",
                        "status": "running",
                        "rawInput": { "file_path": "/tmp/test.rs" }
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCall {
                tool_call,
                session_id,
            } => {
                assert_eq!(
                    session_id.as_deref(),
                    Some("session-codex-1"),
                    "Should use Acepe session ID, not Codex thread ID"
                );
                assert_eq!(tool_call.id, "tool-read-1");
            }
            other => panic!("Expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn routes_session_update_tool_call_update_to_parser() {
        let updates = translate_codex_native_server_message(
            "session-codex-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": "tool-edit-1",
                        "status": "completed",
                        "rawOutput": { "applied": true }
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate {
                update,
                session_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("session-codex-1"));
                assert_eq!(update.tool_call_id, "tool-edit-1");
                assert!(matches!(
                    update.status,
                    Some(crate::acp::session_update::ToolCallStatus::Completed)
                ));
            }
            other => panic!("Expected ToolCallUpdate, got {other:?}"),
        }
    }

    #[test]
    fn routes_session_update_usage_to_parser() {
        let updates = translate_codex_native_server_message(
            "session-codex-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "update": {
                        "sessionUpdate": "usage_update",
                        "size": 128000,
                        "used": 4500
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::UsageTelemetryUpdate { data } => {
                assert_eq!(data.session_id, "session-codex-1");
                assert_eq!(data.tokens.total, Some(4500));
                assert_eq!(data.context_window_size, Some(128000));
            }
            other => panic!("Expected UsageTelemetryUpdate, got {other:?}"),
        }
    }

    #[test]
    fn returns_empty_for_unknown_methods() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "item/someFutureEvent/delta",
                "params": { "data": "test" }
            }),
        );

        assert!(updates.is_empty());
    }

    #[test]
    fn session_update_without_params_returns_empty() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "session/update"
            }),
        );

        assert!(updates.is_empty());
    }

    #[test]
    fn item_started_command_execution_produces_tool_call() {
        let updates = translate_codex_native_server_message(
            "session-codex-1",
            &json!({
                "method": "item/started",
                "params": {
                    "item": {
                        "id": "call_abc123",
                        "type": "commandExecution",
                        "command": "/bin/zsh -lc 'git status'",
                        "commandActions": [{ "command": "git status", "type": "unknown" }],
                        "cwd": "/tmp",
                        "status": "inProgress"
                    },
                    "threadId": "thread-1",
                    "turnId": "turn-1"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCall {
                tool_call,
                session_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("session-codex-1"));
                assert_eq!(tool_call.id, "call_abc123");
                assert_eq!(tool_call.name, "Execute");
                assert_eq!(tool_call.title.as_deref(), Some("git status"));
                assert_eq!(tool_call.kind, Some(ToolKind::Execute));
                assert!(matches!(tool_call.status, ToolCallStatus::InProgress));
                match &tool_call.arguments {
                    ToolArguments::Execute { command } => {
                        assert_eq!(command.as_deref(), Some("git status"));
                    }
                    other => panic!("Expected Execute arguments, got {other:?}"),
                }
            }
            other => panic!("Expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn item_completed_command_execution_produces_tool_call_update() {
        let updates = translate_codex_native_server_message(
            "session-codex-1",
            &json!({
                "method": "item/completed",
                "params": {
                    "item": {
                        "id": "call_abc123",
                        "type": "commandExecution",
                        "command": "/bin/zsh -lc 'git status'",
                        "commandActions": [{ "command": "git status", "type": "unknown" }],
                        "cwd": "/tmp",
                        "status": "completed",
                        "exitCode": 0,
                        "aggregatedOutput": "On branch main\nnothing to commit",
                        "durationMs": 42
                    },
                    "threadId": "thread-1",
                    "turnId": "turn-1"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate {
                update,
                session_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("session-codex-1"));
                assert_eq!(update.tool_call_id, "call_abc123");
                assert_eq!(update.title.as_deref(), Some("git status"));
                assert!(matches!(
                    update.status,
                    Some(ToolCallStatus::Completed)
                ));
                assert_eq!(
                    update.result.as_ref().and_then(|v| v.as_str()),
                    Some("On branch main\nnothing to commit")
                );
            }
            other => panic!("Expected ToolCallUpdate, got {other:?}"),
        }
    }

    #[test]
    fn item_completed_failed_command_has_failed_status() {
        let updates = translate_codex_native_server_message(
            "session-codex-1",
            &json!({
                "method": "item/completed",
                "params": {
                    "item": {
                        "id": "call_fail1",
                        "type": "commandExecution",
                        "command": "/bin/zsh -lc 'false'",
                        "commandActions": [{ "command": "false", "type": "unknown" }],
                        "status": "failed",
                        "exitCode": 1,
                        "aggregatedOutput": null
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate { update, .. } => {
                assert!(matches!(update.status, Some(ToolCallStatus::Failed)));
                // exitCode fallback when aggregatedOutput is null
                assert!(update.result.is_some());
            }
            other => panic!("Expected ToolCallUpdate, got {other:?}"),
        }
    }

    #[test]
    fn command_output_delta_produces_streaming_update() {
        let updates = translate_codex_native_server_message(
            "session-codex-1",
            &json!({
                "method": "item/commandExecution/outputDelta",
                "params": {
                    "itemId": "call_abc123",
                    "delta": "On branch main\n",
                    "threadId": "thread-1",
                    "turnId": "turn-1"
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate {
                update,
                session_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("session-codex-1"));
                assert_eq!(update.tool_call_id, "call_abc123");
                assert_eq!(
                    update.streaming_input_delta.as_deref(),
                    Some("On branch main\n")
                );
            }
            other => panic!("Expected ToolCallUpdate, got {other:?}"),
        }
    }

    #[test]
    fn item_started_ignores_non_tool_types() {
        for item_type in &["userMessage", "reasoning", "agentMessage"] {
            let updates = translate_codex_native_server_message(
                "session-1",
                &json!({
                    "method": "item/started",
                    "params": {
                        "item": {
                            "id": "msg-1",
                            "type": item_type
                        }
                    }
                }),
            );

            assert!(
                updates.is_empty(),
                "item/started with type={item_type} should be ignored"
            );
        }
    }
}
