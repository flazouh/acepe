use super::*;
use crate::analytics;

fn agent_display_name(agent_id: &CanonicalAgentId) -> &str {
    match agent_id {
        CanonicalAgentId::ClaudeCode => "Claude Code",
        CanonicalAgentId::Cursor => "Cursor",
        CanonicalAgentId::OpenCode => "OpenCode",
        CanonicalAgentId::Codex => "Codex",
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
    // Tag Sentry so client creation/initialization errors carry agent context
    analytics::set_sentry_agent_context(agent_id_enum.as_str(), None);

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

pub(super) async fn resume_or_create_session_client<F, Fut>(
    session_registry: &SessionRegistry,
    session_id: String,
    cwd: String,
    agent_id: CanonicalAgentId,
    create_client_fn: F,
) -> Result<ResumeSessionResponse, SerializableAcpError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<
        Output = Result<Box<dyn AgentClient + Send + Sync + 'static>, SerializableAcpError>,
    >,
{
    if let Ok(existing_client_mutex) = session_registry.get(&session_id) {
        let existing_resume_result = {
            let mut existing_client = lock_session_client(
                &existing_client_mutex,
                "acp_resume_session: existing client lock",
            )
            .await?;
            resume_client_session(
                existing_client.as_mut(),
                &session_id,
                &cwd,
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

    let mut client = create_client_fn().await?;
    let result = resume_client_session(
        client.as_mut(),
        &session_id,
        &cwd,
        "resume newly created session client",
    )
    .await
    .map_err(|error| {
        tracing::error!(session_id = %session_id, error = %error, "Resume session failed");
        error
    })?;

    if let Some(old_client) = session_registry.store(session_id.clone(), client, agent_id) {
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
