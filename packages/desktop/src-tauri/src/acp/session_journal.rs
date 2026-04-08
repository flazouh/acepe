use crate::acp::projections::{
    InteractionResponse, InteractionState, ProjectionRegistry, SessionProjectionSnapshot,
};
use crate::acp::session_update::{
    ContentChunk, PermissionData, QuestionData, SessionUpdate, ToolCallData, ToolCallUpdateData,
    TurnErrorData,
};
use crate::acp::types::CanonicalAgentId;
use chrono::Utc;
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
    },
    TurnError {
        error: TurnErrorData,
        session_id: Option<String>,
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
            SessionUpdate::TurnComplete { session_id } => Some(Self::TurnComplete {
                session_id: session_id.clone(),
            }),
            SessionUpdate::TurnError { error, session_id } => Some(Self::TurnError {
                error: error.clone(),
                session_id: session_id.clone(),
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
            Self::TurnComplete { session_id } => SessionUpdate::TurnComplete { session_id },
            Self::TurnError { error, session_id } => SessionUpdate::TurnError { error, session_id },
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
        }
    }
}

#[must_use]
pub fn rebuild_session_projection(
    session_id: &str,
    agent_id: Option<CanonicalAgentId>,
    events: &[SessionJournalEvent],
) -> SessionProjectionSnapshot {
    let registry = ProjectionRegistry::new();
    if let Some(agent_id) = agent_id {
        registry.register_session(session_id.to_string(), agent_id);
    }

    for event in events {
        if event.session_id == session_id {
            event.replay_into(&registry);
        }
    }

    registry.session_projection(session_id)
}
