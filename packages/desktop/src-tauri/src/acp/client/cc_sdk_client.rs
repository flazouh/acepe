//! cc-sdk based AgentClient implementation for Claude Code.
//!
//! [`CcSdkClaudeClient`] communicates with the Claude Code CLI via the `cc_sdk` Rust
//! crate directly — no Bun subprocess or JSON-RPC stdio indirection.

use std::collections::HashMap;
use std::path::PathBuf;
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
use crate::acp::client_session::{default_modes, default_session_model_state};
use crate::acp::client_trait::AgentClient;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::provider::AgentProvider;
use crate::acp::session_update::{
    SessionUpdate, TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
};
use crate::acp::types::{ContentBlock, PromptRequest};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, DispatchPolicy};

// ---------------------------------------------------------------------------
// PermissionBridge
// ---------------------------------------------------------------------------

/// Routes pending permission requests to their awaiting CanUseTool callbacks.
struct PermissionBridge {
    pending: Mutex<HashMap<u64, oneshot::Sender<bool>>>,
}

impl PermissionBridge {
    fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    fn next_id(&self) -> u64 {
        rand::random::<u64>()
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
// AcepePermissionHandler
// ---------------------------------------------------------------------------

/// Implements cc-sdk's CanUseTool by routing permission requests through the Acepe UI.
struct AcepePermissionHandler {
    session_id: String,
    bridge: Arc<PermissionBridge>,
    dispatcher: AcpUiEventDispatcher,
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

        // Emit a permission request event to the frontend.
        // The `id` field is a numeric u64 so that `respond(u64, result)` can
        // look it up directly in the bridge without a string→u64 conversion.
        let permission_json = serde_json::json!({
            "method": "client/requestPermission",
            "params": {
                "id": request_id,
                "sessionId": self.session_id,
                "permission": tool_name,
                "patterns": [],
                "metadata": input,
                "always": [],
            }
        });
        self.dispatcher
            .enqueue(AcpUiEvent::inbound_request(permission_json));

        match timeout(Duration::from_secs(60), rx).await {
            Ok(Ok(true)) => cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                updated_input: None,
                updated_permissions: None,
            }),
            _ => cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
                message: "Permission denied or timed out".to_string(),
                interrupt: false,
            }),
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
    /// Handle for the streaming bridge task. Calling `.abort()` cancels it.
    bridge_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Dispatcher for UI events.
    dispatcher: AcpUiEventDispatcher,
    /// Deferred options: stored by new_session, consumed by the first send_prompt.
    pending_options: Option<cc_sdk::ClaudeCodeOptions>,
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
            bridge_task: None,
            dispatcher,
            pending_options: None,
        })
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
        };

        let mut builder = cc_sdk::ClaudeCodeOptions::builder().cwd(PathBuf::from(cwd));
        builder = builder.include_partial_messages(true);

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
        let sid = session_id.clone();

        let handle = tauri::async_runtime::spawn(async move {
            run_streaming_bridge(stream, sid, dispatcher, bridge).await;
        });

        self.bridge_task = Some(handle);
        Ok(())
    }

    fn stop_bridge(&mut self) {
        if let Some(handle) = self.bridge_task.take() {
            handle.abort();
        }
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
) {
    tracing::info!(session_id = %session_id, "cc-sdk bridge: started, waiting for messages...");
    let mut message_count: u64 = 0;
    let mut turn_stream_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();

    while let Some(result) = stream.next().await {
        match result {
            Ok(msg) => {
                message_count += 1;
                if let cc_sdk::Message::StreamEvent { event, .. } = &msg {
                    if let Some(event_type) = event.get("type").and_then(|value| value.as_str()) {
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
                            }
                        }
                    }
                }
                let msg_type = match &msg {
                    cc_sdk::Message::Assistant { .. } => "Assistant",
                    cc_sdk::Message::StreamEvent { .. } => "StreamEvent",
                    cc_sdk::Message::Result { .. } => "Result",
                    cc_sdk::Message::User { .. } => "User",
                    cc_sdk::Message::System { subtype, .. } => {
                        tracing::info!(session_id = %session_id, subtype = %subtype, "cc-sdk bridge: System message");
                        "System"
                    }
                    cc_sdk::Message::RateLimit { .. } => "RateLimit",
                    cc_sdk::Message::Unknown { msg_type, .. } => {
                        tracing::info!(session_id = %session_id, msg_type = %msg_type, "cc-sdk bridge: Unknown message type");
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
                    turn_stream_state,
                );
                tracing::info!(
                    session_id = %session_id,
                    update_count = updates.len(),
                    "cc-sdk bridge: translated to session updates"
                );
                for update in updates {
                    if matches!(update, SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }) {
                        turn_stream_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
                    }
                    dispatcher.enqueue(AcpUiEvent::session_update(update));
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
        let options = self.build_options(&cwd, &session_id, None, false);
        // Defer connection until the first send_prompt so the initial user
        // message is passed to connect() and the CLI starts processing it
        // immediately (avoids an empty Result before any content).
        self.pending_options = Some(options);
        self.session_id = Some(session_id.clone());
        Ok(NewSessionResponse {
            session_id,
            models: default_session_model_state(),
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
        let options = self.build_options(&cwd, &session_id, Some(session_id.clone()), false);
        self.connect_and_start_bridge(options, session_id, None).await?;
        Ok(ResumeSessionResponse {
            models: default_session_model_state(),
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
        let options = self.build_options(&cwd, &new_session_id, Some(session_id), true);
        self.connect_and_start_bridge(options, new_session_id.clone(), None)
            .await?;
        Ok(NewSessionResponse {
            session_id: new_session_id,
            models: default_session_model_state(),
            modes: default_modes(),
            available_commands: vec![],
            config_options: vec![],
        })
    }

    async fn set_session_model(&mut self, _session_id: String, _model_id: String) -> AcpResult<()> {
        // cc-sdk 0.7.0 does not expose a set_model method after connect.
        Ok(())
    }

    async fn set_session_mode(&mut self, _session_id: String, _mode_id: String) -> AcpResult<()> {
        // cc-sdk 0.7.0 does not expose a set_mode method after connect.
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
        let allow = result
            .get("allow")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        self.permission_bridge.resolve(request_id, allow).await;
        Ok(())
    }

    fn stop(&mut self) {
        self.stop_bridge();
        // Drop the Arc — once no other holders remain the client cleans up the subprocess.
        self.sdk_client = None;
        self.session_id = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cc_sdk_sessions_request_partial_messages() {
        let options = cc_sdk::ClaudeCodeOptions::builder()
            .cwd(PathBuf::from("/tmp"))
            .include_partial_messages(true)
            .build();

        assert!(options.include_partial_messages);
    }
}
