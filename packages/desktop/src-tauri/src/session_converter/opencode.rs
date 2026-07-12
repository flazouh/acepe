use crate::acp::parsers::{AgentParser, AgentType, ClaudeCodeParser, OpenCodeParser};
use crate::acp::reconciler::session_tool::{classify_raw_tool_call, ToolClassificationHints};
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::session_update::{tool_call_status_from_str, ToolArguments, ToolCallData};
use crate::acp::transcript_projection::{CanonicalTranscriptEvent, CanonicalTranscriptEventKind};
use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};
use crate::session_jsonl::display_names::format_model_display_name;
use crate::session_jsonl::types::{
    SessionStats, StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    StoredUserMessage,
};
use std::collections::HashMap;

use crate::acp::session_update::tool_merge::calculate_todo_timing;

fn map_summary_status(status: &str) -> String {
    match status {
        "completed" => "completed".to_string(),
        "error" | "failed" => "failed".to_string(),
        "running" => "in_progress".to_string(),
        _ => "pending".to_string(),
    }
}

fn parse_task_children_from_metadata(
    parent_id: &str,
    metadata: Option<&serde_json::Value>,
) -> Option<Vec<ToolCallData>> {
    let summary = metadata?.get("summary")?.as_array()?;
    if summary.is_empty() {
        return None;
    }

    let mut children = Vec::with_capacity(summary.len());
    for (index, item) in summary.iter().enumerate() {
        let tool_name = item.get("tool").and_then(|v| v.as_str()).unwrap_or("Tool");
        let state = item.get("state");
        let title = state
            .and_then(|s| s.get("title"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let status = state
            .and_then(|s| s.get("status"))
            .and_then(|v| v.as_str())
            .map(map_summary_status)
            .unwrap_or_else(|| "pending".to_string());
        let kind = ClaudeCodeParser.detect_tool_kind(tool_name);

        children.push(ToolCallData {
            id: format!("{parent_id}:summary-{index}"),
            name: tool_name.to_string(),
            title,
            status: tool_call_status_from_str(&status),
            result: None,
            kind: Some(kind),
            arguments: ToolArguments::Other {
                raw: serde_json::json!({}),
                intent: None,
            },
            diagnostic_input: None,
            skill_meta: None,
            locations: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: Some(parent_id.to_string()),
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        });
    }

    Some(children)
}

/// Convert OpenCode messages to a `SessionThreadSnapshot`.
pub fn convert_opencode_messages_to_session(
    messages: Vec<OpenCodeMessage>,
) -> Result<SessionThreadSnapshot, String> {
    let (snapshot, _stats) = convert_opencode_messages(messages)?;
    Ok(snapshot)
}

pub(crate) fn convert_opencode_messages_to_provider_owned_snapshot(
    messages: Vec<OpenCodeMessage>,
) -> Result<ProviderOwnedSessionSnapshot, String> {
    let canonical_transcript_events = materialize_opencode_canonical_transcript_events(&messages);
    let thread_snapshot = convert_opencode_messages_to_session(messages)?;
    Ok(
        ProviderOwnedSessionSnapshot::with_canonical_transcript_events(
            thread_snapshot,
            canonical_transcript_events,
        ),
    )
}

fn materialize_opencode_canonical_transcript_events(
    messages: &[OpenCodeMessage],
) -> Vec<CanonicalTranscriptEvent> {
    let mut events = Vec::new();
    let mut transcript_seq = 0_u64;

    for (message_index, msg) in messages.iter().enumerate() {
        for (block_index, part) in msg.parts.iter().enumerate() {
            let timestamp = msg.timestamp.clone().unwrap_or_default();
            let maybe_event = match part {
                OpenCodeMessagePart::Text { text }
                    if msg.role == "user" && !text.trim().is_empty() =>
                {
                    Some(CanonicalTranscriptEvent {
                        transcript_seq,
                        source: AgentType::OpenCode,
                        provider_row_id: msg.id.clone(),
                        provider_msg_id: Some(msg.id.clone()),
                        request_id: None,
                        block_index,
                        display_id: opencode_text_display_id(message_index, "user"),
                        timestamp,
                        model: msg.model.clone(),
                        kind: CanonicalTranscriptEventKind::UserText { text: text.clone() },
                    })
                }
                OpenCodeMessagePart::Text { text }
                    if msg.role == "assistant" && !text.trim().is_empty() =>
                {
                    Some(CanonicalTranscriptEvent {
                        transcript_seq,
                        source: AgentType::OpenCode,
                        provider_row_id: msg.id.clone(),
                        provider_msg_id: Some(msg.id.clone()),
                        request_id: None,
                        block_index,
                        display_id: opencode_text_display_id(message_index, "assistant"),
                        timestamp,
                        model: msg.model.clone(),
                        kind: CanonicalTranscriptEventKind::AssistantText { text: text.clone() },
                    })
                }
                OpenCodeMessagePart::ToolInvocation {
                    id, name, input, ..
                } if msg.role == "assistant" => Some(CanonicalTranscriptEvent {
                    transcript_seq,
                    source: AgentType::OpenCode,
                    provider_row_id: msg.id.clone(),
                    provider_msg_id: Some(msg.id.clone()),
                    request_id: None,
                    block_index,
                    display_id: id.clone(),
                    timestamp,
                    model: msg.model.clone(),
                    kind: CanonicalTranscriptEventKind::ToolUse {
                        tool_call_id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                    },
                }),
                OpenCodeMessagePart::Text { .. }
                | OpenCodeMessagePart::ToolInvocation { .. }
                | OpenCodeMessagePart::ToolResult { .. } => None,
            };

            if let Some(event) = maybe_event {
                events.push(event);
                transcript_seq += 1;
            }
        }
    }

    events
}

fn opencode_text_display_id(message_index: usize, role: &str) -> String {
    format!("opencode-event-{message_index}:{role}")
}

fn convert_opencode_messages(
    messages: Vec<OpenCodeMessage>,
) -> Result<(SessionThreadSnapshot, SessionStats), String> {
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

    Ok((
        SessionThreadSnapshot {
            entries,
            title,
            created_at,
            current_mode_id: None,
        },
        stats,
    ))
}

/// Convert an OpenCode user message to StoredEntry.
fn convert_opencode_user_message(msg: &OpenCodeMessage) -> Option<StoredEntry> {
    let mut text_content = String::new();
    let mut chunks = Vec::new();

    for part in &msg.parts {
        match part {
            OpenCodeMessagePart::Text { text } if !text.trim().is_empty() => {
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
                let task_children = if name.to_lowercase().contains("task") {
                    parse_task_children_from_metadata(
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
                        diagnostic_input: None,
                        skill_meta: None, // OpenCode doesn't support skill meta yet
                        locations: None,
                        normalized_questions: classified.normalized_questions,
                        normalized_todos: classified.normalized_todos,
                        normalized_todo_update: classified.normalized_todo_update,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_materialization::materialize_provider_owned_thread_snapshot;
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
    use crate::acp::types::CanonicalAgentId;

    #[test]
    fn opencode_provider_owned_snapshot_promotes_canonical_transcript_events() {
        let snapshot = convert_opencode_messages_to_provider_owned_snapshot(vec![
            OpenCodeMessage {
                id: "provider-user-message".to_string(),
                role: "user".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Inspect this".to_string(),
                }],
                model: None,
                timestamp: Some("1000".to_string()),
            },
            OpenCodeMessage {
                id: "provider-assistant-message".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Looks good".to_string(),
                }],
                model: Some("openai/gpt-5".to_string()),
                timestamp: Some("1001".to_string()),
            },
        ])
        .expect("OpenCode messages should convert");

        assert_eq!(snapshot.canonical_transcript_events.len(), 2);

        let materialized = materialize_provider_owned_thread_snapshot(
            "session-1",
            Some(CanonicalAgentId::OpenCode),
            7,
            &snapshot,
        );

        assert_eq!(materialized.transcript_snapshot.entries.len(), 2);
        assert_eq!(
            materialized.transcript_snapshot.entries[1].entry_id,
            "acepe::entry::assistant-boundary:1::assistant::."
        );
        assert_eq!(
            materialized.transcript_snapshot.entries[1].role,
            TranscriptEntryRole::Assistant
        );
        assert_eq!(
            materialized.transcript_snapshot.entries[1].segments,
            vec![TranscriptSegment::Text {
                segment_id: "assistant-boundary:1:event:1".to_string(),
                text: "Looks good".to_string(),
            }]
        );
    }

    #[test]
    fn opencode_canonical_events_keep_provider_id_out_of_display_identity() {
        let snapshot = convert_opencode_messages_to_provider_owned_snapshot(vec![
            OpenCodeMessage {
                id: "provider-reused-message".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "I will inspect it first.".to_string(),
                }],
                model: Some("openai/gpt-5".to_string()),
                timestamp: Some("1001".to_string()),
            },
            OpenCodeMessage {
                id: "provider-reused-message".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::ToolInvocation {
                    id: "toolu_read".to_string(),
                    name: "Read".to_string(),
                    input: serde_json::json!({ "file_path": "/tmp/a" }),
                    state: None,
                }],
                model: Some("openai/gpt-5".to_string()),
                timestamp: Some("1002".to_string()),
            },
            OpenCodeMessage {
                id: "provider-reused-message".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "The file is clean.".to_string(),
                }],
                model: Some("openai/gpt-5".to_string()),
                timestamp: Some("1003".to_string()),
            },
        ])
        .expect("OpenCode messages should convert");

        let provider_msg_ids: Vec<Option<&str>> = snapshot
            .canonical_transcript_events
            .iter()
            .map(|event| event.provider_msg_id.as_deref())
            .collect();
        let event_display_ids: Vec<&str> = snapshot
            .canonical_transcript_events
            .iter()
            .map(|event| event.display_id.as_str())
            .collect();

        assert_eq!(
            provider_msg_ids,
            vec![
                Some("provider-reused-message"),
                Some("provider-reused-message"),
                Some("provider-reused-message")
            ]
        );
        assert_eq!(
            event_display_ids,
            vec![
                "opencode-event-0:assistant",
                "toolu_read",
                "opencode-event-2:assistant"
            ]
        );

        let materialized = materialize_provider_owned_thread_snapshot(
            "session-1",
            Some(CanonicalAgentId::OpenCode),
            7,
            &snapshot,
        );
        let entry_ids: Vec<&str> = materialized
            .transcript_snapshot
            .entries
            .iter()
            .map(|entry| entry.entry_id.as_str())
            .collect();

        assert_eq!(
            entry_ids,
            vec![
                "acepe::entry::session-start::assistant::.",
                "acepe::entry::session-start::tool::toolu_read",
                "acepe::entry::assistant-boundary:2::assistant::.",
            ]
        );
        assert!(entry_ids
            .iter()
            .all(|entry_id| !entry_id.contains("provider-reused-message")));
    }
}
