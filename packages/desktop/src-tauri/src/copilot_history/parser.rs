use super::CopilotListedSession;
use crate::acp::commands::session_metadata_context_from_cwd;
use crate::acp::parsers::{CopilotParser, ParseError};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::{
    build_tool_call_from_raw, build_tool_call_update_from_raw, ContentChunk, RawToolCallInput,
    RawToolCallUpdateInput, SessionUpdate, ToolCallStatus, ToolKind,
};
use crate::acp::types::ContentBlock;
use crate::history::constants::MAX_SESSIONS_PER_PROJECT;
use crate::history::title_utils::normalize_display_title;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::cmp::Reverse;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const COPILOT_CONFIG_DIR_NAME: &str = ".copilot";
const SESSION_STATE_DIR_NAME: &str = "session-state";
const EVENTS_FILE_NAME: &str = "events.jsonl";
const WORKSPACE_FILE_NAME: &str = "workspace.yaml";
const FALLBACK_MARKER_PREFIX: &str = "__session_registry__/copilot_missing/";

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CopilotEvent {
    pub timestamp_ms: u64,
    data: CopilotEventData,
}

#[derive(Debug, Clone, PartialEq)]
enum CopilotEventData {
    SessionStart,
    UserMessage(UserMessageData),
    AssistantMessage(AssistantMessageData),
    AssistantReasoning(AssistantReasoningData),
    ToolExecutionStart(ToolExecutionStartData),
    ToolExecutionComplete(ToolExecutionCompleteData),
    SubagentStarted(SubagentStartedData),
    SubagentCompleted(SubagentCompletedData),
    Other,
}

#[derive(Debug, Clone, PartialEq)]
struct UserMessageData {
    content: String,
}

#[derive(Debug, Clone, PartialEq)]
struct AssistantMessageData {
    message_id: Option<String>,
    content: String,
    reasoning_content: Option<String>,
    tool_requests: Vec<AssistantToolRequest>,
}

#[derive(Debug, Clone, PartialEq)]
struct AssistantToolRequest {
    tool_call_id: String,
    name: String,
    arguments: Value,
    title: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
struct AssistantReasoningData {
    message_id: Option<String>,
    content: String,
}

#[derive(Debug, Clone, PartialEq)]
struct ToolExecutionStartData {
    tool_call_id: String,
    tool_name: String,
    arguments: Value,
}

#[derive(Debug, Clone, PartialEq)]
struct ToolExecutionCompleteData {
    tool_call_id: String,
    success: bool,
    result: Option<Value>,
    tool_name: Option<String>,
    raw_input: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
struct SubagentStartedData {
    tool_call_id: String,
    agent_name: Option<String>,
    agent_display_name: Option<String>,
    agent_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
struct SubagentCompletedData {
    tool_call_id: String,
    agent_name: Option<String>,
    agent_display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawCopilotEventEnvelope {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    data: Value,
    timestamp: String,
}

#[derive(Debug, Default, Deserialize)]
struct WorkspaceMetadata {
    cwd: Option<String>,
    summary: Option<String>,
    updated_at: Option<String>,
}

pub(crate) fn resolve_copilot_session_state_root() -> Result<PathBuf, String> {
    let home_dir =
        dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(home_dir
        .join(COPILOT_CONFIG_DIR_NAME)
        .join(SESSION_STATE_DIR_NAME))
}

pub(crate) fn missing_transcript_marker(session_id: &str) -> String {
    format!("{FALLBACK_MARKER_PREFIX}{session_id}")
}

pub(crate) fn is_missing_transcript_marker(path: &str) -> bool {
    path.starts_with(FALLBACK_MARKER_PREFIX)
}

pub(crate) fn events_jsonl_path_for_session(
    session_state_root: &Path,
    session_id: &str,
) -> PathBuf {
    session_state_root.join(session_id).join(EVENTS_FILE_NAME)
}

pub(crate) async fn parse_copilot_session_at_root(
    session_state_root: &Path,
    events_jsonl_path: &Path,
    title: &str,
) -> Result<SessionThreadSnapshot, String> {
    let canonical_root = session_state_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Copilot session-state root: {error}"))?;
    let path_to_parse = if events_jsonl_path.is_absolute() {
        events_jsonl_path.to_path_buf()
    } else {
        canonical_root.join(events_jsonl_path)
    };
    let canonical_path = path_to_parse
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Copilot transcript path: {error}"))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("Copilot transcript path is outside the session-state root".to_string());
    }

    let fallback_session_id = session_id_from_events_path(&canonical_path)
        .ok_or_else(|| "Failed to determine Copilot session ID from transcript path".to_string())?;
    let title_owned = title.to_string();

    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&canonical_path)
            .map_err(|error| format!("Failed to open Copilot transcript: {error}"))?;
        let reader = BufReader::new(file);
        let events = parse_events_from_reader(reader)
            .map_err(|error| format!("Failed to parse Copilot transcript: {error}"))?;
        let updates = convert_events_to_updates(&fallback_session_id, events);
        if updates.is_empty() {
            return Err("Copilot transcript did not contain replayable events".to_string());
        }
        Ok(super::convert_replay_updates_to_session(
            &fallback_session_id,
            &title_owned,
            &updates,
        ))
    })
    .await
    .map_err(|error| format!("Failed to join Copilot transcript parser task: {error}"))?
}

pub(crate) fn parse_events_from_reader<R: BufRead>(
    reader: R,
) -> Result<Vec<CopilotEvent>, ParseError> {
    let mut events = Vec::new();

    for (index, line_result) in reader.lines().enumerate() {
        let line = line_result.map_err(|error| {
            ParseError::InvalidFormat(format!(
                "Failed to read Copilot JSONL line {}: {error}",
                index + 1
            ))
        })?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let envelope: RawCopilotEventEnvelope = serde_json::from_str(trimmed).map_err(|error| {
            ParseError::InvalidFormat(format!(
                "Invalid Copilot JSONL on line {}: {error}",
                index + 1
            ))
        })?;
        let timestamp_ms = parse_timestamp_ms(&envelope.timestamp).map_err(|error| {
            ParseError::InvalidFormat(format!(
                "Invalid Copilot timestamp on line {}: {error}",
                index + 1
            ))
        })?;
        let data =
            parse_event_data(envelope.event_type.as_str(), envelope.data).map_err(|error| {
                ParseError::InvalidFormat(format!(
                    "Invalid Copilot {} payload on line {}: {error}",
                    envelope.event_type,
                    index + 1
                ))
            })?;
        events.push(CopilotEvent { timestamp_ms, data });
    }

    Ok(events)
}

pub(crate) fn convert_events_to_updates(
    session_id: &str,
    events: Vec<CopilotEvent>,
) -> Vec<(u64, SessionUpdate)> {
    let parser = CopilotParser;
    let mut updates = Vec::new();

    for event in events {
        let timestamp_ms = event.timestamp_ms;
        match event.data {
            CopilotEventData::SessionStart | CopilotEventData::Other => {}
            CopilotEventData::UserMessage(data) => {
                if data.content.trim().is_empty() {
                    continue;
                }
                updates.push((
                    timestamp_ms,
                    SessionUpdate::UserMessageChunk {
                        chunk: text_chunk(data.content),
                        session_id: Some(session_id.to_string()),
                    },
                ));
            }
            CopilotEventData::AssistantMessage(data) => {
                if let Some(reasoning_content) = data.reasoning_content {
                    if !reasoning_content.trim().is_empty() {
                        updates.push((
                            timestamp_ms,
                            SessionUpdate::AgentThoughtChunk {
                                chunk: text_chunk(reasoning_content),
                                part_id: None,
                                message_id: data.message_id.clone(),
                                session_id: Some(session_id.to_string()),
                            },
                        ));
                    }
                }

                if !data.content.trim().is_empty() {
                    updates.push((
                        timestamp_ms,
                        SessionUpdate::AgentMessageChunk {
                            chunk: text_chunk(data.content),
                            part_id: None,
                            message_id: data.message_id.clone(),
                            session_id: Some(session_id.to_string()),
                        },
                    ));
                }

                for tool_request in data.tool_requests {
                    let raw = RawToolCallInput {
                        id: tool_request.tool_call_id,
                        name: tool_request.name,
                        arguments: tool_request.arguments,
                        status: ToolCallStatus::Pending,
                        kind: None,
                        title: tool_request.title,
                        suppress_title_read_path_hint: false,
                        parent_tool_use_id: None,
                        task_children: None,
                    };
                    updates.push((
                        timestamp_ms,
                        SessionUpdate::ToolCall {
                            tool_call: build_tool_call_from_raw(&parser, raw),
                            session_id: Some(session_id.to_string()),
                        },
                    ));
                }
            }
            CopilotEventData::AssistantReasoning(data) => {
                if data.content.trim().is_empty() {
                    continue;
                }
                updates.push((
                    timestamp_ms,
                    SessionUpdate::AgentThoughtChunk {
                        chunk: text_chunk(data.content),
                        part_id: None,
                        message_id: data.message_id,
                        session_id: Some(session_id.to_string()),
                    },
                ));
            }
            CopilotEventData::ToolExecutionStart(data) => {
                let raw = RawToolCallInput {
                    id: data.tool_call_id,
                    name: data.tool_name,
                    arguments: data.arguments,
                    status: ToolCallStatus::InProgress,
                    kind: None,
                    title: None,
                    suppress_title_read_path_hint: false,
                    parent_tool_use_id: None,
                    task_children: None,
                };
                updates.push((
                    timestamp_ms,
                    SessionUpdate::ToolCall {
                        tool_call: build_tool_call_from_raw(&parser, raw),
                        session_id: Some(session_id.to_string()),
                    },
                ));
            }
            CopilotEventData::ToolExecutionComplete(data) => {
                let raw = RawToolCallUpdateInput {
                    id: data.tool_call_id,
                    status: Some(if data.success {
                        ToolCallStatus::Completed
                    } else {
                        ToolCallStatus::Failed
                    }),
                    result: data.result,
                    content: None,
                    title: None,
                    locations: None,
                    streaming_input_delta: None,
                    tool_name: data.tool_name,
                    raw_input: data.raw_input,
                    kind: None,
                };
                updates.push((
                    timestamp_ms,
                    SessionUpdate::ToolCallUpdate {
                        update: build_tool_call_update_from_raw(&parser, raw, Some(session_id)),
                        session_id: Some(session_id.to_string()),
                    },
                ));
            }
            CopilotEventData::SubagentStarted(data) => {
                let title = data
                    .agent_display_name
                    .clone()
                    .or(data.agent_name.clone())
                    .or_else(|| Some("Task".to_string()));
                let raw = RawToolCallInput {
                    id: data.tool_call_id,
                    name: "Task".to_string(),
                    arguments: json!({
                        "description": title.clone(),
                        "prompt": data.agent_description,
                        "subagent_type": data.agent_name
                    }),
                    status: ToolCallStatus::InProgress,
                    kind: Some(ToolKind::Task),
                    title,
                    suppress_title_read_path_hint: false,
                    parent_tool_use_id: None,
                    task_children: None,
                };
                updates.push((
                    timestamp_ms,
                    SessionUpdate::ToolCall {
                        tool_call: build_tool_call_from_raw(&parser, raw),
                        session_id: Some(session_id.to_string()),
                    },
                ));
            }
            CopilotEventData::SubagentCompleted(data) => {
                let raw = RawToolCallUpdateInput {
                    id: data.tool_call_id,
                    status: Some(ToolCallStatus::Completed),
                    result: Some(json!({
                        "agentName": data.agent_name,
                        "agentDisplayName": data.agent_display_name
                    })),
                    content: None,
                    title: None,
                    locations: None,
                    streaming_input_delta: None,
                    tool_name: Some("Task".to_string()),
                    raw_input: None,
                    kind: Some(ToolKind::Task),
                };
                updates.push((
                    timestamp_ms,
                    SessionUpdate::ToolCallUpdate {
                        update: build_tool_call_update_from_raw(&parser, raw, Some(session_id)),
                        session_id: Some(session_id.to_string()),
                    },
                ));
            }
        }
    }

    updates
}

pub(crate) async fn scan_copilot_sessions_at_root(
    session_state_root: &Path,
    project_paths: &[String],
) -> Result<Vec<CopilotListedSession>, String> {
    if project_paths.is_empty() {
        return Ok(Vec::new());
    }

    let workspace_projects = canonical_workspace_projects(project_paths);
    if workspace_projects.is_empty() {
        return Ok(Vec::new());
    }

    if !tokio::fs::try_exists(session_state_root)
        .await
        .map_err(|error| format!("Failed to check Copilot session-state root: {error}"))?
    {
        return Ok(Vec::new());
    }

    let mut entries = tokio::fs::read_dir(session_state_root)
        .await
        .map_err(|error| format!("Failed to read Copilot session-state root: {error}"))?;
    let mut sessions = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("Failed to iterate Copilot session-state root: {error}"))?
    {
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }
        let session_id = match entry_path.file_name().and_then(|value| value.to_str()) {
            Some(value) if !value.is_empty() => value.to_string(),
            _ => continue,
        };
        let workspace_path = entry_path.join(WORKSPACE_FILE_NAME);
        let workspace_contents = match tokio::fs::read_to_string(&workspace_path).await {
            Ok(contents) => contents,
            Err(_) => continue,
        };
        let metadata = parse_workspace_metadata(&workspace_contents);
        let Some(cwd) = metadata.cwd.filter(|value| !value.trim().is_empty()) else {
            continue;
        };
        let (project_path, worktree_path) = session_metadata_context_from_cwd(Path::new(&cwd));
        if !workspace_projects.contains(&project_path) {
            continue;
        }
        let updated_at_ms = metadata
            .updated_at
            .as_deref()
            .and_then(|value| parse_timestamp_ms(value).ok())
            .map(|value| value as i64)
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        let title = metadata
            .summary
            .filter(|value| !value.trim().is_empty())
            .map(|value| normalize_display_title(&value))
            .unwrap_or_else(|| fallback_title(&session_id));
        sessions.push(CopilotListedSession {
            session_id,
            title,
            updated_at_ms,
            project_path,
            worktree_path,
            cwd,
        });
    }

    sessions.sort_by_key(|session| Reverse(session.updated_at_ms));
    Ok(limit_sessions_per_project(sessions))
}

fn limit_sessions_per_project(sessions: Vec<CopilotListedSession>) -> Vec<CopilotListedSession> {
    let mut per_project_counts: HashMap<String, usize> = HashMap::new();
    let mut limited = Vec::new();

    for session in sessions {
        let count = per_project_counts
            .entry(session.project_path.clone())
            .or_insert(0);
        if *count >= MAX_SESSIONS_PER_PROJECT {
            continue;
        }
        *count += 1;
        limited.push(session);
    }

    limited
}

fn parse_event_data(event_type: &str, data: Value) -> Result<CopilotEventData, String> {
    match event_type {
        "session.start" => Ok(CopilotEventData::SessionStart),
        "user.message" => Ok(CopilotEventData::UserMessage(parse_user_message(data)?)),
        "assistant.message" => Ok(CopilotEventData::AssistantMessage(parse_assistant_message(
            data,
        )?)),
        "assistant.reasoning" => Ok(CopilotEventData::AssistantReasoning(
            parse_assistant_reasoning(data)?,
        )),
        "tool.execution_start" => Ok(CopilotEventData::ToolExecutionStart(
            parse_tool_execution_start(data)?,
        )),
        "tool.execution_complete" => Ok(CopilotEventData::ToolExecutionComplete(
            parse_tool_execution_complete(data)?,
        )),
        "subagent.started" => Ok(CopilotEventData::SubagentStarted(parse_subagent_started(
            data,
        )?)),
        "subagent.completed" => Ok(CopilotEventData::SubagentCompleted(
            parse_subagent_completed(data)?,
        )),
        _ => Ok(CopilotEventData::Other),
    }
}

fn parse_user_message(data: Value) -> Result<UserMessageData, String> {
    let content = data
        .get("content")
        .or_else(|| data.get("transformedContent"))
        .and_then(extract_text_value)
        .ok_or_else(|| "missing content".to_string())?;
    Ok(UserMessageData { content })
}

fn parse_assistant_message(data: Value) -> Result<AssistantMessageData, String> {
    let message_id = data
        .get("messageId")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let content = data
        .get("content")
        .or_else(|| data.get("transformedContent"))
        .and_then(extract_text_value)
        .unwrap_or_default();
    let reasoning_content = data
        .get("reasoningText")
        .or_else(|| data.get("reasoning"))
        .and_then(extract_text_value);
    let tool_requests = data
        .get("toolRequests")
        .and_then(Value::as_array)
        .map(|requests| {
            requests
                .iter()
                .filter_map(parse_tool_request)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(AssistantMessageData {
        message_id,
        content,
        reasoning_content,
        tool_requests,
    })
}

fn parse_assistant_reasoning(data: Value) -> Result<AssistantReasoningData, String> {
    let content = data
        .get("content")
        .or_else(|| data.get("reasoningText"))
        .or_else(|| data.get("text"))
        .and_then(extract_text_value)
        .ok_or_else(|| "missing reasoning content".to_string())?;
    Ok(AssistantReasoningData {
        message_id: data
            .get("messageId")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        content,
    })
}

fn parse_tool_execution_start(data: Value) -> Result<ToolExecutionStartData, String> {
    Ok(ToolExecutionStartData {
        tool_call_id: required_string(&data, "toolCallId")?,
        tool_name: required_string(&data, "toolName")?,
        arguments: data.get("arguments").cloned().unwrap_or_else(|| json!({})),
    })
}

fn parse_tool_execution_complete(data: Value) -> Result<ToolExecutionCompleteData, String> {
    Ok(ToolExecutionCompleteData {
        tool_call_id: required_string(&data, "toolCallId")?,
        success: data.get("success").and_then(Value::as_bool).unwrap_or(true),
        result: data.get("result").cloned(),
        tool_name: data
            .get("toolName")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        raw_input: data.get("rawInput").cloned(),
    })
}

fn parse_subagent_started(data: Value) -> Result<SubagentStartedData, String> {
    Ok(SubagentStartedData {
        tool_call_id: required_string(&data, "toolCallId")?,
        agent_name: data
            .get("agentName")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        agent_display_name: data
            .get("agentDisplayName")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        agent_description: data
            .get("agentDescription")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn parse_subagent_completed(data: Value) -> Result<SubagentCompletedData, String> {
    Ok(SubagentCompletedData {
        tool_call_id: required_string(&data, "toolCallId")?,
        agent_name: data
            .get("agentName")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        agent_display_name: data
            .get("agentDisplayName")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn parse_tool_request(value: &Value) -> Option<AssistantToolRequest> {
    Some(AssistantToolRequest {
        tool_call_id: value.get("toolCallId")?.as_str()?.to_string(),
        name: value.get("name")?.as_str()?.to_string(),
        arguments: value.get("arguments").cloned().unwrap_or_else(|| json!({})),
        title: value
            .get("intentionSummary")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn parse_workspace_metadata(contents: &str) -> WorkspaceMetadata {
    serde_yaml::from_str::<WorkspaceMetadata>(contents)
        .unwrap_or_else(|_| parse_workspace_metadata_legacy(contents))
}

fn parse_workspace_metadata_legacy(contents: &str) -> WorkspaceMetadata {
    let mut metadata = WorkspaceMetadata::default();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').to_string();
        match key.trim() {
            "cwd" => metadata.cwd = Some(value),
            "summary" => metadata.summary = Some(value),
            "updated_at" => metadata.updated_at = Some(value),
            _ => {}
        }
    }
    metadata
}

fn parse_timestamp_ms(value: &str) -> Result<u64, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.timestamp_millis().max(0) as u64)
        .or_else(|_| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f")
                .map(|timestamp| timestamp.and_utc().timestamp_millis().max(0) as u64)
        })
        .map_err(|error| error.to_string())
}

fn required_string(value: &Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("missing {field}"))
}

fn extract_text_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(array) = value.as_array() {
        let text = array
            .iter()
            .filter_map(|entry| {
                entry
                    .get("text")
                    .and_then(Value::as_str)
                    .or_else(|| entry.get("content").and_then(Value::as_str))
                    .or_else(|| entry.get("reasoningText").and_then(Value::as_str))
                    .map(ToString::to_string)
            })
            .collect::<Vec<_>>()
            .join("");
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

fn text_chunk(text: String) -> ContentChunk {
    ContentChunk {
        content: ContentBlock::Text { text },
        aggregation_hint: None,
    }
}

fn session_id_from_events_path(path: &Path) -> Option<String> {
    path.parent()?
        .file_name()?
        .to_str()
        .map(ToString::to_string)
}

fn canonical_workspace_projects(project_paths: &[String]) -> std::collections::HashSet<String> {
    project_paths
        .iter()
        .filter_map(|path| {
            Path::new(path)
                .canonicalize()
                .ok()
                .map(|canonical| canonical.to_string_lossy().into_owned())
        })
        .collect()
}

fn fallback_title(session_id: &str) -> String {
    let short_id = &session_id[..8.min(session_id.len())];
    format!("Session {short_id}")
}

#[cfg(test)]
mod tests {
    use super::{
        convert_events_to_updates, events_jsonl_path_for_session, missing_transcript_marker,
        parse_copilot_session_at_root, parse_events_from_reader, scan_copilot_sessions_at_root,
        CopilotEventData,
    };
    use crate::session_jsonl::types::StoredEntry;
    use std::io::Cursor;
    use tempfile::tempdir;

    #[test]
    fn parses_supported_events_and_preserves_unknown_types() {
        let jsonl = r#"
{"type":"session.start","data":{"sessionId":"session-1"},"timestamp":"2026-04-10T00:00:00Z"}
{"type":"user.message","data":{"content":"hello"},"timestamp":"2026-04-10T00:00:01Z"}
{"type":"assistant.message","data":{"messageId":"m1","content":"world","toolRequests":[{"toolCallId":"tool-1","name":"read","arguments":{"file_path":"README.md"},"intentionSummary":"Read README"}]},"timestamp":"2026-04-10T00:00:02Z"}
{"type":"session.compaction_start","data":{},"timestamp":"2026-04-10T00:00:03Z"}
"#;

        let events = parse_events_from_reader(Cursor::new(jsonl)).expect("events should parse");
        assert_eq!(events.len(), 4);
        assert!(matches!(events[0].data, CopilotEventData::SessionStart));
        assert!(matches!(events[1].data, CopilotEventData::UserMessage(_)));
        assert!(matches!(
            events[2].data,
            CopilotEventData::AssistantMessage(_)
        ));
        assert!(matches!(events[3].data, CopilotEventData::Other));
    }

    #[test]
    fn parser_errors_on_malformed_supported_event() {
        let jsonl = r#"
{"type":"user.message","data":{},"timestamp":"2026-04-10T00:00:01Z"}
"#;

        let error = parse_events_from_reader(Cursor::new(jsonl)).expect_err("parser should fail");
        assert!(error.to_string().contains("user.message"));
    }

    #[test]
    fn assistant_message_falls_back_to_transformed_content() {
        let jsonl = r#"
{"type":"assistant.message","data":{"messageId":"m1","transformedContent":"world"},"timestamp":"2026-04-10T00:00:02Z"}
"#;

        let events = parse_events_from_reader(Cursor::new(jsonl)).expect("events should parse");
        let updates = convert_events_to_updates("session-1", events);
        let converted =
            super::super::convert_replay_updates_to_session("session-1", "Copilot", &updates);

        assert_eq!(converted.entries.len(), 1);
        match &converted.entries[0] {
            StoredEntry::Assistant { message, .. } => {
                assert_eq!(message.chunks.len(), 1);
                assert_eq!(message.chunks[0].block.text.as_deref(), Some("world"));
            }
            other => panic!("expected assistant message entry, got {other:?}"),
        }
    }

    #[test]
    fn assistant_message_filters_inline_reasoning_text_from_restored_history() {
        let jsonl = r#"
{"type":"assistant.message","data":{"messageId":"m1","reasoningText":"thinking","content":"world"},"timestamp":"2026-04-10T00:00:02Z"}
"#;

        let events = parse_events_from_reader(Cursor::new(jsonl)).expect("events should parse");
        let updates = convert_events_to_updates("session-1", events);
        let converted =
            super::super::convert_replay_updates_to_session("session-1", "Copilot", &updates);

        assert_eq!(converted.entries.len(), 1);
        match &converted.entries[0] {
            StoredEntry::Assistant { message, .. } => {
                assert_eq!(message.chunks.len(), 1);
                assert_eq!(message.chunks[0].chunk_type, "message");
                assert_eq!(message.chunks[0].block.text.as_deref(), Some("world"));
            }
            other => panic!("expected assistant entry, got {other:?}"),
        }
    }

    #[test]
    fn direct_transcript_parse_filters_reasoning_chunks_from_restored_history() {
        let jsonl = r#"
{"type":"assistant.reasoning","data":{"messageId":"m1","content":"Investigating codebase options"},"timestamp":"2026-04-10T00:00:01Z"}
{"type":"assistant.message","data":{"messageId":"m1","content":"I found the replay path."},"timestamp":"2026-04-10T00:00:02Z"}
"#;

        let events = parse_events_from_reader(Cursor::new(jsonl)).expect("events should parse");
        let updates = convert_events_to_updates("session-1", events);
        let converted =
            super::super::convert_replay_updates_to_session("session-1", "Copilot", &updates);

        assert_eq!(converted.entries.len(), 1);
        match &converted.entries[0] {
            StoredEntry::Assistant { message, .. } => {
                assert_eq!(message.chunks.len(), 1);
                assert_eq!(message.chunks[0].chunk_type, "message");
                assert_eq!(
                    message.chunks[0].block.text.as_deref(),
                    Some("I found the replay path.")
                );
            }
            other => panic!("expected assistant entry, got {other:?}"),
        }
    }

    #[test]
    fn converts_execution_start_into_tool_call_when_no_request_exists() {
        let jsonl = r#"
{"type":"user.message","data":{"content":"inspect"},"timestamp":"2026-04-10T00:00:01Z"}
{"type":"assistant.message","data":{"messageId":"m1","content":"Scanning"},"timestamp":"2026-04-10T00:00:02Z"}
{"type":"tool.execution_start","data":{"toolCallId":"tool-1","toolName":"read","arguments":{"file_path":"README.md"}},"timestamp":"2026-04-10T00:00:03Z"}
{"type":"tool.execution_complete","data":{"toolCallId":"tool-1","success":true,"result":{"content":"done"}},"timestamp":"2026-04-10T00:00:04Z"}
"#;

        let events = parse_events_from_reader(Cursor::new(jsonl)).expect("events should parse");
        let updates = convert_events_to_updates("session-1", events);
        let converted =
            super::super::convert_replay_updates_to_session("session-1", "Copilot", &updates);

        assert_eq!(converted.entries.len(), 3);
        match &converted.entries[2] {
            StoredEntry::ToolCall { message, .. } => {
                assert_eq!(message.id, "tool-1");
                assert_eq!(
                    message.status,
                    crate::acp::session_update::ToolCallStatus::Completed
                );
            }
            other => panic!("expected tool call entry, got {other:?}"),
        }
    }

    #[test]
    fn assistant_view_tool_request_replays_as_read_tool_call() {
        let jsonl = r#"
{"type":"assistant.message","data":{"messageId":"m1","content":"","toolRequests":[{"toolCallId":"tool-1","name":"view","arguments":{"path":"/repo/src/file.rs","view_range":[1,80]},"intentionSummary":"view the file at /repo/src/file.rs."}]},"timestamp":"2026-04-10T00:00:02Z"}
"#;

        let events = parse_events_from_reader(Cursor::new(jsonl)).expect("events should parse");
        let updates = convert_events_to_updates("session-1", events);
        let converted =
            super::super::convert_replay_updates_to_session("session-1", "Copilot", &updates);

        assert_eq!(converted.entries.len(), 1);
        match &converted.entries[0] {
            StoredEntry::ToolCall { message, .. } => {
                assert_eq!(
                    message.kind,
                    Some(crate::acp::session_update::ToolKind::Read)
                );
                match &message.arguments {
                    crate::acp::session_update::ToolArguments::Read { file_path, .. } => {
                        assert_eq!(file_path.as_deref(), Some("/repo/src/file.rs"));
                    }
                    other => panic!("expected read arguments, got {other:?}"),
                }
            }
            other => panic!("expected tool call entry, got {other:?}"),
        }
    }

    #[test]
    fn assistant_generic_read_tool_request_with_pattern_replays_as_find_tool_call() {
        let jsonl = r#"
{"type":"assistant.message","data":{"messageId":"m1","content":"","toolRequests":[{"toolCallId":"tool-1","name":"read","arguments":{"path":"/repo","pattern":"packages/**/*agent-panel*"},"intentionSummary":"find agent panel files"}]},"timestamp":"2026-04-10T00:00:02Z"}
"#;

        let events = parse_events_from_reader(Cursor::new(jsonl)).expect("events should parse");
        let updates = convert_events_to_updates("session-1", events);
        let converted =
            super::super::convert_replay_updates_to_session("session-1", "Copilot", &updates);

        assert_eq!(converted.entries.len(), 1);
        match &converted.entries[0] {
            StoredEntry::ToolCall { message, .. } => {
                assert_eq!(
                    message.kind,
                    Some(crate::acp::session_update::ToolKind::Glob)
                );
                assert_eq!(message.name, "Find");
                match &message.arguments {
                    crate::acp::session_update::ToolArguments::Glob { pattern, path } => {
                        assert_eq!(pattern.as_deref(), Some("packages/**/*agent-panel*"));
                        assert_eq!(path.as_deref(), Some("/repo"));
                    }
                    other => panic!("expected glob arguments, got {other:?}"),
                }
            }
            other => panic!("expected tool call entry, got {other:?}"),
        }
    }

    #[test]
    fn assistant_update_todos_tool_request_replays_as_todo_tool_call() {
        let jsonl = r#"
{"type":"assistant.message","data":{"messageId":"m1","content":"","toolRequests":[{"toolCallId":"tool-1","name":"update_todos","arguments":{"todos":[{"content":"Inspect warning payload","activeForm":"Inspecting warning payload","status":"in_progress"}]},"intentionSummary":"update the task list"}]},"timestamp":"2026-04-10T00:00:02Z"}
"#;

        let events = parse_events_from_reader(Cursor::new(jsonl)).expect("events should parse");
        let updates = convert_events_to_updates("session-1", events);
        let converted =
            super::super::convert_replay_updates_to_session("session-1", "Copilot", &updates);

        assert_eq!(converted.entries.len(), 1);
        match &converted.entries[0] {
            StoredEntry::ToolCall { message, .. } => {
                assert_eq!(
                    message.kind,
                    Some(crate::acp::session_update::ToolKind::Todo)
                );
                let todos = message
                    .normalized_todos
                    .as_ref()
                    .expect("normalized todos should be present");
                assert_eq!(todos.len(), 1);
                assert_eq!(todos[0].content, "Inspect warning payload");
            }
            other => panic!("expected tool call entry, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn parse_copilot_session_rejects_path_outside_root() {
        let root = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside tempdir");
        let outside_path = outside.path().join("events.jsonl");
        std::fs::write(
            &outside_path,
            "{\"type\":\"user.message\",\"data\":{\"content\":\"hello\"},\"timestamp\":\"2026-04-10T00:00:01Z\"}\n",
        )
        .expect("write transcript");

        let error = parse_copilot_session_at_root(root.path(), &outside_path, "Copilot")
            .await
            .expect_err("path outside root should fail");
        assert!(error.contains("outside the session-state root"));
    }

    #[tokio::test]
    async fn parse_copilot_session_reads_valid_transcript() {
        let root = tempdir().expect("tempdir");
        let session_dir = root.path().join("session-1");
        std::fs::create_dir_all(&session_dir).expect("create session dir");
        let transcript_path = events_jsonl_path_for_session(root.path(), "session-1");
        std::fs::write(
            &transcript_path,
            concat!(
                "{\"type\":\"user.message\",\"data\":{\"content\":\"hello\"},\"timestamp\":\"2026-04-10T00:00:01Z\"}\n",
                "{\"type\":\"assistant.message\",\"data\":{\"messageId\":\"m1\",\"content\":\"world\"},\"timestamp\":\"2026-04-10T00:00:02Z\"}\n"
            ),
        )
        .expect("write transcript");

        let session = parse_copilot_session_at_root(root.path(), &transcript_path, "Copilot")
            .await
            .expect("session should parse");
        assert_eq!(session.entries.len(), 2);
    }

    #[tokio::test]
    async fn scan_copilot_sessions_normalizes_project_paths() {
        let root = tempdir().expect("tempdir");
        let project = tempdir().expect("project");
        git2::Repository::init(project.path()).expect("init repo");
        let nested = project.path().join("nested");
        std::fs::create_dir_all(&nested).expect("create nested project dir");
        let session_dir = root.path().join("session-1");
        std::fs::create_dir_all(&session_dir).expect("create session dir");
        std::fs::write(
            session_dir.join("workspace.yaml"),
            format!(
                "id: session-1\ncwd: {}\nsummary: Demo session\nupdated_at: 2026-04-10T00:00:02Z\n",
                nested.display()
            ),
        )
        .expect("write workspace");

        let sessions = scan_copilot_sessions_at_root(
            root.path(),
            &[project.path().to_string_lossy().into_owned()],
        )
        .await
        .expect("scan should succeed");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "session-1");
        assert_eq!(
            sessions[0].project_path,
            project
                .path()
                .canonicalize()
                .expect("canonical project")
                .to_string_lossy()
        );
    }

    #[tokio::test]
    async fn scan_copilot_sessions_reads_block_scalar_summary_titles() {
        let root = tempdir().expect("tempdir");
        let project = tempdir().expect("project");
        git2::Repository::init(project.path()).expect("init repo");
        let session_dir = root.path().join("session-1");
        std::fs::create_dir_all(&session_dir).expect("create session dir");
        std::fs::write(
            session_dir.join("workspace.yaml"),
            format!(
                "id: session-1\ncwd: {}\nsummary: |-\n  Demo session title\nupdated_at: 2026-04-10T00:00:02Z\n",
                project.path().display()
            ),
        )
        .expect("write workspace");

        let sessions = scan_copilot_sessions_at_root(
            root.path(),
            &[project.path().to_string_lossy().into_owned()],
        )
        .await
        .expect("scan should succeed");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "Demo session title");
    }

    #[test]
    fn missing_transcript_marker_uses_non_persisted_prefix() {
        assert!(missing_transcript_marker("session-1").starts_with("__session_registry__/"));
    }
}
