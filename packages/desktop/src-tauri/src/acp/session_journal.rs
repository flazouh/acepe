use crate::acp::agent_context::with_agent;
use crate::acp::parsers::provider_capabilities::provider_capabilities;
use crate::acp::projections::{
    InteractionResponse, InteractionState, ProjectionRegistry, SessionProjectionSnapshot,
};
use crate::acp::provider::HistoryReplayFamily;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::{
    ContentChunk, PermissionData, QuestionData, SessionUpdate, ToolCallData, ToolCallUpdateData,
    TurnErrorData,
};
use crate::db::repository::{
    SerializedSessionJournalEventRow, SessionJournalEventRepository,
    SessionThreadSnapshotRepository,
};
use chrono::Utc;
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ProjectionJournalUpdate {
    UserMessageChunk {
        chunk: ContentChunk,
        session_id: Option<String>,
    },
    AgentMessageChunk {
        chunk: ContentChunk,
        part_id: Option<String>,
        message_id: Option<String>,
        session_id: Option<String>,
    },
    AgentThoughtChunk {
        chunk: ContentChunk,
        part_id: Option<String>,
        message_id: Option<String>,
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
}

impl ProjectionJournalUpdate {
    #[must_use]
    pub fn from_session_update(update: &SessionUpdate) -> Option<Self> {
        match update {
            SessionUpdate::UserMessageChunk { chunk, session_id } => Some(Self::UserMessageChunk {
                chunk: chunk.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            } => Some(Self::AgentMessageChunk {
                chunk: chunk.clone(),
                part_id: part_id.clone(),
                message_id: message_id.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            } => Some(Self::AgentThoughtChunk {
                chunk: chunk.clone(),
                part_id: part_id.clone(),
                message_id: message_id.clone(),
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
            _ => None,
        }
    }

    #[must_use]
    pub fn into_session_update(self) -> SessionUpdate {
        match self {
            Self::UserMessageChunk { chunk, session_id } => {
                SessionUpdate::UserMessageChunk { chunk, session_id }
            }
            Self::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            } => SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            },
            Self::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            } => SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
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
            SessionJournalEventPayload::MaterializationBarrier => "materialization_barrier",
        }
    }

    pub fn replay_into(&self, registry: &ProjectionRegistry) {
        match &self.payload {
            SessionJournalEventPayload::ProjectionUpdate { update } => {
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

    for event in events {
        if event.session_id == replay_context.local_session_id {
            event.replay_into(&registry);
        }
    }

    registry.session_projection(&replay_context.local_session_id)
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
    rows.into_iter()
        .map(|row| decode_serialized_event(replay_context, row))
        .collect()
}

pub async fn load_projection_from_journal(
    db: &DbConn,
    replay_context: &SessionReplayContext,
) -> Result<Option<SessionProjectionSnapshot>, anyhow::Error> {
    let rows = SessionJournalEventRepository::list_serialized(db, &replay_context.local_session_id)
        .await?;
    let events = decode_serialized_events(replay_context, rows)?;

    // A `MaterializationBarrier` event alone marks the open-time cutoff but
    // carries no projection state. Return `None` so the caller can rebuild from
    // the canonical thread snapshot instead of consulting a second persisted
    // projection authority.
    let has_projection_data = events.iter().any(|e| {
        matches!(
            e.payload,
            SessionJournalEventPayload::ProjectionUpdate { .. }
                | SessionJournalEventPayload::InteractionTransition { .. }
        )
    });
    if !has_projection_data {
        return Ok(None);
    }

    Ok(Some(rebuild_session_projection(replay_context, &events)))
}

pub async fn load_stored_projection(
    db: &DbConn,
    replay_context: &SessionReplayContext,
) -> Result<Option<SessionProjectionSnapshot>, anyhow::Error> {
    if let Some(journal_projection) = load_projection_from_journal(db, replay_context).await? {
        return Ok(Some(journal_projection));
    }

    let thread_snapshot = SessionThreadSnapshotRepository::get(
        db,
        &replay_context.local_session_id,
        &replay_context.agent_id,
    )
    .await?;

    Ok(thread_snapshot.map(|snapshot| {
        ProjectionRegistry::project_thread_snapshot(
            &replay_context.local_session_id,
            Some(replay_context.agent_id.clone()),
            &snapshot,
        )
    }))
}

#[cfg(test)]
mod tests {
    use super::{decode_serialized_events, ProjectionJournalUpdate, SessionJournalEventPayload};
    use crate::acp::parsers::AgentType;
    use crate::acp::session_descriptor::SessionReplayContext;
    use crate::acp::session_update::{
        SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::db::repository::SerializedSessionJournalEventRow;

    #[test]
    fn decode_serialized_events_uses_replay_context_to_restore_projection_updates() {
        let payload = SessionJournalEventPayload::ProjectionUpdate {
            update: Box::new(
                ProjectionJournalUpdate::from_session_update(&SessionUpdate::ToolCall {
                    tool_call: ToolCallData {
                        id: "tool-call-1".to_string(),
                        name: "Read".to_string(),
                        arguments: ToolArguments::Read {
                            file_path: Some("/repo/README.md".to_string()),
                            source_context: None,
                        },
                        raw_input: None,
                        status: ToolCallStatus::Completed,
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
                    session_id: Some("local-session".to_string()),
                })
                .expect("tool call should be journaled"),
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
        let replay_context = SessionReplayContext {
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
        };

        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");

        assert_eq!(decoded.len(), 1);
        match &decoded[0].payload {
            SessionJournalEventPayload::ProjectionUpdate { update } => match update.as_ref() {
                ProjectionJournalUpdate::ToolCall {
                    tool_call,
                    session_id,
                } => {
                    assert_eq!(tool_call.id, "tool-call-1");
                    assert_eq!(tool_call.kind, Some(ToolKind::Read));
                    assert_eq!(session_id.as_deref(), Some("local-session"));
                }
                other => panic!("expected tool call update, got {:?}", other),
            },
            other => panic!("expected projection payload, got {:?}", other),
        }
    }
}
