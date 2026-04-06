//! cc-sdk based AgentClient implementation for Claude Code.
//!
//! [`CcSdkClaudeClient`] communicates with the Claude Code CLI via the `cc_sdk` Rust
//! crate directly — no Bun subprocess or JSON-RPC stdio indirection.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use futures::StreamExt;
use sea_orm::DbConn;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};
use uuid::Uuid;

use crate::acp::agent_context::with_agent;
use crate::acp::client::{
    InitializeResponse, ListSessionsResponse, NewSessionResponse, ResumeSessionResponse,
};
use crate::acp::client_session::{
    apply_provider_model_fallback, default_modes, default_session_model_state, AvailableModel,
    SessionModelState,
};
use crate::acp::client_trait::AgentClient;
use crate::acp::client_updates::process_through_reconciler;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::model_display::get_transformer;
use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::provider::AgentProvider;
use crate::acp::session_update::{
    build_tool_call_update_from_raw, parse_normalized_questions, QuestionData, QuestionItem,
    RawToolCallUpdateInput, SessionUpdate, ToolCallStatus, ToolCallUpdateData, ToolReference,
    TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource,
};
use crate::acp::streaming_log::{log_debug_event, log_emitted_event, log_streaming_event};
use crate::acp::task_reconciler::TaskReconciler;
use crate::acp::types::{ContentBlock, PromptRequest};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, DispatchPolicy};

// ---------------------------------------------------------------------------
// PermissionBridge
// ---------------------------------------------------------------------------

/// Routes pending permission requests to their awaiting CanUseTool callbacks.
#[derive(Debug, Clone)]
enum PendingPermissionKind {
    Tool {
        tool_call_id: String,
        tool_name: String,
        permission_suggestions: Vec<cc_sdk::PermissionUpdate>,
    },
    Question {
        tool_call_id: String,
        original_input: Value,
    },
    Hook {
        tool_call_id: String,
        tool_name: String,
        original_input: Value,
        permission_suggestions: Vec<cc_sdk::PermissionUpdate>,
    },
}

impl PendingPermissionKind {
    fn tool_call_id(&self) -> &str {
        match self {
            Self::Tool { tool_call_id, .. }
            | Self::Question { tool_call_id, .. }
            | Self::Hook { tool_call_id, .. } => tool_call_id,
        }
    }

    fn approval_group_key(&self) -> Option<String> {
        match self {
            Self::Tool { tool_call_id, .. } | Self::Hook { tool_call_id, .. } => {
                Some(tool_call_id.clone())
            }
            Self::Question { .. } => None,
        }
    }

    fn is_question(&self) -> bool {
        matches!(self, Self::Question { .. })
    }
}

#[derive(Debug)]
struct PendingPermissionRequest {
    sender: PendingPermissionResponder,
    kind: PendingPermissionKind,
    approval_group_key: Option<String>,
}

#[derive(Debug)]
enum PendingPermissionResponder {
    Tool(oneshot::Sender<cc_sdk::PermissionResult>),
    Hook(oneshot::Sender<cc_sdk::HookJSONOutput>),
}

#[derive(Debug, Default)]
struct PermissionBridgeState {
    pending: HashMap<u64, PendingPermissionRequest>,
    approval_groups: HashMap<String, Vec<u64>>,
    resolved_approval_results: HashMap<String, Value>,
}

#[derive(Debug)]
struct PendingPermissionRegistration<T> {
    receiver: oneshot::Receiver<T>,
    should_emit_ui: bool,
}

struct PermissionBridge {
    state: Mutex<PermissionBridgeState>,
    /// Sequential counter kept within JS safe-integer range (< 2^53).
    counter: AtomicU64,
}

impl PermissionBridge {
    fn new() -> Self {
        Self {
            state: Mutex::new(PermissionBridgeState::default()),
            counter: AtomicU64::new(1),
        }
    }

    /// Returns a new unique request ID that is safe to represent as a JS number.
    fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::Relaxed)
    }

    async fn register(
        &self,
        id: u64,
        kind: PendingPermissionKind,
    ) -> PendingPermissionRegistration<cc_sdk::PermissionResult> {
        let (tx, rx) = oneshot::channel();
        self.register_pending_request(
            id,
            PendingPermissionRequest {
                sender: PendingPermissionResponder::Tool(tx),
                approval_group_key: kind.approval_group_key(),
                kind,
            },
            rx,
        )
        .await
    }

    async fn register_hook(
        &self,
        id: u64,
        kind: PendingPermissionKind,
    ) -> PendingPermissionRegistration<cc_sdk::HookJSONOutput> {
        let (tx, rx) = oneshot::channel();
        self.register_pending_request(
            id,
            PendingPermissionRequest {
                sender: PendingPermissionResponder::Hook(tx),
                approval_group_key: kind.approval_group_key(),
                kind,
            },
            rx,
        )
        .await
    }

    async fn register_pending_request<T>(
        &self,
        id: u64,
        pending_request: PendingPermissionRequest,
        receiver: oneshot::Receiver<T>,
    ) -> PendingPermissionRegistration<T> {
        let mut pending_request = Some(pending_request);
        let mut immediate_resolution = None;
        let mut state = self.state.lock().await;
        let should_emit_ui = if let Some(group_key) = pending_request
            .as_ref()
            .and_then(|request| request.approval_group_key.as_ref())
        {
            if let Some(resolved_result) = state.resolved_approval_results.get(group_key) {
                immediate_resolution = Some(resolved_result.clone());
                false
            } else if let Some(existing_request_ids) = state.approval_groups.get_mut(group_key) {
                existing_request_ids.push(id);
                state.pending.insert(
                    id,
                    pending_request
                        .take()
                        .expect("pending permission request should exist"),
                );
                false
            } else {
                state.approval_groups.insert(group_key.clone(), vec![id]);
                state.pending.insert(
                    id,
                    pending_request
                        .take()
                        .expect("pending permission request should exist"),
                );
                true
            }
        } else {
            state.pending.insert(
                id,
                pending_request
                    .take()
                    .expect("pending permission request should exist"),
            );
            true
        };

        drop(state);

        if let Some(result) = immediate_resolution {
            Self::resolve_pending_request_from_ui_result(
                pending_request.expect("pending permission request should exist"),
                &result,
            );
        }

        PendingPermissionRegistration {
            receiver,
            should_emit_ui,
        }
    }

    fn take_request_bundle(
        state: &mut PermissionBridgeState,
        id: u64,
    ) -> Option<Vec<PendingPermissionRequest>> {
        let pending_request = state.pending.remove(&id)?;
        let mut requests = vec![pending_request];

        if let Some(group_key) = requests[0].approval_group_key.clone() {
            if let Some(group_request_ids) = state.approval_groups.remove(&group_key) {
                for request_id in group_request_ids {
                    if request_id == id {
                        continue;
                    }
                    if let Some(sibling_request) = state.pending.remove(&request_id) {
                        requests.push(sibling_request);
                    }
                }
            }
        }

        Some(requests)
    }

    fn resolve_pending_request_from_ui_result(
        pending_request: PendingPermissionRequest,
        result: &Value,
    ) {
        match pending_request.sender {
            PendingPermissionResponder::Tool(sender) => {
                let permission_result =
                    permission_result_from_ui_result(&pending_request.kind, result);
                let _ = sender.send(permission_result);
            }
            PendingPermissionResponder::Hook(sender) => {
                let hook_output = hook_output_from_ui_result(&pending_request.kind, result);
                let _ = sender.send(hook_output);
            }
        }
    }

    #[cfg(test)]
    async fn resolve(&self, id: u64, result: cc_sdk::PermissionResult) {
        let pending = {
            let mut state = self.state.lock().await;
            Self::take_request_bundle(&mut state, id)
                .and_then(|mut requests| requests.drain(..1).next())
        };

        if let Some(pending) = pending {
            if let PendingPermissionResponder::Tool(sender) = pending.sender {
                let _ = sender.send(result);
            }
        }
    }

    async fn resolve_from_ui_result(
        &self,
        id: u64,
        result: &Value,
    ) -> Option<PendingPermissionKind> {
        let pending_requests = {
            let mut state = self.state.lock().await;
            let pending_requests = Self::take_request_bundle(&mut state, id)?;
            if let Some(group_key) = pending_requests[0].approval_group_key.clone() {
                state
                    .resolved_approval_results
                    .insert(group_key, result.clone());
            }
            pending_requests
        };
        let kind = pending_requests[0].kind.clone();

        for pending_request in pending_requests {
            Self::resolve_pending_request_from_ui_result(pending_request, result);
        }

        Some(kind)
    }

    async fn request_id_for_question_tool_call(&self, tool_call_id: &str) -> Option<u64> {
        let state = self.state.lock().await;
        state.pending.iter().find_map(|(request_id, request)| {
            if request.kind.is_question() && request.kind.tool_call_id() == tool_call_id {
                Some(*request_id)
            } else {
                None
            }
        })
    }

    async fn clear_request(&self, id: u64, message: &str) {
        let pending_requests = {
            let mut state = self.state.lock().await;
            Self::take_request_bundle(&mut state, id)
        };

        let Some(pending_requests) = pending_requests else {
            return;
        };

        for pending_request in pending_requests {
            match pending_request.sender {
                PendingPermissionResponder::Tool(sender) => {
                    let _ = sender.send(cc_sdk::PermissionResult::Deny(
                        cc_sdk::PermissionResultDeny {
                            message: message.to_string(),
                            interrupt: false,
                        },
                    ));
                }
                PendingPermissionResponder::Hook(sender) => {
                    let _ = sender.send(build_denied_hook_output(&pending_request.kind, message));
                }
            }
        }
    }

    async fn drain_all_as_denied(&self) {
        let pending_requests = {
            let mut state = self.state.lock().await;
            state.approval_groups.clear();
            state.resolved_approval_results.clear();
            state
                .pending
                .drain()
                .map(|(_, pending)| pending)
                .collect::<Vec<_>>()
        };

        for pending in pending_requests {
            match pending.sender {
                PendingPermissionResponder::Tool(sender) => {
                    let _ = sender.send(cc_sdk::PermissionResult::Deny(
                        cc_sdk::PermissionResultDeny {
                            message: "Permission denied or connection closed".to_string(),
                            interrupt: false,
                        },
                    ));
                }
                PendingPermissionResponder::Hook(sender) => {
                    let _ = sender.send(build_denied_hook_output(
                        &pending.kind,
                        "Permission denied or connection closed",
                    ));
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
struct PendingQuestionState {
    request_id: u64,
    session_id: String,
    questions: Option<Vec<QuestionItem>>,
    ui_emitted: bool,
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

#[derive(Debug, Clone)]
struct PendingApprovalCallbackDiagnostic {
    session_id: String,
    tool_name: String,
}

struct ApprovalCallbackTracker {
    pending: Mutex<HashMap<String, PendingApprovalCallbackDiagnostic>>,
}

impl ApprovalCallbackTracker {
    fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    async fn note_tool_use_started(&self, session_id: &str, tool_name: &str, tool_call_id: &str) {
        if !tool_name_expects_permission_callback(tool_name) {
            return;
        }

        self.pending.lock().await.insert(
            tool_call_id.to_string(),
            PendingApprovalCallbackDiagnostic {
                session_id: session_id.to_string(),
                tool_name: tool_name.to_string(),
            },
        );

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

    async fn note_callback_received(
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

    async fn warn_if_callback_missing(&self, session_id: &str, tool_call_id: &str) {
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

    async fn log_pending_for_session(&self, session_id: &str, reason: &str) {
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

fn permission_kind_label(kind: &PendingPermissionKind) -> &'static str {
    match kind {
        PendingPermissionKind::Tool { .. } => "tool",
        PendingPermissionKind::Question { .. } => "question",
        PendingPermissionKind::Hook { .. } => "hook",
    }
}

// ---------------------------------------------------------------------------
// AcepePermissionHandler
// ---------------------------------------------------------------------------

/// Implements cc-sdk's CanUseTool by routing permission requests through the Acepe UI.
struct AcepePermissionHandler {
    session_id: String,
    agent_type: AgentType,
    bridge: Arc<PermissionBridge>,
    dispatcher: AcpUiEventDispatcher,
    tool_call_tracker: Arc<ToolCallIdTracker>,
    approval_callback_tracker: Arc<ApprovalCallbackTracker>,
    pending_questions: Arc<Mutex<HashMap<String, PendingQuestionState>>>,
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

        // Look up the real tool_use_id (toolu_...) from the stream tracker.
        // The streaming bridge records it on content_block_start before the
        // CLI's control channel fires can_use_tool. Fall back to a synthetic
        // ID if the tracker somehow missed it.
        let tracked_tool_call_id = self.tool_call_tracker.take(tool_name).await;
        let tracker_miss = tracked_tool_call_id.is_none();
        let tool_call_id = tracked_tool_call_id.unwrap_or_else(|| format!("cc-sdk-{}", request_id));

        self.approval_callback_tracker
            .note_callback_received(&self.session_id, tool_name, &tool_call_id, "can_use_tool")
            .await;

        if tool_name == "AskUserQuestion" {
            let normalized_questions =
                parse_normalized_questions(tool_name, input, self.agent_type);
            let registration = self
                .bridge
                .register(
                    request_id,
                    PendingPermissionKind::Question {
                        tool_call_id: tool_call_id.clone(),
                        original_input: input.clone(),
                    },
                )
                .await;
            let rx = registration.receiver;

            let (questions_for_ui, question_already_emitted) = {
                let mut pending_questions = self.pending_questions.lock().await;
                let question_already_emitted = pending_questions
                    .get(&tool_call_id)
                    .map(|state| state.ui_emitted)
                    .unwrap_or(false);
                let merged_questions = normalized_questions.clone().or_else(|| {
                    pending_questions
                        .get(&tool_call_id)
                        .and_then(|state| state.questions.clone())
                });

                pending_questions.insert(
                    tool_call_id.clone(),
                    PendingQuestionState {
                        request_id,
                        session_id: self.session_id.clone(),
                        questions: merged_questions.clone(),
                        ui_emitted: question_already_emitted || merged_questions.is_some(),
                    },
                );

                (merged_questions, question_already_emitted)
            };

            if let Some(questions) = questions_for_ui {
                if !question_already_emitted {
                    self.dispatcher.enqueue(AcpUiEvent::session_update(
                        SessionUpdate::QuestionRequest {
                            question: QuestionData {
                                id: tool_call_id.clone(),
                                session_id: self.session_id.clone(),
                                json_rpc_request_id: Some(request_id),
                                questions,
                                tool: Some(ToolReference {
                                    message_id: String::new(),
                                    call_id: tool_call_id.clone(),
                                }),
                            },
                            session_id: Some(self.session_id.clone()),
                        },
                    ));
                }
            }

            tracing::info!(
                session_id = %self.session_id,
                request_id = request_id,
                tool_name = %tool_name,
                tool_call_id = %tool_call_id,
                "cc-sdk AskUserQuestion emitted and awaiting UI response"
            );

            return match timeout(Duration::from_secs(15 * 60), rx).await {
                Ok(Ok(result)) => result,
                other => {
                    self.pending_questions.lock().await.remove(&tool_call_id);
                    self.bridge
                        .clear_request(request_id, "Question timed out or was not answered")
                        .await;
                    tracing::warn!(
                        session_id = %self.session_id,
                        request_id = request_id,
                        tool_name = %tool_name,
                        tool_call_id = %tool_call_id,
                        timeout_or_error = ?other,
                        "cc-sdk AskUserQuestion denied or timed out"
                    );
                    self.dispatcher.enqueue(AcpUiEvent::session_update(
                        SessionUpdate::ToolCallUpdate {
                            update: ToolCallUpdateData {
                                tool_call_id,
                                status: Some(ToolCallStatus::Failed),
                                failure_reason: Some(
                                    "Question timed out or was not answered".to_string(),
                                ),
                                ..Default::default()
                            },
                            session_id: Some(self.session_id.clone()),
                        },
                    ));
                    cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
                        message: "Question timed out or was not answered".to_string(),
                        interrupt: false,
                    })
                }
            };
        }

        let registration = self
            .bridge
            .register(
                request_id,
                PendingPermissionKind::Tool {
                    tool_call_id: tool_call_id.clone(),
                    tool_name: tool_name.to_string(),
                    permission_suggestions: _ctx.suggestions.clone(),
                },
            )
            .await;
        let rx = registration.receiver;
        let has_always_option = _ctx
            .suggestions
            .iter()
            .any(permission_suggestion_supports_always);
        log_debug_event(
            &self.session_id,
            "permission.can_use_tool.registered",
            &serde_json::json!({
                "requestId": request_id,
                "toolName": tool_name,
                "toolCallId": tool_call_id,
                "trackerMiss": tracker_miss,
                "shouldEmitUi": registration.should_emit_ui,
                "suggestionCount": _ctx.suggestions.len(),
                "patterns": build_permission_patterns(input),
            }),
        );
        if registration.should_emit_ui {
            tracing::info!(
                session_id = %self.session_id,
                request_id = request_id,
                tool_name = %tool_name,
                tool_call_id = %tool_call_id,
                "cc-sdk permission request emitted"
            );
            log_debug_event(
                &self.session_id,
                "permission.ui.emit",
                &serde_json::json!({
                    "source": "can_use_tool",
                    "channel": "inbound_request",
                    "requestId": request_id,
                    "toolName": tool_name,
                    "toolCallId": tool_call_id,
                }),
            );
            let mut permission_json = serde_json::json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "session/request_permission",
                "params": {
                    "sessionId": self.session_id,
                    "options": [
                        { "kind": "allow", "name": "Allow once", "optionId": "allow" },
                        { "kind": "allow_always", "name": "Always allow", "optionId": "allow_always" },
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
            if !has_always_option {
                permission_json["params"]["options"] = serde_json::json!([
                    { "kind": "allow", "name": "Allow once", "optionId": "allow" },
                    { "kind": "reject", "name": "Reject", "optionId": "reject" }
                ]);
            }
            self.dispatcher
                .enqueue(AcpUiEvent::inbound_request(permission_json));
        } else {
            tracing::info!(
                session_id = %self.session_id,
                request_id = request_id,
                tool_name = %tool_name,
                tool_call_id = %tool_call_id,
                "cc-sdk permission request joined existing pending approval"
            );
            log_debug_event(
                &self.session_id,
                "permission.ui.join",
                &serde_json::json!({
                    "source": "can_use_tool",
                    "requestId": request_id,
                    "toolName": tool_name,
                    "toolCallId": tool_call_id,
                }),
            );
        }

        match timeout(Duration::from_secs(60), rx).await {
            Ok(Ok(result)) => result,
            other => {
                tracing::warn!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %tool_name,
                    timeout_or_error = ?other,
                    "cc-sdk permission request denied or timed out"
                );
                self.bridge
                    .clear_request(request_id, "Permission denied or timed out")
                    .await;
                cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
                    message: "Permission denied or timed out".to_string(),
                    interrupt: false,
                })
            }
        }
    }
}

struct AcepePermissionRequestHook {
    session_id: String,
    agent_type: AgentType,
    bridge: Arc<PermissionBridge>,
    dispatcher: AcpUiEventDispatcher,
    approval_callback_tracker: Arc<ApprovalCallbackTracker>,
}

#[async_trait]
impl cc_sdk::HookCallback for AcepePermissionRequestHook {
    async fn execute(
        &self,
        input: &cc_sdk::HookInput,
        tool_use_id: Option<&str>,
        _context: &cc_sdk::HookContext,
    ) -> Result<cc_sdk::HookJSONOutput, cc_sdk::SdkError> {
        let cc_sdk::HookInput::PermissionRequest(request) = input else {
            return Ok(cc_sdk::HookJSONOutput::Sync(cc_sdk::SyncHookJSONOutput {
                continue_: Some(true),
                ..Default::default()
            }));
        };

        if request.tool_name == "AskUserQuestion" {
            tracing::info!(
                session_id = %self.session_id,
                tool_name = %request.tool_name,
                tool_call_id = tool_use_id.unwrap_or("unknown"),
                "cc-sdk PermissionRequest hook ignored for AskUserQuestion"
            );
            return Ok(cc_sdk::HookJSONOutput::Sync(cc_sdk::SyncHookJSONOutput {
                continue_: Some(true),
                ..Default::default()
            }));
        }

        let request_id = self.bridge.next_id();
        let tool_call_id = tool_use_id
            .map(str::to_string)
            .unwrap_or_else(|| format!("cc-sdk-hook-{request_id}"));
        self.approval_callback_tracker
            .note_callback_received(
                &self.session_id,
                &request.tool_name,
                &tool_call_id,
                "PermissionRequest",
            )
            .await;
        let permission_suggestions = parse_permission_suggestions(&request.permission_suggestions);
        let has_always_option = permission_suggestions
            .iter()
            .any(permission_suggestion_supports_always);
        let registration = self
            .bridge
            .register_hook(
                request_id,
                PendingPermissionKind::Hook {
                    tool_call_id: tool_call_id.clone(),
                    tool_name: request.tool_name.clone(),
                    original_input: request.tool_input.clone(),
                    permission_suggestions: permission_suggestions.clone(),
                },
            )
            .await;
        let rx = registration.receiver;
        log_debug_event(
            &self.session_id,
            "permission.hook.registered",
            &serde_json::json!({
                "requestId": request_id,
                "toolName": request.tool_name,
                "toolCallId": tool_call_id,
                "shouldEmitUi": registration.should_emit_ui,
                "suggestionCount": permission_suggestions.len(),
                "patterns": build_permission_patterns(&request.tool_input),
            }),
        );

        if registration.should_emit_ui {
            tracing::info!(
                session_id = %self.session_id,
                request_id = request_id,
                tool_name = %request.tool_name,
                tool_call_id = %tool_call_id,
                suggestion_count = permission_suggestions.len(),
                "cc-sdk PermissionRequest hook emitted"
            );
            log_debug_event(
                &self.session_id,
                "permission.ui.emit",
                &serde_json::json!({
                    "source": "PermissionRequest",
                    "channel": "session_update",
                    "requestId": request_id,
                    "toolName": request.tool_name,
                    "toolCallId": tool_call_id,
                }),
            );

            self.dispatcher
                .enqueue(AcpUiEvent::session_update(build_permission_request_update(
                    &self.session_id,
                    &tool_call_id,
                    request_id,
                    &request.tool_name,
                    &request.tool_input,
                    has_always_option,
                    self.agent_type,
                )));
        } else {
            tracing::info!(
                session_id = %self.session_id,
                request_id = request_id,
                tool_name = %request.tool_name,
                tool_call_id = %tool_call_id,
                suggestion_count = permission_suggestions.len(),
                "cc-sdk PermissionRequest hook joined existing pending approval"
            );
            log_debug_event(
                &self.session_id,
                "permission.ui.join",
                &serde_json::json!({
                    "source": "PermissionRequest",
                    "requestId": request_id,
                    "toolName": request.tool_name,
                    "toolCallId": tool_call_id,
                }),
            );
        }

        match timeout(Duration::from_secs(60), rx).await {
            Ok(Ok(result)) => Ok(result),
            other => {
                tracing::warn!(
                    session_id = %self.session_id,
                    request_id = request_id,
                    tool_name = %request.tool_name,
                    timeout_or_error = ?other,
                    "cc-sdk PermissionRequest hook denied or timed out"
                );
                self.bridge
                    .clear_request(request_id, "Permission denied or timed out")
                    .await;
                Ok(build_denied_hook_output(
                    &PendingPermissionKind::Hook {
                        tool_call_id,
                        tool_name: request.tool_name.clone(),
                        original_input: request.tool_input.clone(),
                        permission_suggestions,
                    },
                    "Permission denied or timed out",
                ))
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
    /// Diagnostics for permission-worthy tool uses that never receive callbacks.
    approval_callback_tracker: Arc<ApprovalCallbackTracker>,
    /// Reconciles task/sub-agent parent-child tool relationships for cc-sdk updates.
    task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    /// Pending AskUserQuestion state keyed by tool/question ID.
    pending_questions: Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    /// Handle for the streaming bridge task. Calling `.abort()` cancels it.
    bridge_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Dispatcher for UI events.
    dispatcher: AcpUiEventDispatcher,
    /// Database connection for resolving provider-backed session IDs.
    db: Option<DbConn>,
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
        let db = app_handle
            .try_state::<DbConn>()
            .map(|state| state.inner().clone());
        let dispatcher = AcpUiEventDispatcher::new(Some(app_handle), DispatchPolicy::default());
        Ok(Self {
            provider,
            sdk_client: None,
            session_id: None,
            permission_bridge: Arc::new(PermissionBridge::new()),
            tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
            bridge_task: None,
            dispatcher,
            db,
            pending_options: None,
            pending_mode_id: None,
            pending_model_id: None,
        })
    }

    fn reset_stream_runtime_state(&mut self) {
        self.tool_call_tracker = Arc::new(ToolCallIdTracker::new());
        self.approval_callback_tracker = Arc::new(ApprovalCallbackTracker::new());
        self.task_reconciler = Arc::new(std::sync::Mutex::new(TaskReconciler::new()));
        self.pending_questions = Arc::new(Mutex::new(HashMap::new()));
    }

    fn reset_pending_mode_for_safe_resume(&mut self) {
        self.pending_mode_id = Some("default".to_string());
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
            agent_type: self.provider.parser_agent_type(),
            bridge: self.permission_bridge.clone(),
            dispatcher: self.dispatcher.clone(),
            tool_call_tracker: self.tool_call_tracker.clone(),
            approval_callback_tracker: self.approval_callback_tracker.clone(),
            pending_questions: self.pending_questions.clone(),
        };
        let permission_request_hook = AcepePermissionRequestHook {
            session_id: session_id.to_string(),
            agent_type: self.provider.parser_agent_type(),
            bridge: self.permission_bridge.clone(),
            dispatcher: self.dispatcher.clone(),
            approval_callback_tracker: self.approval_callback_tracker.clone(),
        };

        let mut builder = cc_sdk::ClaudeCodeOptions::builder().cwd(PathBuf::from(cwd));
        builder = builder.session_id(session_id.to_string());
        builder = builder.include_partial_messages(true);
        builder = builder.setting_sources(vec![
            cc_sdk::SettingSource::User,
            cc_sdk::SettingSource::Project,
            cc_sdk::SettingSource::Local,
        ]);

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
        options.hooks = Some(HashMap::from([(
            "PermissionRequest".to_string(),
            vec![cc_sdk::HookMatcher {
                matcher: Some(serde_json::json!("*")),
                hooks: vec![Arc::new(permission_request_hook)],
            }],
        )]));
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
        let pending_questions = self.pending_questions.clone();
        let approval_callback_tracker = self.approval_callback_tracker.clone();
        let provider = self.provider.clone();
        let sid = session_id.clone();
        let db = self.db.clone();
        let context = StreamingBridgeContext {
            dispatcher,
            bridge,
            tool_call_tracker: tracker,
            approval_callback_tracker,
            task_reconciler,
            pending_questions,
            provider,
            db,
        };

        let handle = tauri::async_runtime::spawn(async move {
            run_streaming_bridge(stream, sid, context).await;
        });

        self.bridge_task = Some(handle);
        Ok(())
    }

    fn stop_bridge(&mut self) {
        if let Some(handle) = self.bridge_task.take() {
            handle.abort();
        }
    }

    async fn history_session_id_for_app_session(&self, session_id: &str) -> String {
        match &self.db {
            Some(db) => crate::db::repository::SessionMetadataRepository::get_by_id(db, session_id)
                .await
                .ok()
                .flatten()
                .map(|row| row.history_session_id().to_string())
                .unwrap_or_else(|| session_id.to_string()),
            None => session_id.to_string(),
        }
    }

    async fn session_has_persisted_history(&self, session_id: &str, cwd: &str) -> bool {
        let history_session_id = self.history_session_id_for_app_session(session_id).await;
        crate::session_jsonl::parser::find_session_file(&history_session_id, cwd)
            .await
            .is_ok()
    }

    async fn hydrated_session_model_state(&self) -> SessionModelState {
        let mut model_state = default_session_model_state();
        let mut available_models = provider_models(self.provider.as_ref());

        if available_models.is_empty() {
            available_models = self.discover_models_from_provider_cli().await;
        } else {
            tracing::info!(
                provider = %self.provider.id(),
                default_model_count = available_models.len(),
                "cc-sdk using provider default models; skipping synchronous CLI model discovery"
            );
        }

        if !available_models.is_empty() {
            model_state.available_models = available_models;
        }

        if let Some(model_id) = &self.pending_model_id {
            model_state.current_model_id = model_id.clone();
        } else if model_state.current_model_id == "auto" && model_state.available_models.len() == 1
        {
            if let Some(model) = model_state.available_models.first() {
                model_state.current_model_id = model.model_id.clone();
            }
        }

        apply_provider_model_fallback(self.provider.as_ref(), &mut model_state);

        let agent_type = self.provider.parser_agent_type();
        model_state.models_display =
            get_transformer(agent_type).transform(&model_state.available_models);

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
            .set_permission_mode(claude_permission_mode_name(map_to_claude_permission_mode(
                mode_id,
            )))
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

    async fn send_user_message_text(&self, text: String) -> AcpResult<()> {
        let sdk_client = self.sdk_client.as_ref().ok_or_else(|| {
            AcpError::InvalidState(
                "cc-sdk client not connected; call new_session or resume_session first".to_string(),
            )
        })?;

        tracing::info!(
            session_id = ?self.session_id,
            prompt_len = text.len(),
            "cc-sdk: sending user message via send_user_message..."
        );

        sdk_client
            .lock()
            .await
            .send_user_message(text)
            .await
            .map_err(|error| {
                tracing::error!(error = %error, "cc-sdk: send_user_message failed");
                AcpError::ProtocolError(error.to_string())
            })?;

        tracing::info!(session_id = ?self.session_id, "cc-sdk: send_user_message completed");
        Ok(())
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

struct StreamingBridgeContext {
    dispatcher: AcpUiEventDispatcher,
    bridge: Arc<PermissionBridge>,
    tool_call_tracker: Arc<ToolCallIdTracker>,
    approval_callback_tracker: Arc<ApprovalCallbackTracker>,
    task_reconciler: Arc<std::sync::Mutex<TaskReconciler>>,
    pending_questions: Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    provider: Arc<dyn AgentProvider>,
    db: Option<DbConn>,
}

fn note_pending_stream_tool_call(pending_tool_call_ids: &mut VecDeque<String>, tool_call_id: &str) {
    if pending_tool_call_ids
        .iter()
        .any(|pending_tool_call_id| pending_tool_call_id == tool_call_id)
    {
        return;
    }

    pending_tool_call_ids.push_back(tool_call_id.to_string());
}

fn resolve_pending_stream_tool_call(
    pending_tool_call_ids: &mut VecDeque<String>,
    tool_call_id: &str,
) {
    pending_tool_call_ids.retain(|pending_tool_call_id| pending_tool_call_id != tool_call_id);
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

async fn take_synthetic_tool_completions_for_resumed_tool_turn(
    pending_tool_call_ids: &mut VecDeque<String>,
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    session_id: &str,
) -> Vec<SessionUpdate> {
    let active_question_ids = pending_questions
        .lock()
        .await
        .keys()
        .cloned()
        .collect::<Vec<_>>();

    let mut retained_tool_call_ids = VecDeque::new();
    let mut synthetic_updates = Vec::new();

    while let Some(tool_call_id) = pending_tool_call_ids.pop_front() {
        if active_question_ids.contains(&tool_call_id) {
            retained_tool_call_ids.push_back(tool_call_id);
            continue;
        }

        synthetic_updates.push(SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id,
                status: Some(ToolCallStatus::Completed),
                ..Default::default()
            },
            session_id: Some(session_id.to_string()),
        });
    }

    *pending_tool_call_ids = retained_tool_call_ids;

    synthetic_updates
}

async fn run_streaming_bridge(
    mut stream: impl futures::Stream<Item = cc_sdk::Result<cc_sdk::Message>> + Unpin,
    session_id: String,
    context: StreamingBridgeContext,
) {
    let StreamingBridgeContext {
        dispatcher,
        bridge,
        tool_call_tracker,
        approval_callback_tracker,
        task_reconciler,
        pending_questions,
        provider,
        db,
    } = context;

    tracing::info!(session_id = %session_id, "cc-sdk bridge: started, waiting for messages...");
    let mut message_count: u64 = 0;
    let mut turn_stream_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
    let mut stream_tool_blocks: HashMap<u64, (String, String)> = HashMap::new();
    let mut pending_tool_call_ids = VecDeque::new();
    let mut awaiting_tool_turn_resume = false;
    let mut observed_provider_session_id: Option<String> = None;

    while let Some(result) = stream.next().await {
        match result {
            Ok(msg) => {
                if let Some(provider_session_id) = provider_session_id_from_message(&msg) {
                    if provider_session_id != session_id
                        && observed_provider_session_id.as_deref() != Some(provider_session_id)
                    {
                        persist_provider_session_id_alias(
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
                if let cc_sdk::Message::StreamEvent { event, .. } = &msg {
                    if let Some(event_type) = event.get("type").and_then(|value| value.as_str()) {
                        if event_type == "message_start" && awaiting_tool_turn_resume {
                            let synthetic_updates =
                                take_synthetic_tool_completions_for_resumed_tool_turn(
                                    &mut pending_tool_call_ids,
                                    &pending_questions,
                                    &session_id,
                                )
                                .await;

                            for synthetic_update in synthetic_updates {
                                dispatch_cc_sdk_update(
                                    &dispatcher,
                                    &task_reconciler,
                                    provider.as_ref(),
                                    synthetic_update,
                                );
                            }

                            awaiting_tool_turn_resume = false;
                        }

                        if event_type == "content_block_start" {
                            if let Some(block) = event.get("content_block") {
                                let is_tool_use =
                                    block.get("type").and_then(|v| v.as_str()) == Some("tool_use");
                                if is_tool_use {
                                    let index = event.get("index").and_then(|v| v.as_u64());
                                    let id = block.get("id").and_then(|v| v.as_str());
                                    let name = block.get("name").and_then(|v| v.as_str());
                                    if let (Some(index), Some(id), Some(name)) = (index, id, name) {
                                        stream_tool_blocks
                                            .insert(index, (id.to_string(), name.to_string()));
                                        note_pending_stream_tool_call(
                                            &mut pending_tool_call_ids,
                                            id,
                                        );
                                        approval_callback_tracker
                                            .note_tool_use_started(&session_id, name, id)
                                            .await;
                                        let approval_callback_tracker_clone =
                                            approval_callback_tracker.clone();
                                        let session_id_clone = session_id.clone();
                                        let tool_call_id = id.to_string();
                                        tokio::spawn(async move {
                                            tokio::time::sleep(Duration::from_secs(2)).await;
                                            approval_callback_tracker_clone
                                                .warn_if_callback_missing(
                                                    &session_id_clone,
                                                    &tool_call_id,
                                                )
                                                .await;
                                        });
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
                                    if let (Some(index), Some(partial_json)) = (index, partial_json)
                                    {
                                        if let Some((tool_call_id, tool_name)) =
                                            stream_tool_blocks.get(&index)
                                        {
                                            let raw_update = RawToolCallUpdateInput {
                                                id: tool_call_id.clone(),
                                                status: None,
                                                result: None,
                                                content: None,
                                                title: None,
                                                locations: None,
                                                streaming_input_delta: Some(
                                                    partial_json.to_string(),
                                                ),
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
                        if event_type == "message_delta" {
                            awaiting_tool_turn_resume = event
                                .get("delta")
                                .and_then(|delta| delta.get("stop_reason"))
                                .and_then(|value| value.as_str())
                                == Some("tool_use");
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
                                let is_tool_use =
                                    block.get("type").and_then(|v| v.as_str()) == Some("tool_use");
                                if is_tool_use {
                                    if let (Some(id), Some(name)) = (
                                        block.get("id").and_then(|v| v.as_str()),
                                        block.get("name").and_then(|v| v.as_str()),
                                    ) {
                                        tool_call_tracker
                                            .record(name.to_string(), id.to_string())
                                            .await;
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
                    crate::acp::parsers::cc_sdk_bridge::translate_cc_sdk_message_with_turn_state(
                        msg,
                        Some(session_id.clone()),
                        turn_stream_state.clone(),
                    );
                tracing::info!(
                    session_id = %session_id,
                    update_count = updates.len(),
                    "cc-sdk bridge: translated to session updates"
                );
                for mut update in updates {
                    if let Some(tool_call_id) = terminal_tool_call_id(&update) {
                        resolve_pending_stream_tool_call(&mut pending_tool_call_ids, tool_call_id);
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
                    let should_defer_turn_complete =
                        matches!(update, SessionUpdate::TurnComplete { .. })
                            && has_pending_stream_only_question(&pending_questions, &session_id)
                                .await;
                    if matches!(
                        update,
                        SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }
                    ) {
                        awaiting_tool_turn_resume = false;
                        // Reset per-turn stream state but preserve model_id across turns
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

fn provider_session_id_from_message(msg: &cc_sdk::Message) -> Option<&str> {
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

fn response_outcome_allows(result: &Value) -> bool {
    matches!(
        result
            .get("outcome")
            .and_then(|outcome| outcome.get("outcome"))
            .and_then(Value::as_str),
        Some("selected") | Some("allowed")
    )
}

fn selected_option_id(result: &Value) -> Option<&str> {
    result
        .get("outcome")
        .and_then(|outcome| outcome.get("optionId"))
        .and_then(Value::as_str)
}

fn extract_question_answer_map(result: &Value) -> serde_json::Map<String, Value> {
    result
        .pointer("/_meta/answers")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn build_question_updated_input(
    original_input: &Value,
    answers: &serde_json::Map<String, Value>,
) -> Value {
    match original_input {
        Value::Object(object) => {
            let mut updated_input = object.clone();
            updated_input.insert("answers".to_string(), Value::Object(answers.clone()));
            Value::Object(updated_input)
        }
        _ => original_input.clone(),
    }
}

fn permission_result_from_ui_result(
    kind: &PendingPermissionKind,
    result: &Value,
) -> cc_sdk::PermissionResult {
    if response_outcome_allows(result) {
        let updated_input = match kind {
            PendingPermissionKind::Question { original_input, .. } => Some(
                build_question_updated_input(original_input, &extract_question_answer_map(result)),
            ),
            PendingPermissionKind::Tool { .. } | PendingPermissionKind::Hook { .. } => None,
        };

        let updated_permissions = match kind {
            PendingPermissionKind::Tool {
                tool_name,
                permission_suggestions,
                ..
            } if selected_option_id(result) == Some("allow_always") => Some(
                choose_always_permission_updates(tool_name, permission_suggestions),
            ),
            _ => None,
        };

        cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
            updated_input,
            updated_permissions,
        })
    } else {
        cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
            message: if kind.is_question() {
                "Question cancelled by user".to_string()
            } else {
                "Permission denied by user".to_string()
            },
            interrupt: false,
        })
    }
}

fn build_denied_hook_output(kind: &PendingPermissionKind, message: &str) -> cc_sdk::HookJSONOutput {
    hook_output_with_decision(
        kind,
        serde_json::json!({
            "behavior": "deny",
            "message": message,
            "interrupt": false,
        }),
    )
}

fn hook_output_from_ui_result(
    kind: &PendingPermissionKind,
    result: &Value,
) -> cc_sdk::HookJSONOutput {
    if !response_outcome_allows(result) {
        return build_denied_hook_output(kind, "Permission denied by user");
    }

    let PendingPermissionKind::Hook {
        tool_name,
        original_input,
        permission_suggestions,
        ..
    } = kind
    else {
        return build_denied_hook_output(kind, "Unsupported hook permission state");
    };

    let mut decision = serde_json::json!({
        "behavior": "allow",
        "updatedInput": original_input,
    });

    if selected_option_id(result) == Some("allow_always") {
        decision["updatedPermissions"] = serde_json::to_value(choose_always_permission_updates(
            tool_name,
            permission_suggestions,
        ))
        .unwrap_or_else(|_| Value::Array(Vec::new()));
    }

    hook_output_with_decision(kind, decision)
}

fn hook_output_with_decision(
    kind: &PendingPermissionKind,
    decision: Value,
) -> cc_sdk::HookJSONOutput {
    let reason = match kind {
        PendingPermissionKind::Hook { tool_name, .. } => {
            Some(format!("Acepe approval resolved for {tool_name}"))
        }
        _ => None,
    };

    cc_sdk::HookJSONOutput::Sync(cc_sdk::SyncHookJSONOutput {
        continue_: Some(true),
        reason,
        hook_specific_output: Some(cc_sdk::HookSpecificOutput::PermissionRequest(
            cc_sdk::PermissionRequestHookSpecificOutput { decision },
        )),
        ..Default::default()
    })
}

fn parse_permission_suggestions(suggestions: &Option<Vec<Value>>) -> Vec<cc_sdk::PermissionUpdate> {
    suggestions
        .iter()
        .flatten()
        .filter_map(|value| serde_json::from_value::<cc_sdk::PermissionUpdate>(value.clone()).ok())
        .collect()
}

fn permission_suggestion_supports_always(update: &cc_sdk::PermissionUpdate) -> bool {
    matches!(update.behavior, Some(cc_sdk::PermissionBehavior::Allow))
        || matches!(update.update_type, cc_sdk::PermissionUpdateType::SetMode)
}

fn choose_always_permission_updates(
    tool_name: &str,
    suggestions: &[cc_sdk::PermissionUpdate],
) -> Vec<cc_sdk::PermissionUpdate> {
    if let Some(suggestion) = suggestions
        .iter()
        .find(|suggestion| permission_suggestion_supports_always(suggestion))
    {
        return vec![suggestion.clone()];
    }

    vec![cc_sdk::PermissionUpdate {
        update_type: cc_sdk::PermissionUpdateType::AddRules,
        rules: Some(vec![cc_sdk::PermissionRuleValue {
            tool_name: tool_name.to_string(),
            rule_content: None,
        }]),
        behavior: Some(cc_sdk::PermissionBehavior::Allow),
        mode: None,
        directories: None,
        destination: Some(cc_sdk::PermissionUpdateDestination::Session),
    }]
}

fn build_permission_request_update(
    session_id: &str,
    tool_call_id: &str,
    request_id: u64,
    tool_name: &str,
    raw_input: &Value,
    has_always_option: bool,
    agent_type: AgentType,
) -> SessionUpdate {
    SessionUpdate::PermissionRequest {
        permission: crate::acp::session_update::PermissionData {
            id: request_id.to_string(),
            session_id: session_id.to_string(),
            permission: tool_name.to_string(),
            patterns: build_permission_patterns(raw_input),
            metadata: build_permission_metadata(tool_name, raw_input, agent_type),
            always: if has_always_option {
                vec!["allow_always".to_string()]
            } else {
                Vec::new()
            },
            tool: Some(ToolReference {
                message_id: String::new(),
                call_id: tool_call_id.to_string(),
            }),
        },
        session_id: Some(session_id.to_string()),
    }
}

fn build_permission_patterns(raw_input: &Value) -> Vec<String> {
    ["command", "file_path", "filePath", "path", "query"]
        .into_iter()
        .filter_map(|key| raw_input.get(key).and_then(Value::as_str))
        .map(ToString::to_string)
        .collect()
}

fn build_permission_metadata(tool_name: &str, raw_input: &Value, agent_type: AgentType) -> Value {
    let parsed_arguments = get_parser(agent_type)
        .parse_typed_tool_arguments(Some(tool_name), raw_input, None)
        .and_then(|arguments| serde_json::to_value(arguments).ok());

    let mut metadata = serde_json::Map::from_iter([
        ("rawInput".to_string(), raw_input.clone()),
        ("options".to_string(), Value::Array(Vec::new())),
    ]);

    if let Some(parsed_arguments) = parsed_arguments {
        metadata.insert("parsedArguments".to_string(), parsed_arguments);
    }

    Value::Object(metadata)
}

fn build_question_answer_map(
    questions: &[QuestionItem],
    answers: &[Vec<String>],
) -> serde_json::Map<String, Value> {
    let mut answer_map = serde_json::Map::new();

    for (index, question) in questions.iter().enumerate() {
        let selected_answers = answers.get(index).cloned().unwrap_or_default();
        let answer_value = if question.multi_select || selected_answers.len() > 1 {
            Value::Array(selected_answers.into_iter().map(Value::String).collect())
        } else {
            Value::String(selected_answers.into_iter().next().unwrap_or_default())
        };

        answer_map.insert(question.question.clone(), answer_value);
    }

    answer_map
}

fn question_answers_are_empty(answers: &[Vec<String>]) -> bool {
    answers.iter().all(Vec::is_empty)
}

fn build_question_reply_text(questions: &[QuestionItem], answers: &[Vec<String>]) -> String {
    let lines = questions
        .iter()
        .enumerate()
        .map(|(index, question)| {
            let selected_answers = answers.get(index).cloned().unwrap_or_default();
            let answer_text = if question.multi_select || selected_answers.len() > 1 {
                selected_answers.join(", ")
            } else {
                selected_answers.into_iter().next().unwrap_or_default()
            };
            let question_json = serde_json::to_string(&question.question)
                .unwrap_or_else(|_| format!("\"{}\"", question.question));
            let answer_json = serde_json::to_string(&answer_text)
                .unwrap_or_else(|_| format!("\"{}\"", answer_text));
            format!("- {question_json}: {answer_json}")
        })
        .collect::<Vec<_>>();

    format!("The user answered the questions:\n{}", lines.join("\n"))
}

fn question_request_binding_grace_duration() -> Duration {
    if cfg!(test) {
        Duration::from_millis(25)
    } else {
        Duration::from_millis(250)
    }
}

fn question_request_binding_poll_interval() -> Duration {
    if cfg!(test) {
        Duration::from_millis(5)
    } else {
        Duration::from_millis(25)
    }
}

async fn wait_for_question_request_binding(
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    question_id: &str,
) -> Option<PendingQuestionState> {
    let mut remaining = question_request_binding_grace_duration();

    loop {
        let state = pending_questions.lock().await.get(question_id).cloned();

        match state {
            Some(state) if state.request_id != 0 => return Some(state),
            Some(state) if remaining.is_zero() => return Some(state),
            Some(_) => {
                let sleep_for = question_request_binding_poll_interval().min(remaining);
                tokio::time::sleep(sleep_for).await;
                remaining = remaining.saturating_sub(sleep_for);
            }
            None => return None,
        }
    }
}

async fn take_stream_only_question_state(
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    question_id: &str,
) -> Option<PendingQuestionState> {
    let mut pending_questions = pending_questions.lock().await;
    let state = pending_questions.get(question_id).cloned()?;

    if state.request_id != 0 {
        return None;
    }

    pending_questions.remove(question_id);
    Some(state)
}

async fn has_pending_stream_only_question(
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    session_id: &str,
) -> bool {
    pending_questions
        .lock()
        .await
        .values()
        .any(|state| state.session_id == session_id && state.request_id == 0)
}

async fn should_suppress_update_while_awaiting_stream_only_question(
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    session_id: &str,
    update: &SessionUpdate,
) -> bool {
    let pending_question_ids = pending_questions
        .lock()
        .await
        .iter()
        .filter_map(|(tool_call_id, state)| {
            if state.session_id == session_id && state.request_id == 0 {
                Some(tool_call_id.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    if pending_question_ids.is_empty() {
        return false;
    }

    match update {
        SessionUpdate::QuestionRequest { .. } | SessionUpdate::UsageTelemetryUpdate { .. } => false,
        SessionUpdate::ToolCall { tool_call, .. } => !pending_question_ids.contains(&tool_call.id),
        SessionUpdate::ToolCallUpdate { update, .. } => {
            !pending_question_ids.contains(&update.tool_call_id)
        }
        SessionUpdate::AgentMessageChunk { .. }
        | SessionUpdate::AgentThoughtChunk { .. }
        | SessionUpdate::TurnComplete { .. }
        | SessionUpdate::TurnError { .. }
        | SessionUpdate::Plan { .. }
        | SessionUpdate::AvailableCommandsUpdate { .. }
        | SessionUpdate::CurrentModeUpdate { .. }
        | SessionUpdate::ConfigOptionUpdate { .. }
        | SessionUpdate::PermissionRequest { .. }
        | SessionUpdate::UserMessageChunk { .. } => true,
    }
}

async fn annotate_pending_question_request(
    bridge: &PermissionBridge,
    pending_questions: &Arc<Mutex<HashMap<String, PendingQuestionState>>>,
    update: &mut SessionUpdate,
) -> bool {
    let SessionUpdate::QuestionRequest { question, .. } = update else {
        return true;
    };

    let request_id = if let Some(request_id) = question.json_rpc_request_id {
        Some(request_id)
    } else {
        bridge.request_id_for_question_tool_call(&question.id).await
    };

    let mut pending_questions = pending_questions.lock().await;
    let state = pending_questions
        .entry(question.id.clone())
        .or_insert_with(|| PendingQuestionState {
            request_id: request_id.unwrap_or(0),
            session_id: question.session_id.clone(),
            questions: Some(question.questions.clone()),
            ui_emitted: false,
        });

    if state.questions.is_none() {
        state.questions = Some(question.questions.clone());
    }

    if let Some(request_id) = request_id {
        question.json_rpc_request_id = Some(request_id);
        state.request_id = request_id;
    }

    if state.ui_emitted {
        return false;
    }

    state.ui_emitted = true;
    true
}

async fn persist_provider_session_id_alias(
    db: Option<&DbConn>,
    session_id: &str,
    provider_session_id: &str,
) {
    let Some(db) = db else {
        return;
    };

    if let Err(error) = crate::db::repository::SessionMetadataRepository::set_provider_session_id(
        db,
        session_id,
        provider_session_id,
    )
    .await
    {
        tracing::warn!(
            session_id = %session_id,
            provider_session_id = %provider_session_id,
            error = %error,
            "Failed to persist provider session ID alias"
        );
    }
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
            sequence_id: None,
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
        self.reset_pending_mode_for_safe_resume();
        let history_session_id = self.history_session_id_for_app_session(&session_id).await;
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

        self.pending_options =
            Some(self.build_options(&cwd, &session_id, Some(history_session_id.clone()), false));
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
        let options = self.build_options(&cwd, &session_id, Some(history_session_id), false);
        self.connect_and_start_bridge(options, session_id, None)
            .await?;
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
        self.pending_options =
            Some(self.build_options(&cwd, &new_session_id, Some(session_id.clone()), true));
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
            sequence_id: None,
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
        self.send_user_message_text(text).await
    }

    async fn cancel(&mut self, session_id: String) -> AcpResult<()> {
        let pending_question_ids = {
            let pending_questions = self.pending_questions.lock().await;
            pending_questions
                .iter()
                .filter_map(|(question_id, pending_question)| {
                    if pending_question.session_id == session_id {
                        Some(question_id.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        };

        for question_id in pending_question_ids {
            let _ = self.reply_question(question_id, Vec::new()).await?;
        }

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

    async fn reply_permission(&mut self, request_id: String, reply: String) -> AcpResult<bool> {
        let request_id = match request_id.parse::<u64>() {
            Ok(request_id) => request_id,
            Err(_) => return Ok(false),
        };

        let result = serde_json::json!({
            "outcome": {
                "outcome": if reply == "reject" { "cancelled" } else { "selected" },
                "optionId": if reply == "always" {
                    "allow_always"
                } else if reply == "reject" {
                    "reject"
                } else {
                    "allow"
                }
            }
        });

        self.respond(request_id, result).await?;
        Ok(true)
    }

    async fn reply_question(
        &mut self,
        request_id: String,
        answers: Vec<Vec<String>>,
    ) -> AcpResult<bool> {
        let pending_question =
            wait_for_question_request_binding(&self.pending_questions, &request_id).await;

        let Some(pending_question) = pending_question else {
            tracing::warn!(question_id = %request_id, "cc-sdk question reply ignored because no pending question metadata was found");
            return Ok(false);
        };

        let Some(questions) = pending_question.questions.clone() else {
            tracing::warn!(question_id = %request_id, "cc-sdk question reply ignored because normalized question metadata was unavailable");
            return Ok(false);
        };

        if question_answers_are_empty(&answers) {
            if let Some(stream_only_question) =
                take_stream_only_question_state(&self.pending_questions, &request_id).await
            {
                if let Some(sdk_client) = &self.sdk_client {
                    let _ = sdk_client.lock().await.interrupt().await;
                }

                tracing::info!(
                    question_id = %request_id,
                    "cc-sdk stream-only question cancelled"
                );
                self.dispatcher.enqueue(AcpUiEvent::session_update(
                    SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id: request_id.clone(),
                            status: Some(ToolCallStatus::Failed),
                            failure_reason: Some("Question cancelled by user".to_string()),
                            ..Default::default()
                        },
                        session_id: Some(stream_only_question.session_id.clone()),
                    },
                ));
                self.dispatcher
                    .enqueue(AcpUiEvent::session_update(SessionUpdate::TurnComplete {
                        session_id: Some(stream_only_question.session_id),
                    }));
                return Ok(true);
            }

            let result = serde_json::json!({
                "outcome": {
                    "outcome": "cancelled",
                    "optionId": "reject"
                }
            });

            self.respond(pending_question.request_id, result).await?;
            return Ok(true);
        }

        if let Some(stream_only_question) =
            take_stream_only_question_state(&self.pending_questions, &request_id).await
        {
            let reply_text = build_question_reply_text(&questions, &answers);

            if let Some(sdk_client) = &self.sdk_client {
                let _ = sdk_client.lock().await.interrupt().await;
            }

            tracing::info!(
                question_id = %request_id,
                "cc-sdk stream-only question continuing via send_user_message"
            );

            self.send_user_message_text(reply_text).await?;
            self.dispatcher
                .enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCallUpdate {
                    update: ToolCallUpdateData {
                        tool_call_id: request_id,
                        status: Some(ToolCallStatus::Completed),
                        ..Default::default()
                    },
                    session_id: Some(stream_only_question.session_id),
                }));
            return Ok(true);
        }

        let result = serde_json::json!({
            "outcome": {
                "outcome": "selected",
                "optionId": "allow"
            },
            "_meta": {
                "answers": Value::Object(build_question_answer_map(&questions, &answers))
            }
        });

        self.respond(pending_question.request_id, result).await?;

        Ok(true)
    }

    async fn respond(&self, request_id: u64, result: Value) -> AcpResult<()> {
        let question_resolution = {
            let mut pending_questions = self.pending_questions.lock().await;
            let tool_call_id = pending_questions.iter().find_map(|(tool_call_id, state)| {
                if state.request_id == request_id {
                    Some(tool_call_id.clone())
                } else {
                    None
                }
            });

            tool_call_id.and_then(|tool_call_id| {
                pending_questions
                    .remove(&tool_call_id)
                    .map(|state| (tool_call_id, state))
            })
        };

        let resolved_kind = self
            .permission_bridge
            .resolve_from_ui_result(request_id, &result)
            .await;

        if let Some(kind) = resolved_kind.as_ref() {
            if !kind.is_question() {
                if let Some(session_id) = self.session_id.as_deref() {
                    log_debug_event(
                        session_id,
                        "permission.ui.resolved",
                        &serde_json::json!({
                            "requestId": request_id,
                            "kind": permission_kind_label(kind),
                            "toolCallId": kind.tool_call_id(),
                            "allowed": response_outcome_allows(&result),
                            "optionId": selected_option_id(&result),
                        }),
                    );
                }
            }
        }

        if let Some((tool_call_id, question_state)) = question_resolution {
            if !response_outcome_allows(&result) {
                self.dispatcher.enqueue(AcpUiEvent::session_update(
                    SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id,
                            status: Some(ToolCallStatus::Failed),
                            failure_reason: Some("Question cancelled by user".to_string()),
                            ..Default::default()
                        },
                        session_id: Some(question_state.session_id),
                    },
                ));
            }
        } else if resolved_kind.is_none() {
            tracing::warn!(
                request_id = request_id,
                "cc-sdk respond ignored because no pending request was found"
            );
        }

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
    use crate::acp::session_update::ContentChunk;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use cc_sdk::{CanUseTool, HookCallback};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TestModelDiscoveryProvider {
        discovery_calls: Arc<AtomicUsize>,
    }

    impl AgentProvider for TestModelDiscoveryProvider {
        fn id(&self) -> &str {
            "claude-code"
        }

        fn name(&self) -> &str {
            "Test Claude Provider"
        }

        fn spawn_config(&self) -> crate::acp::provider::SpawnConfig {
            crate::acp::provider::SpawnConfig {
                command: "unused".to_string(),
                args: vec![],
                env: HashMap::new(),
            }
        }

        fn parser_agent_type(&self) -> AgentType {
            AgentType::ClaudeCode
        }

        fn model_discovery_commands(&self) -> Vec<crate::acp::provider::SpawnConfig> {
            self.discovery_calls.fetch_add(1, Ordering::SeqCst);
            vec![crate::acp::provider::SpawnConfig {
                command: "unused".to_string(),
                args: vec![],
                env: HashMap::new(),
            }]
        }

        fn default_model_candidates(&self) -> Vec<crate::acp::provider::ModelFallbackCandidate> {
            vec![
                crate::acp::provider::ModelFallbackCandidate {
                    model_id: "claude-opus-4-6".to_string(),
                    name: "Claude Opus 4.6".to_string(),
                    description: Some("Most capable Claude model".to_string()),
                },
                crate::acp::provider::ModelFallbackCandidate {
                    model_id: "claude-sonnet-4-5".to_string(),
                    name: "Claude Sonnet 4.5".to_string(),
                    description: Some("Balanced Claude model".to_string()),
                },
            ]
        }
    }

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

    fn make_test_client_with_provider(provider: Arc<dyn AgentProvider>) -> CcSdkClaudeClient {
        CcSdkClaudeClient {
            provider,
            sdk_client: None,
            session_id: None,
            permission_bridge: Arc::new(PermissionBridge::new()),
            tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            task_reconciler: Arc::new(std::sync::Mutex::new(
                crate::acp::task_reconciler::TaskReconciler::new(),
            )),
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
            bridge_task: None,
            dispatcher: AcpUiEventDispatcher::new(None, DispatchPolicy::default()),
            db: None,
            pending_options: None,
            pending_mode_id: None,
            pending_model_id: None,
        }
    }

    fn make_test_client() -> CcSdkClaudeClient {
        make_test_client_with_provider(Arc::new(
            crate::acp::providers::claude_code::ClaudeCodeProvider,
        ))
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
        assert!(options
            .hooks
            .as_ref()
            .and_then(|hooks| hooks.get("PermissionRequest"))
            .is_some());
        assert_eq!(
            options.setting_sources,
            Some(vec![
                cc_sdk::SettingSource::User,
                cc_sdk::SettingSource::Project,
                cc_sdk::SettingSource::Local,
            ])
        );
    }

    #[test]
    fn build_options_applies_resume_and_fork_flags() {
        let client = make_test_client();

        let options = client.build_options("/tmp", "session-1", Some("resume-1".to_string()), true);

        assert_eq!(options.resume.as_deref(), Some("resume-1"));
        assert!(options.fork_session);
    }

    #[tokio::test]
    async fn resume_session_clears_stale_autonomous_permission_mode_before_reconnect() {
        let temp = tempfile::tempdir().expect("temp dir");
        let mut client = make_test_client();
        client.pending_mode_id = Some("bypassPermissions".to_string());

        let response = client
            .resume_session(
                "session-1".to_string(),
                temp.path().to_string_lossy().into_owned(),
            )
            .await
            .expect("resume session should succeed without persisted history");

        assert_eq!(response.modes.current_mode_id, "build");
        assert_eq!(client.pending_mode_id.as_deref(), Some("default"));
        assert_eq!(
            client
                .pending_options
                .as_ref()
                .expect("resume without persisted history should defer connect")
                .permission_mode,
            cc_sdk::PermissionMode::Default
        );
    }

    #[tokio::test]
    async fn hydrated_session_model_state_skips_discovery_when_provider_has_default_models() {
        let discovery_calls = Arc::new(AtomicUsize::new(0));
        let client = make_test_client_with_provider(Arc::new(TestModelDiscoveryProvider {
            discovery_calls: discovery_calls.clone(),
        }));

        let state = client.hydrated_session_model_state().await;

        assert_eq!(discovery_calls.load(Ordering::SeqCst), 0);
        assert_eq!(state.available_models.len(), 2);
        assert_eq!(state.available_models[0].model_id, "claude-opus-4-6");
        assert_eq!(state.available_models[1].model_id, "claude-sonnet-4-5");
    }

    #[test]
    fn provider_session_id_from_stream_event_uses_provider_owned_id() {
        let message = cc_sdk::Message::StreamEvent {
            uuid: "msg-1".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({ "type": "message_stop" }),
            parent_tool_use_id: None,
        };

        assert_eq!(
            provider_session_id_from_message(&message),
            Some("provider-session")
        );
    }

    #[test]
    fn provider_session_id_from_system_message_reads_nested_session_id() {
        let message = cc_sdk::Message::System {
            subtype: "usage_update".to_string(),
            data: serde_json::json!({ "sessionId": "provider-session" }),
        };

        assert_eq!(
            provider_session_id_from_message(&message),
            Some("provider-session")
        );
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
    async fn respond_selected_resolves_allow_for_regular_permissions() {
        let client = make_test_client();
        let id = client.permission_bridge.next_id();
        let registration = client
            .permission_bridge
            .register(
                id,
                PendingPermissionKind::Tool {
                    tool_call_id: "toolu_permission".to_string(),
                    tool_name: "Bash".to_string(),
                    permission_suggestions: Vec::new(),
                },
            )
            .await;
        let rx = registration.receiver;

        let result = serde_json::json!({
            "outcome": { "outcome": "selected", "optionId": "allow" }
        });
        client.respond(id, result).await.expect("respond failed");

        let resolved = rx.await.expect("channel closed");
        assert!(matches!(resolved, cc_sdk::PermissionResult::Allow(_)));
    }

    #[tokio::test]
    async fn respond_cancelled_resolves_deny_for_regular_permissions() {
        let client = make_test_client();
        let id = client.permission_bridge.next_id();
        let registration = client
            .permission_bridge
            .register(
                id,
                PendingPermissionKind::Tool {
                    tool_call_id: "toolu_permission".to_string(),
                    tool_name: "Bash".to_string(),
                    permission_suggestions: Vec::new(),
                },
            )
            .await;
        let rx = registration.receiver;
        let result = serde_json::json!({
            "outcome": { "outcome": "cancelled", "optionId": "reject" }
        });
        client.respond(id, result).await.expect("respond failed");

        let resolved = rx.await.expect("channel closed");
        assert!(matches!(resolved, cc_sdk::PermissionResult::Deny(_)));
    }

    #[tokio::test]
    async fn cancel_resolves_pending_question_for_matching_session() {
        let mut client = make_test_client();
        let id = client.permission_bridge.next_id();
        let registration = client
            .permission_bridge
            .register(
                id,
                PendingPermissionKind::Question {
                    tool_call_id: "toolu_question".to_string(),
                    original_input: serde_json::json!({
                        "questions": [{
                            "question": "Pick one",
                            "header": "Pick one",
                            "options": [],
                            "multiSelect": false
                        }]
                    }),
                },
            )
            .await;
        let rx = registration.receiver;

        client.pending_questions.lock().await.insert(
            "toolu_question".to_string(),
            PendingQuestionState {
                request_id: id,
                session_id: "session-stop".to_string(),
                questions: Some(vec![QuestionItem {
                    question: "Pick one".to_string(),
                    header: "Pick one".to_string(),
                    options: vec![],
                    multi_select: false,
                }]),
                ui_emitted: true,
            },
        );

        client
            .cancel("session-stop".to_string())
            .await
            .expect("cancel failed");

        let resolved = rx.await.expect("channel closed");
        assert!(matches!(resolved, cc_sdk::PermissionResult::Deny(_)));
        assert!(client.pending_questions.lock().await.is_empty());
    }

    #[tokio::test]
    async fn respond_selected_allow_always_resolves_updated_permissions_for_regular_tools() {
        let client = make_test_client();
        let id = client.permission_bridge.next_id();
        let registration = client
            .permission_bridge
            .register(
                id,
                PendingPermissionKind::Tool {
                    tool_call_id: "toolu_permission".to_string(),
                    tool_name: "Bash".to_string(),
                    permission_suggestions: vec![cc_sdk::PermissionUpdate {
                        update_type: cc_sdk::PermissionUpdateType::AddRules,
                        rules: Some(vec![cc_sdk::PermissionRuleValue {
                            tool_name: "Bash".to_string(),
                            rule_content: None,
                        }]),
                        behavior: Some(cc_sdk::PermissionBehavior::Allow),
                        mode: None,
                        directories: None,
                        destination: Some(cc_sdk::PermissionUpdateDestination::Session),
                    }],
                },
            )
            .await;
        let rx = registration.receiver;

        let result = serde_json::json!({
            "outcome": { "outcome": "selected", "optionId": "allow_always" }
        });
        client.respond(id, result).await.expect("respond failed");

        let resolved = rx.await.expect("channel closed");
        let allow = match resolved {
            cc_sdk::PermissionResult::Allow(allow) => allow,
            other => panic!("expected allow result, got {:?}", other),
        };

        assert_eq!(allow.updated_permissions.as_ref().map(Vec::len), Some(1));
        assert_eq!(
            allow
                .updated_permissions
                .as_ref()
                .and_then(|updates| updates.first())
                .map(|update| update.update_type),
            Some(cc_sdk::PermissionUpdateType::AddRules)
        );
    }

    #[tokio::test]
    async fn reply_permission_resolves_hook_allow_once() {
        let mut client = make_test_client();
        let id = client.permission_bridge.next_id();
        let registration = client
            .permission_bridge
            .register_hook(
                id,
                PendingPermissionKind::Hook {
                    tool_call_id: "toolu_hook".to_string(),
                    tool_name: "Bash".to_string(),
                    original_input: serde_json::json!({ "command": "git status" }),
                    permission_suggestions: Vec::new(),
                },
            )
            .await;
        let rx = registration.receiver;

        assert!(client
            .reply_permission(id.to_string(), "once".to_string())
            .await
            .expect("reply_permission failed"));

        let resolved = rx.await.expect("channel closed");
        let cc_sdk::HookJSONOutput::Sync(output) = resolved else {
            panic!("expected sync hook output");
        };
        let serialized = serde_json::to_value(output).expect("serialize hook output");
        let decision = serialized["hookSpecificOutput"]["decision"].clone();

        assert_eq!(decision["behavior"], "allow");
        assert_eq!(decision["updatedInput"]["command"], "git status");
        assert!(decision.get("updatedPermissions").is_none());
    }

    #[tokio::test]
    async fn reply_permission_resolves_hook_allow_always_with_suggestion() {
        let mut client = make_test_client();
        let id = client.permission_bridge.next_id();
        let registration = client
            .permission_bridge
            .register_hook(
                id,
                PendingPermissionKind::Hook {
                    tool_call_id: "toolu_hook".to_string(),
                    tool_name: "Bash".to_string(),
                    original_input: serde_json::json!({ "command": "git status" }),
                    permission_suggestions: vec![cc_sdk::PermissionUpdate {
                        update_type: cc_sdk::PermissionUpdateType::AddRules,
                        rules: Some(vec![cc_sdk::PermissionRuleValue {
                            tool_name: "Bash".to_string(),
                            rule_content: None,
                        }]),
                        behavior: Some(cc_sdk::PermissionBehavior::Allow),
                        mode: None,
                        directories: None,
                        destination: Some(cc_sdk::PermissionUpdateDestination::Session),
                    }],
                },
            )
            .await;
        let rx = registration.receiver;

        assert!(client
            .reply_permission(id.to_string(), "always".to_string())
            .await
            .expect("reply_permission failed"));

        let resolved = rx.await.expect("channel closed");
        let cc_sdk::HookJSONOutput::Sync(output) = resolved else {
            panic!("expected sync hook output");
        };
        let serialized = serde_json::to_value(output).expect("serialize hook output");
        let decision = serialized["hookSpecificOutput"]["decision"].clone();

        assert_eq!(decision["behavior"], "allow");
        assert_eq!(decision["updatedPermissions"][0]["type"], "addRules");
        assert_eq!(decision["updatedPermissions"][0]["destination"], "session");
    }

    #[tokio::test]
    async fn permission_bridge_reuses_resolved_group_for_late_hook_registration() {
        let bridge = PermissionBridge::new();
        let initial_id = bridge.next_id();
        let initial_registration = bridge
            .register(
                initial_id,
                PendingPermissionKind::Tool {
                    tool_call_id: "toolu_shared_permission".to_string(),
                    tool_name: "Write".to_string(),
                    permission_suggestions: Vec::new(),
                },
            )
            .await;

        assert!(initial_registration.should_emit_ui);

        let resolved_kind = bridge
            .resolve_from_ui_result(
                initial_id,
                &serde_json::json!({
                    "outcome": { "outcome": "selected", "optionId": "allow" }
                }),
            )
            .await;

        assert!(matches!(
            resolved_kind,
            Some(PendingPermissionKind::Tool { .. })
        ));
        assert!(matches!(
            initial_registration
                .receiver
                .await
                .expect("initial permission resolution"),
            cc_sdk::PermissionResult::Allow(_)
        ));

        let late_hook_id = bridge.next_id();
        let late_hook_registration = bridge
            .register_hook(
                late_hook_id,
                PendingPermissionKind::Hook {
                    tool_call_id: "toolu_shared_permission".to_string(),
                    tool_name: "Write".to_string(),
                    original_input: serde_json::json!({
                        "file_path": "/tmp/color.txt",
                        "content": "blue"
                    }),
                    permission_suggestions: Vec::new(),
                },
            )
            .await;

        assert!(!late_hook_registration.should_emit_ui);

        let resolved_hook = timeout(Duration::from_millis(50), late_hook_registration.receiver)
            .await
            .expect("late hook should resolve without another UI prompt")
            .expect("late hook channel closed");
        let cc_sdk::HookJSONOutput::Sync(output) = resolved_hook else {
            panic!("expected sync hook output");
        };
        let serialized = serde_json::to_value(output).expect("serialize hook output");

        assert_eq!(
            serialized["hookSpecificOutput"]["decision"]["behavior"],
            "allow"
        );
        assert_eq!(
            serialized["hookSpecificOutput"]["decision"]["updatedInput"]["file_path"],
            "/tmp/color.txt"
        );
    }

    #[tokio::test]
    async fn permission_request_hook_ignores_ask_user_question() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let bridge = Arc::new(PermissionBridge::new());
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;

        let hook = AcepePermissionRequestHook {
            session_id: "session-hook".to_string(),
            agent_type: provider.parser_agent_type(),
            bridge: bridge.clone(),
            dispatcher,
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        };

        let resolver_bridge = bridge.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            let _ = resolver_bridge
                .resolve_from_ui_result(
                    1,
                    &serde_json::json!({
                        "outcome": { "outcome": "selected", "optionId": "allow" }
                    }),
                )
                .await;
        });

        let result = hook
            .execute(
                &cc_sdk::HookInput::PermissionRequest(cc_sdk::PermissionRequestHookInput {
                    session_id: "session-hook".to_string(),
                    transcript_path: "/tmp/transcript.jsonl".to_string(),
                    cwd: "/tmp".to_string(),
                    permission_mode: Some("default".to_string()),
                    tool_name: "AskUserQuestion".to_string(),
                    tool_input: serde_json::json!({
                        "questions": [{
                            "question": "Pick one",
                            "header": "Pick one",
                            "options": [{ "label": "A", "description": "" }],
                            "multiSelect": false
                        }]
                    }),
                    permission_suggestions: None,
                    agent_id: None,
                    agent_type: None,
                }),
                Some("toolu_question_hook"),
                &cc_sdk::HookContext { signal: None },
            )
            .await
            .expect("hook execute failed");

        let cc_sdk::HookJSONOutput::Sync(output) = result else {
            panic!("expected sync hook output");
        };

        assert_eq!(output.continue_, Some(true));
        assert!(output.hook_specific_output.is_none());
        assert!(sink.lock().expect("sink lock").is_empty());
    }

    #[tokio::test]
    async fn can_use_tool_and_permission_request_hook_share_one_visible_permission_request() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let bridge = Arc::new(PermissionBridge::new());
        let tracker = Arc::new(ToolCallIdTracker::new());
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;

        tracker
            .record("Bash".to_string(), "toolu_shared_permission".to_string())
            .await;

        let handler = AcepePermissionHandler {
            session_id: "session-shared".to_string(),
            agent_type: provider.parser_agent_type(),
            bridge: bridge.clone(),
            dispatcher: dispatcher.clone(),
            tool_call_tracker: tracker,
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
        };

        let hook = AcepePermissionRequestHook {
            session_id: "session-shared".to_string(),
            agent_type: provider.parser_agent_type(),
            bridge: bridge.clone(),
            dispatcher,
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        };

        let handler_task = tokio::spawn(async move {
            handler
                .can_use_tool(
                    "Bash",
                    &serde_json::json!({ "command": "git status" }),
                    &cc_sdk::ToolPermissionContext {
                        signal: None,
                        suggestions: Vec::new(),
                    },
                )
                .await
        });

        tokio::time::sleep(Duration::from_millis(5)).await;

        let hook_task = tokio::spawn(async move {
            hook.execute(
                &cc_sdk::HookInput::PermissionRequest(cc_sdk::PermissionRequestHookInput {
                    session_id: "session-shared".to_string(),
                    transcript_path: "/tmp/transcript.jsonl".to_string(),
                    cwd: "/tmp".to_string(),
                    permission_mode: Some("default".to_string()),
                    tool_name: "Bash".to_string(),
                    tool_input: serde_json::json!({ "command": "git status" }),
                    permission_suggestions: None,
                    agent_id: None,
                    agent_type: None,
                }),
                Some("toolu_shared_permission"),
                &cc_sdk::HookContext { signal: None },
            )
            .await
        });

        tokio::time::sleep(Duration::from_millis(5)).await;

        {
            let captured = sink.lock().expect("sink lock");
            assert_eq!(captured.len(), 1);
            assert_eq!(captured[0].event_name, "acp-inbound-request");
        }

        let resolved_kind = bridge
            .resolve_from_ui_result(
                1,
                &serde_json::json!({
                    "outcome": { "outcome": "selected", "optionId": "allow" }
                }),
            )
            .await;

        assert!(matches!(
            resolved_kind,
            Some(PendingPermissionKind::Tool { .. })
        ));
        assert!(matches!(
            handler_task.await.expect("handler task failed"),
            cc_sdk::PermissionResult::Allow(_)
        ));

        let hook_result = hook_task
            .await
            .expect("hook task failed")
            .expect("hook execute failed");
        let cc_sdk::HookJSONOutput::Sync(output) = hook_result else {
            panic!("expected sync hook output");
        };
        let serialized = serde_json::to_value(output).expect("serialize hook output");

        assert_eq!(
            serialized["hookSpecificOutput"]["decision"]["behavior"],
            "allow"
        );
        assert_eq!(sink.lock().expect("sink lock").len(), 1);
    }

    #[tokio::test]
    async fn respond_selected_question_resolves_updated_input() {
        let client = make_test_client();
        let id = client.permission_bridge.next_id();
        let registration = client
            .permission_bridge
            .register(
                id,
                PendingPermissionKind::Question {
                    tool_call_id: "toolu_question".to_string(),
                    original_input: serde_json::json!({
                        "questions": [{
                            "question": "Pick one",
                            "header": "Pick one",
                            "options": [],
                            "multiSelect": false
                        }]
                    }),
                },
            )
            .await;
        let rx = registration.receiver;

        client.pending_questions.lock().await.insert(
            "toolu_question".to_string(),
            PendingQuestionState {
                request_id: id,
                session_id: "session-1".to_string(),
                questions: Some(vec![QuestionItem {
                    question: "Pick one".to_string(),
                    header: "Pick one".to_string(),
                    options: vec![],
                    multi_select: false,
                }]),
                ui_emitted: true,
            },
        );

        let result = serde_json::json!({
            "outcome": { "outcome": "selected", "optionId": "allow" },
            "_meta": {
                "answers": {
                    "Pick one": "Option A"
                }
            }
        });
        client.respond(id, result).await.expect("respond failed");

        let resolved = rx.await.expect("channel closed");
        let allow = match resolved {
            cc_sdk::PermissionResult::Allow(allow) => allow,
            other => panic!("expected allow result, got {:?}", other),
        };

        assert_eq!(
            allow.updated_input,
            Some(serde_json::json!({
                "questions": [{
                    "question": "Pick one",
                    "header": "Pick one",
                    "options": [],
                    "multiSelect": false
                }],
                "answers": {
                    "Pick one": "Option A"
                }
            }))
        );
        assert!(client.pending_questions.lock().await.is_empty());
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
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        tracker
            .record("Bash".to_string(), "toolu_tracked_123".to_string())
            .await;

        let handler = AcepePermissionHandler {
            session_id: "session-1".to_string(),
            agent_type: provider.parser_agent_type(),
            bridge: bridge.clone(),
            dispatcher,
            tool_call_tracker: tracker,
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
        };

        let resolver_bridge = bridge.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            resolver_bridge
                .resolve(
                    1,
                    cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                        updated_input: None,
                        updated_permissions: None,
                    }),
                )
                .await;
        });

        let context = cc_sdk::ToolPermissionContext {
            signal: None,
            suggestions: Vec::new(),
        };

        let result = handler
            .can_use_tool(
                "Bash",
                &serde_json::json!({ "command": "echo ok" }),
                &context,
            )
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
        assert_eq!(
            payload["params"]["toolCall"]["toolCallId"],
            "toolu_tracked_123"
        );
        assert_eq!(payload["params"]["toolCall"]["name"], "Bash");
    }

    #[tokio::test]
    async fn can_use_tool_emits_allow_always_option_when_sdk_suggests_persistent_allow() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let bridge = Arc::new(PermissionBridge::new());
        let tracker = Arc::new(ToolCallIdTracker::new());
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        tracker
            .record("Bash".to_string(), "toolu_tracked_456".to_string())
            .await;

        let handler = AcepePermissionHandler {
            session_id: "session-allow-always".to_string(),
            agent_type: provider.parser_agent_type(),
            bridge: bridge.clone(),
            dispatcher,
            tool_call_tracker: tracker,
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
        };

        let resolver_bridge = bridge.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            resolver_bridge
                .resolve(
                    1,
                    cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                        updated_input: None,
                        updated_permissions: Some(vec![cc_sdk::PermissionUpdate {
                            update_type: cc_sdk::PermissionUpdateType::AddRules,
                            rules: Some(vec![cc_sdk::PermissionRuleValue {
                                tool_name: "Bash".to_string(),
                                rule_content: None,
                            }]),
                            behavior: Some(cc_sdk::PermissionBehavior::Allow),
                            mode: None,
                            directories: None,
                            destination: Some(cc_sdk::PermissionUpdateDestination::Session),
                        }]),
                    }),
                )
                .await;
        });

        let context = cc_sdk::ToolPermissionContext {
            signal: None,
            suggestions: vec![cc_sdk::PermissionUpdate {
                update_type: cc_sdk::PermissionUpdateType::AddRules,
                rules: Some(vec![cc_sdk::PermissionRuleValue {
                    tool_name: "Bash".to_string(),
                    rule_content: None,
                }]),
                behavior: Some(cc_sdk::PermissionBehavior::Allow),
                mode: None,
                directories: None,
                destination: Some(cc_sdk::PermissionUpdateDestination::Session),
            }],
        };

        let result = handler
            .can_use_tool(
                "Bash",
                &serde_json::json!({ "command": "echo ok" }),
                &context,
            )
            .await;

        assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));

        let captured = sink.lock().expect("sink lock");
        assert_eq!(captured.len(), 1);
        let event = &captured[0];
        let payload = match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::Json(value) => value,
            other => panic!("expected json payload, got {:?}", other),
        };
        let options = payload["params"]["options"]
            .as_array()
            .expect("options should be an array");
        assert_eq!(options.len(), 3);
        assert_eq!(options[1]["kind"], "allow_always");
        assert_eq!(options[1]["optionId"], "allow_always");
    }

    #[tokio::test]
    async fn can_use_tool_falls_back_to_synthetic_id_when_tracker_is_empty() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let bridge = Arc::new(PermissionBridge::new());
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;

        let handler = AcepePermissionHandler {
            session_id: "session-2".to_string(),
            agent_type: provider.parser_agent_type(),
            bridge: bridge.clone(),
            dispatcher,
            tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
        };

        let resolver_bridge = bridge.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            resolver_bridge
                .resolve(
                    1,
                    cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
                        message: "Denied".to_string(),
                        interrupt: false,
                    }),
                )
                .await;
        });

        let context = cc_sdk::ToolPermissionContext {
            signal: None,
            suggestions: Vec::new(),
        };

        let result = handler
            .can_use_tool(
                "Bash",
                &serde_json::json!({ "command": "echo ok" }),
                &context,
            )
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

    #[tokio::test]
    async fn can_use_tool_emits_question_request_for_ask_user_question() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let bridge = Arc::new(PermissionBridge::new());
        let tracker = Arc::new(ToolCallIdTracker::new());
        let pending_questions = Arc::new(Mutex::new(HashMap::new()));
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        tracker
            .record(
                "AskUserQuestion".to_string(),
                "toolu_question_123".to_string(),
            )
            .await;

        let handler = AcepePermissionHandler {
            session_id: "session-ask".to_string(),
            agent_type: provider.parser_agent_type(),
            bridge: bridge.clone(),
            dispatcher,
            tool_call_tracker: tracker,
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            pending_questions,
        };

        let resolver_bridge = bridge.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            resolver_bridge
                .resolve(
                    1,
                    cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                        updated_input: Some(serde_json::json!({
                            "questions": [{
                                "question": "Which branch should I use?",
                                "header": "Branch",
                                "options": [
                                    { "label": "main", "description": "" },
                                    { "label": "dev", "description": "" }
                                ],
                                "multiSelect": false
                            }],
                            "answers": { "Which branch should I use?": "main" }
                        })),
                        updated_permissions: None,
                    }),
                )
                .await;
        });

        let context = cc_sdk::ToolPermissionContext {
            signal: None,
            suggestions: Vec::new(),
        };

        let result = handler
            .can_use_tool(
                "AskUserQuestion",
                &serde_json::json!({
                    "questions": [{
                        "question": "Which branch should I use?",
                        "header": "Branch",
                        "options": [
                            { "label": "main", "description": "" },
                            { "label": "dev", "description": "" }
                        ],
                        "multiSelect": false
                    }]
                }),
                &context,
            )
            .await;

        assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));
        let captured = sink.lock().expect("sink lock");
        assert_eq!(captured.len(), 1);
        let event = &captured[0];
        let update = match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
            other => panic!("expected session update payload, got {:?}", other),
        };

        match update.as_ref() {
            SessionUpdate::QuestionRequest { question, .. } => {
                assert_eq!(question.id, "toolu_question_123");
                assert_eq!(question.session_id, "session-ask");
                assert_eq!(question.json_rpc_request_id, Some(1));
            }
            other => panic!("expected question request, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn annotate_pending_question_request_creates_stream_only_state() {
        let bridge = PermissionBridge::new();
        let pending_questions = Arc::new(Mutex::new(HashMap::new()));
        let mut update = SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: "toolu_stream_only".to_string(),
                session_id: "session-stream".to_string(),
                json_rpc_request_id: None,
                questions: vec![QuestionItem {
                    question: "Pick one".to_string(),
                    header: "Pick one".to_string(),
                    options: vec![],
                    multi_select: false,
                }],
                tool: Some(ToolReference {
                    message_id: String::new(),
                    call_id: "toolu_stream_only".to_string(),
                }),
            },
            session_id: Some("session-stream".to_string()),
        };

        let should_emit =
            annotate_pending_question_request(&bridge, &pending_questions, &mut update).await;

        assert!(should_emit);

        let state = pending_questions
            .lock()
            .await
            .get("toolu_stream_only")
            .cloned()
            .expect("stream-only question state should exist");
        assert_eq!(state.request_id, 0);
        assert!(state.ui_emitted);

        match update {
            SessionUpdate::QuestionRequest { question, .. } => {
                assert_eq!(question.json_rpc_request_id, None);
            }
            other => panic!("expected question request, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn can_use_tool_does_not_duplicate_stream_emitted_question_request() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let bridge = Arc::new(PermissionBridge::new());
        let tracker = Arc::new(ToolCallIdTracker::new());
        let pending_questions = Arc::new(Mutex::new(HashMap::new()));
        let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
        tracker
            .record(
                "AskUserQuestion".to_string(),
                "toolu_question_existing".to_string(),
            )
            .await;

        pending_questions.lock().await.insert(
            "toolu_question_existing".to_string(),
            PendingQuestionState {
                request_id: 0,
                session_id: "session-ask".to_string(),
                questions: Some(vec![QuestionItem {
                    question: "Which branch should I use?".to_string(),
                    header: "Branch".to_string(),
                    options: vec![],
                    multi_select: false,
                }]),
                ui_emitted: true,
            },
        );

        let handler = AcepePermissionHandler {
            session_id: "session-ask".to_string(),
            agent_type: provider.parser_agent_type(),
            bridge: bridge.clone(),
            dispatcher,
            tool_call_tracker: tracker,
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            pending_questions: pending_questions.clone(),
        };

        let resolver_bridge = bridge.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            resolver_bridge
                .resolve(
                    1,
                    cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                        updated_input: Some(serde_json::json!({
                            "questions": [{
                                "question": "Which branch should I use?",
                                "header": "Branch",
                                "options": [],
                                "multiSelect": false
                            }],
                            "answers": { "Which branch should I use?": "main" }
                        })),
                        updated_permissions: None,
                    }),
                )
                .await;
        });

        let context = cc_sdk::ToolPermissionContext {
            signal: None,
            suggestions: Vec::new(),
        };

        let result = handler
            .can_use_tool(
                "AskUserQuestion",
                &serde_json::json!({
                    "questions": [{
                        "question": "Which branch should I use?",
                        "header": "Branch",
                        "options": [],
                        "multiSelect": false
                    }]
                }),
                &context,
            )
            .await;

        assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));
        assert!(sink.lock().expect("sink lock").is_empty());

        let state = pending_questions
            .lock()
            .await
            .get("toolu_question_existing")
            .cloned()
            .expect("question state should still exist until respond removes it");
        assert_eq!(state.request_id, 1);
    }

    #[tokio::test]
    async fn suppresses_stale_agent_chunks_while_stream_only_question_is_pending() {
        let pending_questions = Arc::new(Mutex::new(HashMap::from([(
            "toolu_question_existing".to_string(),
            PendingQuestionState {
                request_id: 0,
                session_id: "session-ask".to_string(),
                questions: Some(vec![QuestionItem {
                    question: "Which branch should I use?".to_string(),
                    header: "Branch".to_string(),
                    options: vec![],
                    multi_select: false,
                }]),
                ui_emitted: true,
            },
        )])));

        let should_suppress = should_suppress_update_while_awaiting_stream_only_question(
            &pending_questions,
            "session-ask",
            &SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "There you go!".to_string(),
                    },
                },
                part_id: None,
                message_id: None,
                session_id: Some("session-ask".to_string()),
            },
        )
        .await;

        assert!(should_suppress);
    }

    #[tokio::test]
    async fn reply_question_waits_for_late_request_binding() {
        let mut client = make_test_client();
        let pending_questions = client.pending_questions.clone();
        let bridge = client.permission_bridge.clone();
        let questions = vec![QuestionItem {
            question: "Which branch should I use?".to_string(),
            header: "Branch".to_string(),
            options: vec![],
            multi_select: false,
        }];

        pending_questions.lock().await.insert(
            "toolu_question_existing".to_string(),
            PendingQuestionState {
                request_id: 0,
                session_id: "session-ask".to_string(),
                questions: Some(questions.clone()),
                ui_emitted: true,
            },
        );

        let binding_task = tokio::spawn({
            let pending_questions = pending_questions.clone();
            let bridge = bridge.clone();
            let questions = questions.clone();

            async move {
                tokio::time::sleep(Duration::from_millis(5)).await;

                let request_id = bridge.next_id();
                let registration = bridge
                    .register(
                        request_id,
                        PendingPermissionKind::Question {
                            tool_call_id: "toolu_question_existing".to_string(),
                            original_input: serde_json::json!({
                                "questions": [{
                                    "question": "Which branch should I use?",
                                    "header": "Branch",
                                    "options": [],
                                    "multiSelect": false
                                }]
                            }),
                        },
                    )
                    .await;

                pending_questions.lock().await.insert(
                    "toolu_question_existing".to_string(),
                    PendingQuestionState {
                        request_id,
                        session_id: "session-ask".to_string(),
                        questions: Some(questions),
                        ui_emitted: true,
                    },
                );

                let resolved = timeout(Duration::from_millis(50), registration.receiver)
                    .await
                    .expect("late question binding should resolve")
                    .expect("question resolution channel closed");

                match resolved {
                    cc_sdk::PermissionResult::Allow(allow) => allow.updated_input,
                    other => panic!("expected allow result, got {:?}", other),
                }
            }
        });

        assert!(client
            .reply_question(
                "toolu_question_existing".to_string(),
                vec![vec!["main".to_string()]],
            )
            .await
            .expect("reply_question should bind to the late request"));

        let updated_input = binding_task.await.expect("binding task should complete");

        assert_eq!(
            updated_input,
            Some(serde_json::json!({
                "questions": [{
                    "question": "Which branch should I use?",
                    "header": "Branch",
                    "options": [],
                    "multiSelect": false
                }],
                "answers": {
                    "Which branch should I use?": "main"
                }
            }))
        );
        assert!(pending_questions.lock().await.is_empty());
    }

    #[tokio::test]
    async fn keeps_question_tool_updates_visible_while_stream_only_question_is_pending() {
        let pending_questions = Arc::new(Mutex::new(HashMap::from([(
            "toolu_question_existing".to_string(),
            PendingQuestionState {
                request_id: 0,
                session_id: "session-ask".to_string(),
                questions: Some(vec![QuestionItem {
                    question: "Which branch should I use?".to_string(),
                    header: "Branch".to_string(),
                    options: vec![],
                    multi_select: false,
                }]),
                ui_emitted: true,
            },
        )])));

        let should_suppress = should_suppress_update_while_awaiting_stream_only_question(
            &pending_questions,
            "session-ask",
            &SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id: "toolu_question_existing".to_string(),
                    status: Some(ToolCallStatus::InProgress),
                    ..Default::default()
                },
                session_id: Some("session-ask".to_string()),
            },
        )
        .await;

        assert!(!should_suppress);
    }

    #[test]
    fn build_question_reply_text_formats_stream_only_follow_up_message() {
        let questions = vec![
            QuestionItem {
                question: "Area?".to_string(),
                header: "Area".to_string(),
                options: vec![],
                multi_select: false,
            },
            QuestionItem {
                question: "Priority?".to_string(),
                header: "Priority".to_string(),
                options: vec![],
                multi_select: true,
            },
        ];

        let reply_text = build_question_reply_text(
            &questions,
            &[
                vec!["Performance".to_string()],
                vec!["Caching".to_string(), "Rendering".to_string()],
            ],
        );

        assert_eq!(
            reply_text,
            "The user answered the questions:\n- \"Area?\": \"Performance\"\n- \"Priority?\": \"Caching, Rendering\""
        );
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
                assert_eq!(
                    description.as_deref(),
                    Some("Find all tool call components")
                );
                assert_eq!(
                    prompt.as_deref(),
                    Some("Inventory tool call cards in the codebase")
                );
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
        client
            .approval_callback_tracker
            .note_tool_use_started("session-1", "Bash", "toolu_old")
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
        assert!(client
            .approval_callback_tracker
            .pending
            .lock()
            .await
            .is_empty());

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
            let updates =
                crate::acp::parsers::cc_sdk_bridge::translate_cc_sdk_message_with_turn_state(
                    message,
                    Some("session-1".to_string()),
                    turn_state.clone(),
                );

            for update in updates {
                if matches!(
                    update,
                    SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }
                ) {
                    let preserved_model = turn_state.model_id.clone();
                    turn_state =
                        crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
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
                        SessionUpdate::ToolCall { tool_call, .. }
                            if tool_call.id == "toolu_task_parent" =>
                        {
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
                assert_eq!(
                    description.as_deref(),
                    Some("Find all tool call components")
                );
                assert_eq!(
                    prompt.as_deref(),
                    Some("Inventory tool call cards in the codebase")
                );
                assert_eq!(subagent_type.as_deref(), Some("Explore"));
            }
            other => panic!("expected think arguments, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_streaming_bridge_completes_unresolved_tool_use_when_next_message_starts() {
        let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
        let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);
        let context = StreamingBridgeContext {
            dispatcher,
            bridge: Arc::new(PermissionBridge::new()),
            tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
            approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
            task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
            provider,
            db: None,
        };

        let stream = futures::stream::iter(vec![
            Ok(cc_sdk::Message::StreamEvent {
                uuid: "msg-start-1".to_string(),
                session_id: "provider-session".to_string(),
                event: serde_json::json!({
                    "type": "message_start",
                    "message": {
                        "content": [],
                        "model": "claude-sonnet-4-6"
                    }
                }),
                parent_tool_use_id: None,
            }),
            Ok(cc_sdk::Message::StreamEvent {
                uuid: "tool-start".to_string(),
                session_id: "provider-session".to_string(),
                event: serde_json::json!({
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {
                        "type": "tool_use",
                        "id": "toolu_search_stuck",
                        "name": "ToolSearch",
                        "input": {}
                    }
                }),
                parent_tool_use_id: None,
            }),
            Ok(cc_sdk::Message::Assistant {
                message: cc_sdk::AssistantMessage {
                    content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                        id: "toolu_search_stuck".to_string(),
                        name: "ToolSearch".to_string(),
                        input: serde_json::json!({
                            "query": "select:AskUserQuestion",
                            "max_results": 1
                        }),
                    })],
                    model: Some("claude-sonnet-4-6".to_string()),
                    usage: None,
                    error: None,
                    parent_tool_use_id: None,
                },
            }),
            Ok(cc_sdk::Message::StreamEvent {
                uuid: "message-delta-tool-use".to_string(),
                session_id: "provider-session".to_string(),
                event: serde_json::json!({
                    "type": "message_delta",
                    "delta": {
                        "stop_reason": "tool_use",
                        "stop_sequence": null
                    }
                }),
                parent_tool_use_id: None,
            }),
            Ok(cc_sdk::Message::StreamEvent {
                uuid: "message-stop-tool-use".to_string(),
                session_id: "provider-session".to_string(),
                event: serde_json::json!({ "type": "message_stop" }),
                parent_tool_use_id: None,
            }),
            Ok(cc_sdk::Message::StreamEvent {
                uuid: "msg-start-2".to_string(),
                session_id: "provider-session".to_string(),
                event: serde_json::json!({
                    "type": "message_start",
                    "message": {
                        "content": [],
                        "model": "claude-sonnet-4-6"
                    }
                }),
                parent_tool_use_id: None,
            }),
        ]);

        run_streaming_bridge(stream, "session-bridge".to_string(), context).await;

        let captured = sink.lock().expect("sink lock");
        let has_completion = captured.iter().any(|event| match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
                matches!(
                    update.as_ref(),
                    SessionUpdate::ToolCallUpdate { update, .. }
                        if update.tool_call_id == "toolu_search_stuck"
                            && update.status == Some(ToolCallStatus::Completed)
                )
            }
            _ => false,
        });

        assert!(
            has_completion,
            "expected the next assistant message_start to settle the prior ToolSearch call"
        );
    }
}
