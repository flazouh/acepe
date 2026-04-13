use crate::acp::operation_projectors::{
    project_opencode_task_children_from_metadata, project_read_model_for_kind,
};
use crate::acp::parsers::{AgentParser, AgentType, OpenCodeParser};
use crate::acp::session_update::{
    tool_call_status_from_str, ToolCallData,
};
use crate::acp::tool_classification::{classify_raw_tool_call, ToolClassificationHints};
use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};
use crate::session_jsonl::display_names::format_model_display_name;
use crate::session_jsonl::types::{
    ConvertedSession, SessionStats, StoredAssistantChunk, StoredAssistantMessage,
    StoredContentBlock, StoredEntry, StoredUserMessage,
};
use std::collections::HashMap;

use super::calculate_todo_timing;

/// Convert OpenCode messages to ConvertedSession format.
///
/// This function converts OpenCode HTTP API messages to the unified
/// ConvertedSession format used by the frontend.
pub fn convert_opencode_messages_to_session(
    messages: Vec<OpenCodeMessage>,
) -> Result<ConvertedSession, String> {
    let mut entries: Vec<StoredEntry> = Vec::new();
    let mut stats = SessionStats {
        total_messages: messages.len(),
        user_messages: 0,
        assistant_messages: 0,
        tool_uses: 0,
        tool_results: 0,
        thinking_blocks: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
    };

    // First pass: collect tool results from user messages
    let mut tool_results: HashMap<String, String> = HashMap::new();
    for msg in &messages {
        if msg.role == "user" {
            stats.user_messages += 1;
            for part in &msg.parts {
                if let OpenCodeMessagePart::ToolResult {
                    tool_use_id,
                    content,
                } = part
                {
                    tool_results.insert(tool_use_id.clone(), content.clone());
                    stats.tool_results += 1;
                }
            }
        } else if msg.role == "assistant" {
            stats.assistant_messages += 1;
        }
    }

    // Second pass: convert messages to entries
    for msg in &messages {
        match msg.role.as_str() {
            "user" => {
                if let Some(entry) = convert_opencode_user_message(msg) {
                    entries.push(entry);
                }
            }
            "assistant" => {
                let (assistant_entry, tool_entries) =
                    convert_opencode_assistant_message(msg, &tool_results);
                if let Some(entry) = assistant_entry {
                    entries.push(entry);
                }
                let tool_count = tool_entries.len();
                entries.extend(tool_entries);
                stats.tool_uses += tool_count;
            }
            _ => {}
        }
    }

    // Generate a title from the first user message
    let title = messages
        .iter()
        .find(|m| m.role == "user")
        .and_then(|m| {
            m.parts.iter().find_map(|p| {
                if let OpenCodeMessagePart::Text { text } = p {
                    Some(text.chars().take(50).collect::<String>())
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(|| "OpenCode Session".to_string());

    // Get creation timestamp from first message
    let created_at = messages
        .first()
        .and_then(|m| m.timestamp.clone())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    // Calculate todo timing from state transitions
    calculate_todo_timing(&mut entries);

    Ok(ConvertedSession {
        entries,
        stats,
        title,
        created_at,
        current_mode_id: None,
    })
}

/// Convert an OpenCode user message to StoredEntry.
fn convert_opencode_user_message(msg: &OpenCodeMessage) -> Option<StoredEntry> {
    let mut text_content = String::new();
    let mut chunks = Vec::new();

    for part in &msg.parts {
        match part {
            OpenCodeMessagePart::Text { text } => {
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
            OpenCodeMessagePart::ToolResult { .. } => {
                // Skip tool results in user message display
            }
            _ => {}
        }
    }

    if text_content.is_empty() {
        return None;
    }

    Some(StoredEntry::User {
        id: msg.id.clone(),
        message: StoredUserMessage {
            id: Some(msg.id.clone()),
            content: StoredContentBlock {
                block_type: "text".to_string(),
                text: Some(text_content),
            },
            chunks,
            sent_at: msg.timestamp.clone(),
        },
        timestamp: msg.timestamp.clone(),
    })
}

/// Convert an OpenCode assistant message to StoredEntry plus tool call entries.
fn convert_opencode_assistant_message(
    msg: &OpenCodeMessage,
    tool_results: &HashMap<String, String>,
) -> (Option<StoredEntry>, Vec<StoredEntry>) {
    let mut chunks: Vec<StoredAssistantChunk> = Vec::new();
    let mut tool_entries: Vec<StoredEntry> = Vec::new();

    for part in &msg.parts {
        match part {
            OpenCodeMessagePart::Text { text } => {
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
            OpenCodeMessagePart::ToolInvocation {
                id,
                name,
                input,
                state,
            } => {
                // Determine result: prefer state.output, then tool_results lookup
                let result = state
                    .as_ref()
                    .and_then(|s| s.output.clone())
                    .or_else(|| tool_results.get(id).cloned());

                // Determine status: use state.status if available, otherwise infer from result
                // Map OpenCode statuses to our statuses:
                // - "completed" -> "completed"
                // - "error" -> "failed"
                // - "running", "pending" -> "pending" (will be shown as interrupted since session is idle)
                let status = state
                    .as_ref()
                    .map(|s| match s.status.as_str() {
                        "completed" => "completed",
                        "error" => "failed",
                        _ => {
                            if result.is_some() {
                                "completed"
                            } else {
                                "pending"
                            }
                        }
                    })
                    .unwrap_or_else(|| {
                        if result.is_some() {
                            "completed"
                        } else {
                            "pending"
                        }
                    });

                let classified = classify_raw_tool_call(
                    &OpenCodeParser,
                    id,
                    input,
                    ToolClassificationHints {
                        name: None,
                        title: Some(name),
                        kind: Some(OpenCodeParser.detect_tool_kind(name)),
                        kind_hint: None,
                        locations: None,
                    },
                );
                let projection = project_read_model_for_kind(
                    classified.kind,
                    &classified.name,
                    input,
                    AgentType::OpenCode,
                );
                let task_children = if name.to_lowercase().contains("task") {
                    project_opencode_task_children_from_metadata(
                        id,
                        state.as_ref().and_then(|s| s.metadata.as_ref()),
                    )
                } else {
                    None
                };
                tool_entries.push(StoredEntry::ToolCall {
                    id: id.clone(),
                    message: ToolCallData {
                        id: id.clone(),
                        name: classified.name.clone(),
                        title: Some(classified.name.clone()),
                        status: tool_call_status_from_str(status),
                        result: result.map(serde_json::Value::String),
                        kind: Some(classified.kind),
                        arguments: classified.arguments,
                        raw_input: None,
                        skill_meta: None, // OpenCode doesn't support skill meta yet
                        locations: None,
                        normalized_questions: projection.normalized_questions,
                        normalized_todos: projection.normalized_todos,
                        parent_tool_use_id: None,
                        task_children,
                        question_answer: None, // OpenCode question answers not yet supported
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    },
                    timestamp: msg.timestamp.clone(),
                });
            }
            OpenCodeMessagePart::ToolResult { .. } => {
                // Tool results are handled when processing tool invocations
            }
        }
    }

    let assistant_entry = if !chunks.is_empty() {
        Some(StoredEntry::Assistant {
            id: msg.id.clone(),
            message: StoredAssistantMessage {
                chunks,
                model: msg.model.clone(),
                display_model: msg.model.as_ref().map(|m| format_model_display_name(m)),
                received_at: msg.timestamp.clone(),
            },
            timestamp: msg.timestamp.clone(),
        })
    } else {
        None
    };

    (assistant_entry, tool_entries)
}
