use crate::acp::agent_context::with_agent;
use crate::acp::client_session::{SessionModelState, SessionModes};
use crate::acp::lifecycle::{DetachedReason, FailureReason};
use crate::acp::parsers::provider_capabilities::provider_capabilities;
use crate::acp::projections::projection_apply_router::route_projection_apply;
use crate::acp::projections::{
    InteractionResponse, InteractionSnapshot, InteractionState, ProjectionApplyRoute,
    ProjectionRegistry, SessionProjectionSnapshot, TerminalTurnGuard,
};
use crate::acp::provider::HistoryReplayFamily;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::{
    AvailableCommand, AvailableCommandsData, ConfigOptionData, ConfigOptionUpdateData,
    ContentChunk, CurrentModeData, PermissionData, PlanData, QuestionData, SessionCompactionEvent,
    SessionUpdate, ToolCallData, ToolCallUpdateData, TurnErrorData, UsageTelemetryData,
};
use crate::acp::transcript_projection::{TranscriptSegment, TranscriptSnapshot};
use crate::acp::types::ContentBlock;
use crate::db::repository::SerializedSessionJournalEventRow;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ProjectionJournalUpdate {
    UserMessageChunk {
        chunk: ContentChunk,
        session_id: Option<String>,
        attempt_id: Option<String>,
    },
    AgentMessageChunk {
        chunk: ContentChunk,
        part_id: Option<String>,
        message_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        session_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        produced_at_monotonic_ms: Option<u64>,
    },
    AgentThoughtChunk {
        chunk: ContentChunk,
        part_id: Option<String>,
        message_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        session_id: Option<String>,
    },
    ToolCall {
        tool_call: ToolCallData,
        session_id: Option<String>,
    },
    ToolCallUpdate {
        update: ToolCallUpdateData,
        session_id: Option<String>,
    },
    Plan {
        plan: PlanData,
        session_id: Option<String>,
    },
    AvailableCommandsUpdate {
        update: AvailableCommandsData,
        session_id: Option<String>,
    },
    CurrentModeUpdate {
        update: CurrentModeData,
        session_id: Option<String>,
    },
    ConfigOptionUpdate {
        update: ConfigOptionUpdateData,
        session_id: Option<String>,
    },
    PermissionRequest {
        permission: PermissionData,
        session_id: Option<String>,
    },
    QuestionRequest {
        question: QuestionData,
        session_id: Option<String>,
    },
    TurnComplete {
        session_id: Option<String>,
        turn_id: Option<String>,
    },
    TurnError {
        error: TurnErrorData,
        session_id: Option<String>,
        turn_id: Option<String>,
    },
    TurnCancelled {
        session_id: Option<String>,
        turn_id: Option<String>,
    },
    UsageTelemetryUpdate {
        data: UsageTelemetryData,
    },
    CompactionEvent {
        event: SessionCompactionEvent,
        session_id: Option<String>,
    },
    ConnectionComplete {
        session_id: String,
        attempt_id: u64,
        models: SessionModelState,
        modes: SessionModes,
        available_commands: Option<Vec<AvailableCommand>>,
        config_options: Option<Vec<ConfigOptionData>>,
        autonomous_enabled: Option<bool>,
    },
    ConnectionFailed {
        session_id: String,
        attempt_id: u64,
        error: String,
        failure_reason: FailureReason,
    },
    SessionDetached {
        session_id: String,
        attempt_id: u64,
        detached_reason: DetachedReason,
    },
}

impl ProjectionJournalUpdate {
    #[must_use]
    pub fn from_session_update(update: &SessionUpdate) -> Option<Self> {
        match update {
            SessionUpdate::UserMessageChunk {
                chunk,
                session_id,
                attempt_id,
            } => Some(Self::UserMessageChunk {
                chunk: chunk.clone(),
                session_id: session_id.clone(),
                attempt_id: attempt_id.clone(),
            }),
            SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                parent_tool_use_id,
                session_id,
                produced_at_monotonic_ms,
            } => Some(Self::AgentMessageChunk {
                chunk: chunk.clone(),
                part_id: part_id.clone(),
                message_id: message_id.clone(),
                parent_tool_use_id: parent_tool_use_id.clone(),
                session_id: session_id.clone(),
                produced_at_monotonic_ms: *produced_at_monotonic_ms,
            }),
            SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
                parent_tool_use_id,
                session_id,
            } => Some(Self::AgentThoughtChunk {
                chunk: chunk.clone(),
                part_id: part_id.clone(),
                message_id: message_id.clone(),
                parent_tool_use_id: parent_tool_use_id.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::ToolCall {
                tool_call,
                session_id,
            } => Some(Self::ToolCall {
                tool_call: tool_call.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::ToolCallUpdate { update, session_id } => Some(Self::ToolCallUpdate {
                update: update.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::Plan { plan, session_id } => Some(Self::Plan {
                plan: plan.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::AvailableCommandsUpdate { update, session_id } => {
                Some(Self::AvailableCommandsUpdate {
                    update: update.clone(),
                    session_id: session_id.clone(),
                })
            }
            SessionUpdate::CurrentModeUpdate { update, session_id } => {
                Some(Self::CurrentModeUpdate {
                    update: update.clone(),
                    session_id: session_id.clone(),
                })
            }
            SessionUpdate::ConfigOptionUpdate { update, session_id } => {
                Some(Self::ConfigOptionUpdate {
                    update: update.clone(),
                    session_id: session_id.clone(),
                })
            }
            SessionUpdate::PermissionRequest {
                permission,
                session_id,
            } => Some(Self::PermissionRequest {
                permission: permission.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::QuestionRequest {
                question,
                session_id,
            } => Some(Self::QuestionRequest {
                question: question.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::TurnComplete {
                session_id,
                turn_id,
            } => Some(Self::TurnComplete {
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
            }),
            SessionUpdate::TurnError {
                error,
                session_id,
                turn_id,
            } => Some(Self::TurnError {
                error: error.clone(),
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
            }),
            SessionUpdate::TurnCancelled {
                session_id,
                turn_id,
            } => Some(Self::TurnCancelled {
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
            }),
            SessionUpdate::UsageTelemetryUpdate { data } => {
                Some(Self::UsageTelemetryUpdate { data: data.clone() })
            }
            SessionUpdate::CompactionEvent { event, session_id } => Some(Self::CompactionEvent {
                event: event.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::ConnectionComplete {
                session_id,
                attempt_id,
                models,
                modes,
                available_commands,
                config_options,
                autonomous_enabled,
            } => Some(Self::ConnectionComplete {
                session_id: session_id.clone(),
                attempt_id: *attempt_id,
                models: models.clone(),
                modes: modes.clone(),
                available_commands: available_commands.clone(),
                config_options: config_options.clone(),
                autonomous_enabled: *autonomous_enabled,
            }),
            SessionUpdate::ConnectionFailed {
                session_id,
                attempt_id,
                error,
                failure_reason,
            } => Some(Self::ConnectionFailed {
                session_id: session_id.clone(),
                attempt_id: *attempt_id,
                error: error.clone(),
                failure_reason: *failure_reason,
            }),
            SessionUpdate::SessionDetached {
                session_id,
                attempt_id,
                detached_reason,
            } => Some(Self::SessionDetached {
                session_id: session_id.clone(),
                attempt_id: *attempt_id,
                detached_reason: *detached_reason,
            }),
        }
    }

    #[must_use]
    pub fn into_session_update(self) -> SessionUpdate {
        match self {
            Self::UserMessageChunk {
                chunk,
                session_id,
                attempt_id,
            } => SessionUpdate::UserMessageChunk {
                chunk,
                session_id,
                attempt_id,
            },
            Self::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                parent_tool_use_id,
                session_id,
                produced_at_monotonic_ms,
            } => SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                parent_tool_use_id,
                session_id,
                produced_at_monotonic_ms,
            },
            Self::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
                parent_tool_use_id,
                session_id,
            } => SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
                parent_tool_use_id,
                session_id,
            },
            Self::ToolCall {
                tool_call,
                session_id,
            } => SessionUpdate::ToolCall {
                tool_call,
                session_id,
            },
            Self::ToolCallUpdate { update, session_id } => {
                SessionUpdate::ToolCallUpdate { update, session_id }
            }
            Self::Plan { plan, session_id } => SessionUpdate::Plan { plan, session_id },
            Self::AvailableCommandsUpdate { update, session_id } => {
                SessionUpdate::AvailableCommandsUpdate { update, session_id }
            }
            Self::CurrentModeUpdate { update, session_id } => {
                SessionUpdate::CurrentModeUpdate { update, session_id }
            }
            Self::ConfigOptionUpdate { update, session_id } => {
                SessionUpdate::ConfigOptionUpdate { update, session_id }
            }
            Self::PermissionRequest {
                permission,
                session_id,
            } => SessionUpdate::PermissionRequest {
                permission,
                session_id,
            },
            Self::QuestionRequest {
                question,
                session_id,
            } => SessionUpdate::QuestionRequest {
                question,
                session_id,
            },
            Self::TurnComplete {
                session_id,
                turn_id,
            } => SessionUpdate::TurnComplete {
                session_id,
                turn_id,
            },
            Self::TurnError {
                error,
                session_id,
                turn_id,
            } => SessionUpdate::TurnError {
                error,
                session_id,
                turn_id,
            },
            Self::TurnCancelled {
                session_id,
                turn_id,
            } => SessionUpdate::TurnCancelled {
                session_id,
                turn_id,
            },
            Self::UsageTelemetryUpdate { data } => SessionUpdate::UsageTelemetryUpdate { data },
            Self::CompactionEvent { event, session_id } => {
                SessionUpdate::CompactionEvent { event, session_id }
            }
            Self::ConnectionComplete {
                session_id,
                attempt_id,
                models,
                modes,
                available_commands,
                config_options,
                autonomous_enabled,
            } => SessionUpdate::ConnectionComplete {
                session_id,
                attempt_id,
                models,
                modes,
                available_commands,
                config_options,
                autonomous_enabled,
            },
            Self::ConnectionFailed {
                session_id,
                attempt_id,
                error,
                failure_reason,
            } => SessionUpdate::ConnectionFailed {
                session_id,
                attempt_id,
                error,
                failure_reason,
            },
            Self::SessionDetached {
                session_id,
                attempt_id,
                detached_reason,
            } => SessionUpdate::SessionDetached {
                session_id,
                attempt_id,
                detached_reason,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum SessionJournalEventPayload {
    ProjectionUpdate {
        update: Box<ProjectionJournalUpdate>,
    },
    InteractionTransition {
        interaction_id: String,
        state: InteractionState,
        response: InteractionResponse,
    },
    InteractionSnapshot {
        interaction: InteractionSnapshot,
    },
    MaterializationBarrier,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionJournalEvent {
    pub event_id: String,
    pub session_id: String,
    pub event_seq: i64,
    pub created_at_ms: i64,
    pub payload: SessionJournalEventPayload,
}

impl SessionJournalEvent {
    #[must_use]
    pub fn new(session_id: &str, event_seq: i64, payload: SessionJournalEventPayload) -> Self {
        Self {
            event_id: format!("session-journal-event-{}", Uuid::new_v4()),
            session_id: session_id.to_string(),
            event_seq,
            created_at_ms: Utc::now().timestamp_millis().max(0),
            payload,
        }
    }

    #[must_use]
    pub fn event_kind(&self) -> &'static str {
        match &self.payload {
            SessionJournalEventPayload::ProjectionUpdate { .. } => "projection_update",
            SessionJournalEventPayload::InteractionTransition { .. } => "interaction_transition",
            SessionJournalEventPayload::InteractionSnapshot { .. } => "interaction_snapshot",
            SessionJournalEventPayload::MaterializationBarrier => "materialization_barrier",
        }
    }

    pub fn replay_into(&self, registry: &ProjectionRegistry) {
        match &self.payload {
            SessionJournalEventPayload::ProjectionUpdate { update } => {
                if matches!(
                    update.as_ref(),
                    ProjectionJournalUpdate::QuestionRequest { .. }
                ) {
                    return;
                }
                registry.apply_session_update(
                    &self.session_id,
                    &update.as_ref().clone().into_session_update(),
                );
            }
            SessionJournalEventPayload::InteractionTransition {
                interaction_id,
                state,
                response,
            } => {
                let _ = registry.resolve_interaction(
                    &self.session_id,
                    interaction_id,
                    state.clone(),
                    response.clone(),
                );
            }
            SessionJournalEventPayload::InteractionSnapshot { interaction } => {
                registry
                    .import_interaction_snapshot_at_event_seq(interaction.clone(), self.event_seq);
            }
            SessionJournalEventPayload::MaterializationBarrier => {}
        }
    }
}

#[must_use]
pub fn rebuild_session_projection(
    replay_context: &SessionReplayContext,
    events: &[SessionJournalEvent],
) -> SessionProjectionSnapshot {
    let registry = ProjectionRegistry::new();
    registry.register_session(
        replay_context.local_session_id.clone(),
        replay_context.agent_id.clone(),
    );

    let mut ordered_events = events.iter().collect::<Vec<_>>();
    ordered_events.sort_by_key(|event| event.event_seq);

    for event in ordered_events {
        if event.session_id == replay_context.local_session_id {
            event.replay_into(&registry);
        }
    }

    registry.session_projection(&replay_context.local_session_id)
}

#[must_use]
pub fn rebuild_local_transcript_snapshot(
    replay_context: &SessionReplayContext,
    events: &[SessionJournalEvent],
) -> Option<TranscriptSnapshot> {
    rebuild_local_transcript_snapshot_until(replay_context, events, None)
}

#[must_use]
pub fn rebuild_completed_local_transcript_snapshot(
    replay_context: &SessionReplayContext,
    events: &[SessionJournalEvent],
) -> Option<TranscriptSnapshot> {
    let last_complete_seq = events
        .iter()
        .filter(|event| event.session_id == replay_context.local_session_id)
        .filter_map(|event| match &event.payload {
            SessionJournalEventPayload::ProjectionUpdate { update } => match update.as_ref() {
                ProjectionJournalUpdate::TurnComplete { .. }
                | ProjectionJournalUpdate::TurnError { .. } => Some(event.event_seq),
                _ => None,
            },
            _ => None,
        })
        .max()?;

    rebuild_local_transcript_snapshot_until(replay_context, events, Some(last_complete_seq))
}

#[must_use]
pub(crate) fn repair_legacy_parent_tool_use_ids_from_streaming_log(
    replay_context: &SessionReplayContext,
    events: &[SessionJournalEvent],
) -> Vec<SessionJournalEvent> {
    let mut repairs =
        collect_parent_linked_outbound_text_from_streaming_log(&replay_context.local_session_id);
    if repairs.is_empty() {
        return events.to_vec();
    }

    events
        .iter()
        .map(|event| {
            let mut repaired = event.clone();
            if repaired.session_id != replay_context.local_session_id {
                return repaired;
            }
            let SessionJournalEventPayload::ProjectionUpdate { update } = &mut repaired.payload
            else {
                return repaired;
            };
            let ProjectionJournalUpdate::AgentMessageChunk {
                chunk,
                parent_tool_use_id,
                ..
            } = update.as_mut()
            else {
                return repaired;
            };
            if parent_tool_use_id.is_some() {
                return repaired;
            }
            let Some(text) = content_chunk_text(chunk) else {
                return repaired;
            };
            let Some(parent_ids) = repairs.get_mut(text) else {
                return repaired;
            };
            if let Some(parent_id) = parent_ids.pop_front() {
                *parent_tool_use_id = Some(parent_id);
            }
            if parent_ids.is_empty() {
                repairs.remove(text);
            }
            repaired
        })
        .collect()
}

fn content_chunk_text(chunk: &ContentChunk) -> Option<&str> {
    match &chunk.content {
        ContentBlock::Text { text } if !text.is_empty() => Some(text.as_str()),
        _ => None,
    }
}

fn collect_parent_linked_outbound_text_from_streaming_log(
    session_id: &str,
) -> HashMap<String, VecDeque<String>> {
    let Some(log_path) = crate::acp::streaming_log::get_log_file_path(session_id) else {
        return HashMap::new();
    };
    let Ok(content) = std::fs::read_to_string(&log_path) else {
        tracing::warn!(
            session_id = %session_id,
            path = %log_path.display(),
            "Failed to read streaming log for legacy subagent lineage repair"
        );
        return HashMap::new();
    };

    let mut pending_parent_texts: VecDeque<(String, String)> = VecDeque::new();
    let mut repairs: HashMap<String, VecDeque<String>> = HashMap::new();
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let direction = entry
            .get("direction")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(data) = entry.get("data") else {
            continue;
        };

        if direction == "in" {
            for (text, parent_id) in parent_linked_assistant_texts(data) {
                pending_parent_texts.push_back((text, parent_id));
            }
            continue;
        }

        if direction != "out" {
            continue;
        }
        let Some(outbound_text) = outbound_agent_message_text(data) else {
            continue;
        };
        let Some(match_index) = pending_parent_texts
            .iter()
            .position(|(text, _)| text == outbound_text)
        else {
            continue;
        };
        let Some((text, parent_id)) = pending_parent_texts.remove(match_index) else {
            continue;
        };
        repairs.entry(text).or_default().push_back(parent_id);
    }

    repairs
}

fn parent_linked_assistant_texts(data: &Value) -> Vec<(String, String)> {
    if data.get("type").and_then(Value::as_str) != Some("assistant") {
        return Vec::new();
    }
    let Some(message) = data.get("message") else {
        return Vec::new();
    };
    let Some(parent_id) = message
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return Vec::new();
    };

    let Some(content) = message.get("content") else {
        return Vec::new();
    };
    if let Some(text) = content.as_str().filter(|value| !value.is_empty()) {
        return vec![(text.to_string(), parent_id.to_string())];
    }

    let Some(blocks) = content.as_array() else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter_map(|block| {
            block
                .get("text")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(|text| (text.to_string(), parent_id.to_string()))
        })
        .collect()
}

fn outbound_agent_message_text(data: &Value) -> Option<&str> {
    if data.get("type").and_then(Value::as_str) != Some("agentMessageChunk") {
        return None;
    }
    data.get("chunk")?
        .get("content")?
        .get("text")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

fn rebuild_local_transcript_snapshot_until(
    replay_context: &SessionReplayContext,
    events: &[SessionJournalEvent],
    max_event_seq: Option<i64>,
) -> Option<TranscriptSnapshot> {
    let context = crate::acp::session::engine::fold::FoldContext::new(
        &replay_context.local_session_id,
        replay_context.agent_id.clone(),
        &replay_context.project_path,
    );
    let mut graph = crate::acp::session::engine::fold::fold_full(&[], &context);
    let mut terminal_guard = TerminalTurnGuard::default();
    let mut ordered_events = events.iter().collect::<Vec<_>>();
    ordered_events.sort_by_key(|event| event.event_seq);

    for event in ordered_events {
        if event.session_id != replay_context.local_session_id
            || max_event_seq.is_some_and(|max_event_seq| event.event_seq > max_event_seq)
        {
            continue;
        }
        let SessionJournalEventPayload::ProjectionUpdate { update } = &event.payload else {
            continue;
        };
        let session_update = update.as_ref().clone().into_session_update();
        let decision = terminal_guard.route(&session_update);
        if let Some(provider_event) =
            crate::acp::session::ingress::live_session_update::session_update_to_provider_event(
                replay_context.agent_id.clone(),
                event.event_seq,
                &session_update,
                decision,
            )
        {
            let previous_transcript = graph.transcript_snapshot.clone();
            graph = crate::acp::session::engine::fold::fold_step(&graph, &provider_event).0;
            if graph.transcript_snapshot != previous_transcript {
                graph.transcript_snapshot.revision =
                    graph.transcript_snapshot.revision.max(event.event_seq);
                graph.revision.transcript_revision = graph.transcript_snapshot.revision;
            }
        }
        if matches!(
            route_projection_apply(&session_update, &terminal_guard),
            ProjectionApplyRoute::Apply(_)
        ) {
            terminal_guard.advance(&session_update);
        }
    }

    if !graph
        .transcript_snapshot
        .entries
        .iter()
        .any(|entry| entry.segments.iter().any(TranscriptSegment::is_nonempty))
    {
        return None;
    }

    Some(graph.transcript_snapshot)
}

fn decode_serialized_event(
    replay_context: &SessionReplayContext,
    row: SerializedSessionJournalEventRow,
) -> Result<SessionJournalEvent, anyhow::Error> {
    let payload = match provider_capabilities(replay_context.parser_agent_type)
        .history_replay_policy
        .family
    {
        HistoryReplayFamily::ProviderOwned | HistoryReplayFamily::SharedCanonical => {
            with_agent(replay_context.parser_agent_type, || {
                serde_json::from_str::<SessionJournalEventPayload>(&row.event_json)
            })?
        }
    };

    Ok(SessionJournalEvent {
        event_id: row.event_id,
        session_id: row.session_id,
        event_seq: row.event_seq,
        created_at_ms: row.created_at_ms,
        payload,
    })
}

pub fn decode_serialized_events(
    replay_context: &SessionReplayContext,
    rows: Vec<SerializedSessionJournalEventRow>,
) -> Result<Vec<SessionJournalEvent>, anyhow::Error> {
    let mut events = rows
        .into_iter()
        .map(|row| decode_serialized_event(replay_context, row))
        .collect::<Result<Vec<_>, _>>()?;
    events.sort_by_key(|event| event.event_seq);
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::{
        decode_serialized_events, rebuild_completed_local_transcript_snapshot,
        rebuild_local_transcript_snapshot, rebuild_session_projection, ProjectionJournalUpdate,
        SessionJournalEventPayload,
    };
    use crate::acp::parsers::AgentType;
    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_descriptor::SessionReplayContext;
    use crate::acp::session_update::{
        AvailableCommandsData, ConfigOptionUpdateData, ContentChunk, CurrentModeData,
        PermissionData, PlanData, QuestionData, QuestionItem, QuestionOption,
        SessionCompactionEvent, SessionCompactionStatus, SessionCompactionTrigger, SessionUpdate,
        ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, TurnErrorData,
        UsageTelemetryData, UsageTelemetryTokens,
    };
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
    use crate::acp::types::CanonicalAgentId;
    use crate::acp::types::ContentBlock;
    use crate::db::repository::SerializedSessionJournalEventRow;
    use crate::db::repository::{SessionJournalEventRepository, SessionMetadataRepository};
    use sea_orm::Database;
    use sea_orm_migration::MigratorTrait;

    fn replay_context() -> SessionReplayContext {
        SessionReplayContext {
            local_session_id: "local-session".to_string(),
            history_session_id: "provider-session".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility:
                crate::acp::session_descriptor::SessionDescriptorCompatibility::Canonical,
        }
    }

    fn permission_update(index: usize) -> SessionUpdate {
        SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: format!("permission-{index}"),
                session_id: "local-session".to_string(),
                json_rpc_request_id: Some(index as u64),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(index as u64),
                ),
                permission: "Read".to_string(),
                patterns: vec![format!("/repo/file-{index}.txt")],
                metadata: serde_json::json!({}),
                always: vec![],
                auto_accepted: false,
                tool: None,
            },
            session_id: Some("local-session".to_string()),
        }
    }

    fn question_update(index: usize) -> SessionUpdate {
        SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: format!("question-{index}"),
                session_id: "local-session".to_string(),
                json_rpc_request_id: Some(index as u64),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(index as u64),
                ),
                questions: vec![QuestionItem {
                    question: "Proceed?".to_string(),
                    header: format!("Question {index}"),
                    options: vec![QuestionOption {
                        label: "Yes".to_string(),
                        description: "Continue".to_string(),
                    }],
                    multi_select: false,
                }],
                tool: None,
            },
            session_id: Some("local-session".to_string()),
        }
    }

    fn canonical_journal_updates() -> Vec<(&'static str, SessionUpdate)> {
        let session_id = Some("local-session".to_string());
        let chunk = ContentChunk {
            content: ContentBlock::Text {
                text: "hello".to_string(),
            },
            aggregation_hint: None,
        };
        let tool_call = ToolCallData {
            id: "tool-1".to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/repo/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: None,
            title: None,
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
        };

        vec![
            (
                "user_message_chunk",
                SessionUpdate::UserMessageChunk {
                    chunk: chunk.clone(),
                    session_id: session_id.clone(),
                    attempt_id: Some("attempt-1".to_string()),
                },
            ),
            (
                "agent_message_chunk",
                SessionUpdate::AgentMessageChunk {
                    chunk: chunk.clone(),
                    part_id: Some("part-1".to_string()),
                    message_id: Some("message-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: session_id.clone(),
                    produced_at_monotonic_ms: Some(1),
                },
            ),
            (
                "agent_thought_chunk",
                SessionUpdate::AgentThoughtChunk {
                    chunk,
                    part_id: Some("thought-1".to_string()),
                    message_id: Some("message-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: session_id.clone(),
                },
            ),
            (
                "tool_call",
                SessionUpdate::ToolCall {
                    tool_call,
                    session_id: session_id.clone(),
                },
            ),
            (
                "tool_call_update",
                SessionUpdate::ToolCallUpdate {
                    update: ToolCallUpdateData {
                        tool_call_id: "tool-1".to_string(),
                        status: Some(ToolCallStatus::Completed),
                        ..Default::default()
                    },
                    session_id: session_id.clone(),
                },
            ),
            (
                "plan",
                SessionUpdate::Plan {
                    plan: PlanData::from_steps(Vec::new()),
                    session_id: session_id.clone(),
                },
            ),
            (
                "available_commands_update",
                SessionUpdate::AvailableCommandsUpdate {
                    update: AvailableCommandsData {
                        available_commands: Vec::new(),
                    },
                    session_id: session_id.clone(),
                },
            ),
            (
                "current_mode_update",
                SessionUpdate::CurrentModeUpdate {
                    update: CurrentModeData {
                        current_mode_id: "agent".to_string(),
                    },
                    session_id: session_id.clone(),
                },
            ),
            (
                "config_option_update",
                SessionUpdate::ConfigOptionUpdate {
                    update: ConfigOptionUpdateData {
                        config_options: Vec::new(),
                    },
                    session_id: session_id.clone(),
                },
            ),
            ("permission_request", permission_update(1)),
            ("question_request", question_update(1)),
            (
                "turn_complete",
                SessionUpdate::TurnComplete {
                    session_id: session_id.clone(),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
            (
                "turn_error",
                SessionUpdate::TurnError {
                    error: TurnErrorData::Legacy("failed".to_string()),
                    session_id: session_id.clone(),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
            (
                "turn_cancelled",
                SessionUpdate::TurnCancelled {
                    session_id: session_id.clone(),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
            (
                "usage_telemetry_update",
                SessionUpdate::UsageTelemetryUpdate {
                    data: UsageTelemetryData {
                        session_id: "local-session".to_string(),
                        event_id: Some("usage-1".to_string()),
                        scope: "turn".to_string(),
                        cost_usd: Some(0.25),
                        tokens: UsageTelemetryTokens::default(),
                        source_model_id: Some("model-1".to_string()),
                        timestamp_ms: Some(10),
                        context_window_size: Some(200_000),
                        context_window_source: None,
                        parent_tool_use_id: None,
                    },
                },
            ),
            (
                "compaction_event",
                SessionUpdate::CompactionEvent {
                    event: SessionCompactionEvent {
                        event_id: "compaction-1".to_string(),
                        session_id: "local-session".to_string(),
                        status: SessionCompactionStatus::Completed,
                        trigger: SessionCompactionTrigger::Auto,
                        pre_compaction_tokens: Some(100),
                        post_compaction_tokens: Some(50),
                        dropped_tokens: Some(50),
                        context_window_size: Some(200_000),
                        duration_ms: Some(5),
                        precomputed: Some(false),
                        preserved_message_count: Some(2),
                        cumulative_dropped_tokens: Some(50),
                        timestamp_ms: Some(10),
                        summary: Some("summary".to_string()),
                        provider_metadata: serde_json::Value::Null,
                    },
                    session_id: session_id.clone(),
                },
            ),
            (
                "connection_complete",
                SessionUpdate::ConnectionComplete {
                    session_id: "local-session".to_string(),
                    attempt_id: 7,
                    models: crate::acp::client_session::default_session_model_state(),
                    modes: crate::acp::client_session::default_modes(),
                    available_commands: Some(Vec::new()),
                    config_options: Some(Vec::new()),
                    autonomous_enabled: Some(true),
                },
            ),
            (
                "connection_failed",
                SessionUpdate::ConnectionFailed {
                    session_id: "local-session".to_string(),
                    attempt_id: 8,
                    error: "offline".to_string(),
                    failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
                },
            ),
            (
                "session_detached",
                SessionUpdate::SessionDetached {
                    session_id: "local-session".to_string(),
                    attempt_id: 9,
                    detached_reason: crate::acp::lifecycle::DetachedReason::ReconnectExhausted,
                },
            ),
        ]
    }

    #[test]
    fn every_canonical_session_update_maps_to_a_durable_journal_update() {
        for (name, update) in canonical_journal_updates() {
            let journal_update = ProjectionJournalUpdate::from_session_update(&update)
                .unwrap_or_else(|| panic!("canonical {name} update must be journaled"));
            let payload = SessionJournalEventPayload::ProjectionUpdate {
                update: Box::new(journal_update.clone()),
            };
            serde_json::to_string(&payload)
                .unwrap_or_else(|error| panic!("canonical {name} payload must serialize: {error}"));
            assert_eq!(
                journal_update.into_session_update().session_id(),
                Some("local-session"),
                "canonical {name} journal roundtrip must retain its session"
            );
        }
    }

    #[tokio::test]
    async fn every_canonical_session_update_appends_in_one_durable_sequence() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect journal database");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("migrate journal database");
        SessionMetadataRepository::ensure_exists(&db, "local-session", "/repo", "copilot", None)
            .await
            .expect("seed journal session");
        let updates = canonical_journal_updates();

        for (index, (name, update)) in updates.iter().enumerate() {
            let record =
                SessionJournalEventRepository::append_session_update(&db, "local-session", update)
                    .await
                    .unwrap_or_else(|error| panic!("canonical {name} append failed: {error}"))
                    .unwrap_or_else(|| panic!("canonical {name} append returned no row"));
            assert_eq!(record.event_seq, index as i64 + 1);
        }

        let rows = SessionJournalEventRepository::list_serialized(&db, "local-session")
            .await
            .expect("list canonical journal rows");
        assert_eq!(rows.len(), updates.len());
    }

    #[test]
    fn lifecycle_and_capability_journal_updates_roundtrip_their_payloads() {
        let mut updates = canonical_journal_updates().into_iter();
        let connection_complete = updates
            .find(|(name, _)| *name == "connection_complete")
            .map(|(_, update)| update)
            .expect("connection complete fixture");
        let connection_failed = updates
            .find(|(name, _)| *name == "connection_failed")
            .map(|(_, update)| update)
            .expect("connection failed fixture");
        let session_detached = updates
            .find(|(name, _)| *name == "session_detached")
            .map(|(_, update)| update)
            .expect("session detached fixture");

        let roundtrip = |update: SessionUpdate| {
            let journal = ProjectionJournalUpdate::from_session_update(&update)
                .expect("canonical lifecycle update should map");
            let serialized = serde_json::to_string(&journal).expect("serialize journal update");
            serde_json::from_str::<ProjectionJournalUpdate>(&serialized)
                .expect("deserialize journal update")
                .into_session_update()
        };

        match roundtrip(connection_complete) {
            SessionUpdate::ConnectionComplete {
                attempt_id,
                modes,
                available_commands,
                config_options,
                autonomous_enabled,
                ..
            } => {
                assert_eq!(attempt_id, 7);
                assert_eq!(modes.current_mode_id, "agent");
                assert_eq!(available_commands.map(|commands| commands.len()), Some(0));
                assert_eq!(config_options.map(|options| options.len()), Some(0));
                assert_eq!(autonomous_enabled, Some(true));
            }
            other => panic!("expected connection complete, got {other:?}"),
        }
        match roundtrip(connection_failed) {
            SessionUpdate::ConnectionFailed {
                attempt_id,
                error,
                failure_reason,
                ..
            } => {
                assert_eq!(attempt_id, 8);
                assert_eq!(error, "offline");
                assert_eq!(
                    failure_reason,
                    crate::acp::lifecycle::FailureReason::ResumeFailed
                );
            }
            other => panic!("expected connection failure, got {other:?}"),
        }
        match roundtrip(session_detached) {
            SessionUpdate::SessionDetached {
                attempt_id,
                detached_reason,
                ..
            } => {
                assert_eq!(attempt_id, 9);
                assert_eq!(
                    detached_reason,
                    crate::acp::lifecycle::DetachedReason::ReconnectExhausted
                );
            }
            other => panic!("expected session detached, got {other:?}"),
        }
    }

    fn serialized_projection_row(
        event_seq: i64,
        update: SessionUpdate,
    ) -> SerializedSessionJournalEventRow {
        let payload = SessionJournalEventPayload::ProjectionUpdate {
            update: Box::new(
                ProjectionJournalUpdate::from_session_update(&update)
                    .expect("update should be journaled"),
            ),
        };
        SerializedSessionJournalEventRow {
            event_id: format!("event-{event_seq}"),
            session_id: "local-session".to_string(),
            event_seq,
            event_kind: "projection_update".to_string(),
            event_json: serde_json::to_string(&payload).expect("serialize payload"),
            created_at_ms: event_seq,
        }
    }

    fn legacy_serialized_question_projection_row(
        event_seq: i64,
        update: SessionUpdate,
    ) -> SerializedSessionJournalEventRow {
        let SessionUpdate::QuestionRequest {
            question,
            session_id,
        } = update
        else {
            panic!("expected question request");
        };
        let payload = SessionJournalEventPayload::ProjectionUpdate {
            update: Box::new(ProjectionJournalUpdate::QuestionRequest {
                question,
                session_id,
            }),
        };
        SerializedSessionJournalEventRow {
            event_id: format!("event-{event_seq}"),
            session_id: "local-session".to_string(),
            event_seq,
            event_kind: "projection_update".to_string(),
            event_json: serde_json::to_string(&payload).expect("serialize payload"),
            created_at_ms: event_seq,
        }
    }

    #[test]
    fn decode_serialized_events_uses_replay_context_to_restore_projection_updates() {
        let payload = SessionJournalEventPayload::ProjectionUpdate {
            update: Box::new(
                ProjectionJournalUpdate::from_session_update(&SessionUpdate::PermissionRequest {
                    permission: PermissionData {
                        id: "permission-1".to_string(),
                        session_id: "local-session".to_string(),
                        json_rpc_request_id: Some(7),
                        reply_handler: Some(
                            crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                        ),
                        permission: "Read".to_string(),
                        patterns: vec!["/repo/README.md".to_string()],
                        metadata: serde_json::json!({}),
                        always: vec![],
                        auto_accepted: false,
                        tool: None,
                    },
                    session_id: Some("local-session".to_string()),
                })
                .expect("permission request should be journaled"),
            ),
        };
        let rows = vec![SerializedSessionJournalEventRow {
            event_id: "event-1".to_string(),
            session_id: "local-session".to_string(),
            event_seq: 1,
            event_kind: "projection_update".to_string(),
            event_json: serde_json::to_string(&payload).expect("serialize payload"),
            created_at_ms: 123,
        }];
        let replay_context = replay_context();

        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");

        assert_eq!(decoded.len(), 1);
        match &decoded[0].payload {
            SessionJournalEventPayload::ProjectionUpdate { update } => match update.as_ref() {
                ProjectionJournalUpdate::PermissionRequest {
                    permission,
                    session_id,
                } => {
                    assert_eq!(permission.id, "permission-1");
                    assert_eq!(permission.permission, "Read");
                    assert_eq!(session_id.as_deref(), Some("local-session"));
                }
                other => panic!("expected permission request update, got {:?}", other),
            },
            other => panic!("expected projection payload, got {:?}", other),
        }
    }

    #[test]
    fn replay_preserves_historical_structured_failure_before_idle_duplicates() {
        let rows = vec![
            SerializedSessionJournalEventRow {
                event_id: "event-1".to_string(),
                session_id: "local-session".to_string(),
                event_seq: 1,
                event_kind: "projection_update".to_string(),
                event_json: r#"{"kind":"projection_update","update":{"type":"turn_error","error":{"message":"No endpoints support tool use","kind":"recoverable","code":"APIError","source":"unknown"},"session_id":"local-session","turn_id":null}}"#.to_string(),
                created_at_ms: 1,
            },
            serialized_projection_row(
                2,
                SessionUpdate::TurnComplete {
                    session_id: Some("local-session".to_string()),
                    turn_id: None,
                },
            ),
        ];

        let replay_context = replay_context();
        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");
        let projection = rebuild_session_projection(&replay_context, &decoded);
        let session = projection.session.expect("session projection");

        assert_eq!(session.turn_state, SessionTurnState::Failed);
        assert_eq!(
            session
                .active_turn_failure
                .as_ref()
                .map(|failure| failure.message.as_str()),
            Some("No endpoints support tool use")
        );
        assert_eq!(session.last_event_seq, 2);
    }

    #[test]
    fn decode_serialized_events_orders_rows_by_journal_sequence() {
        let replay_context = replay_context();
        let rows = vec![
            serialized_projection_row(3, permission_update(3)),
            serialized_projection_row(1, permission_update(1)),
            serialized_projection_row(2, permission_update(2)),
        ];

        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");

        let event_sequences = decoded
            .iter()
            .map(|event| event.event_seq)
            .collect::<Vec<_>>();
        assert_eq!(event_sequences, vec![1, 2, 3]);
    }

    #[test]
    fn long_replay_ignores_legacy_question_requests_while_rebuilding_journaled_permissions() {
        let replay_context = replay_context();
        let rows = (1..=160)
            .map(|index| {
                if index % 2 == 0 {
                    serialized_projection_row(index, permission_update(index as usize))
                } else {
                    legacy_serialized_question_projection_row(
                        index,
                        question_update(index as usize),
                    )
                }
            })
            .collect::<Vec<_>>();

        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");
        let replayed = rebuild_session_projection(&replay_context, &decoded);

        assert_eq!(decoded.len(), 160);
        assert_eq!(replayed.operations.len(), 0);
        assert_eq!(replayed.interactions.len(), 80);
        assert!(replayed
            .interactions
            .iter()
            .any(|interaction| interaction.id == "permission-160"));
        assert!(replayed
            .interactions
            .iter()
            .all(|interaction| !interaction.id.starts_with("question-")));
    }

    #[test]
    fn completed_local_transcript_rebuild_preserves_journaled_thought_chunks() {
        let replay_context = replay_context();
        let rows = vec![
            serialized_projection_row(
                1,
                SessionUpdate::AgentThoughtChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "checking the readme".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("thinking-part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: Some("local-session".to_string()),
                },
            ),
            serialized_projection_row(
                2,
                SessionUpdate::TurnComplete {
                    session_id: Some("local-session".to_string()),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
        ];
        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");

        let snapshot = rebuild_completed_local_transcript_snapshot(&replay_context, &decoded)
            .expect("rebuilt transcript");

        assert_eq!(
            snapshot.entries[0].segments[0],
            TranscriptSegment::Thought {
                segment_id: "acepe::entry::session-start::assistant::.:segment:1".to_string(),
                text: "checking the readme".to_string(),
            }
        );
    }

    #[test]
    fn completed_local_transcript_rebuild_is_ordered_by_journal_sequence() {
        let replay_context = replay_context();
        let rows = vec![
            serialized_projection_row(
                3,
                SessionUpdate::TurnComplete {
                    session_id: Some("local-session".to_string()),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
            serialized_projection_row(
                2,
                SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: " world".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("assistant-part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: Some("local-session".to_string()),
                    produced_at_monotonic_ms: None,
                },
            ),
            serialized_projection_row(
                1,
                SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "hello".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: Some("assistant-part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: Some("local-session".to_string()),
                    produced_at_monotonic_ms: None,
                },
            ),
        ];
        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");

        let snapshot = rebuild_completed_local_transcript_snapshot(&replay_context, &decoded)
            .expect("rebuilt transcript");

        let text = snapshot.entries[0]
            .segments
            .iter()
            .map(|segment| segment.primary_text())
            .collect::<String>();
        assert_eq!(text, "hello world");
    }

    #[test]
    fn local_transcript_rebuild_includes_incomplete_turn_user_message() {
        let replay_context = replay_context();
        let rows = vec![
            serialized_projection_row(
                1,
                SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "first question".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("local-session".to_string()),
                    attempt_id: Some("attempt-1".to_string()),
                },
            ),
            serialized_projection_row(
                2,
                SessionUpdate::TurnComplete {
                    session_id: Some("local-session".to_string()),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
            serialized_projection_row(
                3,
                SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "missing question".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("local-session".to_string()),
                    attempt_id: Some("attempt-2".to_string()),
                },
            ),
        ];
        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");

        let snapshot = rebuild_local_transcript_snapshot(&replay_context, &decoded)
            .expect("rebuilt transcript");

        assert_eq!(snapshot.revision, 3);
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(snapshot.entries[1].role, TranscriptEntryRole::User);
        assert_eq!(
            snapshot.entries[1].segments[0],
            TranscriptSegment::Text {
                segment_id: "acepe::entry::assistant-boundary:1::user::.:segment:3".to_string(),
                text: "missing question".to_string(),
            }
        );
    }

    #[test]
    fn replay_ignores_legacy_question_request_with_materialization_barriers() {
        let replay_context = replay_context();
        let rows = vec![
            SerializedSessionJournalEventRow {
                event_id: "event-1".to_string(),
                session_id: "local-session".to_string(),
                event_seq: 1,
                event_kind: "materialization_barrier".to_string(),
                event_json: serde_json::to_string(
                    &SessionJournalEventPayload::MaterializationBarrier,
                )
                .expect("serialize barrier"),
                created_at_ms: 1,
            },
            legacy_serialized_question_projection_row(2, question_update(1)),
            SerializedSessionJournalEventRow {
                event_id: "event-3".to_string(),
                session_id: "local-session".to_string(),
                event_seq: 3,
                event_kind: "materialization_barrier".to_string(),
                event_json: serde_json::to_string(
                    &SessionJournalEventPayload::MaterializationBarrier,
                )
                .expect("serialize barrier"),
                created_at_ms: 3,
            },
        ];

        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");
        let replayed = rebuild_session_projection(&replay_context, &decoded);

        assert!(replayed.operations.is_empty());
        assert!(replayed.interactions.is_empty());
    }

    #[test]
    fn rebuild_includes_assistant_row_after_terminal_error_and_user_re_prompt() {
        let replay_context = replay_context();
        let rows = vec![
            serialized_projection_row(
                1,
                SessionUpdate::TurnError {
                    error: TurnErrorData::Legacy("boom".to_string()),
                    session_id: Some("local-session".to_string()),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
            serialized_projection_row(
                2,
                SessionUpdate::UserMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "retry".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    session_id: Some("local-session".to_string()),
                    attempt_id: None,
                },
            ),
            serialized_projection_row(
                3,
                SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "continuing".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: Some("assistant-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: Some("local-session".to_string()),
                    produced_at_monotonic_ms: None,
                },
            ),
        ];

        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");
        let snapshot = rebuild_local_transcript_snapshot(&replay_context, &decoded)
            .expect("rebuilt transcript");

        assert!(
            !snapshot
                .entries
                .iter()
                .any(|entry| entry.segments.iter().any(|segment| {
                    matches!(segment, TranscriptSegment::Text { text, .. } if text == "boom")
                })),
            "turn error must not replay as transcript content"
        );
        assert!(
            snapshot
                .entries
                .iter()
                .any(|entry| entry.role == TranscriptEntryRole::Assistant),
            "new-turn assistant row must be present after user re-prompt"
        );
    }
}
