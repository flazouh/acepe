//! Translation layer from cc-sdk [`cc_sdk::Message`] to Acepe [`SessionUpdate`] events.
//!
//! This module provides a single entry point, [`translate_cc_sdk_message`], that converts
//! a single cc-sdk protocol message into zero or more Acepe session update events.

use crate::acp::session_update::{
    ContentChunk, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData,
    TurnErrorData, UsageTelemetryData, UsageTelemetryTokens,
};
use crate::acp::types::ContentBlock;
use cc_sdk::Message;

#[derive(Debug, Clone, Copy, Default)]
pub struct CcSdkTurnStreamState {
    pub saw_text_delta: bool,
    pub saw_thinking_delta: bool,
}

/// Translates a cc-sdk Message into zero or more Acepe SessionUpdate events.
///
/// `session_id` is the Acepe session ID for this conversation. For stream events,
/// the SDK-provided session ID is used as a fallback when `session_id` is `None`.
pub fn translate_cc_sdk_message(msg: Message, session_id: Option<String>) -> Vec<SessionUpdate> {
    translate_cc_sdk_message_with_turn_state(msg, session_id, CcSdkTurnStreamState::default())
}

pub fn translate_cc_sdk_message_with_turn_state(
    msg: Message,
    session_id: Option<String>,
    stream_state: CcSdkTurnStreamState,
) -> Vec<SessionUpdate> {
    match msg {
        Message::Assistant { message } => translate_assistant(message, session_id, stream_state),

        Message::StreamEvent {
            session_id: sdk_sid,
            event,
            ..
        } => {
            let effective_sid = session_id.or(Some(sdk_sid));
            translate_stream_event(event, effective_sid)
        }

        Message::Result {
            is_error,
            session_id: sdk_sid,
            usage,
            total_cost_usd,
            result,
            ..
        } => {
            let effective_sid = session_id.or(Some(sdk_sid));
            translate_result(is_error, usage, total_cost_usd, result, effective_sid)
        }

        // User, System, RateLimit, Unknown → nothing
        _ => vec![],
    }
}

// ---------------------------------------------------------------------------
// Assistant message translation
// ---------------------------------------------------------------------------

fn translate_assistant(
    message: cc_sdk::AssistantMessage,
    session_id: Option<String>,
    stream_state: CcSdkTurnStreamState,
) -> Vec<SessionUpdate> {
    let mut updates: Vec<SessionUpdate> = Vec::new();

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
                    },
                    part_id: None,
                    message_id: None,
                    session_id: session_id.clone(),
                });
            }

            cc_sdk::ContentBlock::ToolUse(tu) => {
                let tool_call = ToolCallData {
                    id: tu.id,
                    name: tu.name,
                    arguments: ToolArguments::Other { raw: tu.input },
                    status: ToolCallStatus::InProgress,
                    result: None,
                    kind: None,
                    title: None,
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    parent_tool_use_id: parent_tool_use_id.clone(),
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                };
                updates.push(SessionUpdate::ToolCall {
                    tool_call,
                    session_id: session_id.clone(),
                });
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
    if let Some(usage) = message.usage {
        if let Some(telemetry) = build_usage_telemetry_from_json(&usage, session_id.clone()) {
            updates.push(SessionUpdate::UsageTelemetryUpdate { data: telemetry });
        }
    }

    updates
}

// ---------------------------------------------------------------------------
// Stream event translation
// ---------------------------------------------------------------------------

fn translate_stream_event(
    event: serde_json::Value,
    session_id: Option<String>,
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

            let tool_call = ToolCallData {
                id,
                name,
                arguments: ToolArguments::Other {
                    raw: serde_json::Value::Null,
                },
                status: ToolCallStatus::InProgress,
                result: None,
                kind: None,
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
            };

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
                    let text = match delta.get("text").and_then(|v| v.as_str()) {
                        Some(t) => t.to_string(),
                        None => return vec![],
                    };
                    vec![SessionUpdate::AgentMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text { text },
                        },
                        part_id: None,
                        message_id: None,
                        session_id,
                    }]
                }

                "thinking_delta" => {
                    let thinking = match delta.get("thinking").and_then(|v| v.as_str()) {
                        Some(t) => t.to_string(),
                        None => return vec![],
                    };
                    vec![SessionUpdate::AgentThoughtChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text { text: thinking },
                        },
                        part_id: None,
                        message_id: None,
                        session_id,
                    }]
                }

                // input_json_delta: tool argument streaming.
                // The `tool_use_id` is not on the delta event itself (it's on `content_block_start`).
                // Tracking index→id state requires a stateful bridge; for now we skip these deltas
                // and rely on Message::Assistant for the complete tool arguments.
                // TODO(006): implement stateful index→tool_call_id tracking for streaming tool args.
                _ => vec![],
            }
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
    total_cost_usd: Option<f64>,
    result: Option<String>,
    session_id: Option<String>,
) -> Vec<SessionUpdate> {
    let mut updates: Vec<SessionUpdate> = Vec::new();

    // Emit usage telemetry if we have usage data or a cost figure
    if usage.is_some() || total_cost_usd.is_some() {
        let telemetry = build_result_telemetry(usage, total_cost_usd, session_id.clone());
        updates.push(SessionUpdate::UsageTelemetryUpdate { data: telemetry });
    }

    if is_error {
        updates.push(SessionUpdate::TurnError {
            error: TurnErrorData::Legacy(result.unwrap_or_else(|| "Turn failed".to_string())),
            session_id,
        });
    } else {
        updates.push(SessionUpdate::TurnComplete { session_id });
    }

    updates
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
    total_cost_usd: Option<f64>,
    session_id: Option<String>,
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
        source_model_id: None,
        timestamp_ms: None,
        context_window_size: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{translate_cc_sdk_message_with_turn_state, CcSdkTurnStreamState};
    use crate::acp::session_update::SessionUpdate;
    use crate::acp::types::ContentBlock;
    use cc_sdk::{
        AssistantMessage, ContentBlock as CcContentBlock, Message, TextContent, ThinkingContent,
    };

    #[test]
    fn translates_assistant_text_when_no_stream_delta_arrived() {
        let updates = translate_cc_sdk_message_with_turn_state(
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
            },
        );

        assert!(updates.is_empty());
    }

    #[test]
    fn translates_assistant_thinking_when_no_stream_delta_arrived() {
        let updates = translate_cc_sdk_message_with_turn_state(
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
}
