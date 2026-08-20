use crate::acp::agent_installer::INSTALL_PROGRESS_EVENT;
use crate::acp::event_hub::{AcpEventEnvelope, AcpEventHubState};
use crate::commands::jsonrpc::{
    encode_line, error_response, internal_error, invalid_params, method_not_found, notification,
    notification_params, parse_inbound_line, session_id_from_payload, success_response,
    DispatchOutcome, InboundLine, JsonRpcRequest,
};
use crate::provider_account_usage::PROVIDER_ACCOUNT_USAGE_UPDATED_EVENT;
use crate::voice::events::{
    VOICE_AMPLITUDE_EVENT, VOICE_MODEL_DOWNLOAD_COMPLETE_EVENT, VOICE_MODEL_DOWNLOAD_ERROR_EVENT,
    VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT, VOICE_RECORDING_ERROR_EVENT,
    VOICE_TRANSCRIPTION_COMPLETE_EVENT, VOICE_TRANSCRIPTION_ERROR_EVENT,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Listener, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinSet;
use tokio_stream::wrappers::{LinesStream, UnboundedReceiverStream};
use tokio_stream::StreamExt;

const WORKTREE_SETUP_EVENT: &str = "git:worktree-setup";
const GIT_HEAD_CHANGED_EVENT: &str = "git:head-changed";
const HISTORY_INDEX_CHANGED_EVENT: &str = "history-index-changed";
const SIDECAR_WINDOW_LABEL: &str = "main";

static SIDECAR_ENABLED: AtomicBool = AtomicBool::new(false);
static SIDECAR_ATTACHED: AtomicBool = AtomicBool::new(false);

pub use crate::commands::registry::SIDECAR_COMMAND_NAMES;

const TAURI_EVENT_NAMES: &[&str] = &[
    VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT,
    VOICE_MODEL_DOWNLOAD_COMPLETE_EVENT,
    VOICE_MODEL_DOWNLOAD_ERROR_EVENT,
    VOICE_AMPLITUDE_EVENT,
    VOICE_RECORDING_ERROR_EVENT,
    VOICE_TRANSCRIPTION_COMPLETE_EVENT,
    VOICE_TRANSCRIPTION_ERROR_EVENT,
    HISTORY_INDEX_CHANGED_EVENT,
    WORKTREE_SETUP_EVENT,
    GIT_HEAD_CHANGED_EVENT,
    INSTALL_PROGRESS_EVENT,
    PROVIDER_ACCOUNT_USAGE_UPDATED_EVENT,
];

pub fn enable() {
    SIDECAR_ENABLED.store(true, Ordering::SeqCst);
}

pub fn is_enabled() -> bool {
    SIDECAR_ENABLED.load(Ordering::SeqCst)
}

/// Debug console logs go to stderr when this process is the sidecar, so stdout
/// stays NDJSON. The desktop app keeps stdout.
#[cfg(debug_assertions)]
pub(crate) fn debug_console_writer() -> Box<dyn io::Write + Send> {
    if is_enabled() {
        Box::new(io::stderr())
    } else {
        Box::new(io::stdout())
    }
}

pub fn sidecar_command_name_set() -> HashSet<&'static str> {
    SIDECAR_COMMAND_NAMES.iter().copied().collect()
}

pub fn attach(app: &AppHandle) {
    if !is_enabled() {
        return;
    }
    if SIDECAR_ATTACHED.swap(true, Ordering::SeqCst) {
        return;
    }

    for (_, window) in app.webview_windows() {
        let _ = window.hide();
    }

    let Some(webview) = app.get_webview_window(SIDECAR_WINDOW_LABEL) else {
        tracing::error!(
            window = SIDECAR_WINDOW_LABEL,
            "Sidecar JSON-RPC attach failed: main webview is missing"
        );
        app.exit(1);
        return;
    };

    let (notification_tx, notification_rx) = mpsc::unbounded_channel::<Value>();
    subscribe_event_hub(app, notification_tx.clone());
    subscribe_tauri_events(app, notification_tx);

    let invoke_key = app.invoke_key().to_string();
    let command_names = sidecar_command_name_set();
    let app_for_exit = app.clone();

    tauri::async_runtime::spawn(async move {
        run_stdio_loop(webview, invoke_key, command_names, notification_rx).await;
        app_for_exit.exit(0);
    });
}

fn subscribe_event_hub(app: &AppHandle, tx: mpsc::UnboundedSender<Value>) {
    let Some(hub) = app.try_state::<Arc<AcpEventHubState>>() else {
        tracing::warn!("ACP event hub is unavailable; sidecar will not emit session notifications");
        return;
    };
    let mut receiver = hub.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match receiver.recv().await {
                Ok(envelope) => {
                    if tx.send(notification_from_hub_envelope(&envelope)).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "Sidecar event hub lagged");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

fn subscribe_tauri_events(app: &AppHandle, tx: mpsc::UnboundedSender<Value>) {
    for event_name in TAURI_EVENT_NAMES {
        let tx = tx.clone();
        let event_name_owned = (*event_name).to_string();
        let _ = app.listen_any(*event_name, move |event| {
            let payload = serde_json::from_str::<Value>(event.payload())
                .unwrap_or_else(|_| Value::String(event.payload().to_string()));
            let _ = tx.send(notification_from_tauri_event(&event_name_owned, payload));
        });
    }
}

pub fn notification_from_hub_envelope(envelope: &AcpEventEnvelope) -> Value {
    notification(
        &envelope.event_name,
        notification_params(
            envelope.session_id.clone(),
            envelope.payload.clone(),
            Some(envelope.seq),
        ),
    )
}

pub fn notification_from_tauri_event(event_name: &str, payload: Value) -> Value {
    notification(
        event_name,
        notification_params(session_id_from_payload(&payload), payload, None),
    )
}

async fn run_stdio_loop(
    webview: tauri::WebviewWindow,
    invoke_key: String,
    command_names: HashSet<&'static str>,
    notification_rx: mpsc::UnboundedReceiver<Value>,
) {
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = LinesStream::new(stdin.lines());
    let mut notifications = UnboundedReceiverStream::new(notification_rx);
    let mut in_flight: JoinSet<()> = JoinSet::new();

    loop {
        tokio::select! {
            line = lines.next() => {
                let Some(next_line) = line else {
                    break;
                };
                let line = match next_line {
                    Ok(text) => text,
                    Err(error) => {
                        tracing::error!(error = %error, "Sidecar stdin closed with error");
                        break;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }
                let webview = webview.clone();
                let invoke_key = invoke_key.clone();
                let command_names = command_names.clone();
                in_flight.spawn(async move {
                    if let Some(response) =
                        dispatch_line(&webview, &invoke_key, &command_names, &line).await
                    {
                        write_stdout_line(&response);
                    }
                });
            }
            notification = notifications.next() => {
                match notification {
                    Some(notification) => write_stdout_line(&notification),
                    None => {}
                }
            }
            Some(join_result) = in_flight.join_next() => {
                if let Err(error) = join_result {
                    tracing::error!(error = %error, "Sidecar request task failed");
                }
            }
        }
    }

    while in_flight.join_next().await.is_some() {}
}

async fn dispatch_line(
    webview: &tauri::WebviewWindow,
    invoke_key: &str,
    command_names: &HashSet<&'static str>,
    line: &str,
) -> Option<Value> {
    match parse_inbound_line(line) {
        InboundLine::Invalid { id, error } => Some(error_response(id, error)),
        InboundLine::Notification { .. } => None,
        InboundLine::Request(request) => {
            Some(dispatch_request(webview, invoke_key, command_names, request).await)
        }
    }
}

async fn dispatch_request(
    webview: &tauri::WebviewWindow,
    invoke_key: &str,
    command_names: &HashSet<&'static str>,
    request: JsonRpcRequest,
) -> Value {
    if !command_names.contains(request.method.as_str()) {
        return error_response(Some(request.id), method_not_found(&request.method));
    }

    let params = match request.params {
        None | Some(Value::Null) => json!({}),
        Some(Value::Object(fields)) => Value::Object(fields),
        Some(_) => {
            return error_response(Some(request.id), invalid_params("params must be an object"));
        }
    };

    match invoke_tauri_command(webview, invoke_key, request.method.clone(), params).await {
        DispatchOutcome::Result(result) => success_response(request.id, result),
        DispatchOutcome::Error(error) => error_response(Some(request.id), error),
    }
}

async fn invoke_tauri_command(
    webview: &tauri::WebviewWindow,
    invoke_key: &str,
    command: String,
    params: Value,
) -> DispatchOutcome {
    let url = match webview.url() {
        Ok(url) => url,
        Err(error) => {
            return DispatchOutcome::Error(internal_error(
                "Failed to read webview URL for invoke",
                Some(Value::String(error.to_string())),
            ));
        }
    };

    let (tx, rx) = oneshot::channel();
    let request = InvokeRequest {
        cmd: command.clone(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url,
        body: InvokeBody::Json(params),
        headers: Default::default(),
        invoke_key: invoke_key.to_string(),
    };

    webview.clone().on_message(
        request,
        Box::new(move |_window, _cmd, response, _callback, _error| {
            let _ = tx.send(response);
        }),
    );

    match rx.await {
        Ok(InvokeResponse::Ok(body)) => match invoke_body_to_value(body) {
            Ok(value) => DispatchOutcome::Result(value),
            Err(error) => DispatchOutcome::Error(internal_error(
                "Failed to decode command result",
                Some(Value::String(error.to_string())),
            )),
        },
        Ok(InvokeResponse::Err(error)) => {
            DispatchOutcome::Error(internal_error("Command failed", Some(error.0)))
        }
        Err(_) => DispatchOutcome::Error(internal_error(
            format!("Command {command} did not respond"),
            None,
        )),
    }
}

fn invoke_body_to_value(body: InvokeResponseBody) -> Result<Value, serde_json::Error> {
    match body {
        InvokeResponseBody::Json(json) => serde_json::from_str(&json),
        InvokeResponseBody::Raw(bytes) => Ok(json!(bytes)),
    }
}

fn write_stdout_line(value: &Value) {
    match encode_line(value) {
        Ok(line) => {
            let mut stdout = io::stdout().lock();
            let _ = writeln!(stdout, "{line}");
            let _ = stdout.flush();
        }
        Err(error) => {
            tracing::error!(error = %error, "Failed to encode sidecar NDJSON line");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::event_hub::AcpEventEnvelope;
    use crate::commands::names::COMMANDS;

    fn flatten_command_registry_names(value: &Value, names: &mut Vec<String>) {
        match value {
            Value::String(name) => names.push(name.clone()),
            Value::Object(fields) => {
                for nested in fields.values() {
                    flatten_command_registry_names(nested, names);
                }
            }
            _ => {}
        }
    }

    fn tauri_registry_command_names() -> Vec<String> {
        let value = serde_json::to_value(&COMMANDS).expect("serialize COMMANDS registry");
        let mut names = Vec::new();
        flatten_command_registry_names(&value, &mut names);
        names.sort();
        names.dedup();
        names
    }

    #[test]
    fn sidecar_covers_every_tauri_command_registry_name() {
        let registry = tauri_registry_command_names();
        let sidecar: HashSet<&str> = sidecar_command_name_set();

        let missing: Vec<&String> = registry
            .iter()
            .filter(|name| !sidecar.contains(name.as_str()))
            .collect();
        assert!(
            missing.is_empty(),
            "sidecar is missing Tauri commands: {missing:?}"
        );

        let extra: Vec<&str> = sidecar
            .iter()
            .copied()
            .filter(|name| registry.iter().all(|registry_name| registry_name != name))
            .collect();
        assert!(
            extra.is_empty(),
            "sidecar has commands missing from the Tauri registry: {extra:?}"
        );

        assert_eq!(registry.len(), sidecar.len());
        assert_eq!(
            SIDECAR_COMMAND_NAMES.len(),
            sidecar.len(),
            "sidecar command name list must not contain duplicates"
        );
    }

    #[test]
    fn sidecar_command_names_are_unique() {
        let mut seen = HashSet::new();
        for name in SIDECAR_COMMAND_NAMES {
            assert!(seen.insert(*name), "duplicate sidecar command name: {name}");
        }
    }

    #[test]
    fn unknown_method_is_rejected_before_invoke() {
        let names = sidecar_command_name_set();
        assert!(!names.contains("not_a_real_command"));
        let error = method_not_found("not_a_real_command");
        assert_eq!(error.code, crate::commands::jsonrpc::METHOD_NOT_FOUND);
        assert!(error.message.contains("not_a_real_command"));
    }

    #[test]
    fn hub_notification_is_tagged_with_session() {
        let envelope = AcpEventEnvelope {
            seq: 42,
            event_name: "acp-session-update".to_string(),
            session_id: Some("session-9".to_string()),
            payload: json!({"type": "agentMessageChunk", "text": "hi"}),
            priority: "normal".to_string(),
            droppable: false,
            emitted_at_ms: 1,
        };
        let encoded = notification_from_hub_envelope(&envelope);
        assert!(encoded.get("id").is_none());
        assert_eq!(encoded["method"], "acp-session-update");
        assert_eq!(encoded["params"]["sessionId"], "session-9");
        assert_eq!(encoded["params"]["seq"], 42);
        assert_eq!(encoded["params"]["payload"]["text"], "hi");
    }

    #[test]
    fn tauri_event_notification_reads_session_from_payload() {
        let encoded = notification_from_tauri_event(
            VOICE_TRANSCRIPTION_COMPLETE_EVENT,
            json!({"session_id": "voice-1", "text": "hello"}),
        );
        assert_eq!(encoded["method"], VOICE_TRANSCRIPTION_COMPLETE_EVENT);
        assert_eq!(encoded["params"]["sessionId"], "voice-1");
        assert_eq!(encoded["params"]["payload"]["text"], "hello");
    }

    #[test]
    fn tauri_event_without_session_uses_null_tag() {
        let encoded = notification_from_tauri_event(
            HISTORY_INDEX_CHANGED_EVENT,
            json!({"projectPath": "/tmp"}),
        );
        assert_eq!(encoded["params"]["sessionId"], Value::Null);
    }
}
