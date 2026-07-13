//! cc-sdk based AgentClient implementation for Claude Code.
//!
//! [`ClaudeCcSdkClient`] communicates with the Claude Code CLI via the `cc_sdk` Rust
//! crate directly — no Bun subprocess or JSON-RPC stdio indirection.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use futures::StreamExt;
use sea_orm::DbConn;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

use crate::acp::capability_resolution::{resolve_static_capabilities, ResolvedCapabilityStatus};
use crate::acp::client::{
    InitializeResponse, ListSessionsResponse, NewSessionResponse, ResumeSessionResponse,
};
use crate::acp::client_session::{
    default_modes, default_session_model_state, SessionModelState, SessionModes,
};
use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::{
    apply_interaction_response_for_request, persist_interaction_transition,
};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::lifecycle::LifecycleStatus;
use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::pending_prompt_registry::{
    discard_pending_prompt_echo, remember_synthetic_user_prompt, synthetic_user_message_update,
};
use crate::acp::projections::{InteractionResponse, InteractionState, ProjectionRegistry};
use crate::acp::provider::{normalize_session_updates_for_runtime, AgentProvider};
use crate::acp::session::ingress::tool_identity::{
    classify_raw_tool_call, ToolClassificationHints,
};
use crate::acp::session_policy::SessionPolicyRegistry;
use crate::acp::session_registry::{bind_provider_session_id_persisted, SessionRegistry};
use crate::acp::session_state_engine::SessionGraphCapabilities;
use crate::acp::session_update::{
    parse_normalized_questions, AvailableCommand, ContextWindowSource, QuestionData, QuestionItem,
    SessionUpdate, ToolCallStatus, ToolCallUpdateData, ToolKind, ToolReference, TurnErrorData,
    TurnErrorInfo, TurnErrorKind, TurnErrorSource, UsageTelemetryData, UsageTelemetryTokens,
};
use crate::acp::streaming_log::{log_debug_event, log_emitted_event, log_streaming_event};
use crate::acp::task_reconciler::TaskReconciler;
use crate::acp::types::{ContentBlock, PromptRequest};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, DispatchPolicy};
use crate::cc_sdk;
use crate::computer_use::{
    build_computer_mcp_server, build_computer_mcp_server_with_runtime, ComputerRuntimeRegistry,
    COMPUTER_MCP_SERVER_NAME,
};

mod permission_handler;
mod permissions;
mod questions;
pub(crate) mod reasoning_config;
mod streaming_bridge;
mod tracking;

#[cfg(test)]
mod tests;

#[cfg(test)]
use permission_handler::{
    build_permission_metadata, build_permission_request_update, build_reusable_permission_key,
};
use permission_handler::{AcepePermissionHandler, AcepePermissionRequestHook};
use questions::{
    annotate_pending_question_request, build_question_answer_map, build_question_reply_text,
    extract_question_answer_map, has_pending_stream_only_question, question_answers_are_empty,
    response_outcome_allows, selected_option_id,
    should_suppress_update_while_awaiting_stream_only_question, take_stream_only_question_state,
    wait_for_question_request_binding,
};
use streaming_bridge::dispatch_cc_sdk_update;
#[cfg(test)]
use streaming_bridge::{
    claude_history_tool_result_update, claude_missing_tool_result_backfill_request,
    collect_cc_sdk_updates_for_dispatch, persist_provider_session_id_alias,
    provider_session_id_from_message, reserve_promoted_claude_session,
};
use streaming_bridge::{run_streaming_bridge, StreamingBridgeContext};
use tracking::{
    clear_pending_approval_callback_diagnostic_for_terminal_update, ApprovalCallbackTracker,
    PendingQuestionState, ToolCallIdTracker,
};

use permissions::{
    build_denied_hook_output, HookPermissionRequest, PermissionBridge, PermissionUiDispatch,
    QuestionPermissionRequest, ToolPermissionRequest,
};

// ---------------------------------------------------------------------------
// ClaudeCcSdkClient
// ---------------------------------------------------------------------------

pub struct ClaudeCcSdkClient {
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
    /// Canonical runtime projection owner for session interactions and operations.
    projection_registry: Arc<ProjectionRegistry>,
    /// Database connection for resolving provider-backed session IDs.
    db: Option<DbConn>,
    /// App handle for descriptor-aware provider identity binding.
    app_handle: Option<AppHandle>,
    pending_mode_id: Option<String>,
    pending_model_id: Option<String>,
    current_cwd: Option<PathBuf>,
    pending_creation_attempt_id: Option<String>,
    /// Per-session reasoning-effort selection, fed into `--effort` per turn.
    reasoning_config: reasoning_config::ClaudeReasoningConfigState,
}

impl ClaudeCcSdkClient {
    pub fn new(
        provider: Arc<dyn AgentProvider>,
        app_handle: AppHandle,
        cwd: PathBuf,
    ) -> AcpResult<Self> {
        let db = app_handle
            .try_state::<DbConn>()
            .map(|state| state.inner().clone());
        let projection_registry = app_handle
            .try_state::<Arc<ProjectionRegistry>>()
            .map(|state| state.inner().clone())
            .unwrap_or_else(|| Arc::new(ProjectionRegistry::new()));
        let dispatcher =
            AcpUiEventDispatcher::new(Some(app_handle.clone()), DispatchPolicy::default());
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
            projection_registry,
            db,
            app_handle: Some(app_handle),
            pending_mode_id: None,
            pending_model_id: None,
            current_cwd: Some(cwd),
            pending_creation_attempt_id: None,
            reasoning_config: reasoning_config::ClaudeReasoningConfigState::default(),
        })
    }

    fn reset_stream_runtime_state(&mut self) {
        // Reconnects should rehydrate durable approvals onto a fresh bridge
        // instead of converting in-flight requests from the previous stream
        // instance into synthetic denials.
        self.permission_bridge = Arc::new(PermissionBridge::new());
        self.tool_call_tracker = Arc::new(ToolCallIdTracker::new());
        self.approval_callback_tracker = Arc::new(ApprovalCallbackTracker::new());
        self.task_reconciler = Arc::new(std::sync::Mutex::new(TaskReconciler::new()));
        self.pending_questions = Arc::new(Mutex::new(HashMap::new()));
    }

    fn reset_pending_mode_for_safe_resume(&mut self) {
        self.pending_mode_id = Some("default".to_string());
    }

    async fn restore_session_permission_approvals(&self, session_id: &str) {
        let _ = self.permission_bridge.drain_all_as_denied().await;

        self.permission_bridge
            .replace_reusable_approval_results(Vec::new())
            .await;
        tracing::debug!(
            session_id = %session_id,
            "Skipped journal-backed permission approval rehydration"
        );
    }

    async fn update_interaction_projection(&self, request_id: u64, result: &Value) {
        let Some(session_id) = self.session_id.as_deref() else {
            return;
        };
        apply_interaction_response_for_request(
            &self.projection_registry,
            self.db.as_ref(),
            Some(&self.dispatcher),
            session_id,
            request_id,
            result,
            "cc-sdk",
        )
        .await;
    }

    #[cfg(test)]
    async fn reject_interaction_for_request(&self, request_id: u64, message: &str) {
        self.update_interaction_projection(
            request_id,
            &serde_json::json!({
                "outcome": { "outcome": "cancelled", "optionId": "reject" },
                "acepeDenyMessage": message,
            }),
        )
        .await;
    }

    async fn resolve_stream_only_question_interaction(
        &self,
        interaction_id: &str,
        session_id: &str,
        questions: &[QuestionItem],
        answers: &[Vec<String>],
    ) {
        let state = if question_answers_are_empty(answers) {
            InteractionState::Rejected
        } else {
            InteractionState::Answered
        };
        let domain_event_kind = if question_answers_are_empty(answers) {
            crate::acp::domain_events::SessionDomainEventKind::InteractionCancelled
        } else {
            crate::acp::domain_events::SessionDomainEventKind::InteractionResolved
        };
        let response = InteractionResponse::Question {
            answers: Value::Object(build_question_answer_map(questions, answers)),
        };

        persist_interaction_transition(
            &self.projection_registry,
            self.db.as_ref(),
            Some(&self.dispatcher),
            session_id,
            interaction_id,
            state,
            domain_event_kind,
            response,
            "cc-sdk stream-only question",
        )
        .await;
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
            projection_registry: self.projection_registry.clone(),
            db: self.db.clone(),
            session_policy: self
                .app_handle
                .as_ref()
                .and_then(|app_handle| {
                    app_handle
                        .try_state::<Arc<SessionPolicyRegistry>>()
                        .map(|state| state.inner().clone())
                })
                .unwrap_or_else(|| Arc::new(SessionPolicyRegistry::new())),
            tool_call_tracker: self.tool_call_tracker.clone(),
            task_reconciler: self.task_reconciler.clone(),
            approval_callback_tracker: self.approval_callback_tracker.clone(),
            pending_questions: self.pending_questions.clone(),
        };
        let permission_request_hook = AcepePermissionRequestHook {
            session_id: session_id.to_string(),
            agent_type: self.provider.parser_agent_type(),
            bridge: self.permission_bridge.clone(),
            dispatcher: self.dispatcher.clone(),
            projection_registry: self.projection_registry.clone(),
            db: self.db.clone(),
            session_policy: self
                .app_handle
                .as_ref()
                .and_then(|app_handle| {
                    app_handle
                        .try_state::<Arc<SessionPolicyRegistry>>()
                        .map(|state| state.inner().clone())
                })
                .unwrap_or_else(|| Arc::new(SessionPolicyRegistry::new())),
            task_reconciler: self.task_reconciler.clone(),
            approval_callback_tracker: self.approval_callback_tracker.clone(),
        };

        let mut builder = cc_sdk::ClaudeCodeOptions::builder()
            .cwd(PathBuf::from(cwd))
            .session_id(session_id.to_string());
        builder = builder.include_partial_messages(true);
        builder = builder.setting_sources(vec![
            cc_sdk::SettingSource::User,
            cc_sdk::SettingSource::Project,
            cc_sdk::SettingSource::Local,
        ]);
        builder = builder.permission_mode(map_to_claude_permission_mode(
            &self.provider.resolve_runtime_mode_id(
                self.pending_mode_id.as_deref(),
                std::path::Path::new(cwd),
            ),
        ));

        if let Some(model_id) = &self.pending_model_id {
            builder = builder.model(model_id.clone());
        }

        if let Some(effort) = self.reasoning_config.effort {
            builder = builder.effort(effort);
        }

        if let Some(resume_session_id) = resume {
            builder = builder.resume(resume_session_id);
        }

        if fork {
            builder = builder.fork_session(true);
        }

        let computer_mcp_server = self
            .app_handle
            .as_ref()
            .and_then(|app_handle| {
                app_handle
                    .try_state::<Arc<ComputerRuntimeRegistry>>()
                    .map(|state| {
                        build_computer_mcp_server_with_runtime(
                            state.inner().runtime_for_session(session_id),
                        )
                    })
            })
            .unwrap_or_else(build_computer_mcp_server);

        builder = builder.add_mcp_server(
            COMPUTER_MCP_SERVER_NAME.to_string(),
            computer_mcp_server.to_config(),
        );

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
        selected_model_id: Option<String>,
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
        let projection_registry = self.projection_registry.clone();
        let tracker = self.tool_call_tracker.clone();
        let task_reconciler = self.task_reconciler.clone();
        let pending_questions = self.pending_questions.clone();
        let approval_callback_tracker = self.approval_callback_tracker.clone();
        let provider = self.provider.clone();
        let sid = session_id.clone();
        let db = self.db.clone();
        let app_handle = self.app_handle.clone();
        let pending_creation_attempt_id = self.pending_creation_attempt_id.clone();
        let project_path = self.current_cwd.clone();
        let context = StreamingBridgeContext {
            dispatcher,
            bridge,
            projection_registry,
            tool_call_tracker: tracker,
            approval_callback_tracker,
            task_reconciler,
            pending_questions,
            provider,
            db,
            app_handle,
            pending_creation_attempt_id,
            project_path,
            initial_context_capability: context_window_capability_update(
                &session_id,
                selected_model_id.as_deref(),
            ),
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
        let available_models = self.discover_models_from_provider_cli().await;

        if !available_models.is_empty() {
            model_state.available_models = available_models;
        }

        if let Some(model_id) = &self.pending_model_id {
            model_state.current_model_id = Some(model_id.clone());
        } else if model_state.current_model_id.as_deref() == Some("auto")
            && model_state.available_models.len() == 1
        {
            if let Some(model) = model_state.available_models.first() {
                model_state.current_model_id = Some(model.model_id.clone());
            }
        }
        let cwd = self
            .current_cwd
            .clone()
            .unwrap_or_else(|| PathBuf::from("."));
        let status = if model_state.available_models.is_empty() {
            ResolvedCapabilityStatus::Partial
        } else {
            ResolvedCapabilityStatus::Resolved
        };
        if let Ok(resolved_capabilities) = resolve_static_capabilities(
            self.provider.as_ref(),
            cwd.as_path(),
            status,
            model_state.clone(),
            self.provider.default_session_modes(),
        ) {
            model_state = SessionModelState {
                available_models: resolved_capabilities.available_models,
                current_model_id: resolved_capabilities.current_model_id,
                models_display: resolved_capabilities.models_display,
                provider_metadata: Some(resolved_capabilities.provider_metadata),
            };
        }

        tracing::info!(
            provider = %self.provider.id(),
            current_model_id = ?model_state.current_model_id,
            available_model_ids = ?model_state
                .available_models
                .iter()
                .map(|model| model.model_id.clone())
                .collect::<Vec<_>>(),
            "cc-sdk hydrated session model state"
        );

        model_state
    }

    fn hydrated_session_modes(&self) -> SessionModes {
        self.provider.default_session_modes()
    }

    async fn hydrated_session_available_commands(&self, cwd: &str) -> Vec<AvailableCommand> {
        let cwd_path = PathBuf::from(cwd);
        match self
            .provider
            .list_session_commands(self.app_handle.as_ref(), Some(cwd_path.as_path()))
            .await
        {
            Ok(commands) => commands,
            Err(error) => {
                tracing::warn!(
                    provider = %self.provider.id(),
                    error = %error,
                    "failed to hydrate cc-sdk session slash commands"
                );
                Vec::new()
            }
        }
    }

    async fn discover_models_from_provider_cli(&self) -> Vec<crate::acp::client::AvailableModel> {
        // For Claude Code: read the authoritative catalog snapshot rather than
        // shelling out to `claude -p "..."` which costs a real API call per hydration.
        // The catalog is warmed at startup and invalidated on install, so this is a
        // cheap in-process read.
        if let Some(app) = self.app_handle.as_ref() {
            let read =
                crate::acp::providers::claude_code_model_catalog::read_catalog_snapshot_for_app(
                    app,
                )
                .await;
            if let Some(snapshot) = read.snapshot {
                return crate::acp::providers::claude_code_model_catalog::filter_to_picker_defaults(
                    &snapshot.models,
                );
            }
        }
        Vec::new()
    }

    async fn connect_pending_session_with_initial_prompt(
        &mut self,
        initial_prompt: String,
    ) -> AcpResult<()> {
        let session_id = self.session_id.clone().ok_or_else(|| {
            AcpError::InvalidState(
                "cc-sdk session not initialized; call new_session or resume_session first"
                    .to_string(),
            )
        })?;
        let cwd = self.current_cwd.clone().ok_or_else(|| {
            AcpError::InvalidState(
                "cc-sdk session cwd missing; call new_session or resume_session first".to_string(),
            )
        })?;
        let cwd_string = cwd.to_string_lossy().into_owned();
        let available_models = self.discover_models_from_provider_cli().await;
        let available_model_ids = available_models
            .iter()
            .map(|model| model.model_id.clone())
            .collect::<Vec<_>>();
        self.sanitize_pending_model_for_connect(&available_model_ids);
        let selected_model_id = self.pending_model_id.clone().or_else(|| {
            crate::acp::providers::claude_code::settings::configured_claude_model_id(
                &cwd,
                &available_model_ids,
            )
        });
        let options = self.build_options(&cwd_string, &session_id, None, false);
        tracing::info!(
            session_id = %session_id,
            prompt_len = initial_prompt.len(),
            "cc-sdk: first prompt — connecting with initial message..."
        );
        self.connect_and_start_bridge(options, session_id, Some(initial_prompt), selected_model_id)
            .await
    }

    async fn apply_runtime_mode(&self, mode_id: &str) -> AcpResult<()> {
        let Some(sdk_client) = &self.sdk_client else {
            return Ok(());
        };
        let permission_mode = self
            .current_cwd
            .as_deref()
            .map(|cwd| self.provider.resolve_runtime_mode_id(Some(mode_id), cwd))
            .unwrap_or_else(|| mode_id.to_string());

        sdk_client
            .lock()
            .await
            .set_permission_mode(claude_permission_mode_name(map_to_claude_permission_mode(
                &permission_mode,
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

    fn sanitize_pending_model_for_connect(&mut self, available_model_ids: &[String]) {
        let Some(pending_model_id) = self.pending_model_id.as_ref() else {
            return;
        };
        if available_model_ids.is_empty() {
            self.pending_model_id = None;
            return;
        }
        if !available_model_ids
            .iter()
            .any(|model_id| model_id == pending_model_id)
        {
            self.pending_model_id = None;
        }
    }
}

fn map_to_claude_permission_mode(mode_id: &str) -> cc_sdk::PermissionMode {
    match mode_id {
        "plan" => cc_sdk::PermissionMode::Plan,
        "acceptEdits" => cc_sdk::PermissionMode::AcceptEdits,
        "bypassPermissions" => cc_sdk::PermissionMode::BypassPermissions,
        _ => cc_sdk::PermissionMode::Default,
    }
}

fn context_window_capability_update(
    session_id: &str,
    selected_model_id: Option<&str>,
) -> Option<SessionUpdate> {
    let selected_model_id = selected_model_id?.trim();
    let context_window_size =
        crate::acp::providers::claude_code::context_window::context_window_for_selection(
            selected_model_id,
        );
    let context_window_source = if context_window_size.is_some() {
        ContextWindowSource::ProviderModelCapability
    } else {
        ContextWindowSource::Unknown
    };

    Some(SessionUpdate::UsageTelemetryUpdate {
        data: UsageTelemetryData {
            session_id: session_id.to_string(),
            event_id: None,
            scope: "session".to_string(),
            cost_usd: None,
            tokens: UsageTelemetryTokens::default(),
            source_model_id: Some(selected_model_id.to_string()),
            timestamp_ms: None,
            context_window_size,
            context_window_source: Some(context_window_source),
            parent_tool_use_id: None,
        },
    })
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

// ---------------------------------------------------------------------------
// AgentClient trait implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl AgentClient for ClaudeCcSdkClient {
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

    fn bind_pending_creation_attempt(
        &mut self,
        attempt_id: Option<String>,
        pending_model_id: Option<String>,
        pending_mode_id: Option<String>,
    ) {
        self.pending_creation_attempt_id = attempt_id;
        self.pending_model_id = pending_model_id;
        self.pending_mode_id = pending_mode_id;
    }

    async fn new_session(&mut self, cwd: String) -> AcpResult<NewSessionResponse> {
        let session_id = Uuid::new_v4().to_string();
        self.reset_stream_runtime_state();
        self.current_cwd = Some(PathBuf::from(&cwd));
        self.restore_session_permission_approvals(&session_id).await;
        self.session_id = Some(session_id.clone());
        let models = self.hydrated_session_model_state().await;
        let available_commands = self.hydrated_session_available_commands(&cwd).await;
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
            creation_attempt_id: None,
            deferred_creation: false,
            sequence_id: None,
            session_open: None,
            models,
            modes: self.hydrated_session_modes(),
            available_commands,
            config_options: reasoning_config::build_claude_reasoning_config_options(
                &self.reasoning_config,
            ),
        })
    }

    fn begin_pre_reservation_drain(&self, session_id: &str) {
        self.dispatcher.begin_pre_reservation_drain(session_id);
    }

    fn drain_pre_reservation_events(&self, session_id: &str) {
        self.dispatcher.drain_pre_reservation_events(session_id);
    }

    fn discard_pre_reservation_events(&self, session_id: &str, reason: &'static str) {
        self.dispatcher
            .discard_pre_reservation_events(session_id, reason);
    }

    fn publishes_user_prompt_on_send(&self) -> bool {
        true
    }

    async fn resume_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        self.reset_stream_runtime_state();
        self.current_cwd = Some(PathBuf::from(&cwd));
        // Only clear stale autonomous mode when we're reusing an existing live
        // client. For freshly created clients, `pending_mode_id` was either left
        // at its default (None → Default) or intentionally seeded via
        // `seed_client_launch_mode` to carry a launch execution profile such as
        // `bypassPermissions`; resetting it here would silently drop the caller's
        // autonomous selection.
        if self.sdk_client.is_some() {
            self.reset_pending_mode_for_safe_resume();
        }
        self.restore_session_permission_approvals(&session_id).await;
        let history_session_id = self.history_session_id_for_app_session(&session_id).await;
        if !self.session_has_persisted_history(&session_id, &cwd).await {
            self.session_id = Some(session_id.clone());
            let models = self.hydrated_session_model_state().await;
            let available_commands = self.hydrated_session_available_commands(&cwd).await;
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
                modes: self.hydrated_session_modes(),
                available_commands,
                config_options: reasoning_config::build_claude_reasoning_config_options(
                    &self.reasoning_config,
                ),
            });
        }

        let models = self.hydrated_session_model_state().await;
        let available_commands = self.hydrated_session_available_commands(&cwd).await;
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
        let selected_model_id = models.current_model_id.clone();
        self.connect_and_start_bridge(options, session_id, None, selected_model_id)
            .await?;
        Ok(ResumeSessionResponse {
            models,
            modes: self.hydrated_session_modes(),
            available_commands,
            config_options: reasoning_config::build_claude_reasoning_config_options(
                &self.reasoning_config,
            ),
        })
    }

    async fn reconnect_session(
        &mut self,
        session_id: String,
        cwd: String,
        _launch_mode_id: Option<String>,
    ) -> AcpResult<ResumeSessionResponse> {
        self.resume_session(session_id, cwd).await
    }

    async fn fork_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<NewSessionResponse> {
        let new_session_id = Uuid::new_v4().to_string();
        self.reset_stream_runtime_state();
        self.current_cwd = Some(PathBuf::from(&cwd));
        self.restore_session_permission_approvals(&new_session_id)
            .await;
        let models = self.hydrated_session_model_state().await;
        let available_commands = self.hydrated_session_available_commands(&cwd).await;
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
        let selected_model_id = models.current_model_id.clone();
        self.connect_and_start_bridge(options, new_session_id.clone(), None, selected_model_id)
            .await?;
        Ok(NewSessionResponse {
            session_id: new_session_id,
            creation_attempt_id: None,
            deferred_creation: false,
            sequence_id: None,
            session_open: None,
            models,
            modes: self.hydrated_session_modes(),
            available_commands,
            config_options: reasoning_config::build_claude_reasoning_config_options(
                &self.reasoning_config,
            ),
        })
    }

    async fn set_session_model(&mut self, session_id: String, model_id: String) -> AcpResult<()> {
        self.pending_model_id = Some(model_id.clone());
        self.apply_runtime_model(&model_id).await?;
        if let Some(update) = context_window_capability_update(&session_id, Some(&model_id)) {
            dispatch_cc_sdk_update(
                &self.dispatcher,
                &self.task_reconciler,
                self.provider.as_ref(),
                update,
            );
        }
        Ok(())
    }

    async fn set_session_mode(&mut self, session_id: String, mode_id: String) -> AcpResult<()> {
        self.pending_mode_id = Some(mode_id.clone());
        if self.sdk_client.is_some() {
            self.apply_runtime_mode(&mode_id).await?;
            return Ok(());
        }
        let _ = session_id;
        Ok(())
    }

    async fn set_session_config_option(
        &mut self,
        _session_id: String,
        config_id: String,
        value: String,
    ) -> AcpResult<Value> {
        match config_id.as_str() {
            reasoning_config::REASONING_CONFIG_ID => {
                let config_options =
                    reasoning_config::set_reasoning_effort(&mut self.reasoning_config, &value)?;
                Ok(serde_json::json!({ "configOptions": config_options }))
            }
            other => Err(AcpError::ProtocolError(format!(
                "Unsupported Claude config option: {other}"
            ))),
        }
    }

    async fn send_prompt(&mut self, request: PromptRequest) -> AcpResult<Value> {
        self.send_prompt_fire_and_forget(request).await?;
        Ok(Value::Null)
    }

    async fn send_prompt_fire_and_forget(&mut self, request: PromptRequest) -> AcpResult<()> {
        let synthetic_user_update = synthetic_user_message_update(
            &request.session_id,
            &request.prompt,
            request.attempt_id.as_deref(),
        );
        if let Some(update) = synthetic_user_update.as_ref() {
            remember_synthetic_user_prompt(update);
            self.dispatcher
                .enqueue(AcpUiEvent::session_update(update.clone()));
        }

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

        let send_result = if self.sdk_client.is_none() {
            let result = self.connect_pending_session_with_initial_prompt(text).await;
            if result.is_ok() {
                tracing::info!(session_id = ?self.session_id, prompt_len = text_len, "cc-sdk: connected with initial prompt");
            }
            result
        } else {
            // Subsequent prompts: send via the existing client.
            self.send_user_message_text(text).await
        };

        if send_result.is_err() && synthetic_user_update.is_some() {
            discard_pending_prompt_echo(&request.session_id);
        }

        send_result
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
            // Mark the interrupt before issuing it so the streaming bridge can
            // normalize the SDK's resulting generic `is_error` result into a
            // canonical cancellation instead of a spurious turn failure.
            self.permission_bridge.mark_cancel_requested().await;
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
                let question_items = stream_only_question.questions.clone().unwrap_or_default();
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
                self.resolve_stream_only_question_interaction(
                    &request_id,
                    &stream_only_question.session_id,
                    &question_items,
                    &answers,
                )
                .await;
                self.dispatcher
                    .enqueue(AcpUiEvent::session_update(SessionUpdate::TurnComplete {
                        session_id: Some(stream_only_question.session_id),
                        turn_id: None,
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
            let question_items = stream_only_question.questions.clone().unwrap_or_default();
            let stream_only_session_id = stream_only_question.session_id.clone();
            let stream_only_tool_call_id = request_id.clone();
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
                        tool_call_id: stream_only_tool_call_id,
                        status: Some(ToolCallStatus::Completed),
                        ..Default::default()
                    },
                    session_id: Some(stream_only_session_id.clone()),
                }));
            self.resolve_stream_only_question_interaction(
                &request_id,
                &stream_only_session_id,
                &question_items,
                &answers,
            )
            .await;
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
                            "kind": kind.label(),
                            "toolCallId": kind.tool_call_id(),
                            "allowed": response_outcome_allows(&result),
                            "optionId": selected_option_id(&result),
                        }),
                    );
                }
            }
        }

        self.update_interaction_projection(request_id, &result)
            .await;

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
