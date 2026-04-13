use crate::acp::client::PendingRequestEntry;
use crate::acp::domain_events::SessionDomainEventKind;
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
    }
}

pub(crate) struct InteractionTransitionPersistence<'a> {
    pub projection_registry: &'a ProjectionRegistry,
    pub db: Option<&'a DbConn>,
    pub dispatcher: Option<&'a AcpUiEventDispatcher>,
    pub session_id: &'a str,
    pub interaction_id: &'a str,
    pub state: InteractionState,
    pub domain_event_kind: SessionDomainEventKind,
    pub response: InteractionResponse,
    pub source: &'a str,
}

pub(crate) async fn persist_interaction_transition(args: InteractionTransitionPersistence<'_>) {
    if args
        .projection_registry
        .resolve_interaction(
            args.session_id,
            args.interaction_id,
            args.state.clone(),
            args.response.clone(),
        )
        .is_none()
    {
        tracing::debug!(
            session_id = %args.session_id,
            interaction_id = %args.interaction_id,
            source = %args.source,
            "Interaction projection missing during transition persistence"
        );
        return;
    }

    if let Some(db) = args.db {
        if let Err(error) = SessionJournalEventRepository::append_interaction_transition(
            db,
            args.session_id,
            args.interaction_id,
            args.state,
            args.response,
        )
        .await
        {
            tracing::error!(
                error = %error,
                session_id = %args.session_id,
                interaction_id = %args.interaction_id,
                source = %args.source,
                "Failed to persist interaction transition into session journal"
            );
        }
    }

    if let Some(dispatcher) = args.dispatcher {
        dispatcher.enqueue_session_domain_event(args.session_id, args.domain_event_kind);
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

    persist_interaction_transition(InteractionTransitionPersistence {
        projection_registry,
        db,
        dispatcher,
        session_id,
        interaction_id: &interaction.id,
        state,
        domain_event_kind,
        response,
        source,
    })
    .await;
}
