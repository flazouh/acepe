//! Codex session parser for local rollout JSONL files.
//!
//! Codex stores sessions under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
//! This parser loads a single session transcript and converts it to the unified
//! `ConvertedSession` format used by the frontend.

use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use anyhow::Result;
use chrono::Utc;
use ignore::WalkBuilder;
use serde_json::Value;

use crate::acp::parsers::{get_parser, AgentParser, AgentType, CodexParser};
use crate::acp::session_update::{
    parse_normalized_questions, parse_normalized_todos, tool_call_status_from_str, ToolArguments,
    ToolCallData,
};
use crate::session_jsonl::types::{
    ConvertedSession, SessionStats, StoredAssistantChunk, StoredAssistantMessage,
    StoredContentBlock, StoredEntry, StoredUserMessage,
};

/// Load a Codex session from local rollout files.
pub async fn load_session(
    session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
) -> Result<Option<ConvertedSession>> {
    let Some(path) = resolve_session_file_path(session_id, project_path, source_path).await else {
        return Ok(None);
    };

    let file_content = tokio::fs::read_to_string(&path).await?;

    let mut entries: Vec<StoredEntry> = Vec::new();
    let mut tool_entry_indices: HashMap<String, usize> = HashMap::new();
    let mut created_at: Option<String> = None;
    let mut first_user_message: Option<String> = None;
    let mut serial = 0usize;

    for line in file_content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        let timestamp = record
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string);
        let record_type = record
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = record.get("payload").unwrap_or(&Value::Null);

        match record_type {
            "session_meta" if created_at.is_none() => {
                created_at = payload
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or(timestamp.clone());
            }
            "session_meta" => {}
            "event_msg" => {
                let event_type = payload
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                match event_type {
                    "user_message" => {
                        let message = payload
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                        append_user_message(
                            &mut entries,
                            &mut serial,
                            session_id,
                            message,
                            timestamp.clone(),
                            &mut first_user_message,
                        );
                    }
                    "agent_reasoning" => {
                        let thought = payload
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                        if thought.is_empty() {
                            continue;
                        }

                        serial += 1;
                        entries.push(StoredEntry::Assistant {
                            id: format!("codex-thought-{}-{}", session_id, serial),
                            message: StoredAssistantMessage {
                                chunks: vec![StoredAssistantChunk {
                                    chunk_type: "thought".to_string(),
                                    block: StoredContentBlock {
                                        block_type: "text".to_string(),
                                        text: Some(thought),
                                    },
                                }],
                                model: None,
                                display_model: None,
                                received_at: timestamp.clone(),
                            },
                            timestamp: timestamp.clone(),
                        });
                    }
                    "agent_message" => {
                        let message = payload
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                        append_assistant_message(
                            &mut entries,
                            &mut serial,
                            session_id,
                            message,
                            timestamp.clone(),
                        );
                    }
                    _ => {}
                }
            }
            "response_item" => {
                let item_type = payload
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                match item_type {
                    "message" => {
                        let role = payload
                            .get("role")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let text = extract_response_message_text(payload);
                        match role {
                            // Ignore role=user response_item messages because they include
                            // bootstrap payloads (AGENTS/environment context) that are
                            // not conversational turns. User turns come from event_msg.user_message.
                            "user" => {}
                            "assistant" => append_assistant_message(
                                &mut entries,
                                &mut serial,
                                session_id,
                                text,
                                timestamp.clone(),
                            ),
                            _ => {}
                        }
                    }
                    "function_call" => {
                        let call_id = payload
                            .get("call_id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        if call_id.is_empty() {
                            continue;
                        }

                        let name = payload
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("Tool")
                            .to_string();

                        let raw_arguments = payload
                            .get("arguments")
                            .and_then(Value::as_str)
                            .and_then(|args| serde_json::from_str::<Value>(args).ok())
                            .unwrap_or_else(|| serde_json::json!({}));

                        let kind = CodexParser.detect_tool_kind(&name);
                        let normalized_questions =
                            parse_normalized_questions(&name, &raw_arguments, AgentType::Codex);
                        let normalized_todos =
                            parse_normalized_todos(&name, &raw_arguments, AgentType::Codex);

                        serial += 1;
                        let entry = StoredEntry::ToolCall {
                            id: call_id.clone(),
                            message: ToolCallData {
                                id: call_id.clone(),
                                name: name.clone(),
                                title: Some(name.clone()),
                                status: tool_call_status_from_str("pending"),
                                result: None,
                                kind: Some(kind),
                                arguments: get_parser(AgentType::Codex)
                                    .parse_typed_tool_arguments(
                                        Some(&name),
                                        &raw_arguments,
                                        Some(kind.as_str()),
                                    )
                                    .unwrap_or(ToolArguments::Other { raw: raw_arguments }),
                                raw_input: None,
                                skill_meta: None,
                                locations: None,
                                normalized_questions,
                                normalized_todos,
                                parent_tool_use_id: None,
                                task_children: None,
                                awaiting_plan_approval: false,
                                plan_approval_request_id: None,
                                question_answer: None,
                            },
                            timestamp: timestamp.clone(),
                        };

                        let index = entries.len();
                        entries.push(entry);
                        tool_entry_indices.insert(call_id, index);
                    }
                    "function_call_output" => {
                        let call_id = payload
                            .get("call_id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        if call_id.is_empty() {
                            continue;
                        }

                        let output = payload
                            .get("output")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let status = infer_tool_status_from_output(&output);

                        if let Some(index) = tool_entry_indices.get(&call_id).copied() {
                            if let Some(StoredEntry::ToolCall { message, .. }) =
                                entries.get_mut(index)
                            {
                                message.result = Some(serde_json::Value::String(output));
                                message.status = tool_call_status_from_str(&status);
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let created_at = created_at.unwrap_or_else(|| Utc::now().to_rfc3339());
    let title = first_user_message
        .as_deref()
        .and_then(|t| crate::history::title_utils::derive_session_title(t, 100))
        .unwrap_or_else(|| "New Thread".to_string());
    let stats = build_stats(&entries);

    Ok(Some(ConvertedSession {
        entries,
        stats,
        title,
        created_at,
        current_mode_id: None,
    }))
}

fn append_user_message(
    entries: &mut Vec<StoredEntry>,
    serial: &mut usize,
    session_id: &str,
    message: String,
    timestamp: Option<String>,
    first_user_message: &mut Option<String>,
) {
    if message.is_empty() || is_adjacent_duplicate(entries, "user", &message) {
        return;
    }

    if first_user_message.is_none() {
        *first_user_message = Some(message.clone());
    }

    *serial += 1;
    entries.push(StoredEntry::User {
        id: format!("codex-user-{}-{}", session_id, serial),
        message: StoredUserMessage {
            id: None,
            content: StoredContentBlock {
                block_type: "text".to_string(),
                text: Some(message.clone()),
            },
            chunks: vec![StoredContentBlock {
                block_type: "text".to_string(),
                text: Some(message),
            }],
            sent_at: timestamp.clone(),
        },
        timestamp,
    });
}

fn append_assistant_message(
    entries: &mut Vec<StoredEntry>,
    serial: &mut usize,
    session_id: &str,
    message: String,
    timestamp: Option<String>,
) {
    if message.is_empty() || is_adjacent_duplicate(entries, "assistant", &message) {
        return;
    }

    *serial += 1;
    entries.push(StoredEntry::Assistant {
        id: format!("codex-assistant-{}-{}", session_id, serial),
        message: StoredAssistantMessage {
            chunks: vec![StoredAssistantChunk {
                chunk_type: "message".to_string(),
                block: StoredContentBlock {
                    block_type: "text".to_string(),
                    text: Some(message),
                },
            }],
            model: None,
            display_model: None,
            received_at: timestamp.clone(),
        },
        timestamp,
    });
}

fn is_adjacent_duplicate(entries: &[StoredEntry], role: &str, text: &str) -> bool {
    let Some(last) = entries.last() else {
        return false;
    };

    match (role, last) {
        ("user", StoredEntry::User { message, .. }) => {
            message.content.text.as_deref().unwrap_or_default() == text
        }
        ("assistant", StoredEntry::Assistant { message, .. }) => {
            message
                .chunks
                .first()
                .and_then(|chunk| chunk.block.text.as_deref())
                .unwrap_or_default()
                == text
        }
        _ => false,
    }
}

fn extract_response_message_text(payload: &Value) -> String {
    let Some(content_items) = payload.get("content").and_then(Value::as_array) else {
        return String::new();
    };

    let mut parts: Vec<String> = Vec::new();
    for item in content_items {
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if !text.is_empty() {
            parts.push(text.to_string());
        }
    }

    parts.join("\n\n")
}

/// Resolve the path to the rollout file for a session.
/// Expensive filesystem walk runs on a blocking thread to avoid blocking the async runtime.
async fn resolve_session_file_path(
    session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
) -> Option<PathBuf> {
    if let Some(path) = source_path {
        let source = PathBuf::from(path);
        if source.exists() {
            return Some(source);
        }
    }

    let sid = session_id.to_string();
    let pp = project_path.to_string();
    tokio::task::spawn_blocking(move || find_rollout_file_for_session(&sid, &pp))
        .await
        .ok()
        .flatten()
}

/// Locate the rollout file that contains a specific session ID.
fn find_rollout_file_for_session(session_id: &str, project_path: &str) -> Option<PathBuf> {
    let codex_home = dirs::home_dir()?.join(".codex").join("sessions");
    if !codex_home.exists() {
        return None;
    }

    let mut fallback_match: Option<PathBuf> = None;

    for entry in WalkBuilder::new(&codex_home)
        .standard_filters(false)
        .build()
    {
        let Ok(entry) = entry else {
            continue;
        };
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy();
        if !file_name.ends_with(".jsonl") || !file_name.contains(session_id) {
            continue;
        }

        let candidate_path = entry.path().to_path_buf();
        if project_path_matches(&candidate_path, session_id, project_path) {
            return Some(candidate_path);
        }

        if fallback_match.is_none() {
            fallback_match = Some(candidate_path);
        }
    }

    fallback_match
}

fn project_path_matches(path: &Path, session_id: &str, project_path: &str) -> bool {
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut reader = std::io::BufReader::new(file);
    let mut first_line = String::new();
    if reader.read_line(&mut first_line).is_err() {
        return false;
    }
    let first_line = first_line.trim();
    if first_line.is_empty() {
        return false;
    }

    let Ok(record) = serde_json::from_str::<Value>(first_line) else {
        return false;
    };

    let payload = record.get("payload").unwrap_or(&Value::Null);
    let line_session_id = payload
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let cwd = payload
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or_default();

    line_session_id == session_id && cwd == project_path
}

fn infer_tool_status_from_output(output: &str) -> String {
    if output.contains("Process running with session ID") {
        return "in_progress".to_string();
    }

    if output.contains("Process exited with code") {
        if output.contains("Process exited with code 0") {
            return "completed".to_string();
        }
        return "failed".to_string();
    }

    "completed".to_string()
}

fn build_stats(entries: &[StoredEntry]) -> SessionStats {
    let mut stats = SessionStats {
        total_messages: 0,
        user_messages: 0,
        assistant_messages: 0,
        tool_uses: 0,
        tool_results: 0,
        thinking_blocks: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
    };

    for entry in entries {
        match entry {
            StoredEntry::User { .. } => {
                stats.total_messages += 1;
                stats.user_messages += 1;
            }
            StoredEntry::Assistant { message, .. } => {
                stats.total_messages += 1;
                stats.assistant_messages += 1;
                stats.thinking_blocks += message
                    .chunks
                    .iter()
                    .filter(|chunk| chunk.chunk_type == "thought")
                    .count();
            }
            StoredEntry::ToolCall { message, .. } => {
                stats.tool_uses += 1;
                if message.result.is_some() {
                    stats.tool_results += 1;
                }
            }
            StoredEntry::Error { .. } => {}
        }
    }

    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infer_tool_status_handles_completed_process() {
        let output = "Process exited with code 0";
        assert_eq!(infer_tool_status_from_output(output), "completed");
    }

    #[test]
    fn infer_tool_status_handles_failed_process() {
        let output = "Process exited with code 127";
        assert_eq!(infer_tool_status_from_output(output), "failed");
    }

    #[test]
    fn derive_title_truncates_long_titles() {
        let text = "a".repeat(120);
        let title = crate::history::title_utils::derive_session_title(&text, 100).unwrap();
        assert!(title.ends_with("..."));
        assert!(title.chars().count() <= 100);
    }

    #[test]
    fn extract_response_message_text_joins_content_items() {
        let payload = serde_json::json!({
            "content": [
                { "type": "output_text", "text": "first" },
                { "type": "output_text", "text": "second" }
            ]
        });

        assert_eq!(extract_response_message_text(&payload), "first\n\nsecond");
    }

    #[test]
    fn adjacent_duplicate_detection_matches_user_and_assistant() {
        let mut entries = vec![StoredEntry::User {
            id: "u1".to_string(),
            message: StoredUserMessage {
                id: None,
                content: StoredContentBlock {
                    block_type: "text".to_string(),
                    text: Some("hello".to_string()),
                },
                chunks: vec![],
                sent_at: None,
            },
            timestamp: None,
        }];

        assert!(is_adjacent_duplicate(&entries, "user", "hello"));
        assert!(!is_adjacent_duplicate(&entries, "assistant", "hello"));

        entries.push(StoredEntry::Assistant {
            id: "a1".to_string(),
            message: StoredAssistantMessage {
                chunks: vec![StoredAssistantChunk {
                    chunk_type: "message".to_string(),
                    block: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some("reply".to_string()),
                    },
                }],
                model: None,
                display_model: None,
                received_at: None,
            },
            timestamp: None,
        });

        assert!(is_adjacent_duplicate(&entries, "assistant", "reply"));
    }
}
