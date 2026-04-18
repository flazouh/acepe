use crate::acp::client::{PendingRequestEntry, PromptRequestSession};
use crate::acp::client_errors::extract_turn_error;
use crate::acp::client_transport::{
    drain_permissions_as_failed, fail_pending_requests, send_inbound_response, truncate_for_log,
    InboundRequestResponder,
};
use crate::acp::client_updates::handle_session_update_notification;
use crate::acp::inbound_request_router::{
    remap_forwarded_web_search_tool_call_id, route_backend_inbound_request,
    ForwardedPermissionRequest, InboundRoutingDecision,
};
use crate::acp::non_streaming_batcher::NonStreamingEventBatcher;
use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::parsers::AgentType;
use crate::acp::permission_tracker::{PermissionContext, PermissionTracker, WebSearchDedup};
use crate::acp::projections::ProjectionRegistry;
use crate::acp::provider::AgentProvider;
use crate::acp::provider_extensions::InboundResponseAdapter;
use crate::acp::reconciler::kind_payload::is_web_search_id;
use crate::acp::session_registry::SessionRegistry;
use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolKind, TurnErrorData, TurnErrorInfo, TurnErrorKind,
    TurnErrorSource,
};
use crate::acp::streaming_delta_batcher::StreamingDeltaBatcher;
use crate::acp::streaming_log::{log_emitted_event, log_streaming_event};
use crate::acp::task_reconciler::TaskReconciler;
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher};
use sea_orm::DbConn;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc as StdArc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tokio::time::Duration;

/// Maximum number of stderr lines to retain in the buffer.
const STDERR_BUFFER_MAX_LINES: usize = 20;

/// Shared buffer that captures recent stderr output from the subprocess.
/// When the subprocess dies, the last lines are included in the error message
/// so users can see WHY it crashed, not just that it crashed.
pub(crate) type StderrBuffer = StdArc<std::sync::Mutex<VecDeque<String>>>;

/// Create a new empty stderr buffer.
pub(crate) fn new_stderr_buffer() -> StderrBuffer {
    StdArc::new(std::sync::Mutex::new(VecDeque::with_capacity(
        STDERR_BUFFER_MAX_LINES,
    )))
}

/// Read the last lines from the stderr buffer, joined with newlines.
/// Returns None if the buffer is empty.
pub(crate) fn read_stderr_buffer(buffer: &StderrBuffer) -> Option<String> {
    let guard = buffer.lock().ok()?;
    if guard.is_empty() {
        return None;
    }
    Some(guard.iter().cloned().collect::<Vec<_>>().join("\n"))
}

#[allow(clippy::too_many_arguments)]
async fn send_auto_response_and_emit_updates(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    dispatcher: &AcpUiEventDispatcher,
    id: u64,
    method: &str,
    result: Value,
    session_id: Option<String>,
    synthetic_tool_call: Option<Box<crate::acp::inbound_request_router::SyntheticToolCallContext>>,
    canonical_interaction: Option<SessionUpdate>,
) {
    if let Err(error) = send_inbound_response(stdin_writer, id, result).await {
        tracing::error!(
            id = id,
            method = %method,
            error = %error,
            "Failed to send backend auto-response"
        );
        return;
    }

    if let Some(synthetic_ctx) = synthetic_tool_call {
        if let Some(session_id) = session_id.clone() {
            let synthetic = SessionUpdate::ToolCall {
                tool_call: synthetic_ctx.tool_call_data,
                session_id: Some(session_id),
            };
            dispatcher.enqueue(AcpUiEvent::session_update(synthetic));
        }
    }

    if let Some(interaction_update) = canonical_interaction {
        dispatcher.enqueue(AcpUiEvent::session_update(interaction_update));
    }

    tracing::debug!(
        id = id,
        method = %method,
        "Auto-responded to backend inbound request"
    );
}

/// Wrapper that flushes the StreamingDeltaBatcher on drop.
/// Ensures buffered deltas are emitted even if the task panics or is cancelled.
pub(crate) struct BatcherWithGuard {
    batcher: StreamingDeltaBatcher,
    dispatcher: AcpUiEventDispatcher,
}

impl BatcherWithGuard {
    fn new(dispatcher: AcpUiEventDispatcher) -> Self {
        Self {
            batcher: StreamingDeltaBatcher::new(),
            dispatcher,
        }
    }

    #[cfg(test)]
    pub(crate) fn new_for_tests(dispatcher: AcpUiEventDispatcher) -> Self {
        Self::new(dispatcher)
    }

    pub(crate) fn process(&mut self, update: SessionUpdate) -> Vec<SessionUpdate> {
        self.batcher.process(update)
    }

    fn process_turn_complete(
        &mut self,
        session_id: &str,
        turn_id: Option<String>,
    ) -> Vec<SessionUpdate> {
        self.batcher.process_turn_complete(session_id, turn_id)
    }

    fn process_turn_error(
        &mut self,
        session_id: &str,
        turn_id: Option<String>,
        error: crate::acp::session_update::TurnErrorData,
    ) -> Vec<SessionUpdate> {
        self.batcher.process_turn_error(session_id, turn_id, error)
    }

    /// Flush all buffered updates (e.g. before circuit breaker break).
    pub(crate) fn flush_all(&mut self) -> Vec<SessionUpdate> {
        self.batcher.flush_all()
    }

    fn flush_ready(&mut self) -> Vec<SessionUpdate> {
        self.batcher.flush_ready()
    }

    fn time_until_flush(&self) -> Option<Duration> {
        self.batcher.time_until_flush()
    }

    fn has_pending(&self) -> bool {
        self.batcher.has_pending()
    }
}

/// Drain all fire-and-forget prompt sessions and synthesize TurnError events.
///
/// Uses the batcher to ensure buffered text chunks are flushed before TurnError
/// (`process_turn_error` internally calls `flush_session` then appends TurnError).
///
/// Only called from the stdout reader task (which owns the batcher). The death
/// monitor does NOT drain prompt_sessions because it has no batcher access — if it
/// dispatched TurnError directly, the frontend could receive TurnError BEFORE the
/// batcher's Drop-flush delivers final text chunks (ordering violation).
async fn drain_prompt_sessions_as_turn_errors(
    prompt_sessions: &StdArc<Mutex<HashMap<u64, PromptRequestSession>>>,
    process_generation: u64,
    streaming_batcher: &mut BatcherWithGuard,
    dispatcher: &AcpUiEventDispatcher,
    reason: &str,
) {
    let mut locked: tokio::sync::MutexGuard<'_, HashMap<u64, PromptRequestSession>> =
        prompt_sessions.lock().await;
    let drained_ids: Vec<u64> = locked
        .iter()
        .filter_map(|(id, prompt)| {
            if prompt.generation == process_generation {
                Some(*id)
            } else {
                None
            }
        })
        .collect();
    let drained: HashMap<u64, PromptRequestSession> = drained_ids
        .into_iter()
        .filter_map(|id| locked.remove(&id).map(|prompt| (id, prompt)))
        .collect();
    if drained.is_empty() {
        return;
    }

    tracing::warn!(
        count = drained.len(),
        reason,
        "Synthesizing TurnError for orphaned prompt sessions after subprocess death"
    );

    for (request_id, prompt) in drained {
        let error = TurnErrorData::Structured(TurnErrorInfo {
            message: reason.to_string(),
            kind: TurnErrorKind::Fatal,
            code: Some(-32001),
            source: Some(TurnErrorSource::Process),
        });
        let updates = streaming_batcher.process_turn_error(
            &prompt.session_id,
            Some(request_id.to_string()),
            error,
        );
        for update in updates {
            dispatcher.enqueue(AcpUiEvent::session_update(update));
        }
    }
}

impl Drop for BatcherWithGuard {
    fn drop(&mut self) {
        let updates = self.batcher.flush_all();
        if !updates.is_empty() {
            tracing::info!(count = updates.len(), "BatcherWithGuard flushing on drop");
            for update in updates {
                self.dispatcher.enqueue(AcpUiEvent::session_update(update));
            }
        }
    }
}

pub(crate) fn spawn_stderr_reader(
    stderr: ChildStderr,
    max_logged_line_bytes: usize,
    buffer: StderrBuffer,
) {
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();

        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    tracing::warn!(
                        stderr = %truncate_for_log(&line, max_logged_line_bytes),
                        bytes = line.len(),
                        "Subprocess stderr"
                    );
                    if let Ok(mut buf) = buffer.lock() {
                        if buf.len() >= STDERR_BUFFER_MAX_LINES {
                            buf.pop_front();
                        }
                        buf.push_back(line);
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    tracing::error!(error = %error, "Failed reading subprocess stderr");
                    break;
                }
            }
        }
        tracing::debug!("Subprocess stderr reader task ended");
    });
}

pub(crate) struct StdoutLoopContext {
    pub process_generation: u64,
    pub pending: StdArc<Mutex<HashMap<u64, PendingRequestEntry>>>,
    pub stdin_writer: StdArc<Mutex<Option<ChildStdin>>>,
    pub prompt_sessions: StdArc<Mutex<HashMap<u64, PromptRequestSession>>>,
    pub app_handle: Option<AppHandle>,
    pub dispatcher: AcpUiEventDispatcher,
    pub permission_tracker: StdArc<std::sync::Mutex<PermissionTracker>>,
    pub web_search_dedup: StdArc<std::sync::Mutex<WebSearchDedup>>,
    pub active_session_id: StdArc<std::sync::Mutex<Option<String>>>,
    pub inbound_response_adapters: StdArc<std::sync::Mutex<HashMap<u64, InboundResponseAdapter>>>,
    pub is_replay_active: StdArc<std::sync::atomic::AtomicBool>,
    pub provider: Option<StdArc<dyn AgentProvider>>,
    pub agent_type: AgentType,
    pub max_logged_line_bytes: usize,
    pub stderr_buffer: StderrBuffer,
    pub cancel: tokio_util::sync::CancellationToken,
}

pub(crate) struct DeathMonitorContext {
    pub process_generation: u64,
    pub pending_requests: StdArc<Mutex<HashMap<u64, PendingRequestEntry>>>,
    pub permission_tracker: StdArc<std::sync::Mutex<PermissionTracker>>,
    pub web_search_dedup: StdArc<std::sync::Mutex<WebSearchDedup>>,
    pub dispatcher: AcpUiEventDispatcher,
    pub stderr_buffer: StderrBuffer,
    pub cancel: tokio_util::sync::CancellationToken,
}

pub(crate) fn spawn_stdout_reader(stdout: ChildStdout, ctx: StdoutLoopContext) {
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut streaming_batcher = BatcherWithGuard::new(ctx.dispatcher.clone());
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let message_id_tracker: StdArc<std::sync::Mutex<HashMap<String, String>>> =
            StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let assistant_text_tracker: StdArc<std::sync::Mutex<HashMap<String, String>>> =
            StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler: StdArc<std::sync::Mutex<TaskReconciler>> =
            StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));

        /// Circuit breaker: after this many consecutive JSON parse failures, treat stdout as broken.
        /// 20 allows transient noise (e.g. logs) without dropping the connection; tune if subprocess emits non-JSON lines.
        const MALFORMED_OUTPUT_THRESHOLD: u32 = 20;
        let mut consecutive_parse_failures: u32 = 0;

        loop {
            let non_streaming_flush_timeout = non_streaming_batcher
                .time_until_flush()
                .unwrap_or(Duration::from_secs(3600));
            let streaming_flush_timeout = streaming_batcher
                .time_until_flush()
                .unwrap_or(Duration::from_secs(3600));

            tokio::select! {
                biased;
                _ = ctx.cancel.cancelled() => {
                    tracing::debug!("Stdout reader cancelled by stop()");
                    break;
                }
                line_result = lines.next_line() => {
                    let line = match line_result {
                        Ok(Some(line)) => line,
                        Ok(None) => {
                            if ctx.cancel.is_cancelled() {
                                tracing::debug!("Stdout reader skipping EOF drain after stop()");
                                break;
                            }
                            tracing::error!(
                                stderr = read_stderr_buffer(&ctx.stderr_buffer),
                                "Subprocess stdout closed (EOF)"
                            );
                            let reason = match read_stderr_buffer(&ctx.stderr_buffer) {
                                Some(stderr) => format!("Agent process exited unexpectedly:\n{stderr}"),
                                None => "Agent process exited unexpectedly".to_string(),
                            };
                            drain_prompt_sessions_as_turn_errors(
                                &ctx.prompt_sessions, ctx.process_generation, &mut streaming_batcher, &ctx.dispatcher,
                                &reason
                            ).await;
                            fail_pending_requests(&ctx.pending, ctx.process_generation, &reason).await;
                            drain_permissions_as_failed(&ctx.permission_tracker, &ctx.dispatcher);
                            if let Ok(mut dedup) = ctx.web_search_dedup.lock() { dedup.drain_all(); }
                            break;
                        }
                        Err(e) => {
                            if ctx.cancel.is_cancelled() {
                                tracing::debug!("Stdout reader skipping read-error drain after stop()");
                                break;
                            }
                            let base_reason = format!("Subprocess stdout read error: {e}");
                            let reason = match read_stderr_buffer(&ctx.stderr_buffer) {
                                Some(stderr) => format!("{base_reason}\n{stderr}"),
                                None => base_reason,
                            };
                            tracing::error!(error = %e, "Error reading from subprocess stdout");
                            drain_prompt_sessions_as_turn_errors(
                                &ctx.prompt_sessions, ctx.process_generation, &mut streaming_batcher, &ctx.dispatcher, &reason
                            ).await;
                            fail_pending_requests(&ctx.pending, ctx.process_generation, &reason).await;
                            drain_permissions_as_failed(&ctx.permission_tracker, &ctx.dispatcher);
                            if let Ok(mut dedup) = ctx.web_search_dedup.lock() { dedup.drain_all(); }
                            break;
                        }
                    };
                    tracing::trace!(bytes = line.len(), "Received line from subprocess");

                    if let Ok(json) = serde_json::from_str::<Value>(&line) {
                        consecutive_parse_failures = 0;
                        if let Some(id) = json.get("id").and_then(|v| v.as_u64()) {
                            if let Some(method) = json.get("method").and_then(|v| v.as_str()) {
                                tracing::info!(id = id, method = %method, "Received inbound request from subprocess");
                                let params = json.get("params").cloned().unwrap_or(Value::Null);
                                let current_session_id = ctx.active_session_id.lock().ok().and_then(|guard| guard.clone());

                                if let Some(provider) = ctx.provider.as_ref() {
                                    match provider.normalize_extension_method(method, &params, Some(id), current_session_id.as_deref()) {
                                        Ok(Some(event)) => {
                                            // Log the raw inbound extension request
                                            let session_id_for_log = current_session_id.as_deref().unwrap_or("unknown");
                                            log_streaming_event(session_id_for_log, &json);

                                            if event.response_adapter.is_some() && ctx.is_replay_active.load(std::sync::atomic::Ordering::Acquire) {
                                                tracing::info!(id = id, method = %method, "Auto-cancelling extension request during session replay");
                                                let cancel_response = json!({
                                                    "outcome": {
                                                        "outcome": "cancelled",
                                                        "reason": "Auto-cancelled during session replay"
                                                    }
                                                });
                                                if let Err(error) = send_inbound_response(&ctx.stdin_writer, id, cancel_response).await {
                                                    tracing::error!(id = id, method = %method, error = %error, "Failed to send auto-cancel response for extension request");
                                                }
                                                continue;
                                            }

                                            if let Some(adapter) = event.response_adapter {
                                                match ctx.inbound_response_adapters.lock() {
                                                    Ok(mut adapters) => {
                                                        adapters.insert(id, adapter);
                                                    }
                                                    Err(error) => {
                                                        tracing::error!(id = id, method = %method, error = %error, "Inbound response adapter mutex poisoned");
                                                    }
                                                }
                                            }
                                            for update in event.updates {
                                                log_emitted_event(session_id_for_log, &update);
                                                ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                                            }
                                            tracing::debug!(provider = %provider.id(), id = id, method = %method, "Normalized provider extension request in backend");
                                            continue;
                                        }
                                        Ok(None) => {}
                                        Err(error) => {
                                            tracing::error!(id = id, method = %method, error = %error, "Failed to normalize provider extension request");
                                        }
                                    }
                                }

                                if ctx.is_replay_active.load(std::sync::atomic::Ordering::Acquire) {
                                    tracing::info!(id = id, method = %method, "Auto-cancelling inbound request during session replay");
                                    let cancel_response = json!({
                                        "outcome": {
                                            "outcome": "cancelled",
                                            "reason": "Auto-cancelled during session replay"
                                        }
                                    });
                                    if let Err(error) = send_inbound_response(&ctx.stdin_writer, id, cancel_response).await {
                                        tracing::error!(id = id, method = %method, error = %error, "Failed to send auto-cancel response");
                                    }
                                    continue;
                                }

                                match route_backend_inbound_request(ctx.app_handle.as_ref(), id, method, &params, ctx.agent_type).await {
                                    InboundRoutingDecision::Handle(result) => {
                                        if let Err(error) = send_inbound_response(&ctx.stdin_writer, id, result).await {
                                            tracing::error!(id = id, method = %method, error = %error, "Failed to send backend inbound response");
                                        } else {
                                            tracing::debug!(id = id, method = %method, "Handled inbound request in backend");
                                        }
                                    }
                                    InboundRoutingDecision::AutoRespond {
                                        result,
                                        session_id,
                                        synthetic_tool_call,
                                        canonical_interaction,
                                    } => {
                                        send_auto_response_and_emit_updates(
                                            &ctx.stdin_writer,
                                            &ctx.dispatcher,
                                            id,
                                            method,
                                            result,
                                            session_id,
                                            synthetic_tool_call,
                                            canonical_interaction,
                                        )
                                        .await;
                                    }
                                    InboundRoutingDecision::ForwardToUi {
                                        parsed_arguments,
                                        mut synthetic_tool_call,
                                        canonical_interaction,
                                        forward_legacy_event,
                                    } => {
                                        let mut forwarded = ForwardedPermissionRequest::new(json.clone());
                                        forwarded.inject_parsed_arguments(parsed_arguments.as_ref());

                                        // Normalize sub-agent session ID → root session ID.
                                        // Sub-agents use internal child session IDs the frontend doesn't know about.
                                        if let Some(root_id) = ctx.active_session_id.lock().ok().and_then(|g| g.clone()) {
                                            if forwarded.normalize_session_id(Some(&root_id)) {
                                                tracing::debug!(root_session_id = %root_id, "Normalizing sub-agent session ID");
                                            }
                                        }

                                        // Remap web search permission IDs to the canonical notification ID.
                                        // The notification arrives with a stable ID (e.g. `tool_7319769b-...`)
                                        // but the permission arrives with a different ID (`web_search_0`).
                                        // We recorded the notification ID in web_search_dedup; remap here
                                        // so the synthetic ToolCall and forwarded JSON use the same ID,
                                        // preventing a duplicate UI row.
                                        if let Ok(mut dedup) = ctx.web_search_dedup.lock() {
                                            if let Some(canonical_id) = remap_forwarded_web_search_tool_call_id(
                                                &mut forwarded,
                                                ctx.provider.as_deref(),
                                                &parsed_arguments,
                                                &mut synthetic_tool_call,
                                                &mut dedup,
                                            ) {
                                                tracing::debug!(
                                                    canonical_id = %canonical_id,
                                                    "Remapped web search permission ID to notification canonical ID"
                                                );
                                            }
                                        }

                                        if let Some(synthetic_ctx) = &synthetic_tool_call {
                                            let session_id = forwarded.session_id();

                                            if let Some(ref sid) = session_id {
                                                let synthetic = SessionUpdate::ToolCall {
                                                    tool_call: synthetic_ctx.tool_call_data.clone(),
                                                    session_id: Some(sid.clone()),
                                                };
                                                ctx.dispatcher.enqueue(AcpUiEvent::session_update(synthetic));

                                                match ctx.permission_tracker.lock() {
                                                    Ok(mut tracker) => {
                                                        tracker.track(id, PermissionContext {
                                                            session_id: sid.clone(),
                                                            tool_call_id: synthetic_ctx.tool_call_data.id.clone(),
                                                        });
                                                    }
                                                    Err(e) => {
                                                        tracing::error!("Permission tracker mutex poisoned in track: {e}");
                                                    }
                                                }
                                            }
                                        }

                                        if let Some(interaction_update) = canonical_interaction {
                                            ctx.dispatcher.enqueue(AcpUiEvent::session_update(interaction_update));
                                        }

                                        if let Some(session_id) = forwarded.session_id() {
                                            if let Some(app_handle) = ctx.app_handle.as_ref() {
                                                let db = app_handle.state::<DbConn>();
                                                let registry = app_handle.state::<SessionRegistry>();
                                                let projection_registry =
                                                    app_handle.state::<StdArc<ProjectionRegistry>>();
                                                let responder_session_id = session_id.to_string();
                                                registry.store_pending_inbound_responder(
                                                    session_id,
                                                    StdArc::new(InboundRequestResponder {
                                                        session_id: responder_session_id,
                                                        provider: ctx.provider.clone(),
                                                        db: Some(db.inner().clone()),
                                                        stdin_writer: ctx.stdin_writer.clone(),
                                                        permission_tracker: ctx.permission_tracker.clone(),
                                                        projection_registry: projection_registry.inner().clone(),
                                                        dispatcher: ctx.dispatcher.clone(),
                                                        inbound_response_adapters: ctx.inbound_response_adapters.clone(),
                                                    }),
                                                );
                                            }
                                        }

                                        if forward_legacy_event {
                                            ctx.dispatcher.enqueue(AcpUiEvent::inbound_request(forwarded.into_value()));
                                        }
                                    }
                                }
                            } else {
                                tracing::debug!(id = id, "Received response with id");

                                if let Some(prompt_session) = ctx.prompt_sessions.lock().await.remove(&id) {
                                    let session_id = prompt_session.session_id;
                                    if ctx.provider.as_ref().is_some_and(|provider| provider.clear_message_tracker_on_prompt_response()) {
                                        if let Ok(mut tracker) = message_id_tracker.lock() {
                                            tracker.remove(&session_id);
                                        }
                                    }

                                    let updates = if let Some(error) = json.get("error") {
                                        let turn_error = extract_turn_error(error);
                                        tracing::error!(id = id, session_id = %session_id, error = ?turn_error, "Prompt failed");
                                        streaming_batcher.process_turn_error(
                                            &session_id,
                                            Some(id.to_string()),
                                            turn_error,
                                        )
                                    } else {
                                        tracing::info!(id = id, session_id = %session_id, "Prompt completed");
                                        streaming_batcher.process_turn_complete(
                                            &session_id,
                                            Some(id.to_string()),
                                        )
                                    };

                                    for update in updates {
                                        ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                                    }
                                } else if let Some(entry) = ctx.pending.lock().await.remove(&id) {
                                    let _ = entry.sender.send(json);
                                } else {
                                    tracing::warn!(id = id, "No pending request found for id");
                                }
                            }
                        } else {
                            tracing::trace!(bytes = line.len(), "Received notification (no id)");
                            let method = json.get("method").and_then(|value| value.as_str()).unwrap_or_default();
                            let params = json.get("params").cloned().unwrap_or(Value::Null);
                            let current_session_id = ctx.active_session_id.lock().ok().and_then(|guard| guard.clone());
                            if let Some(provider) = ctx.provider.as_ref() {
                                match provider.normalize_extension_method(method, &params, None, current_session_id.as_deref()) {
                                    Ok(Some(event)) => {
                                        let session_id_for_log = current_session_id.as_deref().unwrap_or("unknown");
                                        log_streaming_event(session_id_for_log, &json);
                                        for update in event.updates {
                                            log_emitted_event(session_id_for_log, &update);
                                            ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                                        }
                                        continue;
                                    }
                                    Ok(None) => {}
                                    Err(error) => {
                                        tracing::error!(method = %method, error = %error, "Failed to normalize provider extension notification");
                                    }
                                }
                            }
                            // Record web search notification IDs for dedup with permission events.
                            // Cursor emits a toolCall notification (ID like `tool_7319769b-...`) followed
                            // ~555ms later by a permission request (ID like `web_search_0`). We record
                            // the notification ID here keyed by (session_id, query) so that the permission
                            // path can remap to the canonical notification ID.
                            if json.pointer("/params/event").and_then(|v| v.as_str()) == Some("toolCall") {
                                if let Some(tool_call_id) = json.pointer("/params/data/toolCallId").and_then(|v| v.as_str()) {
                                    if is_web_search_id(tool_call_id) {
                                        if let Some(raw_input) = json.pointer("/params/data/rawInput") {
                                            let args = parse_tool_kind_arguments(ToolKind::WebSearch, raw_input);
                                            if let ToolArguments::WebSearch { query: Some(query) } = args {
                                                if let (Ok(mut dedup), Some(sid)) = (
                                                    ctx.web_search_dedup.lock(),
                                                    current_session_id.as_ref(),
                                                ) {
                                                    tracing::debug!(
                                                        tool_call_id = %tool_call_id,
                                                        query = %query,
                                                        "Recording web search notification for dedup"
                                                    );
                                                    dedup.record(sid.clone(), query, tool_call_id.to_string());
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // Skip provider-owned notifications that should be hidden from
                            // generic UI handling because a provider-specific adapter will
                            // replace them with richer events.
                            if ctx
                                .provider
                                .as_ref()
                                .is_some_and(|provider| provider.should_suppress_notification(&json))
                            {
                                tracing::debug!("Suppressing provider-owned notification");
                                continue;
                            }

                            handle_session_update_notification(
                                &ctx.dispatcher,
                                ctx.agent_type,
                                ctx.provider.as_deref(),
                                &message_id_tracker,
                                &assistant_text_tracker,
                                &task_reconciler,
                                &mut streaming_batcher,
                                &mut non_streaming_batcher,
                                &json,
                            )
                            .await;
                        }
                    } else {
                        consecutive_parse_failures += 1;
                        tracing::error!(
                            bytes = line.len(),
                            consecutive_failures = consecutive_parse_failures,
                            line = %truncate_for_log(&line, ctx.max_logged_line_bytes),
                            "Failed to parse JSON from subprocess line"
                        );
                        if consecutive_parse_failures >= MALFORMED_OUTPUT_THRESHOLD {
                            if ctx.cancel.is_cancelled() {
                                tracing::debug!("Stdout reader skipping malformed-output drain after stop()");
                                break;
                            }
                            let reason = format!(
                                "Circuit breaker: {} consecutive malformed JSON lines from subprocess stdout",
                                consecutive_parse_failures
                            );
                            tracing::error!(%reason, "Treating subprocess stdout as broken");
                            for update in streaming_batcher.flush_all() {
                                ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                            }
                            drain_prompt_sessions_as_turn_errors(
                                &ctx.prompt_sessions, ctx.process_generation, &mut streaming_batcher, &ctx.dispatcher, &reason
                            ).await;
                            fail_pending_requests(&ctx.pending, ctx.process_generation, &reason).await;
                            drain_permissions_as_failed(&ctx.permission_tracker, &ctx.dispatcher);
                            if let Ok(mut dedup) = ctx.web_search_dedup.lock() {
                                dedup.drain_all();
                            }
                            break;
                        }
                    }
                }
                _ = tokio::time::sleep(non_streaming_flush_timeout), if non_streaming_batcher.has_pending() => {
                    tracing::debug!(count = non_streaming_batcher.pending_count(), "Flushing non-streaming updates on timer");
                    for update in non_streaming_batcher.flush_all() {
                        ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                    }
                }
                _ = tokio::time::sleep(streaming_flush_timeout), if streaming_batcher.has_pending() => {
                    let updates = streaming_batcher.flush_ready();
                    if !updates.is_empty() {
                        tracing::debug!(count = updates.len(), "Flushing streaming updates on timer");
                        for update in updates {
                            ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                        }
                    }
                }
            }
        }

        if streaming_batcher.has_pending() {
            for update in streaming_batcher.flush_all() {
                ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
            }
        }
        if non_streaming_batcher.has_pending() {
            for update in non_streaming_batcher.flush_all() {
                ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
            }
        }
        tracing::info!("Subprocess stdout reader task ended");
    });
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_death_monitor(
    child_monitor: StdArc<std::sync::Mutex<Option<Child>>>,
    ctx: DeathMonitorContext,
) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = ctx.cancel.cancelled() => {
                    tracing::debug!("Death monitor cancelled by stop()");
                    break;
                }
                _ = tokio::time::sleep(Duration::from_millis(200)) => {}
            }
            let exit_reason = {
                let mut guard = match child_monitor.lock() {
                    Ok(g) => g,
                    Err(_poisoned) => {
                        tracing::warn!("Child mutex poisoned, exiting monitor");
                        break;
                    }
                };
                let Some(ref mut child) = *guard else {
                    break;
                };
                match child.try_wait() {
                    Ok(Some(status)) => Some(format!("Subprocess exited with {status}")),
                    Ok(None) => None,
                    Err(e) => Some(format!("Failed to check subprocess status: {e}")),
                }
            };

            if let Some(base_reason) = exit_reason {
                // Re-check cancellation before draining pending requests.
                // If stop() was called between our try_wait and here, skip the drain
                // so we don't corrupt newly-inserted entries from a subsequent start().
                if ctx.cancel.is_cancelled() {
                    tracing::debug!("Death monitor skipping drain — cancelled by stop()");
                    break;
                }
                let reason = match read_stderr_buffer(&ctx.stderr_buffer) {
                    Some(stderr) => format!("Agent process exited unexpectedly:\n{stderr}"),
                    None => base_reason.clone(),
                };
                fail_pending_requests(&ctx.pending_requests, ctx.process_generation, &reason).await;
                drain_permissions_as_failed(&ctx.permission_tracker, &ctx.dispatcher);
                if let Ok(mut dedup) = ctx.web_search_dedup.lock() {
                    dedup.drain_all();
                }
                if let Ok(mut g) = child_monitor.lock() {
                    *g = None;
                }
                tracing::error!(
                    %base_reason,
                    stderr = read_stderr_buffer(&ctx.stderr_buffer),
                    "Child process death monitor detected exit"
                );
                break;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::AgentType;
    use crate::acp::provider::SpawnConfig;
    use crate::acp::providers::cursor::CursorProvider;
    use crate::acp::ui_event_dispatcher::AcpUiEventDispatcher;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;
    use tokio::process::Command;
    use tokio::sync::{oneshot, Mutex};
    use tokio::time::{sleep, Duration};
    use tokio_util::sync::CancellationToken;

    struct CursorNamedTestProvider;

    impl AgentProvider for CursorNamedTestProvider {
        fn id(&self) -> &str {
            "cursor"
        }

        fn name(&self) -> &str {
            "Cursor Named Test Provider"
        }

        fn spawn_config(&self) -> SpawnConfig {
            SpawnConfig {
                command: "true".to_string(),
                args: Vec::new(),
                env: HashMap::new(),
            }
        }
    }

    fn cursor_pre_tool_notification() -> Value {
        json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "cursor-session",
                "update": {
                    "sessionUpdate": "tool_call",
                    "rawInput": { "_toolName": "createPlan" },
                    "kind": "other",
                    "status": "pending",
                    "title": "Create Plan",
                    "toolCallId": "tool_abc"
                }
            }
        })
    }

    async fn capture_stdout_events(
        notification: Value,
        provider: Option<StdArc<dyn AgentProvider>>,
        agent_type: AgentType,
    ) -> Vec<crate::acp::ui_event_dispatcher::AcpUiEvent> {
        let notification_line = notification.to_string();
        let mut child = Command::new("python3")
            .args([
                "-u",
                "-c",
                &format!("import sys; sys.stdout.write({notification_line:?} + '\\n')"),
            ])
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("child should spawn");
        let stdout = child.stdout.take().expect("stdout should be piped");

        let pending = StdArc::new(Mutex::new(HashMap::new()));
        let (dispatcher, captured) = AcpUiEventDispatcher::test_sink();
        let cancel = CancellationToken::new();

        spawn_stdout_reader(
            stdout,
            StdoutLoopContext {
                process_generation: 1,
                pending,
                stdin_writer: StdArc::new(Mutex::new(None)),
                prompt_sessions: StdArc::new(Mutex::new(HashMap::new())),
                app_handle: None,
                dispatcher,
                permission_tracker: StdArc::new(std::sync::Mutex::new(PermissionTracker::new())),
                web_search_dedup: StdArc::new(std::sync::Mutex::new(WebSearchDedup::new())),
                active_session_id: StdArc::new(std::sync::Mutex::new(None)),
                inbound_response_adapters: StdArc::new(std::sync::Mutex::new(HashMap::new())),
                is_replay_active: StdArc::new(AtomicBool::new(false)),
                provider,
                agent_type,
                max_logged_line_bytes: 512,
                stderr_buffer: new_stderr_buffer(),
                cancel,
            },
        );

        child.wait().await.expect("child should exit cleanly");
        sleep(Duration::from_millis(50)).await;

        let events = captured.lock().expect("captured events lock").clone();
        events
    }

    #[tokio::test]
    async fn cancelled_stdout_reader_does_not_drain_pending_requests_on_eof() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 0.05"])
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("child should spawn");
        let stdout = child.stdout.take().expect("stdout should be piped");

        let pending = StdArc::new(Mutex::new(HashMap::new()));
        let (tx, _rx) = oneshot::channel();
        pending.lock().await.insert(
            1,
            PendingRequestEntry {
                generation: 1,
                sender: tx,
            },
        );

        let (dispatcher, _captured) = AcpUiEventDispatcher::test_sink();
        let cancel = CancellationToken::new();

        spawn_stdout_reader(
            stdout,
            StdoutLoopContext {
                process_generation: 1,
                pending: pending.clone(),
                stdin_writer: StdArc::new(Mutex::new(None)),
                prompt_sessions: StdArc::new(Mutex::new(HashMap::new())),
                app_handle: None,
                dispatcher,
                permission_tracker: StdArc::new(std::sync::Mutex::new(PermissionTracker::new())),
                web_search_dedup: StdArc::new(std::sync::Mutex::new(WebSearchDedup::new())),
                active_session_id: StdArc::new(std::sync::Mutex::new(None)),
                inbound_response_adapters: StdArc::new(std::sync::Mutex::new(HashMap::new())),
                is_replay_active: StdArc::new(AtomicBool::new(false)),
                provider: None,
                agent_type: AgentType::ClaudeCode,
                max_logged_line_bytes: 512,
                stderr_buffer: new_stderr_buffer(),
                cancel: cancel.clone(),
            },
        );

        cancel.cancel();
        child.wait().await.expect("child should exit cleanly");
        sleep(Duration::from_millis(50)).await;

        assert_eq!(pending.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn fail_pending_requests_only_drains_matching_generation() {
        let pending = StdArc::new(Mutex::new(HashMap::new()));
        let (old_tx, old_rx) = oneshot::channel();
        let (new_tx, mut new_rx) = oneshot::channel();

        pending.lock().await.insert(
            1,
            PendingRequestEntry {
                generation: 1,
                sender: old_tx,
            },
        );
        pending.lock().await.insert(
            2,
            PendingRequestEntry {
                generation: 2,
                sender: new_tx,
            },
        );

        fail_pending_requests(&pending, 1, "old process exited").await;

        let old_response = old_rx
            .await
            .expect("old generation request should be failed");
        let old_error = old_response
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(|value| value.as_str());
        assert_eq!(old_error, Some("old process exited"));

        assert!(new_rx.try_recv().is_err());
        assert!(pending.lock().await.contains_key(&2));
        assert!(!pending.lock().await.contains_key(&1));
    }

    #[tokio::test]
    async fn cursor_pre_tool_notifications_are_not_suppressed_by_provider_id_alone() {
        let events = capture_stdout_events(
            cursor_pre_tool_notification(),
            Some(StdArc::new(CursorNamedTestProvider)),
            AgentType::Cursor,
        )
        .await;

        assert_eq!(events.len(), 1);
    }

    #[tokio::test]
    async fn cursor_provider_still_suppresses_cursor_pre_tool_notifications() {
        let events = capture_stdout_events(
            cursor_pre_tool_notification(),
            Some(StdArc::new(CursorProvider)),
            AgentType::Cursor,
        )
        .await;

        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn session_request_permission_emits_canonical_permission_update_without_legacy_event() {
        let events = capture_stdout_events(
            json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "session/request_permission",
                "params": {
                    "sessionId": "copilot-session",
                    "toolCall": {
                        "toolCallId": "write-permission",
                        "name": "Edit",
                        "rawInput": {
                            "file_path": "/tmp/README.md",
                            "old_string": "old",
                            "new_string": "new"
                        }
                    },
                    "options": [
                        { "kind": "allow_once", "name": "Allow once", "optionId": "allow_once" },
                        { "kind": "allow_always", "name": "Always allow", "optionId": "allow_always" },
                        { "kind": "reject_once", "name": "Deny", "optionId": "reject_once" }
                    ]
                }
            }),
            None,
            AgentType::Copilot,
        )
        .await;

        assert!(
            events
                .iter()
                .all(|event| event.event_name != "acp-inbound-request"),
            "canonicalized permission requests should not use the legacy inbound-request bridge"
        );

        assert!(events.iter().any(|event| {
            matches!(
                &event.payload,
                crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update)
                    if matches!(
                        update.as_ref(),
                        SessionUpdate::PermissionRequest { permission, .. }
                            if permission.id == "copilot-session\u{0}write-permission\u{0}7"
                                && permission.tool.as_ref().is_some_and(|tool| tool.call_id == "write-permission")
                )
            )
        }));
    }

    #[tokio::test]
    async fn auto_response_does_not_emit_updates_when_transport_send_fails() {
        let (dispatcher, captured) = AcpUiEventDispatcher::test_sink();

        send_auto_response_and_emit_updates(
            &StdArc::new(Mutex::new(None)),
            &dispatcher,
            7,
            "session/request_permission",
            json!({ "outcome": "allow" }),
            Some("session-1".to_string()),
            None,
            Some(SessionUpdate::TurnComplete {
                session_id: Some("session-1".to_string()),
                turn_id: None,
            }),
        )
        .await;

        let events = captured.lock().expect("captured events lock");
        assert!(events.is_empty());
    }
}
