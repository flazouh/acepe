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
    let Some(interaction_candidate) = projection_registry.prepare_interaction_resolution(
        session_id,
        interaction_id,
        state.clone(),
        response.clone(),
    ) else {
        tracing::debug!(
            session_id = %session_id,
            interaction_id = %interaction_id,
            source = %source,
            "Interaction projection missing during transition persistence"
        );
        return;
    };

    let Some(db) = db else {
        tracing::error!(
            session_id = %session_id,
            interaction_id = %interaction_id,
            source = %source,
            "Cannot resolve interaction without durable session event storage"
        );
        return;
    };
    let persist_result = if interaction_candidate.kind == InteractionKind::Question
        && interaction_candidate.state == InteractionState::Answered
    {
        SessionJournalEventRepository::append_interaction_snapshot(
            db,
            session_id,
            interaction_candidate,
        )
        .await
    } else {
        SessionJournalEventRepository::append_interaction_transition(
            db,
            session_id,
            interaction_id,
            state.clone(),
            response.clone(),
        )
        .await
    };
    let committed = match persist_result {
        Ok(committed) => committed,
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
    };
    let Some(interaction_patch) = projection_registry.resolve_interaction_at_event_seq(
        session_id,
        interaction_id,
        state,
        response,
        committed.event_seq,
    ) else {
        tracing::error!(
            session_id = %session_id,
            interaction_id = %interaction_id,
            event_seq = committed.event_seq,
            source = %source,
            "Committed interaction transition could not be projected"
        );
        return;
    };

    if let Some(dispatcher) = dispatcher {
        dispatcher.enqueue_interaction_transition_state(session_id, interaction_patch);
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
    let Some(interaction) = projection_registry.interaction_for_request_id(session_id, request_id)
    else {
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
        InteractionReplyHandler, PermissionData, ToolArguments, ToolCallData, ToolKind,
        ToolReference,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::acp::ui_event_dispatcher::AcpUiEventPayload;

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

    async fn setup_interaction_test_db(session_id: &str) -> DbConn {
        use sea_orm_migration::MigratorTrait;

        let db = sea_orm::Database::connect("sqlite::memory:")
            .await
            .expect("in-memory interaction database");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("interaction database migrations");
        crate::db::repository::SessionMetadataRepository::ensure_exists(
            &db,
            session_id,
            "/test/project",
            "claude-code",
            None,
        )
        .await
        .expect("interaction session metadata");
        db
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
    async fn interaction_projection_changes_only_after_journal_commit() {
        use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

        let session_id = "session-interaction-commit-boundary";
        let permission_id = "permission-commit-boundary";
        let db = setup_interaction_test_db(session_id).await;
        let projection_registry = ProjectionRegistry::new();
        projection_registry.register_session(session_id.to_string(), CanonicalAgentId::ClaudeCode);
        projection_registry.apply_session_update(
            session_id,
            &permission_request_update(session_id, permission_id, 41, "tool-commit-boundary"),
        );
        db.execute(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!(
                "CREATE TRIGGER fail_interaction_journal_insert \
                 BEFORE INSERT ON session_journal_event \
                 WHEN NEW.session_id = '{session_id}' \
                 BEGIN SELECT RAISE(ABORT, 'forced interaction journal failure'); END"
            ),
        ))
        .await
        .expect("install journal failure trigger");

        persist_interaction_transition(
            &projection_registry,
            Some(&db),
            None,
            session_id,
            permission_id,
            InteractionState::Approved,
            SessionDomainEventKind::InteractionResolved,
            InteractionResponse::Permission {
                accepted: true,
                option_id: Some("allow_once".to_string()),
                reply: Some("once".to_string()),
            },
            "test",
        )
        .await;

        let interaction = projection_registry
            .interaction(permission_id)
            .expect("permission interaction remains available");
        assert_eq!(interaction.state, InteractionState::Pending);
        assert_eq!(interaction.responded_at_event_seq, None);
        assert_eq!(
            crate::db::repository::SessionEventSequenceRepository::last_assigned_event_seq(
                &db, session_id,
            )
            .await
            .expect("read interaction sequence after rollback"),
            None
        );
    }

    #[tokio::test]
    async fn interaction_transition_emits_session_state_delta_for_resumed_operation() {
        let session_id = "session-interaction-delta";
        let tool_call_id = "tool-read-1";
        let permission_id = "permission-read-1";
        let db = setup_interaction_test_db(session_id).await;
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
    }

    #[tokio::test]
    async fn interaction_transition_emits_session_state_delta_for_cancelled_operation() {
        let session_id = "session-interaction-cancelled-delta";
        let tool_call_id = "tool-read-cancelled-1";
        let permission_id = "permission-read-cancelled-1";
        let db = setup_interaction_test_db(session_id).await;
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

        persist_interaction_transition(
            &projection_registry,
            Some(&db),
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
}
