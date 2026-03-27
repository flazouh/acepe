//! Translation layer from cc-sdk [`cc_sdk::Message`] to Acepe [`SessionUpdate`] events.
//!
//! This module provides a single entry point, [`translate_cc_sdk_message`], that converts
//! a single cc-sdk protocol message into zero or more Acepe session update events.

use super::get_parser;
use crate::acp::agent_context::current_agent;
use crate::acp::session_update::{
    build_tool_call_from_raw, ContentChunk, RawToolCallInput, SessionUpdate, ToolArguments,
    ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind, TurnErrorData, UsageTelemetryData,
    UsageTelemetryTokens,
};
use crate::acp::types::ContentBlock;
use cc_sdk::Message;

#[derive(Debug, Clone, Default)]
pub struct CcSdkTurnStreamState {
    pub saw_text_delta: bool,
    pub saw_thinking_delta: bool,
    /// Model ID extracted from `message_start` stream events or `Assistant` messages.
    pub model_id: Option<String>,
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
            parent_tool_use_id,
            ..
        } => {
            let effective_sid = session_id.or(Some(sdk_sid));
            translate_stream_event(event, effective_sid, parent_tool_use_id)
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
            translate_result(
                is_error,
                usage,
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
                let parser = get_parser(current_agent());
                let raw = RawToolCallInput {
                    id: tu.id,
                    name: tu.name,
                    arguments: tu.input,
                    status: ToolCallStatus::InProgress,
                    kind: None,
                    title: None,
                    parent_tool_use_id: parent_tool_use_id.clone(),
                    task_children: None,
                };
                let tool_call = build_tool_call_from_raw(parser, raw);
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
    parent_tool_use_id: Option<String>,
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

            let detected_kind = get_parser(current_agent()).detect_tool_kind(&name);
            let kind = if detected_kind != ToolKind::Other {
                Some(detected_kind)
            } else {
                None
            };
            let tool_call = ToolCallData {
                id,
                name,
                arguments: ToolArguments::Other {
                    raw: serde_json::Value::Null,
                },
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
    model_id: Option<&str>,
) -> Vec<SessionUpdate> {
    let mut updates: Vec<SessionUpdate> = Vec::new();

    // Emit usage telemetry if we have usage data or a cost figure
    if usage.is_some() || total_cost_usd.is_some() {
        let telemetry = build_result_telemetry(usage, total_cost_usd, session_id.clone(), model_id);
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
        context_window_size: model_id.and_then(context_window_for_model),
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
        ToolKind,
    };
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
                model_id: None,
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

    #[test]
    fn translates_system_usage_update_with_context_window() {
        let updates = translate_cc_sdk_message_with_turn_state(
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
    fn result_telemetry_includes_context_window_when_model_is_known() {
        let updates = translate_cc_sdk_message_with_turn_state(
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
                result: None,
                structured_output: None,
                stop_reason: None,
            },
            Some("ses-result".to_string()),
            CcSdkTurnStreamState {
                saw_text_delta: false,
                saw_thinking_delta: false,
                model_id: Some("claude-sonnet-4-5-20250929".to_string()),
            },
        );

        // Should have UsageTelemetryUpdate + TurnComplete
        assert_eq!(updates.len(), 2);
        if let SessionUpdate::UsageTelemetryUpdate { data } = &updates[0] {
            assert_eq!(data.context_window_size, Some(200_000));
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
    fn content_block_start_write_tool_has_edit_kind() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
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
                    ToolArguments::Read { file_path } => {
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
    fn assistant_tool_use_with_null_input_does_not_panic() {
        with_agent(AgentType::ClaudeCode, || {
            let updates = translate_cc_sdk_message(
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
}
