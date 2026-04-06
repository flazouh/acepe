use super::codex_native_config::{
    build_codex_native_new_session_response, build_codex_native_resume_session_response,
    build_codex_turn_start_params_from_input, default_codex_native_config_state,
    set_codex_native_config_option, set_codex_native_model, CodexInteractionMode,
    CodexNativeConfigState, CodexTurnInputItem,
};
use super::codex_native_events::translate_codex_native_server_message;
use crate::acp::client::{
    InitializeResponse, ListSessionsResponse, NewSessionResponse, ResumeSessionResponse,
    SessionInfo,
};
use crate::acp::client_loop::{
    new_stderr_buffer, read_stderr_buffer, spawn_stderr_reader, StderrBuffer,
};
use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::write_serialized_line;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::provider::AgentProvider;
use crate::acp::streaming_log::{log_emitted_event, log_streaming_event};
use crate::acp::types::{ContentBlock, EmbeddedResource, PromptRequest};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, DispatchPolicy};
use async_trait::async_trait;
use sea_orm::DbConn;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc as StdArc;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const REQUEST_TIMEOUT_SECS: u64 = 30;
const THREAD_NOT_FOUND_SNIPPET: &str = "thread not found";
const THREAD_RESUME_TIMEOUT_SNIPPET: &str = "timed out waiting for server";

type ChildHandle = StdArc<std::sync::Mutex<Option<Child>>>;
type PendingCodexRequests = StdArc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

pub struct CodexNativeClient {
    provider: StdArc<dyn AgentProvider>,
    cwd: PathBuf,
    dispatcher: AcpUiEventDispatcher,
    db: Option<DbConn>,
    child: ChildHandle,
    stdin_writer: StdArc<Mutex<Option<ChildStdin>>>,
    pending_requests: PendingCodexRequests,
    request_id: StdArc<std::sync::Mutex<u64>>,
    stderr_buffer: Option<StderrBuffer>,
    stdout_reader_cancel: CancellationToken,
    stdout_reader_task: Option<tauri::async_runtime::JoinHandle<()>>,
    active_session_id: StdArc<Mutex<Option<String>>>,
    pending_question_ids: StdArc<Mutex<HashMap<String, Vec<String>>>>,
    session_id: Option<String>,
    provider_thread_id: Option<String>,
    config_state: CodexNativeConfigState,
    current_mode_id: String,
    initialized: bool,
}

impl CodexNativeClient {
    pub fn new(
        provider: StdArc<dyn AgentProvider>,
        app_handle: AppHandle,
        cwd: PathBuf,
    ) -> AcpResult<Self> {
        let db = app_handle
            .try_state::<DbConn>()
            .map(|state| state.inner().clone());
        let dispatcher = AcpUiEventDispatcher::new(Some(app_handle), DispatchPolicy::default());

        Ok(Self {
            provider,
            cwd,
            dispatcher,
            db,
            child: StdArc::new(std::sync::Mutex::new(None)),
            stdin_writer: StdArc::new(Mutex::new(None)),
            pending_requests: StdArc::new(Mutex::new(HashMap::new())),
            request_id: StdArc::new(std::sync::Mutex::new(1)),
            stderr_buffer: None,
            stdout_reader_cancel: CancellationToken::new(),
            stdout_reader_task: None,
            active_session_id: StdArc::new(Mutex::new(None)),
            pending_question_ids: StdArc::new(Mutex::new(HashMap::new())),
            session_id: None,
            provider_thread_id: None,
            config_state: default_codex_native_config_state(),
            current_mode_id: "build".to_string(),
            initialized: false,
        })
    }

    async fn send_request(&self, method: &str, params: Value) -> AcpResult<Value> {
        let id = next_request_id(&self.request_id)?;
        let message = json!({
            "id": id,
            "method": method,
            "params": params,
        });
        let (tx, rx) = oneshot::channel();
        self.pending_requests.lock().await.insert(id, tx);

        if let Err(error) = write_message(&self.stdin_writer, &message).await {
            self.pending_requests.lock().await.remove(&id);
            return Err(error);
        }

        let response = timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS), rx)
            .await
            .map_err(|_| {
                AcpError::Timeout(format!("{} (after {}s)", method, REQUEST_TIMEOUT_SECS))
            })?
            .map_err(|_| AcpError::ChannelClosed)?;

        if let Some(error) = response.get("error") {
            let message = serde_json::to_string(error).unwrap_or_else(|_| error.to_string());
            return Err(AcpError::JsonRpcError(message));
        }

        response
            .get("result")
            .cloned()
            .ok_or_else(|| AcpError::ProtocolError(format!("{} returned no result", method)))
    }

    async fn send_notification(&self, method: &str, params: Option<Value>) -> AcpResult<()> {
        let message = match params {
            Some(params) => json!({ "method": method, "params": params }),
            None => json!({ "method": method }),
        };
        write_message(&self.stdin_writer, &message).await
    }

    async fn open_thread(
        &mut self,
        session_id: &str,
        cwd: &str,
        resume_thread_id: Option<String>,
    ) -> AcpResult<String> {
        let thread_result = if let Some(thread_id) = resume_thread_id.clone() {
            let params = json!({
                "threadId": thread_id,
                "cwd": cwd,
            });
            match self.send_request("thread/resume", params).await {
                Ok(result) => result,
                Err(error) if is_recoverable_thread_resume_error(&error) => {
                    self.send_request("thread/start", json!({ "cwd": cwd }))
                        .await?
                }
                Err(error) => return Err(error),
            }
        } else {
            self.send_request("thread/start", json!({ "cwd": cwd }))
                .await?
        };

        let provider_thread_id = parse_thread_id(&thread_result).ok_or_else(|| {
            AcpError::ProtocolError(
                "Codex thread open response did not include a thread id".to_string(),
            )
        })?;

        self.provider_thread_id = Some(provider_thread_id.clone());
        persist_provider_thread_id(
            self.db.as_ref(),
            session_id,
            self.provider.id(),
            cwd,
            &provider_thread_id,
        )
        .await;
        Ok(provider_thread_id)
    }

    async fn build_new_session_response(&self, session_id: String) -> NewSessionResponse {
        let mut response = build_codex_native_new_session_response(session_id);
        response.modes.current_mode_id = self.current_mode_id.clone();
        response
    }

    async fn build_resume_session_response(&self) -> ResumeSessionResponse {
        let mut response = build_codex_native_resume_session_response(&self.config_state);
        response.modes.current_mode_id = self.current_mode_id.clone();
        response
    }
}

#[async_trait]
impl AgentClient for CodexNativeClient {
    async fn start(&mut self) -> AcpResult<()> {
        if self
            .child
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|_| ()))
            .is_some()
        {
            return Ok(());
        }

        let spawn_config = self.provider.spawn_config();
        let mut command = Command::new(&spawn_config.command);
        command
            .args(&spawn_config.args)
            .envs(&spawn_config.env)
            .current_dir(&self.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| AcpError::InvalidState(format!("Failed to spawn Codex: {error}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AcpError::InvalidState("Codex stdin was not piped".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AcpError::InvalidState("Codex stdout was not piped".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AcpError::InvalidState("Codex stderr was not piped".to_string()))?;

        *self.stdin_writer.lock().await = Some(stdin);

        let stderr_buffer = new_stderr_buffer();
        spawn_stderr_reader(stderr, 512, stderr_buffer.clone());
        self.stderr_buffer = Some(stderr_buffer.clone());

        let pending_requests = self.pending_requests.clone();
        let dispatcher = self.dispatcher.clone();
        let cancel = self.stdout_reader_cancel.clone();
        let active_session_id = self.active_session_id.clone();
        let pending_question_ids = self.pending_question_ids.clone();
        let db = self.db.clone();

        self.stdout_reader_task = Some(tauri::async_runtime::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    line = lines.next_line() => {
                        match line {
                            Ok(Some(line)) => {
                                let message: Value = match serde_json::from_str(&line) {
                                    Ok(value) => value,
                                    Err(error) => {
                                        let reason = format!("Received invalid JSON from codex app-server: {error}");
                                        fail_pending_requests(&pending_requests, &reason).await;
                                        dispatch_transport_error(&dispatcher, &active_session_id, &reason, crate::acp::session_update::TurnErrorSource::Transport).await;
                                        break;
                                    }
                                };

                                if let Some(response_id) = message.get("id").and_then(parse_request_id) {
                                    if message.get("result").is_some() || message.get("error").is_some() {
                                        if let Some(sender) = pending_requests.lock().await.remove(&response_id) {
                                            let _ = sender.send(message);
                                        }
                                        continue;
                                    }
                                }

                                remember_question_ids(&pending_question_ids, &message).await;
                                persist_thread_id_alias(&db, &active_session_id, &message).await;

                                let session_id = active_session_id.lock().await.clone();
                                let Some(session_id) = session_id else {
                                    continue;
                                };

                                log_streaming_event(&session_id, &message);

                                for update in translate_codex_native_server_message(&session_id, &message) {
                                    log_emitted_event(&session_id, &update);
                                    dispatcher.enqueue(AcpUiEvent::session_update(update));
                                }
                            }
                            Ok(None) => {
                                if cancel.is_cancelled() {
                                    break;
                                }
                                let reason = read_stderr_buffer(&stderr_buffer)
                                    .map(|stderr| format!("Codex app-server exited unexpectedly:\n{stderr}"))
                                    .unwrap_or_else(|| "Codex app-server exited unexpectedly".to_string());
                                fail_pending_requests(&pending_requests, &reason).await;
                                dispatch_transport_error(&dispatcher, &active_session_id, &reason, crate::acp::session_update::TurnErrorSource::Process).await;
                                break;
                            }
                            Err(error) => {
                                let reason = format!("Failed reading Codex stdout: {error}");
                                fail_pending_requests(&pending_requests, &reason).await;
                                dispatch_transport_error(&dispatcher, &active_session_id, &reason, crate::acp::session_update::TurnErrorSource::Transport).await;
                                break;
                            }
                        }
                    }
                }
            }
        }));

        if let Ok(mut guard) = self.child.lock() {
            *guard = Some(child);
        }

        Ok(())
    }

    async fn initialize(&mut self) -> AcpResult<InitializeResponse> {
        if self.initialized {
            return Ok(build_initialize_response(self.provider.as_ref()));
        }

        self.send_request("initialize", build_codex_initialize_params())
            .await?;
        self.send_notification("initialized", None).await?;
        self.initialized = true;
        Ok(build_initialize_response(self.provider.as_ref()))
    }

    async fn new_session(&mut self, cwd: String) -> AcpResult<NewSessionResponse> {
        let session_id = Uuid::new_v4().to_string();
        self.session_id = Some(session_id.clone());
        *self.active_session_id.lock().await = Some(session_id.clone());
        self.open_thread(&session_id, &cwd, None).await?;
        Ok(self.build_new_session_response(session_id).await)
    }

    async fn resume_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        self.session_id = Some(session_id.clone());
        *self.active_session_id.lock().await = Some(session_id.clone());
        let resume_thread_id =
            provider_thread_id_for_app_session(self.db.as_ref(), &session_id).await;
        self.open_thread(&session_id, &cwd, resume_thread_id)
            .await?;
        Ok(self.build_resume_session_response().await)
    }

    async fn fork_session(
        &mut self,
        _session_id: String,
        _cwd: String,
    ) -> AcpResult<NewSessionResponse> {
        Err(AcpError::ProtocolError(
            "Codex native fork_session is not supported yet".to_string(),
        ))
    }

    async fn set_session_model(&mut self, _session_id: String, model_id: String) -> AcpResult<()> {
        set_codex_native_model(&mut self.config_state, &model_id)
    }

    async fn set_session_mode(&mut self, _session_id: String, mode_id: String) -> AcpResult<()> {
        if mode_id != "build" && mode_id != "plan" {
            return Err(AcpError::ProtocolError(format!(
                "Unsupported Codex mode: {mode_id}"
            )));
        }
        self.current_mode_id = mode_id;
        Ok(())
    }

    async fn set_session_config_option(
        &mut self,
        _session_id: String,
        config_id: String,
        value: String,
    ) -> AcpResult<Value> {
        let config_options =
            set_codex_native_config_option(&mut self.config_state, &config_id, &value)?;
        Ok(json!({ "configOptions": config_options }))
    }

    async fn send_prompt(&mut self, request: PromptRequest) -> AcpResult<Value> {
        let provider_thread_id = self.provider_thread_id.clone().ok_or_else(|| {
            AcpError::InvalidState("Codex session is missing a provider thread id".to_string())
        })?;
        let input = content_blocks_to_codex_input(&request.prompt)?;
        let interaction_mode = if self.current_mode_id == "plan" {
            Some(CodexInteractionMode::Plan)
        } else {
            Some(CodexInteractionMode::Default)
        };
        let params = build_codex_turn_start_params_from_input(
            &provider_thread_id,
            input,
            &self.config_state,
            interaction_mode,
        );
        let payload = serde_json::to_value(params).map_err(AcpError::SerializationError)?;
        let response = self.send_request("turn/start", payload).await?;
        if parse_turn_id(&response).is_none() {
            return Err(AcpError::ProtocolError(
                "turn/start response did not include a turn id".to_string(),
            ));
        }
        Ok(response)
    }

    async fn send_prompt_fire_and_forget(&mut self, request: PromptRequest) -> AcpResult<()> {
        self.send_prompt(request).await.map(|_| ())
    }

    async fn cancel(&mut self, _session_id: String) -> AcpResult<()> {
        let provider_thread_id = self.provider_thread_id.clone().ok_or_else(|| {
            AcpError::InvalidState("Codex session is missing a provider thread id".to_string())
        })?;
        self.send_request("turn/interrupt", json!({ "threadId": provider_thread_id }))
            .await
            .map(|_| ())
    }

    async fn list_sessions(&mut self, _cwd: Option<String>) -> AcpResult<ListSessionsResponse> {
        let sessions = match &self.session_id {
            Some(session_id) => vec![SessionInfo {
                session_id: session_id.clone(),
                cwd: self.cwd.to_string_lossy().into_owned(),
                title: None,
                updated_at: None,
            }],
            None => Vec::new(),
        };
        Ok(ListSessionsResponse {
            sessions,
            next_cursor: None,
        })
    }

    async fn reply_permission(&mut self, request_id: String, reply: String) -> AcpResult<bool> {
        let request_id = request_id.parse::<u64>().map_err(|_| {
            AcpError::ProtocolError(format!("Invalid Codex permission request id: {request_id}"))
        })?;
        let decision = map_permission_reply(&reply)?;
        write_message(
            &self.stdin_writer,
            &json!({
                "id": request_id,
                "result": { "decision": decision }
            }),
        )
        .await?;
        Ok(true)
    }

    async fn reply_question(
        &mut self,
        request_id: String,
        answers: Vec<Vec<String>>,
    ) -> AcpResult<bool> {
        let parsed_request_id = request_id.parse::<u64>().map_err(|_| {
            AcpError::ProtocolError(format!("Invalid Codex question request id: {request_id}"))
        })?;
        let question_ids = self.pending_question_ids.lock().await.remove(&request_id);
        let result = build_question_reply_result(question_ids.as_deref(), answers)?;
        write_message(
            &self.stdin_writer,
            &json!({
                "id": parsed_request_id,
                "result": result,
            }),
        )
        .await?;
        Ok(true)
    }

    fn stop(&mut self) {
        self.stdout_reader_cancel.cancel();
        if let Some(handle) = self.stdout_reader_task.take() {
            handle.abort();
        }

        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.start_kill();
            }
            *guard = None;
        }

        if let Ok(mut pending) = self.pending_requests.try_lock() {
            for (_request_id, sender) in pending.drain() {
                let _ = sender.send(json!({
                    "error": { "message": "Codex client stopped" }
                }));
            }
        }

        if let Ok(mut question_ids) = self.pending_question_ids.try_lock() {
            question_ids.clear();
        }

        self.session_id = None;
        self.provider_thread_id = None;
    }
}

fn build_initialize_response(provider: &dyn AgentProvider) -> InitializeResponse {
    InitializeResponse {
        protocol_version: 1,
        agent_capabilities: json!({
            "nativeCodex": true,
            "configOptions": true,
        }),
        agent_info: json!({
            "name": provider.name(),
            "id": provider.id(),
        }),
        auth_methods: vec![],
    }
}

fn build_codex_initialize_params() -> Value {
    json!({
        "clientInfo": {
            "name": "acepe_desktop",
            "title": "Acepe Desktop",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": {
            "experimentalApi": true,
        },
    })
}

fn next_request_id(request_id: &StdArc<std::sync::Mutex<u64>>) -> AcpResult<u64> {
    let mut guard = request_id
        .lock()
        .map_err(|_| AcpError::InvalidState("Codex request ID mutex poisoned".to_string()))?;
    let current = *guard;
    *guard += 1;
    Ok(current)
}

async fn write_message(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    message: &Value,
) -> AcpResult<()> {
    let encoded = serde_json::to_string(message).map_err(AcpError::SerializationError)?;
    write_serialized_line(stdin_writer, &encoded).await
}

fn parse_request_id(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|entry| entry.parse::<u64>().ok()))
}

fn parse_thread_id(result: &Value) -> Option<String> {
    result
        .get("thread")
        .and_then(Value::as_object)
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            result
                .get("threadId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
}

fn parse_turn_id(result: &Value) -> Option<String> {
    result
        .get("turn")
        .and_then(Value::as_object)
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn is_recoverable_thread_resume_error(error: &AcpError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("thread/resume")
        && (message.contains(THREAD_NOT_FOUND_SNIPPET)
            || message.contains(THREAD_RESUME_TIMEOUT_SNIPPET))
}

fn map_permission_reply(reply: &str) -> AcpResult<&'static str> {
    match reply {
        "once" => Ok("accept"),
        "always" => Ok("acceptForSession"),
        "reject" => Ok("decline"),
        _ => Err(AcpError::ProtocolError(format!(
            "Unsupported Codex permission reply: {reply}"
        ))),
    }
}

fn build_question_reply_result(
    question_ids: Option<&[String]>,
    answers: Vec<Vec<String>>,
) -> AcpResult<Value> {
    if answers.is_empty() {
        return Ok(json!({ "answers": {} }));
    }

    let Some(question_ids) = question_ids else {
        return Err(AcpError::ProtocolError(
            "Codex question ids were not available for the reply".to_string(),
        ));
    };

    if question_ids.len() < answers.len() {
        return Err(AcpError::ProtocolError(
            "Codex question reply included more answers than questions".to_string(),
        ));
    }

    let answers = question_ids
        .iter()
        .zip(answers)
        .map(|(question_id, selected_answers)| {
            (
                question_id.clone(),
                json!({
                    "answers": selected_answers,
                }),
            )
        })
        .collect::<serde_json::Map<String, Value>>();

    Ok(Value::Object(
        [("answers".to_string(), Value::Object(answers))]
            .into_iter()
            .collect(),
    ))
}

fn content_blocks_to_codex_input(prompt: &[ContentBlock]) -> AcpResult<Vec<CodexTurnInputItem>> {
    let mut input = Vec::new();

    for block in prompt {
        match block {
            ContentBlock::Text { text } => {
                if !text.trim().is_empty() {
                    input.push(CodexTurnInputItem::Text {
                        text: text.clone(),
                        text_elements: Vec::new(),
                    });
                }
            }
            ContentBlock::Image {
                data,
                mime_type,
                uri,
            } => {
                input.push(CodexTurnInputItem::Image {
                    url: image_url(uri.as_deref(), mime_type, data),
                });
            }
            ContentBlock::Resource { resource } => append_embedded_resource(resource, &mut input),
            ContentBlock::ResourceLink { uri, mime_type, .. } => {
                if mime_type
                    .as_deref()
                    .is_some_and(|value| value.starts_with("image/"))
                {
                    input.push(CodexTurnInputItem::Image { url: uri.clone() });
                } else if !uri.trim().is_empty() {
                    input.push(CodexTurnInputItem::Text {
                        text: uri.clone(),
                        text_elements: Vec::new(),
                    });
                }
            }
            ContentBlock::Audio { .. } => {
                return Err(AcpError::ProtocolError(
                    "Codex native client does not support audio prompt blocks".to_string(),
                ));
            }
        }
    }

    if input.is_empty() {
        return Err(AcpError::ProtocolError(
            "Codex prompt must include text or image content".to_string(),
        ));
    }

    Ok(input)
}

fn append_embedded_resource(resource: &EmbeddedResource, input: &mut Vec<CodexTurnInputItem>) {
    if let Some(text) = resource
        .text
        .as_ref()
        .filter(|text| !text.trim().is_empty())
    {
        input.push(CodexTurnInputItem::Text {
            text: text.clone(),
            text_elements: Vec::new(),
        });
        return;
    }

    if let (Some(blob), Some(mime_type)) = (&resource.blob, &resource.mime_type) {
        if mime_type.starts_with("image/") {
            input.push(CodexTurnInputItem::Image {
                url: image_url(None, mime_type, blob),
            });
            return;
        }
    }

    if !resource.uri.trim().is_empty() {
        input.push(CodexTurnInputItem::Text {
            text: resource.uri.clone(),
            text_elements: Vec::new(),
        });
    }
}

fn image_url(uri: Option<&str>, mime_type: &str, data: &str) -> String {
    uri.filter(|entry| !entry.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("data:{};base64,{}", mime_type, data))
}

async fn fail_pending_requests(pending_requests: &PendingCodexRequests, reason: &str) {
    let mut pending = pending_requests.lock().await;
    for (_request_id, sender) in pending.drain() {
        let _ = sender.send(json!({
            "error": { "message": reason }
        }));
    }
}

async fn dispatch_transport_error(
    dispatcher: &AcpUiEventDispatcher,
    active_session_id: &StdArc<Mutex<Option<String>>>,
    reason: &str,
    source: crate::acp::session_update::TurnErrorSource,
) {
    let session_id = active_session_id.lock().await.clone();
    if let Some(session_id) = session_id {
        dispatcher.enqueue(AcpUiEvent::session_update(
            crate::acp::session_update::SessionUpdate::TurnError {
                error: crate::acp::session_update::TurnErrorData::Structured(
                    crate::acp::session_update::TurnErrorInfo {
                        message: reason.to_string(),
                        kind: crate::acp::session_update::TurnErrorKind::Fatal,
                        code: None,
                        source: Some(source),
                    },
                ),
                session_id: Some(session_id),
            },
        ));
    }
}

async fn remember_question_ids(
    pending_question_ids: &StdArc<Mutex<HashMap<String, Vec<String>>>>,
    message: &Value,
) {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };
    if method != "item/tool/requestUserInput" {
        return;
    }

    let Some(request_id) = message.get("id").and_then(parse_request_id) else {
        return;
    };

    let question_ids = message
        .get("params")
        .and_then(|params| params.get("questions"))
        .and_then(Value::as_array)
        .map(|questions| {
            questions
                .iter()
                .filter_map(|question| {
                    question
                        .get("id")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    pending_question_ids
        .lock()
        .await
        .insert(request_id.to_string(), question_ids);
}

async fn persist_thread_id_alias(
    db: &Option<DbConn>,
    active_session_id: &StdArc<Mutex<Option<String>>>,
    message: &Value,
) {
    let Some(db) = db.as_ref() else {
        return;
    };
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };
    if method != "thread/started" {
        return;
    }

    let Some(provider_thread_id) = message
        .get("params")
        .and_then(|params| params.get("thread"))
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
    else {
        return;
    };

    let session_id = active_session_id.lock().await.clone();
    let Some(session_id) = session_id else {
        return;
    };

    let _ = crate::db::repository::SessionMetadataRepository::set_provider_session_id(
        db,
        &session_id,
        provider_thread_id,
    )
    .await;
}

async fn provider_thread_id_for_app_session(
    db: Option<&DbConn>,
    session_id: &str,
) -> Option<String> {
    let db = db?;
    crate::db::repository::SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.provider_session_id)
}

async fn persist_provider_thread_id(
    db: Option<&DbConn>,
    session_id: &str,
    agent_id: &str,
    cwd: &str,
    provider_thread_id: &str,
) {
    let Some(db) = db else {
        return;
    };

    let _ = crate::db::repository::SessionMetadataRepository::ensure_exists(
        db, session_id, cwd, agent_id, None,
    )
    .await;

    let _ = crate::db::repository::SessionMetadataRepository::set_provider_session_id(
        db,
        session_id,
        provider_thread_id,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::ContentBlock;

    #[test]
    fn permission_replies_map_to_codex_decisions() {
        assert_eq!(
            map_permission_reply("once").expect("once should map"),
            "accept"
        );
        assert_eq!(
            map_permission_reply("always").expect("always should map"),
            "acceptForSession"
        );
        assert_eq!(
            map_permission_reply("reject").expect("reject should map"),
            "decline"
        );
        assert!(map_permission_reply("later").is_err());
    }

    #[test]
    fn question_replies_use_original_question_ids() {
        let result = build_question_reply_result(
            Some(&["scope".to_string(), "compat".to_string()]),
            vec![
                vec!["Project".to_string()],
                vec!["Keep current envelope".to_string()],
            ],
        )
        .expect("question reply should build");

        assert_eq!(result["answers"]["scope"]["answers"], json!(["Project"]));
        assert_eq!(
            result["answers"]["compat"]["answers"],
            json!(["Keep current envelope"])
        );
    }

    #[test]
    fn prompt_content_conversion_supports_text_and_images() {
        let input = content_blocks_to_codex_input(&[
            ContentBlock::Text {
                text: "Inspect this image".to_string(),
            },
            ContentBlock::Image {
                data: "AAAA".to_string(),
                mime_type: "image/png".to_string(),
                uri: None,
            },
        ])
        .expect("prompt blocks should convert");

        assert!(matches!(input[0], CodexTurnInputItem::Text { .. }));
        assert!(matches!(input[1], CodexTurnInputItem::Image { .. }));
    }

    #[test]
    fn recoverable_thread_resume_errors_match_known_cases() {
        assert!(is_recoverable_thread_resume_error(&AcpError::JsonRpcError(
            "thread/resume failed: thread not found".to_string(),
        )));
        assert!(is_recoverable_thread_resume_error(&AcpError::JsonRpcError(
            "thread/resume failed: timed out waiting for server".to_string(),
        )));
        assert!(!is_recoverable_thread_resume_error(
            &AcpError::JsonRpcError("thread/start failed: permission denied".to_string(),)
        ));
    }
}
