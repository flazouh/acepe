use super::*;
pub(super) struct StreamingBridgeContext {
    pub(super) dispatcher: AcpUiEventDispatcher,
    pub(super) bridge: Arc<PermissionBridge>,
    pub(super) projection_registry: Arc<ProjectionRegistry>,
    pub(super) tool_call_tracker: Arc<ToolCallIdTracker>,
    pub(super) approval_callback_tracker: Arc<ApprovalCallbackTracker>,
    pub(super) task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    pub(super) pending_questions: Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    pub(super) provider: Arc<dyn AgentProvider>,
    pub(super) db: Option<DbConn>,
    pub(super) app_handle: Option<AppHandle>,
    pub(super) pending_creation_attempt_id: Option<String>,
    pub(super) project_path: Option<PathBuf>,
}

fn terminal_tool_call_id(update: &SessionUpdate) -> Option<&str> {
    match update {
        SessionUpdate::ToolCallUpdate { update, .. }
            if matches!(
                update.status,
                Some(ToolCallStatus::Completed) | Some(ToolCallStatus::Failed)
            ) =>
        {
            Some(update.tool_call_id.as_str())
        }
        _ => None,
    }
}

pub(super) async fn run_streaming_bridge(
    mut stream: impl futures::Stream<Item = cc_sdk::Result<cc_sdk::Message>> + Unpin,
    session_id: String,
    context: StreamingBridgeContext,
) {
    let StreamingBridgeContext {
        dispatcher,
        bridge,
        projection_registry,
        tool_call_tracker,
        approval_callback_tracker,
        task_reconciler,
        pending_questions,
        provider,
        db,
        app_handle,
        pending_creation_attempt_id,
        project_path,
    } = context;

    tracing::info!(session_id = %session_id, "cc-sdk bridge: started, waiting for messages...");
    let mut message_count: u64 = 0;
    let mut turn_stream_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
    let mut observed_provider_session_id: Option<String> = None;
    let mut pending_creation_attempt_id = pending_creation_attempt_id;
    let mut pending_creation_promoted = pending_creation_attempt_id.is_none();
    let mut buffered_pending_creation_updates: Vec<SessionUpdate> = Vec::new();

    while let Some(result) = stream.next().await {
        match result {
            Ok(msg) => {
                if let Some(provider_session_id) = provider_session_id_from_message(&msg) {
                    if let Some(attempt_id) = pending_creation_attempt_id.take() {
                        match promote_verified_pending_creation_attempt(
                            app_handle.as_ref(),
                            db.as_ref(),
                            &projection_registry,
                            &attempt_id,
                            &session_id,
                            provider_session_id,
                        )
                        .await
                        {
                            Ok(()) => {
                                pending_creation_promoted = true;
                                observed_provider_session_id =
                                    Some(provider_session_id.to_string());
                                dispatch_cc_sdk_update(
                                    &dispatcher,
                                    &task_reconciler,
                                    provider.as_ref(),
                                    promoted_claude_connection_complete_update(
                                        app_handle.as_ref(),
                                        &session_id,
                                    ),
                                );
                                dispatcher.begin_pre_reservation_drain(&session_id);
                                dispatcher.drain_pre_reservation_events(&session_id);
                                for buffered_update in buffered_pending_creation_updates.drain(..) {
                                    dispatch_cc_sdk_update(
                                        &dispatcher,
                                        &task_reconciler,
                                        provider.as_ref(),
                                        buffered_update,
                                    );
                                }
                            }
                            Err(error) => {
                                tracing::error!(
                                    session_id = %session_id,
                                    provider_session_id = %provider_session_id,
                                    error = %error,
                                    "cc-sdk provider session identity could not promote pending creation attempt"
                                );
                                dispatcher.enqueue(AcpUiEvent::session_update(
                                    SessionUpdate::TurnError {
                                        error: TurnErrorData::Structured(TurnErrorInfo {
                                            message: format!(
                                                "Claude provider session identity could not be verified: {error}"
                                            ),
                                            kind: TurnErrorKind::Fatal,
                                            code: None,
                                            source: Some(TurnErrorSource::Transport),
                                            details: None,
                                        }),
                                        session_id: Some(session_id.clone()),
                                        turn_id: None,
                                    },
                                ));
                                break;
                            }
                        }
                    } else if provider_session_id != session_id
                        && observed_provider_session_id.as_deref() != Some(provider_session_id)
                    {
                        if let Err(error) = persist_provider_session_id_alias(
                            app_handle.as_ref(),
                            db.as_ref(),
                            &session_id,
                            provider_session_id,
                        )
                        .await
                        {
                            tracing::error!(
                                session_id = %session_id,
                                provider_session_id = %provider_session_id,
                                error = %error,
                                "cc-sdk provider session identity could not be persisted"
                            );
                            dispatcher.enqueue(AcpUiEvent::session_update(
                                SessionUpdate::TurnError {
                                    error: TurnErrorData::Structured(TurnErrorInfo {
                                        message: format!(
                                            "Claude provider session identity could not be persisted: {error}"
                                        ),
                                        kind: TurnErrorKind::Fatal,
                                        code: None,
                                        source: Some(TurnErrorSource::Transport),
                                        details: None,
                                    }),
                                    session_id: Some(session_id.clone()),
                                    turn_id: None,
                                },
                            ));
                            break;
                        }
                        observed_provider_session_id = Some(provider_session_id.to_string());
                    }
                }

                message_count += 1;
                if let Ok(raw_json) = serde_json::to_value(&msg) {
                    log_streaming_event(&session_id, &raw_json);
                }
                let msg_type = match &msg {
                    cc_sdk::Message::Assistant { .. } => "Assistant",
                    cc_sdk::Message::StreamEvent { .. } => "StreamEvent",
                    cc_sdk::Message::Result {
                        ref usage,
                        ref total_cost_usd,
                        ..
                    } => {
                        approval_callback_tracker
                            .log_pending_for_session(&session_id, "result")
                            .await;
                        tracing::debug!(
                            session_id = %session_id,
                            usage = ?usage,
                            total_cost_usd = ?total_cost_usd,
                            "cc-sdk bridge: Result message raw data"
                        );
                        "Result"
                    }
                    cc_sdk::Message::User { .. } => "User",
                    cc_sdk::Message::System {
                        subtype, ref data, ..
                    } => {
                        tracing::debug!(
                            session_id = %session_id,
                            subtype = %subtype,
                            data = %data,
                            "cc-sdk bridge: System message"
                        );
                        "System"
                    }
                    cc_sdk::Message::RateLimit { .. } => "RateLimit",
                    cc_sdk::Message::Unknown {
                        msg_type, ref raw, ..
                    } => {
                        tracing::debug!(
                            session_id = %session_id,
                            msg_type = %msg_type,
                            raw = %raw,
                            "cc-sdk bridge: Unknown message type"
                        );
                        "Unknown"
                    }
                };
                tracing::info!(
                    session_id = %session_id,
                    msg_type = msg_type,
                    message_count = message_count,
                    "cc-sdk bridge: received message"
                );

                let updates =
                    crate::acp::parsers::cc_sdk_bridge::translate_cc_sdk_message_with_mut_turn_state(
                        crate::acp::parsers::AgentType::ClaudeCode,
                        msg,
                        Some(session_id.clone()),
                        &mut turn_stream_state,
                    );
                tracing::info!(
                    session_id = %session_id,
                    update_count = updates.len(),
                    "cc-sdk bridge: translated to session updates"
                );
                for mut update in updates {
                    if let SessionUpdate::ToolCall { tool_call, .. } = &update {
                        if matches!(
                            tool_call.status,
                            ToolCallStatus::Pending | ToolCallStatus::InProgress
                        ) {
                            tool_call_tracker
                                .record_with_input(
                                    tool_call.name.clone(),
                                    tool_call.id.clone(),
                                    tool_call.diagnostic_input.as_ref(),
                                )
                                .await;
                            approval_callback_tracker
                                .note_tool_use_started(&session_id, &tool_call.name, &tool_call.id)
                                .await;
                            let approval_callback_tracker_clone = approval_callback_tracker.clone();
                            let session_id_clone = session_id.clone();
                            let tool_call_id = tool_call.id.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(Duration::from_secs(2)).await;
                                approval_callback_tracker_clone
                                    .warn_if_callback_missing(&session_id_clone, &tool_call_id)
                                    .await;
                            });
                        }
                    }
                    if let Some(tool_call_id) = terminal_tool_call_id(&update) {
                        crate::acp::parsers::cc_sdk_bridge::resolve_pending_tool_call(
                            &mut turn_stream_state,
                            tool_call_id,
                        );
                    }
                    if !annotate_pending_question_request(&bridge, &pending_questions, &mut update)
                        .await
                    {
                        continue;
                    }
                    if should_suppress_update_while_awaiting_stream_only_question(
                        &pending_questions,
                        &session_id,
                        &update,
                    )
                    .await
                    {
                        tracing::info!(
                            session_id = %session_id,
                            update_type = ?update,
                            "cc-sdk bridge: suppressing stale update while awaiting stream-only question answer"
                        );
                        continue;
                    }
                    clear_pending_approval_callback_diagnostic_for_terminal_update(
                        &approval_callback_tracker,
                        &update,
                    )
                    .await;
                    let should_defer_turn_complete =
                        matches!(update, SessionUpdate::TurnComplete { .. })
                            && has_pending_stream_only_question(&pending_questions, &session_id)
                                .await;
                    if matches!(
                        update,
                        SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }
                    ) {
                        // Reset per-turn stream state but preserve model_id across turns
                        let preserved_model = turn_stream_state.model_id.clone();
                        let preserved_terminal_assistant_error =
                            turn_stream_state.saw_terminal_assistant_error;
                        turn_stream_state =
                            crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
                        turn_stream_state.model_id = preserved_model;
                        turn_stream_state.saw_terminal_assistant_error =
                            preserved_terminal_assistant_error;
                    }
                    if should_defer_turn_complete {
                        tracing::info!(
                            session_id = %session_id,
                            "cc-sdk bridge: deferring turn completion while awaiting stream-only question answer"
                        );
                        continue;
                    }
                    rewrite_generic_turn_failed_from_permission_deny(&bridge, &mut update).await;
                    rewrite_generic_turn_failed_from_interrupt(&bridge, &mut update).await;
                    if matches!(update, SessionUpdate::TurnComplete { .. }) {
                        bridge.clear_terminal_deny_message().await;
                        bridge.clear_cancel_requested().await;
                    }
                    if !pending_creation_promoted {
                        buffered_pending_creation_updates.push(update);
                        continue;
                    }
                    let backfill_request = claude_missing_tool_result_backfill_request(
                        provider.as_ref(),
                        &session_id,
                        observed_provider_session_id.as_deref(),
                        project_path.as_ref(),
                        &update,
                    );
                    if let Some(backfill_request) = backfill_request {
                        spawn_claude_history_tool_result_backfill(
                            dispatcher.clone(),
                            task_reconciler.clone(),
                            provider.clone(),
                            backfill_request,
                            update,
                        );
                        continue;
                    }
                    dispatch_cc_sdk_update(
                        &dispatcher,
                        &task_reconciler,
                        provider.as_ref(),
                        update,
                    );
                }
            }
            Err(e) => {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    message_count = message_count,
                    "cc-sdk stream error"
                );
                let error = TurnErrorData::Structured(TurnErrorInfo {
                    message: e.to_string(),
                    kind: TurnErrorKind::Fatal,
                    code: None,
                    source: Some(TurnErrorSource::Transport),
                    details: None,
                });
                dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::TurnError {
                    error,
                    session_id: Some(session_id.clone()),
                    turn_id: None,
                }));
                break;
            }
        }
    }

    if !pending_creation_promoted {
        if let Some(attempt_id) = pending_creation_attempt_id.as_deref() {
            fail_pending_creation_attempt(
                db.as_ref(),
                attempt_id,
                "provider-identity-unverified: stream ended without provider session id",
            )
            .await;
        }
    }

    tracing::info!(
        session_id = %session_id,
        total_messages = message_count,
        "cc-sdk bridge: stream ended"
    );

    // Deny any pending permission requests so callers are not left waiting.
    let cleared_request_ids = bridge.drain_all_as_denied().await;
    for cleared_request_id in cleared_request_ids {
        apply_interaction_response_for_request(
            &projection_registry,
            db.as_ref(),
            Some(&dispatcher),
            &session_id,
            cleared_request_id,
            &serde_json::json!({
                "outcome": { "outcome": "cancelled", "optionId": "reject" },
                "acepeDenyMessage": "Permission denied or connection closed",
            }),
            "cc-sdk stream drain",
        )
        .await;
    }
}

pub(super) fn provider_session_id_from_message(msg: &cc_sdk::Message) -> Option<&str> {
    match msg {
        cc_sdk::Message::StreamEvent { session_id, .. }
        | cc_sdk::Message::Result { session_id, .. }
        | cc_sdk::Message::RateLimit { session_id, .. } => Some(session_id.as_str()),
        cc_sdk::Message::System { data, .. } => data
            .get("sessionId")
            .or_else(|| data.get("session_id"))
            .and_then(|value| value.as_str()),
        _ => None,
    }
}

async fn rewrite_generic_turn_failed_from_permission_deny(
    bridge: &PermissionBridge,
    update: &mut SessionUpdate,
) {
    let SessionUpdate::TurnError { error, .. } = update else {
        return;
    };

    let TurnErrorData::Legacy(message) = error else {
        bridge.clear_terminal_deny_message().await;
        return;
    };

    if message != "Turn failed" {
        bridge.clear_terminal_deny_message().await;
        return;
    }

    let Some(deny_message) = bridge.take_terminal_deny_message().await else {
        return;
    };

    *error = TurnErrorData::Structured(TurnErrorInfo {
        message: deny_message,
        kind: TurnErrorKind::Recoverable,
        code: None,
        source: Some(TurnErrorSource::Unknown),
        details: None,
    });
}

/// Normalize the Claude Code SDK's interrupt quirk into a canonical cancellation.
///
/// When the user presses stop, `acp_cancel` marks the interrupt on the bridge and
/// calls `interrupt()`. The SDK reacts by emitting a generic `is_error` result,
/// which `translate_result` turns into a `TurnError` carrying the legacy
/// `"Turn failed"` message. That is provider noise, not product truth: the turn
/// was cancelled, not failed. Rewrite it here at the adapter edge so canonical
/// session state never observes a spurious failure for a user interrupt.
async fn rewrite_generic_turn_failed_from_interrupt(
    bridge: &PermissionBridge,
    update: &mut SessionUpdate,
) {
    let (session_id, turn_id) = match update {
        SessionUpdate::TurnError {
            error: TurnErrorData::Legacy(message),
            session_id,
            turn_id,
        } if message == "Turn failed" => (session_id.clone(), turn_id.clone()),
        _ => return,
    };

    if !bridge.take_cancel_requested().await {
        return;
    }

    *update = SessionUpdate::TurnCancelled {
        session_id,
        turn_id,
    };
}

pub(super) async fn persist_provider_session_id_alias(
    app_handle: Option<&AppHandle>,
    db: Option<&DbConn>,
    session_id: &str,
    provider_session_id: &str,
) -> AcpResult<()> {
    if let Some(db) = db {
        let row = crate::db::repository::SessionMetadataRepository::get_by_id(db, session_id)
            .await
            .map_err(|error| {
                AcpError::InvalidState(format!(
                    "failed to load Claude session metadata for identity verification: {error}"
                ))
            })?
            .ok_or_else(|| {
                AcpError::InvalidState(format!(
                    "Claude session metadata missing before provider identity binding: {session_id}"
                ))
            })?;

        if row.is_acepe_managed && provider_session_id != session_id {
            return Err(AcpError::InvalidState(format!(
                "Claude reported provider session id {provider_session_id} instead of requested session id {session_id}"
            )));
        }
    }

    bind_provider_session_id_persisted(app_handle, db, session_id, provider_session_id).await
}

pub(super) fn collect_cc_sdk_updates_for_dispatch(
    update: &SessionUpdate,
    task_reconciler: &Arc<std::sync::Mutex<TaskReconciler>>,
    provider: &dyn AgentProvider,
) -> Vec<SessionUpdate> {
    normalize_session_updates_for_runtime(
        Some(provider),
        provider.parser_agent_type(),
        update,
        task_reconciler,
    )
}

pub(super) fn dispatch_cc_sdk_update(
    dispatcher: &AcpUiEventDispatcher,
    task_reconciler: &Arc<std::sync::Mutex<TaskReconciler>>,
    provider: &dyn AgentProvider,
    update: SessionUpdate,
) {
    let updates_to_emit = collect_cc_sdk_updates_for_dispatch(&update, task_reconciler, provider);

    for emitted_update in updates_to_emit {
        let Some(session_id) = emitted_update.session_id() else {
            tracing::warn!(
                update_type = ?std::mem::discriminant(&emitted_update),
                "Dropping cc-sdk session update without session identity"
            );
            continue;
        };
        log_emitted_event(session_id, &emitted_update);
        dispatcher.enqueue(AcpUiEvent::session_update(emitted_update));
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ClaudeToolResultBackfillRequest {
    pub(super) ui_session_id: String,
    pub(super) provider_session_id: String,
    pub(super) project_path: PathBuf,
    pub(super) tool_call_id: String,
}

pub(super) fn claude_missing_tool_result_backfill_request(
    provider: &dyn AgentProvider,
    ui_session_id: &str,
    provider_session_id: Option<&str>,
    project_path: Option<&PathBuf>,
    update: &SessionUpdate,
) -> Option<ClaudeToolResultBackfillRequest> {
    if provider.id() != "claude-code" {
        return None;
    }

    let project_path = project_path?.clone();
    let tool_call_id = missing_claude_tool_result_id(update)?;

    Some(ClaudeToolResultBackfillRequest {
        ui_session_id: ui_session_id.to_string(),
        provider_session_id: provider_session_id.unwrap_or(ui_session_id).to_string(),
        project_path,
        tool_call_id,
    })
}

fn missing_claude_tool_result_id(update: &SessionUpdate) -> Option<String> {
    let SessionUpdate::ToolCallUpdate { update, .. } = update else {
        return None;
    };

    if update.failure_reason.as_deref()
        == Some(crate::acp::parsers::cc_sdk_bridge::MISSING_TOOL_RESULT_MESSAGE)
    {
        return Some(update.tool_call_id.clone());
    }

    let stderr = update
        .result
        .as_ref()
        .and_then(|result| result.get("stderr"))
        .and_then(Value::as_str)?;

    if stderr == crate::acp::parsers::cc_sdk_bridge::MISSING_TOOL_RESULT_MESSAGE {
        Some(update.tool_call_id.clone())
    } else {
        None
    }
}

fn spawn_claude_history_tool_result_backfill(
    dispatcher: AcpUiEventDispatcher,
    task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    provider: Arc<dyn AgentProvider>,
    request: ClaudeToolResultBackfillRequest,
    fallback_update: SessionUpdate,
) {
    tauri::async_runtime::spawn(async move {
        for attempt in 0..6 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(150)).await;
            }

            let project_path = request.project_path.to_string_lossy().to_string();
            match crate::session_jsonl::parser::parse_full_session(
                &request.provider_session_id,
                &project_path,
            )
            .await
            {
                Ok(session) => {
                    if let Some(update) = claude_history_tool_result_update(
                        &request.ui_session_id,
                        &session,
                        &request.tool_call_id,
                    ) {
                        dispatch_cc_sdk_update(
                            &dispatcher,
                            &task_reconciler,
                            provider.as_ref(),
                            update,
                        );
                        return;
                    }
                }
                Err(error) => {
                    tracing::debug!(
                        ui_session_id = %request.ui_session_id,
                        provider_session_id = %request.provider_session_id,
                        tool_call_id = %request.tool_call_id,
                        attempt,
                        error = %error,
                        "Claude tool result history backfill could not parse session yet"
                    );
                }
            }
        }

        tracing::warn!(
            ui_session_id = %request.ui_session_id,
            provider_session_id = %request.provider_session_id,
            tool_call_id = %request.tool_call_id,
            "Claude tool result history backfill did not find a persisted tool result"
        );
        dispatch_cc_sdk_update(
            &dispatcher,
            &task_reconciler,
            provider.as_ref(),
            fallback_update,
        );
    });
}

pub(super) fn claude_history_tool_result_update(
    ui_session_id: &str,
    session: &crate::session_jsonl::types::FullSession,
    tool_call_id: &str,
) -> Option<SessionUpdate> {
    let normalized_tool_call_id =
        crate::acp::parsers::acp_fields::normalize_tool_call_id(tool_call_id);

    for message in &session.messages {
        if message.is_meta || message.role != "user" {
            continue;
        }

        for block in &message.content_blocks {
            let crate::session_jsonl::types::ContentBlock::ToolResult {
                tool_use_id,
                content,
            } = block
            else {
                continue;
            };
            if crate::acp::parsers::acp_fields::normalize_tool_call_id(tool_use_id)
                != normalized_tool_call_id
            {
                continue;
            }

            return Some(SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id: normalized_tool_call_id,
                    status: Some(ToolCallStatus::Completed),
                    result: Some(tool_use_result_payload(
                        content,
                        message.tool_use_result.as_ref(),
                    )),
                    content: tool_result_content_blocks(content),
                    ..Default::default()
                },
                session_id: Some(ui_session_id.to_string()),
            });
        }
    }

    None
}

fn tool_use_result_payload(content: &str, tool_use_result: Option<&Value>) -> Value {
    let Some(Value::Object(object)) = tool_use_result else {
        return Value::String(content.to_string());
    };

    let mut payload = serde_json::Map::new();
    for key in [
        "stdout",
        "stderr",
        "interrupted",
        "isImage",
        "noOutputExpected",
        "exitCode",
    ] {
        if let Some(value) = object.get(key) {
            payload.insert(key.to_string(), value.clone());
        }
    }

    if !payload.contains_key("stdout") && !content.is_empty() {
        payload.insert("stdout".to_string(), Value::String(content.to_string()));
    }

    Value::Object(payload)
}

fn tool_result_content_blocks(content: &str) -> Option<Vec<ContentBlock>> {
    if content.is_empty() {
        return None;
    }

    Some(vec![ContentBlock::Text {
        text: content.to_string(),
    }])
}

async fn fail_pending_creation_attempt(db: Option<&DbConn>, attempt_id: &str, reason: &str) {
    if let Some(db) = db {
        if let Err(error) = crate::db::repository::SessionMetadataRepository::fail_creation_attempt(
            db, attempt_id, reason,
        )
        .await
        {
            tracing::warn!(
                attempt_id = %attempt_id,
                reason,
                error = %error,
                "Failed to mark pending Claude creation attempt as failed"
            );
        }
    }
}

pub(super) async fn reserve_promoted_claude_session(
    supervisor: &crate::acp::lifecycle::SessionSupervisor,
    db: &DbConn,
    projection_registry: &ProjectionRegistry,
    session_id: &str,
    capabilities: SessionGraphCapabilities,
) -> AcpResult<()> {
    if let Some(checkpoint) = supervisor.snapshot_for_session(session_id) {
        if checkpoint.lifecycle.status != LifecycleStatus::Reserved {
            return Err(AcpError::InvalidState(format!(
                "promoted Claude session {session_id} already has lifecycle status {:?}",
                checkpoint.lifecycle.status
            )));
        }
        return Ok(());
    }

    supervisor
        .reserve_with_capabilities(db, projection_registry, session_id, capabilities)
        .await
        .map_err(|error| {
            AcpError::InvalidState(format!(
                "failed to reserve lifecycle checkpoint for promoted Claude session {session_id}: {error}"
            ))
        })
        .map(|_| ())
}

fn promoted_claude_session_capabilities(
    app_handle: Option<&AppHandle>,
    session_id: &str,
) -> SessionGraphCapabilities {
    let Some(app_handle) = app_handle else {
        return SessionGraphCapabilities::empty();
    };

    let Some(snapshot) = app_handle
        .try_state::<SessionRegistry>()
        .and_then(|registry| registry.get_ready_snapshot(session_id))
    else {
        tracing::warn!(
            session_id = %session_id,
            "Promoting Claude deferred session without cached ready snapshot capabilities"
        );
        return SessionGraphCapabilities::empty();
    };

    let autonomous_enabled = app_handle
        .try_state::<Arc<SessionPolicyRegistry>>()
        .map(|state| state.inner().is_autonomous(session_id))
        .unwrap_or(false);

    SessionGraphCapabilities {
        models: Some(snapshot.models),
        modes: Some(snapshot.modes),
        available_commands: Some(snapshot.available_commands),
        config_options: Some(
            crate::acp::session_update::sanitize_config_options_for_canonical(
                snapshot.config_options,
            ),
        ),
        autonomous_enabled: Some(autonomous_enabled),
    }
}

fn promoted_claude_connection_complete_update(
    app_handle: Option<&AppHandle>,
    session_id: &str,
) -> SessionUpdate {
    let capabilities = promoted_claude_session_capabilities(app_handle, session_id);
    SessionUpdate::ConnectionComplete {
        session_id: session_id.to_string(),
        attempt_id: 0,
        models: capabilities
            .models
            .unwrap_or_else(default_session_model_state),
        modes: capabilities.modes.unwrap_or_else(default_modes),
        available_commands: capabilities.available_commands,
        config_options: capabilities.config_options,
        autonomous_enabled: capabilities.autonomous_enabled,
    }
}

async fn promote_verified_pending_creation_attempt(
    app_handle: Option<&AppHandle>,
    db: Option<&DbConn>,
    projection_registry: &Arc<ProjectionRegistry>,
    attempt_id: &str,
    session_id: &str,
    provider_session_id: &str,
) -> AcpResult<()> {
    if provider_session_id != session_id {
        fail_pending_creation_attempt(
            db,
            attempt_id,
            "provider-identity-integrity: reported id did not match requested id",
        )
        .await;
        return Err(AcpError::InvalidState(format!(
            "Claude reported provider session id {provider_session_id} instead of requested session id {session_id}"
        )));
    }

    let db = match db {
        Some(db) => db,
        None => {
            fail_pending_creation_attempt(
                None,
                attempt_id,
                "provider-identity-promotion: database unavailable",
            )
            .await;
            return Err(AcpError::InvalidState(
                "database unavailable while promoting Claude creation attempt".to_string(),
            ));
        }
    };

    if let Err(error) = crate::db::repository::SessionMetadataRepository::promote_creation_attempt(
        db,
        attempt_id,
        provider_session_id,
    )
    .await
    {
        let message = format!("failed to promote Claude creation attempt {attempt_id}: {error}");
        fail_pending_creation_attempt(Some(db), attempt_id, &message).await;
        return Err(AcpError::InvalidState(message));
    }

    if let Some(app_handle) = app_handle {
        if let Some(supervisor) =
            app_handle.try_state::<Arc<crate::acp::lifecycle::SessionSupervisor>>()
        {
            let capabilities = promoted_claude_session_capabilities(Some(app_handle), session_id);
            reserve_promoted_claude_session(
                supervisor.inner(),
                db,
                projection_registry.as_ref(),
                session_id,
                capabilities,
            )
            .await?;
        }
    }

    Ok(())
}
