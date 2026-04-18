use crate::acp::providers::codex::adapt_codex_wrapper_plan_update;
use crate::acp::session_update::{
    ChunkAggregationHint, ContentChunk, PermissionData, QuestionData, QuestionItem, QuestionOption,
    SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind,
    ToolReference, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
};
use crate::acp::tool_call_presentation::{synthesize_locations, synthesize_title};
use crate::acp::types::ContentBlock;
#[cfg(test)]
use serde_json::json;
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
const ITEM_STARTED_METHOD: &str = "item/started";
const ITEM_COMPLETED_METHOD: &str = "item/completed";

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
        ITEM_STARTED_METHOD => translate_item_started(session_id, params),
        ITEM_COMPLETED_METHOD => translate_item_completed(session_id, params),
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

    with_codex_plan_update(update)
}

fn classify_chunk_aggregation_hint(text: &str) -> Option<ChunkAggregationHint> {
    if text.trim().is_empty() {
        return None;
    }

    if text.chars().all(|ch| {
        ch.is_ascii_whitespace()
            || matches!(
                ch,
                '.' | ',' | '!' | '?' | ';' | ':' | ')' | ']' | '}' | '>' | '"' | '\'' | '`' | '-'
            )
    }) {
        return Some(ChunkAggregationHint::BoundaryCarryover);
    }

    None
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
            id: request_id.clone(),
            session_id: session_id.to_string(),
            json_rpc_request_id: None,
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::http(
                request_id.clone(),
            )),
            permission: permission_label(method, params),
            patterns: permission_patterns(params),
            metadata: Value::Object(params.clone()),
            always: permission_always_options(method),
            auto_accepted: false,
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
            id: question_id.clone(),
            session_id: session_id.to_string(),
            json_rpc_request_id: None,
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::http(
                question_id.clone(),
            )),
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
    let turn_id = extract_codex_turn_id(params);
    let Some(params) = params else {
        return vec![SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id,
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

        return with_codex_plan_update(SessionUpdate::TurnError {
            error: TurnErrorData::Structured(TurnErrorInfo {
                message: error_message,
                kind: TurnErrorKind::Fatal,
                code: None,
                source: Some(TurnErrorSource::Process),
            }),
            session_id: Some(session_id.to_string()),
            turn_id,
        });
    }

    with_codex_plan_update(SessionUpdate::TurnComplete {
        session_id: Some(session_id.to_string()),
        turn_id,
    })
}

fn extract_codex_turn_id(params: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    let params = params?;

    get_non_empty_string(params.get("turnId"))
        .or_else(|| {
            params
                .get("turn")
                .and_then(Value::as_object)
                .and_then(|turn| get_non_empty_string(turn.get("id")))
        })
        .map(ToOwned::to_owned)
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

    with_codex_plan_update(SessionUpdate::TurnError {
        error: TurnErrorData::Structured(TurnErrorInfo {
            message,
            kind: TurnErrorKind::Fatal,
            code,
            source: Some(TurnErrorSource::Transport),
        }),
        session_id: Some(session_id.to_string()),
        turn_id: extract_codex_turn_id(Some(params)),
    })
}

fn with_codex_plan_update(update: SessionUpdate) -> Vec<SessionUpdate> {
    let mut updates = vec![update.clone()];
    if let Some(plan_update) = adapt_codex_wrapper_plan_update(&update) {
        updates.push(plan_update);
    }
    updates
}

/// Translate `item/started` into a `ToolCall` when the item is a tool execution.
/// Non-tool item types (userMessage, reasoning, agentMessage) are ignored because
/// they are already handled by their own dedicated delta methods.
fn translate_item_started(
    session_id: &str,
    params: Option<&serde_json::Map<String, Value>>,
) -> Vec<SessionUpdate> {
    let Some(item) = params
        .and_then(|p| p.get("item"))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };

    let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
    if !is_tool_item_type(item_type) {
        return Vec::new();
    }

    let Some(id) = item.get("id").and_then(Value::as_str) else {
        return Vec::new();
    };

    let fields = extract_tool_fields(item_type, item);

    let status = match item.get("status").and_then(Value::as_str) {
        Some("completed") => ToolCallStatus::Completed,
        Some("failed") => ToolCallStatus::Failed,
        _ => ToolCallStatus::InProgress,
    };

    vec![SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: id.to_string(),
            name: fields.name,
            locations: synthesize_locations(&fields.arguments),
            title: synthesize_title(&fields.arguments).or(Some(fields.title)),
            arguments: fields.arguments,
            raw_input: None,
            status,
            result: None,
            kind: Some(fields.kind),
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
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
    let Some(item) = params
        .and_then(|p| p.get("item"))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };

    let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
    if !is_tool_item_type(item_type) {
        return Vec::new();
    }

    let Some(id) = item.get("id").and_then(Value::as_str) else {
        return Vec::new();
    };

    let fields = extract_tool_fields(item_type, item);

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
                .map(|exit_code| serde_json::json!({ "exitCode": exit_code }))
        });

    vec![SessionUpdate::ToolCallUpdate {
        update: ToolCallUpdateData {
            tool_call_id: id.to_string(),
            status: Some(status),
            result,
            locations: synthesize_locations(&fields.arguments),
            title: synthesize_title(&fields.arguments).or(Some(fields.title)),
            arguments: Some(fields.arguments),
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

/// Extracted tool metadata from a Codex item payload.
struct ToolFields {
    name: String,
    kind: ToolKind,
    arguments: ToolArguments,
    title: String,
}

/// Extract unified tool fields from a Codex item payload.
fn extract_tool_fields(item_type: &str, item: &serde_json::Map<String, Value>) -> ToolFields {
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

            ToolFields {
                name: "Execute".to_string(),
                kind: ToolKind::Execute,
                title: display_command.clone(),
                arguments: ToolArguments::Execute {
                    command: Some(display_command),
                },
            }
        }
        "fileRead" => {
            let path = item
                .get("filePath")
                .or_else(|| item.get("path"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            let title = format!("Read {path}");
            ToolFields {
                name: "Read".to_string(),
                kind: ToolKind::Read,
                arguments: ToolArguments::Read {
                    file_path: Some(path),
                    source_context: None,
                },
                title,
            }
        }
        "fileChange" => {
            let path = item
                .get("filePath")
                .or_else(|| item.get("path"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            let title = format!("Edit {path}");
            ToolFields {
                name: "Edit".to_string(),
                kind: ToolKind::Edit,
                arguments: ToolArguments::Edit {
                    edits: vec![crate::acp::session_update::EditEntry {
                        file_path: Some(path),
                        move_from: None,
                        old_string: None,
                        new_string: None,
                        content: None,
                    }],
                },
                title,
            }
        }
        _ => {
            // fileSearch, codeEdit, or future types
            let label = item
                .get("title")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(item_type)
                .to_string();

            ToolFields {
                name: item_type.to_string(),
                kind: ToolKind::Other,
                arguments: ToolArguments::Other {
                    raw: serde_json::Value::Object(item.clone()),
                },
                title: label,
            }
        }
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
        aggregation_hint: classify_chunk_aggregation_hint(text),
    }
}

#[cfg(test)]
mod tests {
    use super::translate_codex_native_server_message;
    use crate::acp::session_update::{
        SessionUpdate, ToolArguments, ToolCallStatus, ToolKind, TurnErrorData,
    };
    use crate::acp::types::ContentBlock;
    use serde_json::json;

    #[test]
    fn translates_agent_message_delta_into_stream_chunk() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &serde_json::json!({
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
            &serde_json::json!({
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
                assert_eq!(
                    permission.reply_handler,
                    Some(crate::acp::session_update::InteractionReplyHandler::http(
                        "42".to_string()
                    ))
                );
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
                assert_eq!(
                    question.reply_handler,
                    Some(crate::acp::session_update::InteractionReplyHandler::http(
                        "7".to_string()
                    ))
                );
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
                session_id: Some(ref session_id),
                turn_id: Some(ref turn_id)
            } if session_id == "session-1" && turn_id == "turn-1"
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
            SessionUpdate::TurnError {
                error,
                session_id,
                turn_id,
            } => {
                match error {
                    TurnErrorData::Structured(info) => assert_eq!(info.message, "Boom"),
                    other => panic!("unexpected error payload: {other:?}"),
                }
                assert_eq!(session_id.as_deref(), Some("session-1"));
                assert_eq!(turn_id.as_deref(), Some("turn-1"));
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
            SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                ContentBlock::Text { text } => assert_eq!(text, " world"),
                other => panic!("unexpected content block: {other:?}"),
            },
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
            SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                ContentBlock::Text { text } => assert_eq!(text, "\n"),
                other => panic!("unexpected content block: {other:?}"),
            },
            other => panic!("unexpected update: {other:?}"),
        }
    }

    #[test]
    fn translates_wrapper_plan_chunks_into_chunk_and_plan_updates() {
        let updates = translate_codex_native_server_message(
            "session-plan-1",
            &json!({
                "jsonrpc": "2.0",
                "method": "item/agentMessage/delta",
                "params": {
                    "itemId": "msg-plan-1",
                    "delta": "<proposed_plan># Plan\n\n- step\n</proposed_plan>"
                }
            }),
        );

        assert_eq!(updates.len(), 2);
        assert!(matches!(
            updates[0],
            SessionUpdate::AgentMessageChunk { .. }
        ));
        match &updates[1] {
            SessionUpdate::Plan { plan, session_id } => {
                assert_eq!(session_id.as_deref(), Some("session-plan-1"));
                assert!(!plan.streaming);
                assert_eq!(plan.content.as_deref(), Some("# Plan\n\n- step\n"));
            }
            other => panic!("expected plan update, got {other:?}"),
        }
    }

    #[test]
    fn translates_turn_complete_with_partial_wrapper_into_turn_complete_and_plan_flush() {
        let expected_session_id = "session-plan-turn-complete";
        let streamed = translate_codex_native_server_message(
            expected_session_id,
            &json!({
                "jsonrpc": "2.0",
                "method": "item/agentMessage/delta",
                "params": {
                    "itemId": "msg-plan-2",
                    "delta": "<proposed_plan># Partial"
                }
            }),
        );

        assert_eq!(streamed.len(), 2);
        assert!(matches!(
            streamed[0],
            SessionUpdate::AgentMessageChunk { .. }
        ));
        match &streamed[1] {
            SessionUpdate::Plan { plan, .. } => assert!(plan.streaming),
            other => panic!("expected streaming plan, got {other:?}"),
        }

        let finalized = translate_codex_native_server_message(
            expected_session_id,
            &json!({
                "jsonrpc": "2.0",
                "method": "turn/completed",
                "params": {
                    "turn": { "id": "turn-1", "status": "completed" }
                }
            }),
        );

        assert_eq!(finalized.len(), 2);
        assert!(matches!(finalized[0], SessionUpdate::TurnComplete { .. }));
        match &finalized[1] {
            SessionUpdate::Plan { plan, session_id } => {
                assert_eq!(session_id.as_deref(), Some(expected_session_id));
                assert!(!plan.streaming);
                assert_eq!(plan.content.as_deref(), Some("# Partial"));
            }
            other => panic!("expected finalized plan, got {other:?}"),
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
            SessionUpdate::ToolCallUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("session-codex-1"));
                assert_eq!(update.tool_call_id, "call_abc123");
                assert_eq!(update.title.as_deref(), Some("git status"));
                assert!(matches!(update.status, Some(ToolCallStatus::Completed)));
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
    fn item_started_file_read_produces_tool_call() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "method": "item/started",
                "params": {
                    "item": {
                        "id": "call_read1",
                        "type": "fileRead",
                        "filePath": "/tmp/example.rs",
                        "status": "inProgress"
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.id, "call_read1");
                assert_eq!(tool_call.name, "Read");
                assert_eq!(tool_call.kind, Some(ToolKind::Read));
                assert_eq!(tool_call.title.as_deref(), Some("Read /tmp/example.rs"));
                match &tool_call.arguments {
                    ToolArguments::Read { file_path, .. } => {
                        assert_eq!(file_path.as_deref(), Some("/tmp/example.rs"));
                    }
                    other => panic!("Expected Read arguments, got {other:?}"),
                }
            }
            other => panic!("Expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn item_started_file_change_produces_tool_call() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "method": "item/started",
                "params": {
                    "item": {
                        "id": "call_edit1",
                        "type": "fileChange",
                        "filePath": "/tmp/example.rs",
                        "status": "inProgress"
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.id, "call_edit1");
                assert_eq!(tool_call.name, "Edit");
                assert_eq!(tool_call.kind, Some(ToolKind::Edit));
                assert_eq!(tool_call.title.as_deref(), Some("Edit /tmp/example.rs"));
                match &tool_call.arguments {
                    ToolArguments::Edit { edits } => {
                        assert_eq!(edits.len(), 1);
                        assert_eq!(edits[0].file_path.as_deref(), Some("/tmp/example.rs"));
                    }
                    other => panic!("Expected Edit arguments, got {other:?}"),
                }
            }
            other => panic!("Expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn item_completed_file_read_produces_tool_call_update() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "method": "item/completed",
                "params": {
                    "item": {
                        "id": "call_read_done",
                        "type": "fileRead",
                        "filePath": "/tmp/example.rs",
                        "status": "completed",
                        "aggregatedOutput": "fn main() {}"
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("session-1"));
                assert_eq!(update.tool_call_id, "call_read_done");
                assert_eq!(update.title.as_deref(), Some("Read /tmp/example.rs"));
                assert!(matches!(update.status, Some(ToolCallStatus::Completed)));
                assert_eq!(
                    update.result.as_ref().and_then(|v| v.as_str()),
                    Some("fn main() {}")
                );
                match update.arguments.as_ref() {
                    Some(ToolArguments::Read { file_path, .. }) => {
                        assert_eq!(file_path.as_deref(), Some("/tmp/example.rs"));
                    }
                    other => panic!("Expected Read arguments, got {other:?}"),
                }
            }
            other => panic!("Expected ToolCallUpdate, got {other:?}"),
        }
    }

    #[test]
    fn item_completed_file_change_produces_tool_call_update() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "method": "item/completed",
                "params": {
                    "item": {
                        "id": "call_edit_done",
                        "type": "fileChange",
                        "filePath": "/tmp/example.rs",
                        "status": "completed",
                        "aggregatedOutput": "Applied 2 edits"
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("session-1"));
                assert_eq!(update.tool_call_id, "call_edit_done");
                assert_eq!(update.title.as_deref(), Some("Edit /tmp/example.rs"));
                assert!(matches!(update.status, Some(ToolCallStatus::Completed)));
                assert_eq!(
                    update.result.as_ref().and_then(|v| v.as_str()),
                    Some("Applied 2 edits")
                );
                match update.arguments.as_ref() {
                    Some(ToolArguments::Edit { edits }) => {
                        assert_eq!(edits.len(), 1);
                        assert_eq!(edits[0].file_path.as_deref(), Some("/tmp/example.rs"));
                    }
                    other => panic!("Expected Edit arguments, got {other:?}"),
                }
            }
            other => panic!("Expected ToolCallUpdate, got {other:?}"),
        }
    }

    #[test]
    fn item_completed_file_change_failed_has_failed_status() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "method": "item/completed",
                "params": {
                    "item": {
                        "id": "call_edit_fail",
                        "type": "fileChange",
                        "filePath": "/tmp/readonly.rs",
                        "status": "failed",
                        "aggregatedOutput": null,
                        "exitCode": null
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate { update, .. } => {
                assert!(matches!(update.status, Some(ToolCallStatus::Failed)));
                // No aggregatedOutput and no exitCode => result is None
                assert!(update.result.is_none());
            }
            other => panic!("Expected ToolCallUpdate, got {other:?}"),
        }
    }

    #[test]
    fn item_started_other_tool_type_produces_tool_call() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "method": "item/started",
                "params": {
                    "item": {
                        "id": "call_search1",
                        "type": "fileSearch",
                        "title": "Searching for main",
                        "query": "main",
                        "status": "inProgress"
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.id, "call_search1");
                assert_eq!(tool_call.name, "fileSearch");
                assert_eq!(tool_call.kind, Some(ToolKind::Other));
                assert_eq!(tool_call.title.as_deref(), Some("Searching for main"));
                match &tool_call.arguments {
                    ToolArguments::Other { raw } => {
                        // The raw value should contain the full item object
                        assert_eq!(raw.get("query").and_then(|v| v.as_str()), Some("main"));
                    }
                    other => panic!("Expected Other arguments, got {other:?}"),
                }
            }
            other => panic!("Expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn item_completed_other_tool_type_produces_tool_call_update() {
        let updates = translate_codex_native_server_message(
            "session-1",
            &json!({
                "method": "item/completed",
                "params": {
                    "item": {
                        "id": "call_search_done",
                        "type": "fileSearch",
                        "title": "Searching for main",
                        "status": "completed",
                        "aggregatedOutput": "Found 3 matches"
                    }
                }
            }),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::ToolCallUpdate { update, .. } => {
                assert_eq!(update.tool_call_id, "call_search_done");
                assert_eq!(update.title.as_deref(), Some("Searching for main"));
                assert!(matches!(update.status, Some(ToolCallStatus::Completed)));
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

#[test]
fn tags_punctuation_only_text_deltas_as_boundary_carryover() {
    let updates = translate_codex_native_server_message(
        "session-1",
        &json!({
            "jsonrpc": "2.0",
            "method": "item/agentMessage/delta",
            "params": {
                "itemId": "msg-1",
                "delta": "."
            }
        }),
    );

    match &updates[0] {
        SessionUpdate::AgentMessageChunk { chunk, .. } => {
            assert_eq!(
                chunk.aggregation_hint,
                Some(crate::acp::session_update::ChunkAggregationHint::BoundaryCarryover)
            );
        }
        other => panic!("unexpected update: {other:?}"),
    }
}
