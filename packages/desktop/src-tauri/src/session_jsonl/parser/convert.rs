use anyhow::Result;
use std::collections::HashMap;

use crate::acp::parsers::{get_parser, AgentParser, AgentType, ClaudeCodeParser};
use crate::acp::session_update::{
    parse_normalized_questions, parse_normalized_todos, tool_call_status_from_str, ToolArguments,
    ToolCallData,
};
use crate::session_jsonl::display_names::{format_model_display_name, format_tool_display_name};
use crate::session_jsonl::types::{
    ContentBlock, ConvertedSession, FullSession, OrderedMessage, StoredAssistantChunk,
    StoredAssistantMessage, StoredContentBlock, StoredEntry, StoredUserMessage,
};

use super::full_session::parse_full_session;

pub fn convert_full_session_to_entries(session: &FullSession) -> ConvertedSession {
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
                let (assistant_entry, tool_entries) = convert_assistant_message(msg, &tool_results);
                if let Some(entry) = assistant_entry {
                    entries.push(entry);
                }
                entries.extend(tool_entries);
            }
            _ => {}
        }
    }

    // Calculate todo timing from state transitions
    crate::session_converter::calculate_todo_timing(&mut entries);

    ConvertedSession {
        entries,
        stats: session.stats.clone(),
        title: session.title.clone(),
        created_at: session.created_at.clone(),
    }
}

/// Convert a user message to a StoredEntry.
fn convert_user_message(msg: &OrderedMessage) -> Option<StoredEntry> {
    // Find text content, skip tool results
    let mut text_content = String::new();
    let mut chunks = Vec::new();

    for block in &msg.content_blocks {
        match block {
            ContentBlock::Text { text } => {
                if !text.trim().is_empty() {
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

/// Convert an assistant message to StoredEntry plus tool call entries.
fn convert_assistant_message(
    msg: &OrderedMessage,
    tool_results: &HashMap<String, String>,
) -> (Option<StoredEntry>, Vec<StoredEntry>) {
    let mut chunks: Vec<StoredAssistantChunk> = Vec::new();
    let mut tool_entries: Vec<StoredEntry> = Vec::new();

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
                let result = tool_results.get(id).cloned();
                let status = if result.is_some() {
                    "completed"
                } else {
                    "pending"
                };

                let kind = ClaudeCodeParser.detect_tool_kind(name);
                let normalized_questions =
                    parse_normalized_questions(name, input, AgentType::ClaudeCode);
                let normalized_todos = parse_normalized_todos(name, input, AgentType::ClaudeCode);
                tool_entries.push(StoredEntry::ToolCall {
                    id: id.clone(),
                    message: ToolCallData {
                        id: id.clone(),
                        name: name.clone(),
                        title: Some(format_tool_display_name(name)),
                        status: tool_call_status_from_str(status),
                        result: result.map(serde_json::Value::String),
                        kind: Some(kind),
                        arguments: get_parser(AgentType::ClaudeCode)
                            .parse_typed_tool_arguments(Some(name), input, Some(kind.as_str()))
                            .unwrap_or(ToolArguments::Other { raw: input.clone() }),
                        skill_meta: None, // Skill meta is populated by session_converter
                        locations: None,
                        normalized_questions,
                        normalized_todos,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer: None, // Question answers are populated by session_converter
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    },
                    timestamp: Some(msg.timestamp.clone()),
                });
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

    let assistant_entry = if !chunks.is_empty() {
        Some(StoredEntry::Assistant {
            id: msg.uuid.clone(),
            message: StoredAssistantMessage {
                chunks,
                model: msg.model.clone(),
                display_model: msg.model.as_ref().map(|m| format_model_display_name(m)),
                received_at: Some(msg.timestamp.clone()),
            },
            timestamp: Some(msg.timestamp.clone()),
        })
    } else {
        None
    };

    (assistant_entry, tool_entries)
}

/// Parse and convert a session directly to ConvertedSession.
/// This is the main entry point for the optimized conversion.
/// Uses the shared session converter for consistency.
pub async fn parse_converted_session(
    session_id: &str,
    project_path: &str,
) -> Result<ConvertedSession> {
    let full_session = parse_full_session(session_id, project_path).await?;
    Ok(crate::session_converter::convert_claude_full_session_to_entries(&full_session))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ToolCallStatus;
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
}
