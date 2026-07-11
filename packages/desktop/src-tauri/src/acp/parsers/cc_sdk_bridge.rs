//! Translation layer from cc-sdk [`cc_sdk::Message`] to Acepe [`SessionUpdate`] events.
//!
//! This module provides a single entry point, [`translate_cc_sdk_message`], that converts
//! a single cc-sdk protocol message into zero or more Acepe session update events.

use std::collections::{HashMap, HashSet, VecDeque};

use super::{get_parser, AgentType};
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, ContentChunk, QuestionData,
    RawToolCallInput, RawToolCallUpdateInput, SessionCompactionEvent, SessionCompactionStatus,
    SessionCompactionTrigger, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus,
    ToolCallUpdateData, ToolKind, ToolReference, TurnErrorData, TurnErrorInfo, TurnErrorKind,
    TurnErrorSource, UsageTelemetryData, UsageTelemetryTokens,
};
use crate::acp::types::ContentBlock;
use crate::cc_sdk::{self as cc_sdk, Message};

#[derive(Debug, Clone, Default)]
pub struct CcSdkTurnStreamState {
    pub saw_text_delta: bool,
    pub saw_thinking_delta: bool,
    text_delta_lineages: HashSet<StreamLineageKey>,
    thinking_delta_lineages: HashSet<StreamLineageKey>,
    /// Model ID extracted from `message_start` stream events or `Assistant` messages.
    pub model_id: Option<String>,
    /// content_block_start index -> (tool_use_id, tool_name) for streamed tool input deltas.
    pub stream_tool_blocks: HashMap<u64, (String, String)>,
    stream_tool_blocks_by_lineage: HashMap<StreamToolBlockKey, (String, String)>,
    /// Pending non-question tool calls that should be settled when Claude resumes a turn.
    pub pending_tool_calls: VecDeque<PendingToolCallState>,
    /// True after Claude reports stop_reason=tool_use and before the next message_start arrives.
    pub awaiting_tool_turn_resume: bool,
    /// True after an Assistant message already emitted the terminal provider error for this turn.
    pub saw_terminal_assistant_error: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct StreamLineageKey(Option<String>);

impl StreamLineageKey {
    fn from_parent(parent_tool_use_id: &Option<String>) -> Self {
        Self(parent_tool_use_id.clone())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct StreamToolBlockKey {
    lineage: StreamLineageKey,
    index: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingToolCallState {
    pub tool_call_id: String,
    pub tool_name: String,
}

pub(crate) const MISSING_TOOL_RESULT_MESSAGE: &str =
    "Result unavailable: the agent resumed after this tool call but did not provide stdout/stderr to Acepe.";

fn tool_requires_observable_result(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Bash" | "Edit" | "MultiEdit" | "Write" | "NotebookEdit" | "NotebookWrite"
    )
}

fn note_pending_tool_call(stream_state: &mut CcSdkTurnStreamState, tool_call: &ToolCallData) {
    if matches!(tool_call.kind, Some(ToolKind::Question)) {
        return;
    }
    if !matches!(
        tool_call.status,
        ToolCallStatus::Pending | ToolCallStatus::InProgress
    ) {
        return;
    }
    if stream_state
        .pending_tool_calls
        .iter()
        .any(|pending_tool_call| pending_tool_call.tool_call_id == tool_call.id)
    {
        return;
    }

    stream_state
        .pending_tool_calls
        .push_back(PendingToolCallState {
            tool_call_id: tool_call.id.clone(),
            tool_name: tool_call.name.clone(),
        });
}

pub fn resolve_pending_tool_call(stream_state: &mut CcSdkTurnStreamState, tool_call_id: &str) {
    stream_state
        .pending_tool_calls
        .retain(|pending_tool_call| pending_tool_call.tool_call_id != tool_call_id);
}

fn saw_text_delta_for(
    stream_state: &CcSdkTurnStreamState,
    parent_tool_use_id: &Option<String>,
) -> bool {
    if parent_tool_use_id.is_none() {
        return stream_state.saw_text_delta;
    }
    stream_state
        .text_delta_lineages
        .contains(&StreamLineageKey::from_parent(parent_tool_use_id))
}

fn saw_thinking_delta_for(
    stream_state: &CcSdkTurnStreamState,
    parent_tool_use_id: &Option<String>,
) -> bool {
    if parent_tool_use_id.is_none() {
        return stream_state.saw_thinking_delta;
    }
    stream_state
        .thinking_delta_lineages
        .contains(&StreamLineageKey::from_parent(parent_tool_use_id))
}

fn mark_text_delta(stream_state: &mut CcSdkTurnStreamState, parent_tool_use_id: &Option<String>) {
    if parent_tool_use_id.is_none() {
        stream_state.saw_text_delta = true;
        return;
    }
    stream_state
        .text_delta_lineages
        .insert(StreamLineageKey::from_parent(parent_tool_use_id));
}

fn mark_thinking_delta(
    stream_state: &mut CcSdkTurnStreamState,
    parent_tool_use_id: &Option<String>,
) {
    if parent_tool_use_id.is_none() {
        stream_state.saw_thinking_delta = true;
        return;
    }
    stream_state
        .thinking_delta_lineages
        .insert(StreamLineageKey::from_parent(parent_tool_use_id));
}

fn insert_stream_tool_block(
    stream_state: &mut CcSdkTurnStreamState,
    parent_tool_use_id: &Option<String>,
    index: u64,
    tool_call_id: String,
    tool_name: String,
) {
    if parent_tool_use_id.is_none() {
        stream_state
            .stream_tool_blocks
            .insert(index, (tool_call_id, tool_name));
        return;
    }
    stream_state.stream_tool_blocks_by_lineage.insert(
        StreamToolBlockKey {
            lineage: StreamLineageKey::from_parent(parent_tool_use_id),
            index,
        },
        (tool_call_id, tool_name),
    );
}

fn stream_tool_block(
    stream_state: &CcSdkTurnStreamState,
    parent_tool_use_id: &Option<String>,
    index: u64,
) -> Option<(String, String)> {
    if parent_tool_use_id.is_none() {
        return stream_state.stream_tool_blocks.get(&index).cloned();
    }
    stream_state
        .stream_tool_blocks_by_lineage
        .get(&StreamToolBlockKey {
            lineage: StreamLineageKey::from_parent(parent_tool_use_id),
            index,
        })
        .cloned()
}

fn remove_stream_tool_block(
    stream_state: &mut CcSdkTurnStreamState,
    parent_tool_use_id: &Option<String>,
    index: u64,
) {
    if parent_tool_use_id.is_none() {
        stream_state.stream_tool_blocks.remove(&index);
        return;
    }
    stream_state
        .stream_tool_blocks_by_lineage
        .remove(&StreamToolBlockKey {
            lineage: StreamLineageKey::from_parent(parent_tool_use_id),
            index,
        });
}

fn take_synthetic_tool_completions_for_resumed_tool_turn(
    stream_state: &mut CcSdkTurnStreamState,
    session_id: &Option<String>,
) -> Vec<SessionUpdate> {
    let mut synthetic_updates = Vec::new();

    while let Some(pending_tool_call) = stream_state.pending_tool_calls.pop_front() {
        let missing_result = tool_requires_observable_result(&pending_tool_call.tool_name);
        synthetic_updates.push(SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: pending_tool_call.tool_call_id,
                status: Some(ToolCallStatus::Completed),
                result: missing_result.then(|| {
                    serde_json::json!({
                        "stderr": MISSING_TOOL_RESULT_MESSAGE
                    })
                }),
                failure_reason: None,
                ..Default::default()
            },
            session_id: session_id.clone(),
        });
    }

    synthetic_updates
}

/// Translates a cc-sdk Message into zero or more Acepe SessionUpdate events.
///
/// `session_id` is the Acepe session ID for this conversation. For stream events,
/// the SDK-provided session ID is used as a fallback when `session_id` is `None`.
pub fn translate_cc_sdk_message(
    agent: AgentType,
    msg: Message,
    session_id: Option<String>,
) -> Vec<SessionUpdate> {
    let mut stream_state = CcSdkTurnStreamState::default();
    translate_cc_sdk_message_with_mut_turn_state(agent, msg, session_id, &mut stream_state)
}

pub fn translate_cc_sdk_message_with_turn_state(
    agent: AgentType,
    msg: Message,
    session_id: Option<String>,
    stream_state: CcSdkTurnStreamState,
) -> Vec<SessionUpdate> {
    let mut stream_state = stream_state;
    translate_cc_sdk_message_with_mut_turn_state(agent, msg, session_id, &mut stream_state)
}

pub fn translate_cc_sdk_message_with_mut_turn_state(
    agent: AgentType,
    msg: Message,
    session_id: Option<String>,
    stream_state: &mut CcSdkTurnStreamState,
) -> Vec<SessionUpdate> {
    match msg {
        Message::Assistant { message } => {
            translate_assistant(agent, message, session_id, stream_state)
        }

        Message::StreamEvent {
            session_id: sdk_sid,
            event,
            parent_tool_use_id,
            ..
        } => {
            let effective_sid = session_id.or(Some(sdk_sid));
            translate_stream_event(
                agent,
                event,
                effective_sid,
                parent_tool_use_id,
                stream_state,
            )
        }

        Message::Result {
            is_error,
            session_id: sdk_sid,
            usage,
            model_usage,
            total_cost_usd,
            result,
            ..
        } => {
            let effective_sid = session_id.or(Some(sdk_sid));
            translate_result(
                is_error,
                usage,
                model_usage,
                total_cost_usd,
                result,
                effective_sid,
                stream_state,
            )
        }

        Message::System { subtype, data, .. } => {
            translate_system_message(&subtype, &data, session_id)
        }

        // User, RateLimit, Unknown → nothing
        _ => vec![],
    }
}

// ---------------------------------------------------------------------------
// Assistant message translation
// ---------------------------------------------------------------------------

fn translate_assistant(
    agent: AgentType,
    message: cc_sdk::AssistantMessage,
    session_id: Option<String>,
    stream_state: &mut CcSdkTurnStreamState,
) -> Vec<SessionUpdate> {
    let mut updates: Vec<SessionUpdate> = Vec::new();
    if stream_state.model_id.is_none() {
        stream_state.model_id = message.model.clone();
    }
    if let Some(error) = message.error.as_ref() {
        if message.parent_tool_use_id.is_none() {
            if let Some(usage) = message.usage.as_ref() {
                if let Some(telemetry) =
                    build_usage_telemetry_from_json(usage, session_id.clone(), None, None)
                {
                    updates.push(SessionUpdate::UsageTelemetryUpdate { data: telemetry });
                }
            }
        }
        updates.push(SessionUpdate::TurnError {
            error: assistant_message_error_to_turn_error(error, &message),
            session_id,
            turn_id: None,
        });
        stream_state.saw_terminal_assistant_error = true;
        return updates;
    }

    let parent_tool_use_id = message.parent_tool_use_id.clone();
    let message_model = message.model.clone();

    for block in message.content {
        match block {
            // Prefer stream deltas when present, but fall back to final Assistant blocks
            // when the SDK emits only the completed assistant message for a turn.
            cc_sdk::ContentBlock::Text(text) => {
                if saw_text_delta_for(stream_state, &parent_tool_use_id) {
                    continue;
                }

                updates.push(SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text { text: text.text },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: None,
                    parent_tool_use_id: parent_tool_use_id.clone(),
                    session_id: session_id.clone(),
                    produced_at_monotonic_ms: None,
                });
            }

            cc_sdk::ContentBlock::Thinking(thinking) => {
                if saw_thinking_delta_for(stream_state, &parent_tool_use_id) {
                    continue;
                }

                updates.push(SessionUpdate::AgentThoughtChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: thinking.thinking,
                        },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: None,
                    parent_tool_use_id: parent_tool_use_id.clone(),
                    session_id: session_id.clone(),
                });
            }

            cc_sdk::ContentBlock::ToolUse(tu) => {
                let parser = get_parser(agent);
                let raw = RawToolCallInput {
                    id: tu.id,
                    name: Some(tu.name),
                    arguments: tu.input,
                    status: ToolCallStatus::InProgress,
                    kind: None,
                    title: None,
                    suppress_title_read_path_hint: false,
                    parent_tool_use_id: parent_tool_use_id.clone(),
                    task_children: None,
                };
                let tool_call = build_tool_call_from_raw(parser, raw);
                note_pending_tool_call(stream_state, &tool_call);
                updates.push(SessionUpdate::ToolCall {
                    tool_call: tool_call.clone(),
                    session_id: session_id.clone(),
                });

                if let Some(question_update) =
                    build_question_request_update(&tool_call, &session_id)
                {
                    updates.push(question_update);
                }
            }

            cc_sdk::ContentBlock::ToolResult(tr) => {
                let is_error = tr.is_error.unwrap_or(false);
                let status = if is_error {
                    ToolCallStatus::Failed
                } else {
                    ToolCallStatus::Completed
                };
                let tool_use_id = tr.tool_use_id;

                let (content_blocks, result) = match tr.content {
                    Some(cc_sdk::ContentValue::Text(text)) => (
                        Some(vec![ContentBlock::Text { text: text.clone() }]),
                        Some(serde_json::Value::String(text)),
                    ),
                    Some(cc_sdk::ContentValue::Structured(values)) => {
                        (None, Some(serde_json::Value::Array(values)))
                    }
                    None => (None, None),
                };

                resolve_pending_tool_call(stream_state, &tool_use_id);

                updates.push(SessionUpdate::ToolCallUpdate {
                    update: ToolCallUpdateData {
                        tool_call_id: tool_use_id,
                        status: Some(status),
                        result,
                        content: content_blocks,
                        ..Default::default()
                    },
                    session_id: session_id.clone(),
                });
            }
        }
    }

    // Emit usage telemetry if present. Top-level messages produce session-level
    // telemetry (parent_tool_use_id = None); sub-agent messages produce per-sub-agent
    // telemetry keyed by the parent Task tool-call id and carrying the sub-agent's
    // own model — previously these were discarded.
    if let Some(usage) = message.usage {
        // Carry the sub-agent's own model only for sub-agent telemetry.
        let source_model_id = if parent_tool_use_id.is_some() {
            message_model.clone()
        } else {
            None
        };
        if let Some(telemetry) = build_usage_telemetry_from_json(
            &usage,
            session_id.clone(),
            parent_tool_use_id.clone(),
            source_model_id,
        ) {
            updates.push(SessionUpdate::UsageTelemetryUpdate { data: telemetry });
        }
    }

    updates
}

fn assistant_message_error_to_turn_error(
    error: &cc_sdk::AssistantMessageError,
    message: &cc_sdk::AssistantMessage,
) -> TurnErrorData {
    let message = assistant_error_text(message).unwrap_or_else(|| match error {
        cc_sdk::AssistantMessageError::AuthenticationFailed => {
            "Claude authentication failed.".to_string()
        }
        cc_sdk::AssistantMessageError::BillingError => "Claude billing error.".to_string(),
        cc_sdk::AssistantMessageError::RateLimit => "Claude rate limit exceeded.".to_string(),
        cc_sdk::AssistantMessageError::InvalidRequest => "Claude rejected the request.".to_string(),
        cc_sdk::AssistantMessageError::ServerError => "Claude server error.".to_string(),
        cc_sdk::AssistantMessageError::Unknown => {
            "Claude returned an unknown provider error.".to_string()
        }
    });
    let kind = match error {
        cc_sdk::AssistantMessageError::AuthenticationFailed
        | cc_sdk::AssistantMessageError::BillingError
        | cc_sdk::AssistantMessageError::InvalidRequest => TurnErrorKind::Fatal,
        cc_sdk::AssistantMessageError::RateLimit
        | cc_sdk::AssistantMessageError::ServerError
        | cc_sdk::AssistantMessageError::Unknown => TurnErrorKind::Recoverable,
    };
    TurnErrorData::Structured(TurnErrorInfo {
        code: extract_status_code(&message).map(|code| code.to_string()),
        message,
        kind,
        source: Some(TurnErrorSource::Transport),
        details: None,
    })
}

fn assistant_error_text(message: &cc_sdk::AssistantMessage) -> Option<String> {
    let parts = message
        .content
        .iter()
        .filter_map(|block| match block {
            cc_sdk::ContentBlock::Text(text) if !text.text.trim().is_empty() => {
                Some(text.text.trim().to_string())
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn extract_status_code(message: &str) -> Option<i32> {
    let marker = "API Error:";
    let start = message.find(marker)? + marker.len();
    let digits = message[start..]
        .trim_start()
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    digits.parse::<i32>().ok()
}

fn build_question_request_update(
    tool_call: &ToolCallData,
    session_id: &Option<String>,
) -> Option<SessionUpdate> {
    if tool_call.kind != Some(ToolKind::Question) {
        return None;
    }

    let questions = tool_call.normalized_questions.clone()?;
    if questions.is_empty() {
        return None;
    }
    let session_id = session_id
        .clone()
        .filter(|session_id| !session_id.is_empty())?;

    let question = QuestionData {
        id: tool_call.id.clone(),
        session_id: session_id.clone(),
        json_rpc_request_id: None,
        reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::http(
            tool_call.id.clone(),
        )),
        questions,
        tool: Some(ToolReference {
            message_id: None,
            call_id: tool_call.id.clone(),
        }),
    };

    Some(SessionUpdate::QuestionRequest {
        question,
        session_id: Some(session_id),
    })
}

// ---------------------------------------------------------------------------
// Stream event translation
// ---------------------------------------------------------------------------

fn translate_stream_event(
    agent: AgentType,
    event: serde_json::Value,
    session_id: Option<String>,
    parent_tool_use_id: Option<String>,
    stream_state: &mut CcSdkTurnStreamState,
) -> Vec<SessionUpdate> {
    let event_type = match event.get("type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return vec![],
    };

    match event_type {
        "content_block_start" => {
            // Handle tool_use block start
            let block = match event.get("content_block") {
                Some(b) => b,
                None => return vec![],
            };
            let block_type = match block.get("type").and_then(|v| v.as_str()) {
                Some(t) => t,
                None => return vec![],
            };

            if block_type != "tool_use" {
                return vec![];
            }

            let id = match block.get("id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => return vec![],
            };
            let name = block
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string);
            let Some(name) = name else {
                return vec![];
            };

            let detected_kind = get_parser(agent).detect_tool_kind(&name);
            let kind = if detected_kind != ToolKind::Other {
                Some(detected_kind)
            } else {
                None
            };
            if let Some(index) = event.get("index").and_then(|v| v.as_u64()) {
                insert_stream_tool_block(
                    stream_state,
                    &parent_tool_use_id,
                    index,
                    id.clone(),
                    name.clone(),
                );
            }
            let tool_call = ToolCallData {
                id,
                name,
                arguments: ToolArguments::Other {
                    raw: serde_json::Value::Null,
                    intent: None,
                },
                diagnostic_input: block.get("input").cloned(),
                status: ToolCallStatus::InProgress,
                result: None,
                kind,
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            };
            note_pending_tool_call(stream_state, &tool_call);

            vec![SessionUpdate::ToolCall {
                tool_call,
                session_id,
            }]
        }

        "content_block_delta" => {
            let delta = match event.get("delta") {
                Some(d) => d,
                None => return vec![],
            };
            let delta_type = match delta.get("type").and_then(|v| v.as_str()) {
                Some(t) => t,
                None => return vec![],
            };

            match delta_type {
                "text_delta" => {
                    mark_text_delta(stream_state, &parent_tool_use_id);
                    let text = match delta.get("text").and_then(|v| v.as_str()) {
                        Some(t) => t.to_string(),
                        None => return vec![],
                    };
                    vec![SessionUpdate::AgentMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text { text },
                            aggregation_hint: None,
                        },
                        part_id: None,
                        message_id: None,
                        parent_tool_use_id,
                        session_id,
                        produced_at_monotonic_ms: None,
                    }]
                }

                "thinking_delta" => {
                    mark_thinking_delta(stream_state, &parent_tool_use_id);
                    let thinking = match delta.get("thinking").and_then(|v| v.as_str()) {
                        Some(t) => t.to_string(),
                        None => return vec![],
                    };
                    vec![SessionUpdate::AgentThoughtChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text { text: thinking },
                            aggregation_hint: None,
                        },
                        part_id: None,
                        message_id: None,
                        parent_tool_use_id,
                        session_id,
                    }]
                }

                "input_json_delta" => {
                    let index = match event.get("index").and_then(|v| v.as_u64()) {
                        Some(index) => index,
                        None => return vec![],
                    };
                    let partial_json = match delta.get("partial_json").and_then(|v| v.as_str()) {
                        Some(partial_json) => partial_json,
                        None => return vec![],
                    };
                    let (tool_call_id, tool_name) =
                        match stream_tool_block(stream_state, &parent_tool_use_id, index) {
                            Some((tool_call_id, tool_name)) => (tool_call_id, tool_name),
                            None => return vec![],
                        };
                    let parser = get_parser(agent);
                    let raw = RawToolCallUpdateInput {
                        id: tool_call_id,
                        status: None,
                        result: None,
                        raw_output: None,
                        content: None,
                        title: None,
                        locations: None,
                        streaming_input_delta: Some(partial_json.to_string()),
                        tool_name: Some(tool_name),
                        raw_input: None,
                        kind: None,
                    };
                    let update =
                        build_tool_call_update_from_raw(parser, raw, session_id.as_deref());

                    vec![SessionUpdate::ToolCallUpdate { update, session_id }]
                }
                _ => vec![],
            }
        }

        "content_block_stop" => {
            if let Some(index) = event.get("index").and_then(|v| v.as_u64()) {
                remove_stream_tool_block(stream_state, &parent_tool_use_id, index);
            }
            vec![]
        }

        "message_start" => {
            let mut updates = Vec::new();
            if stream_state.awaiting_tool_turn_resume {
                updates.extend(take_synthetic_tool_completions_for_resumed_tool_turn(
                    stream_state,
                    &session_id,
                ));
                stream_state.awaiting_tool_turn_resume = false;
            }
            if let Some(model) = event
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(|v| v.as_str())
            {
                stream_state.model_id = Some(model.to_string());
            }
            updates
        }

        "message_delta" => {
            stream_state.awaiting_tool_turn_resume = event
                .get("delta")
                .and_then(|delta| delta.get("stop_reason"))
                .and_then(|value| value.as_str())
                == Some("tool_use");
            vec![]
        }

        // All other stream event types are ignored
        _ => vec![],
    }
}

// ---------------------------------------------------------------------------
// Result message translation
// ---------------------------------------------------------------------------

fn translate_result(
    is_error: bool,
    usage: Option<serde_json::Value>,
    model_usage: Option<serde_json::Value>,
    total_cost_usd: Option<f64>,
    result: Option<String>,
    session_id: Option<String>,
    stream_state: &mut CcSdkTurnStreamState,
) -> Vec<SessionUpdate> {
    let mut updates: Vec<SessionUpdate> = Vec::new();

    // Emit usage telemetry if we have usage data or a cost figure
    if usage.is_some() || total_cost_usd.is_some() {
        if let Some(telemetry) = build_result_telemetry(
            usage,
            model_usage,
            total_cost_usd,
            session_id.clone(),
            stream_state.model_id.as_deref(),
        ) {
            updates.push(SessionUpdate::UsageTelemetryUpdate { data: telemetry });
        }
    }

    if is_error {
        updates.push(SessionUpdate::TurnError {
            error: TurnErrorData::Legacy(result.unwrap_or_else(|| "Turn failed".to_string())),
            session_id,
            turn_id: None,
        });
    } else if stream_state.saw_terminal_assistant_error {
        stream_state.saw_terminal_assistant_error = false;
    } else {
        updates.push(SessionUpdate::TurnComplete {
            session_id,
            turn_id: None,
        });
    }

    updates
}

// ---------------------------------------------------------------------------
// System message translation
// ---------------------------------------------------------------------------

/// Translate a `Message::System` into session updates.
///
/// Claude Code emits `usage_update` system messages that carry context-window
/// size and current token usage — data that the `Result` message does NOT carry.
fn translate_system_message(
    subtype: &str,
    data: &serde_json::Value,
    session_id: Option<String>,
) -> Vec<SessionUpdate> {
    let sid = match data
        .get("sessionId")
        .or_else(|| data.get("session_id"))
        .and_then(|v| v.as_str())
    {
        Some(s) => s.to_string(),
        None => match session_id {
            Some(s) => s,
            None => return vec![],
        },
    };

    if subtype == "compact_boundary" {
        return vec![SessionUpdate::CompactionEvent {
            event: build_completed_compaction_event(data, sid.clone()),
            session_id: Some(sid),
        }];
    }

    if subtype != "usage_update" {
        return vec![];
    }

    let context_window_size = data.get("size").and_then(|v| v.as_u64());

    let compaction_reset = data
        .get("compaction")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let used_total = if compaction_reset {
        Some(0)
    } else {
        data.get("used")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                data.get("latestUsage")
                    .and_then(|v| v.get("used"))
                    .and_then(|v| v.as_u64())
            })
            .or_else(|| {
                data.get("latest_usage")
                    .and_then(|v| v.get("used"))
                    .and_then(|v| v.as_u64())
            })
    };

    let cost_usd = data
        .get("cost")
        .and_then(|v| v.get("amount"))
        .and_then(|v| v.as_f64())
        .or_else(|| data.get("costUsd").and_then(|v| v.as_f64()))
        .or_else(|| data.get("cost_usd").and_then(|v| v.as_f64()));

    let event_id = data
        .get("eventId")
        .or_else(|| data.get("event_id"))
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    let telemetry_event_id = event_id.clone();
    let telemetry = UsageTelemetryData {
        session_id: sid.clone(),
        event_id: telemetry_event_id,
        scope: data
            .get("scope")
            .and_then(|v| v.as_str())
            .unwrap_or("turn")
            .to_string(),
        cost_usd,
        tokens: UsageTelemetryTokens {
            total: used_total,
            input: None,
            output: None,
            cache_read: None,
            cache_write: None,
            reasoning: None,
        },
        source_model_id: data
            .get("sourceModelId")
            .or_else(|| data.get("source_model_id"))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string()),
        timestamp_ms: data
            .get("timestampMs")
            .or_else(|| data.get("timestamp_ms"))
            .and_then(|v| v.as_i64()),
        context_window_size,
        parent_tool_use_id: None,
    };

    let mut updates = vec![SessionUpdate::UsageTelemetryUpdate { data: telemetry }];
    if compaction_reset {
        updates.push(SessionUpdate::CompactionEvent {
            event: build_usage_reset_compaction_event(
                data,
                sid.clone(),
                event_id,
                context_window_size,
            ),
            session_id: Some(sid),
        });
    }

    updates
}

fn build_usage_reset_compaction_event(
    data: &serde_json::Value,
    sid: String,
    event_id: Option<String>,
    context_window_size: Option<u64>,
) -> SessionCompactionEvent {
    let timestamp_ms = timestamp_ms_from_value(data);
    SessionCompactionEvent {
        event_id: event_id
            .unwrap_or_else(|| fallback_compaction_event_id(&sid, "usage-reset", data)),
        session_id: sid,
        status: SessionCompactionStatus::UsageReset,
        trigger: SessionCompactionTrigger::Unknown,
        pre_compaction_tokens: None,
        post_compaction_tokens: Some(0),
        dropped_tokens: None,
        context_window_size,
        duration_ms: None,
        precomputed: None,
        preserved_message_count: None,
        cumulative_dropped_tokens: None,
        timestamp_ms,
        summary: Some("Compaction done".to_string()),
        provider_metadata: serde_json::json!({
            "subtype": "usage_update",
            "data": data,
        }),
    }
}

fn build_completed_compaction_event(
    data: &serde_json::Value,
    sid: String,
) -> SessionCompactionEvent {
    let metadata = compaction_metadata_value(data);
    let data_sources = [metadata, data];
    let pre_compaction_tokens = u64_from_any_key_in_values(
        &data_sources,
        &[
            "preCompactionTokens",
            "pre_compaction_tokens",
            "beforeTokens",
            "before_tokens",
            "preTokens",
            "pre_tokens",
        ],
    );
    let post_compaction_tokens = u64_from_any_key_in_values(
        &data_sources,
        &[
            "postCompactionTokens",
            "post_compaction_tokens",
            "afterTokens",
            "after_tokens",
            "postTokens",
            "post_tokens",
        ],
    );
    let dropped_tokens = u64_from_any_key_in_values(
        &data_sources,
        &[
            "droppedTokens",
            "dropped_tokens",
            "removedTokens",
            "removed_tokens",
        ],
    )
    .or_else(|| {
        pre_compaction_tokens.and_then(|pre_tokens| {
            post_compaction_tokens.and_then(|post_tokens| pre_tokens.checked_sub(post_tokens))
        })
    });
    let timestamp_ms = timestamp_ms_from_values(&data_sources);

    SessionCompactionEvent {
        event_id: string_from_any_key_in_values(&data_sources, &["eventId", "event_id", "uuid"])
            .unwrap_or_else(|| fallback_compaction_event_id(&sid, "compact-boundary", data)),
        session_id: sid,
        status: SessionCompactionStatus::Completed,
        trigger: compaction_trigger_from_values(&data_sources),
        pre_compaction_tokens,
        post_compaction_tokens,
        dropped_tokens,
        context_window_size: u64_from_any_key_in_values(
            &data_sources,
            &[
                "size",
                "contextWindowSize",
                "context_window_size",
                "contextWindow",
            ],
        ),
        duration_ms: u64_from_any_key_in_values(&data_sources, &["durationMs", "duration_ms"]),
        precomputed: bool_from_any_key_in_values(&data_sources, &["precomputed"]),
        preserved_message_count: preserved_message_count_from_metadata(metadata).or_else(|| {
            u64_from_any_key_in_values(
                &data_sources,
                &[
                    "preservedMessageCount",
                    "preserved_message_count",
                    "preservedMessagesCount",
                    "preserved_messages_count",
                ],
            )
        }),
        cumulative_dropped_tokens: u64_from_any_key_in_values(
            &data_sources,
            &["cumulativeDroppedTokens", "cumulative_dropped_tokens"],
        ),
        timestamp_ms,
        summary: Some("Compaction done".to_string()),
        provider_metadata: serde_json::json!({
            "subtype": "compact_boundary",
            "data": data,
        }),
    }
}

fn compaction_metadata_value(data: &serde_json::Value) -> &serde_json::Value {
    data.get("compactMetadata")
        .or_else(|| data.get("compact_metadata"))
        .filter(|value| value.is_object())
        .unwrap_or(data)
}

fn string_from_any_key(data: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| data.get(*key).and_then(|value| value.as_str()))
        .map(str::to_string)
}

fn string_from_any_key_in_values(values: &[&serde_json::Value], keys: &[&str]) -> Option<String> {
    values
        .iter()
        .find_map(|value| string_from_any_key(value, keys))
}

fn u64_from_any_key(data: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| data.get(*key).and_then(|value| value.as_u64()))
}

fn u64_from_any_key_in_values(values: &[&serde_json::Value], keys: &[&str]) -> Option<u64> {
    values
        .iter()
        .find_map(|value| u64_from_any_key(value, keys))
}

fn bool_from_any_key(data: &serde_json::Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| data.get(*key).and_then(|value| value.as_bool()))
}

fn bool_from_any_key_in_values(values: &[&serde_json::Value], keys: &[&str]) -> Option<bool> {
    values
        .iter()
        .find_map(|value| bool_from_any_key(value, keys))
}

fn preserved_message_count_from_metadata(metadata: &serde_json::Value) -> Option<u64> {
    metadata
        .get("preservedMessages")
        .or_else(|| metadata.get("preserved_messages"))
        .and_then(|value| value.get("uuids").or_else(|| value.get("allUuids")))
        .and_then(|value| value.as_array())
        .map(|values| values.len() as u64)
}

fn timestamp_ms_from_value(data: &serde_json::Value) -> Option<i64> {
    data.get("timestampMs")
        .or_else(|| data.get("timestamp_ms"))
        .or_else(|| data.get("timestamp"))
        .and_then(timestamp_ms_from_json_value)
}

fn timestamp_ms_from_values(values: &[&serde_json::Value]) -> Option<i64> {
    values
        .iter()
        .find_map(|value| timestamp_ms_from_value(value))
}

fn timestamp_ms_from_json_value(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(timestamp_ms_from_rfc3339))
}

fn timestamp_ms_from_rfc3339(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

fn compaction_trigger_from_values(values: &[&serde_json::Value]) -> SessionCompactionTrigger {
    match string_from_any_key_in_values(values, &["trigger"]).as_deref() {
        Some("auto") | Some("automatic") => SessionCompactionTrigger::Auto,
        Some("manual") | Some("user") => SessionCompactionTrigger::Manual,
        _ => SessionCompactionTrigger::Unknown,
    }
}

fn fallback_compaction_event_id(sid: &str, subtype: &str, data: &serde_json::Value) -> String {
    let timestamp = timestamp_ms_from_value(data)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "no-timestamp".to_string());
    let metadata = compaction_metadata_value(data);
    let data_sources = [metadata, data];
    let pre_tokens = u64_from_any_key_in_values(
        &data_sources,
        &["preCompactionTokens", "pre_compaction_tokens", "preTokens"],
    )
    .map(|value| value.to_string())
    .unwrap_or_else(|| "no-pre".to_string());
    let post_tokens = u64_from_any_key_in_values(
        &data_sources,
        &[
            "postCompactionTokens",
            "post_compaction_tokens",
            "postTokens",
        ],
    )
    .map(|value| value.to_string())
    .unwrap_or_else(|| "no-post".to_string());
    format!("compaction:{sid}:{subtype}:{timestamp}:{pre_tokens}:{post_tokens}")
}

// ---------------------------------------------------------------------------
// Model → context window size mapping
// ---------------------------------------------------------------------------

#[cfg(test)]
/// Returns the context window size (in tokens) for a given Claude model ID.
///
/// All current Claude models (Haiku, Sonnet, Opus) have 200k context windows.
/// Returns `None` for unrecognized model IDs.
fn context_window_for_model(model_id: &str) -> Option<u64> {
    let normalized = model_id.to_lowercase();

    // All Claude 3.5+ / 4+ models have 200k context windows
    if normalized.contains("claude") {
        return Some(200_000);
    }

    // Short aliases used by cc-sdk
    if normalized == "haiku" || normalized == "sonnet" || normalized == "opus" {
        return Some(200_000);
    }

    None
}

// ---------------------------------------------------------------------------
// Usage telemetry helpers
// ---------------------------------------------------------------------------

/// Build `UsageTelemetryData` from an assistant-message `usage` JSON blob.
///
/// `parent_tool_use_id` + `source_model_id` are `None` for top-level session
/// telemetry and `Some(..)` for a spawned sub-agent's per-call usage (keyed by the
/// parent `Task` tool-call id and carrying the sub-agent's own model).
fn build_usage_telemetry_from_json(
    usage: &serde_json::Value,
    session_id: Option<String>,
    parent_tool_use_id: Option<String>,
    source_model_id: Option<String>,
) -> Option<UsageTelemetryData> {
    let sid = session_id.filter(|session_id| !session_id.is_empty())?;

    let input = usage.get("input_tokens").and_then(|v| v.as_u64());
    let output = usage.get("output_tokens").and_then(|v| v.as_u64());
    let cache_read = usage
        .get("cache_read_input_tokens")
        .and_then(|v| v.as_u64());
    let cache_write = usage
        .get("cache_creation_input_tokens")
        .and_then(|v| v.as_u64());

    // Compute total if any token counts are available
    let total = match (input, output) {
        (Some(i), Some(o)) => Some(i + o + cache_read.unwrap_or(0) + cache_write.unwrap_or(0)),
        _ => None,
    };

    Some(UsageTelemetryData {
        session_id: sid,
        event_id: None,
        scope: "step".to_string(),
        cost_usd: None,
        tokens: UsageTelemetryTokens {
            total,
            input,
            output,
            cache_read,
            cache_write,
            reasoning: None,
        },
        source_model_id,
        timestamp_ms: None,
        context_window_size: None,
        parent_tool_use_id,
    })
}

/// Build `UsageTelemetryData` from a Result message when session identity is known.
fn build_result_telemetry(
    usage: Option<serde_json::Value>,
    model_usage: Option<serde_json::Value>,
    total_cost_usd: Option<f64>,
    session_id: Option<String>,
    model_id: Option<&str>,
) -> Option<UsageTelemetryData> {
    let sid = session_id.filter(|session_id| !session_id.is_empty())?;

    let (input, output, cache_read, cache_write) = usage
        .as_ref()
        .map(|u| {
            (
                u.get("input_tokens").and_then(|v| v.as_u64()),
                u.get("output_tokens").and_then(|v| v.as_u64()),
                u.get("cache_read_input_tokens").and_then(|v| v.as_u64()),
                u.get("cache_creation_input_tokens")
                    .and_then(|v| v.as_u64()),
            )
        })
        .unwrap_or((None, None, None, None));

    // The Result `usage` is cumulative across every API round-trip in the turn, so
    // summing input + output + cache_read + cache_write counts the cached prefix many
    // times and overshoots the physical context window. That sum is billing data, not
    // current context occupancy — leave `total` unset so it cannot clobber the
    // authoritative occupancy snapshot from `usage_update` / assistant messages. Cost
    // and context-window size below are the parts the Result message authoritatively
    // carries.
    Some(UsageTelemetryData {
        session_id: sid,
        event_id: None,
        scope: "step".to_string(),
        cost_usd: total_cost_usd,
        tokens: UsageTelemetryTokens {
            total: None,
            input,
            output,
            cache_read,
            cache_write,
            reasoning: None,
        },
        source_model_id: model_id.map(|m| m.to_string()),
        timestamp_ms: None,
        context_window_size: model_usage
            .as_ref()
            .and_then(|usage| model_id.and_then(|model| usage.get(model)))
            .and_then(|usage| usage.get("contextWindow"))
            .and_then(|value| value.as_u64()),
        parent_tool_use_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        translate_cc_sdk_message, translate_cc_sdk_message_with_mut_turn_state,
        translate_cc_sdk_message_with_turn_state, CcSdkTurnStreamState,
        MISSING_TOOL_RESULT_MESSAGE,
    };
    use crate::acp::agent_context::with_agent;
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::{
        build_tool_call_update_from_raw, RawToolCallUpdateInput, SessionCompactionStatus,
        SessionCompactionTrigger, SessionUpdate, ToolArguments, ToolCallStatus, ToolKind,
    };
    use crate::acp::types::ContentBlock;
    use crate::cc_sdk::{
        self as cc_sdk, AssistantMessage, AssistantMessageError, ContentBlock as CcContentBlock,
        Message, TextContent, ThinkingContent,
    };

    #[test]
    fn translates_assistant_text_when_no_stream_delta_arrived() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Assistant {
                message: AssistantMessage {
                    content: vec![CcContentBlock::Text(TextContent {
                        text: "Hello from assistant".to_string(),
                    })],
                    model: None,
                    usage: None,
                    error: None,
                    parent_tool_use_id: None,
                },
            },
            Some("session-1".to_string()),
            CcSdkTurnStreamState::default(),
        );

        assert!(matches!(
            updates.as_slice(),
            [SessionUpdate::AgentMessageChunk {
                chunk,
                session_id: Some(session_id),
                ..
            }] if matches!(
                &chunk.content,
                ContentBlock::Text { text } if text == "Hello from assistant"
            ) && session_id == "session-1"
        ));
    }

    #[test]
    fn translates_assistant_authentication_error_to_turn_error() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Assistant {
                message: AssistantMessage {
                    content: vec![CcContentBlock::Text(TextContent {
                        text: "Failed to authenticate. API Error: 401 {\"error\":{\"message\":\"User not found.\",\"code\":401}}".to_string(),
                    })],
                    model: None,
                    usage: None,
                    error: Some(AssistantMessageError::AuthenticationFailed),
                    parent_tool_use_id: None,
                },
            },
            Some("session-auth".to_string()),
            CcSdkTurnStreamState::default(),
        );

        assert!(matches!(
            updates.as_slice(),
            [SessionUpdate::TurnError {
                error: crate::acp::session_update::TurnErrorData::Structured(payload),
                session_id: Some(session_id),
                ..
            }] if session_id == "session-auth"
                && payload.message.contains("Failed to authenticate")
                && payload.message.contains("User not found")
                && payload.kind == crate::acp::session_update::TurnErrorKind::Fatal
                && payload.code.as_deref() == Some("401")
                && payload.source == Some(crate::acp::session_update::TurnErrorSource::Transport)
        ));
    }

    #[test]
    fn suppresses_success_result_after_assistant_authentication_error() {
        let mut stream_state = CcSdkTurnStreamState::default();
        let auth_updates = translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::Assistant {
                message: AssistantMessage {
                    content: vec![CcContentBlock::Text(TextContent {
                        text: "Failed to authenticate. API Error: 401 {\"error\":{\"message\":\"User not found.\",\"code\":401}}".to_string(),
                    })],
                    model: None,
                    usage: None,
                    error: Some(AssistantMessageError::AuthenticationFailed),
                    parent_tool_use_id: None,
                },
            },
            Some("session-auth".to_string()),
            &mut stream_state,
        );
        assert!(matches!(
            auth_updates.as_slice(),
            [SessionUpdate::TurnError { .. }]
        ));

        let result_updates = translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::Result {
                subtype: "success".to_string(),
                duration_ms: 100,
                duration_api_ms: 100,
                is_error: false,
                num_turns: 1,
                session_id: "session-auth".to_string(),
                total_cost_usd: None,
                usage: None,
                model_usage: None,
                result: None,
                structured_output: None,
                stop_reason: None,
            },
            Some("session-auth".to_string()),
            &mut stream_state,
        );

        assert!(
            !result_updates
                .iter()
                .any(|update| matches!(update, SessionUpdate::TurnComplete { .. })),
            "success-shaped Result must not overwrite a prior assistant authentication error"
        );
    }

    #[test]
    fn skips_assistant_text_when_stream_delta_already_arrived() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Assistant {
                message: AssistantMessage {
                    content: vec![CcContentBlock::Text(TextContent {
                        text: "Hello from assistant".to_string(),
                    })],
                    model: None,
                    usage: None,
                    error: None,
                    parent_tool_use_id: None,
                },
            },
            Some("session-1".to_string()),
            CcSdkTurnStreamState {
                saw_text_delta: true,
                saw_thinking_delta: false,
                model_id: None,
                ..Default::default()
            },
        );

        assert!(updates.is_empty());
    }

    #[test]
    fn stream_subagent_text_delta_preserves_parent_tool_use_id() {
        let updates = translate_cc_sdk_message(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-003".to_string(),
                session_id: "ses-test".to_string(),
                event: serde_json::json!({
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {
                        "type": "text_delta",
                        "text": "subagent streamed report"
                    }
                }),
                parent_tool_use_id: Some("toolu_task_parent".to_string()),
            },
            Some("ses-test".to_string()),
        );

        assert_eq!(updates.len(), 1);
        match &updates[0] {
            SessionUpdate::AgentMessageChunk {
                parent_tool_use_id, ..
            } => assert_eq!(parent_tool_use_id.as_deref(), Some("toolu_task_parent")),
            other => panic!("expected AgentMessageChunk, got {other:?}"),
        }
    }

    #[test]
    fn subagent_stream_delta_does_not_suppress_top_level_assistant_fallback_text() {
        let mut stream_state = CcSdkTurnStreamState::default();
        let subagent_updates = translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-003".to_string(),
                session_id: "ses-test".to_string(),
                event: serde_json::json!({
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {
                        "type": "text_delta",
                        "text": "subagent streamed report"
                    }
                }),
                parent_tool_use_id: Some("toolu_task_parent".to_string()),
            },
            Some("ses-test".to_string()),
            &mut stream_state,
        );
        assert_eq!(subagent_updates.len(), 1);

        let parent_updates = translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::Assistant {
                message: AssistantMessage {
                    content: vec![CcContentBlock::Text(TextContent {
                        text: "top-level final text".to_string(),
                    })],
                    model: None,
                    usage: None,
                    error: None,
                    parent_tool_use_id: None,
                },
            },
            Some("ses-test".to_string()),
            &mut stream_state,
        );

        assert_eq!(parent_updates.len(), 1);
        match &parent_updates[0] {
            SessionUpdate::AgentMessageChunk {
                parent_tool_use_id, ..
            } => assert_eq!(parent_tool_use_id, &None),
            other => panic!("expected top-level AgentMessageChunk, got {other:?}"),
        }
    }

    #[test]
    fn translates_assistant_thinking_when_no_stream_delta_arrived() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Assistant {
                message: AssistantMessage {
                    content: vec![CcContentBlock::Thinking(ThinkingContent {
                        thinking: "Need to inspect files".to_string(),
                        signature: "sig".to_string(),
                    })],
                    model: None,
                    usage: None,
                    error: None,
                    parent_tool_use_id: None,
                },
            },
            Some("session-1".to_string()),
            CcSdkTurnStreamState::default(),
        );

        assert!(matches!(
            updates.as_slice(),
            [SessionUpdate::AgentThoughtChunk {
                chunk,
                session_id: Some(session_id),
                ..
            }] if matches!(
                &chunk.content,
                ContentBlock::Text { text } if text == "Need to inspect files"
            ) && session_id == "session-1"
        ));
    }

    #[test]
    fn translates_system_usage_update_with_context_window() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::System {
                subtype: "usage_update".to_string(),
                data: serde_json::json!({
                    "sessionId": "ses-abc",
                    "used": 50000,
                    "size": 200000,
                    "costUsd": 0.042,
                }),
            },
            None,
            CcSdkTurnStreamState::default(),
        );

        assert_eq!(updates.len(), 1);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(data.session_id, "ses-abc");
            assert_eq!(data.tokens.total, Some(50000));
            assert_eq!(data.context_window_size, Some(200000));
            assert_eq!(data.cost_usd, Some(0.042));
        } else {
            panic!("Expected UsageTelemetryUpdate");
        }
    }

    #[test]
    fn translates_system_usage_update_uses_fallback_session_id() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::System {
                subtype: "usage_update".to_string(),
                data: serde_json::json!({
                    "used": 10000,
                    "size": 200000,
                }),
            },
            Some("fallback-sid".to_string()),
            CcSdkTurnStreamState::default(),
        );

        assert_eq!(updates.len(), 1);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(data.session_id, "fallback-sid");
            assert_eq!(data.tokens.total, Some(10000));
            assert_eq!(data.context_window_size, Some(200000));
        } else {
            panic!("Expected UsageTelemetryUpdate");
        }
    }

    #[test]
    fn ignores_non_usage_update_system_messages() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::System {
                subtype: "task_started".to_string(),
                data: serde_json::json!({"sessionId": "ses-abc"}),
            },
            None,
            CcSdkTurnStreamState::default(),
        );

        assert!(updates.is_empty());
    }

    #[test]
    fn handles_compaction_reset_in_usage_update() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::System {
                subtype: "usage_update".to_string(),
                data: serde_json::json!({
                    "sessionId": "ses-abc",
                    "compaction": true,
                    "size": 200000,
                }),
            },
            None,
            CcSdkTurnStreamState::default(),
        );

        assert_eq!(updates.len(), 2);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(data.tokens.total, Some(0));
            assert_eq!(data.context_window_size, Some(200000));
        } else {
            panic!("Expected UsageTelemetryUpdate");
        }
        if let SessionUpdate::CompactionEvent { event, .. } = &updates[1] {
            assert_eq!(event.session_id, "ses-abc");
            assert_eq!(event.status, SessionCompactionStatus::UsageReset);
            assert_eq!(event.trigger, SessionCompactionTrigger::Unknown);
            assert_eq!(event.post_compaction_tokens, Some(0));
            assert_eq!(event.context_window_size, Some(200000));
        } else {
            panic!("Expected CompactionEvent");
        }
    }

    #[test]
    fn emits_compaction_event_for_compact_boundary_system_message() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::System {
                subtype: "compact_boundary".to_string(),
                data: serde_json::json!({
                    "sessionId": "ses-abc",
                    "uuid": "compact-1",
                    "timestamp": "2026-02-03T04:05:06.007Z",
                    "compactMetadata": {
                        "trigger": "auto",
                        "preTokens": 180000,
                        "postTokens": 42000,
                        "durationMs": 918,
                        "precomputed": true,
                        "cumulativeDroppedTokens": 300000,
                        "preservedMessages": {
                            "uuids": ["message-1", "message-2"]
                        }
                    },
                }),
            },
            None,
            CcSdkTurnStreamState::default(),
        );

        assert_eq!(updates.len(), 1);
        if let SessionUpdate::CompactionEvent { event, .. } = &updates[0] {
            assert_eq!(event.event_id, "compact-1");
            assert_eq!(event.session_id, "ses-abc");
            assert_eq!(event.status, SessionCompactionStatus::Completed);
            assert_eq!(event.trigger, SessionCompactionTrigger::Auto);
            assert_eq!(event.pre_compaction_tokens, Some(180000));
            assert_eq!(event.post_compaction_tokens, Some(42000));
            assert_eq!(event.dropped_tokens, Some(138000));
            assert_eq!(event.duration_ms, Some(918));
            assert_eq!(event.precomputed, Some(true));
            assert_eq!(event.preserved_message_count, Some(2));
            assert_eq!(event.cumulative_dropped_tokens, Some(300000));
            assert_eq!(event.timestamp_ms, Some(1770091506007_i64));
        } else {
            panic!("Expected CompactionEvent");
        }
    }

    #[test]
    fn result_telemetry_preserves_model_id_without_guessing_context_window() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Result {
                subtype: "conversation_turn".to_string(),
                duration_ms: 1000,
                duration_api_ms: 800,
                is_error: false,
                num_turns: 1,
                session_id: "ses-result".to_string(),
                total_cost_usd: Some(0.01),
                usage: Some(serde_json::json!({
                    "input_tokens": 5000,
                    "output_tokens": 500,
                })),
                model_usage: None,
                result: None,
                structured_output: None,
                stop_reason: None,
            },
            Some("ses-result".to_string()),
            CcSdkTurnStreamState {
                saw_text_delta: false,
                saw_thinking_delta: false,
                model_id: Some("claude-sonnet-4-5-20250929".to_string()),
                ..Default::default()
            },
        );

        // Should have UsageTelemetryUpdate + TurnComplete
        assert_eq!(updates.len(), 2);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(data.context_window_size, None);
            assert_eq!(
                data.source_model_id,
                Some("claude-sonnet-4-5-20250929".to_string())
            );
            assert_eq!(data.tokens.input, Some(5000));
            assert_eq!(data.tokens.output, Some(500));
            assert_eq!(data.cost_usd, Some(0.01));
        } else {
            panic!("Expected UsageTelemetryUpdate");
        }
    }

    #[test]
    fn result_telemetry_has_no_context_window_without_model() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Result {
                subtype: "conversation_turn".to_string(),
                duration_ms: 1000,
                duration_api_ms: 800,
                is_error: false,
                num_turns: 1,
                session_id: "ses-nomodel".to_string(),
                total_cost_usd: Some(0.005),
                usage: Some(serde_json::json!({
                    "input_tokens": 1000,
                    "output_tokens": 100,
                })),
                model_usage: None,
                result: None,
                structured_output: None,
                stop_reason: None,
            },
            Some("ses-nomodel".to_string()),
            CcSdkTurnStreamState::default(),
        );

        assert_eq!(updates.len(), 2);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(data.context_window_size, None);
            assert_eq!(data.source_model_id, None);
        } else {
            panic!("Expected UsageTelemetryUpdate");
        }
    }

    #[test]
    fn result_without_session_id_does_not_emit_fake_usage_telemetry_session() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Result {
                subtype: "conversation_turn".to_string(),
                duration_ms: 1000,
                duration_api_ms: 800,
                is_error: false,
                num_turns: 1,
                session_id: "".to_string(),
                total_cost_usd: Some(0.005),
                usage: Some(serde_json::json!({
                    "input_tokens": 1000,
                    "output_tokens": 100,
                })),
                model_usage: None,
                result: None,
                structured_output: None,
                stop_reason: None,
            },
            None,
            CcSdkTurnStreamState::default(),
        );

        assert_eq!(updates.len(), 1);
        assert!(matches!(updates[0], SessionUpdate::TurnComplete { .. }));
    }

    #[test]
    fn result_telemetry_does_not_guess_context_window_from_model_id() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Result {
                subtype: "conversation_turn".to_string(),
                duration_ms: 1000,
                duration_api_ms: 800,
                is_error: false,
                num_turns: 1,
                session_id: "ses-explicit-only".to_string(),
                total_cost_usd: Some(0.005),
                usage: Some(serde_json::json!({
                    "input_tokens": 1000,
                    "output_tokens": 100,
                })),
                model_usage: None,
                result: None,
                structured_output: None,
                stop_reason: None,
            },
            Some("ses-explicit-only".to_string()),
            CcSdkTurnStreamState {
                saw_text_delta: false,
                saw_thinking_delta: false,
                model_id: Some("claude-sonnet-4-5-20250929".to_string()),
                ..Default::default()
            },
        );

        assert_eq!(updates.len(), 2);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(
                data.source_model_id.as_deref(),
                Some("claude-sonnet-4-5-20250929")
            );
            assert_eq!(data.context_window_size, None);
        } else {
            panic!("Expected UsageTelemetryUpdate");
        }
    }

    #[test]
    fn result_telemetry_uses_model_usage_context_window() {
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Result {
                subtype: "conversation_turn".to_string(),
                duration_ms: 1000,
                duration_api_ms: 800,
                is_error: false,
                num_turns: 1,
                session_id: "ses-model-usage".to_string(),
                total_cost_usd: Some(0.005),
                usage: Some(serde_json::json!({
                    "input_tokens": 1000,
                    "output_tokens": 100,
                })),
                model_usage: Some(serde_json::json!({
                    "claude-sonnet-4-6": {
                        "contextWindow": 200000,
                        "maxOutputTokens": 32000
                    }
                })),
                result: None,
                structured_output: None,
                stop_reason: None,
            },
            Some("ses-model-usage".to_string()),
            CcSdkTurnStreamState {
                saw_text_delta: false,
                saw_thinking_delta: false,
                model_id: Some("claude-sonnet-4-6".to_string()),
                ..Default::default()
            },
        );

        assert_eq!(updates.len(), 2);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(data.context_window_size, Some(200000));
            assert_eq!(data.source_model_id.as_deref(), Some("claude-sonnet-4-6"));
        } else {
            panic!("Expected UsageTelemetryUpdate");
        }
    }

    #[test]
    fn result_telemetry_does_not_report_cumulative_tokens_as_context_occupancy() {
        // The Claude Code Result message carries usage summed across every API
        // round-trip in the turn, so cache reads are counted many times. The naive
        // sum (1200 + 8000 + 1_100_000 + 64_708 = 1_173_908) overshoots the 1,000,000
        // context window — it is billing data, not current context occupancy. The
        // Result event must report cost + window only and leave the occupancy total
        // unset, so it cannot clobber the authoritative usage_update snapshot.
        let updates = translate_cc_sdk_message_with_turn_state(
            AgentType::ClaudeCode,
            Message::Result {
                subtype: "conversation_turn".to_string(),
                duration_ms: 1000,
                duration_api_ms: 800,
                is_error: false,
                num_turns: 1,
                session_id: "ses-cumulative".to_string(),
                total_cost_usd: Some(2.0568),
                usage: Some(serde_json::json!({
                    "input_tokens": 1200,
                    "output_tokens": 8000,
                    "cache_read_input_tokens": 1_100_000,
                    "cache_creation_input_tokens": 64_708,
                })),
                model_usage: Some(serde_json::json!({
                    "claude-opus-4-8": {
                        "contextWindow": 1_000_000,
                        "maxOutputTokens": 32000
                    }
                })),
                result: None,
                structured_output: None,
                stop_reason: None,
            },
            Some("ses-cumulative".to_string()),
            CcSdkTurnStreamState {
                saw_text_delta: false,
                saw_thinking_delta: false,
                model_id: Some("claude-opus-4-8".to_string()),
                ..Default::default()
            },
        );

        let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] else {
            panic!("Expected UsageTelemetryUpdate");
        };
        // Cost and window are still reported...
        assert_eq!(data.cost_usd, Some(2.0568));
        assert_eq!(data.context_window_size, Some(1_000_000));
        // ...but the cumulative token sum is NOT a context-occupancy total.
        assert_eq!(data.tokens.total, None);
    }

    #[test]
    fn context_window_for_all_claude_models() {
        use super::context_window_for_model;

        // Full model IDs
        assert_eq!(
            context_window_for_model("claude-sonnet-4-5-20250929"),
            Some(200_000)
        );
        assert_eq!(context_window_for_model("claude-opus-4-6"), Some(200_000));
        assert_eq!(
            context_window_for_model("claude-haiku-4-5-20251001"),
            Some(200_000)
        );

        // Short aliases
        assert_eq!(context_window_for_model("sonnet"), Some(200_000));
        assert_eq!(context_window_for_model("opus"), Some(200_000));
        assert_eq!(context_window_for_model("haiku"), Some(200_000));

        // Unknown model
        assert_eq!(context_window_for_model("gpt-4o"), None);
    }

    #[test]
    fn streamed_bash_input_delta_builds_execute_arguments() {
        with_agent(AgentType::ClaudeCode, || {
            let parser = crate::acp::parsers::get_parser(AgentType::ClaudeCode);
            let raw = RawToolCallUpdateInput {
                id: "toolu_test_bash".to_string(),
                status: None,
                result: None,
                raw_output: None,
                content: None,
                title: None,
                locations: None,
                streaming_input_delta: Some("{\"command\":\"echo hi\"}".to_string()),
                tool_name: Some("Bash".to_string()),
                raw_input: None,
                kind: None,
            };

            let update = build_tool_call_update_from_raw(parser, raw, Some("cc-sdk-stream-test"));

            assert_eq!(update.tool_call_id, "toolu_test_bash");
            assert_eq!(
                update.streaming_input_delta.as_deref(),
                Some("{\"command\":\"echo hi\"}")
            );
            match update.streaming_arguments {
                Some(ToolArguments::Execute { command }) => {
                    assert_eq!(command.as_deref(), Some("echo hi"));
                }
                other => panic!("expected execute streaming args, got {:?}", other),
            }
        });
    }

    #[test]
    fn streamed_edit_input_delta_emits_tool_call_update_from_tracked_tool_block() {
        let mut stream_state = CcSdkTurnStreamState::default();

        let start_updates = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-edit-start".to_string(),
                session_id: "ses-edit-stream".to_string(),
                event: serde_json::json!({
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {
                        "type": "tool_use",
                        "id": "toolu_edit_stream",
                        "name": "Edit",
                        "input": {}
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-edit-stream".to_string()),
            &mut stream_state,
        );
        assert_eq!(start_updates.len(), 1);

        let delta_updates = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-edit-delta".to_string(),
                session_id: "ses-edit-stream".to_string(),
                event: serde_json::json!({
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {
                        "type": "input_json_delta",
                        "partial_json": "{\"file_path\":\"/tmp/demo.txt\"}"
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-edit-stream".to_string()),
            &mut stream_state,
        );

        assert_eq!(delta_updates.len(), 1);
        match &delta_updates[0] {
            SessionUpdate::ToolCallUpdate { update, session_id } => {
                assert_eq!(update.tool_call_id, "toolu_edit_stream");
                assert_eq!(session_id.as_deref(), Some("ses-edit-stream"));
                match &update.streaming_arguments {
                    Some(ToolArguments::Edit { edits }) => {
                        assert_eq!(edits.len(), 1);
                        assert_eq!(edits[0].file_path.as_deref(), Some("/tmp/demo.txt"));
                    }
                    other => panic!("expected streamed edit arguments, got {:?}", other),
                }
            }
            other => panic!("expected tool call update, got {:?}", other),
        }
    }

    #[test]
    fn next_message_start_completes_resultless_bash_without_callback() {
        // When a tool_use is pending and the next message_start arrives without
        // a can_use_tool callback, Copilot has resumed without giving Acepe a
        // tool-result payload. The bridge should complete the tool turn so the
        // UI does not claim the command failed, while still surfacing that
        // stdout/stderr were unavailable.
        let mut stream_state = CcSdkTurnStreamState::default();

        let _ = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-tool-start".to_string(),
                session_id: "ses-tool-resume".to_string(),
                event: serde_json::json!({
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {
                        "type": "tool_use",
                        "id": "toolu_resume_me",
                        "name": "Bash",
                        "input": {
                            "command": "echo hi"
                        }
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-tool-resume".to_string()),
            &mut stream_state,
        );

        let _ = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-tool-stop".to_string(),
                session_id: "ses-tool-resume".to_string(),
                event: serde_json::json!({
                    "type": "message_delta",
                    "delta": {
                        "stop_reason": "tool_use"
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-tool-resume".to_string()),
            &mut stream_state,
        );

        let updates = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-next-start".to_string(),
                session_id: "ses-tool-resume".to_string(),
                event: serde_json::json!({
                    "type": "message_start",
                    "message": {
                        "content": [],
                        "model": "claude-sonnet-4-6"
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-tool-resume".to_string()),
            &mut stream_state,
        );

        assert!(
            updates.iter().any(|update| matches!(
                update,
                SessionUpdate::ToolCallUpdate { update, .. }
                    if update.tool_call_id == "toolu_resume_me"
                        && update.status == Some(ToolCallStatus::Completed)
                        && update.failure_reason.is_none()
                        && update.result.as_ref().and_then(|result| result.get("stderr")).and_then(|value| value.as_str()) == Some(MISSING_TOOL_RESULT_MESSAGE)
            )),
            "bridge should complete resumed Bash tools while surfacing unavailable output"
        );
    }

    #[test]
    fn production_bridge_source_owns_input_json_delta_translation() {
        let source = include_str!("cc_sdk_bridge.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap_or(source);

        assert!(
            production_source.contains("\"input_json_delta\""),
            "provider-edge bridge should handle Claude input_json_delta events"
        );
        assert!(
            !production_source.contains("skip these deltas"),
            "provider-edge bridge should not defer tool input delta translation to outer layers"
        );
    }

    #[test]
    fn content_block_start_write_tool_has_edit_kind() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::StreamEvent {
                    uuid: "msg-001".to_string(),
                    session_id: "ses-test".to_string(),
                    event: serde_json::json!({
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {
                            "type": "tool_use",
                            "id": "toolu_write_001",
                            "name": "Write",
                            "input": {}
                        }
                    }),
                    parent_tool_use_id: None,
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.name, "Write");
                assert_eq!(
                    tool_call.kind,
                    Some(ToolKind::Edit),
                    "content_block_start for Write should set kind=Edit, got {:?}",
                    tool_call.kind,
                );
            } else {
                panic!("expected SessionUpdate::ToolCall, got {:?}", updates[0]);
            }
        });
    }

    #[test]
    fn assistant_tool_use_read_has_typed_arguments_and_kind() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                            id: "toolu_read_001".to_string(),
                            name: "Read".to_string(),
                            input: serde_json::json!({"file_path": "/src/main.rs"}),
                        })],
                        model: Some("claude-opus-4-6".to_string()),
                        usage: None,
                        error: None,
                        parent_tool_use_id: None,
                    },
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.name, "Read");
                assert_eq!(tool_call.kind, Some(ToolKind::Read));
                match &tool_call.arguments {
                    ToolArguments::Read { file_path, .. } => {
                        assert_eq!(file_path.as_deref(), Some("/src/main.rs"));
                    }
                    other => panic!("expected Read arguments, got {:?}", other),
                }
            } else {
                panic!("expected SessionUpdate::ToolCall, got {:?}", updates[0]);
            }
        });
    }

    #[test]
    fn assistant_tool_use_bash_has_typed_arguments_and_kind() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                            id: "toolu_bash_002".to_string(),
                            name: "Bash".to_string(),
                            input: serde_json::json!({"command": "ls -la"}),
                        })],
                        model: Some("claude-opus-4-6".to_string()),
                        usage: None,
                        error: None,
                        parent_tool_use_id: None,
                    },
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.name, "Bash");
                assert_eq!(tool_call.kind, Some(ToolKind::Execute));
                match &tool_call.arguments {
                    ToolArguments::Execute { command } => {
                        assert_eq!(command.as_deref(), Some("ls -la"));
                    }
                    other => panic!("expected Execute arguments, got {:?}", other),
                }
            } else {
                panic!("expected SessionUpdate::ToolCall, got {:?}", updates[0]);
            }
        });
    }

    #[test]
    fn assistant_tool_use_prefers_explicit_agent_parser_over_current_agent() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::Codex,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                            id: "toolu_codex_exec_001".to_string(),
                            name: "functions.exec_command".to_string(),
                            input: serde_json::json!({"command": "ls -la"}),
                        })],
                        model: Some("gpt-5".to_string()),
                        usage: None,
                        error: None,
                        parent_tool_use_id: None,
                    },
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.kind, Some(ToolKind::Execute));
                match &tool_call.arguments {
                    ToolArguments::Execute { command } => {
                        assert_eq!(command.as_deref(), Some("ls -la"));
                    }
                    other => panic!("expected Execute arguments, got {:?}", other),
                }
            } else {
                panic!("expected SessionUpdate::ToolCall, got {:?}", updates[0]);
            }
        });
    }

    #[test]
    fn content_block_start_without_tool_name_is_not_promoted_to_tool_call() {
        let updates = translate_cc_sdk_message(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-missing-tool-name".to_string(),
                session_id: "ses-test".to_string(),
                event: serde_json::json!({
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {
                        "type": "tool_use",
                        "id": "toolu_missing_name",
                        "input": {}
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-test".to_string()),
        );

        assert!(updates.is_empty());
    }

    #[test]
    fn content_block_start_prefers_explicit_agent_parser_over_current_agent() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::Codex,
                Message::StreamEvent {
                    uuid: "msg-codex-001".to_string(),
                    session_id: "ses-test".to_string(),
                    event: serde_json::json!({
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {
                            "type": "tool_use",
                            "id": "toolu_codex_exec_stream_001",
                            "name": "functions.exec_command",
                            "input": {}
                        }
                    }),
                    parent_tool_use_id: None,
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.kind, Some(ToolKind::Execute));
            } else {
                panic!("expected SessionUpdate::ToolCall, got {:?}", updates[0]);
            }
        });
    }

    #[test]
    fn assistant_subagent_tool_use_emits_subagent_usage_telemetry() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                            id: "toolu_child_telemetry_001".to_string(),
                            name: "Bash".to_string(),
                            input: serde_json::json!({"command": "pwd"}),
                        })],
                        model: Some("claude-haiku-4-5-20251001".to_string()),
                        usage: Some(serde_json::json!({
                            "input_tokens": 3,
                            "output_tokens": 3,
                            "cache_read_input_tokens": 0,
                            "cache_creation_input_tokens": 22537,
                        })),
                        error: None,
                        parent_tool_use_id: Some("toolu_task_parent".to_string()),
                    },
                },
                Some("ses-test".to_string()),
            );

            // The tool call is still emitted, AND a per-sub-agent usage telemetry
            // update keyed by the parent Task tool-call id (no longer discarded).
            let tool_call = updates
                .iter()
                .find_map(|update| match update {
                    SessionUpdate::ToolCall { tool_call, .. } => Some(tool_call),
                    _ => None,
                })
                .expect("expected a ToolCall update");
            assert_eq!(tool_call.id, "toolu_child_telemetry_001");
            assert_eq!(tool_call.kind, Some(ToolKind::Execute));
            assert_eq!(
                tool_call.parent_tool_use_id.as_deref(),
                Some("toolu_task_parent")
            );

            let telemetry = updates
                .iter()
                .find_map(|update| match update {
                    SessionUpdate::UsageTelemetryUpdate { data } => Some(data),
                    _ => None,
                })
                .expect("expected a per-sub-agent UsageTelemetryUpdate");
            assert_eq!(
                telemetry.parent_tool_use_id.as_deref(),
                Some("toolu_task_parent"),
                "sub-agent telemetry must carry the parent Task tool-call id"
            );
            assert_eq!(
                telemetry.source_model_id.as_deref(),
                Some("claude-haiku-4-5-20251001"),
                "sub-agent telemetry must carry the sub-agent's own model"
            );
            assert_eq!(telemetry.tokens.input, Some(3));
            assert_eq!(telemetry.tokens.output, Some(3));
            assert_eq!(telemetry.tokens.cache_write, Some(22537));
        });
    }

    #[test]
    fn assistant_subagent_text_chunk_preserves_parent_tool_use_id() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![cc_sdk::ContentBlock::Text(cc_sdk::TextContent {
                            text: "subagent report".to_string(),
                        })],
                        model: Some("claude-haiku-4-5-20251001".to_string()),
                        usage: None,
                        error: None,
                        parent_tool_use_id: Some("toolu_task_parent".to_string()),
                    },
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            match &updates[0] {
                SessionUpdate::AgentMessageChunk {
                    parent_tool_use_id, ..
                } => assert_eq!(parent_tool_use_id.as_deref(), Some("toolu_task_parent")),
                other => panic!("expected AgentMessageChunk, got {other:?}"),
            }
        });
    }

    #[test]
    fn assistant_subagent_error_message_does_not_emit_session_level_telemetry() {
        // Invariant: a sub-agent (parent_tool_use_id.is_some()) message must NEVER
        // produce a session-level (parent_tool_use_id = None) usage record, on any
        // emission site including the error path.
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![],
                        model: Some("claude-haiku-4-5-20251001".to_string()),
                        usage: Some(serde_json::json!({
                            "input_tokens": 10,
                            "output_tokens": 1,
                        })),
                        error: Some(cc_sdk::AssistantMessageError::ServerError),
                        parent_tool_use_id: Some("toolu_task_parent".to_string()),
                    },
                },
                Some("ses-test".to_string()),
            );

            assert!(
                updates.iter().all(|update| match update {
                    SessionUpdate::UsageTelemetryUpdate { data } =>
                        data.parent_tool_use_id.is_some(),
                    _ => true,
                }),
                "no session-level (parent=None) telemetry may come from a sub-agent message"
            );
        });
    }

    #[test]
    fn assistant_ask_user_question_emits_tool_call_and_question_request() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                            id: "toolu_question_001".to_string(),
                            name: "AskUserQuestion".to_string(),
                            input: serde_json::json!({
                                "questions": [
                                    {
                                        "question": "Which branch should I use?",
                                        "header": "Branch",
                                        "options": [
                                            {
                                                "label": "main",
                                                "description": "Use the default branch"
                                            }
                                        ],
                                        "multiSelect": false
                                    }
                                ]
                            }),
                        })],
                        model: Some("claude-opus-4-6".to_string()),
                        usage: None,
                        error: None,
                        parent_tool_use_id: None,
                    },
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 2);
            match &updates[0] {
                SessionUpdate::ToolCall { tool_call, .. } => {
                    assert_eq!(tool_call.id, "toolu_question_001");
                    assert_eq!(tool_call.kind, Some(ToolKind::Question));
                    assert_eq!(
                        tool_call.normalized_questions.as_ref().map(Vec::len),
                        Some(1)
                    );
                }
                other => panic!("expected tool call update, got {:?}", other),
            }

            match &updates[1] {
                SessionUpdate::QuestionRequest { question, .. } => {
                    assert_eq!(question.id, "toolu_question_001");
                    assert_eq!(question.session_id, "ses-test");
                    assert_eq!(question.questions.len(), 1);
                    assert_eq!(
                        question.tool.as_ref().map(|tool| tool.call_id.as_str()),
                        Some("toolu_question_001")
                    );
                    assert_eq!(
                        question
                            .tool
                            .as_ref()
                            .and_then(|tool| tool.message_id.as_deref()),
                        None
                    );
                }
                other => panic!("expected question request update, got {:?}", other),
            }
        });
    }

    #[test]
    fn assistant_ask_user_question_without_session_id_does_not_emit_fake_question_session() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                            id: "toolu_question_no_session".to_string(),
                            name: "AskUserQuestion".to_string(),
                            input: serde_json::json!({
                                "questions": [
                                    {
                                        "question": "Continue?",
                                        "header": "Decision",
                                        "options": [
                                            {
                                                "label": "yes",
                                                "description": "Continue"
                                            }
                                        ],
                                        "multiSelect": false
                                    }
                                ]
                            }),
                        })],
                        model: Some("claude-opus-4-6".to_string()),
                        usage: None,
                        error: None,
                        parent_tool_use_id: None,
                    },
                },
                None,
            );

            assert_eq!(updates.len(), 1);
            assert!(matches!(updates[0], SessionUpdate::ToolCall { .. }));
        });
    }

    #[test]
    fn assistant_tool_use_with_null_input_does_not_panic() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::Assistant {
                    message: cc_sdk::AssistantMessage {
                        content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                            id: "toolu_read_003".to_string(),
                            name: "Read".to_string(),
                            input: serde_json::Value::Null,
                        })],
                        model: Some("claude-opus-4-6".to_string()),
                        usage: None,
                        error: None,
                        parent_tool_use_id: None,
                    },
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.name, "Read");
                assert_eq!(tool_call.kind, Some(ToolKind::Read));
            } else {
                panic!("expected SessionUpdate::ToolCall");
            }
        });
    }

    #[test]
    fn content_block_start_bash_tool_has_execute_kind() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::StreamEvent {
                    uuid: "msg-002".to_string(),
                    session_id: "ses-test".to_string(),
                    event: serde_json::json!({
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {
                            "type": "tool_use",
                            "id": "toolu_bash_001",
                            "name": "Bash",
                            "input": {}
                        }
                    }),
                    parent_tool_use_id: None,
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.name, "Bash");
                assert_eq!(
                    tool_call.kind,
                    Some(ToolKind::Execute),
                    "content_block_start for Bash should set kind=Execute, got {:?}",
                    tool_call.kind,
                );
            } else {
                panic!("expected SessionUpdate::ToolCall, got {:?}", updates[0]);
            }
        });
    }

    #[test]
    fn content_block_start_preserves_parent_tool_use_id_for_subagent_tools() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
                AgentType::ClaudeCode,
                Message::StreamEvent {
                    uuid: "msg-003".to_string(),
                    session_id: "ses-test".to_string(),
                    event: serde_json::json!({
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {
                            "type": "tool_use",
                            "id": "toolu_child_001",
                            "name": "Read",
                            "input": {}
                        }
                    }),
                    parent_tool_use_id: Some("toolu_task_parent".to_string()),
                },
                Some("ses-test".to_string()),
            );

            assert_eq!(updates.len(), 1);
            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.id, "toolu_child_001");
                assert_eq!(tool_call.name, "Read");
                assert_eq!(
                    tool_call.parent_tool_use_id.as_deref(),
                    Some("toolu_task_parent")
                );
            } else {
                panic!("expected SessionUpdate::ToolCall, got {:?}", updates[0]);
            }
        });
    }

    #[test]
    fn auto_approved_bash_without_callback_surfaces_missing_result() {
        // When the CLI auto-approves a Bash command (e.g. read-only commands),
        // it executes without sending a can_use_tool control message.
        // If no ToolResult block arrives before the next assistant turn, Acepe
        // has no stdout/stderr to render and should surface that explicitly.
        let mut stream_state = CcSdkTurnStreamState::default();

        // Step 1: Bash tool_use starts on the stream
        let _ = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-bash-start".to_string(),
                session_id: "ses-auto-approve".to_string(),
                event: serde_json::json!({
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {
                        "type": "tool_use",
                        "id": "toolu_auto_bash",
                        "name": "Bash",
                        "input": {
                            "command": "pwd && ls"
                        }
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-auto-approve".to_string()),
            &mut stream_state,
        );

        // Step 2: message_delta with stop_reason=tool_use
        let _ = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-bash-stop".to_string(),
                session_id: "ses-auto-approve".to_string(),
                event: serde_json::json!({
                    "type": "message_delta",
                    "delta": {
                        "stop_reason": "tool_use"
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-auto-approve".to_string()),
            &mut stream_state,
        );

        // Step 3: Next message_start arrives (CLI executed the tool,
        // Claude got the result, and is continuing).
        // No can_use_tool callback was ever received.
        let updates = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-next-start".to_string(),
                session_id: "ses-auto-approve".to_string(),
                event: serde_json::json!({
                    "type": "message_start",
                    "message": {
                        "content": [],
                        "model": "claude-opus-4-6"
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("ses-auto-approve".to_string()),
            &mut stream_state,
        );

        // The bridge should not synthesize an empty success for Bash. If the
        // provider resumes without a result block, Acepe cannot render stdout.
        let synthetic_update = updates.iter().find(|update| {
            matches!(
                update,
                SessionUpdate::ToolCallUpdate { update, .. }
                    if update.tool_call_id == "toolu_auto_bash"
            )
        });

        assert!(
            synthetic_update.is_some(),
            "bridge should synthesize a terminal update for the auto-approved Bash tool"
        );

        if let Some(SessionUpdate::ToolCallUpdate { update, .. }) = synthetic_update {
            assert_eq!(update.status, Some(ToolCallStatus::Completed));
            assert_eq!(update.failure_reason, None);
            assert_eq!(
                update
                    .result
                    .as_ref()
                    .and_then(|result| result.get("stderr"))
                    .and_then(|value| value.as_str()),
                Some(MISSING_TOOL_RESULT_MESSAGE)
            );
        }
    }

    #[test]
    fn user_tool_result_completes_pending_bash_and_prevents_missing_result_fallback() {
        let mut stream_state = CcSdkTurnStreamState::default();

        let _ = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-bash-start".to_string(),
                session_id: "session-with-result".to_string(),
                event: serde_json::json!({
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {
                        "type": "tool_use",
                        "id": "toolu_bash_with_result",
                        "name": "Bash",
                        "input": {
                            "command": "printf hello"
                        }
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("session-with-result".to_string()),
            &mut stream_state,
        );

        let _ = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-bash-stop".to_string(),
                session_id: "session-with-result".to_string(),
                event: serde_json::json!({
                    "type": "message_delta",
                    "delta": {
                        "stop_reason": "tool_use"
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("session-with-result".to_string()),
            &mut stream_state,
        );

        let result_updates = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::Assistant {
                message: cc_sdk::AssistantMessage {
                    content: vec![cc_sdk::ContentBlock::ToolResult(
                        cc_sdk::ToolResultContent {
                            tool_use_id: "toolu_bash_with_result".to_string(),
                            content: Some(cc_sdk::ContentValue::Text("hello".to_string())),
                            is_error: Some(false),
                        },
                    )],
                    model: None,
                    usage: None,
                    error: None,
                    parent_tool_use_id: None,
                },
            },
            Some("session-with-result".to_string()),
            &mut stream_state,
        );

        assert!(
            result_updates.iter().any(|update| matches!(
                update,
                SessionUpdate::ToolCallUpdate { update, .. }
                    if update.tool_call_id == "toolu_bash_with_result"
                        && update.status == Some(ToolCallStatus::Completed)
                        && update.result.as_ref().and_then(|result| result.as_str()) == Some("hello")
            )),
            "tool result text should be materialized into the tool call result"
        );

        let resume_updates = super::translate_cc_sdk_message_with_mut_turn_state(
            AgentType::ClaudeCode,
            Message::StreamEvent {
                uuid: "msg-next-start".to_string(),
                session_id: "session-with-result".to_string(),
                event: serde_json::json!({
                    "type": "message_start",
                    "message": {
                        "content": [],
                        "model": "claude-sonnet-4-6"
                    }
                }),
                parent_tool_use_id: None,
            },
            Some("session-with-result".to_string()),
            &mut stream_state,
        );

        assert!(
            !resume_updates.iter().any(|update| matches!(
                update,
                SessionUpdate::ToolCallUpdate { update, .. }
                    if update.tool_call_id == "toolu_bash_with_result"
                        && update.result.as_ref().and_then(|result| result.get("stderr")).and_then(|value| value.as_str()) == Some(MISSING_TOOL_RESULT_MESSAGE)
            )),
            "resolved tool results must not be replaced by the missing-result fallback"
        );
    }
}
