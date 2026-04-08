use super::*;
use crate::acp::client::ExecutionProfileRequest;
use crate::acp::projections::{ProjectionRegistry, SessionProjectionSnapshot};
use crate::acp::session_journal::load_stored_projection;
use crate::acp::session_registry::redact_session_id;
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::{SessionMetadataRepository, SessionProjectionSnapshotRepository};
use sea_orm::DbConn;

pub(crate) fn resume_path_needs_post_connect_execution_profile_reset(
    agent_id: &CanonicalAgentId,
) -> bool {
    !matches!(agent_id, CanonicalAgentId::ClaudeCode)
}

fn resolve_launch_execution_profile_mode_id(
    registry: &Arc<AgentRegistry>,
    agent_id: &CanonicalAgentId,
    execution_profile: Option<&ExecutionProfileRequest>,
) -> Result<Option<String>, SerializableAcpError> {
    let Some(execution_profile) = execution_profile else {
        return Ok(None);
    };

    let provider = registry
        .get(agent_id)
        .ok_or_else(|| SerializableAcpError::AgentNotFound {
            agent_id: agent_id.as_str().to_string(),
        })?;

    let native_mode_id = provider
        .map_execution_profile_mode_id(
            &execution_profile.mode_id,
            execution_profile.autonomous_enabled,
        )
        .ok_or_else(|| SerializableAcpError::ProtocolError {
            message: format!(
                "unsupported autonomous execution profile: provider={} ui_mode={} autonomous={}",
                provider.id(),
                execution_profile.mode_id,
                execution_profile.autonomous_enabled
            ),
        })?;

    Ok(Some(native_mode_id))
}

async fn reset_resumed_session_execution_profile(
    app: &AppHandle,
    session_id: &str,
    current_mode_id: &str,
) -> Result<(), SerializableAcpError> {
    let session_registry = app.state::<SessionRegistry>();
    let registry = app.state::<Arc<AgentRegistry>>();

    let agent_id = session_registry.get_agent_id(session_id).ok_or_else(|| {
        SerializableAcpError::SessionNotFound {
            session_id: session_id.to_string(),
        }
    })?;

    if !resume_path_needs_post_connect_execution_profile_reset(&agent_id) {
        tracing::debug!(
            session_id = %session_id,
            agent_id = %agent_id.as_str(),
            "Skipping post-connect execution profile reset for provider-managed safe resume"
        );
        return Ok(());
    }

    let provider = registry
        .get(&agent_id)
        .ok_or_else(|| SerializableAcpError::AgentNotFound {
            agent_id: agent_id.as_str().to_string(),
        })?;

    let native_mode_id = provider
        .map_execution_profile_mode_id(current_mode_id, false)
        .ok_or_else(|| SerializableAcpError::ProtocolError {
            message: format!(
                "unsupported autonomous execution profile: provider={} ui_mode={} autonomous=false",
                provider.id(),
                current_mode_id
            ),
        })?;

    let client_mutex = session_registry
        .get(session_id)
        .map_err(SerializableAcpError::from)?;
    let mut client_guard = lock_session_client(
        &client_mutex,
        "acp_resume_session: reset execution profile lock",
    )
    .await?;

    timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client_guard.set_session_mode(session_id.to_string(), native_mode_id),
    )
    .await
    .map_err(|_| SerializableAcpError::Timeout {
        operation: "acp_resume_session: reset execution profile".to_string(),
    })?
    .map_err(SerializableAcpError::from)
}

pub(crate) fn session_metadata_context_from_cwd(cwd: &std::path::Path) -> (String, Option<String>) {
    // Use the runtime root resolver to walk up from cwd and find the
    // actual repo/worktree root.  This fixes the bug where a subdirectory
    // like /repo/src/components/ was persisted as the project_path.
    match crate::acp::opencode::runtime_root::resolve(cwd) {
        Ok(resolved) => {
            let main_repo = resolved.project_root.to_string_lossy().into_owned();
            let runtime = resolved.runtime_root.to_string_lossy().into_owned();

            if main_repo != runtime {
                // Worktree: project_path is the main repo, worktree_path is the worktree root.
                (main_repo, Some(runtime))
            } else {
                // Regular repo or non-git directory: project_path is the resolved root.
                (runtime, None)
            }
        }
        Err(_) => {
            // Fallback: resolver failed (e.g. path doesn't exist).
            // Use the canonical cwd as-is, preserving the old behavior for
            // edge cases like non-existent paths passed during cleanup.
            let canonical_cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
            (canonical_cwd.to_string_lossy().into_owned(), None)
        }
    }
}

pub(crate) async fn persist_session_metadata_for_cwd(
    db: &DbConn,
    session_id: &str,
    agent_id: &CanonicalAgentId,
    cwd: &std::path::Path,
) -> Result<Option<i32>, SerializableAcpError> {
    let (project_path, worktree_path) = session_metadata_context_from_cwd(cwd);

    let sequence_id = SessionMetadataRepository::ensure_exists_and_promote(
        db,
        session_id,
        &project_path,
        agent_id.as_str(),
        worktree_path.as_deref(),
    )
    .await
    .map_err(|error| SerializableAcpError::InvalidState {
        message: format!("Failed to persist session metadata for session {session_id}: {error}"),
    })?;

    Ok(sequence_id)
}

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

#[tauri::command]
#[specta::specta]
pub async fn acp_get_session_projection(
    app: AppHandle,
    session_id: String,
) -> Result<SessionProjectionSnapshot, SerializableAcpError> {
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let runtime_projection = projection_registry.session_projection(&session_id);
    if projection_has_runtime_state(&runtime_projection) {
        return Ok(runtime_projection);
    }

    let db = app.state::<DbConn>();
    let metadata = SessionMetadataRepository::get_by_id(db.inner(), &session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load session metadata for projection lookup {session_id}: {error}"
            ),
        })?;
    let stored_projection = load_stored_projection(
        db.inner(),
        &session_id,
        metadata
            .as_ref()
            .map(|row| CanonicalAgentId::parse(&row.agent_id)),
    )
    .await
    .map_err(|error| SerializableAcpError::InvalidState {
        message: format!(
            "Failed to rebuild session projection from journal for session {session_id}: {error}"
        ),
    })?;
    if let Some(stored_projection) = stored_projection {
        if projection_has_runtime_state(&stored_projection) {
            SessionProjectionSnapshotRepository::set(db.inner(), &session_id, &stored_projection)
                .await
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!(
                        "Failed to persist journal-backed session projection for session {session_id}: {error}"
                    ),
                })?;
        }
        return Ok(stored_projection);
    }

    if let Some(persisted_projection) =
        SessionProjectionSnapshotRepository::get(db.inner(), &session_id)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to load persisted session projection for session {session_id}: {error}"
                ),
            })?
    {
        return Ok(persisted_projection);
    }

    let Some(metadata) = metadata else {
        return Ok(runtime_projection);
    };

    let imported_session = crate::history::commands::session_loading::get_unified_session(
        app.clone(),
        session_id.clone(),
        metadata.project_path.clone(),
        metadata.agent_id.clone(),
        Some(metadata.file_path.clone()),
    )
    .await
    .map_err(|error| SerializableAcpError::InvalidState {
        message: format!(
            "Failed to import legacy session {session_id} into projection view: {error}"
        ),
    })?;

    let Some(imported_session) = imported_session else {
        return Ok(runtime_projection);
    };

    let imported_projection = ProjectionRegistry::project_converted_session(
        &session_id,
        Some(CanonicalAgentId::parse(&metadata.agent_id)),
        &imported_session,
    );

    if projection_has_runtime_state(&imported_projection) {
        SessionProjectionSnapshotRepository::set(db.inner(), &session_id, &imported_projection)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to persist imported projection snapshot for session {session_id}: {error}"
                ),
            })?;
    }

    Ok(imported_projection)
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
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let db = app.state::<DbConn>();

    // Determine which agent to use
    let agent_id_enum = agent_id
        .as_deref()
        .map(CanonicalAgentId::parse)
        .or_else(|| active_agent.get())
        .unwrap_or(CanonicalAgentId::ClaudeCode);

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
    projection_registry.register_session(result.session_id.clone(), agent_id_enum.clone());

    let sequence_id =
        persist_session_metadata_for_cwd(db.inner(), &result.session_id, &agent_id_enum, &cwd)
            .await?;

    Ok(NewSessionResponse {
        sequence_id,
        ..result
    })
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
    execution_profile: Option<ExecutionProfileRequest>,
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
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let db = app.state::<DbConn>();

    // Determine which agent to use
    let agent_id_enum = agent_id
        .as_deref()
        .map(CanonicalAgentId::parse)
        .or_else(|| active_agent.get())
        .unwrap_or(CanonicalAgentId::ClaudeCode);
    let launch_mode_id = resolve_launch_execution_profile_mode_id(
        &registry,
        &agent_id_enum,
        execution_profile.as_ref(),
    )?;
    let force_new_client = launch_mode_id.is_some();

    let cwd_str = cwd.to_string_lossy().to_string();
    let result = resume_or_create_session_client(
        &session_registry,
        session_id.clone(),
        cwd_str,
        agent_id_enum.clone(),
        force_new_client,
        launch_mode_id,
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

    reset_resumed_session_execution_profile(&app, &session_id, &result.modes.current_mode_id)
        .await?;

    let stored_projection =
        load_stored_projection(db.inner(), &session_id, Some(agent_id_enum.clone()))
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to load stored session projection for session {session_id}: {error}"
                ),
            })?;
    if let Some(stored_projection) = stored_projection {
        projection_registry.restore_session_projection(stored_projection);
    }
    projection_registry.register_session(session_id.clone(), agent_id_enum.clone());
    let _ = persist_session_metadata_for_cwd(db.inner(), &session_id, &agent_id_enum, &cwd).await?;

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
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let db = app.state::<DbConn>();

    // Determine which agent to use
    let agent_id_enum = agent_id
        .as_deref()
        .map(CanonicalAgentId::parse)
        .or_else(|| active_agent.get())
        .unwrap_or(CanonicalAgentId::ClaudeCode);

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
    projection_registry.register_session(result.session_id.clone(), agent_id_enum.clone());
    let sequence_id =
        persist_session_metadata_for_cwd(db.inner(), &result.session_id, &agent_id_enum, &cwd)
            .await?;
    Ok(NewSessionResponse {
        sequence_id,
        ..result
    })
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
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let db = app.state::<DbConn>();

    let agent_id_str = session_registry
        .get_agent_id(&session_id)
        .map(|a| a.as_str().to_string())
        .unwrap_or_else(|| "unknown".to_string());

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
    let runtime_projection = projection_registry.session_projection(&session_id);
    if projection_has_runtime_state(&runtime_projection) {
        SessionProjectionSnapshotRepository::set(db.inner(), &session_id, &runtime_projection)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to persist projection snapshot for session {session_id}: {error}"
                ),
            })?;
    }
    projection_registry.remove_session(&session_id);

    Ok(())
}

fn projection_has_runtime_state(snapshot: &SessionProjectionSnapshot) -> bool {
    snapshot.session.is_some()
        || !snapshot.operations.is_empty()
        || !snapshot.interactions.is_empty()
}

#[cfg(test)]
mod tests {
    use crate::acp::projections::{
        InteractionResponse, InteractionSnapshot, InteractionState, SessionProjectionSnapshot,
        SessionSnapshot, SessionTurnState,
    };
    use crate::acp::session_journal::load_stored_projection;
    use crate::acp::session_update::{PermissionData, SessionUpdate};
    use crate::acp::types::CanonicalAgentId;
    use crate::db::migrations::Migrator;
    use crate::db::repository::{
        SessionJournalEventRepository, SessionMetadataRepository,
        SessionProjectionSnapshotRepository,
    };
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use serde_json::json;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory SQLite");
        Migrator::up(&db, None)
            .await
            .expect("Failed to run migrations");
        db
    }

    #[tokio::test]
    async fn load_stored_projection_prefers_journal_over_stale_snapshot() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-priority".to_string(),
            "Priority session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-priority.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let stale_snapshot = SessionProjectionSnapshot {
            session: Some(SessionSnapshot {
                session_id: "session-priority".to_string(),
                agent_id: Some(CanonicalAgentId::ClaudeCode),
                last_event_seq: 1,
                turn_state: SessionTurnState::Completed,
                message_count: 0,
                last_agent_message_id: None,
                active_tool_call_ids: vec![],
                completed_tool_call_ids: vec![],
            }),
            operations: vec![],
            interactions: vec![InteractionSnapshot {
                id: "permission-1".to_string(),
                session_id: "session-priority".to_string(),
                kind: crate::acp::projections::InteractionKind::Permission,
                state: InteractionState::Pending,
                json_rpc_request_id: Some(7),
                reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(
                    7,
                )),
                tool_reference: None,
                responded_at_event_seq: None,
                response: None,
                payload: crate::acp::projections::InteractionPayload::Permission(PermissionData {
                    id: "permission-1".to_string(),
                    session_id: "session-priority".to_string(),
                    json_rpc_request_id: Some(7),
                    reply_handler: Some(
                        crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                    ),
                    permission: "Execute".to_string(),
                    patterns: vec![],
                    metadata: json!({ "command": "bun test" }),
                    always: vec![],
                    tool: None,
                }),
            }],
        };
        SessionProjectionSnapshotRepository::set(&db, "session-priority", &stale_snapshot)
            .await
            .unwrap();

        let permission_update = SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-1".to_string(),
                session_id: "session-priority".to_string(),
                json_rpc_request_id: Some(7),
                reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(
                    7,
                )),
                permission: "Execute".to_string(),
                patterns: vec![],
                metadata: json!({ "command": "bun test" }),
                always: vec![],
                tool: None,
            },
            session_id: Some("session-priority".to_string()),
        };
        SessionJournalEventRepository::append_session_update(
            &db,
            "session-priority",
            &permission_update,
        )
        .await
        .unwrap();
        SessionJournalEventRepository::append_interaction_transition(
            &db,
            "session-priority",
            "permission-1",
            InteractionState::Approved,
            InteractionResponse::Permission {
                accepted: true,
                option_id: Some("allow".to_string()),
                reply: Some("once".to_string()),
            },
        )
        .await
        .unwrap();

        let stored_projection =
            load_stored_projection(&db, "session-priority", Some(CanonicalAgentId::ClaudeCode))
                .await
                .unwrap()
                .expect("expected stored projection");

        let permission = stored_projection
            .interactions
            .iter()
            .find(|interaction| interaction.id == "permission-1")
            .expect("expected permission interaction");
        assert_eq!(permission.state, InteractionState::Approved);
        assert_eq!(
            stored_projection
                .session
                .expect("expected session projection")
                .last_event_seq,
            2
        );
    }
}
