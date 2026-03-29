//! cc-sdk based AgentClient implementation for Claude Code.
//!
//! [`CcSdkClaudeClient`] communicates with the Claude Code CLI via the `cc_sdk` Rust
//! crate directly — no Bun subprocess or JSON-RPC stdio indirection.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use futures::StreamExt;
use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};
use uuid::Uuid;

use crate::acp::client::{
    InitializeResponse, ListSessionsResponse, NewSessionResponse, ResumeSessionResponse,
};
use crate::acp::agent_context::with_agent;
use crate::acp::client_session::{
    apply_provider_model_fallback, AvailableModel, default_modes, default_session_model_state,
    SessionModelState,
};
use crate::acp::client_updates::process_through_reconciler;
use crate::acp::client_trait::AgentClient;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::model_display::get_transformer;
use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::provider::AgentProvider;
use crate::acp::session_update::{
    SessionUpdate, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
    build_tool_call_update_from_raw, RawToolCallUpdateInput,
};
use crate::acp::streaming_log::{log_emitted_event, log_streaming_event};
use crate::acp::task_reconciler::TaskReconciler;
use crate::acp::types::{ContentBlock, PromptRequest};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, DispatchPolicy};

// ---------------------------------------------------------------------------
// PermissionBridge
// ---------------------------------------------------------------------------

/// Routes pending permission requests to their awaiting CanUseTool callbacks.
struct PermissionBridge {
    pending: Mutex<HashMap<u64, oneshot::Sender<bool>>>,
    /// Sequential counter kept within JS safe-integer range (< 2^53).
    counter: AtomicU64,
}

impl PermissionBridge {
    fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1),
        }
    }

    /// Returns a new unique request ID that is safe to represent as a JS number.
    fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::Relaxed)
    }

    async fn register(&self, id: u64) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        rx
    }

    async fn resolve(&self, id: u64, allow: bool) {
        if let Some(tx) = self.pending.lock().await.remove(&id) {
            let _ = tx.send(allow);
        }
    }

    async fn drain_all_as_denied(&self) {
        let mut map = self.pending.lock().await;
        for (_, tx) in map.drain() {
            let _ = tx.send(false);
        }
    }
}

// ---------------------------------------------------------------------------
// ToolCallIdTracker
// ---------------------------------------------------------------------------

/// Shared state between the streaming bridge and the permission handler.
///
/// The bridge records `(tool_name, tool_use_id)` when it sees a
/// `content_block_start` with `type: "tool_use"`. The permission handler
/// then looks up the real `toolu_...` ID by tool name so the frontend can
/// match permissions to the correct tool-call row.
///
/// Uses a `VecDeque` per tool name to handle parallel tool calls where
/// Claude may invoke the same tool multiple times in a single response.
struct ToolCallIdTracker {
    /// Maps tool_name → queue of tool_use_ids in arrival order.
    map: Mutex<HashMap<String, std::collections::VecDeque<String>>>,
}

impl ToolCallIdTracker {
    fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    /// Record a tool_name → tool_use_id mapping from a stream event.
    async fn record(&self, tool_name: String, tool_use_id: String) {
        self.map
            .lock()
            .await
            .entry(tool_name)
            .or_default()
            .push_back(tool_use_id);
    }

    /// Pop the oldest tool_use_id for a given tool name (FIFO).
    async fn take(&self, tool_name: &str) -> Option<String> {
        let mut map = self.map.lock().await;
        let queue = map.get_mut(tool_name)?;
        let id = queue.pop_front();
        if queue.is_empty() {
            map.remove(tool_name);
        }
        id
    }

}

// ---------------------------------------------------------------------------
// AcepePermissionHandler
// ---------------------------------------------------------------------------

/// Implements cc-sdk's CanUseTool by routing permission requests through the Acepe UI.
struct AcepePermissionHandler {
    session_id: String,
    bridge: Arc<PermissionBridge>,
    dispatcher: AcpUiEventDispatcher,
    tool_call_tracker: Arc<ToolCallIdTracker>,
}

#[async_trait]
impl cc_sdk::CanUseTool for AcepePermissionHandler {
    async fn can_use_tool(
        &self,
        tool_name: &str,
        input: &Value,
        _ctx: &cc_sdk::ToolPermissionContext,
    ) -> cc_sdk::PermissionResult {
        let request_id: u64 = self.bridge.next_id();
        let rx = self.bridge.register(request_id).await;

        // Look up the real tool_use_id (toolu_...) from the stream tracker.
        // The streaming bridge records it on content_block_start before the
        // CLI's control channel fires can_use_tool.  Fall back to a synthetic
        // ID if the tracker somehow missed it.
        let tool_call_id = self
            .tool_call_tracker
            .take(tool_name)
            .await
            .unwrap_or_else(|| format!("cc-sdk-{}", request_id));
        tracing::info!(
            session_id = %self.session_id,
            request_id = request_id,
            tool_name = %tool_name,
            tool_call_id = %tool_call_id,
            "cc-sdk permission request emitted"
        );
        let permission_json = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "session/request_permission",
            "params": {
                "sessionId": self.session_id,
                "options": [
                    { "kind": "allow", "name": "Allow once", "optionId": "allow" },
                    { "kind": "reject", "name": "Reject", "optionId": "reject" }
                ],
                "toolCall": {
                    "toolCallId": tool_call_id,
                    "name": tool_name,
                    "title": tool_name,
                    "rawInput": input,
                }
            }
        });
        self.dispatcher
            .enqueue(AcpUiEvent::inbound_request(permission_json));

        match timeout(Duration::from_secs(60), rx).await {
            Ok(Ok(true)) => cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                updated_input: None,
                updated_permissions: None,
            }),
            other => {
                tracing::warn!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %tool_name,
                    timeout_or_error = ?other,
                    "cc-sdk permission request denied or timed out"
                );
                cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
                    message: "Permission denied or timed out".to_string(),
                    interrupt: false,
                })
            }
        }
    }
}

// ---------------------------------------------------------------------------
// CcSdkClaudeClient
// ---------------------------------------------------------------------------

pub struct CcSdkClaudeClient {
    #[allow(dead_code)]
    provider: Arc<dyn AgentProvider>,
    /// Active sdk client, set after connect_and_start_bridge.
    sdk_client: Option<Arc<Mutex<cc_sdk::ClaudeSDKClient>>>,
    /// Current ACP session ID.
    session_id: Option<String>,
    /// Permission bridge shared with AcepePermissionHandler.
    permission_bridge: Arc<PermissionBridge>,
    /// Tracks tool_name → tool_use_id from stream events for the permission handler.
    tool_call_tracker: Arc<ToolCallIdTracker>,
    /// Reconciles task/sub-agent parent-child tool relationships for cc-sdk updates.
    task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    /// Handle for the streaming bridge task. Calling `.abort()` cancels it.
    bridge_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Dispatcher for UI events.
    dispatcher: AcpUiEventDispatcher,
    /// Deferred options: stored by new_session, consumed by the first send_prompt.
    pending_options: Option<cc_sdk::ClaudeCodeOptions>,
    pending_mode_id: Option<String>,
    pending_model_id: Option<String>,
}

impl CcSdkClaudeClient {
    pub fn new(
        provider: Arc<dyn AgentProvider>,
        app_handle: AppHandle,
        cwd: PathBuf,
    ) -> AcpResult<Self> {
        let _ = cwd; // stored implicitly via the options built at session creation time
        let dispatcher =
            AcpUiEventDispatcher::new(Some(app_handle), DispatchPolicy::default());
        Ok(Self {
            provider,
            sdk_client: None,
            session_id: None,
            permission_bridge: Arc::new(PermissionBridge::new()),
            tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
            task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
            bridge_task: None,
            dispatcher,
            pending_options: None,
            pending_mode_id: None,
            pending_model_id: None,
        })
    }

    fn reset_stream_runtime_state(&mut self) {
        self.tool_call_tracker = Arc::new(ToolCallIdTracker::new());
        self.task_reconciler = Arc::new(std::sync::Mutex::new(TaskReconciler::new()));
    }

    /// Build cc-sdk options for the given working directory.
    ///
    /// `session_id` is the Acepe session ID that will own this connection.
    /// `resume` is the cc-sdk session ID to resume (or fork from).
    /// `fork` enables fork_session mode on resume.
    fn build_options(
        &self,
        cwd: &str,
        session_id: &str,
        resume: Option<String>,
        fork: bool,
    ) -> cc_sdk::ClaudeCodeOptions {
        let handler = AcepePermissionHandler {
            session_id: session_id.to_string(),
            bridge: self.permission_bridge.clone(),
            dispatcher: self.dispatcher.clone(),
            tool_call_tracker: self.tool_call_tracker.clone(),
        };

        let mut builder = cc_sdk::ClaudeCodeOptions::builder().cwd(PathBuf::from(cwd));
        builder = builder.session_id(session_id.to_string());
        builder = builder.include_partial_messages(true);

        if let Some(mode_id) = &self.pending_mode_id {
            builder = builder.permission_mode(map_to_claude_permission_mode(mode_id));
        }

        if let Some(model_id) = &self.pending_model_id {
            builder = builder.model(model_id.clone());
        }

        if let Some(session_id) = resume {
            builder = builder.resume(session_id);
        }

        if fork {
            builder = builder.fork_session(true);
        }

        let mut options = builder.build();
        options.can_use_tool = Some(Arc::new(handler));
        options
    }

    /// Connect the cc-sdk client and spawn the streaming bridge task.
    ///
    /// `initial_prompt` is passed to `connect()` so the CLI starts processing
    /// immediately. Passing `None` causes the CLI to complete with an empty
    /// Result before any user message is sent, so the first prompt should
    /// always be provided here.
    async fn connect_and_start_bridge(
        &mut self,
        options: cc_sdk::ClaudeCodeOptions,
        session_id: String,
        initial_prompt: Option<String>,
    ) -> AcpResult<()> {
        // Stop any existing bridge first.
        self.stop_bridge();

        let mut raw_client = cc_sdk::ClaudeSDKClient::new(options);

        // Connect (starts the subprocess / transport).
        tracing::info!(session_id = %session_id, has_prompt = initial_prompt.is_some(), "cc-sdk: connecting to Claude CLI...");
        raw_client
            .connect(initial_prompt)
            .await
            .map_err(|e| AcpError::ProtocolError(e.to_string()))?;
        tracing::info!(session_id = %session_id, "cc-sdk: connected, obtaining message stream...");

        // Obtain the message stream while we still have exclusive access to raw_client.
        // The stream is `'static` — it owns the internal channel receiver — so we can
        // do this before moving the client into the Arc<Mutex>.
        let stream = raw_client.receive_messages().await;
        tracing::info!(session_id = %session_id, "cc-sdk: message stream obtained, starting bridge task");

        // Wrap for shared access (send_user_message / interrupt both need &mut self).
        let sdk_client = Arc::new(Mutex::new(raw_client));
        self.sdk_client = Some(sdk_client.clone());
        self.session_id = Some(session_id.clone());

        // Spawn the bridge task that forwards cc-sdk messages to the UI dispatcher.
        let dispatcher = self.dispatcher.clone();
        let bridge = self.permission_bridge.clone();
        let tracker = self.tool_call_tracker.clone();
        let task_reconciler = self.task_reconciler.clone();
        let provider = self.provider.clone();
        let sid = session_id.clone();

        let handle = tauri::async_runtime::spawn(async move {
            run_streaming_bridge(stream, sid, dispatcher, bridge, tracker, task_reconciler, provider)
                .await;
        });

        self.bridge_task = Some(handle);
        Ok(())
    }

    fn stop_bridge(&mut self) {
        if let Some(handle) = self.bridge_task.take() {
            handle.abort();
        }
    }

    async fn session_has_persisted_history(&self, session_id: &str, cwd: &str) -> bool {
        crate::session_jsonl::parser::find_session_file(session_id, cwd)
            .await
            .is_ok()
    }

    async fn hydrated_session_model_state(&self) -> SessionModelState {
        let mut model_state = default_session_model_state();

        let discovered = self.discover_models_from_provider_cli().await;
        let mut available_models = provider_models(self.provider.as_ref());

        for model in discovered {
            if !available_models.iter().any(|candidate| candidate.model_id == model.model_id) {
                available_models.push(model);
            }
        }

        if !available_models.is_empty() {
            model_state.available_models = available_models;
        }

        if let Some(model_id) = &self.pending_model_id {
            model_state.current_model_id = model_id.clone();
        } else if model_state.current_model_id == "auto" && model_state.available_models.len() == 1 {
            if let Some(model) = model_state.available_models.first() {
                model_state.current_model_id = model.model_id.clone();
            }
        }

        apply_provider_model_fallback(self.provider.as_ref(), &mut model_state);

        let agent_type = self.provider.parser_agent_type();
        model_state.models_display = get_transformer(agent_type).transform(&model_state.available_models);

        tracing::info!(
            provider = %self.provider.id(),
            current_model_id = %model_state.current_model_id,
            available_model_ids = ?model_state
                .available_models
                .iter()
                .map(|model| model.model_id.clone())
                .collect::<Vec<_>>(),
            "cc-sdk hydrated session model state"
        );

        model_state
    }

    async fn discover_models_from_provider_cli(&self) -> Vec<crate::acp::client::AvailableModel> {
        let attempts = self.provider.model_discovery_commands();
        if attempts.is_empty() {
            return Vec::new();
        }

        for attempt in attempts {
            tracing::info!(
                provider = %self.provider.id(),
                command = %attempt.command,
                args = ?attempt.args,
                "cc-sdk running provider model discovery command"
            );

            let mut command = tokio::process::Command::new(&attempt.command);
            command.args(&attempt.args);
            command.stdin(std::process::Stdio::null());
            command.stdout(std::process::Stdio::piped());
            command.stderr(std::process::Stdio::piped());
            command.current_dir(
                self.pending_options
                    .as_ref()
                    .and_then(|options| options.cwd.clone())
                    .unwrap_or_else(|| PathBuf::from(".")),
            );

            for (key, value) in &attempt.env {
                command.env(key, value);
            }

            let output = match timeout(Duration::from_secs(10), command.output()).await {
                Ok(Ok(output)) => output,
                Ok(Err(error)) => {
                    tracing::debug!(
                        command = %attempt.command,
                        args = ?attempt.args,
                        error = %error,
                        "Claude model discovery command failed"
                    );
                    continue;
                }
                Err(_) => {
                    tracing::debug!(
                        command = %attempt.command,
                        args = ?attempt.args,
                        "Claude model discovery command timed out"
                    );
                    continue;
                }
            };

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let mut models = crate::acp::client::parse_model_discovery_output(&stdout);

            tracing::info!(
                provider = %self.provider.id(),
                status = ?output.status.code(),
                stdout = %crate::acp::client_transport::truncate_for_log(&stdout, 512),
                stderr = %crate::acp::client_transport::truncate_for_log(&stderr, 512),
                parsed_model_ids = ?models.iter().map(|model| model.model_id.clone()).collect::<Vec<_>>(),
                "cc-sdk provider model discovery result"
            );

            if !models.is_empty() {
                models.sort_by(|a, b| a.model_id.cmp(&b.model_id));
                return models;
            }
        }

        Vec::new()
    }

    async fn apply_runtime_mode(&self, mode_id: &str) -> AcpResult<()> {
        let Some(sdk_client) = &self.sdk_client else {
            return Ok(());
        };

        sdk_client
            .lock()
            .await
            .set_permission_mode(claude_permission_mode_name(map_to_claude_permission_mode(mode_id)))
            .await
            .map_err(|error| AcpError::ProtocolError(error.to_string()))
    }

    async fn apply_runtime_model(&self, model_id: &str) -> AcpResult<()> {
        let Some(sdk_client) = &self.sdk_client else {
            return Ok(());
        };

        sdk_client
            .lock()
            .await
            .set_model(Some(model_id.to_string()))
            .await
            .map_err(|error| AcpError::ProtocolError(error.to_string()))
    }
}

fn provider_models(provider: &dyn AgentProvider) -> Vec<AvailableModel> {
    provider
        .default_model_candidates()
        .into_iter()
        .map(|candidate| AvailableModel {
            model_id: candidate.model_id,
            name: candidate.name,
            description: candidate.description,
        })
        .collect()
}

fn map_to_claude_permission_mode(mode_id: &str) -> cc_sdk::PermissionMode {
    match mode_id {
        "plan" => cc_sdk::PermissionMode::Plan,
        _ => cc_sdk::PermissionMode::Default,
    }
}

fn claude_permission_mode_name(mode: cc_sdk::PermissionMode) -> &'static str {
    match mode {
        cc_sdk::PermissionMode::Plan => "plan",
        cc_sdk::PermissionMode::AcceptEdits => "acceptEdits",
        cc_sdk::PermissionMode::BypassPermissions => "bypassPermissions",
        cc_sdk::PermissionMode::Default => "default",
    }
}

// ---------------------------------------------------------------------------
// Streaming bridge
// ---------------------------------------------------------------------------

async fn run_streaming_bridge(
    mut stream: impl futures::Stream<Item = cc_sdk::Result<cc_sdk::Message>> + Unpin,
    session_id: String,
    dispatcher: AcpUiEventDispatcher,
    bridge: Arc<PermissionBridge>,
    tool_call_tracker: Arc<ToolCallIdTracker>,
    task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    provider: Arc<dyn AgentProvider>,
) {
    tracing::info!(session_id = %session_id, "cc-sdk bridge: started, waiting for messages...");
    let mut message_count: u64 = 0;
    let mut turn_stream_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
    let mut stream_tool_blocks: HashMap<u64, (String, String)> = HashMap::new();

    while let Some(result) = stream.next().await {
        match result {
            Ok(msg) => {
                message_count += 1;
                if let Ok(raw_json) = serde_json::to_value(&msg) {
                    log_streaming_event(&session_id, &raw_json);
                }
                if let cc_sdk::Message::StreamEvent { event, .. } = &msg {
                    if let Some(event_type) = event.get("type").and_then(|value| value.as_str()) {
                        if event_type == "content_block_start" {
                            if let Some(block) = event.get("content_block") {
                                let is_tool_use = block.get("type").and_then(|v| v.as_str()) == Some("tool_use");
                                if is_tool_use {
                                    let index = event.get("index").and_then(|v| v.as_u64());
                                    let id = block.get("id").and_then(|v| v.as_str());
                                    let name = block.get("name").and_then(|v| v.as_str());
                                    if let (Some(index), Some(id), Some(name)) = (index, id, name) {
                                        stream_tool_blocks.insert(index, (id.to_string(), name.to_string()));
                                    }
                                }
                            }
                        }
                        if event_type == "content_block_delta" {
                            if let Some(delta_type) = event
                                .get("delta")
                                .and_then(|delta| delta.get("type"))
                                .and_then(|value| value.as_str())
                            {
                                if delta_type == "text_delta" {
                                    turn_stream_state.saw_text_delta = true;
                                }
                                if delta_type == "thinking_delta" {
                                    turn_stream_state.saw_thinking_delta = true;
                                }
                                if delta_type == "input_json_delta" {
                                    let index = event.get("index").and_then(|v| v.as_u64());
                                    let partial_json = event
                                        .get("delta")
                                        .and_then(|delta| delta.get("partial_json"))
                                        .and_then(|value| value.as_str());
                                    if let (Some(index), Some(partial_json)) = (index, partial_json) {
                                        if let Some((tool_call_id, tool_name)) = stream_tool_blocks.get(&index) {
                                            let raw_update = RawToolCallUpdateInput {
                                                id: tool_call_id.clone(),
                                                status: None,
                                                result: None,
                                                content: None,
                                                title: None,
                                                locations: None,
                                                streaming_input_delta: Some(partial_json.to_string()),
                                                tool_name: Some(tool_name.clone()),
                                                raw_input: None,
                                                kind: None,
                                            };
                                            let parser = get_parser(AgentType::ClaudeCode);
                                            let update = with_agent(AgentType::ClaudeCode, || {
                                                build_tool_call_update_from_raw(
                                                    parser,
                                                    raw_update,
                                                    Some(session_id.as_str()),
                                                )
                                            });
                                            dispatch_cc_sdk_update(
                                                &dispatcher,
                                                &task_reconciler,
                                                provider.as_ref(),
                                                SessionUpdate::ToolCallUpdate {
                                                    update,
                                                    session_id: Some(session_id.clone()),
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        // Extract model from message_start event
                        if event_type == "message_start" {
                            if let Some(model) = event
                                .get("message")
                                .and_then(|m| m.get("model"))
                                .and_then(|v| v.as_str())
                            {
                                turn_stream_state.model_id = Some(model.to_string());
                            }
                        }
                        // Track tool_name → tool_use_id for the permission handler.
                        // content_block_start with type "tool_use" arrives on the
                        // stream BEFORE the CLI control channel fires can_use_tool.
                        if event_type == "content_block_start" {
                            if let Some(block) = event.get("content_block") {
                                let is_tool_use = block.get("type").and_then(|v| v.as_str()) == Some("tool_use");
                                if is_tool_use {
                                    if let (Some(id), Some(name)) = (
                                        block.get("id").and_then(|v| v.as_str()),
                                        block.get("name").and_then(|v| v.as_str()),
                                    ) {
                                        tool_call_tracker.record(name.to_string(), id.to_string()).await;
                                    }
                                }
                            }
                        }
                    }
                }
                // Extract model from Assistant message as fallback
                if let cc_sdk::Message::Assistant { message, .. } = &msg {
                    if let Some(model) = &message.model {
                        if turn_stream_state.model_id.is_none() {
                            turn_stream_state.model_id = Some(model.clone());
                        }
                    }
                }
                let msg_type = match &msg {
                    cc_sdk::Message::Assistant { .. } => "Assistant",
                    cc_sdk::Message::StreamEvent { .. } => "StreamEvent",
                    cc_sdk::Message::Result { ref usage, ref total_cost_usd, .. } => {
                        tracing::debug!(
                            session_id = %session_id,
                            usage = ?usage,
                            total_cost_usd = ?total_cost_usd,
                            "cc-sdk bridge: Result message raw data"
                        );
                        "Result"
                    }
                    cc_sdk::Message::User { .. } => "User",
                    cc_sdk::Message::System { subtype, ref data, .. } => {
                        tracing::debug!(
                            session_id = %session_id,
                            subtype = %subtype,
                            data = %data,
                            "cc-sdk bridge: System message"
                        );
                        "System"
                    }
                    cc_sdk::Message::RateLimit { .. } => "RateLimit",
                    cc_sdk::Message::Unknown { msg_type, ref raw, .. } => {
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

                let updates = crate::acp::parsers::cc_sdk_bridge::translate_cc_sdk_message_with_turn_state(
                    msg,
                    Some(session_id.clone()),
                    turn_stream_state.clone(),
                );
                tracing::info!(
                    session_id = %session_id,
                    update_count = updates.len(),
                    "cc-sdk bridge: translated to session updates"
                );
                for update in updates {
                    if matches!(update, SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }) {
                        // Reset per-turn stream state but preserve model_id across turns
                        let preserved_model = turn_stream_state.model_id.clone();
                        turn_stream_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
                        turn_stream_state.model_id = preserved_model;
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

    // Deny any pending permission requests so callers are not left waiting.
    bridge.drain_all_as_denied().await;
}

fn collect_cc_sdk_updates_for_dispatch(
    update: &SessionUpdate,
    task_reconciler: &Arc<std::sync::Mutex<TaskReconciler>>,
    agent_type: AgentType,
    provider: Option<&dyn AgentProvider>,
) -> Vec<SessionUpdate> {
    process_through_reconciler(update, task_reconciler, agent_type, provider)
}

fn dispatch_cc_sdk_update(
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

// ---------------------------------------------------------------------------
// AgentClient trait implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl AgentClient for CcSdkClaudeClient {
    async fn start(&mut self) -> AcpResult<()> {
        // cc-sdk resolves the claude CLI path internally.
        // Any failure will surface at connect() time with a clear error.
        Ok(())
    }

    async fn initialize(&mut self) -> AcpResult<InitializeResponse> {
        Ok(InitializeResponse {
            protocol_version: 1,
            agent_capabilities: serde_json::json!({}),
            agent_info: serde_json::json!({ "name": "Claude Code", "version": "cc-sdk" }),
            auth_methods: vec![],
        })
    }

    async fn new_session(&mut self, cwd: String) -> AcpResult<NewSessionResponse> {
        let session_id = Uuid::new_v4().to_string();
        self.reset_stream_runtime_state();
        let options = self.build_options(&cwd, &session_id, None, false);
        // Defer connection until the first send_prompt so the initial user
        // message is passed to connect() and the CLI starts processing it
        // immediately (avoids an empty Result before any content).
        self.pending_options = Some(options);
        self.session_id = Some(session_id.clone());
        let models = self.hydrated_session_model_state().await;
        tracing::info!(
            session_id = %session_id,
            provider = %self.provider.id(),
            available_model_ids = ?models
                .available_models
                .iter()
                .map(|model| model.model_id.clone())
                .collect::<Vec<_>>(),
            "cc-sdk new_session returning models"
        );
        Ok(NewSessionResponse {
            session_id,
            models,
            modes: default_modes(),
            available_commands: vec![],
            config_options: vec![],
        })
    }

    async fn resume_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        self.reset_stream_runtime_state();
        if !self.session_has_persisted_history(&session_id, &cwd).await {
            let options = self.build_options(&cwd, &session_id, None, false);
            self.pending_options = Some(options);
            self.session_id = Some(session_id.clone());
            let models = self.hydrated_session_model_state().await;
            tracing::info!(
                session_id = %session_id,
                provider = %self.provider.id(),
                available_model_ids = ?models
                    .available_models
                    .iter()
                    .map(|model| model.model_id.clone())
                    .collect::<Vec<_>>(),
                "cc-sdk resume_session restored created session without CLI resume"
            );
            return Ok(ResumeSessionResponse {
                models,
                modes: default_modes(),
                available_commands: vec![],
                config_options: vec![],
            });
        }

        self.pending_options = Some(self.build_options(&cwd, &session_id, Some(session_id.clone()), false));
        let models = self.hydrated_session_model_state().await;
        self.pending_options = None;
        tracing::info!(
            session_id = %session_id,
            provider = %self.provider.id(),
            available_model_ids = ?models
                .available_models
                .iter()
                .map(|model| model.model_id.clone())
                .collect::<Vec<_>>(),
            "cc-sdk resume_session returning models"
        );
        let options = self.build_options(&cwd, &session_id, Some(session_id.clone()), false);
        self.connect_and_start_bridge(options, session_id, None).await?;
        Ok(ResumeSessionResponse {
            models,
            modes: default_modes(),
            available_commands: vec![],
            config_options: vec![],
        })
    }

    async fn fork_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<NewSessionResponse> {
        let new_session_id = Uuid::new_v4().to_string();
        self.reset_stream_runtime_state();
        self.pending_options = Some(self.build_options(&cwd, &new_session_id, Some(session_id.clone()), true));
        let models = self.hydrated_session_model_state().await;
        self.pending_options = None;
        tracing::info!(
            session_id = %new_session_id,
            provider = %self.provider.id(),
            available_model_ids = ?models
                .available_models
                .iter()
                .map(|model| model.model_id.clone())
                .collect::<Vec<_>>(),
            "cc-sdk fork_session returning models"
        );
        let options = self.build_options(&cwd, &new_session_id, Some(session_id), true);
        self.connect_and_start_bridge(options, new_session_id.clone(), None)
            .await?;
        Ok(NewSessionResponse {
            session_id: new_session_id,
            models,
            modes: default_modes(),
            available_commands: vec![],
            config_options: vec![],
        })
    }

    async fn set_session_model(&mut self, _session_id: String, _model_id: String) -> AcpResult<()> {
        self.pending_model_id = Some(_model_id.clone());
        self.apply_runtime_model(&_model_id).await?;
        Ok(())
    }

    async fn set_session_mode(&mut self, _session_id: String, _mode_id: String) -> AcpResult<()> {
        self.pending_mode_id = Some(_mode_id.clone());
        self.apply_runtime_mode(&_mode_id).await?;
        Ok(())
    }

    async fn send_prompt(&mut self, request: PromptRequest) -> AcpResult<Value> {
        self.send_prompt_fire_and_forget(request).await?;
        Ok(Value::Null)
    }

    async fn send_prompt_fire_and_forget(&mut self, request: PromptRequest) -> AcpResult<()> {
        // Concatenate all text blocks into a single prompt string.
        let text: String = request
            .prompt
            .iter()
            .filter_map(|block| {
                if let ContentBlock::Text { text } = block {
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");

        let text_len = text.len();

        // If we have pending options, this is the first prompt — connect now
        // with the user's message so the CLI starts processing immediately.
        if let Some(options) = self.pending_options.take() {
            let session_id = self.session_id.clone().unwrap_or_default();
            tracing::info!(
                session_id = %session_id,
                prompt_len = text_len,
                "cc-sdk: first prompt — connecting with initial message..."
            );
            self.connect_and_start_bridge(options, session_id, Some(text))
                .await?;
            tracing::info!(session_id = ?self.session_id, "cc-sdk: connected with initial prompt");
            return Ok(());
        }

        // Subsequent prompts: send via the existing client.
        let sdk_client = self.sdk_client.as_ref().ok_or_else(|| {
            AcpError::InvalidState(
                "cc-sdk client not connected; call new_session or resume_session first"
                    .to_string(),
            )
        })?;

        tracing::info!(
            session_id = ?self.session_id,
            prompt_len = text_len,
            "cc-sdk: sending user message via send_user_message..."
        );

        sdk_client
            .lock()
            .await
            .send_user_message(text)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "cc-sdk: send_user_message failed");
                AcpError::ProtocolError(e.to_string())
            })?;

        tracing::info!(session_id = ?self.session_id, "cc-sdk: send_user_message completed");
        Ok(())
    }

    async fn cancel(&mut self, _session_id: String) -> AcpResult<()> {
        if let Some(sdk_client) = &self.sdk_client {
            // Ignore interrupt errors — the session may already be idle.
            let _ = sdk_client.lock().await.interrupt().await;
        }
        Ok(())
    }

    async fn list_sessions(&mut self, _cwd: Option<String>) -> AcpResult<ListSessionsResponse> {
        Ok(ListSessionsResponse {
            sessions: vec![],
            next_cursor: None,
        })
    }

    async fn respond(&self, request_id: u64, result: Value) -> AcpResult<()> {
        // The frontend sends: { outcome: { outcome: "selected"|"cancelled", optionId } }
        // "selected" with optionId "allow" means the user approved.
        let allow = result
            .get("outcome")
            .and_then(|o| o.get("outcome"))
            .and_then(Value::as_str)
            .map(|s| s == "selected")
            .unwrap_or(false);
        self.permission_bridge.resolve(request_id, allow).await;
        Ok(())
    }

    fn stop(&mut self) {
        self.stop_bridge();
        // Drop the Arc — once no other holders remain the client cleans up the subprocess.
        self.sdk_client = None;
        self.session_id = None;
        self.reset_stream_runtime_state();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cc_sdk::CanUseTool;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};

    fn make_task_tool_call(id: &str) -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: id.to_string(),
                name: "Agent".to_string(),
                arguments: ToolArguments::Other {
                    raw: serde_json::Value::Null,
                },
                status: ToolCallStatus::InProgress,
                result: None,
                kind: Some(ToolKind::Task),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn make_enriched_task_tool_call(id: &str) -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: id.to_string(),
                name: "Agent".to_string(),
                arguments: ToolArguments::Think {
                    description: Some("Find all tool call components".to_string()),
                    prompt: Some("Inventory tool call cards in the codebase".to_string()),
                    subagent_type: Some("Explore".to_string()),
                    skill: None,
                    skill_args: None,
                    raw: Some(serde_json::json!({
                        "description": "Find all tool call components",
                        "prompt": "Inventory tool call cards in the codebase",
                        "subagent_type": "Explore"
                    })),
                },
                status: ToolCallStatus::InProgress,
                result: None,
                kind: Some(ToolKind::Task),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn make_child_tool_call(id: &str, name: &str, kind: ToolKind) -> SessionUpdate {
        let arguments = match kind {
            ToolKind::Execute => ToolArguments::Execute {
                command: Some("ls -1".to_string()),
            },
            ToolKind::Glob => ToolArguments::Glob {
                pattern: Some("**/*.svelte".to_string()),
                path: Some("/tmp/project".to_string()),
            },
            ToolKind::Read => ToolArguments::Read {
                file_path: Some("/tmp/project/file.svelte".to_string()),
            },
            _ => panic!("unsupported child kind in test"),
        };

        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: id.to_string(),
                name: name.to_string(),
                arguments,
                status: ToolCallStatus::InProgress,
                result: None,
                kind: Some(kind),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                parent_tool_use_id: Some("toolu_task_parent".to_string()),
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn make_test_client() -> CcSdkClaudeClient {
        CcSdkClaudeClient {
            provider: Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider),
            sdk_client: None,
            session_id: None,
            permission_bridge: Arc::new(PermissionBridge::new()),
            tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
            task_reconciler: Arc::new(std::sync::Mutex::new(
                crate::acp::task_reconciler::TaskReconciler::new(),
            )),
            bridge_task: None,
            dispatcher: AcpUiEventDispatcher::new(None, DispatchPolicy::default()),
            pending_options: None,
            pending_mode_id: None,
            pending_model_id: None,
        }
    }

    #[test]
    fn cc_sdk_sessions_request_partial_messages() {
        let options = cc_sdk::ClaudeCodeOptions::builder()
            .cwd(PathBuf::from("/tmp"))
            .include_partial_messages(true)
            .build();

        assert!(options.include_partial_messages);
    }

    #[test]
    fn build_options_applies_pending_mode_and_model() {
        let mut client = make_test_client();
        client.pending_mode_id = Some("plan".to_string());
        client.pending_model_id = Some("claude-opus-4-6".to_string());

        let options = client.build_options("/tmp", "session-1", None, false);

        assert!(options.include_partial_messages);
        assert_eq!(options.model.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(options.permission_mode, cc_sdk::PermissionMode::Plan);
        assert_eq!(options.session_id.as_deref(), Some("session-1"));
    }

    #[test]
    fn build_options_applies_resume_and_fork_flags() {
        let client = make_test_client();

        let options = client.build_options("/tmp", "session-1", Some("resume-1".to_string()), true);

        assert_eq!(options.resume.as_deref(), Some("resume-1"));
        assert!(options.fork_session);
    }

    // --- PermissionBridge tests ---

    #[test]
    fn permission_bridge_next_id_is_sequential() {
        let bridge = PermissionBridge::new();
        let id1 = bridge.next_id();
        let id2 = bridge.next_id();
        let id3 = bridge.next_id();
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
    }

    #[test]
    fn permission_bridge_ids_stay_in_js_safe_range() {
        let bridge = PermissionBridge::new();
        // JS safe integer max is 2^53 - 1.  Sequential IDs starting at 1 will
        // never overflow in practice, but verify the first few are in range.
        for _ in 0..100 {
            let id = bridge.next_id();
            assert!(id < (1u64 << 53), "ID {id} exceeds JS safe integer range");
        }
    }

    // --- respond() outcome-shape parsing tests ---

    #[tokio::test]
    async fn respond_selected_resolves_true() {
        let client = make_test_client();
        let id = client.permission_bridge.next_id();
        let rx = client.permission_bridge.register(id).await;

        let result = serde_json::json!({
            "outcome": { "outcome": "selected", "optionId": "allow" }
        });
        client.respond(id, result).await.expect("respond failed");

        let allow = rx.await.expect("channel closed");
        assert!(allow, "expected allow=true for outcome=selected");
    }

    #[tokio::test]
    async fn respond_cancelled_resolves_false() {
        let client = make_test_client();
        let id = client.permission_bridge.next_id();
        let rx = client.permission_bridge.register(id).await;

        let result = serde_json::json!({
            "outcome": { "outcome": "cancelled", "optionId": "reject" }
        });
        client.respond(id, result).await.expect("respond failed");

        let allow = rx.await.expect("channel closed");
        assert!(!allow, "expected allow=false for outcome=cancelled");
    }

    #[tokio::test]
    async fn respond_missing_outcome_resolves_false() {
        let client = make_test_client();
        let id = client.permission_bridge.next_id();
        let rx = client.permission_bridge.register(id).await;

        // Old shape (bare "allow" field) must now yield false, not panic.
        let result = serde_json::json!({ "allow": true });
        client.respond(id, result).await.expect("respond failed");

        let allow = rx.await.expect("channel closed");
        assert!(!allow, "expected allow=false when outcome field is absent");
    }

    // --- permission_json shape test ---

    /// Verify that the JSON emitted by can_use_tool matches the JsonRpcRequestSchema
    /// expected by the TypeScript frontend.
    #[test]
    fn permission_json_shape_matches_frontend_schema() {
        let request_id: u64 = 42;
        let tool_name = "Bash";
        let input = serde_json::json!({ "command": "ls" });
        let session_id = "test-session";

        let tool_call_id = format!("cc-sdk-{}", request_id);
        let permission_json = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "session/request_permission",
            "params": {
                "sessionId": session_id,
                "options": [
                    { "kind": "allow", "name": "Allow once", "optionId": "allow" },
                    { "kind": "reject", "name": "Reject", "optionId": "reject" }
                ],
                "toolCall": {
                    "toolCallId": tool_call_id,
                    "name": tool_name,
                    "title": tool_name,
                    "rawInput": input,
                }
            }
        });

        // Top-level JSON-RPC envelope fields
        assert_eq!(permission_json["jsonrpc"], "2.0");
        assert_eq!(permission_json["id"], 42u64);
        assert_eq!(permission_json["method"], "session/request_permission");

        // params fields
        let params = &permission_json["params"];
        assert_eq!(params["sessionId"], "test-session");
        assert!(params["options"].is_array());
        assert_eq!(params["options"].as_array().unwrap().len(), 2);

        // toolCall fields
        let tool_call = &params["toolCall"];
        assert_eq!(tool_call["toolCallId"], "cc-sdk-42");
        assert_eq!(tool_call["name"], "Bash");
        assert_eq!(tool_call["title"], "Bash");
        assert_eq!(tool_call["rawInput"]["command"], "ls");
    }

    #[tokio::test]
    async fn tool_call_tracker_returns_stream_tool_use_id_in_fifo_order() {
        let tracker = ToolCallIdTracker::new();

        tracker
            .record("Bash".to_string(), "toolu_first".to_string())
            .await;
        tracker
            .record("Bash".to_string(), "toolu_second".to_string())
            .await;

        assert_eq!(tracker.take("Bash").await.as_deref(), Some("toolu_first"));
        assert_eq!(tracker.take("Bash").await.as_deref(), Some("toolu_second"));
        assert_eq!(tracker.take("Bash").await, None);
    }

    #[tokio::test]
    async fn can_use_tool_emits_inbound_request_with_tracked_tool_use_id() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let bridge = Arc::new(PermissionBridge::new());
        let tracker = Arc::new(ToolCallIdTracker::new());
        tracker
            .record("Bash".to_string(), "toolu_tracked_123".to_string())
            .await;

        let handler = AcepePermissionHandler {
            session_id: "session-1".to_string(),
            bridge: bridge.clone(),
            dispatcher,
            tool_call_tracker: tracker,
        };

        let resolver_bridge = bridge.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            resolver_bridge.resolve(1, true).await;
        });

        let context = cc_sdk::ToolPermissionContext {
            signal: None,
            suggestions: Vec::new(),
        };

        let result = handler
            .can_use_tool("Bash", &serde_json::json!({ "command": "echo ok" }), &context)
            .await;

        assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));

        let captured = sink.lock().expect("sink lock");
        assert_eq!(captured.len(), 1);
        let event = &captured[0];
        assert_eq!(event.event_name, "acp-inbound-request");
        let payload = match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::Json(value) => value,
            other => panic!("expected json payload, got {:?}", other),
        };
        assert_eq!(payload["params"]["sessionId"], "session-1");
        assert_eq!(payload["params"]["toolCall"]["toolCallId"], "toolu_tracked_123");
        assert_eq!(payload["params"]["toolCall"]["name"], "Bash");
    }

    #[tokio::test]
    async fn can_use_tool_falls_back_to_synthetic_id_when_tracker_is_empty() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let bridge = Arc::new(PermissionBridge::new());

        let handler = AcepePermissionHandler {
            session_id: "session-2".to_string(),
            bridge: bridge.clone(),
            dispatcher,
            tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        };

        let resolver_bridge = bridge.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            resolver_bridge.resolve(1, false).await;
        });

        let context = cc_sdk::ToolPermissionContext {
            signal: None,
            suggestions: Vec::new(),
        };

        let result = handler
            .can_use_tool("Bash", &serde_json::json!({ "command": "echo ok" }), &context)
            .await;

        assert!(matches!(result, cc_sdk::PermissionResult::Deny(_)));

        let captured = sink.lock().expect("sink lock");
        assert_eq!(captured.len(), 1);
        let event = &captured[0];
        let payload = match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::Json(value) => value,
            other => panic!("expected json payload, got {:?}", other),
        };
        assert_eq!(payload["params"]["toolCall"]["toolCallId"], "cc-sdk-1");
    }

    #[test]
    fn reconciles_cc_sdk_subagent_children_under_parent_task() {
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        let task_reconciler = Arc::new(std::sync::Mutex::new(
            crate::acp::task_reconciler::TaskReconciler::new(),
        ));

        let parent_outputs = collect_cc_sdk_updates_for_dispatch(
            &make_task_tool_call("toolu_task_parent"),
            &task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );
        let enriched_outputs = collect_cc_sdk_updates_for_dispatch(
            &make_enriched_task_tool_call("toolu_task_parent"),
            &task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );
        let bash_outputs = collect_cc_sdk_updates_for_dispatch(
            &make_child_tool_call("toolu_child_bash", "Bash", ToolKind::Execute),
            &task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );
        let glob_outputs = collect_cc_sdk_updates_for_dispatch(
            &make_child_tool_call("toolu_child_glob", "Glob", ToolKind::Glob),
            &task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );
        let read_outputs = collect_cc_sdk_updates_for_dispatch(
            &make_child_tool_call("toolu_child_read", "Read", ToolKind::Read),
            &task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );

        assert_eq!(parent_outputs.len(), 1);
        assert_eq!(enriched_outputs.len(), 1);
        assert_eq!(bash_outputs.len(), 1);
        assert_eq!(glob_outputs.len(), 1);
        assert_eq!(read_outputs.len(), 1);

        let final_parent = read_outputs
            .iter()
            .find_map(|update| match update {
                SessionUpdate::ToolCall { tool_call, .. } => Some(tool_call),
                _ => None,
            })
            .expect("expected reconciled parent tool call");

        let task_children = final_parent
            .task_children
            .as_ref()
            .expect("expected task children on parent task");
        assert_eq!(task_children.len(), 3);
        assert_eq!(task_children[0].id, "toolu_child_bash");
        assert_eq!(task_children[1].id, "toolu_child_glob");
        assert_eq!(task_children[2].id, "toolu_child_read");

        match &final_parent.arguments {
            ToolArguments::Think {
                description,
                prompt,
                subagent_type,
                ..
            } => {
                assert_eq!(description.as_deref(), Some("Find all tool call components"));
                assert_eq!(prompt.as_deref(), Some("Inventory tool call cards in the codebase"));
                assert_eq!(subagent_type.as_deref(), Some("Explore"));
            }
            other => panic!("expected think arguments, got {:?}", other),
        }
    }

    #[test]
    fn passes_through_non_task_cc_sdk_tool_calls_without_task_children() {
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        let task_reconciler = Arc::new(std::sync::Mutex::new(
            crate::acp::task_reconciler::TaskReconciler::new(),
        ));

        let outputs = collect_cc_sdk_updates_for_dispatch(
            &SessionUpdate::ToolCall {
                tool_call: ToolCallData {
                    id: "toolu_standalone_read".to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Read {
                        file_path: Some("/tmp/file.rs".to_string()),
                    },
                    status: ToolCallStatus::InProgress,
                    result: None,
                    kind: Some(ToolKind::Read),
                    title: None,
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                session_id: Some("session-1".to_string()),
            },
            &task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );

        assert_eq!(outputs.len(), 1);
        let tool_call = match &outputs[0] {
            SessionUpdate::ToolCall { tool_call, .. } => tool_call,
            other => panic!("expected tool call output, got {:?}", other),
        };
        assert!(tool_call.task_children.is_none());
        assert_eq!(tool_call.kind, Some(ToolKind::Read));
    }

    #[test]
    fn dispatch_cc_sdk_update_emits_single_passthrough_event_for_non_task_tools() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        let task_reconciler = Arc::new(std::sync::Mutex::new(
            crate::acp::task_reconciler::TaskReconciler::new(),
        ));

        dispatch_cc_sdk_update(
            &dispatcher,
            &task_reconciler,
            &provider,
            SessionUpdate::ToolCall {
                tool_call: ToolCallData {
                    id: "toolu_single_emit".to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Read {
                        file_path: Some("/tmp/file.rs".to_string()),
                    },
                    status: ToolCallStatus::InProgress,
                    result: None,
                    kind: Some(ToolKind::Read),
                    title: None,
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                session_id: Some("session-1".to_string()),
            },
        );

        let captured = sink.lock().expect("sink lock");
        assert_eq!(captured.len(), 1);
        let event = &captured[0];
        let update = match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
            other => panic!("expected session update payload, got {:?}", other),
        };
        match update.as_ref() {
            SessionUpdate::ToolCall { tool_call, .. } => {
                assert_eq!(tool_call.id, "toolu_single_emit");
                assert!(tool_call.task_children.is_none());
            }
            other => panic!("expected tool call update, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn reset_stream_runtime_state_clears_tracker_and_reconciler() {
        let mut client = make_test_client();

        client
            .tool_call_tracker
            .record("Bash".to_string(), "toolu_old".to_string())
            .await;

        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        let _ = collect_cc_sdk_updates_for_dispatch(
            &make_task_tool_call("toolu_task_parent"),
            &client.task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );
        let child_outputs = collect_cc_sdk_updates_for_dispatch(
            &make_child_tool_call("toolu_child_orphan", "Bash", ToolKind::Execute),
            &client.task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );

        assert!(matches!(
            &child_outputs[0],
            SessionUpdate::ToolCall { tool_call, .. } if tool_call.id == "toolu_task_parent"
        ));

        client.reset_stream_runtime_state();

        assert!(client.tool_call_tracker.take("Bash").await.is_none());

        let outputs_after_reset = collect_cc_sdk_updates_for_dispatch(
            &SessionUpdate::ToolCallUpdate {
                update: crate::acp::session_update::ToolCallUpdateData {
                    tool_call_id: "toolu_child_orphan".to_string(),
                    status: Some(ToolCallStatus::Completed),
                    result: Some(serde_json::json!({"ok": true})),
                    title: None,
                    content: None,
                    streaming_input_delta: None,
                    streaming_arguments: None,
                    streaming_plan: None,
                    raw_output: None,
                    locations: None,
                    arguments: None,
                    failure_reason: None,
                    normalized_questions: None,
                    normalized_todos: None,
                },
                session_id: Some("session-1".to_string()),
            },
            &client.task_reconciler,
            provider.parser_agent_type(),
            Some(&provider),
        );

        assert_eq!(outputs_after_reset.len(), 1);
        match &outputs_after_reset[0] {
            SessionUpdate::ToolCallUpdate { update, .. } => {
                assert_eq!(update.tool_call_id, "toolu_child_orphan");
            }
            other => panic!("expected passthrough tool call update, got {:?}", other),
        }
    }

    #[test]
    fn translated_cc_sdk_stream_sequence_emits_parent_with_task_children() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        let task_reconciler = Arc::new(std::sync::Mutex::new(
            crate::acp::task_reconciler::TaskReconciler::new(),
        ));
        let mut turn_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();

        let messages = vec![
            cc_sdk::Message::StreamEvent {
                uuid: "msg-parent-start".to_string(),
                session_id: "session-1".to_string(),
                event: serde_json::json!({
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {
                        "type": "tool_use",
                        "id": "toolu_task_parent",
                        "name": "Agent",
                        "input": {}
                    }
                }),
                parent_tool_use_id: None,
            },
            cc_sdk::Message::Assistant {
                message: cc_sdk::AssistantMessage {
                    content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                        id: "toolu_task_parent".to_string(),
                        name: "Agent".to_string(),
                        input: serde_json::json!({
                            "description": "Find all tool call components",
                            "prompt": "Inventory tool call cards in the codebase",
                            "subagent_type": "Explore"
                        }),
                    })],
                    model: Some("claude-opus-4-6".to_string()),
                    usage: None,
                    error: None,
                    parent_tool_use_id: None,
                },
            },
            cc_sdk::Message::Assistant {
                message: cc_sdk::AssistantMessage {
                    content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                        id: "toolu_child_bash".to_string(),
                        name: "Bash".to_string(),
                        input: serde_json::json!({"command": "ls -1"}),
                    })],
                    model: Some("claude-haiku-4-5-20251001".to_string()),
                    usage: None,
                    error: None,
                    parent_tool_use_id: Some("toolu_task_parent".to_string()),
                },
            },
            cc_sdk::Message::Assistant {
                message: cc_sdk::AssistantMessage {
                    content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                        id: "toolu_child_read".to_string(),
                        name: "Read".to_string(),
                        input: serde_json::json!({"file_path": "/tmp/project/file.svelte"}),
                    })],
                    model: Some("claude-haiku-4-5-20251001".to_string()),
                    usage: None,
                    error: None,
                    parent_tool_use_id: Some("toolu_task_parent".to_string()),
                },
            },
        ];

        for message in messages {
            let updates = crate::acp::parsers::cc_sdk_bridge::translate_cc_sdk_message_with_turn_state(
                message,
                Some("session-1".to_string()),
                turn_state.clone(),
            );

            for update in updates {
                if matches!(update, SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }) {
                    let preserved_model = turn_state.model_id.clone();
                    turn_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
                    turn_state.model_id = preserved_model;
                }
                dispatch_cc_sdk_update(&dispatcher, &task_reconciler, &provider, update);
            }
        }

        let captured = sink.lock().expect("sink lock");
        let final_parent = captured
            .iter()
            .rev()
            .find_map(|event| match &event.payload {
                crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
                    match update.as_ref() {
                        SessionUpdate::ToolCall { tool_call, .. } if tool_call.id == "toolu_task_parent" => {
                            Some(tool_call)
                        }
                        _ => None,
                    }
                }
                _ => None,
            })
            .expect("expected parent task in captured session updates");

        let task_children = final_parent
            .task_children
            .as_ref()
            .expect("expected task children on final parent task");
        assert_eq!(task_children.len(), 2);
        assert_eq!(task_children[0].id, "toolu_child_bash");
        assert_eq!(task_children[1].id, "toolu_child_read");

        match &final_parent.arguments {
            ToolArguments::Think {
                description,
                prompt,
                subagent_type,
                ..
            } => {
                assert_eq!(description.as_deref(), Some("Find all tool call components"));
                assert_eq!(prompt.as_deref(), Some("Inventory tool call cards in the codebase"));
                assert_eq!(subagent_type.as_deref(), Some("Explore"));
            }
            other => panic!("expected think arguments, got {:?}", other),
        }
    }

}
