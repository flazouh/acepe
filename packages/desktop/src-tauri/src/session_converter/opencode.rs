use crate::acp::parsers::{AgentParser, OpenCodeParser};
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, ContentChunk, RawToolCallInput,
    RawToolCallUpdateInput, SessionUpdate, ToolCallStatus,
};
use crate::acp::types::ContentBlock;
use crate::opencode_history::types::{OpenCodeApiToolState, OpenCodeMessage, OpenCodeMessagePart};
use crate::session_jsonl::display_names::format_model_display_name;
use crate::session_jsonl::types::{ConvertedSession, StoredEntry};
use chrono::{DateTime, Utc};

fn map_summary_status(status: &str) -> ToolCallStatus {
    match status {
        "completed" => ToolCallStatus::Completed,
        "error" | "failed" => ToolCallStatus::Failed,
        "running" => ToolCallStatus::InProgress,
        _ => ToolCallStatus::Pending,
    }
}

fn map_open_code_initial_status(state: Option<&OpenCodeApiToolState>) -> ToolCallStatus {
    match state.map(|value| value.status.as_str()) {
        Some("running") => ToolCallStatus::InProgress,
        _ => ToolCallStatus::Pending,
    }
}

fn parse_task_children_from_metadata(
    parent_id: &str,
    metadata: Option<&serde_json::Value>,
) -> Option<Vec<RawToolCallInput>> {
    let summary = metadata?.get("summary")?.as_array()?;
    if summary.is_empty() {
        return None;
    }

    let mut children = Vec::with_capacity(summary.len());
    for (index, item) in summary.iter().enumerate() {
        let tool_name = item.get("tool").and_then(|value| value.as_str()).unwrap_or("Tool");
        let state = item.get("state");
        let title = state
            .and_then(|value| value.get("title"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string);
        let status = state
            .and_then(|value| value.get("status"))
            .and_then(|value| value.as_str())
            .map(map_summary_status)
            .unwrap_or(ToolCallStatus::Pending);
        let tool_input = state
            .and_then(|value| value.get("input"))
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let tool_kind = OpenCodeParser.detect_tool_kind(tool_name);

        children.push(RawToolCallInput {
            id: format!("{parent_id}:summary-{index}"),
            provider_tool_name: Some(tool_name.to_string()),
            provider_declared_kind: Some(tool_kind),
            arguments: tool_input,
            status,
            title,
            suppress_title_read_path_hint: false,
            parent_tool_use_id: Some(parent_id.to_string()),
            task_children: None,
        });
    }

    Some(children)
}

/// Convert OpenCode messages to ConvertedSession format.
pub fn convert_opencode_messages_to_session(
    messages: Vec<OpenCodeMessage>,
) -> Result<ConvertedSession, String> {
    let parser = OpenCodeParser;
    let mut updates: Vec<(u64, SessionUpdate)> = Vec::new();

    for (index, message) in messages.iter().enumerate() {
        let timestamp_ms = message
            .timestamp
            .as_deref()
            .and_then(parse_timestamp_ms)
            .unwrap_or(index as u64);

        match message.role.as_str() {
            "user" => push_user_updates(&mut updates, message, timestamp_ms, &parser),
            "assistant" => push_assistant_updates(&mut updates, message, timestamp_ms, &parser),
            _ => {}
        }
    }

    let title = messages
        .iter()
        .find(|message| message.role == "user")
        .and_then(first_text_part)
        .map(|text| text.chars().take(50).collect::<String>())
        .unwrap_or_else(|| "OpenCode Session".to_string());

    let mut converted = crate::copilot_history::convert_replay_updates_to_session(
        "opencode-replay",
        &title,
        &updates,
    );

    if let Some(created_at) = messages.first().and_then(|message| message.timestamp.clone()) {
        converted.created_at = created_at;
    }

    decorate_replay_transcript_entries(&mut converted, &messages);

    Ok(converted)
}

fn push_user_updates(
    updates: &mut Vec<(u64, SessionUpdate)>,
    message: &OpenCodeMessage,
    timestamp_ms: u64,
    parser: &OpenCodeParser,
) {
    for part in &message.parts {
        match part {
            OpenCodeMessagePart::Text { text } => {
                if text.trim().is_empty() {
                    continue;
                }
                updates.push((
                    timestamp_ms,
                    SessionUpdate::UserMessageChunk {
                        chunk: text_chunk(text.clone()),
                        session_id: None,
                    },
                ));
            }
            OpenCodeMessagePart::ToolResult {
                tool_use_id,
                content,
            } => {
                updates.push((
                    timestamp_ms,
                    SessionUpdate::ToolCallUpdate {
                        update: build_tool_call_update_from_raw(
                            parser,
                            RawToolCallUpdateInput {
                                id: tool_use_id.clone(),
                                provider_tool_name: None,
                                provider_declared_kind: None,
                                status: Some(ToolCallStatus::Completed),
                                result: Some(serde_json::Value::String(content.clone())),
                                content: None,
                                title: None,
                                locations: None,
                                streaming_input_delta: None,
                                raw_input: None,
                            },
                            Some("opencode-replay"),
                        ),
                        session_id: None,
                    },
                ));
            }
            OpenCodeMessagePart::ToolInvocation { .. } => {}
        }
    }
}

fn push_assistant_updates(
    updates: &mut Vec<(u64, SessionUpdate)>,
    message: &OpenCodeMessage,
    timestamp_ms: u64,
    parser: &OpenCodeParser,
) {
    for part in &message.parts {
        match part {
            OpenCodeMessagePart::Text { text } => {
                if text.trim().is_empty() {
                    continue;
                }
                updates.push((
                    timestamp_ms,
                    SessionUpdate::AgentMessageChunk {
                        chunk: text_chunk(text.clone()),
                        part_id: None,
                        message_id: Some(message.id.clone()),
                        session_id: None,
                    },
                ));
            }
            OpenCodeMessagePart::ToolInvocation {
                id,
                name,
                input,
                state,
            } => {
                let tool_kind = OpenCodeParser.detect_tool_kind(name);
                let tool_input = state
                    .as_ref()
                    .and_then(|value| value.input.clone())
                    .unwrap_or_else(|| input.clone());
                let task_children = if name.to_lowercase().contains("task") {
                    parse_task_children_from_metadata(
                        id,
                        state.as_ref().and_then(|value| value.metadata.as_ref()),
                    )
                } else {
                    None
                };

                updates.push((
                    timestamp_ms,
                    SessionUpdate::ToolCall {
                        tool_call: build_tool_call_from_raw(
                            parser,
                            RawToolCallInput {
                                id: id.clone(),
                                provider_tool_name: Some(name.clone()),
                                provider_declared_kind: Some(tool_kind),
                                arguments: tool_input.clone(),
                                status: map_open_code_initial_status(state.as_ref()),
                                title: None,
                                suppress_title_read_path_hint: false,
                                parent_tool_use_id: None,
                                task_children,
                            },
                        ),
                        session_id: None,
                    },
                ));

                if let Some(update) = build_terminal_tool_update(parser, id, name, &tool_input, state) {
                    updates.push((timestamp_ms, update));
                }
            }
            OpenCodeMessagePart::ToolResult { .. } => {}
        }
    }
}

fn build_terminal_tool_update(
    parser: &OpenCodeParser,
    id: &str,
    name: &str,
    tool_input: &serde_json::Value,
    state: &Option<OpenCodeApiToolState>,
) -> Option<SessionUpdate> {
    let state = state.as_ref()?;
    let (status, result) = match state.status.as_str() {
        "completed" => (
            ToolCallStatus::Completed,
            state
                .output
                .as_ref()
                .map(|value| serde_json::Value::String(value.clone())),
        ),
        "error" | "failed" => (
            ToolCallStatus::Failed,
            state
                .error
                .as_ref()
                .map(|value| serde_json::Value::String(value.clone())),
        ),
        _ => return None,
    };

    Some(SessionUpdate::ToolCallUpdate {
        update: build_tool_call_update_from_raw(
            parser,
            RawToolCallUpdateInput {
                id: id.to_string(),
                provider_tool_name: Some(name.to_string()),
                provider_declared_kind: Some(OpenCodeParser.detect_tool_kind(name)),
                status: Some(status),
                result,
                content: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                raw_input: Some(tool_input.clone()),
            },
            Some("opencode-replay"),
        ),
        session_id: None,
    })
}

fn decorate_replay_transcript_entries(
    converted: &mut ConvertedSession,
    messages: &[OpenCodeMessage],
) {
    let user_specs = messages
        .iter()
        .filter(|message| message.role == "user")
        .filter_map(|message| {
            first_text_part(message).map(|_| (message.id.clone(), message.timestamp.clone()))
        })
        .collect::<Vec<_>>();
    let assistant_specs = messages
        .iter()
        .filter(|message| message.role == "assistant")
        .filter_map(|message| {
            first_text_part(message).map(|_| {
                (
                    message.id.clone(),
                    message.timestamp.clone(),
                    message.model.clone(),
                )
            })
        })
        .collect::<Vec<_>>();

    let mut next_user = 0usize;
    let mut next_assistant = 0usize;

    for entry in &mut converted.entries {
        match entry {
            StoredEntry::User {
                id,
                message,
                timestamp,
            } => {
                let Some((original_id, original_timestamp)) = user_specs.get(next_user) else {
                    continue;
                };
                *id = original_id.clone();
                message.id = Some(original_id.clone());
                message.sent_at = original_timestamp.clone();
                *timestamp = original_timestamp.clone();
                next_user += 1;
            }
            StoredEntry::Assistant {
                id,
                message,
                timestamp,
            } => {
                let Some((original_id, original_timestamp, model)) =
                    assistant_specs.get(next_assistant)
                else {
                    continue;
                };
                *id = original_id.clone();
                message.model = model.clone();
                message.display_model = model.as_ref().map(|value| format_model_display_name(value));
                message.received_at = original_timestamp.clone();
                *timestamp = original_timestamp.clone();
                next_assistant += 1;
            }
            StoredEntry::ToolCall { .. } => {}
        }
    }
}

fn first_text_part(message: &OpenCodeMessage) -> Option<&str> {
    message.parts.iter().find_map(|part| match part {
        OpenCodeMessagePart::Text { text } if !text.trim().is_empty() => Some(text.as_str()),
        _ => None,
    })
}

fn text_chunk(text: String) -> ContentChunk {
    ContentChunk {
        content: ContentBlock::Text { text },
        aggregation_hint: None,
    }
}

fn parse_timestamp_ms(timestamp: &str) -> Option<u64> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|value| value.with_timezone(&Utc).timestamp_millis())
        .and_then(|value| u64::try_from(value).ok())
}
