//! Codex session parser for local rollout JSONL files.
//!
//! Codex stores sessions under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.

use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use anyhow::Result;
use chrono::Utc;
use ignore::WalkBuilder;
use serde_json::Value;

use crate::acp::parsers::AgentType;
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session::ingress::plugin::tool_table_for;
use crate::acp::session_update::tool_merge::calculate_todo_timing_on_provider_events;
use crate::acp::session_update::{
    parse_normalized_questions, parse_normalized_todo_update, parse_normalized_todos,
    tool_call_status_from_str, ToolCallData, ToolCallStatus,
};
use crate::acp::tool_identity::ToolClassificationHints;
use crate::acp::types::CanonicalAgentId;

/// Load rollout history as ingress provider events (no `SessionThreadSnapshot` wrapper).
pub async fn load_provider_events(
    session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
) -> Result<Vec<ProviderEvent>, String> {
    let Some(parsed) = parse_rollout_file(session_id, project_path, source_path)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Err(format!(
            "Codex rollout history missing for session {session_id}"
        ));
    };

    Ok(parsed.events)
}

struct RolloutParseResult {
    events: Vec<ProviderEvent>,
    created_at: String,
    title: String,
}

struct CodexRolloutEventAccumulator {
    events: Vec<ProviderEvent>,
    source: CanonicalAgentId,
    tool_table: &'static crate::acp::session::ingress::tool_table::ToolTable,
    provider_seq: u64,
    tool_event_indices: HashMap<String, usize>,
    serial: usize,
    session_id: String,
    last_user_text: Option<String>,
    last_assistant_text: Option<String>,
    first_user_message: Option<String>,
}

impl CodexRolloutEventAccumulator {
    fn new(session_id: &str) -> Self {
        Self {
            events: Vec::new(),
            source: CanonicalAgentId::Codex,
            tool_table: tool_table_for(&CanonicalAgentId::Codex)
                .expect("codex tool table registered"),
            provider_seq: 0,
            tool_event_indices: HashMap::new(),
            serial: 0,
            session_id: session_id.to_string(),
            last_user_text: None,
            last_assistant_text: None,
            first_user_message: None,
        }
    }

    fn finish_events(mut self) -> Vec<ProviderEvent> {
        calculate_todo_timing_on_provider_events(&mut self.events);
        self.events
    }

    fn next_provider_seq(&mut self) -> u64 {
        self.provider_seq += 1;
        self.provider_seq
    }

    fn timestamp_ms(timestamp: &Option<String>) -> Option<i64> {
        timestamp.as_ref().and_then(|value| {
            chrono::DateTime::parse_from_rfc3339(value)
                .ok()
                .map(|dt| dt.timestamp_millis())
        })
    }

    fn push_user_message(&mut self, message: String, timestamp: Option<String>) {
        if message.is_empty() || self.last_user_text.as_deref() == Some(message.as_str()) {
            return;
        }

        if self.first_user_message.is_none() {
            self.first_user_message = Some(message.clone());
        }
        self.last_user_text = Some(message.clone());
        self.last_assistant_text = None;

        self.serial += 1;
        let id = format!("codex-user-{}-{}", self.session_id, self.serial);
        let provider_seq = self.next_provider_seq();
        self.events.push(ProviderEvent {
            source: self.source.clone(),
            provider_seq,
            provider_row_id: id,
            timestamp_ms: Self::timestamp_ms(&timestamp),
            kind: ProviderEventKind::UserText {
                text: message,
                attempt_id: None,
            },
        });
    }

    fn push_assistant_message(&mut self, message: String, timestamp: Option<String>) {
        if message.is_empty() || self.last_assistant_text.as_deref() == Some(message.as_str()) {
            return;
        }

        self.last_assistant_text = Some(message.clone());
        self.last_user_text = None;

        self.serial += 1;
        let id = format!("codex-assistant-{}-{}", self.session_id, self.serial);
        let provider_seq = self.next_provider_seq();
        self.events.push(ProviderEvent {
            source: self.source.clone(),
            provider_seq,
            provider_row_id: id,
            timestamp_ms: Self::timestamp_ms(&timestamp),
            kind: ProviderEventKind::AssistantText { text: message },
        });
    }

    fn push_assistant_thought(&mut self, thought: String, timestamp: Option<String>) {
        if thought.is_empty() {
            return;
        }

        self.last_assistant_text = Some(thought.clone());
        self.last_user_text = None;

        self.serial += 1;
        let id = format!("codex-thought-{}-{}", self.session_id, self.serial);
        let provider_seq = self.next_provider_seq();
        self.events.push(ProviderEvent {
            source: self.source.clone(),
            provider_seq,
            provider_row_id: id,
            timestamp_ms: Self::timestamp_ms(&timestamp),
            kind: ProviderEventKind::AssistantThought {
                text: thought,
                redacted: None,
            },
        });
    }

    fn push_function_call(
        &mut self,
        call_id: String,
        name: String,
        raw_arguments: Value,
        timestamp: Option<String>,
    ) {
        self.last_user_text = None;
        self.last_assistant_text = None;

        let kind = self.tool_table.detect_tool_kind(&name);
        let normalized_questions =
            parse_normalized_questions(&name, &raw_arguments, AgentType::Codex);
        let normalized_todos = parse_normalized_todos(&name, &raw_arguments, AgentType::Codex);
        let normalized_todo_update =
            parse_normalized_todo_update(&name, &raw_arguments, AgentType::Codex);
        let classified = self.tool_table.classify_raw_tool_call(
            &call_id,
            &raw_arguments,
            ToolClassificationHints {
                name: Some(&name),
                title: Some(&name),
                kind: Some(kind),
                kind_hint: Some(kind.as_str()),
                locations: None,
            },
        );

        let tool_call = ToolCallData {
            id: call_id.clone(),
            name: classified.name,
            title: Some(name.clone()),
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(classified.kind),
            arguments: classified.arguments,
            diagnostic_input: None,
            skill_meta: None,
            locations: None,
            normalized_questions,
            normalized_todos,
            normalized_todo_update,
            parent_tool_use_id: None,
            task_children: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            question_answer: None,
        };

        let index = self.events.len();
        self.tool_event_indices.insert(call_id, index);
        let provider_seq = self.next_provider_seq();
        self.events.push(ProviderEvent {
            source: self.source.clone(),
            provider_seq,
            provider_row_id: tool_call.id.clone(),
            timestamp_ms: Self::timestamp_ms(&timestamp),
            kind: ProviderEventKind::ToolCall(tool_call),
        });
    }

    fn merge_function_call_output(&mut self, call_id: &str, output: String) {
        let status = tool_call_status_from_str(&infer_tool_status_from_output(&output));
        let Some(index) = self.tool_event_indices.get(call_id).copied() else {
            return;
        };
        let Some(event) = self.events.get_mut(index) else {
            return;
        };
        let ProviderEventKind::ToolCall(tool_call) = &mut event.kind else {
            return;
        };
        tool_call.result = Some(serde_json::Value::String(output));
        tool_call.status = status;
    }
}

async fn parse_rollout_file(
    session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
) -> Result<Option<RolloutParseResult>, anyhow::Error> {
    let Some(path) = resolve_session_file_path(session_id, project_path, source_path).await else {
        return Ok(None);
    };

    let file_content = tokio::fs::read_to_string(&path).await?;
    let mut accumulator = CodexRolloutEventAccumulator::new(session_id);
    let mut created_at: Option<String> = None;

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
                        accumulator.push_user_message(message, timestamp);
                    }
                    "agent_reasoning" => {
                        let thought = payload
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                        accumulator.push_assistant_thought(thought, timestamp);
                    }
                    "agent_message" => {
                        let message = payload
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                        accumulator.push_assistant_message(message, timestamp);
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
                            "user" => {}
                            "assistant" => {
                                accumulator.push_assistant_message(text, timestamp);
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

                        accumulator.push_function_call(call_id, name, raw_arguments, timestamp);
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
                        accumulator.merge_function_call_output(&call_id, output);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let created_at = created_at.unwrap_or_else(|| Utc::now().to_rfc3339());
    let title = accumulator
        .first_user_message
        .as_deref()
        .and_then(|t| crate::history::title_utils::derive_session_title(t, 100))
        .unwrap_or_else(|| "New Thread".to_string());

    Ok(Some(RolloutParseResult {
        events: accumulator.finish_events(),
        title,
        created_at,
    }))
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

    let Ok(record) = serde_json::from_str::<Value>(&first_line) else {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::stored_entry_events::provider_events_to_stored_entries;
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
    fn rollout_accumulator_dedupes_adjacent_user_messages() {
        let mut acc = CodexRolloutEventAccumulator::new("sess-1");
        acc.push_user_message("hello".to_string(), None);
        acc.push_user_message("hello".to_string(), None);
        let events = acc.finish_events();
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0].kind,
            ProviderEventKind::UserText { text, .. } if text == "hello"
        ));
    }

    #[test]
    fn rollout_accumulator_merges_function_call_output() {
        let mut acc = CodexRolloutEventAccumulator::new("sess-1");
        acc.push_function_call(
            "call-1".to_string(),
            "shell_command".to_string(),
            serde_json::json!({ "command": "echo hi" }),
            None,
        );
        acc.merge_function_call_output("call-1", "Process exited with code 0".to_string());
        let events = acc.finish_events();
        assert_eq!(events.len(), 1);
        match &events[0].kind {
            ProviderEventKind::ToolCall(tool_call) => {
                assert_eq!(tool_call.id, "call-1");
                assert_eq!(tool_call.status, ToolCallStatus::Completed);
            }
            other => panic!("expected tool call event, got {other:?}"),
        }
    }

    #[test]
    fn compat_snapshot_maps_provider_events_to_stored_entries() {
        let events = vec![ProviderEvent {
            source: CanonicalAgentId::Codex,
            provider_seq: 1,
            provider_row_id: "user-1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::UserText {
                text: "hello".to_string(),
                attempt_id: None,
            },
        }];
        let entries = provider_events_to_stored_entries(&events);
        assert_eq!(entries.len(), 1);
        assert!(matches!(entries[0], StoredEntry::User { .. }));
    }
}
