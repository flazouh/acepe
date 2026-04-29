use super::*;
use crate::acp::session_registry::redact_session_id;

fn agent_display_name(agent_id: &CanonicalAgentId) -> &str {
    match agent_id {
        CanonicalAgentId::ClaudeCode => "Claude Code",
        CanonicalAgentId::Copilot => "GitHub Copilot",
        CanonicalAgentId::Cursor => "Cursor",
        CanonicalAgentId::OpenCode => "OpenCode",
        CanonicalAgentId::Codex => "Codex",
        CanonicalAgentId::Forge => "Forge",
        CanonicalAgentId::Custom(id) => id.as_str(),
    }
}

fn low_fd_initialize_message(
    agent_id: &CanonicalAgentId,
    error: &crate::acp::error::AcpError,
) -> String {
    let details = match error {
        crate::acp::error::AcpError::JsonRpcError(message)
        | crate::acp::error::AcpError::ProtocolError(message)
        | crate::acp::error::AcpError::InvalidState(message) => message.as_str(),
        _ => "",
    };
    let agent_name = agent_display_name(agent_id);

    if details.is_empty() {
        return format!(
            "{agent_name} failed to start because macOS limited the number of open files available to Acepe.\n\nRelaunch Acepe after increasing the macOS launchd maxfiles limit, or start Acepe from a shell with a higher `ulimit -n`."
        );
    }

    format!(
        "{agent_name} failed to start because macOS limited the number of open files available to Acepe.\n\nAcepe tried to raise the limit automatically, but the agent still reported a file descriptor limit error. Relaunch Acepe after increasing the macOS launchd maxfiles limit, or start Acepe from a shell with a higher `ulimit -n`.\n\nAgent details:\n{details}"
    )
}

/// Create a new agent client and initialize it.
///
/// Extracts the common create → initialize pattern used by all session-creating
/// commands (`acp_new_session`, `acp_resume_session`, `acp_fork_session`).
pub(super) async fn create_and_initialize_client(
    registry: &Arc<AgentRegistry>,
    opencode_manager: &Arc<OpenCodeManagerRegistry>,
    agent_id_enum: CanonicalAgentId,
    app: AppHandle,
    cwd: PathBuf,
    operation: &str,
) -> Result<Box<dyn AgentClient + Send + Sync + 'static>, SerializableAcpError> {
    let mut client = create_client(registry, opencode_manager, agent_id_enum.clone(), app, cwd)
        .await
        .map_err(|e| {
            tracing::error!(agent = %agent_id_enum.as_str(), error = %e, "Failed to create agent client");
            SerializableAcpError::from(e)
        })?;

    timeout(SESSION_CLIENT_OPERATION_TIMEOUT, client.initialize())
        .await
        .map_err(|_| {
            tracing::error!(operation = %operation, "Client initialize timed out");
            SerializableAcpError::Timeout {
                operation: format!("client initialize ({})", operation),
            }
        })?
        .map_err(|e| {
            tracing::warn!(error = %e, "Initialize failed");
            if crate::acp::client_errors::is_low_fd_startup_error(&e) {
                return SerializableAcpError::ProtocolError {
                    message: low_fd_initialize_message(&agent_id_enum, &e),
                };
            }
            SerializableAcpError::from(e)
        })?;

    Ok(client as Box<dyn AgentClient + Send + Sync + 'static>)
}

pub(super) async fn lock_session_client<'a>(
    client_mutex: &'a SessionClientArc,
    operation: &str,
) -> Result<
    tokio::sync::MutexGuard<'a, Box<dyn AgentClient + Send + Sync + 'static>>,
    SerializableAcpError,
> {
    timeout(SESSION_CLIENT_LOCK_TIMEOUT, client_mutex.lock())
        .await
        .map_err(|_| {
            tracing::error!(operation = %operation, "Session client lock timed out (possible deadlock)");
            SerializableAcpError::Timeout {
                operation: operation.to_string(),
            }
        })
}

fn canonicalize_reconnect_error(error: SerializableAcpError) -> SerializableAcpError {
    match error {
        SerializableAcpError::SessionNotFound { .. } => SerializableAcpError::ProtocolError {
            message: "This saved session is no longer available to reopen.".to_string(),
        },
        SerializableAcpError::JsonRpcError { message }
        | SerializableAcpError::ProtocolError { message }
            if message.contains("Method not found") || message.contains("-32601") =>
        {
            SerializableAcpError::ProtocolError {
                message: "This saved session cannot be reopened by the selected agent.".to_string(),
            }
        }
        other => other,
    }
}

fn reconnect_error_allows_cached_ready_snapshot(
    error: &SerializableAcpError,
    _agent_id: &CanonicalAgentId,
) -> bool {
    match error {
        SerializableAcpError::JsonRpcError { message }
        | SerializableAcpError::ProtocolError { message }
        | SerializableAcpError::InvalidState { message } => {
            let normalized = message.to_ascii_lowercase();
            normalized.contains("already loaded")
        }
        _ => false,
    }
}

async fn reconnect_client_session(
    client: &mut (dyn AgentClient + Send + Sync + 'static),
    session_id: &str,
    cwd: &str,
    launch_mode_id: Option<String>,
    operation: &str,
) -> Result<ResumeSessionResponse, SerializableAcpError> {
    timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client.reconnect_session(session_id.to_string(), cwd.to_string(), launch_mode_id),
    )
    .await
    .map_err(|_| {
        tracing::error!(operation = %operation, "Reconnect session timed out");
        SerializableAcpError::Timeout {
            operation: operation.to_string(),
        }
    })?
    .map_err(|error| {
        tracing::error!(operation = %operation, error = %error, "Reconnect session failed");
        canonicalize_reconnect_error(SerializableAcpError::from(error))
    })
}

pub(super) async fn resume_or_create_session_client<F, Fut>(
    session_registry: &SessionRegistry,
    session_id: String,
    cwd: String,
    agent_id: CanonicalAgentId,
    launch_mode_id: Option<String>,
    create_client_fn: F,
) -> Result<ResumeSessionResponse, SerializableAcpError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<
        Output = Result<Box<dyn AgentClient + Send + Sync + 'static>, SerializableAcpError>,
    >,
{
    let force_new_client = launch_mode_id.is_some();

    if !force_new_client {
        if let Ok(existing_client_mutex) = session_registry.get(&session_id) {
            let existing_resume_result = {
                let mut existing_client = lock_session_client(
                    &existing_client_mutex,
                    "acp_resume_session: existing client lock",
                )
                .await?;
                reconnect_client_session(
                    existing_client.as_mut(),
                    &session_id,
                    &cwd,
                    launch_mode_id.clone(),
                    "resume existing session client",
                )
                .await
            };

            if let Ok(response) = existing_resume_result {
                session_registry
                    .cache_ready_snapshot(&session_id, response.clone())
                    .map_err(SerializableAcpError::from)?;
                tracing::info!(session_id = %session_id, "Session resumed: reused existing client");
                return Ok(response);
            }

            if let Err(error) = existing_resume_result {
                if reconnect_error_allows_cached_ready_snapshot(&error, &agent_id) {
                    if let Some(snapshot) = session_registry.get_ready_snapshot(&session_id) {
                        tracing::info!(
                            session_id = %session_id,
                            "Session already loaded on existing client; reusing cached readiness"
                        );
                        return Ok(snapshot);
                    }
                }

                tracing::warn!(
                    session_id = %session_id,
                    error = %error,
                    "Existing session client resume failed, creating replacement client"
                );
            }
        }
    } else if session_registry.get(&session_id).is_ok() {
        tracing::info!(
            session_id = %session_id,
            "Session resume requested with launch mode: creating fresh client"
        );
    }

    let mut client = create_client_fn().await?;
    let result = reconnect_client_session(
        client.as_mut(),
        &session_id,
        &cwd,
        launch_mode_id,
        "resume newly created session client",
    )
    .await
    .map_err(|error| {
        tracing::error!(
            session_id = %session_id,
            error = %error,
            "Session reconnect failed"
        );
        error
    })?;

    if let Some(old_client) = session_registry.store(session_id.clone(), client, agent_id) {
        tracing::warn!(
            session_id = %redact_session_id(&session_id),
            reason = "acp_resume_session replacement after failed reuse",
            "Stopping replaced session client"
        );
        let mut old = lock_session_client(&old_client, "acp_resume_session: replace lock").await?;
        old.stop();
        tracing::warn!(
            session_id = %session_id,
            "Session resumed: created replacement client"
        );
    } else {
        tracing::info!(
            session_id = %session_id,
            "Session resumed: created new client"
        );
    }

    session_registry
        .cache_ready_snapshot(&session_id, result.clone())
        .map_err(SerializableAcpError::from)?;

    Ok(result)
}
