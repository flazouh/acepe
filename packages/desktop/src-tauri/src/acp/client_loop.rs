use crate::acp::client_errors::extract_turn_error;
use crate::acp::client_transport::{
    drain_permissions_as_failed, fail_pending_requests, send_inbound_response, truncate_for_log,
    InboundRequestResponder,
};
use crate::acp::client_updates::handle_session_update_notification;
use crate::acp::cursor_extensions::{is_cursor_extension_pre_tool, CursorResponseAdapter};
use crate::acp::inbound_request_router::{
    extract_query_from_synthetic_permission, route_backend_inbound_request, InboundRoutingDecision,
};
use crate::acp::non_streaming_batcher::NonStreamingEventBatcher;
use crate::acp::parsers::arguments::parse_canonical_tool_arguments;
use crate::acp::parsers::kind::is_web_search_id;
use crate::acp::parsers::AgentType;
use crate::acp::permission_tracker::{PermissionContext, PermissionTracker, WebSearchDedup};
use crate::acp::provider::AgentProvider;
use crate::acp::session_registry::SessionRegistry;
use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolKind, TurnErrorData, TurnErrorInfo, TurnErrorKind,
    TurnErrorSource,
};
use crate::acp::streaming_delta_batcher::StreamingDeltaBatcher;
use crate::acp::streaming_log::{log_emitted_event, log_streaming_event};
use crate::acp::task_reconciler::TaskReconciler;
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc as StdArc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{oneshot, Mutex};
use tokio::time::Duration;

/// Maximum number of stderr lines to retain in the buffer.
const STDERR_BUFFER_MAX_LINES: usize = 20;

/// Shared buffer that captures recent stderr output from the subprocess.
/// When the subprocess dies, the last lines are included in the error message
/// so users (and Sentry) can see WHY it crashed, not just that it crashed.
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

    fn process_turn_complete(&mut self, session_id: &str) -> Vec<SessionUpdate> {
        self.batcher.process_turn_complete(session_id)
    }

    fn process_turn_error(
        &mut self,
        session_id: &str,
        error: crate::acp::session_update::TurnErrorData,
    ) -> Vec<SessionUpdate> {
        self.batcher.process_turn_error(session_id, error)
    }

    /// Flush all buffered updates (e.g. before circuit breaker break).
    pub(crate) fn flush_all(&mut self) -> Vec<SessionUpdate> {
        self.batcher.flush_all()
    }
}

/// Drain all fire-and-forget prompt sessions and synthesize TurnError events.
///
/// Uses the batcher to ensure buffered text chunks are flushed before TurnError
/// (`process_turn_error` internally calls `flush_session` then appends TurnError).
///
/// Deduplicates by session_id to avoid sending multiple TurnErrors for the same
/// session when multiple prompts are in-flight (e.g., rapid sends).
///
/// Only called from the stdout reader task (which owns the batcher). The death
/// monitor does NOT drain prompt_sessions because it has no batcher access — if it
/// dispatched TurnError directly, the frontend could receive TurnError BEFORE the
/// batcher's Drop-flush delivers final text chunks (ordering violation).
async fn drain_prompt_sessions_as_turn_errors(
    prompt_sessions: &StdArc<Mutex<HashMap<u64, String>>>,
    streaming_batcher: &mut BatcherWithGuard,
    dispatcher: &AcpUiEventDispatcher,
    reason: &str,
) {
    let drained: HashMap<u64, String> = prompt_sessions.lock().await.drain().collect();
    if drained.is_empty() {
        return;
    }

    let unique_sessions: HashSet<String> = drained.into_values().collect();
    tracing::warn!(
        count = unique_sessions.len(),
        reason,
        "Synthesizing TurnError for orphaned prompt sessions after subprocess death"
    );

    for session_id in unique_sessions {
        let error = TurnErrorData::Structured(TurnErrorInfo {
            message: reason.to_string(),
            kind: TurnErrorKind::Fatal,
            code: Some(-32001),
            source: Some(TurnErrorSource::Process),
        });
        let updates = streaming_batcher.process_turn_error(&session_id, error);
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

        while let Ok(Some(line)) = lines.next_line().await {
            tracing::warn!(
                stderr = %truncate_for_log(&line, max_logged_line_bytes),
                bytes = line.len(),
                "Subprocess stderr"
            );
            // Store in ring buffer for inclusion in error messages
            if let Ok(mut buf) = buffer.lock() {
                if buf.len() >= STDERR_BUFFER_MAX_LINES {
                    buf.pop_front();
                }
                buf.push_back(line);
            }
        }
        tracing::debug!("Subprocess stderr reader task ended");
    });
}

pub(crate) struct StdoutLoopContext {
    pub pending: StdArc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    pub stdin_writer: StdArc<Mutex<Option<ChildStdin>>>,
    pub prompt_sessions: StdArc<Mutex<HashMap<u64, String>>>,
    pub app_handle: Option<AppHandle>,
    pub dispatcher: AcpUiEventDispatcher,
    pub permission_tracker: StdArc<std::sync::Mutex<PermissionTracker>>,
    pub web_search_dedup: StdArc<std::sync::Mutex<WebSearchDedup>>,
    pub active_session_id: StdArc<std::sync::Mutex<Option<String>>>,
    pub inbound_response_adapters: StdArc<std::sync::Mutex<HashMap<u64, CursorResponseAdapter>>>,
    pub is_replay_active: StdArc<std::sync::atomic::AtomicBool>,
    pub provider: Option<StdArc<dyn AgentProvider>>,
    pub agent_type: AgentType,
    pub max_logged_line_bytes: usize,
    pub stderr_buffer: StderrBuffer,
}

pub(crate) fn spawn_stdout_reader(stdout: ChildStdout, ctx: StdoutLoopContext) {
    tokio::spawn(async move {
        // Set Sentry scope so all tracing::error!() in this task carry agent context
        sentry::configure_scope(|scope| {
            scope.set_tag("agent_id", ctx.agent_type.as_str());
        });

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
            let flush_timeout = non_streaming_batcher
                .time_until_flush()
                .unwrap_or(Duration::from_secs(3600));

            tokio::select! {
                biased;
                line_result = lines.next_line() => {
                    let line = match line_result {
                        Ok(Some(line)) => line,
                        Ok(None) => {
                            tracing::info!("Subprocess stdout closed (EOF)");
                            let reason = match read_stderr_buffer(&ctx.stderr_buffer) {
                                Some(stderr) => format!("Agent process exited unexpectedly:\n{stderr}"),
                                None => "Agent process exited unexpectedly".to_string(),
                            };
                            drain_prompt_sessions_as_turn_errors(
                                &ctx.prompt_sessions, &mut streaming_batcher, &ctx.dispatcher,
                                &reason
                            ).await;
                            fail_pending_requests(&ctx.pending, &reason).await;
                            drain_permissions_as_failed(&ctx.permission_tracker, &ctx.dispatcher);
                            if let Ok(mut dedup) = ctx.web_search_dedup.lock() { dedup.drain_all(); }
                            break;
                        }
                        Err(e) => {
                            let base_reason = format!("Subprocess stdout read error: {e}");
                            let reason = match read_stderr_buffer(&ctx.stderr_buffer) {
                                Some(stderr) => format!("{base_reason}\n{stderr}"),
                                None => base_reason,
                            };
                            tracing::error!(error = %e, "Error reading from subprocess stdout");
                            drain_prompt_sessions_as_turn_errors(
                                &ctx.prompt_sessions, &mut streaming_batcher, &ctx.dispatcher, &reason
                            ).await;
                            fail_pending_requests(&ctx.pending, &reason).await;
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

                                match route_backend_inbound_request(ctx.app_handle.as_ref(), method, &params, ctx.agent_type).await {
                                    InboundRoutingDecision::Handle(result) => {
                                        if let Err(error) = send_inbound_response(&ctx.stdin_writer, id, result).await {
                                            tracing::error!(id = id, method = %method, error = %error, "Failed to send backend inbound response");
                                        } else {
                                            tracing::debug!(id = id, method = %method, "Handled inbound request in backend");
                                        }
                                    }
                                    InboundRoutingDecision::ForwardToUi { parsed_arguments, mut synthetic_tool_call } => {
                                        let mut forwarded = json.clone();
                                        if let Some(args_value) = &parsed_arguments {
                                            if let Some(tc) = forwarded.pointer_mut("/params/toolCall").and_then(|v| v.as_object_mut()) {
                                                tc.insert("parsedArguments".to_string(), args_value.clone());
                                            }
                                        }

                                        // Normalize sub-agent session ID → root session ID.
                                        // Sub-agents use internal child session IDs the frontend doesn't know about.
                                        if let Some(root_id) = ctx.active_session_id.lock().ok().and_then(|g| g.clone()) {
                                            if let Some(obj) = forwarded.pointer_mut("/params").and_then(|v| v.as_object_mut()) {
                                                if obj.get("sessionId").and_then(|v| v.as_str()).is_some_and(|sid| sid != root_id) {
                                                    tracing::debug!(root_session_id = %root_id, "Normalizing sub-agent session ID");
                                                }
                                                obj.insert("sessionId".to_string(), json!(root_id));
                                            }
                                        }

                                        // Remap web search permission IDs to the canonical notification ID.
                                        // The notification arrives with a stable ID (e.g. `tool_7319769b-...`)
                                        // but the permission arrives with a different ID (`web_search_0`).
                                        // We recorded the notification ID in web_search_dedup; remap here
                                        // so the synthetic ToolCall and forwarded JSON use the same ID,
                                        // preventing a duplicate UI row.
                                        if let Some(ref mut synthetic_ctx) = synthetic_tool_call {
                                            if is_web_search_id(&synthetic_ctx.tool_call_data.id) {
                                                if let Some(query) = extract_query_from_synthetic_permission(
                                                    &parsed_arguments,
                                                    &forwarded,
                                                ) {
                                                    let session_id_for_dedup = forwarded
                                                        .pointer("/params/sessionId")
                                                        .and_then(|v| v.as_str())
                                                        .map(|s| s.to_string());
                                                    if let (Ok(mut dedup), Some(sid)) = (
                                                        ctx.web_search_dedup.lock(),
                                                        session_id_for_dedup.as_ref(),
                                                    ) {
                                                        if let Some(canonical_id) = dedup.take(sid, &query) {
                                                            tracing::debug!(
                                                                permission_id = %synthetic_ctx.tool_call_data.id,
                                                                canonical_id = %canonical_id,
                                                                query = %query,
                                                                "Remapping web search permission ID to notification canonical ID"
                                                            );
                                                            // Rewrite synthetic ToolCallData ID
                                                            synthetic_ctx.tool_call_data.id = canonical_id.clone();
                                                            // Rewrite forwarded JSON so InboundRequestHandler anchors permission correctly
                                                            if let Some(tc) = forwarded.pointer_mut("/params/toolCall") {
                                                                if let Some(obj) = tc.as_object_mut() {
                                                                    obj.insert("toolCallId".to_string(), json!(canonical_id));
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        if let Some(synthetic_ctx) = &synthetic_tool_call {
                                            let session_id = forwarded
                                                .pointer("/params/sessionId")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string());

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

                                        if let Some(session_id) = forwarded
                                            .pointer("/params/sessionId")
                                            .and_then(|value| value.as_str())
                                        {
                                            if let Some(app_handle) = ctx.app_handle.as_ref() {
                                                let registry = app_handle.state::<SessionRegistry>();
                                                registry.store_pending_inbound_responder(
                                                    session_id.to_string(),
                                                    StdArc::new(InboundRequestResponder {
                                                        provider: ctx.provider.clone(),
                                                        stdin_writer: ctx.stdin_writer.clone(),
                                                        permission_tracker: ctx.permission_tracker.clone(),
                                                        dispatcher: ctx.dispatcher.clone(),
                                                        inbound_response_adapters: ctx.inbound_response_adapters.clone(),
                                                    }),
                                                );
                                            }
                                        }

                                        ctx.dispatcher.enqueue(AcpUiEvent::inbound_request(forwarded));
                                    }
                                }
                            } else {
                                tracing::debug!(id = id, "Received response with id");

                                if let Some(session_id) = ctx.prompt_sessions.lock().await.remove(&id) {
                                    if ctx.provider.as_ref().is_some_and(|provider| provider.clear_message_tracker_on_prompt_response()) {
                                        if let Ok(mut tracker) = message_id_tracker.lock() {
                                            tracker.remove(&session_id);
                                        }
                                    }

                                    let updates = if let Some(error) = json.get("error") {
                                        let turn_error = extract_turn_error(error);
                                        tracing::error!(id = id, session_id = %session_id, error = ?turn_error, "Prompt failed");
                                        streaming_batcher.process_turn_error(&session_id, turn_error)
                                    } else {
                                        tracing::info!(id = id, session_id = %session_id, "Prompt completed");
                                        streaming_batcher.process_turn_complete(&session_id)
                                    };

                                    for update in updates {
                                        ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                                    }
                                } else if let Some(tx) = ctx.pending.lock().await.remove(&id) {
                                    let _ = tx.send(json);
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
                                            let args = parse_canonical_tool_arguments(ToolKind::WebSearch, raw_input);
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
                            // Skip Cursor pre-tool notifications that precede extension
                            // method requests. These create phantom UI cards that the
                            // extension handler will replace with proper events.
                            if ctx.provider.as_ref().is_some_and(|p| p.id() == "cursor")
                                && is_cursor_extension_pre_tool(&json)
                            {
                                tracing::debug!("Suppressing Cursor pre-tool notification");
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
                            let reason = format!(
                                "Circuit breaker: {} consecutive malformed JSON lines from subprocess stdout",
                                consecutive_parse_failures
                            );
                            tracing::error!(%reason, "Treating subprocess stdout as broken");
                            for update in streaming_batcher.flush_all() {
                                ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                            }
                            drain_prompt_sessions_as_turn_errors(
                                &ctx.prompt_sessions, &mut streaming_batcher, &ctx.dispatcher, &reason
                            ).await;
                            fail_pending_requests(&ctx.pending, &reason).await;
                            drain_permissions_as_failed(&ctx.permission_tracker, &ctx.dispatcher);
                            if let Ok(mut dedup) = ctx.web_search_dedup.lock() {
                                dedup.drain_all();
                            }
                            break;
                        }
                    }
                }
                _ = tokio::time::sleep(flush_timeout), if non_streaming_batcher.has_pending() => {
                    tracing::debug!(count = non_streaming_batcher.pending_count(), "Flushing non-streaming updates on timer");
                    for update in non_streaming_batcher.flush_all() {
                        ctx.dispatcher.enqueue(AcpUiEvent::session_update(update));
                    }
                }
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

pub(crate) fn spawn_death_monitor(
    child_monitor: StdArc<std::sync::Mutex<Option<Child>>>,
    pending_requests: StdArc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    permission_tracker: StdArc<std::sync::Mutex<PermissionTracker>>,
    web_search_dedup: StdArc<std::sync::Mutex<WebSearchDedup>>,
    dispatcher: AcpUiEventDispatcher,
    stderr_buffer: StderrBuffer,
) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;
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
                let reason = match read_stderr_buffer(&stderr_buffer) {
                    Some(stderr) => format!("Agent process exited unexpectedly:\n{stderr}"),
                    None => base_reason.clone(),
                };
                fail_pending_requests(&pending_requests, &reason).await;
                drain_permissions_as_failed(&permission_tracker, &dispatcher);
                if let Ok(mut dedup) = web_search_dedup.lock() {
                    dedup.drain_all();
                }
                if let Ok(mut g) = child_monitor.lock() {
                    *g = None;
                }
                tracing::info!(%base_reason, "Child process death monitor detected exit");
                break;
            }
        }
    });
}
