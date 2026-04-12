//! Codex session parser for local rollout JSONL files.
//!
//! Codex stores sessions under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
//! This parser loads a single session transcript and converts it to the unified
//! `ConvertedSession` format used by the frontend.

use std::io::BufRead;
use std::path::{Path, PathBuf};

use anyhow::Result;
use chrono::Utc;
use ignore::WalkBuilder;
use serde_json::Value;

use crate::acp::parsers::{AgentParser, CodexParser};
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, tool_call_status_from_str,
    ContentChunk, RawToolCallInput, RawToolCallUpdateInput, SessionUpdate, ToolCallStatus,
};
use crate::acp::types::ContentBlock;
use crate::session_jsonl::types::ConvertedSession;

enum LastTranscriptEntry {
    User(String),
    Assistant(String),
    Other,
}

fn is_adjacent_duplicate(
    last_entry: &Option<LastTranscriptEntry>,
    role: &str,
    text: &str,
) -> bool {
    match (last_entry, role) {
        (Some(LastTranscriptEntry::User(previous)), "user") => previous == text,
        (Some(LastTranscriptEntry::Assistant(previous)), "assistant") => previous == text,
        _ => false,
    }
}

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

    let mut created_at: Option<String> = None;
    let mut first_user_message: Option<String> = None;
    let mut updates: Vec<(u64, SessionUpdate)> = Vec::new();
    let parser = CodexParser;
    let mut last_transcript_entry: Option<LastTranscriptEntry> = None;

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
        let timestamp_ms = timestamp
            .as_deref()
            .and_then(parse_timestamp_ms)
            .unwrap_or_else(|| Utc::now().timestamp_millis() as u64);
        let record_type = record
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = record.get("payload").unwrap_or(&Value::Null);

        match record_type {
            "session_meta" => {
                if created_at.is_none() {
                    created_at = payload
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or(timestamp.clone());
                }
            }
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
                        if message.is_empty()
                            || is_adjacent_duplicate(&last_transcript_entry, "user", &message)
                        {
                            continue;
                        }
                        if first_user_message.is_none() {
                            first_user_message = Some(message.clone());
                        }
                        last_transcript_entry = Some(LastTranscriptEntry::User(message.clone()));
                        updates.push((
                            timestamp_ms,
                            SessionUpdate::UserMessageChunk {
                                chunk: text_chunk(message),
                                session_id: Some(session_id.to_string()),
                            },
                        ));
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
                        last_transcript_entry = Some(LastTranscriptEntry::Other);
                        updates.push((
                            timestamp_ms,
                            SessionUpdate::AgentThoughtChunk {
                                chunk: text_chunk(thought),
                                part_id: None,
                                message_id: None,
                                session_id: Some(session_id.to_string()),
                            },
                        ));
                    }
                    "agent_message" => {
                        let message = payload
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                        if message.is_empty()
                            || is_adjacent_duplicate(&last_transcript_entry, "assistant", &message)
                        {
                            continue;
                        }
                        last_transcript_entry =
                            Some(LastTranscriptEntry::Assistant(message.clone()));
                        updates.push((
                            timestamp_ms,
                            SessionUpdate::AgentMessageChunk {
                                chunk: text_chunk(message),
                                part_id: None,
                                message_id: None,
                                session_id: Some(session_id.to_string()),
                            },
                        ));
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
                            "assistant" => {
                                if text.is_empty()
                                    || is_adjacent_duplicate(
                                        &last_transcript_entry,
                                        "assistant",
                                        &text,
                                    )
                                {
                                    continue;
                                }
                                last_transcript_entry =
                                    Some(LastTranscriptEntry::Assistant(text.clone()));
                                updates.push((
                                    timestamp_ms,
                                    SessionUpdate::AgentMessageChunk {
                                        chunk: text_chunk(text),
                                        part_id: None,
                                        message_id: None,
                                        session_id: Some(session_id.to_string()),
                                    },
                                ));
                            }
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
                        let raw = RawToolCallInput {
                            id: call_id,
                            provider_tool_name: Some(name.clone()),
                            provider_declared_kind: Some(kind),
                            arguments: raw_arguments,
                            status: ToolCallStatus::Pending,
                            title: Some(name),
                            suppress_title_read_path_hint: false,
                            parent_tool_use_id: None,
                            task_children: None,
                        };
                        last_transcript_entry = Some(LastTranscriptEntry::Other);
                        updates.push((
                            timestamp_ms,
                            SessionUpdate::ToolCall {
                                tool_call: build_tool_call_from_raw(&parser, raw),
                                session_id: Some(session_id.to_string()),
                            },
                        ));
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
                        let raw_update = RawToolCallUpdateInput {
                            id: call_id,
                            provider_tool_name: None,
                            provider_declared_kind: None,
                            status: Some(tool_call_status_from_str(&status)),
                            result: Some(serde_json::Value::String(output)),
                            content: None,
                            title: None,
                            locations: None,
                            streaming_input_delta: None,
                            raw_input: None,
                        };
                        last_transcript_entry = Some(LastTranscriptEntry::Other);
                        updates.push((
                            timestamp_ms,
                            SessionUpdate::ToolCallUpdate {
                                update: build_tool_call_update_from_raw(
                                    &parser,
                                    raw_update,
                                    Some(session_id),
                                ),
                                session_id: Some(session_id.to_string()),
                            },
                        ));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let title = first_user_message
        .as_deref()
        .and_then(|t| crate::history::title_utils::derive_session_title(t, 100))
        .unwrap_or_else(|| "New Thread".to_string());
    let mut converted =
        crate::copilot_history::convert_replay_updates_to_session(session_id, &title, &updates);
    if let Some(created_at) = created_at {
        converted.created_at = created_at;
    }

    Ok(Some(converted))
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

fn text_chunk(text: String) -> ContentChunk {
    ContentChunk {
        content: ContentBlock::Text { text },
        aggregation_hint: None,
    }
}

fn parse_timestamp_ms(timestamp: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|value| value.timestamp_millis())
        .and_then(|value| u64::try_from(value).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_jsonl::types::StoredEntry;

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
    fn text_chunk_creates_plain_text_chunk() {
        let chunk = text_chunk("hello".to_string());

        match chunk.content {
            ContentBlock::Text { text } => assert_eq!(text, "hello"),
            other => panic!("expected text chunk, got {other:?}"),
        }
        assert_eq!(chunk.aggregation_hint, None);
    }

    #[tokio::test]
    async fn load_session_routes_codex_tool_calls_through_replay_accumulator() {
        let temp_dir = tempfile::tempdir().unwrap();
        let source_path = temp_dir.path().join("rollout-session-123.jsonl");
        let session_id = "session-123";
        let project_path = "/tmp/project";
        let file_content = [
            serde_json::json!({
                "timestamp": "2026-04-12T10:00:00Z",
                "type": "session_meta",
                "payload": { "id": session_id, "cwd": project_path }
            })
            .to_string(),
            serde_json::json!({
                "timestamp": "2026-04-12T10:00:01Z",
                "type": "event_msg",
                "payload": { "type": "user_message", "message": "run ls" }
            })
            .to_string(),
            serde_json::json!({
                "timestamp": "2026-04-12T10:00:02Z",
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "bash",
                    "arguments": "{\"command\":\"ls\"}"
                }
            })
            .to_string(),
            serde_json::json!({
                "timestamp": "2026-04-12T10:00:03Z",
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "call-1",
                    "output": "Process exited with code 0"
                }
            })
            .to_string(),
        ]
        .join("\n");

        std::fs::write(&source_path, file_content).unwrap();

        let converted = load_session(session_id, project_path, source_path.to_str())
            .await
            .unwrap()
            .unwrap();

        let tool_call = converted
            .entries
            .iter()
            .find_map(|entry| match entry {
                StoredEntry::ToolCall { message, .. } => Some(message),
                _ => None,
            })
            .expect("expected tool call entry");

        assert_eq!(converted.title, "run ls");
        assert_eq!(tool_call.id, "call-1");
        assert_eq!(tool_call.name, "bash");
        assert_eq!(tool_call.status, ToolCallStatus::Completed);
        assert_eq!(
            tool_call.result,
            Some(serde_json::Value::String(
                "Process exited with code 0".to_string()
            ))
        );
    }
}
