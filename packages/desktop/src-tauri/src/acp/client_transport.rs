use crate::acp::client::PendingRequestEntry;
use crate::acp::domain_events::{SessionDomainEventKind, SessionDomainEventPayload};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::permission_tracker::PermissionTracker;
use crate::acp::projections::{
    InteractionKind, InteractionResponse, InteractionState, ProjectionRegistry,
};
use crate::acp::provider::AgentProvider;
use crate::acp::provider_extensions::InboundResponseAdapter;
use crate::acp::session_update::{SessionUpdate, ToolCallStatus, ToolCallUpdateData};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher};
use crate::db::repository::SessionJournalEventRepository;
use sea_orm::DbConn;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc as StdArc;
use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;
use tokio::sync::Mutex;

pub(crate) fn truncate_for_log(line: &str, max_bytes: usize) -> String {
    if line.len() <= max_bytes {
        return line.to_string();
    }
    let head: String = line.chars().take(max_bytes).collect();
    format!("{head}… [truncated {} bytes]", line.len() - max_bytes)
}

fn subprocess_exit_error_response(reason: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "error": {
            "code": -32001,
            "message": reason
        }
    })
}

pub(crate) async fn fail_pending_requests(
    pending: &StdArc<Mutex<HashMap<u64, PendingRequestEntry>>>,
    process_generation: u64,
    reason: &str,
) {
    let mut locked = pending.lock().await;
    let failed_ids: Vec<u64> = locked
        .iter()
        .filter_map(|(id, entry)| {
            if entry.generation == process_generation {
                Some(*id)
            } else {
                None
            }
        })
        .collect();
    if failed_ids.is_empty() {
        return;
    }

    let response = subprocess_exit_error_response(reason);
    let pending_count = failed_ids.len();
    for id in failed_ids {
        let Some(entry) = locked.remove(&id) else {
            continue;
        };
        let _ = entry.sender.send(response.clone());
        tracing::warn!(id, reason = %reason, "Failing pending request due to subprocess termination");
    }
    tracing::warn!(pending_count, reason = %reason, "Failed pending ACP requests after subprocess termination");
}

pub(crate) fn drain_permissions_as_failed(
    permission_tracker: &StdArc<std::sync::Mutex<PermissionTracker>>,
    dispatcher: &AcpUiEventDispatcher,
) {
    let drained = match permission_tracker.lock() {
        Ok(mut tracker) => tracker.drain_all(),
        Err(e) => {
            tracing::error!("Permission tracker mutex poisoned in drain: {e}");
            return;
        }
    };
    for (_request_id, ctx) in drained {
        dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: ctx.tool_call_id,
                status: Some(ToolCallStatus::Failed),
                failure_reason: Some("Agent subprocess terminated".into()),
                ..Default::default()
            },
            session_id: Some(ctx.session_id),
        }));
    }
}

pub(crate) async fn write_serialized_line(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    payload: &str,
) -> AcpResult<()> {
    let mut guard = stdin_writer.lock().await;
    let stdin = guard.as_mut().ok_or(AcpError::ClientNotStarted)?;
    stdin
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| AcpError::InvalidState(format!("Failed to write to stdin: {}", e)))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| AcpError::InvalidState(format!("Failed to write newline to stdin: {}", e)))?;
    stdin
        .flush()
        .await
        .map_err(|e| AcpError::InvalidState(format!("Failed to flush stdin: {}", e)))?;
    Ok(())
}

pub(crate) async fn send_inbound_response(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    id: u64,
    result: Value,
) -> AcpResult<()> {
    let response = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    });

    let response_str = serde_json::to_string(&response).map_err(AcpError::SerializationError)?;
    write_serialized_line(stdin_writer, &response_str).await
}

#[derive(Clone)]
pub(crate) struct InboundRequestResponder {
    pub session_id: String,
    pub provider: Option<StdArc<dyn AgentProvider>>,
    pub db: Option<DbConn>,
    pub stdin_writer: StdArc<Mutex<Option<ChildStdin>>>,
    pub permission_tracker: StdArc<std::sync::Mutex<PermissionTracker>>,
    pub projection_registry: StdArc<ProjectionRegistry>,
    pub dispatcher: AcpUiEventDispatcher,
    pub inbound_response_adapters: StdArc<std::sync::Mutex<HashMap<u64, InboundResponseAdapter>>>,
}

impl InboundRequestResponder {
    pub async fn respond(&self, id: u64, result: Value) -> AcpResult<()> {
        let adapted_result = match self.inbound_response_adapters.lock() {
            Ok(mut adapters) => adapters
                .remove(&id)
                .map(|adapter| {
                    self.provider
                        .as_ref()
                        .map(|provider| provider.adapt_inbound_response(&adapter, &result))
                        .unwrap_or_else(|| result.clone())
                })
                .unwrap_or(result.clone()),
            Err(error) => {
                tracing::error!("Inbound response adapter mutex poisoned in resolve: {error}");
                result.clone()
            }
        };

        send_inbound_response(&self.stdin_writer, id, adapted_result.clone()).await?;
        self.update_interaction_projection(id, &adapted_result)
            .await;

        let ctx = match self.permission_tracker.lock() {
            Ok(mut tracker) => tracker.resolve(id),
            Err(error) => {
                tracing::error!("Permission tracker mutex poisoned in resolve: {error}");
                None
            }
        };

        if let Some(ctx) = ctx {
            let outcome_str = adapted_result
                .pointer("/outcome/outcome")
                .and_then(|value| value.as_str());
            let is_denied = outcome_str.is_some_and(|outcome| outcome == "cancelled");

            if let Some(outcome) = outcome_str {
                if outcome != "cancelled" && outcome != "allowed" && outcome != "selected" {
                    tracing::warn!(outcome, tool_call_id = %ctx.tool_call_id, "Unrecognized permission outcome");
                }
            }

            if is_denied {
                self.dispatcher.enqueue(AcpUiEvent::session_update(
                    SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id: ctx.tool_call_id,
                            status: Some(ToolCallStatus::Failed),
                            failure_reason: Some("Permission denied by user".into()),
                            ..Default::default()
                        },
                        session_id: Some(ctx.session_id),
                    },
                ));
            }
        }

        Ok(())
    }

    async fn update_interaction_projection(&self, request_id: u64, adapted_result: &Value) {
        apply_interaction_response_for_request(
            &self.projection_registry,
            self.db.as_ref(),
            Some(&self.dispatcher),
            &self.session_id,
            request_id,
            adapted_result,
            "inbound responder",
        )
        .await;
    }
}

pub(crate) fn interaction_transition_from_result(
    interaction_kind: &InteractionKind,
    adapted_result: &Value,
) -> Option<(
    InteractionState,
    SessionDomainEventKind,
    InteractionResponse,
)> {
    match interaction_kind {
        InteractionKind::Permission => {
            let outcome = adapted_result
                .pointer("/outcome/outcome")
                .and_then(Value::as_str)?;
            let option_id = adapted_result
                .pointer("/outcome/optionId")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let accepted = matches!(outcome, "allowed" | "selected");
            let state = if accepted {
                InteractionState::Approved
            } else if outcome == "cancelled" {
                InteractionState::Rejected
            } else {
                return None;
            };
            let domain_event_kind = if accepted {
                SessionDomainEventKind::InteractionResolved
            } else {
                SessionDomainEventKind::InteractionCancelled
            };
            Some((
                state,
                domain_event_kind,
                InteractionResponse::Permission {
                    accepted,
                    option_id,
                    reply: None,
                },
            ))
        }
        InteractionKind::Question => {
            let outcome = adapted_result
                .pointer("/outcome/outcome")
                .and_then(Value::as_str)?;
            let cancelled = outcome == "cancelled";
            let state = if cancelled {
                InteractionState::Rejected
            } else if matches!(outcome, "allowed" | "selected") {
                InteractionState::Answered
            } else {
                return None;
            };
            let domain_event_kind = if cancelled {
                SessionDomainEventKind::InteractionCancelled
            } else {
                SessionDomainEventKind::InteractionResolved
            };
            let answers = adapted_result
                .pointer("/_meta/answers")
                .cloned()
                .unwrap_or(Value::Null);
            Some((
                state,
                domain_event_kind,
                InteractionResponse::Question { answers },
            ))
        }
        InteractionKind::PlanApproval => {
            let approved = adapted_result.get("approved").and_then(Value::as_bool)?;
            let state = if approved {
                InteractionState::Approved
            } else {
                InteractionState::Rejected
            };
            let domain_event_kind = if approved {
                SessionDomainEventKind::InteractionResolved
            } else {
                SessionDomainEventKind::InteractionCancelled
            };
            Some((
                state,
                domain_event_kind,
                InteractionResponse::PlanApproval { approved },
            ))
        }
        InteractionKind::ComputerPermission => {
            let accepted = adapted_result.get("accepted").and_then(Value::as_bool)?;
            let state = if accepted {
                InteractionState::Approved
            } else {
                InteractionState::Rejected
            };
            let domain_event_kind = if accepted {
                SessionDomainEventKind::InteractionResolved
            } else {
                SessionDomainEventKind::InteractionCancelled
            };
            Some((
                state,
                domain_event_kind,
                InteractionResponse::ComputerPermission { accepted },
            ))
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn persist_interaction_transition(
    projection_registry: &ProjectionRegistry,
    db: Option<&DbConn>,
    dispatcher: Option<&AcpUiEventDispatcher>,
    session_id: &str,
    interaction_id: &str,
    state: InteractionState,
    domain_event_kind: SessionDomainEventKind,
    response: InteractionResponse,
    source: &str,
) {
    let interaction_patch = if let Some(dispatcher) = dispatcher {
        let mut interaction = if let Some(interaction) =
            dispatcher.canonical_interaction(session_id, interaction_id)
        {
            interaction
        } else {
            tracing::debug!(
                session_id = %session_id,
                interaction_id = %interaction_id,
                source = %source,
                "Canonical interaction missing during transition persistence"
            );
            return;
        };
        interaction.state = state.clone();
        interaction.responded_at_event_seq = dispatcher.next_canonical_event_seq(session_id);
        interaction.response = Some(response.clone());
        interaction
    } else if let Some(interaction) = projection_registry.resolve_interaction(
        session_id,
        interaction_id,
        state.clone(),
        response.clone(),
    ) {
        interaction
    } else {
        tracing::debug!(
            session_id = %session_id,
            interaction_id = %interaction_id,
            source = %source,
            "Interaction projection missing during transition persistence"
        );
        return;
    };

    let mut event_seq = interaction_patch.responded_at_event_seq.unwrap_or_default();
    if let Some(db) = db {
        let persist_result = if interaction_patch.kind == InteractionKind::Question
            && interaction_patch.state == InteractionState::Answered
        {
            SessionJournalEventRepository::append_interaction_snapshot(
                db,
                session_id,
                interaction_patch.clone(),
            )
            .await
        } else {
            SessionJournalEventRepository::append_interaction_transition(
                db,
                session_id,
                interaction_id,
                state,
                response,
            )
            .await
        };

        match persist_result {
            Ok(record) => event_seq = record.event_seq,
            Err(error) => {
                tracing::error!(
                    error = %error,
                    session_id = %session_id,
                    interaction_id = %interaction_id,
                    source = %source,
                    "Failed to persist interaction transition into session journal"
                );
                return;
            }
        }
    }

    if let Some(dispatcher) = dispatcher {
        let mut interaction_patch = interaction_patch;
        interaction_patch.responded_at_event_seq = Some(event_seq);
        dispatcher.enqueue_interaction_transition_state(session_id, interaction_patch, event_seq);
        let payload = match domain_event_kind {
            SessionDomainEventKind::InteractionResolved => {
                Some(SessionDomainEventPayload::InteractionResolved {
                    interaction_id: interaction_id.to_string(),
                })
            }
            SessionDomainEventKind::InteractionCancelled => {
                Some(SessionDomainEventPayload::InteractionCancelled {
                    interaction_id: interaction_id.to_string(),
                })
            }
            _ => None,
        };
        if let Some(p) = payload {
            dispatcher.enqueue_session_domain_event_with_payload(
                session_id,
                domain_event_kind,
                Some(p),
            );
        } else {
            dispatcher.enqueue_session_domain_event(session_id, domain_event_kind);
        }
    }
}

pub(crate) async fn apply_interaction_response_for_request(
    projection_registry: &ProjectionRegistry,
    db: Option<&DbConn>,
    dispatcher: Option<&AcpUiEventDispatcher>,
    session_id: &str,
    request_id: u64,
    adapted_result: &Value,
    source: &str,
) {
    let interaction = if let Some(dispatcher) = dispatcher {
        dispatcher.canonical_interaction_for_request_id(session_id, request_id)
    } else {
        projection_registry.interaction_for_request_id(session_id, request_id)
    };
    let Some(interaction) = interaction else {
        return;
    };

    let Some((state, domain_event_kind, response)) =
        interaction_transition_from_result(&interaction.kind, adapted_result)
    else {
        tracing::warn!(
            session_id = %session_id,
            request_id,
            interaction_id = %interaction.id,
            interaction_kind = ?interaction.kind,
            source = %source,
            "Unable to derive interaction transition from response"
        );
        return;
    };

    persist_interaction_transition(
        projection_registry,
        db,
        dispatcher,
        session_id,
        &interaction.id,
        state,
        domain_event_kind,
        response,
        source,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::projections::OperationState;
    use crate::acp::session_state_engine::{SessionStateEnvelope, SessionStatePayload};
    use crate::acp::session_update::{
        InteractionReplyHandler, PermissionData, QuestionData, ToolArguments, ToolCallData,
        ToolKind, ToolReference,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::acp::ui_event_dispatcher::AcpUiEventPayload;
    use sea_orm::Database;

    fn pending_tool_call_update(session_id: &str, tool_call_id: &str) -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: tool_call_id.to_string(),
                name: "Read".to_string(),
                arguments: ToolArguments::Other {
                    raw: json!({ "file_path": "src/main.rs" }),
                    intent: None,
                },
                diagnostic_input: None,
                kind: Some(ToolKind::Read),
                title: Some("Read src/main.rs".to_string()),
                status: ToolCallStatus::Pending,
                result: None,
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
        }
    }

    fn permission_request_update(
        session_id: &str,
        permission_id: &str,
        request_id: u64,
        tool_call_id: &str,
    ) -> SessionUpdate {
        SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: permission_id.to_string(),
                session_id: session_id.to_string(),
                json_rpc_request_id: Some(request_id),
                reply_handler: Some(InteractionReplyHandler::json_rpc(request_id)),
                permission: "read".to_string(),
                patterns: vec!["src/main.rs".to_string()],
                metadata: json!({ "file_path": "src/main.rs" }),
                always: Vec::new(),
                auto_accepted: false,
                tool: Some(ToolReference {
                    message_id: None,
                    call_id: tool_call_id.to_string(),
                }),
            },
            session_id: Some(session_id.to_string()),
        }
    }

    fn seed_canonical_permission_graph(
        dispatcher: &AcpUiEventDispatcher,
        session_id: &str,
        tool_call_id: &str,
        permission_id: &str,
        request_id: u64,
    ) {
        let updates = [
            pending_tool_call_update(session_id, tool_call_id),
            permission_request_update(session_id, permission_id, request_id, tool_call_id),
        ];
        let events = updates
            .iter()
            .enumerate()
            .filter_map(|(index, update)| {
                crate::acp::session::ingress::live_session_update::session_update_to_provider_event(
                    CanonicalAgentId::ClaudeCode,
                    i64::try_from(index).unwrap_or_default().saturating_add(1),
                    update,
                    crate::acp::projections::RouteDecision::default(),
                )
            })
            .collect::<Vec<_>>();
        let context = crate::acp::session::engine::fold::FoldContext::new(
            session_id,
            CanonicalAgentId::ClaudeCode,
            "/workspace",
        );
        let mut graph = crate::acp::session::engine::fold::fold_full(&[], &context);
        for event in events {
            graph = crate::acp::session::engine::fold::fold_step(&graph, &event).0;
        }
        dispatcher.seed_graph_for_test(session_id.to_string(), graph);
    }

    #[test]
    fn computer_permission_transition_is_local_and_typed() {
        let approved = interaction_transition_from_result(
            &InteractionKind::ComputerPermission,
            &json!({ "accepted": true }),
        )
        .expect("approved computer permission transition");
        assert_eq!(approved.0, InteractionState::Approved);
        assert!(matches!(
            approved.1,
            SessionDomainEventKind::InteractionResolved
        ));
        assert!(matches!(
            approved.2,
            InteractionResponse::ComputerPermission { accepted: true }
        ));

        let rejected = interaction_transition_from_result(
            &InteractionKind::ComputerPermission,
            &json!({ "accepted": false }),
        )
        .expect("rejected computer permission transition");
        assert_eq!(rejected.0, InteractionState::Rejected);
        assert!(matches!(
            rejected.1,
            SessionDomainEventKind::InteractionCancelled
        ));
        assert!(matches!(
            rejected.2,
            InteractionResponse::ComputerPermission { accepted: false }
        ));
    }

    #[tokio::test]
    async fn dispatcher_does_not_fall_back_to_projection_only_computer_permission() {
        use crate::computer_use::permissions::{
            build_computer_permission_interaction_id, ComputerPermissionKind,
        };

        let session_id = "session-projection-only-computer-permission";
        let tool_call_id = "tool-computer-projection-only";
        let projection_registry = StdArc::new(ProjectionRegistry::new());
        projection_registry.register_session(session_id.to_string(), CanonicalAgentId::ClaudeCode);
        projection_registry.apply_session_update(
            session_id,
            &pending_tool_call_update(session_id, tool_call_id),
        );
        projection_registry.apply_session_update(
            session_id,
            &SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id: tool_call_id.to_string(),
                    result: Some(json!({
                        "error": {
                            "code": "computer_permission_required",
                            "message": "Accessibility permission is required",
                            "permission_kind": "accessibility"
                        }
                    })),
                    ..Default::default()
                },
                session_id: Some(session_id.to_string()),
            },
        );
        let interaction_id = build_computer_permission_interaction_id(
            session_id,
            tool_call_id,
            ComputerPermissionKind::Accessibility,
        );
        let (dispatcher, captured_events) =
            AcpUiEventDispatcher::test_sink_with_projection_registry(StdArc::clone(
                &projection_registry,
            ));

        persist_interaction_transition(
            &projection_registry,
            None,
            Some(&dispatcher),
            session_id,
            &interaction_id,
            InteractionState::Approved,
            SessionDomainEventKind::InteractionResolved,
            InteractionResponse::ComputerPermission { accepted: true },
            "test",
        )
        .await;

        assert!(
            captured_events
                .lock()
                .expect("captured events lock")
                .is_empty(),
            "projection-only interaction must not produce canonical delivery"
        );
    }

    #[tokio::test]
    async fn interaction_transition_emits_session_state_delta_for_resumed_operation() {
        let session_id = "session-interaction-delta";
        let tool_call_id = "tool-read-1";
        let permission_id = "permission-read-1";
        let projection_registry = StdArc::new(ProjectionRegistry::new());
        projection_registry.register_session(session_id.to_string(), CanonicalAgentId::ClaudeCode);
        projection_registry.apply_session_update(
            session_id,
            &pending_tool_call_update(session_id, tool_call_id),
        );
        projection_registry.apply_session_update(
            session_id,
            &permission_request_update(session_id, permission_id, 11, tool_call_id),
        );
        let blocked_operation = projection_registry
            .operation_for_tool_call(session_id, tool_call_id)
            .expect("operation should exist before transition");
        assert_eq!(blocked_operation.operation_state, OperationState::Blocked);
        let (dispatcher, captured_events) =
            AcpUiEventDispatcher::test_sink_with_projection_registry(StdArc::clone(
                &projection_registry,
            ));
        seed_canonical_permission_graph(&dispatcher, session_id, tool_call_id, permission_id, 11);

        persist_interaction_transition(
            &projection_registry,
            None,
            Some(&dispatcher),
            session_id,
            permission_id,
            InteractionState::Approved,
            SessionDomainEventKind::InteractionResolved,
            InteractionResponse::Permission {
                accepted: true,
                option_id: None,
                reply: None,
            },
            "test",
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].event_name, "acp-session-state");
        assert_eq!(captured[1].event_name, "acp-session-domain-event");
        let AcpUiEventPayload::Json(payload) = &captured[0].payload else {
            panic!("expected serialized session-state envelope");
        };
        let envelope: SessionStateEnvelope =
            serde_json::from_value(payload.clone()).expect("session state envelope");
        let SessionStatePayload::Delta { delta } = envelope.payload else {
            panic!("expected delta payload");
        };
        assert_eq!(delta.operation_patches.len(), 1);
        assert_eq!(
            delta.operation_patches[0].operation_state,
            OperationState::Running
        );
        assert_eq!(delta.interaction_patches.len(), 1);
        assert_eq!(
            delta.interaction_patches[0].state,
            InteractionState::Approved
        );
        let held_graph = dispatcher
            .graph_for_test(session_id)
            .expect("interaction reply must update the held graph");
        assert_eq!(held_graph.revision.graph_revision, 3);
        assert_eq!(held_graph.interactions[0].state, InteractionState::Approved);
    }

    #[tokio::test]
    async fn interaction_transition_emits_session_state_delta_for_cancelled_operation() {
        let session_id = "session-interaction-cancelled-delta";
        let tool_call_id = "tool-read-cancelled-1";
        let permission_id = "permission-read-cancelled-1";
        let projection_registry = StdArc::new(ProjectionRegistry::new());
        projection_registry.register_session(session_id.to_string(), CanonicalAgentId::ClaudeCode);
        projection_registry.apply_session_update(
            session_id,
            &pending_tool_call_update(session_id, tool_call_id),
        );
        projection_registry.apply_session_update(
            session_id,
            &permission_request_update(session_id, permission_id, 12, tool_call_id),
        );
        let (dispatcher, captured_events) =
            AcpUiEventDispatcher::test_sink_with_projection_registry(StdArc::clone(
                &projection_registry,
            ));
        seed_canonical_permission_graph(&dispatcher, session_id, tool_call_id, permission_id, 12);

        persist_interaction_transition(
            &projection_registry,
            None,
            Some(&dispatcher),
            session_id,
            permission_id,
            InteractionState::Rejected,
            SessionDomainEventKind::InteractionCancelled,
            InteractionResponse::Permission {
                accepted: false,
                option_id: None,
                reply: None,
            },
            "test",
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].event_name, "acp-session-state");
        assert_eq!(captured[1].event_name, "acp-session-domain-event");
        let AcpUiEventPayload::Json(payload) = &captured[0].payload else {
            panic!("expected serialized session-state envelope");
        };
        let envelope: SessionStateEnvelope =
            serde_json::from_value(payload.clone()).expect("session state envelope");
        let SessionStatePayload::Delta { delta } = envelope.payload else {
            panic!("expected delta payload");
        };
        assert_eq!(delta.operation_patches.len(), 1);
        assert_eq!(
            delta.operation_patches[0].operation_state,
            OperationState::Cancelled
        );
        assert_eq!(delta.interaction_patches.len(), 1);
        assert_eq!(
            delta.interaction_patches[0].state,
            InteractionState::Rejected
        );
    }

    #[tokio::test]
    async fn failed_journal_append_does_not_apply_a_live_interaction_reply() {
        let session_id = "session-interaction-persist-failure";
        let tool_call_id = "tool-read-persist-failure";
        let permission_id = "permission-read-persist-failure";
        let projection_registry = StdArc::new(ProjectionRegistry::new());
        projection_registry.register_session(session_id.to_string(), CanonicalAgentId::ClaudeCode);
        let (dispatcher, captured_events) =
            AcpUiEventDispatcher::test_sink_with_projection_registry(StdArc::clone(
                &projection_registry,
            ));
        seed_canonical_permission_graph(&dispatcher, session_id, tool_call_id, permission_id, 13);
        let before_graph = dispatcher
            .graph_for_test(session_id)
            .expect("seeded graph should be held before the reply");
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect database without journal migration");

        persist_interaction_transition(
            &projection_registry,
            Some(&db),
            Some(&dispatcher),
            session_id,
            permission_id,
            InteractionState::Approved,
            SessionDomainEventKind::InteractionResolved,
            InteractionResponse::Permission {
                accepted: true,
                option_id: None,
                reply: None,
            },
            "test",
        )
        .await;

        let graph = dispatcher
            .graph_for_test(session_id)
            .expect("seeded graph should remain held");
        assert_eq!(graph.revision.graph_revision, 2);
        assert_eq!(graph.revision.last_event_seq, 2);
        assert_eq!(
            graph.interactions[0].state,
            before_graph.interactions[0].state
        );
        assert_eq!(
            graph.operations[0].operation_state,
            before_graph.operations[0].operation_state
        );
        assert!(captured_events
            .lock()
            .expect("captured events lock")
            .is_empty());
    }

    #[tokio::test]
    async fn question_reply_updates_the_held_graph_and_emits_canonical_delivery() {
        let session_id = "session-question-reply";
        let request_id = 22;
        let question = QuestionData {
            id: "question-22".to_string(),
            session_id: session_id.to_string(),
            json_rpc_request_id: Some(request_id),
            reply_handler: Some(InteractionReplyHandler::json_rpc(request_id)),
            questions: Vec::new(),
            tool: None,
        };
        let update = SessionUpdate::QuestionRequest {
            question: question.clone(),
            session_id: Some(session_id.to_string()),
        };
        let projection_registry = StdArc::new(ProjectionRegistry::new());
        projection_registry.register_session(session_id.to_string(), CanonicalAgentId::ClaudeCode);
        projection_registry.apply_session_update(session_id, &update);
        let (dispatcher, captured_events) =
            AcpUiEventDispatcher::test_sink_with_projection_registry(StdArc::clone(
                &projection_registry,
            ));
        let event =
            crate::acp::session::ingress::live_session_update::session_update_to_provider_event(
                CanonicalAgentId::ClaudeCode,
                1,
                &update,
                crate::acp::projections::RouteDecision::default(),
            )
            .expect("question update should normalize");
        let context = crate::acp::session::engine::fold::FoldContext::new(
            session_id,
            CanonicalAgentId::ClaudeCode,
            "/workspace",
        );
        let empty = crate::acp::session::engine::fold::fold_full(&[], &context);
        let graph = crate::acp::session::engine::fold::fold_step(&empty, &event).0;
        dispatcher.seed_graph_for_test(session_id.to_string(), graph);

        apply_interaction_response_for_request(
            &projection_registry,
            None,
            Some(&dispatcher),
            session_id,
            request_id,
            &json!({
                "outcome": { "outcome": "selected" },
                "_meta": { "answers": { "language": "Rust" } }
            }),
            "test",
        )
        .await;

        let graph = dispatcher
            .graph_for_test(session_id)
            .expect("question reply must update the held graph");
        assert_eq!(graph.revision.graph_revision, 2);
        assert_eq!(graph.revision.last_event_seq, 2);
        assert_eq!(graph.interactions[0].state, InteractionState::Answered);
        assert!(matches!(
            &graph.interactions[0].response,
            Some(InteractionResponse::Question { answers })
                if answers == &json!({ "language": "Rust" })
        ));

        let captured = captured_events.lock().expect("captured events lock");
        assert_eq!(captured.len(), 2);
        let AcpUiEventPayload::Json(payload) = &captured[0].payload else {
            panic!("expected serialized session-state envelope");
        };
        let envelope: SessionStateEnvelope =
            serde_json::from_value(payload.clone()).expect("session state envelope");
        let SessionStatePayload::Delta { delta } = envelope.payload else {
            panic!("expected delta payload");
        };
        assert_eq!(delta.interaction_patches.len(), 1);
        assert_eq!(
            delta.interaction_patches[0].state,
            InteractionState::Answered
        );
    }
}
