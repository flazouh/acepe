mod parser;
pub(crate) use parser::{
    events_jsonl_path_for_session, missing_transcript_marker, resolve_copilot_session_state_root,
};

use crate::acp::client::AcpClient;
use crate::acp::event_hub::{AcpEventEnvelope, AcpEventHubState};
use crate::acp::parsers::AgentType;
use crate::acp::provider::AgentProvider;
use crate::acp::providers::copilot::CopilotProvider;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::{SessionUpdate, ToolArguments, ToolCallData};
use crate::acp::types::ContentBlock;
use crate::db::repository::SessionJournalEventRepository;
use crate::session_converter::{calculate_todo_timing, merge_tool_call_update};
use crate::session_jsonl::types::{
    ConvertedSession, SessionStats, StoredAssistantChunk, StoredAssistantMessage,
    StoredContentBlock, StoredEntry, StoredUserMessage,
};
use chrono::{TimeZone, Utc};
use sea_orm::DbConn;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const REPLAY_IDLE_TIMEOUT: Duration = Duration::from_millis(500);
const REPLAY_MAX_WAIT: Duration = Duration::from_secs(5);
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
    app: &AppHandle,
    replay_context: &SessionReplayContext,
    cwd: &str,
    title: &str,
) -> Result<Option<ConvertedSession>, String> {
    if let Some(source_path) = replay_context.source_path.as_deref() {
        if !source_path.is_empty() && !parser::is_missing_transcript_marker(source_path) {
            let session_state_root = parser::resolve_copilot_session_state_root()?;
            match parser::parse_copilot_session_at_root(
                &session_state_root,
                Path::new(source_path),
                title,
            )
            .await
            {
                Ok(converted) => return Ok(Some(converted)),
                Err(error) => {
                    tracing::info!(
                        session_id = %replay_context.local_session_id,
                        source_path = %source_path,
                        error = %error,
                        "Falling back to ACP replay for Copilot session"
                    );
                }
            }
        }
    }

    // Next fallback: load from session journal (events persisted during live session).
    if let Some(converted) =
        load_session_from_journal(app, &replay_context.local_session_id, title).await
    {
        return Ok(Some(converted));
    }

    // Slow path: ACP replay fallback for sessions without a usable transcript or journal
    // (e.g., sessions created before journal was introduced, or external Copilot sessions).
    load_session_via_acp_replay(app, replay_context, cwd, title).await
}

/// Load a Copilot session by replaying persisted journal events from the database.
/// Returns `None` if no journal events exist for this session.
async fn load_session_from_journal(
    app: &AppHandle,
    session_id: &str,
    title: &str,
) -> Option<ConvertedSession> {
    let db = app
        .try_state::<DbConn>()
        .map(|state| state.inner().clone())?;

    let rows = SessionJournalEventRepository::list_serialized(&db, session_id)
        .await
        .ok()?;

    if rows.is_empty() {
        return None;
    }

    let replay_context = crate::acp::session_descriptor::SessionReplayContext {
        local_session_id: session_id.to_string(),
        history_session_id: session_id.to_string(),
        agent_id: crate::acp::types::CanonicalAgentId::Copilot,
        parser_agent_type: AgentType::Copilot,
        project_path: String::new(),
        worktree_path: None,
        effective_cwd: String::new(),
        source_path: None,
        compatibility: crate::acp::session_descriptor::SessionDescriptorCompatibility::Canonical,
    };

    let events =
        crate::acp::session_journal::decode_serialized_events(&replay_context, rows).ok()?;

    let updates: Vec<(u64, SessionUpdate)> = events
        .into_iter()
        .filter_map(|event| {
            if let crate::acp::session_journal::SessionJournalEventPayload::ProjectionUpdate {
                update,
            } = event.payload
            {
                Some((
                    event.created_at_ms.max(0) as u64,
                    update.into_session_update(),
                ))
            } else {
                None
            }
        })
        .collect();

    if updates.is_empty() {
        return None;
    }

    tracing::info!(
        session_id = %session_id,
        journal_events = updates.len(),
        "Loaded Copilot session from journal"
    );

    Some(convert_replay_updates_to_session(
        session_id, title, &updates,
    ))
}

/// Fallback: load a Copilot session by spawning a Copilot process and replaying via ACP.
async fn load_session_via_acp_replay(
    app: &AppHandle,
    replay_context: &SessionReplayContext,
    cwd: &str,
    title: &str,
) -> Result<Option<ConvertedSession>, String> {
    let provider = Arc::new(CopilotProvider);
    if !provider.is_available() {
        return Ok(None);
    }

    let hub = app.state::<Arc<AcpEventHubState>>();
    let mut receiver = hub.subscribe();
    let mut client = AcpClient::new_with_provider(provider, Some(app.clone()), PathBuf::from(cwd))
        .map_err(|error| format!("Failed to create Copilot session loader: {error}"))?;

    client
        .start()
        .await
        .map_err(|error| format!("Failed to start Copilot session loader: {error}"))?;
    client
        .initialize()
        .await
        .map_err(|error| format!("Failed to initialize Copilot session loader: {error}"))?;

    let load_result = client
        .load_session(replay_context.history_session_id.clone(), cwd.to_string())
        .await;
    let replay_updates = collect_replay_updates(
        &mut receiver,
        &replay_context.history_session_id,
        replay_context.parser_agent_type,
    )
    .await;
    client.stop();

    match load_result {
        Ok(_) => Ok(Some(convert_replay_updates_to_session(
            &replay_context.local_session_id,
            title,
            &replay_updates,
        ))),
        Err(crate::acp::error::AcpError::SessionNotFound(_)) => Ok(None),
        Err(error) => Err(format!("Failed to load Copilot session: {error}")),
    }
}

pub fn convert_replay_updates_to_session(
    session_id: &str,
    title: &str,
    updates: &[(u64, SessionUpdate)],
) -> ConvertedSession {
    let mut accumulator = ReplayAccumulator::new();

    for (emitted_at_ms, update) in updates {
        accumulator.push(*emitted_at_ms, update);
    }

    accumulator.finish(session_id, title)
}

async fn collect_replay_updates(
    receiver: &mut tokio::sync::broadcast::Receiver<AcpEventEnvelope>,
    session_id: &str,
    replay_agent: AgentType,
) -> Vec<(u64, SessionUpdate)> {
    let started = tokio::time::Instant::now();
    let mut updates = Vec::new();

    loop {
        let elapsed = started.elapsed();
        if elapsed >= REPLAY_MAX_WAIT {
            break;
        }

        let remaining_total = REPLAY_MAX_WAIT.saturating_sub(elapsed);
        let wait = remaining_total.min(REPLAY_IDLE_TIMEOUT);

        match tokio::time::timeout(wait, receiver.recv()).await {
            Ok(Ok(envelope)) => {
                if envelope.event_name != "acp-session-update" {
                    continue;
                }

                if envelope.session_id.as_deref() != Some(session_id) {
                    continue;
                }

                match crate::acp::agent_context::with_agent(replay_agent, || {
                    serde_json::from_value::<SessionUpdate>(envelope.payload)
                }) {
                    Ok(update) => updates.push((envelope.emitted_at_ms, update)),
                    Err(error) => {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %error,
                            "Failed to deserialize Copilot replay update from event hub"
                        );
                    }
                }
            }
            Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped))) => {
                tracing::warn!(
                    session_id = %session_id,
                    skipped = skipped,
                    "Lagged while collecting Copilot replay updates"
                );
            }
            Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
            Err(_) => break,
        }
    }

    updates
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
    current: Vec<crate::acp::session_update::EditDelta>,
    incoming: Vec<crate::acp::session_update::EditDelta>,
) -> Vec<crate::acp::session_update::EditDelta> {
    crate::acp::tool_call_presentation::merge_edit_entries(current, incoming)
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
        }
    }

    stats
}

#[cfg(test)]
mod tests {
    use super::{collect_replay_updates, convert_replay_updates_to_session};
    use crate::acp::agent_context::with_agent;
    use crate::acp::event_hub::AcpEventEnvelope;
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::{
        ContentChunk, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind,
    };
    use crate::acp::types::ContentBlock;
    use crate::session_jsonl::types::StoredEntry;

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

    #[tokio::test]
    async fn collect_replay_updates_uses_explicit_replay_agent() {
        let (sender, mut receiver) = tokio::sync::broadcast::channel(4);
        sender
            .send(AcpEventEnvelope {
                seq: 1,
                event_name: "acp-session-update".to_string(),
                session_id: Some("replay-session".to_string()),
                payload: serde_json::json!({
                    "sessionId": "replay-session",
                    "toolCallId": "tool-search-1",
                    "title": "Search branch:main|branch: in desktop",
                    "kind": "search",
                    "status": "running"
                }),
                priority: "normal".to_string(),
                droppable: false,
                emitted_at_ms: 1_710_000_000_000,
            })
            .expect("send replay event");

        let updates = with_agent(AgentType::ClaudeCode, || async {
            collect_replay_updates(&mut receiver, "replay-session", AgentType::Codex).await
        })
        .await;

        assert_eq!(updates.len(), 1);
        match &updates[0].1 {
            crate::acp::session_update::SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.id, "tool-search-1");
                assert_eq!(tool_call.kind, Some(ToolKind::Search));
            }
            other => panic!("expected replayed tool call, got {:?}", other),
        }
    }
}
