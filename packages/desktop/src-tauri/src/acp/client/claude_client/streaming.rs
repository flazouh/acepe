use std::collections::HashMap;
use std::sync::Arc;

use futures::StreamExt;
use sea_orm::DbConn;
use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::time::Duration;

use crate::acp::client::claude_client::permissions::PermissionBridge;
use crate::acp::client::claude_client::questions::{
    annotate_pending_question_request, has_pending_stream_only_question,
    should_suppress_update_while_awaiting_stream_only_question, PendingQuestionState,
};
use crate::acp::client_updates::process_through_reconciler;
use crate::acp::parsers::AgentType;
use crate::acp::projections::ProjectionRegistry;
use crate::acp::provider::AgentProvider;
use crate::acp::session_registry::bind_provider_session_id_persisted;
use crate::acp::session_update::{
    SessionUpdate, ToolCallStatus, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
};
use crate::acp::streaming_log::{log_debug_event, log_emitted_event, log_streaming_event};
use crate::acp::task_reconciler::TaskReconciler;
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher};
use crate::cc_sdk;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ToolCallTrackerEntry {
    tool_use_id: String,
    input_signature: Option<String>,
}

fn stable_json_signature(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(boolean) => boolean.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(string) => serde_json::to_string(string).unwrap_or_default(),
        Value::Array(items) => {
            let parts = items
                .iter()
                .map(stable_json_signature)
                .collect::<Vec<_>>()
                .join(",");
            format!("[{parts}]")
        }
        Value::Object(object) => {
            let parts = object
                .iter()
                .map(|(key, item)| (key.as_str(), stable_json_signature(item)))
                .collect::<std::collections::BTreeMap<_, _>>()
                .into_iter()
                .map(|(key, item)| {
                    let encoded_key = serde_json::to_string(key).unwrap_or_default();
                    format!("{encoded_key}:{item}")
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{parts}}}")
        }
    }
}

pub(crate) struct ToolCallIdTracker {
    map: Mutex<HashMap<String, std::collections::VecDeque<ToolCallTrackerEntry>>>,
}

impl ToolCallIdTracker {
    pub(crate) fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub(crate) async fn record(&self, tool_name: String, tool_use_id: String) {
        self.record_with_input(tool_name, tool_use_id, None).await;
    }

    pub(crate) async fn record_with_input(
        &self,
        tool_name: String,
        tool_use_id: String,
        input: Option<&Value>,
    ) {
        let input_signature = input.map(stable_json_signature);
        let mut map = self.map.lock().await;
        let queue = map.entry(tool_name).or_default();
        if let Some(existing) = queue
            .iter_mut()
            .find(|entry| entry.tool_use_id == tool_use_id)
        {
            if input_signature.is_some() {
                existing.input_signature = input_signature;
            }
            return;
        }

        queue.push_back(ToolCallTrackerEntry {
            tool_use_id,
            input_signature,
        });
    }

    pub(crate) async fn take_for_input(&self, tool_name: &str, input: &Value) -> Option<String> {
        let target_signature = stable_json_signature(input);
        let mut map = self.map.lock().await;
        let queue = map.get_mut(tool_name)?;
        let match_index = queue
            .iter()
            .position(|entry| entry.input_signature.as_deref() == Some(target_signature.as_str()))
            .or_else(|| {
                queue
                    .iter()
                    .enumerate()
                    .rev()
                    .find_map(|(index, entry)| entry.input_signature.is_none().then_some(index))
            })
            .or_else(|| (queue.len() == 1).then_some(0))?;

        let id = queue.remove(match_index)?.tool_use_id;
        if queue.is_empty() {
            map.remove(tool_name);
        }
        Some(id)
    }

    #[cfg(test)]
    pub(crate) async fn take(&self, tool_name: &str) -> Option<String> {
        let mut map = self.map.lock().await;
        let queue = map.get_mut(tool_name)?;
        let id = queue.pop_front().map(|entry| entry.tool_use_id);
        if queue.is_empty() {
            map.remove(tool_name);
        }
        id
    }
}

#[derive(Debug, Clone)]
struct PendingApprovalCallbackDiagnostic {
    session_id: String,
    tool_name: String,
}

pub(crate) struct ApprovalCallbackTracker {
    pending: Mutex<HashMap<String, PendingApprovalCallbackDiagnostic>>,
}

impl ApprovalCallbackTracker {
    pub(crate) fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) async fn note_tool_use_started(
        &self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: &str,
    ) {
        if !tool_name_expects_permission_callback(tool_name) {
            return;
        }

        let mut pending = self.pending.lock().await;
        if pending.contains_key(tool_call_id) {
            return;
        }
        pending.insert(
            tool_call_id.to_string(),
            PendingApprovalCallbackDiagnostic {
                session_id: session_id.to_string(),
                tool_name: tool_name.to_string(),
            },
        );
        drop(pending);

        tracing::info!(
            session_id = %session_id,
            tool_name = %tool_name,
            tool_call_id = %tool_call_id,
            "cc-sdk approval diagnostics: tool use started; awaiting permission callback"
        );
        log_debug_event(
            session_id,
            "permission.callback.expected",
            &serde_json::json!({
                "toolName": tool_name,
                "toolCallId": tool_call_id,
            }),
        );
    }

    pub(crate) async fn note_callback_received(
        &self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: &str,
        source: &str,
    ) {
        let removed = self.pending.lock().await.remove(tool_call_id);
        let had_pending_diagnostic = removed.is_some();
        tracing::info!(
            session_id = %session_id,
            tool_name = %tool_name,
            tool_call_id = %tool_call_id,
            source = %source,
            had_pending_diagnostic = had_pending_diagnostic,
            "cc-sdk approval diagnostics: permission callback received"
        );
        log_debug_event(
            session_id,
            "permission.callback.received",
            &serde_json::json!({
                "toolName": tool_name,
                "toolCallId": tool_call_id,
                "source": source,
                "hadPendingDiagnostic": had_pending_diagnostic,
            }),
        );
    }

    pub(crate) async fn warn_if_callback_missing(&self, session_id: &str, tool_call_id: &str) {
        let pending = self.pending.lock().await.get(tool_call_id).cloned();
        if let Some(pending) = pending {
            tracing::warn!(
                session_id = %session_id,
                tool_name = %pending.tool_name,
                tool_call_id = %tool_call_id,
                "cc-sdk approval diagnostics: tool use is still waiting for can_use_tool/PermissionRequest callback"
            );
            log_debug_event(
                session_id,
                "permission.callback.missing",
                &serde_json::json!({
                    "toolName": pending.tool_name,
                    "toolCallId": tool_call_id,
                }),
            );
        }
    }

    pub(crate) async fn clear_if_pending(&self, tool_call_id: &str) -> bool {
        self.pending.lock().await.remove(tool_call_id).is_some()
    }

    pub(crate) async fn log_pending_for_session(&self, session_id: &str, reason: &str) {
        let pending = self
            .pending
            .lock()
            .await
            .iter()
            .filter_map(|(tool_call_id, pending)| {
                if pending.session_id == session_id {
                    Some((tool_call_id.clone(), pending.tool_name.clone()))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        if pending.is_empty() {
            return;
        }

        tracing::warn!(
            session_id = %session_id,
            reason = %reason,
            pending_tool_calls = ?pending,
            "cc-sdk approval diagnostics: session still has tool uses with no permission callback"
        );
    }
}

fn tool_name_expects_permission_callback(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Bash" | "Edit" | "MultiEdit" | "Write" | "NotebookEdit" | "NotebookWrite"
    )
}

pub(crate) async fn clear_pending_approval_callback_diagnostic_for_terminal_update(
    approval_callback_tracker: &ApprovalCallbackTracker,
    update: &SessionUpdate,
) {
    let SessionUpdate::ToolCallUpdate { update, .. } = update else {
        return;
    };

    if !matches!(
        update.status,
        Some(ToolCallStatus::Completed) | Some(ToolCallStatus::Failed)
    ) {
        return;
    }

    approval_callback_tracker
        .clear_if_pending(&update.tool_call_id)
        .await;
}

pub(crate) struct StreamingBridgeContext {
    pub(crate) dispatcher: AcpUiEventDispatcher,
    pub(crate) bridge: Arc<PermissionBridge>,
    pub(crate) projection_registry: Arc<ProjectionRegistry>,
    pub(crate) tool_call_tracker: Arc<ToolCallIdTracker>,
    pub(crate) approval_callback_tracker: Arc<ApprovalCallbackTracker>,
    pub(crate) task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    pub(crate) pending_questions: Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    pub(crate) provider: Arc<dyn AgentProvider>,
    pub(crate) db: Option<DbConn>,
    pub(crate) app_handle: Option<AppHandle>,
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

pub(crate) async fn run_streaming_bridge(
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
    } = context;

    tracing::info!(session_id = %session_id, "cc-sdk bridge: started, waiting for messages...");
    let mut message_count: u64 = 0;
    let mut turn_stream_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
    let mut observed_provider_session_id: Option<String> = None;

    while let Some(result) = stream.next().await {
        match result {
            Ok(msg) => {
                if let Some(provider_session_id) = provider_session_id_from_message(&msg) {
                    if provider_session_id != session_id
                        && observed_provider_session_id.as_deref() != Some(provider_session_id)
                    {
                        persist_provider_session_id_alias(
                            app_handle.as_ref(),
                            db.as_ref(),
                            &session_id,
                            provider_session_id,
                        )
                        .await;
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
                        usage,
                        total_cost_usd,
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
                    cc_sdk::Message::System { subtype, data, .. } => {
                        tracing::debug!(
                            session_id = %session_id,
                            subtype = %subtype,
                            data = %data,
                            "cc-sdk bridge: System message"
                        );
                        "System"
                    }
                    cc_sdk::Message::RateLimit { .. } => "RateLimit",
                    cc_sdk::Message::Unknown { msg_type, raw, .. } => {
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
                                    tool_call.raw_input.as_ref(),
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
                        let preserved_model = turn_stream_state.model_id.clone();
                        turn_stream_state =
                            crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
                        turn_stream_state.model_id = preserved_model;
                    }
                    if should_defer_turn_complete {
                        tracing::info!(
                            session_id = %session_id,
                            "cc-sdk bridge: deferring turn completion while awaiting stream-only question answer"
                        );
                        continue;
                    }
                    rewrite_generic_turn_failed_from_permission_deny(&bridge, &mut update).await;
                    if matches!(update, SessionUpdate::TurnComplete { .. }) {
                        bridge.clear_terminal_deny_message().await;
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

    tracing::info!(
        session_id = %session_id,
        total_messages = message_count,
        "cc-sdk bridge: stream ended"
    );

    let cleared_request_ids = bridge.drain_all_as_denied().await;
    for cleared_request_id in cleared_request_ids {
        crate::acp::client_transport::apply_interaction_response_for_request(
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

pub(crate) fn provider_session_id_from_message(msg: &cc_sdk::Message) -> Option<&str> {
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

async fn persist_provider_session_id_alias(
    app_handle: Option<&AppHandle>,
    db: Option<&DbConn>,
    session_id: &str,
    provider_session_id: &str,
) {
    if let Err(error) =
        bind_provider_session_id_persisted(app_handle, db, session_id, provider_session_id).await
    {
        tracing::warn!(
            session_id = %session_id,
            provider_session_id = %provider_session_id,
            error = %error,
            "Failed to persist provider session ID alias"
        );
    }
}

pub(crate) fn collect_cc_sdk_updates_for_dispatch(
    update: &SessionUpdate,
    task_reconciler: &Arc<std::sync::Mutex<TaskReconciler>>,
    agent_type: AgentType,
    provider: Option<&dyn AgentProvider>,
) -> Vec<SessionUpdate> {
    process_through_reconciler(update, task_reconciler, agent_type, provider)
}

pub(crate) fn dispatch_cc_sdk_update(
    dispatcher: &AcpUiEventDispatcher,
    task_reconciler: &Arc<std::sync::Mutex<TaskReconciler>>,
    provider: &dyn AgentProvider,
    update: SessionUpdate,
) {
    let updates_to_emit = collect_cc_sdk_updates_for_dispatch(
        &update,
        task_reconciler,
        provider.parser_agent_type(),
        Some(provider),
    );

    for emitted_update in updates_to_emit {
        let sid = emitted_update.session_id().unwrap_or("unknown").to_string();
        log_emitted_event(&sid, &emitted_update);
        dispatcher.enqueue(AcpUiEvent::session_update(emitted_update));
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
    });
}
