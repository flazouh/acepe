use super::*;
use crate::commands::observability::{expected_acp_command_result, CommandResult};

/// Set the model for a session
#[tauri::command]
#[specta::specta]
pub async fn acp_set_model(
    app: AppHandle,
    session_id: String,
    model_id: String,
) -> CommandResult<()> {
    expected_acp_command_result("acp_set_model", async {
    tracing::debug!(session_id = %session_id, model_id = %model_id, "acp_set_model called");
    let session_registry = app.state::<SessionRegistry>();

    // Get the client for this specific session
    let client_mutex = session_registry.get(&session_id).map_err(|e| {
        tracing::error!(session_id = %session_id, error = %e, "Session not found for set_model");
        SerializableAcpError::from(e)
    })?;

    let mut client_guard = lock_session_client(&client_mutex, "acp_set_model: lock").await?;
    let result = timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client_guard.set_session_model(session_id, model_id.clone()),
    )
    .await
    .map_err(|_| {
        tracing::error!("acp_set_model operation timed out");
        SerializableAcpError::Timeout {
            operation: "acp_set_model: operation".to_string(),
        }
    })?
    .map_err(SerializableAcpError::from);

    result
    }
    .await)
}

/// Set the mode for a session
#[tauri::command]
#[specta::specta]
pub async fn acp_set_mode(
    app: AppHandle,
    session_id: String,
    mode_id: String,
) -> CommandResult<()> {
    expected_acp_command_result("acp_set_mode", async {
    tracing::debug!(session_id = %session_id, mode_id = %mode_id, "acp_set_mode called");
    let session_registry = app.state::<SessionRegistry>();

    // Get the client for this specific session
    let client_mutex = session_registry.get(&session_id).map_err(|e| {
        tracing::error!(session_id = %session_id, error = %e, "Session not found for set_mode");
        SerializableAcpError::from(e)
    })?;

    let mut client_guard = lock_session_client(&client_mutex, "acp_set_mode: lock").await?;
    let result = timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client_guard.set_session_mode(session_id, mode_id.clone()),
    )
    .await
    .map_err(|_| {
        tracing::error!("acp_set_mode operation timed out");
        SerializableAcpError::Timeout {
            operation: "acp_set_mode: operation".to_string(),
        }
    })?
    .map_err(SerializableAcpError::from);

    result
    }
    .await)
}

/// Set a configuration option for a session
#[tauri::command]
#[specta::specta]
pub async fn acp_set_config_option(
    app: AppHandle,
    session_id: String,
    config_id: String,
    value: String,
) -> CommandResult<Value> {
    expected_acp_command_result("acp_set_config_option", async {
    tracing::debug!(session_id = %session_id, config_id = %config_id, value = %value, "acp_set_config_option called");
    let session_registry = app.state::<SessionRegistry>();

    let client_mutex = session_registry
        .get(&session_id)
        .map_err(|e| {
            tracing::error!(session_id = %session_id, error = %e, "Session not found for set_config_option");
            SerializableAcpError::from(e)
        })?;

    let mut client_guard =
        lock_session_client(&client_mutex, "acp_set_config_option: lock").await?;
    let result = timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client_guard.set_session_config_option(session_id, config_id.clone(), value.clone()),
    )
    .await
    .map_err(|_| {
        tracing::error!("acp_set_config_option operation timed out");
        SerializableAcpError::Timeout {
            operation: "acp_set_config_option: operation".to_string(),
        }
    })?
    .map_err(SerializableAcpError::from);

    result
    }
    .await)
}

/// Send a prompt to a session (fire-and-forget)
///
/// This command returns immediately after sending the prompt to the subprocess.
/// The actual response will arrive via session/update notifications which are
/// emitted as Tauri events (`acp-session-update`).
#[tauri::command]
#[specta::specta]
pub async fn acp_send_prompt(
    app: AppHandle,
    session_id: String,
    request: Value,
) -> CommandResult<()> {
    expected_acp_command_result("acp_send_prompt", async {
    tracing::debug!(session_id = %session_id, "acp_send_prompt called");

    // Deserialize the request Value to a typed PromptRequest
    // Enable streaming to get incremental message updates via session/update notifications
    let mut prompt_request: PromptRequest = serde_json::from_value(json!({
        "sessionId": session_id,
        "prompt": request,
        "stream": true
    }))
    .map_err(|e| SerializableAcpError::SerializationError {
        message: e.to_string(),
    })?;

    // Expand @[text:BASE64] tokens into <pasted-content> blocks before any backend
    // sees the prompt. This is the common chokepoint for all agent clients
    // (ACP subprocess, cc_sdk, OpenCode HTTP).
    crate::acp::attachment_token_expander::expand_text_tokens(&mut prompt_request);

    let session_registry = app.state::<SessionRegistry>();

    // Get the client for this specific session
    let client_mutex = session_registry.get(&session_id).map_err(|e| {
        tracing::error!(session_id = %session_id, error = %e, "Session not found for send_prompt");
        SerializableAcpError::from(e)
    })?;

    let mut client_guard = lock_session_client(&client_mutex, "acp_send_prompt: lock").await?;
    let result = timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client_guard.send_prompt_fire_and_forget(prompt_request),
    )
    .await
    .map_err(|_| {
        tracing::error!(session_id = %session_id, "acp_send_prompt operation timed out");
        SerializableAcpError::Timeout {
            operation: "acp_send_prompt: operation".to_string(),
        }
    })?
    .map_err(SerializableAcpError::from);

    result
    }
    .await)
}

/// Cancel a session
#[tauri::command]
#[specta::specta]
pub async fn acp_cancel(app: AppHandle, session_id: String) -> CommandResult<()> {
    expected_acp_command_result("acp_cancel", async {
    tracing::debug!(session_id = %session_id, "acp_cancel called");
    let session_registry = app.state::<SessionRegistry>();

    // Get the client for this specific session
    let client_mutex = session_registry.get(&session_id).map_err(|e| {
        tracing::error!(session_id = %session_id, error = %e, "Session not found for cancel");
        SerializableAcpError::from(e)
    })?;

    let mut client_guard = lock_session_client(&client_mutex, "acp_cancel: lock").await?;
    let result = timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client_guard.cancel(session_id),
    )
    .await
    .map_err(|_| {
        tracing::error!("acp_cancel operation timed out");
        SerializableAcpError::Timeout {
            operation: "acp_cancel: operation".to_string(),
        }
    })?
    .map_err(SerializableAcpError::from);
    result
    }
    .await)
}
