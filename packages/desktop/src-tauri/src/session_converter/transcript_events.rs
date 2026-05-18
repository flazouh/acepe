use crate::acp::parsers::AgentType;
use crate::acp::transcript_projection::{CanonicalTranscriptEvent, CanonicalTranscriptEventKind};
use crate::cc_sdk::AssistantMessageError;
use crate::session_jsonl::types::{ContentBlock, FullSession, OrderedMessage};

pub(crate) fn materialize_canonical_transcript_events(
    session: &FullSession,
    source: AgentType,
) -> Vec<CanonicalTranscriptEvent> {
    let mut events = Vec::new();
    let mut message_index = 0;

    while message_index < session.messages.len() {
        let message = &session.messages[message_index];
        if message.is_meta {
            message_index += 1;
            continue;
        }

        match message.role.as_str() {
            "user" => {
                push_user_events(&mut events, message, source);
                message_index += 1;
            }
            "assistant" => {
                let group_end = assistant_fragment_group_end(&session.messages, message_index);
                push_assistant_group_events(
                    &mut events,
                    &session.messages[message_index..group_end],
                    source,
                );
                message_index = group_end;
            }
            _ => {
                message_index += 1;
            }
        }
    }

    for (index, event) in events.iter_mut().enumerate() {
        event.transcript_seq = index as u64;
    }

    events
}

fn push_user_events(
    events: &mut Vec<CanonicalTranscriptEvent>,
    message: &OrderedMessage,
    source: AgentType,
) {
    for (block_index, block) in message.content_blocks.iter().enumerate() {
        let ContentBlock::Text { text } = block else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }

        events.push(CanonicalTranscriptEvent {
            transcript_seq: 0,
            source,
            provider_row_id: message.uuid.clone(),
            provider_msg_id: message.provider_message_id.clone(),
            request_id: message.request_id.clone(),
            block_index,
            display_id: message.uuid.clone(),
            timestamp: message.timestamp.clone(),
            model: None,
            kind: CanonicalTranscriptEventKind::UserText { text: text.clone() },
        });
    }
}

fn push_assistant_group_events(
    events: &mut Vec<CanonicalTranscriptEvent>,
    messages: &[OrderedMessage],
    source: AgentType,
) {
    let ordered_messages = canonical_assistant_fragment_order(messages);
    for message in ordered_messages {
        push_assistant_message_events(events, message, source);
    }
}

fn push_assistant_message_events(
    events: &mut Vec<CanonicalTranscriptEvent>,
    message: &OrderedMessage,
    source: AgentType,
) {
    let split_count = count_assistant_text_segments(&message.content_blocks);
    let mut segment_index = 0;
    let mut active_display_id: Option<String> = None;

    for (block_index, block) in message.content_blocks.iter().enumerate() {
        match block {
            ContentBlock::Text { text } => {
                if text.trim().is_empty() {
                    continue;
                }
                let display_id = active_display_id.clone().unwrap_or_else(|| {
                    next_assistant_display_id(message, split_count, &mut segment_index)
                });
                active_display_id = Some(display_id.clone());
                events.push(CanonicalTranscriptEvent {
                    transcript_seq: 0,
                    source,
                    provider_row_id: message.uuid.clone(),
                    provider_msg_id: message.provider_message_id.clone(),
                    request_id: message.request_id.clone(),
                    block_index,
                    display_id,
                    timestamp: message.timestamp.clone(),
                    model: message.model.clone(),
                    kind: CanonicalTranscriptEventKind::AssistantText { text: text.clone() },
                });
            }
            ContentBlock::Thinking { thinking, .. } => {
                if thinking.trim().is_empty() {
                    continue;
                }
                let display_id = active_display_id.clone().unwrap_or_else(|| {
                    next_assistant_display_id(message, split_count, &mut segment_index)
                });
                active_display_id = Some(display_id.clone());
                events.push(CanonicalTranscriptEvent {
                    transcript_seq: 0,
                    source,
                    provider_row_id: message.uuid.clone(),
                    provider_msg_id: message.provider_message_id.clone(),
                    request_id: message.request_id.clone(),
                    block_index,
                    display_id,
                    timestamp: message.timestamp.clone(),
                    model: message.model.clone(),
                    kind: CanonicalTranscriptEventKind::AssistantThought {
                        text: thinking.clone(),
                    },
                });
            }
            ContentBlock::CodeAttachment {
                path,
                lines,
                content,
            } => {
                let header = match lines {
                    Some(line_range) => format!("File: {} (lines {})", path, line_range),
                    None => format!("File: {}", path),
                };
                let display_id = active_display_id.clone().unwrap_or_else(|| {
                    next_assistant_display_id(message, split_count, &mut segment_index)
                });
                active_display_id = Some(display_id.clone());
                events.push(CanonicalTranscriptEvent {
                    transcript_seq: 0,
                    source,
                    provider_row_id: message.uuid.clone(),
                    provider_msg_id: message.provider_message_id.clone(),
                    request_id: message.request_id.clone(),
                    block_index,
                    display_id,
                    timestamp: message.timestamp.clone(),
                    model: message.model.clone(),
                    kind: CanonicalTranscriptEventKind::AssistantText {
                        text: format!("{}\n```\n{}\n```", header, content),
                    },
                });
            }
            ContentBlock::ToolUse { id, name, input } => {
                active_display_id = None;
                events.push(CanonicalTranscriptEvent {
                    transcript_seq: 0,
                    source,
                    provider_row_id: message.uuid.clone(),
                    provider_msg_id: message.provider_message_id.clone(),
                    request_id: message.request_id.clone(),
                    block_index,
                    display_id: id.clone(),
                    timestamp: message.timestamp.clone(),
                    model: message.model.clone(),
                    kind: CanonicalTranscriptEventKind::ToolUse {
                        tool_call_id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                    },
                });
            }
            ContentBlock::ToolResult { .. } => {}
        }

        if let Some(error) = message.error.clone() {
            convert_last_assistant_text_to_error(events, error);
        }

        if active_display_id.is_none() {
            continue;
        }
    }
}

fn convert_last_assistant_text_to_error(
    events: &mut [CanonicalTranscriptEvent],
    error: AssistantMessageError,
) {
    let Some(event) = events.last_mut() else {
        return;
    };

    let text = match &event.kind {
        CanonicalTranscriptEventKind::AssistantText { text }
        | CanonicalTranscriptEventKind::AssistantThought { text } => text.clone(),
        CanonicalTranscriptEventKind::UserText { .. }
        | CanonicalTranscriptEventKind::AssistantError { .. }
        | CanonicalTranscriptEventKind::ToolUse { .. } => return,
    };

    event.kind = CanonicalTranscriptEventKind::AssistantError { text, error };
}

fn next_assistant_display_id(
    message: &OrderedMessage,
    split_count: usize,
    segment_index: &mut usize,
) -> String {
    let display_id = if split_count <= 1 {
        message.uuid.clone()
    } else {
        format!("{}:assistant:{}", message.uuid, *segment_index)
    };
    *segment_index += 1;
    display_id
}

fn assistant_fragment_group_end(messages: &[OrderedMessage], start_index: usize) -> usize {
    let start = &messages[start_index];
    let Some(request_id) = start.request_id.as_deref() else {
        return start_index + 1;
    };

    let mut end = start_index + 1;
    while end < messages.len() {
        let candidate = &messages[end];
        if candidate.is_meta
            || candidate.role != "assistant"
            || candidate.request_id.as_deref() != Some(request_id)
        {
            break;
        }
        end += 1;
    }

    end
}

fn canonical_assistant_fragment_order(messages: &[OrderedMessage]) -> Vec<&OrderedMessage> {
    if !should_place_split_tools_before_final_text(messages) {
        return messages.iter().collect();
    }

    let mut ordered = Vec::new();
    for message in messages {
        if is_tool_only_assistant_fragment(message) {
            ordered.push(message);
        }
    }
    for message in messages {
        if is_text_only_assistant_fragment(message) {
            ordered.push(message);
        }
    }
    ordered
}

fn block_is_visible_assistant_text(block: &ContentBlock) -> bool {
    match block {
        ContentBlock::Text { text } => !text.trim().is_empty(),
        ContentBlock::Thinking { thinking, .. } => !thinking.trim().is_empty(),
        ContentBlock::CodeAttachment { .. } => true,
        ContentBlock::ToolUse { .. } | ContentBlock::ToolResult { .. } => false,
    }
}

fn message_has_visible_assistant_text(message: &OrderedMessage) -> bool {
    message
        .content_blocks
        .iter()
        .any(block_is_visible_assistant_text)
}

fn message_has_tool_use(message: &OrderedMessage) -> bool {
    message
        .content_blocks
        .iter()
        .any(|block| matches!(block, ContentBlock::ToolUse { .. }))
}

fn is_text_only_assistant_fragment(message: &OrderedMessage) -> bool {
    message_has_visible_assistant_text(message) && !message_has_tool_use(message)
}

fn is_tool_only_assistant_fragment(message: &OrderedMessage) -> bool {
    message_has_tool_use(message) && !message_has_visible_assistant_text(message)
}

fn should_place_split_tools_before_final_text(messages: &[OrderedMessage]) -> bool {
    let mut saw_text_fragment = false;
    let mut saw_tool_fragment = false;
    let mut saw_text_after_tool = false;

    for message in messages {
        if !is_text_only_assistant_fragment(message) && !is_tool_only_assistant_fragment(message) {
            return false;
        }

        if is_tool_only_assistant_fragment(message) {
            saw_tool_fragment = true;
        }

        if is_text_only_assistant_fragment(message) {
            if saw_tool_fragment {
                saw_text_after_tool = true;
            }
            saw_text_fragment = true;
        }
    }

    saw_text_fragment && saw_tool_fragment && !saw_text_after_tool
}

fn count_assistant_text_segments(blocks: &[ContentBlock]) -> usize {
    let mut count = 0;
    let mut has_pending_chunks = false;

    for block in blocks {
        match block {
            ContentBlock::Text { text } => {
                if !text.trim().is_empty() {
                    has_pending_chunks = true;
                }
            }
            ContentBlock::Thinking { thinking, .. } => {
                if !thinking.trim().is_empty() {
                    has_pending_chunks = true;
                }
            }
            ContentBlock::CodeAttachment { .. } => {
                has_pending_chunks = true;
            }
            ContentBlock::ToolUse { .. } => {
                if has_pending_chunks {
                    count += 1;
                    has_pending_chunks = false;
                }
            }
            ContentBlock::ToolResult { .. } => {}
        }
    }

    if has_pending_chunks {
        count += 1;
    }

    count
}

#[cfg(test)]
mod tests {
    use super::{materialize_canonical_transcript_events, CanonicalTranscriptEventKind};
    use crate::acp::parsers::AgentType;
    use crate::session_jsonl::types::{ContentBlock, FullSession, OrderedMessage, SessionStats};
    use serde_json::json;

    fn session_with_messages(messages: Vec<OrderedMessage>) -> FullSession {
        FullSession {
            session_id: "session-1".to_string(),
            project_path: "/tmp/project".to_string(),
            title: "Test".to_string(),
            created_at: "2026-05-17T00:00:00Z".to_string(),
            messages,
            stats: SessionStats::default(),
        }
    }

    fn assistant_message(
        uuid: &str,
        request_id: &str,
        content_blocks: Vec<ContentBlock>,
    ) -> OrderedMessage {
        OrderedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            role: "assistant".to_string(),
            provider_message_id: None,
            timestamp: "2026-05-17T00:00:00Z".to_string(),
            content_blocks,
            model: None,
            usage: None,
            error: None,
            request_id: Some(request_id.to_string()),
            is_meta: false,
            source_tool_use_id: None,
            tool_use_result: None,
            source_tool_assistant_uuid: None,
        }
    }

    #[test]
    fn canonical_events_put_late_split_tools_before_final_text() {
        let session = session_with_messages(vec![
            assistant_message(
                "a-text",
                "req-1",
                vec![ContentBlock::Text {
                    text: "Final answer".to_string(),
                }],
            ),
            assistant_message(
                "a-tool",
                "req-1",
                vec![ContentBlock::ToolUse {
                    id: "toolu_1".to_string(),
                    name: "Read".to_string(),
                    input: json!({ "file_path": "/tmp/a" }),
                }],
            ),
        ]);

        let events = materialize_canonical_transcript_events(&session, AgentType::ClaudeCode);
        let kinds: Vec<&str> = events
            .iter()
            .map(|event| match event.kind {
                CanonicalTranscriptEventKind::ToolUse { .. } => "tool",
                CanonicalTranscriptEventKind::AssistantText { .. } => "assistant",
                CanonicalTranscriptEventKind::AssistantThought { .. } => "thought",
                CanonicalTranscriptEventKind::AssistantError { .. } => "error",
                CanonicalTranscriptEventKind::UserText { .. } => "user",
            })
            .collect();

        assert_eq!(kinds, vec!["tool", "assistant"]);
        assert_eq!(events[0].transcript_seq, 0);
        assert_eq!(events[1].transcript_seq, 1);
    }
}
