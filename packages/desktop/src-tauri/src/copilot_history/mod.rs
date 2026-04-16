mod parser;
pub(crate) use parser::{
    events_jsonl_path_for_session, missing_transcript_marker, resolve_copilot_session_state_root,
};

use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolCallData, TurnErrorData, TurnErrorKind,
};
use crate::acp::types::ContentBlock;
use crate::session_converter::{calculate_todo_timing, merge_tool_call_update};
use crate::session_jsonl::types::{
    ConvertedSession, SessionStats, StoredAssistantChunk, StoredAssistantMessage,
    StoredContentBlock, StoredEntry, StoredErrorMessage, StoredUserMessage,
};
use chrono::{TimeZone, Utc};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
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
    parser::scan_copilot_sessions_at_root(&session_state_root, project_paths).await
}

pub async fn load_session(
    _app: &AppHandle,
    replay_context: &SessionReplayContext,
    _cwd: &str,
    title: &str,
) -> Result<Option<ConvertedSession>, String> {
    let session_state_root = parser::resolve_copilot_session_state_root()?;
    let transcript_path = resolve_transcript_path(&session_state_root, replay_context);

    match parser::parse_copilot_session_at_root(&session_state_root, &transcript_path, title).await
    {
        Ok(converted) => Ok(Some(converted)),
        Err(error) => {
            tracing::info!(
                session_id = %replay_context.local_session_id,
                history_session_id = %replay_context.history_session_id,
                transcript_path = %transcript_path.display(),
                error = %error,
                "Copilot session disk parse failed"
            );
            Ok(None)
        }
    }
}

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

pub(crate) fn convert_replay_updates_to_session(
    session_id: &str,
    title: &str,
    updates: &[(u64, SessionUpdate)],
) -> ConvertedSession {
    let mut accumulator = ReplayAccumulator::new();

    for (emitted_at_ms, update) in updates {
        if matches!(update, SessionUpdate::AgentThoughtChunk { .. }) {
            continue;
        }
        accumulator.push(*emitted_at_ms, update);
    }

    accumulator.finish(session_id, title)
}
fn fallback_title(session_id: &str) -> String {
    let short_id = &session_id[..8.min(session_id.len())];
    format!("Session {short_id}")
}

fn timestamp_ms_to_rfc3339(timestamp_ms: u64) -> String {
    Utc.timestamp_millis_opt(timestamp_ms as i64)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn stored_block_from_content(block: &ContentBlock) -> StoredContentBlock {
    match block {
        ContentBlock::Text { text } => StoredContentBlock {
            block_type: "text".to_string(),
            text: Some(text.clone()),
        },
        ContentBlock::Resource { resource } => StoredContentBlock {
            block_type: "resource".to_string(),
            text: resource.text.clone(),
        },
        ContentBlock::ResourceLink { title, name, .. } => StoredContentBlock {
            block_type: "resource_link".to_string(),
            text: title.clone().or_else(|| Some(name.clone())),
        },
        ContentBlock::Image { .. } => StoredContentBlock {
            block_type: "image".to_string(),
            text: None,
        },
        ContentBlock::Audio { .. } => StoredContentBlock {
            block_type: "audio".to_string(),
            text: None,
        },
    }
}

fn combine_user_blocks(chunks: &[StoredContentBlock]) -> StoredContentBlock {
    let texts = chunks
        .iter()
        .filter_map(|chunk| chunk.text.as_deref())
        .collect::<Vec<_>>();

    if texts.is_empty() {
        return chunks.first().cloned().unwrap_or(StoredContentBlock {
            block_type: "text".to_string(),
            text: Some(String::new()),
        });
    }

    StoredContentBlock {
        block_type: "text".to_string(),
        text: Some(texts.join("")),
    }
}

fn turn_error_message(error: &TurnErrorData) -> &str {
    match error {
        TurnErrorData::Legacy(message) => message.as_str(),
        TurnErrorData::Structured(info) => info.message.as_str(),
    }
}

fn stored_error_message_from_turn_error(error: &TurnErrorData) -> StoredErrorMessage {
    match error {
        TurnErrorData::Legacy(message) => StoredErrorMessage {
            content: message.clone(),
            code: None,
            kind: TurnErrorKind::Recoverable,
            source: None,
        },
        TurnErrorData::Structured(info) => StoredErrorMessage {
            content: info.message.clone(),
            code: info.code.map(|code| code.to_string()),
            kind: info.kind,
            source: info.source,
        },
    }
}

fn assistant_message_matches_turn_error(
    message: &StoredAssistantMessage,
    error_message: &str,
) -> bool {
    if message.chunks.len() != 1 {
        return false;
    }

    let Some(chunk) = message.chunks.first() else {
        return false;
    };
    if chunk.chunk_type != "message" {
        return false;
    }

    let Some(text) = chunk.block.text.as_deref() else {
        return false;
    };

    text.trim() == error_message.trim()
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
        raw_input: incoming.raw_input.or(current.raw_input),
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
        parent_tool_use_id: incoming.parent_tool_use_id.or(current.parent_tool_use_id),
        task_children: incoming.task_children.or(current.task_children),
        question_answer: incoming.question_answer.or(current.question_answer),
        awaiting_plan_approval: incoming.awaiting_plan_approval,
        plan_approval_request_id: next_plan_approval_request_id,
    }
}

struct ReplayAccumulator {
    entries: Vec<StoredEntry>,
    assistant_indices: HashMap<String, usize>,
    tool_call_indices: HashMap<String, usize>,
    next_user_index: usize,
    next_assistant_index: usize,
    next_error_index: usize,
    last_assistant_key: Option<String>,
    first_event_timestamp: Option<String>,
}

impl ReplayAccumulator {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
            assistant_indices: HashMap::new(),
            tool_call_indices: HashMap::new(),
            next_user_index: 1,
            next_assistant_index: 1,
            next_error_index: 1,
            last_assistant_key: None,
            first_event_timestamp: None,
        }
    }

    fn push(&mut self, emitted_at_ms: u64, update: &SessionUpdate) {
        if self.first_event_timestamp.is_none() {
            self.first_event_timestamp = Some(timestamp_ms_to_rfc3339(emitted_at_ms));
        }

        let timestamp = Some(timestamp_ms_to_rfc3339(emitted_at_ms));

        match update {
            SessionUpdate::UserMessageChunk { chunk, .. } => {
                self.last_assistant_key = None;
                self.push_user_chunk(chunk, timestamp);
            }
            SessionUpdate::AgentMessageChunk {
                chunk, message_id, ..
            } => {
                self.push_assistant_chunk(chunk, message_id.as_deref(), false, timestamp);
            }
            SessionUpdate::AgentThoughtChunk {
                chunk, message_id, ..
            } => {
                self.push_assistant_chunk(chunk, message_id.as_deref(), true, timestamp);
            }
            SessionUpdate::ToolCall { tool_call, .. } => {
                self.last_assistant_key = None;
                if let Some(index) = self.tool_call_indices.get(&tool_call.id).copied() {
                    if let Some(StoredEntry::ToolCall { message, .. }) = self.entries.get_mut(index)
                    {
                        *message = merge_replay_tool_call(message.clone(), tool_call.clone());
                    }
                } else {
                    let entry_index = self.entries.len();
                    self.tool_call_indices
                        .insert(tool_call.id.clone(), entry_index);
                    self.entries.push(StoredEntry::ToolCall {
                        id: tool_call.id.clone(),
                        message: tool_call.clone(),
                        timestamp,
                    });
                }
            }
            SessionUpdate::ToolCallUpdate { update, .. } => {
                if let Some(index) = self.tool_call_indices.get(&update.tool_call_id).copied() {
                    if let Some(StoredEntry::ToolCall { message, .. }) = self.entries.get_mut(index)
                    {
                        merge_tool_call_update(message, update);
                    }
                }
            }
            SessionUpdate::TurnError { error, .. } => {
                self.last_assistant_key = None;
                self.remove_trailing_assistant_error_echo(error);
                self.push_turn_error(error, timestamp);
            }
            _ => {}
        }
    }

    fn finish(mut self, session_id: &str, title: &str) -> ConvertedSession {
        calculate_todo_timing(&mut self.entries);

        let resolved_title = if title.trim().is_empty() {
            fallback_title(session_id)
        } else {
            title.to_string()
        };

        ConvertedSession {
            stats: build_stats(&self.entries),
            title: resolved_title,
            created_at: self
                .first_event_timestamp
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            entries: self.entries,
            current_mode_id: None,
        }
    }

    fn push_user_chunk(
        &mut self,
        chunk: &crate::acp::session_update::ContentChunk,
        timestamp: Option<String>,
    ) {
        let block = stored_block_from_content(&chunk.content);

        if let Some(StoredEntry::User { message, .. }) = self.entries.last_mut() {
            message.chunks.push(block);
            message.content = combine_user_blocks(&message.chunks);
            if message.sent_at.is_none() {
                message.sent_at = timestamp;
            }
            return;
        }

        let id = format!("user-{}", self.next_user_index);
        self.next_user_index += 1;
        self.entries.push(StoredEntry::User {
            id: id.clone(),
            message: StoredUserMessage {
                id: Some(id),
                content: block.clone(),
                chunks: vec![block],
                sent_at: timestamp.clone(),
            },
            timestamp,
        });
    }

    fn push_assistant_chunk(
        &mut self,
        chunk: &crate::acp::session_update::ContentChunk,
        message_id: Option<&str>,
        is_thought: bool,
        timestamp: Option<String>,
    ) {
        let key = message_id
            .map(ToString::to_string)
            .or_else(|| self.last_assistant_key.clone())
            .unwrap_or_else(|| {
                let id = format!("assistant-{}", self.next_assistant_index);
                self.next_assistant_index += 1;
                id
            });

        self.last_assistant_key = Some(key.clone());

        let chunk_entry = StoredAssistantChunk {
            chunk_type: if is_thought {
                "thought".to_string()
            } else {
                "message".to_string()
            },
            block: stored_block_from_content(&chunk.content),
        };

        if let Some(index) = self.assistant_indices.get(&key).copied() {
            if let Some(StoredEntry::Assistant { message, .. }) = self.entries.get_mut(index) {
                message.chunks.push(chunk_entry);
            }
            return;
        }

        let entry_index = self.entries.len();
        self.assistant_indices.insert(key.clone(), entry_index);
        self.entries.push(StoredEntry::Assistant {
            id: key,
            message: StoredAssistantMessage {
                chunks: vec![chunk_entry],
                model: None,
                display_model: None,
                received_at: timestamp.clone(),
            },
            timestamp,
        });
    }

    fn remove_trailing_assistant_error_echo(&mut self, error: &TurnErrorData) {
        let should_remove = match self.entries.last() {
            Some(StoredEntry::Assistant { message, .. }) => {
                assistant_message_matches_turn_error(message, turn_error_message(error))
            }
            _ => false,
        };

        if !should_remove {
            return;
        }

        let removed = self.entries.pop();
        if let Some(StoredEntry::Assistant { id, .. }) = removed {
            self.assistant_indices.remove(&id);
        }
    }

    fn push_turn_error(&mut self, error: &TurnErrorData, timestamp: Option<String>) {
        let id = format!("error-{}", self.next_error_index);
        self.next_error_index += 1;
        self.entries.push(StoredEntry::Error {
            id,
            message: stored_error_message_from_turn_error(error),
            timestamp,
        });
    }
}

fn build_stats(entries: &[StoredEntry]) -> SessionStats {
    let mut stats = SessionStats {
        total_messages: entries.len(),
        ..SessionStats::default()
    };

    for entry in entries {
        match entry {
            StoredEntry::User { .. } => {
                stats.user_messages += 1;
            }
            StoredEntry::Assistant { message, .. } => {
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
    use super::{convert_replay_updates_to_session, resolve_transcript_path};
    use crate::acp::parsers::AgentType;
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::session_update::{
        ContentChunk, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind,
        TurnErrorData, TurnErrorInfo, TurnErrorKind,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::acp::types::ContentBlock;
    use crate::session_jsonl::types::StoredEntry;
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
    fn converts_replay_updates_into_thread_entries() {
        let session_id = "copilot-session-1";
        let converted = convert_replay_updates_to_session(
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
                        session_id: Some(session_id.to_string()),
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
                            },
                            raw_input: None,
                            status: ToolCallStatus::Pending,
                            result: None,
                            kind: Some(ToolKind::Read),
                            title: Some("Read README".to_string()),
                            locations: None,
                            skill_meta: None,
                            normalized_questions: None,
                            normalized_todos: None,
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

        assert_eq!(converted.title, "Copilot Session");
        assert_eq!(converted.entries.len(), 3);

        match &converted.entries[0] {
            StoredEntry::User { message, .. } => {
                assert_eq!(message.content.text.as_deref(), Some("Summarize the repo"));
            }
            other => panic!("expected user entry, got {:?}", other),
        }

        match &converted.entries[1] {
            StoredEntry::Assistant { message, .. } => {
                assert_eq!(message.chunks.len(), 1);
                assert_eq!(
                    message.chunks[0].block.text.as_deref(),
                    Some("Scanning the workspace")
                );
            }
            other => panic!("expected assistant entry, got {:?}", other),
        }

        match &converted.entries[2] {
            StoredEntry::ToolCall { message, .. } => {
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
            },
            raw_input: None,
            status: ToolCallStatus::Completed,
            result: Some(serde_json::json!({ "content": "Acepe" })),
            kind: Some(ToolKind::Read),
            title: Some("Read README".to_string()),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: Some("task-1".to_string()),
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        };

        let converted = convert_replay_updates_to_session(
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
                            raw_input: None,
                            status: ToolCallStatus::Pending,
                            result: None,
                            kind: Some(ToolKind::Task),
                            title: Some("Explain the codebase".to_string()),
                            locations: None,
                            skill_meta: None,
                            normalized_questions: None,
                            normalized_todos: None,
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
                            raw_input: None,
                            status: ToolCallStatus::Pending,
                            result: None,
                            kind: Some(ToolKind::Task),
                            title: Some("Explain the codebase".to_string()),
                            locations: None,
                            skill_meta: None,
                            normalized_questions: None,
                            normalized_todos: None,
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
            StoredEntry::ToolCall { message, .. } => {
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
        let converted = convert_replay_updates_to_session(
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
                        session_id: Some(session_id.to_string()),
                    },
                ),
            ],
        );

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
            other => panic!("expected assistant entry, got {:?}", other),
        }
    }

    #[test]
    fn replaces_synthetic_error_echo_with_error_entry() {
        let session_id = "copilot-session-error";
        let error_message = "You've hit your limit. Please wait before trying again.";
        let converted = convert_replay_updates_to_session(
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
                        session_id: Some(session_id.to_string()),
                    },
                ),
                (
                    1_710_000_021_000,
                    crate::acp::session_update::SessionUpdate::TurnError {
                        error: TurnErrorData::Structured(TurnErrorInfo {
                            message: error_message.to_string(),
                            kind: TurnErrorKind::Recoverable,
                            code: Some(429),
                            source: None,
                        }),
                        session_id: Some(session_id.to_string()),
                        turn_id: None,
                    },
                ),
            ],
        );

        assert_eq!(converted.entries.len(), 2);

        match &converted.entries[1] {
            StoredEntry::Error { message, .. } => {
                assert_eq!(message.content, error_message);
                assert_eq!(message.code.as_deref(), Some("429"));
                assert_eq!(message.kind, TurnErrorKind::Recoverable);
            }
            other => panic!("expected error entry, got {:?}", other),
        }
    }
}
