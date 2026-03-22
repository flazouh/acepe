use crate::acp::client_transport::write_serialized_line;
use crate::acp::error::{AcpError, AcpResult};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc as StdArc;
use tokio::process::ChildStdin;
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};

fn next_request_id(request_id: &StdArc<std::sync::Mutex<u64>>) -> AcpResult<u64> {
    let mut id = request_id
        .lock()
        .map_err(|_| AcpError::InvalidState("Request ID mutex poisoned".to_string()))?;
    let current = *id;
    *id += 1;
    Ok(current)
}

fn is_subprocess_death_jsonrpc_error(error: &Value) -> bool {
    error
        .get("code")
        .and_then(|code| code.as_i64())
        .is_some_and(|code| code == -32001)
}

fn is_method_not_found_jsonrpc_error(error: &Value) -> bool {
    let code_is_method_not_found = error
        .get("code")
        .and_then(|code| code.as_i64())
        .is_some_and(|code| code == -32601);
    if code_is_method_not_found {
        return true;
    }

    error
        .get("message")
        .and_then(|message| message.as_str())
        .is_some_and(|message| message.contains("Method not found"))
}

pub(crate) async fn send_request(
    request_id: &StdArc<std::sync::Mutex<u64>>,
    pending_requests: &StdArc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    method: &str,
    params: Value,
    request_timeout_secs: u64,
) -> AcpResult<Value> {
    let id = next_request_id(request_id)?;

    tracing::debug!(method = %method, id = id, "Sending request");
    let request = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    });

    let request_str = serde_json::to_string(&request).map_err(AcpError::SerializationError)?;
    let (tx, rx) = oneshot::channel();

    {
        let mut pending = pending_requests.lock().await;
        pending.insert(id, tx);
    }

    tracing::debug!(request = %request_str, "Writing request to stdin");

    if let Err(error) = write_serialized_line(stdin_writer, &request_str).await {
        pending_requests.lock().await.remove(&id);
        return Err(error);
    }

    tracing::debug!(
        id = id,
        timeout_secs = request_timeout_secs,
        "Waiting for response"
    );

    let response = match timeout(Duration::from_secs(request_timeout_secs), rx).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => {
            tracing::error!(id = id, "Response channel closed");
            pending_requests.lock().await.remove(&id);
            return Err(AcpError::ChannelClosed);
        }
        Err(_) => {
            tracing::error!(id = id, method = %method, "Request timed out after {}s", request_timeout_secs);
            pending_requests.lock().await.remove(&id);
            return Err(AcpError::Timeout(format!(
                "{} (after {}s)",
                method, request_timeout_secs
            )));
        }
    };

    tracing::debug!(id = id, "Received response");

    if let Some(error) = response.get("error") {
        let error_str = serde_json::to_string(error).unwrap_or_else(|_| format!("{:?}", error));
        if is_method_not_found_jsonrpc_error(error) {
            tracing::warn!(error = %error_str, "Method not found in response");
        } else if is_subprocess_death_jsonrpc_error(error) {
            tracing::warn!(error = %error_str, "Subprocess terminated, request failed");
        } else {
            tracing::error!(error = %error_str, "Error in response");
        }
        return Err(AcpError::JsonRpcError(error_str));
    }

    response
        .get("result")
        .cloned()
        .ok_or_else(|| AcpError::ProtocolError("No result in response".to_string()))
}

pub(crate) async fn respond(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    id: u64,
    result: Value,
) -> AcpResult<()> {
    let response = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    });

    let response_str = serde_json::to_string(&response).map_err(AcpError::SerializationError)?;
    tracing::debug!(id = id, response = %response_str, "Sending response to inbound request");
    write_serialized_line(stdin_writer, &response_str).await?;
    tracing::debug!(id = id, "Response sent successfully");
    Ok(())
}

pub(crate) async fn send_prompt_fire_and_forget(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    request_id: &StdArc<std::sync::Mutex<u64>>,
    prompt_request_sessions: &StdArc<Mutex<HashMap<u64, String>>>,
    session_id: String,
    method: &str,
    params: Value,
) -> AcpResult<()> {
    let id = next_request_id(request_id)?;

    let request_json = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    });

    let request_str = serde_json::to_string(&request_json).map_err(AcpError::SerializationError)?;

    {
        let mut prompt_sessions = prompt_request_sessions.lock().await;
        prompt_sessions.insert(id, session_id.clone());
        tracing::debug!(id = id, session_id = %session_id, "Tracking prompt request for TurnComplete");
    }

    tracing::debug!(id = id, "Sending prompt (fire-and-forget)");

    if let Err(error) = write_serialized_line(stdin_writer, &request_str).await {
        prompt_request_sessions.lock().await.remove(&id);
        return Err(error);
    }

    tracing::debug!(
        id = id,
        "Prompt sent (fire-and-forget), returning immediately"
    );
    Ok(())
}

pub(crate) async fn send_notification(
    stdin_writer: &StdArc<Mutex<Option<ChildStdin>>>,
    method: &str,
    params: Value,
) -> AcpResult<()> {
    let notification = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params
    });

    let notification_str =
        serde_json::to_string(&notification).map_err(AcpError::SerializationError)?;

    write_serialized_line(stdin_writer, &notification_str).await
}
