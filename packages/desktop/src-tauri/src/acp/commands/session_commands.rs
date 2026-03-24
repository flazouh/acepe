use super::*;
use crate::db::repository::SessionMetadataRepository;
use crate::acp::session_registry::redact_session_id;
use sea_orm::DbConn;

/// Initialize the ACP connection.
///
/// With per-session clients, this is now a lightweight check.
/// Actual initialization happens per-session in acp_new_session.
#[tauri::command]
#[specta::specta]
pub async fn acp_initialize(_app: AppHandle) -> Result<InitializeResponse, SerializableAcpError> {
    tracing::info!("acp_initialize called (per-session architecture - no global client)");

    // Return a mock response - real initialization happens per-session
    Ok(InitializeResponse {
        protocol_version: 1,
        agent_capabilities: serde_json::json!({}),
        agent_info: serde_json::json!({}),
        auth_methods: vec![],
    })
}

#[tauri::command]
#[specta::specta]
pub async fn acp_get_event_bridge_info(
    app: AppHandle,
) -> Result<AcpEventBridgeInfo, SerializableAcpError> {
    let hub = app.state::<Arc<AcpEventHubState>>();
    hub.get_bridge_info().await.ok_or_else(|| {
        tracing::error!("ACP event bridge server not initialized");
        SerializableAcpError::InvalidState {
            message: "ACP event bridge server not initialized".to_string(),
        }
    })
}

/// Create a new ACP session.
///
/// Each session gets its own dedicated client and subprocess.
/// This eliminates mutex contention between sessions.
#[tauri::command]
#[specta::specta]
pub async fn acp_new_session(
    app: AppHandle,
    cwd: String,
    agent_id: Option<String>,
) -> Result<NewSessionResponse, SerializableAcpError> {
    tracing::info!(cwd = %cwd, agent_id = ?agent_id, "acp_new_session called (creating dedicated client)");
    let cwd = validate_session_cwd(&cwd, ProjectAccessReason::Other)?;
    let registry = app.state::<Arc<AgentRegistry>>();
    let active_agent = app.state::<ActiveAgent>();
    let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();
    let session_registry = app.state::<SessionRegistry>();

    // Determine which agent to use
    let agent_id_enum = agent_id
        .as_deref()
        .map(CanonicalAgentId::parse)
        .or_else(|| active_agent.get())
        .unwrap_or(CanonicalAgentId::ClaudeCode);

    // Tag Sentry early so client creation errors carry agent context
    analytics::set_sentry_agent_context(agent_id_enum.as_str(), None);

    // Create and initialize client with cwd so subprocess spawns in correct directory
    let mut client = create_and_initialize_client(
        &registry,
        &opencode_manager,
        agent_id_enum.clone(),
        app.clone(),
        cwd.clone(),
        "new session",
    )
    .await?;

    // Create the session
    tracing::debug!("Creating session");
    let result = client
        .new_session(cwd.to_string_lossy().to_string())
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "New session failed");
            SerializableAcpError::from(e)
        })?;

    // Tag Sentry so any tracing::error!() within this scope carries agent context
    analytics::set_sentry_agent_context(agent_id_enum.as_str(), Some(&result.session_id));

    // Store the client keyed by session_id
    if let Some(old_client) =
        session_registry.store(result.session_id.clone(), client, agent_id_enum.clone())
    {
        // Stop the replaced client
        tracing::warn!(
            session_id = %redact_session_id(&result.session_id),
            agent_id = %agent_id_enum.as_str(),
            reason = "acp_new_session replaced existing registry entry",
            "Stopping replaced session client"
        );
        let mut old = lock_session_client(&old_client, "acp_new_session: replace lock").await?;
        old.stop();
        tracing::warn!(session_id = %result.session_id, "Replaced existing session client");
    }

    tracing::info!(
        session_id = %result.session_id,
        "New session created with dedicated client"
    );

    Ok(result)
}

/// Resume an existing ACP session.
///
/// Creates a new client and subprocess for the resumed session.
/// Per ACP protocol: ResumeSessionResponse does NOT include sessionId.
/// The session_id is the one provided in the request parameters.
#[tauri::command]
#[specta::specta]
pub async fn acp_resume_session(
    app: AppHandle,
    session_id: String,
    cwd: String,
    agent_id: Option<String>,
) -> Result<ResumeSessionResponse, SerializableAcpError> {
    tracing::info!(session_id = %session_id, cwd = %cwd, agent_id = ?agent_id, "acp_resume_session called");

    // Safety net for the startup timing gap: earlyPreloadPanelSessions fires before the
    // sidebar scan completes, so the frontend may send projectPath instead of worktreePath.
    // The DB is the authoritative source — override the frontend-provided cwd when the
    // session has a stored worktree_path, but only if the directory still exists on disk.
    // Deleted worktrees (e.g. cleaned up after merge) should fall back to the original cwd.
    let db = app.state::<DbConn>();
    let metadata = SessionMetadataRepository::get_by_id(db.inner(), &session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Failed to load session metadata for resume: {error}"),
        })?;

    if let Some(row) = metadata.as_ref() {
        if row.is_placeholder() {
            tracing::warn!(
                session_id = %session_id,
                project_path = %row.project_path,
                "Rejecting resume for placeholder session metadata without persisted history"
            );
            return Err(SerializableAcpError::SessionNotFound {
                session_id: session_id.clone(),
            });
        }
    }

    let effective_cwd = match metadata {
        Some(row) if row.worktree_path.is_some() => {
            let wt_path = row.worktree_path.unwrap();
            let wt_exists = std::path::Path::new(&wt_path).is_dir();
            if wt_exists {
                tracing::info!(
                    session_id = %session_id,
                    worktree_path = %wt_path,
                    original_cwd = %cwd,
                    "Using worktree_path from DB as effective cwd for resume"
                );
                wt_path
            } else {
                tracing::warn!(
                    session_id = %session_id,
                    worktree_path = %wt_path,
                    original_cwd = %cwd,
                    "Worktree path from DB no longer exists, falling back to original cwd"
                );
                cwd.clone()
            }
        }
        _ => cwd.clone(),
    };

    let cwd = validate_session_cwd(&effective_cwd, ProjectAccessReason::SessionResume)?;
    let registry = app.state::<Arc<AgentRegistry>>();
    let active_agent = app.state::<ActiveAgent>();
    let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();
    let session_registry = app.state::<SessionRegistry>();

    // Determine which agent to use
    let agent_id_enum = agent_id
        .as_deref()
        .map(CanonicalAgentId::parse)
        .or_else(|| active_agent.get())
        .unwrap_or(CanonicalAgentId::ClaudeCode);

    // Tag Sentry so any tracing::error!() within this scope carries agent context
    analytics::set_sentry_agent_context(agent_id_enum.as_str(), Some(&session_id));

    let cwd_str = cwd.to_string_lossy().to_string();
    let result = resume_or_create_session_client(
        &session_registry,
        session_id.clone(),
        cwd_str,
        agent_id_enum.clone(),
        || {
            let app = app.clone();
            let registry = registry.clone();
            let opencode_manager = opencode_manager.clone();
            let agent_id_enum = agent_id_enum.clone();
            let cwd = cwd.clone();
            async move {
                create_and_initialize_client(
                    &registry,
                    &opencode_manager,
                    agent_id_enum,
                    app,
                    cwd,
                    "resume session",
                )
                .await
            }
        },
    )
    .await?;

    Ok(result)
}

/// Fork an existing ACP session.
///
/// Creates a new session with a new session_id and copied history from the original.
/// UNIFIED IDENTITY: The returned session_id will be a NEW UUID, different from the source.
#[tauri::command]
#[specta::specta]
pub async fn acp_fork_session(
    app: AppHandle,
    session_id: String,
    cwd: String,
    agent_id: Option<String>,
) -> Result<NewSessionResponse, SerializableAcpError> {
    tracing::info!(session_id = %session_id, cwd = %cwd, agent_id = ?agent_id, "acp_fork_session called");
    let cwd = validate_session_cwd(&cwd, ProjectAccessReason::Other)?;
    let registry = app.state::<Arc<AgentRegistry>>();
    let active_agent = app.state::<ActiveAgent>();
    let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();
    let session_registry = app.state::<SessionRegistry>();

    // Determine which agent to use
    let agent_id_enum = agent_id
        .as_deref()
        .map(CanonicalAgentId::parse)
        .or_else(|| active_agent.get())
        .unwrap_or(CanonicalAgentId::ClaudeCode);

    // Tag Sentry early so client creation errors carry agent context
    analytics::set_sentry_agent_context(agent_id_enum.as_str(), Some(&session_id));

    // Create and initialize client with cwd so subprocess spawns in correct directory
    let mut client = create_and_initialize_client(
        &registry,
        &opencode_manager,
        agent_id_enum.clone(),
        app.clone(),
        cwd.clone(),
        "fork session",
    )
    .await?;

    // Fork the session
    tracing::debug!("Forking session");
    let result = client
        .fork_session(session_id.clone(), cwd.to_string_lossy().to_string())
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Fork session failed");
            SerializableAcpError::from(e)
        })?;

    // Tag Sentry so any tracing::error!() within this scope carries agent context
    analytics::set_sentry_agent_context(agent_id_enum.as_str(), Some(&result.session_id));

    // Store the client keyed by NEW session_id
    if let Some(old_client) =
        session_registry.store(result.session_id.clone(), client, agent_id_enum.clone())
    {
        // Stop the replaced client
        tracing::warn!(
            session_id = %redact_session_id(&result.session_id),
            agent_id = %agent_id_enum.as_str(),
            reason = "acp_fork_session replaced existing registry entry",
            "Stopping replaced session client"
        );
        let mut old = lock_session_client(&old_client, "acp_fork_session: replace lock").await?;
        old.stop();
        tracing::warn!(session_id = %result.session_id, "Replaced existing session client");
    }

    tracing::info!(
        original_session_id = %session_id,
        new_session_id = %result.session_id,
        "Session forked with dedicated client"
    );
    Ok(result)
}

/// Close a session and clean up its client
#[tauri::command]
#[specta::specta]
pub async fn acp_close_session(
    app: AppHandle,
    session_id: String,
) -> Result<(), SerializableAcpError> {
    tracing::info!(session_id = %session_id, "acp_close_session called");
    let session_registry = app.state::<SessionRegistry>();

    // Look up agent before removing so we can tag Sentry and analytics
    let agent_id_str = session_registry
        .get_agent_id(&session_id)
        .map(|a| a.as_str().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    analytics::set_sentry_agent_context(&agent_id_str, Some(&session_id));

    if let Some(client_arc) = session_registry.remove(&session_id, "acp_close_session") {
        // Get exclusive access and stop the client
        tracing::warn!(
            session_id = %redact_session_id(&session_id),
            agent_id = %agent_id_str,
            reason = "acp_close_session",
            "Stopping session client from explicit close request"
        );
        let mut client = lock_session_client(&client_arc, "acp_close_session: lock").await?;
        client.stop();
        tracing::info!(session_id = %session_id, "Session client stopped and removed");
    } else {
        tracing::warn!(session_id = %session_id, "Session not found for cleanup");
    }

    // Clean up streaming accumulator state for this session
    crate::acp::streaming_accumulator::cleanup_session_streaming(&session_id);

    Ok(())
}
