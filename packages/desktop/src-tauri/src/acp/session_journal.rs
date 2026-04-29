use crate::acp::agent_context::with_agent;
use crate::acp::parsers::provider_capabilities::provider_capabilities;
use crate::acp::projections::{
    InteractionResponse, InteractionState, ProjectionRegistry, SessionProjectionSnapshot,
};
use crate::acp::provider::HistoryReplayFamily;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::{PermissionData, QuestionData, SessionUpdate, TurnErrorData};
use crate::db::repository::SerializedSessionJournalEventRow;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ProjectionJournalUpdate {
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

#[cfg(test)]
mod tests {
    use super::{
        decode_serialized_events, rebuild_session_projection, ProjectionJournalUpdate,
        SessionJournalEventPayload,
    };
    use crate::acp::parsers::AgentType;
    use crate::acp::session_descriptor::SessionReplayContext;
    use crate::acp::session_update::{
        PermissionData, QuestionData, QuestionItem, QuestionOption, SessionUpdate,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::db::repository::SerializedSessionJournalEventRow;

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
    fn long_replay_decodes_and_rebuilds_journaled_interactions_without_tool_payloads() {
        let replay_context = replay_context();
        let rows = (1..=160)
            .map(|index| {
                let update = if index % 2 == 0 {
                    permission_update(index as usize)
                } else {
                    question_update(index as usize)
                };
                serialized_projection_row(index, update)
            })
            .collect::<Vec<_>>();

        let decoded = decode_serialized_events(&replay_context, rows).expect("decode rows");
        let replayed = rebuild_session_projection(&replay_context, &decoded);

        assert_eq!(decoded.len(), 160);
        assert_eq!(replayed.operations.len(), 0);
        assert_eq!(replayed.interactions.len(), 160);
        assert!(replayed
            .interactions
            .iter()
            .any(|interaction| interaction.id == "permission-160"));
        assert!(replayed
            .interactions
            .iter()
            .any(|interaction| interaction.id == "question-159"));
    }
}
