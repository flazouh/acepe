use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_update::{build_tool_call_from_raw, RawToolCallInput, ToolCallStatus};
use crate::acp::transcript_projection::{CanonicalTranscriptEvent, CanonicalTranscriptEventKind};
use crate::acp::types::CanonicalAgentId;
use crate::cc_sdk::AssistantMessageError;
use crate::session_jsonl::types::{ContentBlock, FullSession, OrderedMessage};
use std::collections::HashSet;

pub fn materialize_canonical_transcript_events(
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

    let mut events = dedupe_canonical_tool_events(events);

    for (index, event) in events.iter_mut().enumerate() {
        event.transcript_seq = index as u64;
    }

    events
}

fn dedupe_canonical_tool_events(
    events: Vec<CanonicalTranscriptEvent>,
) -> Vec<CanonicalTranscriptEvent> {
    let mut seen_tool_call_ids = HashSet::new();

    events
        .into_iter()
        .filter(|event| match &event.kind {
            CanonicalTranscriptEventKind::ToolUse { tool_call_id, .. } => {
                seen_tool_call_ids.insert(normalize_tool_call_id(tool_call_id))
            }
            CanonicalTranscriptEventKind::UserText { .. }
            | CanonicalTranscriptEventKind::UserPastedContent { .. }
            | CanonicalTranscriptEventKind::AssistantText { .. }
            | CanonicalTranscriptEventKind::AssistantThought { .. }
            | CanonicalTranscriptEventKind::AssistantError { .. } => true,
        })
        .collect()
}

fn push_user_events(
    events: &mut Vec<CanonicalTranscriptEvent>,
    message: &OrderedMessage,
    source: AgentType,
) {
    for (block_index, block) in message.content_blocks.iter().enumerate() {
        let (text, kind) = match block {
            ContentBlock::Text { text } => (
                text,
                CanonicalTranscriptEventKind::UserText { text: text.clone() },
            ),
            ContentBlock::PastedContent { text } => (
                text,
                CanonicalTranscriptEventKind::UserPastedContent { text: text.clone() },
            ),
            _ => continue,
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
            kind,
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
                if message.parent_tool_use_id.is_some() {
                    continue;
                }
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
            ContentBlock::PastedContent { .. } => {}
            ContentBlock::Thinking {
                thinking,
                redacted_provider_data,
                ..
            } => {
                if message.parent_tool_use_id.is_some() {
                    continue;
                }
                let is_redacted_thought = redacted_provider_data.is_some();
                if thinking.trim().is_empty() && !is_redacted_thought {
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
                        redacted_provider_data: redacted_provider_data.clone(),
                    },
                });
            }
            ContentBlock::CodeAttachment {
                path,
                lines,
                content,
            } => {
                if message.parent_tool_use_id.is_some() {
                    continue;
                }
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
        | CanonicalTranscriptEventKind::AssistantThought { text, .. } => text.clone(),
        CanonicalTranscriptEventKind::UserText { .. }
        | CanonicalTranscriptEventKind::UserPastedContent { .. }
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
        ContentBlock::Text { text } | ContentBlock::PastedContent { text } => {
            !text.trim().is_empty()
        }
        ContentBlock::Thinking {
            thinking,
            redacted_provider_data,
            ..
        } => !thinking.trim().is_empty() || redacted_provider_data.is_some(),
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
            ContentBlock::Text { text } | ContentBlock::PastedContent { text } => {
                if !text.trim().is_empty() {
                    has_pending_chunks = true;
                }
            }
            ContentBlock::Thinking {
                thinking,
                redacted_provider_data,
                ..
            } => {
                let is_redacted_thought = redacted_provider_data.is_some();
                if !thinking.trim().is_empty() || is_redacted_thought {
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

/// Map a parsed `FullSession` to ingress events (shared by Cursor/Claude history paths).
pub fn full_session_to_provider_events(
    session: &FullSession,
    source: CanonicalAgentId,
    agent_type: AgentType,
) -> Vec<ProviderEvent> {
    let canonical = materialize_canonical_transcript_events(session, agent_type);
    canonical_transcript_events_to_provider_events(&canonical, source, agent_type)
}

/// Map canonical transcript events to ingress `ProviderEvent` stream.
pub(crate) fn canonical_transcript_events_to_provider_events(
    events: &[CanonicalTranscriptEvent],
    source: CanonicalAgentId,
    parser_agent: AgentType,
) -> Vec<ProviderEvent> {
    events
        .iter()
        .map(|event| {
            canonical_transcript_event_to_provider_event(event, source.clone(), parser_agent)
        })
        .collect()
}

pub(crate) fn canonical_transcript_event_to_provider_event(
    event: &CanonicalTranscriptEvent,
    source: CanonicalAgentId,
    parser_agent: AgentType,
) -> ProviderEvent {
    let kind = match &event.kind {
        CanonicalTranscriptEventKind::UserText { text } => ProviderEventKind::UserText {
            text: text.clone(),
            attempt_id: None,
        },
        CanonicalTranscriptEventKind::UserPastedContent { text } => {
            ProviderEventKind::UserPastedContent { text: text.clone() }
        }
        CanonicalTranscriptEventKind::AssistantText { text } => {
            ProviderEventKind::AssistantText { text: text.clone() }
        }
        CanonicalTranscriptEventKind::AssistantThought {
            text,
            redacted_provider_data,
        } => ProviderEventKind::AssistantThought {
            text: text.clone(),
            redacted: redacted_provider_data.clone(),
        },
        CanonicalTranscriptEventKind::AssistantError { text, error } => {
            ProviderEventKind::AssistantError {
                text: text.clone(),
                error: error.clone(),
            }
        }
        CanonicalTranscriptEventKind::ToolUse {
            tool_call_id,
            name,
            input,
        } => {
            let parser = get_parser(parser_agent);
            let normalized_id = normalize_tool_call_id(tool_call_id);
            let tool_call = build_tool_call_from_raw(
                parser,
                RawToolCallInput {
                    id: normalized_id,
                    name: Some(name.clone()),
                    arguments: input.clone(),
                    status: ToolCallStatus::Pending,
                    kind: None,
                    title: Some(name.clone()),
                    suppress_title_read_path_hint: false,
                    parent_tool_use_id: None,
                    task_children: None,
                },
            );
            ProviderEventKind::ToolCall(tool_call)
        }
    };

    ProviderEvent {
        source,
        provider_seq: event.transcript_seq,
        provider_row_id: event.provider_row_id.clone(),
        timestamp_ms: parse_timestamp_to_millis(&event.timestamp),
        kind,
    }
}

fn parse_timestamp_to_millis(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::{materialize_canonical_transcript_events, CanonicalTranscriptEventKind};
    use crate::acp::parsers::AgentType;
    use crate::acp::transcript_projection::{TranscriptSegment, TranscriptSnapshot};
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
            parent_tool_use_id: None,
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
                CanonicalTranscriptEventKind::UserPastedContent { .. } => "user-pasted",
            })
            .collect();

        assert_eq!(kinds, vec!["tool", "assistant"]);
        assert_eq!(events[0].transcript_seq, 0);
        assert_eq!(events[1].transcript_seq, 1);
    }

    #[test]
    fn canonical_events_dedupe_duplicate_tool_use_ids_before_projection() {
        let session = session_with_messages(vec![
            assistant_message(
                "a-tool-original",
                "req-1",
                vec![ContentBlock::ToolUse {
                    id: "provider-tool-1".to_string(),
                    name: "Read".to_string(),
                    input: json!({ "path": "/tmp/file" }),
                }],
            ),
            assistant_message(
                "a-tool-replay",
                "req-1",
                vec![ContentBlock::ToolUse {
                    id: "provider-tool-1".to_string(),
                    name: "Read".to_string(),
                    input: json!({ "path": "/tmp/file" }),
                }],
            ),
        ]);

        let events = materialize_canonical_transcript_events(&session, AgentType::Cursor);
        let tool_events = events
            .iter()
            .filter(|event| {
                matches!(
                    event.kind,
                    CanonicalTranscriptEventKind::ToolUse {
                        ref tool_call_id,
                        ..
                    } if tool_call_id == "provider-tool-1"
                )
            })
            .count();

        assert_eq!(tool_events, 1);
    }

    #[test]
    fn canonical_events_preserve_redacted_thought_payload_and_project_display_marker() {
        let session = session_with_messages(vec![assistant_message(
            "a-redacted",
            "req-1",
            vec![
                ContentBlock::Thinking {
                    thinking: String::new(),
                    signature: None,
                    redacted_provider_data: Some("opaque-provider-payload".to_string()),
                },
                ContentBlock::Text {
                    text: "Visible answer".to_string(),
                },
            ],
        )]);

        let events = materialize_canonical_transcript_events(&session, AgentType::Cursor);

        match &events[0].kind {
            CanonicalTranscriptEventKind::AssistantThought {
                text,
                redacted_provider_data,
            } => {
                assert_eq!(text, "");
                assert_eq!(
                    redacted_provider_data.as_deref(),
                    Some("opaque-provider-payload")
                );
            }
            other => panic!("expected first event to be redacted thought, got {other:?}"),
        }

        let snapshot = TranscriptSnapshot::from_canonical_events(1, &events);
        match &snapshot.entries[0].segments[0] {
            TranscriptSegment::Thought { text, .. } => assert_eq!(text, "[REDACTED]"),
            other => panic!("expected projected thought marker, got {other:?}"),
        }
    }

    #[test]
    fn canonical_events_keep_reused_provider_id_out_of_display_identity() {
        let session = session_with_messages(vec![
            OrderedMessage {
                uuid: "a-text".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                provider_message_id: Some("msg-reused".to_string()),
                timestamp: "2026-05-17T00:00:01Z".to_string(),
                content_blocks: vec![ContentBlock::Text {
                    text: "I will inspect it first.".to_string(),
                }],
                model: None,
                usage: None,
                error: None,
                request_id: Some("req-1".to_string()),
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
            OrderedMessage {
                uuid: "a-tool".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                provider_message_id: Some("msg-reused".to_string()),
                timestamp: "2026-05-17T00:00:02Z".to_string(),
                content_blocks: vec![ContentBlock::ToolUse {
                    id: "toolu_read".to_string(),
                    name: "Read".to_string(),
                    input: json!({ "file_path": "/tmp/a" }),
                }],
                model: None,
                usage: None,
                error: None,
                request_id: Some("req-1".to_string()),
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
            OrderedMessage {
                uuid: "a-later-text".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                provider_message_id: Some("msg-reused".to_string()),
                timestamp: "2026-05-17T00:00:03Z".to_string(),
                content_blocks: vec![ContentBlock::Text {
                    text: "The file is clean.".to_string(),
                }],
                model: None,
                usage: None,
                error: None,
                request_id: Some("req-1".to_string()),
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
        ]);

        let events = materialize_canonical_transcript_events(&session, AgentType::ClaudeCode);
        let display_ids: Vec<&str> = events
            .iter()
            .map(|event| event.display_id.as_str())
            .collect();
        let provider_msg_ids: Vec<Option<&str>> = events
            .iter()
            .map(|event| event.provider_msg_id.as_deref())
            .collect();

        assert_eq!(display_ids, vec!["a-text", "toolu_read", "a-later-text"]);
        assert_eq!(
            provider_msg_ids,
            vec![Some("msg-reused"), Some("msg-reused"), Some("msg-reused")]
        );
        assert_eq!(events[0].transcript_seq, 0);
        assert_eq!(events[1].transcript_seq, 1);
        assert_eq!(events[2].transcript_seq, 2);
    }

    #[test]
    fn canonical_events_exclude_subagent_assistant_text_from_top_level_transcript() {
        let session = session_with_messages(vec![
            OrderedMessage {
                uuid: "parent-text".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                provider_message_id: Some("msg-parent".to_string()),
                timestamp: "2026-07-07T00:00:01Z".to_string(),
                content_blocks: vec![ContentBlock::Text {
                    text: "This confirms the exact wiring.".to_string(),
                }],
                model: None,
                usage: None,
                error: None,
                request_id: Some("req-1".to_string()),
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
            OrderedMessage {
                uuid: "task-tool".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                provider_message_id: Some("msg-parent".to_string()),
                timestamp: "2026-07-07T00:00:02Z".to_string(),
                content_blocks: vec![ContentBlock::ToolUse {
                    id: "toolu_task_parent".to_string(),
                    name: "Task".to_string(),
                    input: json!({
                        "description": "Find new chat modal project trigger",
                        "subagent_type": "general-purpose"
                    }),
                }],
                model: None,
                usage: None,
                error: None,
                request_id: Some("req-1".to_string()),
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
            OrderedMessage {
                uuid: "subagent-report".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                provider_message_id: Some("msg-subagent".to_string()),
                timestamp: "2026-07-07T00:00:03Z".to_string(),
                content_blocks: vec![ContentBlock::Text {
                    text: "Now I have everything needed for the report.".to_string(),
                }],
                model: None,
                usage: None,
                error: None,
                request_id: Some("req-1".to_string()),
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: Some("toolu_task_parent".to_string()),
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
        ]);

        let events = materialize_canonical_transcript_events(&session, AgentType::ClaudeCode);
        let visible_text: Vec<&str> = events
            .iter()
            .filter_map(|event| match &event.kind {
                CanonicalTranscriptEventKind::AssistantText { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        let tool_ids: Vec<&str> = events
            .iter()
            .filter_map(|event| match &event.kind {
                CanonicalTranscriptEventKind::ToolUse { tool_call_id, .. } => {
                    Some(tool_call_id.as_str())
                }
                _ => None,
            })
            .collect();

        assert_eq!(visible_text, vec!["This confirms the exact wiring."]);
        assert_eq!(tool_ids, vec!["toolu_task_parent"]);
    }
}
