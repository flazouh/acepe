//! Translation layer from cc-sdk [`cc_sdk::Message`] to Acepe [`SessionUpdate`] events.
//!
//! This module provides a single entry point, [`translate_cc_sdk_message`], that converts
//! a single cc-sdk protocol message into zero or more Acepe session update events.

use std::collections::{HashMap, VecDeque};

use super::{get_parser, AgentType};
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, ContentChunk, QuestionData,
    RawToolCallInput, RawToolCallUpdateInput, SessionUpdate, ToolArguments, ToolCallData,
    ToolCallStatus, ToolCallUpdateData, ToolKind, ToolReference, TurnErrorData, UsageTelemetryData,
    UsageTelemetryTokens,
};
use crate::acp::types::ContentBlock;
use crate::cc_sdk::{self as cc_sdk, Message};

#[derive(Debug, Clone, Default)]
pub struct CcSdkTurnStreamState {
    pub saw_text_delta: bool,
    pub saw_thinking_delta: bool,
    /// Model ID extracted from `message_start` stream events or `Assistant` messages.
    pub model_id: Option<String>,
    /// content_block_start index -> (tool_use_id, tool_name) for streamed tool input deltas.
    pub stream_tool_blocks: HashMap<u64, (String, String)>,
    /// Pending non-question tool calls that should be settled when Claude resumes a turn.
    pub pending_tool_calls: VecDeque<PendingToolCallState>,
    /// True after Claude reports stop_reason=tool_use and before the next message_start arrives.
    pub awaiting_tool_turn_resume: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingToolCallState {
    pub tool_call_id: String,
    pub tool_name: String,
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

fn take_synthetic_tool_completions_for_resumed_tool_turn(
    stream_state: &mut CcSdkTurnStreamState,
    session_id: &Option<String>,
) -> Vec<SessionUpdate> {
    let mut synthetic_updates = Vec::new();

    while let Some(pending_tool_call) = stream_state.pending_tool_calls.pop_front() {
        // When the next message_start arrives with pending tool calls still unresolved,
        // it means the CLI handled the tool without going through can_use_tool (e.g.
        // auto-approved Bash commands). Mark as Completed — if Claude is continuing,
        // the CLI resolved the tool one way or another.
        synthetic_updates.push(SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: pending_tool_call.tool_call_id,
                status: Some(ToolCallStatus::Completed),
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
                stream_state.model_id.as_deref(),
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

    let parent_tool_use_id = message.parent_tool_use_id.clone();

    for block in message.content {
        match block {
            // Prefer stream deltas when present, but fall back to final Assistant blocks
            // when the SDK emits only the completed assistant message for a turn.
            cc_sdk::ContentBlock::Text(text) => {
                if stream_state.saw_text_delta {
                    continue;
                }

                updates.push(SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text { text: text.text },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: None,
                    session_id: session_id.clone(),
                });
            }

            cc_sdk::ContentBlock::Thinking(thinking) => {
                if stream_state.saw_thinking_delta {
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
                    session_id: session_id.clone(),
                });
            }

            cc_sdk::ContentBlock::ToolUse(tu) => {
                let parser = get_parser(agent);
                let raw = RawToolCallInput {
                    id: tu.id,
                    name: tu.name,
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

                // Extract text from content, if any
                let content_blocks = tr.content.map(|cv| match cv {
                    cc_sdk::ContentValue::Text(s) => {
                        vec![ContentBlock::Text { text: s }]
                    }
                    cc_sdk::ContentValue::Structured(_) => vec![],
                });

                updates.push(SessionUpdate::ToolCallUpdate {
                    update: ToolCallUpdateData {
                        tool_call_id: tr.tool_use_id,
                        status: Some(status),
                        content: content_blocks,
                        ..Default::default()
                    },
                    session_id: session_id.clone(),
                });
            }
        }
    }

    // Emit usage telemetry if present
    if parent_tool_use_id.is_none() {
        if let Some(usage) = message.usage {
            if let Some(telemetry) = build_usage_telemetry_from_json(&usage, session_id.clone()) {
                updates.push(SessionUpdate::UsageTelemetryUpdate { data: telemetry });
            }
        }
    }

    updates
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

    let question = QuestionData {
        id: tool_call.id.clone(),
        session_id: session_id.clone().unwrap_or_default(),
        json_rpc_request_id: None,
        reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::http(
            tool_call.id.clone(),
        )),
        questions,
        tool: Some(ToolReference {
            message_id: String::new(),
            call_id: tool_call.id.clone(),
        }),
    };

    Some(SessionUpdate::QuestionRequest {
        question,
        session_id: session_id.clone(),
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
                .unwrap_or("unknown")
                .to_string();

            let detected_kind = get_parser(agent).detect_tool_kind(&name);
            let kind = if detected_kind != ToolKind::Other {
                Some(detected_kind)
            } else {
                None
            };
            if let Some(index) = event.get("index").and_then(|v| v.as_u64()) {
                stream_state
                    .stream_tool_blocks
                    .insert(index, (id.clone(), name.clone()));
            }
            let tool_call = ToolCallData {
                id,
                name,
                arguments: ToolArguments::Other {
                    raw: serde_json::Value::Null,
                },
                raw_input: block.get("input").cloned(),
                status: ToolCallStatus::InProgress,
                result: None,
                kind,
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
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
                    stream_state.saw_text_delta = true;
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
                        session_id,
                    }]
                }

                "thinking_delta" => {
                    stream_state.saw_thinking_delta = true;
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
                        match stream_state.stream_tool_blocks.get(&index) {
                            Some((tool_call_id, tool_name)) => {
                                (tool_call_id.clone(), tool_name.clone())
                            }
                            None => return vec![],
                        };
                    let parser = get_parser(agent);
                    let raw = RawToolCallUpdateInput {
                        id: tool_call_id,
                        status: None,
                        result: None,
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
                stream_state.stream_tool_blocks.remove(&index);
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
    model_id: Option<&str>,
) -> Vec<SessionUpdate> {
    let mut updates: Vec<SessionUpdate> = Vec::new();

    // Emit usage telemetry if we have usage data or a cost figure
    if usage.is_some() || total_cost_usd.is_some() {
        let telemetry = build_result_telemetry(
            usage,
            model_usage,
            total_cost_usd,
            session_id.clone(),
            model_id,
        );
        updates.push(SessionUpdate::UsageTelemetryUpdate { data: telemetry });
    }

    if is_error {
        updates.push(SessionUpdate::TurnError {
            error: TurnErrorData::Legacy(result.unwrap_or_else(|| "Turn failed".to_string())),
            session_id,
            turn_id: None,
        });
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
    if subtype != "usage_update" {
        return vec![];
    }

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

    let telemetry = UsageTelemetryData {
        session_id: sid,
        event_id,
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
    };

    vec![SessionUpdate::UsageTelemetryUpdate { data: telemetry }]
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
fn build_usage_telemetry_from_json(
    usage: &serde_json::Value,
    session_id: Option<String>,
) -> Option<UsageTelemetryData> {
    let sid = session_id?;

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
        source_model_id: None,
        timestamp_ms: None,
        context_window_size: None,
    })
}

/// Build `UsageTelemetryData` from a Result message where `session_id` is always present.
fn build_result_telemetry(
    usage: Option<serde_json::Value>,
    model_usage: Option<serde_json::Value>,
    total_cost_usd: Option<f64>,
    session_id: Option<String>,
    model_id: Option<&str>,
) -> UsageTelemetryData {
    let sid = session_id.unwrap_or_default();

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

    let total = match (input, output) {
        (Some(i), Some(o)) => Some(i + o + cache_read.unwrap_or(0) + cache_write.unwrap_or(0)),
        _ => None,
    };

    UsageTelemetryData {
        session_id: sid,
        event_id: None,
        scope: "step".to_string(),
        cost_usd: total_cost_usd,
        tokens: UsageTelemetryTokens {
            total,
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
    }
}

#[cfg(test)]
mod tests {
    use super::{
        translate_cc_sdk_message, translate_cc_sdk_message_with_turn_state, CcSdkTurnStreamState,
    };
    use crate::acp::agent_context::with_agent;
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::{
        build_tool_call_update_from_raw, RawToolCallUpdateInput, SessionUpdate, ToolArguments,
        ToolCallStatus, ToolKind,
    };
    use crate::acp::types::ContentBlock;
    use crate::cc_sdk::{
        self as cc_sdk, AssistantMessage, ContentBlock as CcContentBlock, Message, TextContent,
        ThinkingContent,
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

        assert_eq!(updates.len(), 1);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(data.tokens.total, Some(0));
            assert_eq!(data.context_window_size, Some(200000));
        } else {
            panic!("Expected UsageTelemetryUpdate");
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
    fn next_message_start_completes_unresolved_tool_without_callback() {
        // When a tool_use is pending and the next message_start arrives without
        // a can_use_tool callback, the CLI handled the tool on its own (e.g.
        // auto-approved). The bridge should mark it Completed, not Failed.
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
            )),
            "bridge should synthesize a completed terminal update for unresolved tool_use turns when the CLI handles them without can_use_tool"
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
    fn assistant_subagent_tool_use_does_not_emit_usage_telemetry() {
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

            assert_eq!(
                updates.len(),
                1,
                "subagent child usage should not emit parent-session telemetry"
            );
            assert!(
                updates
                    .iter()
                    .all(|update| !matches!(update, SessionUpdate::UsageTelemetryUpdate { .. })),
                "subagent child assistant messages should not emit usage telemetry"
            );

            if let SessionUpdate::ToolCall { tool_call, .. } = &updates[0] {
                assert_eq!(tool_call.id, "toolu_child_telemetry_001");
                assert_eq!(tool_call.kind, Some(ToolKind::Execute));
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
                }
                other => panic!("expected question request update, got {:?}", other),
            }
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
    fn auto_approved_bash_without_callback_completes_not_fails() {
        // When the CLI auto-approves a Bash command (e.g. read-only commands),
        // it executes without sending a can_use_tool control message.
        // The bridge should mark such tools as Completed, not Failed,
        // because the CLI handled the tool successfully.
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

        // The bridge should synthesize a Completed update, not Failed.
        // The CLI handled the tool — the bridge should not second-guess it.
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
            assert_eq!(
                update.status,
                Some(ToolCallStatus::Completed),
                "auto-approved Bash tool should be marked Completed, not Failed"
            );
            assert!(
                update.failure_reason.is_none(),
                "auto-approved Bash tool should have no failure_reason, got: {:?}",
                update.failure_reason
            );
        }
    }
}
