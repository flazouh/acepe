use crate::acp::agent_context::with_agent;
use crate::acp::parsers::provider_capabilities::provider_capabilities;
use crate::acp::projections::projection_apply_router::route_projection_apply;
use crate::acp::projections::{
    InteractionResponse, InteractionSnapshot, InteractionState, ProjectionApplyRoute,
    ProjectionRegistry, SessionProjectionSnapshot, TerminalTurnGuard,
};
use crate::acp::provider::HistoryReplayFamily;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::{
    ContentChunk, PermissionData, QuestionData, SessionUpdate, TurnErrorData,
};
use crate::acp::transcript_projection::{
    TranscriptDeltaOperation, TranscriptProjectionRegistry, TranscriptSegment, TranscriptSnapshot,
};
use crate::db::repository::SerializedSessionJournalEventRow;
use chrono::Utc;
use serde::{Deserialize, Serialize};
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
        session_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        produced_at_monotonic_ms: Option<u64>,
    },
    AgentThoughtChunk {
        chunk: ContentChunk,
        part_id: Option<String>,
        message_id: Option<String>,
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
                session_id,
                produced_at_monotonic_ms,
            } => Some(Self::AgentMessageChunk {
                chunk: chunk.clone(),
                part_id: part_id.clone(),
                message_id: message_id.clone(),
                session_id: session_id.clone(),
                produced_at_monotonic_ms: *produced_at_monotonic_ms,
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
            SessionUpdate::PermissionRequest {
                permission,
                session_id,
            } => Some(Self::PermissionRequest {
                permission: permission.clone(),
                session_id: session_id.clone(),
            }),
            SessionUpdate::QuestionRequest { .. } => None,
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
                session_id,
                produced_at_monotonic_ms,
            } => SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                session_id,
                produced_at_monotonic_ms,
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

fn rebuild_local_transcript_snapshot_until(
    replay_context: &SessionReplayContext,
    events: &[SessionJournalEvent],
    max_event_seq: Option<i64>,
) -> Option<TranscriptSnapshot> {
    let registry = TranscriptProjectionRegistry::new();
    let mut terminal_guard = TerminalTurnGuard::default();
    let mut applied_transcript_text = false;
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
        if let Some(delta) =
            registry.apply_session_update(event.event_seq, &session_update, decision)
        {
            if delta.operations.iter().any(operation_contains_text_segment) {
                applied_transcript_text = true;
            }
        }
        if matches!(
            route_projection_apply(&session_update, &terminal_guard),
            ProjectionApplyRoute::Apply(_)
        ) {
            terminal_guard.advance(&session_update);
        }
    }

    if !applied_transcript_text {
        return None;
    }

    registry.snapshot_for_session(&replay_context.local_session_id)
}

fn operation_contains_text_segment(operation: &TranscriptDeltaOperation) -> bool {
    match operation {
        TranscriptDeltaOperation::AppendEntry { entry } => {
            entry.segments.iter().any(segment_contains_text)
        }
        TranscriptDeltaOperation::AppendSegment { segment, .. } => segment_contains_text(segment),
        TranscriptDeltaOperation::ReplaceSnapshot { snapshot } => snapshot
            .entries
            .iter()
            .any(|entry| entry.segments.iter().any(segment_contains_text)),
    }
}

fn segment_contains_text(segment: &TranscriptSegment) -> bool {
    segment.is_nonempty()
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
    use crate::acp::session_descriptor::SessionReplayContext;
    use crate::acp::session_update::{
        ContentChunk, PermissionData, QuestionData, QuestionItem, QuestionOption, SessionUpdate,
        TurnErrorData,
    };
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
    use crate::acp::types::CanonicalAgentId;
    use crate::acp::types::ContentBlock;
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
