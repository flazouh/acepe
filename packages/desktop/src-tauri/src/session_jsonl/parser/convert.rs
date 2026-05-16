use std::collections::HashMap;

use crate::acp::parsers::{get_parser, AgentParser, AgentType, ClaudeCodeParser};
use crate::acp::reconciler::session_tool::{classify_raw_tool_call, ToolClassificationHints};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::{tool_call_status_from_str, ToolCallData};
use crate::session_jsonl::display_names::format_model_display_name;
use crate::session_jsonl::types::{
    ContentBlock, FullSession, OrderedMessage, StoredAssistantChunk, StoredAssistantMessage,
    StoredContentBlock, StoredEntry, StoredUserMessage,
};

#[cfg(test)]
use super::parse_full_session;
#[cfg(test)]
use anyhow::Result;

pub fn convert_full_session_to_entries(session: &FullSession) -> SessionThreadSnapshot {
    let mut entries: Vec<StoredEntry> = Vec::new();

    // First pass: collect tool results from all messages so sources that co-locate
    // tool_use and tool_result blocks in assistant messages still render completed tools.
    let mut tool_results: HashMap<String, String> = HashMap::new();
    for msg in &session.messages {
        if msg.is_meta {
            continue;
        }
        for block in &msg.content_blocks {
            if let ContentBlock::ToolResult {
                tool_use_id,
                content,
            } = block
            {
                tool_results.insert(tool_use_id.clone(), content.clone());
            }
        }
    }

    // Second pass: convert messages to entries
    for msg in &session.messages {
        if msg.is_meta {
            continue;
        }

        match msg.role.as_str() {
            "user" => {
                if let Some(entry) = convert_user_message(msg) {
                    entries.push(entry);
                }
            }
            "assistant" => {
                entries.extend(convert_assistant_message(msg, &tool_results));
            }
            _ => {}
        }
    }

    // Calculate todo timing from state transitions
    crate::session_converter::calculate_todo_timing(&mut entries);

    SessionThreadSnapshot {
        entries,
        title: session.title.clone(),
        created_at: session.created_at.clone(),
        current_mode_id: None,
    }
}

/// Convert a user message to a StoredEntry.
fn convert_user_message(msg: &OrderedMessage) -> Option<StoredEntry> {
    // Find text content, skip tool results
    let mut text_content = String::new();
    let mut chunks = Vec::new();

    for block in &msg.content_blocks {
        match block {
            ContentBlock::Text { text } if !text.trim().is_empty() => {
                if text_content.is_empty() {
                    text_content = text.clone();
                } else {
                    text_content.push('\n');
                    text_content.push_str(text);
                }
                chunks.push(StoredContentBlock {
                    block_type: "text".to_string(),
                    text: Some(text.clone()),
                });
            }
            ContentBlock::ToolResult { .. } => {
                // Skip tool results in user message display
            }
            _ => {}
        }
    }

    if text_content.is_empty() {
        return None;
    }

    Some(StoredEntry::User {
        id: msg.uuid.clone(),
        message: StoredUserMessage {
            id: Some(msg.uuid.clone()),
            content: StoredContentBlock {
                block_type: "text".to_string(),
                text: Some(text_content),
            },
            chunks,
            sent_at: Some(msg.timestamp.clone()),
        },
        timestamp: Some(msg.timestamp.clone()),
    })
}

fn assistant_entry_id(message_id: &str, segment_index: usize, split_count: usize) -> String {
    if split_count == 1 {
        return message_id.to_string();
    }

    format!("{message_id}:assistant:{segment_index}")
}

fn build_assistant_entry(
    msg: &OrderedMessage,
    chunks: Vec<StoredAssistantChunk>,
    segment_index: usize,
    split_count: usize,
) -> StoredEntry {
    StoredEntry::Assistant {
        id: assistant_entry_id(&msg.uuid, segment_index, split_count),
        message: StoredAssistantMessage {
            chunks,
            model: msg.model.clone(),
            display_model: msg.model.as_ref().map(|m| format_model_display_name(m)),
            received_at: Some(msg.timestamp.clone()),
        },
        timestamp: Some(msg.timestamp.clone()),
    }
}

fn build_tool_entry(
    msg: &OrderedMessage,
    id: &str,
    name: &str,
    input: &serde_json::Value,
    tool_results: &HashMap<String, String>,
) -> StoredEntry {
    let result = tool_results.get(id).cloned();
    let status = if result.is_some() {
        "completed"
    } else {
        "pending"
    };

    let parser = get_parser(AgentType::ClaudeCode);
    let classified = classify_raw_tool_call(
        parser,
        id,
        input,
        ToolClassificationHints {
            name: None,
            title: Some(name),
            kind: Some(ClaudeCodeParser.detect_tool_kind(name)),
            kind_hint: None,
            locations: None,
        },
    );

    StoredEntry::ToolCall {
        id: id.to_string(),
        message: ToolCallData {
            id: id.to_string(),
            name: classified.name.clone(),
            title: Some(classified.name.clone()),
            status: tool_call_status_from_str(status),
            result: result.map(serde_json::Value::String),
            kind: Some(classified.kind),
            arguments: classified.arguments,
            raw_input: Some(input.clone()),
            skill_meta: None,
            locations: None,
            normalized_questions: classified.normalized_questions,
            normalized_todos: classified.normalized_todos,
            normalized_todo_update: classified.normalized_todo_update,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        timestamp: Some(msg.timestamp.clone()),
    }
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

fn push_assistant_entry_if_needed(
    entries: &mut Vec<StoredEntry>,
    msg: &OrderedMessage,
    chunks: &mut Vec<StoredAssistantChunk>,
    segment_index: &mut usize,
    split_count: usize,
) {
    if chunks.is_empty() {
        return;
    }

    let entry_chunks = std::mem::take(chunks);
    entries.push(build_assistant_entry(
        msg,
        entry_chunks,
        *segment_index,
        split_count,
    ));
    *segment_index += 1;
}

/// Convert an assistant message to stored entries while preserving block order.
fn convert_assistant_message(
    msg: &OrderedMessage,
    tool_results: &HashMap<String, String>,
) -> Vec<StoredEntry> {
    let mut chunks: Vec<StoredAssistantChunk> = Vec::new();
    let mut entries: Vec<StoredEntry> = Vec::new();
    let split_count = count_assistant_text_segments(&msg.content_blocks);
    let mut segment_index = 0;

    for block in &msg.content_blocks {
        match block {
            ContentBlock::Text { text } => {
                if !text.trim().is_empty() {
                    chunks.push(StoredAssistantChunk {
                        chunk_type: "message".to_string(),
                        block: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some(text.clone()),
                        },
                    });
                }
            }
            ContentBlock::Thinking { thinking, .. } => {
                if !thinking.trim().is_empty() {
                    chunks.push(StoredAssistantChunk {
                        chunk_type: "thought".to_string(),
                        block: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some(thinking.clone()),
                        },
                    });
                }
            }
            ContentBlock::ToolUse { id, name, input } => {
                push_assistant_entry_if_needed(
                    &mut entries,
                    msg,
                    &mut chunks,
                    &mut segment_index,
                    split_count,
                );
                entries.push(build_tool_entry(msg, id, name, input, tool_results));
            }
            ContentBlock::ToolResult { .. } => {
                // Tool results are handled when processing tool_use
            }
            ContentBlock::CodeAttachment {
                path,
                lines,
                content,
            } => {
                // Format code attachment as a text block with file info
                let header = match lines {
                    Some(l) => format!("File: {} (lines {})", path, l),
                    None => format!("File: {}", path),
                };
                let formatted = format!("{}\n```\n{}\n```", header, content);
                chunks.push(StoredAssistantChunk {
                    chunk_type: "message".to_string(),
                    block: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some(formatted),
                    },
                });
            }
        }
    }

    if let Some(error) = &msg.error {
        let mut error_entries = vec![crate::session_converter::assistant_provider_error_entry(
            msg, error,
        )];
        error_entries.extend(
            entries
                .into_iter()
                .filter(|entry| matches!(entry, StoredEntry::ToolCall { .. })),
        );
        return error_entries;
    }

    push_assistant_entry_if_needed(
        &mut entries,
        msg,
        &mut chunks,
        &mut segment_index,
        split_count,
    );

    entries
}

/// Parse a session and return a `SessionThreadSnapshot`.
#[cfg(test)]
pub(crate) async fn parse_converted_session(
    session_id: &str,
    project_path: &str,
) -> Result<SessionThreadSnapshot> {
    let full_session = parse_full_session(session_id, project_path).await?;
    Ok(crate::session_converter::convert_claude_full_session_to_thread_snapshot(&full_session))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ToolCallStatus;
    use crate::cc_sdk::AssistantMessageError;
    use crate::session_jsonl::types::{FullSession, SessionStats, StoredEntry};
    use serde_json::json;

    #[test]
    fn test_convert_full_session_marks_tool_entry_completed_when_result_is_in_assistant_message() {
        let session = FullSession {
            session_id: "session-1".to_string(),
            project_path: "/tmp/project".to_string(),
            title: "Test".to_string(),
            created_at: "2025-01-01T00:00:00+00:00".to_string(),
            stats: SessionStats {
                total_messages: 1,
                user_messages: 0,
                assistant_messages: 1,
                tool_uses: 1,
                tool_results: 1,
                thinking_blocks: 0,
                total_input_tokens: 0,
                total_output_tokens: 0,
            },
            messages: vec![OrderedMessage {
                uuid: "assistant-1".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                timestamp: "2025-01-01T00:00:01+00:00".to_string(),
                content_blocks: vec![
                    ContentBlock::ToolUse {
                        id: "tool-1".to_string(),
                        name: "Read".to_string(),
                        input: json!({ "file_path": "/tmp/project/main.go" }),
                    },
                    ContentBlock::ToolResult {
                        tool_use_id: "tool-1".to_string(),
                        content: "package main".to_string(),
                    },
                ],
                model: None,
                usage: None,
                error: None,
                request_id: None,
                is_meta: false,
                source_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            }],
        };

        let converted = convert_full_session_to_entries(&session);
        let tool_entry = converted
            .entries
            .into_iter()
            .find_map(|entry| match entry {
                StoredEntry::ToolCall { message, .. } => Some(message),
                _ => None,
            })
            .expect("tool entry should exist");

        assert_eq!(tool_entry.status, ToolCallStatus::Completed);
        assert_eq!(
            tool_entry.result,
            Some(serde_json::Value::String("package main".to_string()))
        );
    }

    #[test]
    fn test_convert_full_session_preserves_tool_call_position_inside_assistant_message() {
        let session = FullSession {
            session_id: "session-1".to_string(),
            project_path: "/tmp/project".to_string(),
            title: "Test".to_string(),
            created_at: "2025-01-01T00:00:00+00:00".to_string(),
            stats: SessionStats {
                total_messages: 1,
                user_messages: 0,
                assistant_messages: 1,
                tool_uses: 1,
                tool_results: 1,
                thinking_blocks: 1,
                total_input_tokens: 0,
                total_output_tokens: 0,
            },
            messages: vec![OrderedMessage {
                uuid: "assistant-1".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                timestamp: "2025-01-01T00:00:01+00:00".to_string(),
                content_blocks: vec![
                    ContentBlock::Thinking {
                        thinking: "Need to inspect files first.".to_string(),
                        signature: None,
                    },
                    ContentBlock::ToolUse {
                        id: "tool-1".to_string(),
                        name: "Bash".to_string(),
                        input: json!({ "command": "ls -la" }),
                    },
                    ContentBlock::Text {
                        text: "Here is the answer after inspecting files.".to_string(),
                    },
                    ContentBlock::ToolResult {
                        tool_use_id: "tool-1".to_string(),
                        content: "README.md".to_string(),
                    },
                ],
                model: None,
                usage: None,
                error: None,
                request_id: None,
                is_meta: false,
                source_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            }],
        };

        let converted = convert_full_session_to_entries(&session);

        let entry_kinds: Vec<&str> = converted
            .entries
            .iter()
            .map(|entry| match entry {
                StoredEntry::Assistant { .. } => "assistant",
                StoredEntry::ToolCall { .. } => "tool_call",
                _ => "other",
            })
            .collect();

        assert_eq!(entry_kinds, vec!["assistant", "tool_call", "assistant"]);
    }

    #[test]
    fn test_convert_full_session_maps_assistant_error_to_error_entry() {
        let session = FullSession {
            session_id: "session-1".to_string(),
            project_path: "/tmp/project".to_string(),
            title: "Test".to_string(),
            created_at: "2025-01-01T00:00:00+00:00".to_string(),
            stats: SessionStats {
                total_messages: 1,
                user_messages: 0,
                assistant_messages: 1,
                tool_uses: 0,
                tool_results: 0,
                thinking_blocks: 0,
                total_input_tokens: 0,
                total_output_tokens: 0,
            },
            messages: vec![OrderedMessage {
                uuid: "assistant-1".to_string(),
                parent_uuid: None,
                role: "assistant".to_string(),
                timestamp: "2025-01-01T00:00:01+00:00".to_string(),
                content_blocks: vec![ContentBlock::Text {
                    text: "Failed to authenticate. API Error: 401 {\"error\":{\"message\":\"User not found.\",\"code\":401}}".to_string(),
                }],
                model: None,
                usage: None,
                error: Some(AssistantMessageError::AuthenticationFailed),
                request_id: None,
                is_meta: false,
                source_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            }],
        };

        let converted = convert_full_session_to_entries(&session);

        assert!(matches!(
            &converted.entries[0],
            StoredEntry::Error { message, .. }
                if message.content.contains("Failed to authenticate")
                    && message.code.as_deref() == Some("401")
        ));
    }
}
