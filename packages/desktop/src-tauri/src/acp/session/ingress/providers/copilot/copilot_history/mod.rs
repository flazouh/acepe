mod parser;
pub(crate) use parser::{
    events_jsonl_path_for_session, missing_transcript_marker, resolve_copilot_session_state_root,
};

use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
#[cfg(test)]
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::tool_merge::{
    calculate_todo_timing_on_provider_events, merge_tool_call_update,
};
use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolCallData, TurnErrorData, TurnErrorKind,
};
use crate::acp::types::CanonicalAgentId;
use crate::acp::types::ContentBlock;
use crate::cc_sdk::AssistantMessageError;
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopilotListedSession {
    pub session_id: String,
    pub title: String,
    pub updated_at_ms: i64,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub cwd: String,
}

pub async fn list_workspace_sessions(
    project_paths: &[String],
) -> Result<Vec<CopilotListedSession>, String> {
    let session_state_root = parser::resolve_copilot_session_state_root()?;
    parser::scan_copilot_sessions_at_root(&session_state_root, project_paths, true).await
}

pub async fn list_workspace_project_paths() -> Result<Vec<String>, String> {
    let sessions = list_workspace_sessions(&[]).await?;
    let mut seen_paths = HashSet::new();
    let mut project_paths = Vec::new();

    for session in sessions {
        if seen_paths.insert(session.project_path.clone()) {
            project_paths.push(session.project_path);
        }
    }

    Ok(project_paths)
}

pub async fn count_workspace_sessions_for_project(project_path: &str) -> Result<u32, String> {
    let session_state_root = parser::resolve_copilot_session_state_root()?;
    let sessions = parser::scan_copilot_sessions_at_root(
        &session_state_root,
        &[project_path.to_string()],
        false,
    )
    .await?;
    u32::try_from(sessions.len())
        .map_err(|error| format!("Failed to convert Copilot session count: {error}"))
}

#[cfg(test)]
fn resolve_transcript_path(
    session_state_root: &Path,
    replay_context: &SessionReplayContext,
) -> PathBuf {
    match replay_context.source_path.as_deref() {
        Some(source_path)
            if !source_path.is_empty() && !parser::is_missing_transcript_marker(source_path) =>
        {
            PathBuf::from(source_path)
        }
        _ => events_jsonl_path_for_session(session_state_root, &replay_context.history_session_id),
    }
}

fn replay_updates_into_provider_events(
    updates: &[(u64, SessionUpdate)],
    source: CanonicalAgentId,
) -> Vec<ProviderEvent> {
    let mut accumulator = ProviderEventReplayAccumulator::new(source);

    for (emitted_at_ms, update) in updates {
        if matches!(update, SessionUpdate::AgentThoughtChunk { .. }) {
            continue;
        }
        accumulator.push(*emitted_at_ms, update);
    }

    accumulator.finish_events()
}

/// Map replayed Copilot session updates directly to ingress provider events.
///
/// Preserves replay merge/dedup/todo timing and skips thought chunks before canonical fold.
pub fn convert_replay_updates_to_provider_events(
    updates: &[(u64, SessionUpdate)],
) -> Vec<ProviderEvent> {
    replay_updates_into_provider_events(updates, CanonicalAgentId::Copilot)
}

#[cfg(test)]
struct CopilotHistoryEventBatch {
    entries: Vec<ProviderEvent>,
}

#[cfg(test)]
fn convert_replay_updates_to_history_events(
    _session_id: &str,
    _title: &str,
    updates: &[(u64, SessionUpdate)],
) -> CopilotHistoryEventBatch {
    CopilotHistoryEventBatch {
        entries: convert_replay_updates_to_provider_events(updates),
    }
}

pub async fn load_provider_events_from_disk(
    session_id: &str,
    source_path: Option<&str>,
) -> Result<Vec<ProviderEvent>, String> {
    let session_state_root = parser::resolve_copilot_session_state_root()?;
    let transcript_path = match source_path {
        Some(path) if !path.is_empty() && !parser::is_missing_transcript_marker(path) => {
            PathBuf::from(path)
        }
        _ => events_jsonl_path_for_session(&session_state_root, session_id),
    };

    parser::parse_copilot_provider_events_at_root(&session_state_root, &transcript_path).await
}
fn text_from_content_block(block: &ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text { text } => Some(text.clone()),
        ContentBlock::Resource { resource } => resource.text.clone(),
        ContentBlock::ResourceLink { title, name, .. } => {
            title.clone().or_else(|| Some(name.clone()))
        }
        ContentBlock::Image { .. } | ContentBlock::Audio { .. } => None,
    }
}

fn turn_error_message(error: &TurnErrorData) -> &str {
    match error {
        TurnErrorData::Legacy(message) => message.as_str(),
        TurnErrorData::Structured(info) => info.message.as_str(),
    }
}

fn merge_replay_tool_arguments(current: ToolArguments, incoming: ToolArguments) -> ToolArguments {
    match (current, incoming) {
        (
            ToolArguments::Edit {
                edits: current_edits,
            },
            ToolArguments::Edit {
                edits: incoming_edits,
            },
        ) => ToolArguments::Edit {
            edits: merge_replay_edit_entries(current_edits, incoming_edits),
        },
        (_, incoming_arguments) => incoming_arguments,
    }
}

fn merge_replay_edit_entries(
    current: Vec<crate::acp::session_update::EditEntry>,
    incoming: Vec<crate::acp::session_update::EditEntry>,
) -> Vec<crate::acp::session_update::EditEntry> {
    let max_len = current.len().max(incoming.len());
    let mut merged = Vec::with_capacity(max_len);

    for index in 0..max_len {
        let current_entry = current.get(index).cloned();
        let incoming_entry = incoming.get(index).cloned();

        let next_entry = match (current_entry, incoming_entry) {
            (Some(current_value), Some(incoming_value)) => crate::acp::session_update::EditEntry {
                file_path: incoming_value.file_path.or(current_value.file_path),
                move_from: incoming_value.move_from.or(current_value.move_from),
                old_string: incoming_value.old_string.or(current_value.old_string),
                new_string: incoming_value.new_string.or(current_value.new_string),
                content: incoming_value.content.or(current_value.content),
            },
            (Some(current_value), None) => current_value,
            (None, Some(incoming_value)) => incoming_value,
            (None, None) => continue,
        };

        merged.push(next_entry);
    }

    merged
}

fn merge_replay_tool_call(current: ToolCallData, incoming: ToolCallData) -> ToolCallData {
    let next_plan_approval_request_id = if incoming.awaiting_plan_approval {
        incoming
            .plan_approval_request_id
            .or(current.plan_approval_request_id)
    } else {
        None
    };

    ToolCallData {
        id: current.id,
        name: incoming.name,
        arguments: merge_replay_tool_arguments(current.arguments, incoming.arguments),
        diagnostic_input: incoming.diagnostic_input.or(current.diagnostic_input),
        status: incoming.status,
        result: incoming.result.or(current.result),
        kind: incoming.kind.or(current.kind),
        title: incoming.title.or(current.title),
        locations: incoming.locations.or(current.locations),
        skill_meta: incoming.skill_meta.or(current.skill_meta),
        normalized_questions: incoming
            .normalized_questions
            .or(current.normalized_questions),
        normalized_todos: incoming.normalized_todos.or(current.normalized_todos),
        normalized_todo_update: incoming
            .normalized_todo_update
            .or(current.normalized_todo_update),
        parent_tool_use_id: incoming.parent_tool_use_id.or(current.parent_tool_use_id),
        task_children: incoming.task_children.or(current.task_children),
        question_answer: incoming.question_answer.or(current.question_answer),
        awaiting_plan_approval: incoming.awaiting_plan_approval,
        plan_approval_request_id: next_plan_approval_request_id,
    }
}

fn assistant_message_error_from_turn_error(error: &TurnErrorData) -> AssistantMessageError {
    match error {
        TurnErrorData::Legacy(message) => {
            if message.contains("limit") {
                AssistantMessageError::RateLimit
            } else {
                AssistantMessageError::Unknown
            }
        }
        TurnErrorData::Structured(info) => {
            if info.code.as_deref() == Some("429") {
                AssistantMessageError::RateLimit
            } else {
                match info.kind {
                    TurnErrorKind::Fatal => AssistantMessageError::InvalidRequest,
                    TurnErrorKind::Recoverable => AssistantMessageError::Unknown,
                }
            }
        }
    }
}

fn timestamp_ms_to_provider_timestamp(timestamp_ms: u64) -> Option<i64> {
    i64::try_from(timestamp_ms).ok()
}

struct ProviderEventReplayAccumulator {
    events: Vec<ProviderEvent>,
    source: CanonicalAgentId,
    provider_seq: u64,
    tool_call_indices: HashMap<String, usize>,
    next_user_index: usize,
    next_assistant_index: usize,
    next_error_index: usize,
    last_assistant_key: Option<String>,
}

impl ProviderEventReplayAccumulator {
    fn new(source: CanonicalAgentId) -> Self {
        Self {
            events: Vec::new(),
            source,
            provider_seq: 0,
            tool_call_indices: HashMap::new(),
            next_user_index: 1,
            next_assistant_index: 1,
            next_error_index: 1,
            last_assistant_key: None,
        }
    }

    fn push(&mut self, emitted_at_ms: u64, update: &SessionUpdate) {
        let timestamp_ms = timestamp_ms_to_provider_timestamp(emitted_at_ms);

        match update {
            SessionUpdate::UserMessageChunk { chunk, .. } => {
                self.last_assistant_key = None;
                self.push_user_chunk(chunk, timestamp_ms);
            }
            SessionUpdate::AgentMessageChunk {
                chunk, message_id, ..
            } => {
                self.push_assistant_chunk(chunk, message_id.as_deref(), false, timestamp_ms);
            }
            SessionUpdate::AgentThoughtChunk {
                chunk, message_id, ..
            } => {
                self.push_assistant_chunk(chunk, message_id.as_deref(), true, timestamp_ms);
            }
            SessionUpdate::ToolCall { tool_call, .. } => {
                self.last_assistant_key = None;
                if let Some(index) = self.tool_call_indices.get(&tool_call.id).copied() {
                    if let Some(event) = self.events.get_mut(index) {
                        if let ProviderEventKind::ToolCall(message) = &mut event.kind {
                            *message = merge_replay_tool_call(message.clone(), tool_call.clone());
                        }
                    }
                } else {
                    self.push_tool_call(tool_call, timestamp_ms);
                }
            }
            SessionUpdate::ToolCallUpdate { update, .. } => {
                if let Some(index) = self.tool_call_indices.get(&update.tool_call_id).copied() {
                    if let Some(event) = self.events.get_mut(index) {
                        if let ProviderEventKind::ToolCall(message) = &mut event.kind {
                            merge_tool_call_update(message, update);
                        }
                    }
                }
            }
            SessionUpdate::TurnError { error, .. } => {
                self.last_assistant_key = None;
                self.remove_trailing_assistant_error_echo(error);
                self.push_turn_error(error, timestamp_ms);
            }
            _ => {}
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

    fn push_user_chunk(
        &mut self,
        chunk: &crate::acp::session_update::ContentChunk,
        timestamp_ms: Option<i64>,
    ) {
        let Some(text) =
            text_from_content_block(&chunk.content).filter(|text| !text.trim().is_empty())
        else {
            return;
        };

        let id = format!("user-{}", self.next_user_index);
        self.next_user_index += 1;
        let provider_seq = self.next_provider_seq();
        self.events.push(ProviderEvent {
            source: self.source.clone(),
            provider_seq,
            provider_row_id: id,
            timestamp_ms,
            kind: ProviderEventKind::UserText {
                text,
                attempt_id: None,
            },
        });
    }

    fn push_assistant_chunk(
        &mut self,
        chunk: &crate::acp::session_update::ContentChunk,
        message_id: Option<&str>,
        is_thought: bool,
        timestamp_ms: Option<i64>,
    ) {
        let Some(text) =
            text_from_content_block(&chunk.content).filter(|text| !text.trim().is_empty())
        else {
            return;
        };

        let key = message_id
            .map(ToString::to_string)
            .or_else(|| self.last_assistant_key.clone())
            .unwrap_or_else(|| {
                let id = format!("assistant-{}", self.next_assistant_index);
                self.next_assistant_index += 1;
                id
            });

        self.last_assistant_key = Some(key.clone());
        let provider_seq = self.next_provider_seq();
        let kind = if is_thought {
            ProviderEventKind::AssistantThought {
                text: text.clone(),
                redacted: None,
            }
        } else {
            ProviderEventKind::AssistantText { text }
        };

        self.events.push(ProviderEvent {
            source: self.source.clone(),
            provider_seq,
            provider_row_id: key,
            timestamp_ms,
            kind,
        });
    }

    fn push_tool_call(&mut self, tool_call: &ToolCallData, timestamp_ms: Option<i64>) {
        let entry_index = self.events.len();
        self.tool_call_indices
            .insert(tool_call.id.clone(), entry_index);
        let provider_seq = self.next_provider_seq();
        self.events.push(ProviderEvent {
            source: self.source.clone(),
            provider_seq,
            provider_row_id: tool_call.id.clone(),
            timestamp_ms,
            kind: ProviderEventKind::ToolCall(tool_call.clone()),
        });
    }

    fn remove_trailing_assistant_error_echo(&mut self, error: &TurnErrorData) {
        let error_message = turn_error_message(error);
        let should_remove = match self.events.last() {
            Some(ProviderEvent {
                kind: ProviderEventKind::AssistantText { text },
                ..
            }) => text.trim() == error_message.trim(),
            _ => false,
        };

        if !should_remove {
            return;
        }

        self.events.pop();
    }

    fn push_turn_error(&mut self, error: &TurnErrorData, timestamp_ms: Option<i64>) {
        let id = format!("error-{}", self.next_error_index);
        self.next_error_index += 1;
        let provider_seq = self.next_provider_seq();
        self.events.push(ProviderEvent {
            source: self.source.clone(),
            provider_seq,
            provider_row_id: id,
            timestamp_ms,
            kind: ProviderEventKind::AssistantError {
                text: turn_error_message(error).to_string(),
                error: assistant_message_error_from_turn_error(error),
            },
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{convert_replay_updates_to_history_events, resolve_transcript_path};
    use crate::acp::parsers::AgentType;
    use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::session_update::{
        ContentChunk, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind,
        TurnErrorData, TurnErrorInfo, TurnErrorKind,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::acp::types::ContentBlock;
    use std::path::Path;

    fn replay_context(source_path: Option<&str>) -> SessionReplayContext {
        SessionReplayContext {
            local_session_id: "local-session-1".to_string(),
            history_session_id: "history-session-1".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: source_path.map(ToString::to_string),
            compatibility: SessionDescriptorCompatibility::Canonical,
        }
    }

    #[test]
    fn resolve_transcript_path_prefers_explicit_source_path() {
        let session_state_root = Path::new("/tmp/copilot-session-state");
        let replay_context = replay_context(Some("/tmp/custom/events.jsonl"));

        let path = resolve_transcript_path(session_state_root, &replay_context);

        assert_eq!(path, Path::new("/tmp/custom/events.jsonl"));
    }

    #[test]
    fn resolve_transcript_path_falls_back_to_session_state_file_when_source_path_missing() {
        let session_state_root = Path::new("/tmp/copilot-session-state");
        let replay_context = replay_context(Some(
            "__session_registry__/copilot_missing/history-session-1",
        ));

        let path = resolve_transcript_path(session_state_root, &replay_context);

        assert_eq!(
            path,
            Path::new("/tmp/copilot-session-state/history-session-1/events.jsonl")
        );
    }

    #[test]
    fn converts_replay_updates_into_canonical_provider_events() {
        let session_id = "copilot-session-1";
        let converted = convert_replay_updates_to_history_events(
            session_id,
            "Copilot Session",
            &[
                (
                    1_710_000_000_000,
                    crate::acp::session_update::SessionUpdate::UserMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "Summarize the repo".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        session_id: Some(session_id.to_string()),
                        attempt_id: None,
                    },
                ),
                (
                    1_710_000_000_500,
                    crate::acp::session_update::SessionUpdate::AgentMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "Scanning the workspace".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        part_id: None,
                        message_id: Some("assistant-1".to_string()),
                        parent_tool_use_id: None,
                        session_id: Some(session_id.to_string()),
                        produced_at_monotonic_ms: None,
                    },
                ),
                (
                    1_710_000_001_000,
                    crate::acp::session_update::SessionUpdate::ToolCall {
                        tool_call: ToolCallData {
                            id: "tool-1".to_string(),
                            name: "Read".to_string(),
                            arguments: ToolArguments::Read {
                                file_path: Some("/repo/README.md".to_string()),
                                source_context: None,
                            },
                            diagnostic_input: None,
                            status: ToolCallStatus::Pending,
                            result: None,
                            kind: Some(ToolKind::Read),
                            title: Some("Read README".to_string()),
                            locations: None,
                            skill_meta: None,
                            normalized_questions: None,
                            normalized_todos: None,
                            normalized_todo_update: None,
                            parent_tool_use_id: None,
                            task_children: None,
                            question_answer: None,
                            awaiting_plan_approval: false,
                            plan_approval_request_id: None,
                        },
                        session_id: Some(session_id.to_string()),
                    },
                ),
                (
                    1_710_000_001_500,
                    crate::acp::session_update::SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id: "tool-1".to_string(),
                            status: Some(ToolCallStatus::Completed),
                            result: Some(serde_json::json!({ "ok": true })),
                            ..Default::default()
                        },
                        session_id: Some(session_id.to_string()),
                    },
                ),
            ],
        );

        assert_eq!(converted.entries.len(), 3);

        match &converted.entries[0] {
            ProviderEvent {
                kind: ProviderEventKind::UserText { text, .. },
                ..
            } => {
                assert_eq!(text, "Summarize the repo");
            }
            other => panic!("expected user entry, got {:?}", other),
        }

        match &converted.entries[1] {
            ProviderEvent {
                kind: ProviderEventKind::AssistantText { text },
                ..
            } => {
                assert_eq!(text, "Scanning the workspace");
            }
            other => panic!("expected assistant entry, got {:?}", other),
        }

        match &converted.entries[2] {
            ProviderEvent {
                kind: ProviderEventKind::ToolCall(message),
                ..
            } => {
                assert_eq!(message.status, ToolCallStatus::Completed);
                assert_eq!(message.result, Some(serde_json::json!({ "ok": true })));
            }
            other => panic!("expected tool call entry, got {:?}", other),
        }
    }

    #[test]
    fn merges_repeated_task_tool_calls_during_replay() {
        let session_id = "copilot-session-2";
        let child_tool = ToolCallData {
            id: "child-read-1".to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/repo/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Completed,
            result: Some(serde_json::json!({ "content": "Acepe" })),
            kind: Some(ToolKind::Read),
            title: Some("Read README".to_string()),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: Some("task-1".to_string()),
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        };

        let converted = convert_replay_updates_to_history_events(
            session_id,
            "Copilot Session",
            &[
                (
                    1_710_000_010_000,
                    crate::acp::session_update::SessionUpdate::ToolCall {
                        tool_call: ToolCallData {
                            id: "task-1".to_string(),
                            name: "Task".to_string(),
                            arguments: ToolArguments::Think {
                                description: Some("Explain the codebase".to_string()),
                                prompt: Some(
                                    "Explore the repository and summarize it.".to_string(),
                                ),
                                subagent_type: Some("explore".to_string()),
                                skill: None,
                                skill_args: None,
                                raw: None,
                            },
                            diagnostic_input: None,
                            status: ToolCallStatus::Pending,
                            result: None,
                            kind: Some(ToolKind::Task),
                            title: Some("Explain the codebase".to_string()),
                            locations: None,
                            skill_meta: None,
                            normalized_questions: None,
                            normalized_todos: None,
                            normalized_todo_update: None,
                            parent_tool_use_id: None,
                            task_children: None,
                            question_answer: None,
                            awaiting_plan_approval: false,
                            plan_approval_request_id: None,
                        },
                        session_id: Some(session_id.to_string()),
                    },
                ),
                (
                    1_710_000_010_500,
                    crate::acp::session_update::SessionUpdate::ToolCall {
                        tool_call: ToolCallData {
                            id: "task-1".to_string(),
                            name: "Task".to_string(),
                            arguments: ToolArguments::Think {
                                description: Some("Explain the codebase".to_string()),
                                prompt: Some(
                                    "Explore the repository and summarize it.".to_string(),
                                ),
                                subagent_type: Some("explore".to_string()),
                                skill: None,
                                skill_args: None,
                                raw: None,
                            },
                            diagnostic_input: None,
                            status: ToolCallStatus::Pending,
                            result: None,
                            kind: Some(ToolKind::Task),
                            title: Some("Explain the codebase".to_string()),
                            locations: None,
                            skill_meta: None,
                            normalized_questions: None,
                            normalized_todos: None,
                            normalized_todo_update: None,
                            parent_tool_use_id: None,
                            task_children: Some(vec![child_tool.clone()]),
                            question_answer: None,
                            awaiting_plan_approval: false,
                            plan_approval_request_id: None,
                        },
                        session_id: Some(session_id.to_string()),
                    },
                ),
                (
                    1_710_000_011_000,
                    crate::acp::session_update::SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id: "task-1".to_string(),
                            status: Some(ToolCallStatus::Completed),
                            result: Some(serde_json::json!("Done")),
                            ..Default::default()
                        },
                        session_id: Some(session_id.to_string()),
                    },
                ),
            ],
        );

        assert_eq!(converted.entries.len(), 1);

        match &converted.entries[0] {
            ProviderEvent {
                kind: ProviderEventKind::ToolCall(message),
                ..
            } => {
                assert_eq!(message.id, "task-1");
                assert_eq!(message.status, ToolCallStatus::Completed);
                assert_eq!(message.result, Some(serde_json::json!("Done")));
                let children = message
                    .task_children
                    .as_ref()
                    .expect("task children should be preserved");
                assert_eq!(children.len(), 1);
                assert_eq!(children[0].id, "child-read-1");
            }
            other => panic!("expected tool call entry, got {:?}", other),
        }
    }

    #[test]
    fn replay_conversion_filters_copilot_thought_chunks_from_restored_history() {
        let session_id = "copilot-session-thought";
        let converted = convert_replay_updates_to_history_events(
            session_id,
            "Copilot Session",
            &[
                (
                    1_710_000_020_000,
                    crate::acp::session_update::SessionUpdate::AgentThoughtChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "Investigating codebase options".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        part_id: None,
                        message_id: Some("assistant-1".to_string()),
                        parent_tool_use_id: None,
                        session_id: Some(session_id.to_string()),
                    },
                ),
                (
                    1_710_000_020_500,
                    crate::acp::session_update::SessionUpdate::AgentMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "I found the replay path.".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        part_id: None,
                        message_id: Some("assistant-1".to_string()),
                        parent_tool_use_id: None,
                        session_id: Some(session_id.to_string()),
                        produced_at_monotonic_ms: None,
                    },
                ),
            ],
        );

        assert_eq!(converted.entries.len(), 1);
        match &converted.entries[0] {
            ProviderEvent {
                kind: ProviderEventKind::AssistantText { text },
                ..
            } => {
                assert_eq!(text, "I found the replay path.");
            }
            other => panic!("expected assistant entry, got {:?}", other),
        }
    }

    #[test]
    fn replay_conversion_keeps_distinct_user_messages_separate_without_assistant_content() {
        let session_id = "copilot-session-consecutive-users";
        let converted = convert_replay_updates_to_history_events(
            session_id,
            "Copilot Session",
            &[
                (
                    1_710_000_020_000,
                    crate::acp::session_update::SessionUpdate::UserMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "continue".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        session_id: Some(session_id.to_string()),
                        attempt_id: None,
                    },
                ),
                (
                    1_710_000_021_000,
                    crate::acp::session_update::SessionUpdate::UserMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "continue".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        session_id: Some(session_id.to_string()),
                        attempt_id: None,
                    },
                ),
            ],
        );

        assert_eq!(converted.entries.len(), 2);
        match (&converted.entries[0], &converted.entries[1]) {
            (
                ProviderEvent {
                    kind: ProviderEventKind::UserText { text: first, .. },
                    ..
                },
                ProviderEvent {
                    kind: ProviderEventKind::UserText { text: second, .. },
                    ..
                },
            ) => {
                assert_eq!(first, "continue");
                assert_eq!(second, "continue");
            }
            other => panic!("expected two user entries, got {:?}", other),
        }
    }

    #[test]
    fn replaces_synthetic_error_echo_with_error_entry() {
        let session_id = "copilot-session-error";
        let error_message = "You've hit your limit. Please wait before trying again.";
        let converted = convert_replay_updates_to_history_events(
            session_id,
            "Copilot Session",
            &[
                (
                    1_710_000_020_000,
                    crate::acp::session_update::SessionUpdate::UserMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "Try again".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        session_id: Some(session_id.to_string()),
                        attempt_id: None,
                    },
                ),
                (
                    1_710_000_020_500,
                    crate::acp::session_update::SessionUpdate::AgentMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: error_message.to_string(),
                            },
                            aggregation_hint: None,
                        },
                        part_id: None,
                        message_id: None,
                        parent_tool_use_id: None,
                        session_id: Some(session_id.to_string()),
                        produced_at_monotonic_ms: None,
                    },
                ),
                (
                    1_710_000_021_000,
                    crate::acp::session_update::SessionUpdate::TurnError {
                        error: TurnErrorData::Structured(TurnErrorInfo {
                            message: error_message.to_string(),
                            kind: TurnErrorKind::Recoverable,
                            code: Some("429".to_string()),
                            source: None,
                            details: None,
                        }),
                        session_id: Some(session_id.to_string()),
                        turn_id: None,
                    },
                ),
            ],
        );

        assert_eq!(converted.entries.len(), 2);

        match &converted.entries[1] {
            ProviderEvent {
                kind: ProviderEventKind::AssistantError { text, error },
                ..
            } => {
                assert_eq!(text, error_message);
                assert_eq!(*error, crate::cc_sdk::AssistantMessageError::RateLimit);
            }
            other => panic!("expected error entry, got {:?}", other),
        }
    }
}
