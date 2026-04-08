use super::*;
use crate::acp::client_transport::{
    interaction_transition_from_result, persist_interaction_transition,
};
use crate::acp::error::AcpError;
use crate::acp::projections::InteractionKind;
use crate::acp::projections::{InteractionResponse, InteractionState, ProjectionRegistry};
use crate::acp::session_update::{InteractionReplyHandler, InteractionReplyHandlerKind};
use crate::acp::ui_event_dispatcher::AcpUiEventDispatcher;
use crate::db::repository::SessionJournalEventRepository;
use sea_orm::DbConn;
use specta::Type;

fn log_permission_reply_event(
    session_id: &str,
    permission_id: &str,
    reply: &str,
    stage: &str,
    accepted: Option<bool>,
) {
    let mut payload = json!({
        "event": "permission.reply",
        "stage": stage,
        "permissionId": permission_id,
        "reply": reply
    });

    if let Some(object) = payload.as_object_mut() {
        if let Some(value) = accepted {
            object.insert("accepted".to_string(), Value::Bool(value));
        }
    }

    log_streaming_event(session_id, &payload);
}

async fn update_permission_projection(
    app: &AppHandle,
    session_id: &str,
    permission_id: &str,
    reply: &str,
    accepted: bool,
) {
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let db = app.state::<DbConn>();
    let state = if accepted {
        InteractionState::Approved
    } else {
        InteractionState::Rejected
    };
    let response = InteractionResponse::Permission {
        accepted,
        option_id: None,
        reply: Some(reply.to_string()),
    };
    if projection_registry
        .resolve_interaction(session_id, permission_id, state.clone(), response.clone())
        .is_none()
    {
        tracing::debug!(
            session_id = %session_id,
            permission_id = %permission_id,
            "Permission interaction projection missing during reply"
        );
        return;
    }

    if let Err(error) = SessionJournalEventRepository::append_interaction_transition(
        db.inner(),
        session_id,
        permission_id,
        state,
        response,
    )
    .await
    {
        tracing::error!(
            error = %error,
            session_id = %session_id,
            permission_id = %permission_id,
            "Failed to persist permission reply into session journal"
        );
    }
}

async fn update_question_projection(
    app: &AppHandle,
    session_id: &str,
    question_id: &str,
    parsed_answers: &[Vec<String>],
) {
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let db = app.state::<DbConn>();
    let cancelled = parsed_answers.is_empty();
    let state = if cancelled {
        InteractionState::Rejected
    } else {
        InteractionState::Answered
    };
    let response = InteractionResponse::Question {
        answers: json!(parsed_answers),
    };
    if projection_registry
        .resolve_interaction(session_id, question_id, state.clone(), response.clone())
        .is_none()
    {
        tracing::debug!(
            session_id = %session_id,
            question_id = %question_id,
            "Question interaction projection missing during reply"
        );
        return;
    }

    if let Err(error) = SessionJournalEventRepository::append_interaction_transition(
        db.inner(),
        session_id,
        question_id,
        state,
        response,
    )
    .await
    {
        tracing::error!(
            error = %error,
            session_id = %session_id,
            question_id = %question_id,
            "Failed to persist question reply into session journal"
        );
    }
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalInteractionReplyRequest {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interaction_id: Option<String>,
    pub reply_handler: InteractionReplyHandler,
    pub payload: CanonicalInteractionReplyPayload,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum CanonicalInteractionReplyPayload {
    Permission { reply: String, option_id: String },
    Question { answers: Value, answer_map: Value },
    QuestionCancel,
    PlanApproval { approved: bool },
}

fn parse_json_rpc_request_id(
    reply_handler: &InteractionReplyHandler,
) -> Result<u64, SerializableAcpError> {
    if reply_handler.kind != InteractionReplyHandlerKind::JsonRpc {
        return Err(SerializableAcpError::InvalidState {
            message: "Canonical reply requires a JSON-RPC handler".to_string(),
        });
    }

    reply_handler
        .request_id
        .parse::<u64>()
        .map_err(|_| SerializableAcpError::InvalidState {
            message: format!(
                "Invalid JSON-RPC request id '{}'",
                reply_handler.request_id
            ),
        })
}

fn interaction_kind_for_payload(payload: &CanonicalInteractionReplyPayload) -> InteractionKind {
    match payload {
        CanonicalInteractionReplyPayload::Permission { .. } => InteractionKind::Permission,
        CanonicalInteractionReplyPayload::Question { .. }
        | CanonicalInteractionReplyPayload::QuestionCancel => InteractionKind::Question,
        CanonicalInteractionReplyPayload::PlanApproval { .. } => InteractionKind::PlanApproval,
    }
}

fn adapted_result_from_payload(
    payload: &CanonicalInteractionReplyPayload,
) -> Value {
    match payload {
        CanonicalInteractionReplyPayload::Permission { reply, option_id } => {
            let allowed = reply != "reject";
            json!({
                "outcome": {
                    "outcome": if allowed { "selected" } else { "cancelled" },
                    "optionId": option_id,
                }
            })
        }
        CanonicalInteractionReplyPayload::Question { answer_map, .. } => {
            json!({
                "outcome": {
                    "outcome": "selected",
                    "optionId": "allow",
                },
                "_meta": {
                    "answers": answer_map,
                }
            })
        }
        CanonicalInteractionReplyPayload::QuestionCancel => {
            json!({
                "outcome": {
                    "outcome": "cancelled",
                }
            })
        }
        CanonicalInteractionReplyPayload::PlanApproval { approved } => {
            json!({ "approved": approved })
        }
    }
}

async fn persist_canonical_interaction_reply(
    app: &AppHandle,
    request: &CanonicalInteractionReplyRequest,
    adapted_result: &Value,
) -> Result<(), SerializableAcpError> {
    let Some(interaction_id) = request.interaction_id.as_deref() else {
        return Ok(());
    };

    let Some((state, domain_event_kind, response)) = interaction_transition_from_result(
        &interaction_kind_for_payload(&request.payload),
        adapted_result,
    ) else {
        return Err(SerializableAcpError::InvalidState {
            message: "Unable to derive canonical interaction transition from reply".to_string(),
        });
    };

    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let db = app.state::<DbConn>();
    let dispatcher = app.state::<AcpUiEventDispatcher>();

    persist_interaction_transition(
        projection_registry.inner().as_ref(),
        Some(db.inner()),
        Some(dispatcher.inner()),
        &request.session_id,
        interaction_id,
        state,
        domain_event_kind,
        response,
        "acp_reply_interaction",
    )
    .await;

    Ok(())
}

pub(super) async fn respond_inbound_request_with_registry(
    session_registry: &SessionRegistry,
    session_id: &str,
    request_id: u64,
    result: Value,
) -> Result<(), SerializableAcpError> {
    if let Ok(client_mutex) = session_registry.get(session_id) {
        let client_guard =
            lock_session_client(&client_mutex, "acp_respond_inbound_request: lock").await?;

        timeout(
            INBOUND_RESPONSE_TIMEOUT,
            client_guard.respond(request_id, result),
        )
        .await
        .map_err(|_| SerializableAcpError::Timeout {
            operation: "acp_respond_inbound_request: operation".to_string(),
        })?
        .map_err(SerializableAcpError::from)?;

        return Ok(());
    }

    let responder = session_registry
        .get_pending_inbound_responder(session_id)
        .ok_or_else(|| {
            SerializableAcpError::from(AcpError::SessionNotFound(session_id.to_string()))
        })?;

    timeout(
        INBOUND_RESPONSE_TIMEOUT,
        responder.respond(request_id, result),
    )
    .await
    .map_err(|_| SerializableAcpError::Timeout {
        operation: "acp_respond_inbound_request: bootstrap operation".to_string(),
    })?
    .map_err(SerializableAcpError::from)?;

    Ok(())
}

/// Reply to a permission request
///
/// For OpenCode HTTP mode: sends reply to POST /permission/reply endpoint
/// For ACP mode: "reject" cancels session, "once"/"always" are not supported
#[tauri::command]
#[specta::specta]
pub async fn acp_reply_permission(
    app: AppHandle,
    session_id: String,
    permission_id: String,
    reply: String,
) -> Result<(), SerializableAcpError> {
    tracing::info!(
        session_id = %session_id,
        permission_id = %permission_id,
        reply = %reply,
        "acp_reply_permission called"
    );
    log_permission_reply_event(&session_id, &permission_id, &reply, "requested", None);

    // Validate reply
    if reply != "once" && reply != "always" && reply != "reject" {
        return Err(SerializableAcpError::InvalidState {
            message: format!("Invalid permission reply: {}", reply),
        });
    }

    let session_registry = app.state::<SessionRegistry>();
    let client_mutex = session_registry
        .get(&session_id)
        .map_err(SerializableAcpError::from)?;

    let mut client_guard = lock_session_client(&client_mutex, "acp_reply_permission: lock").await?;

    // For "reject", send permission reply and cancel session
    if reply == "reject" {
        // Try to send explicit permission reply first (OpenCode HTTP mode supports this)
        let reply_sent = timeout(
            SESSION_CLIENT_OPERATION_TIMEOUT,
            client_guard.reply_permission(permission_id.clone(), reply.clone()),
        )
        .await
        .map_err(|_| SerializableAcpError::Timeout {
            operation: "acp_reply_permission: reject operation".to_string(),
        })?
        .map_err(SerializableAcpError::from)?;

        if reply_sent {
            tracing::info!(permission_id = %permission_id, "Permission rejected via explicit reply");
            update_permission_projection(&app, &session_id, &permission_id, &reply, false).await;
            log_permission_reply_event(&session_id, &permission_id, &reply, "sent", Some(true));
            return Ok(());
        }

        // Fall back to session cancel if client doesn't support explicit replies
        tracing::info!("Permission rejected, canceling session");
        log_permission_reply_event(
            &session_id,
            &permission_id,
            &reply,
            "fallback_cancel",
            Some(false),
        );
        timeout(
            SESSION_CLIENT_OPERATION_TIMEOUT,
            client_guard.cancel(session_id.clone()),
        )
        .await
        .map_err(|_| SerializableAcpError::Timeout {
            operation: "acp_reply_permission: reject cancel".to_string(),
        })?
        .map_err(SerializableAcpError::from)?;
        update_permission_projection(&app, &session_id, &permission_id, &reply, false).await;
        log_permission_reply_event(
            &session_id,
            &permission_id,
            &reply,
            "session_cancelled",
            Some(true),
        );
        Ok(())
    } else {
        // "once" and "always" - send explicit permission reply
        let result = timeout(
            SESSION_CLIENT_OPERATION_TIMEOUT,
            client_guard.reply_permission(permission_id.clone(), reply.clone()),
        )
        .await
        .map_err(|_| SerializableAcpError::Timeout {
            operation: "acp_reply_permission: operation".to_string(),
        })?
        .map_err(SerializableAcpError::from)?;

        if result {
            tracing::info!(permission_id = %permission_id, reply = %reply, "Permission reply sent");
            update_permission_projection(&app, &session_id, &permission_id, &reply, true).await;
            log_permission_reply_event(&session_id, &permission_id, &reply, "sent", Some(true));
            Ok(())
        } else {
            log_permission_reply_event(
                &session_id,
                &permission_id,
                &reply,
                "rejected_by_client",
                Some(false),
            );
            Err(SerializableAcpError::ProtocolError {
                message: format!("Permission reply '{}' was not accepted", reply),
            })
        }
    }
}

/// Frontend-format question reply entry.
///
/// The frontend sends answers as `Array<{ questionIndex: number; answers: string[] }>`.
/// This struct deserializes each entry from that format.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuestionReplyEntry {
    #[allow(dead_code)]
    question_index: usize,
    answers: Vec<String>,
}

/// Reply to a question request
///
/// For OpenCode HTTP mode: sends reply to POST /question/{id}/reply endpoint
/// For ACP mode: questions are replied via JSON-RPC (respondInboundRequest)
#[tauri::command]
#[specta::specta]
pub async fn acp_reply_question(
    app: AppHandle,
    session_id: String,
    question_id: String,
    answers: Value,
) -> Result<(), SerializableAcpError> {
    tracing::info!(
        session_id = %session_id,
        question_id = %question_id,
        answers = %answers,
        "acp_reply_question called"
    );

    // Frontend sends Array<{ questionIndex: number; answers: string[] }>.
    // Extract just the answers arrays in order for the HTTP client.
    let entries: Vec<QuestionReplyEntry> =
        serde_json::from_value(answers).map_err(|e| SerializableAcpError::SerializationError {
            message: e.to_string(),
        })?;
    let parsed_answers: Vec<Vec<String>> = entries.into_iter().map(|e| e.answers).collect();

    let session_registry = app.state::<SessionRegistry>();
    let client_mutex = session_registry
        .get(&session_id)
        .map_err(SerializableAcpError::from)?;

    let mut client_guard = lock_session_client(&client_mutex, "acp_reply_question").await?;

    let result = timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client_guard.reply_question(question_id.clone(), parsed_answers.clone()),
    )
    .await
    .map_err(|_| SerializableAcpError::Timeout {
        operation: "acp_reply_question".to_string(),
    })?
    .map_err(SerializableAcpError::from)?;

    if result {
        tracing::info!(question_id = %question_id, "Question reply sent");
        update_question_projection(&app, &session_id, &question_id, &parsed_answers).await;
        Ok(())
    } else {
        Err(SerializableAcpError::ProtocolError {
            message: "Question reply was not accepted".to_string(),
        })
    }
}

/// Reply to a canonical interaction through one backend-owned command path.
#[tauri::command]
#[specta::specta]
pub async fn acp_reply_interaction(
    app: AppHandle,
    request: CanonicalInteractionReplyRequest,
) -> Result<(), SerializableAcpError> {
    match request.reply_handler.kind {
        InteractionReplyHandlerKind::Http => match &request.payload {
            CanonicalInteractionReplyPayload::Permission { reply, .. } => {
                let interaction_id = request
                    .interaction_id
                    .clone()
                    .ok_or_else(|| SerializableAcpError::InvalidState {
                        message: "HTTP permission replies require interactionId".to_string(),
                    })?;
                acp_reply_permission(app, request.session_id, interaction_id, reply.clone()).await
            }
            CanonicalInteractionReplyPayload::Question { answers, .. } => {
                let interaction_id = request
                    .interaction_id
                    .clone()
                    .ok_or_else(|| SerializableAcpError::InvalidState {
                        message: "HTTP question replies require interactionId".to_string(),
                    })?;
                acp_reply_question(app, request.session_id, interaction_id, answers.clone()).await
            }
            CanonicalInteractionReplyPayload::QuestionCancel => {
                let interaction_id = request
                    .interaction_id
                    .clone()
                    .ok_or_else(|| SerializableAcpError::InvalidState {
                        message: "HTTP question cancellation requires interactionId".to_string(),
                    })?;
                acp_reply_question(app, request.session_id, interaction_id, json!([])).await
            }
            CanonicalInteractionReplyPayload::PlanApproval { .. } => {
                Err(SerializableAcpError::InvalidState {
                    message: "Plan approval replies do not support HTTP routing".to_string(),
                })
            }
        },
        InteractionReplyHandlerKind::JsonRpc => {
            let request_id = parse_json_rpc_request_id(&request.reply_handler)?;
            let adapted_result = adapted_result_from_payload(&request.payload);
            let session_registry = app.state::<SessionRegistry>();
            respond_inbound_request_with_registry(
                &session_registry,
                &request.session_id,
                request_id,
                adapted_result.clone(),
            )
            .await?;
            persist_canonical_interaction_reply(&app, &request, &adapted_result).await
        }
    }
}

/// Respond to an inbound JSON-RPC request from the ACP subprocess
///
/// This is used to respond to requests like `client/requestPermission` where
/// the subprocess needs a response back. The request_id is the JSON-RPC id
/// from the inbound request.
#[tauri::command]
#[specta::specta]
pub async fn acp_respond_inbound_request(
    app: AppHandle,
    session_id: String,
    request_id: u64,
    result: Value,
) -> Result<(), SerializableAcpError> {
    tracing::info!(
        session_id = %session_id,
        request_id = request_id,
        "acp_respond_inbound_request called"
    );

    let session_registry = app.state::<SessionRegistry>();
    respond_inbound_request_with_registry(&session_registry, &session_id, request_id, result)
        .await?;

    tracing::info!(
        session_id = %session_id,
        request_id = request_id,
        "Inbound request response sent successfully"
    );
    Ok(())
}
