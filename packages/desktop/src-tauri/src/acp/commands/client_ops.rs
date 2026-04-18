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

async fn resume_client_session(
    client: &mut (dyn AgentClient + Send + Sync + 'static),
    session_id: &str,
    cwd: &str,
    operation: &str,
) -> Result<ResumeSessionResponse, SerializableAcpError> {
    timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client.resume_session(session_id.to_string(), cwd.to_string()),
    )
    .await
    .map_err(|_| {
        tracing::error!(operation = %operation, "Resume session timed out");
        SerializableAcpError::Timeout {
            operation: operation.to_string(),
        }
    })?
    .map_err(|e| {
        tracing::error!(operation = %operation, error = %e, "Resume session failed");
        SerializableAcpError::from(e)
    })
}

async fn load_client_session(
    client: &mut (dyn AgentClient + Send + Sync + 'static),
    session_id: &str,
    cwd: &str,
    operation: &str,
) -> Result<ResumeSessionResponse, SerializableAcpError> {
    timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client.load_session(session_id.to_string(), cwd.to_string()),
    )
    .await
    .map_err(|_| {
        tracing::error!(operation = %operation, "Load session timed out");
        SerializableAcpError::Timeout {
            operation: operation.to_string(),
        }
    })?
    .map_err(|e| {
        tracing::error!(operation = %operation, error = %e, "Load session failed");
        SerializableAcpError::from(e)
    })
}

fn should_load_session(agent_id: &CanonicalAgentId) -> bool {
    matches!(agent_id, CanonicalAgentId::Copilot)
}

async fn reconnect_client_session(
    client: &mut (dyn AgentClient + Send + Sync + 'static),
    session_id: &str,
    cwd: &str,
    agent_id: &CanonicalAgentId,
    operation: &str,
) -> Result<ResumeSessionResponse, SerializableAcpError> {
    if should_load_session(agent_id) {
        return load_client_session(client, session_id, cwd, operation).await;
    }

    resume_client_session(client, session_id, cwd, operation).await
}

async fn seed_client_launch_mode(
    client: &mut (dyn AgentClient + Send + Sync + 'static),
    session_id: &str,
    mode_id: String,
    operation: &str,
) -> Result<(), SerializableAcpError> {
    timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client.set_session_mode(session_id.to_string(), mode_id),
    )
    .await
    .map_err(|_| {
        tracing::error!(operation = %operation, "Seed launch mode timed out");
        SerializableAcpError::Timeout {
            operation: operation.to_string(),
        }
    })?
    .map_err(|error| {
        tracing::error!(operation = %operation, error = %error, "Seed launch mode failed");
        SerializableAcpError::from(error)
    })
}

pub(super) async fn resume_or_create_session_client<F, Fut>(
    session_registry: &SessionRegistry,
    session_id: String,
    cwd: String,
    agent_id: CanonicalAgentId,
    force_new_client: bool,
    launch_mode_id: Option<String>,
    create_client_fn: F,
) -> Result<ResumeSessionResponse, SerializableAcpError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<
        Output = Result<Box<dyn AgentClient + Send + Sync + 'static>, SerializableAcpError>,
    >,
{
    let use_load_session = should_load_session(&agent_id);
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
                    &agent_id,
                    "resume existing session client",
                )
                .await
            };

            if let Ok(response) = existing_resume_result {
                tracing::info!(session_id = %session_id, "Session resumed: reused existing client");
                return Ok(response);
            }

            if let Err(error) = existing_resume_result {
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
            "Skipping existing session client reuse because launch mode requires a fresh client"
        );
    }

    let mut client = create_client_fn().await?;
    if let Some(mode_id) = launch_mode_id {
        seed_client_launch_mode(
            client.as_mut(),
            &session_id,
            mode_id,
            "resume newly created session client: seed launch mode",
        )
        .await?;
    }
    let result = reconnect_client_session(
        client.as_mut(),
        &session_id,
        &cwd,
        &agent_id,
        "resume newly created session client",
    )
    .await
    .map_err(|error| {
        tracing::error!(
            session_id = %session_id,
            error = %error,
            use_load_session,
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

    Ok(result)
}
