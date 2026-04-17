use super::*;
use crate::acp::projections::{ProjectionRegistry, SessionProjectionSnapshot};
use crate::acp::session_descriptor::{
    ResolvedForkSession, ResolvedResumeSession, SessionCompatibilityInput,
};
use crate::acp::session_journal::load_stored_projection;
use crate::acp::session_policy::SessionPolicyRegistry;
use crate::acp::session_registry::redact_session_id;
use crate::acp::transcript_projection::{
    TranscriptDelta, TranscriptProjectionRegistry, TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use crate::db::repository::{
    SessionMetadataRepository, SessionProjectionSnapshotRepository,
    SessionThreadSnapshotRepository, SessionTranscriptSnapshotRepository,
};
use sea_orm::DbConn;

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

async fn resolve_resume_session_target(
    db: &DbConn,
    session_id: &str,
    requested_cwd: &str,
    explicit_agent_id: Option<&str>,
) -> Result<ResolvedResumeSession, SerializableAcpError> {
    let metadata = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Failed to load session metadata for resume: {error}"),
        })?;

    SessionMetadataRepository::resolve_existing_session_resume_from_metadata(
        session_id,
        metadata.as_ref(),
        requested_cwd,
        explicit_agent_id.map(CanonicalAgentId::parse),
    )
    .map_err(SerializableAcpError::from)
}

fn resolve_resume_launch_mode_id(
    registry: &Arc<AgentRegistry>,
    agent_id: &CanonicalAgentId,
    launch_mode_id: Option<&str>,
) -> Result<Option<String>, SerializableAcpError> {
    let Some(launch_mode_id) = launch_mode_id else {
        return Ok(None);
    };

    let provider = registry
        .get(agent_id)
        .ok_or_else(|| SerializableAcpError::AgentNotFound {
            agent_id: agent_id.as_str().to_string(),
        })?;

    Ok(Some(provider.map_outbound_mode_id(launch_mode_id)))
}

pub(crate) fn resolve_requested_agent_id(
    explicit_agent_id: Option<&str>,
    active_agent_id: Option<CanonicalAgentId>,
) -> CanonicalAgentId {
    explicit_agent_id
        .map(CanonicalAgentId::parse)
        .or(active_agent_id)
        .unwrap_or(CanonicalAgentId::ClaudeCode)
}

async fn resolve_fork_session_target(
    db: &DbConn,
    session_id: &str,
    requested_cwd: &str,
    explicit_agent_id: Option<&str>,
) -> Result<ResolvedForkSession, SerializableAcpError> {
    let metadata = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Failed to load session metadata for fork: {error}"),
        })?;

    let Some(metadata) = metadata.as_ref() else {
        return Err(SerializableAcpError::SessionNotFound {
            session_id: session_id.to_string(),
        });
    };

    crate::acp::session_descriptor::resolve_existing_session_fork(
        metadata.descriptor_facts(),
        requested_cwd,
        explicit_agent_id.map(CanonicalAgentId::parse),
    )
    .map_err(SerializableAcpError::from)
}

/// Initialize the ACP connection.
///
/// With per-session clients, this is now a lightweight check.
/// Actual initialization happens per-session in acp_new_session.
#[tauri::command]
#[specta::specta]
pub async fn acp_initialize(_app: AppHandle) -> CommandResult<InitializeResponse> {
    expected_acp_command_result("acp_initialize", async {
        tracing::info!("acp_initialize called (per-session architecture - no global client)");

        // Return a mock response - real initialization happens per-session
        Ok(InitializeResponse {
            protocol_version: 1,
            agent_capabilities: serde_json::json!({}),
            agent_info: serde_json::json!({}),
            auth_methods: vec![],
        })
    }
    .await)
}

#[tauri::command]
#[specta::specta]
pub async fn acp_get_event_bridge_info(
    app: AppHandle,
) -> CommandResult<AcpEventBridgeInfo> {
    expected_acp_command_result("acp_get_event_bridge_info", async {
        let hub = app.state::<Arc<AcpEventHubState>>();
        hub.get_bridge_info().await.ok_or_else(|| {
            tracing::error!("ACP event bridge server not initialized");
            SerializableAcpError::InvalidState {
                message: "ACP event bridge server not initialized".to_string(),
            }
        })
    }
    .await)
}

#[tauri::command]
#[specta::specta]
pub async fn acp_set_session_autonomous(
    app: AppHandle,
    session_id: String,
    enabled: bool,
) -> CommandResult<()> {
    expected_acp_command_result("acp_set_session_autonomous", async {
        tracing::debug!(
            session_id = %session_id,
            enabled,
            "acp_set_session_autonomous called"
        );

        let session_policy = app.state::<Arc<SessionPolicyRegistry>>();
        session_policy.set_autonomous(&session_id, enabled);

        Ok(())
    }
    .await)
}

#[tauri::command]
#[specta::specta]
pub async fn acp_get_session_projection(
    app: AppHandle,
    session_id: String,
) -> CommandResult<SessionProjectionSnapshot> {
    expected_acp_command_result("acp_get_session_projection", async {
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
    let replay_context = metadata
        .as_ref()
        .map(|row| {
            SessionMetadataRepository::resolve_existing_session_replay_context_from_metadata(
                &session_id,
                Some(row),
                SessionCompatibilityInput::default(),
            )
        })
        .transpose()
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Failed to resolve replay context for session {session_id}: {error}"),
        })?;
    let stored_projection = if let Some(replay_context) = replay_context.as_ref() {
        load_stored_projection(db.inner(), replay_context)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to rebuild session projection from journal for session {session_id}: {error}"
                ),
            })?
    } else {
        None
    };
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

    let Some(_metadata) = metadata else {
        return Ok(runtime_projection);
    };

    let imported_thread_snapshot =
        crate::history::commands::session_loading::ensure_canonical_session_materialized(
            app.clone(),
            replay_context
                .as_ref()
                .expect("replay context should exist with metadata"),
        )
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to materialize legacy session {session_id} into canonical state: {error}"
            ),
        })?;

    let Some(imported_thread_snapshot) = imported_thread_snapshot else {
        return Ok(runtime_projection);
    };

    let imported_projection = ProjectionRegistry::project_thread_snapshot(
        &session_id,
        Some(
            replay_context
                .as_ref()
                .expect("replay context should exist with metadata")
                .agent_id
                .clone(),
        ),
        &imported_thread_snapshot,
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
    .await)
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
    launch_token: Option<String>,
) -> CommandResult<NewSessionResponse> {
    expected_acp_command_result("acp_new_session", async {
        tracing::info!(cwd = %cwd, agent_id = ?agent_id, "acp_new_session called (creating dedicated client)");
        let cwd = validate_session_cwd(&cwd, ProjectAccessReason::Other)?;
        let registry = app.state::<Arc<AgentRegistry>>();
        let active_agent = app.state::<ActiveAgent>();
        let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();
        let session_registry = app.state::<SessionRegistry>();
        let projection_registry = app.state::<Arc<ProjectionRegistry>>();
        let db = app.state::<DbConn>();

        // Determine which agent to use
        let agent_id_enum = resolve_requested_agent_id(agent_id.as_deref(), active_agent.get());

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

        let sequence_id = if let Some(launch_token) = launch_token.as_deref() {
            SessionMetadataRepository::consume_reserved_worktree_launch(
                db.inner(),
                launch_token,
                &result.session_id,
                agent_id_enum.as_str(),
            )
            .await
            .map_err(|error| {
                tracing::error!(
                    error = %error,
                    launch_token,
                    session_id = %result.session_id,
                    "Prepared worktree launch consumption failed; stopping session client"
                );
                client.stop();
                SerializableAcpError::InvalidState {
                    message: format!(
                        "Failed to consume prepared worktree launch {launch_token} for session {}: {error}",
                        result.session_id
                    ),
                }
            })?
        } else {
            persist_session_metadata_for_cwd(db.inner(), &result.session_id, &agent_id_enum, &cwd)
                .await?
        };

        // Store the client keyed by session_id only after session metadata is durably attached.
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

        Ok(NewSessionResponse {
            sequence_id,
            ..result
        })
    }
    .await)
}

/// Resume an existing ACP session.
///
/// Fire-and-forget: validates inputs synchronously, then spawns an async task
/// for the heavy work (client creation, protocol resume, history replay).
/// Completion/failure is signaled via `SessionUpdate::ConnectionComplete` /
/// `SessionUpdate::ConnectionFailed` events through the SSE bridge.
#[tauri::command]
#[specta::specta]
pub async fn acp_resume_session(
    app: AppHandle,
    session_id: String,
    cwd: String,
    agent_id: Option<String>,
    launch_mode_id: Option<String>,
    attempt_id: u64,
    open_token: Option<String>,
) -> CommandResult<()> {
    expected_acp_command_result("acp_resume_session", async {
        tracing::info!(session_id = %session_id, cwd = %cwd, agent_id = ?agent_id, attempt_id, "acp_resume_session called");

        // --- Synchronous validation (fast, fails the invoke if invalid) ---
        let db = app.state::<DbConn>();
        let resume_target =
            resolve_resume_session_target(db.inner(), &session_id, &cwd, agent_id.as_deref()).await?;
        let cwd = validate_session_cwd(
            &resume_target.launch_cwd,
            ProjectAccessReason::SessionResume,
        )?;
        let registry = app.state::<Arc<AgentRegistry>>();

        let agent_id_enum = resume_target.descriptor.agent_id.clone();
        let resolved_launch_mode_id =
            resolve_resume_launch_mode_id(&registry, &agent_id_enum, launch_mode_id.as_deref())?;

        // Clone values needed for the async task
        let app_clone = app.clone();
        let resume_descriptor = resume_target.descriptor.clone();

        // --- Spawn the async task for heavy work ---
        // We capture the JoinHandle and spawn a follow-up task to catch panics,
        // guaranteeing a lifecycle event is always emitted.
        let session_id_panic = session_id.clone();
        let app_panic = app.clone();
        let handle = tokio::spawn(async move {
            let result = timeout(
                RESUME_SESSION_TIMEOUT,
                async_resume_session_work(
                    &app_clone,
                    &session_id,
                    cwd,
                    agent_id_enum,
                    resolved_launch_mode_id,
                    &resume_descriptor,
                    open_token,
                ),
            )
            .await;

            // Resolve the outcome and emit the lifecycle event
            let hub = app_clone
                .try_state::<Arc<AcpEventHubState>>()
                .map(|s| s.inner().clone());

            match result {
                Ok(Ok(response)) => {
                    let policy_registry = app_clone.state::<Arc<SessionPolicyRegistry>>();
                    let autonomous_enabled = policy_registry.is_autonomous(&session_id);
                    let update = crate::acp::session_update::SessionUpdate::ConnectionComplete {
                        session_id: session_id.clone(),
                        attempt_id,
                        models: response.models,
                        modes: response.modes,
                        available_commands: response.available_commands,
                        config_options: response.config_options,
                        autonomous_enabled,
                    };
                    emit_lifecycle_event(&hub, update, &session_id);
                    tracing::info!(
                        session_id = %session_id,
                        attempt_id,
                        "Async resume completed successfully"
                    );
                }
                Ok(Err(error)) => {
                    let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
                        session_id: session_id.clone(),
                        attempt_id,
                        error: error.to_string(),
                    };
                    emit_lifecycle_event(&hub, update, &session_id);
                    tracing::error!(
                        session_id = %session_id,
                        attempt_id,
                        error = %error,
                        "Async resume failed"
                    );
                }
                Err(_elapsed) => {
                    let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
                        session_id: session_id.clone(),
                        attempt_id,
                        error: format!(
                            "Session resume timed out after {}s",
                            RESUME_SESSION_TIMEOUT.as_secs()
                        ),
                    };
                    emit_lifecycle_event(&hub, update, &session_id);
                    tracing::error!(
                        session_id = %session_id,
                        attempt_id,
                        timeout_secs = RESUME_SESSION_TIMEOUT.as_secs(),
                        "Async resume timed out"
                    );
                }
            }
        });

        // Panic guard: if the spawned task panics, emit ConnectionFailed so the
        // frontend watchdog never fires.
        tokio::spawn(async move {
            if let Err(join_error) = handle.await {
                tracing::error!(
                    session_id = %session_id_panic,
                    attempt_id,
                    error = %join_error,
                    "Resume session task panicked"
                );
                let hub = app_panic
                    .try_state::<Arc<AcpEventHubState>>()
                    .map(|s| s.inner().clone());
                let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
                    session_id: session_id_panic.clone(),
                    attempt_id,
                    error: format!("Internal error: resume task panicked: {join_error}"),
                };
                emit_lifecycle_event(&hub, update, &session_id_panic);
            }
        });

        Ok(())
    }
    .await)
}

/// Emit a lifecycle event directly to the event hub, bypassing the rate-limited dispatcher.
fn emit_lifecycle_event(
    hub: &Option<Arc<AcpEventHubState>>,
    update: crate::acp::session_update::SessionUpdate,
    session_id: &str,
) {
    let Some(hub) = hub else {
        tracing::warn!(session_id = %session_id, "Event hub unavailable, lifecycle event dropped");
        return;
    };
    let event = crate::acp::ui_event_dispatcher::AcpUiEvent::session_update(update);
    if let Err(err) = event.publish_direct(hub) {
        tracing::error!(session_id = %session_id, error = %err, "Failed to publish lifecycle event");
    }
}

fn replay_buffered_transcript_events(
    hub: &AcpEventHubState,
    transcript_projection_registry: &TranscriptProjectionRegistry,
    session_id: &str,
    buffered_events: Vec<crate::acp::event_hub::AcpEventEnvelope>,
) {
    let replayable = buffered_events
        .into_iter()
        .filter(|event| event.event_name == "acp-transcript-delta")
        .filter(|event| event.session_id.as_deref() == Some(session_id))
        .collect::<Vec<_>>();
    if replayable.is_empty() {
        return;
    }
    for event in &replayable {
        if let Ok(delta) = serde_json::from_value::<TranscriptDelta>(event.payload.clone()) {
            let _ = transcript_projection_registry.apply_delta(&delta);
        }
    }
    hub.replay_buffered_events(replayable);
}

async fn load_transcript_snapshot_for_resume(
    db: &DbConn,
    session_id: &str,
) -> Result<TranscriptSnapshot, SerializableAcpError> {
    if let Some(snapshot) = SessionTranscriptSnapshotRepository::get(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load transcript snapshot for resumed session {session_id}: {error}"
            ),
        })?
    {
        return Ok(snapshot);
    }

    let thread_snapshot = SessionThreadSnapshotRepository::get(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load thread snapshot for resumed session {session_id}: {error}"
            ),
        })?;
    if let Some(thread_snapshot) = thread_snapshot {
        return Ok(TranscriptSnapshot::from_stored_entries(
            0,
            &thread_snapshot.entries,
        ));
    }

    Ok(TranscriptSnapshot::from_stored_entries(0, &[]))
}

/// The heavy async work extracted from `acp_resume_session`.
/// This runs inside `tokio::spawn` under a `RESUME_SESSION_TIMEOUT` deadline.
async fn async_resume_session_work(
    app: &AppHandle,
    session_id: &str,
    cwd: PathBuf,
    agent_id_enum: CanonicalAgentId,
    resolved_launch_mode_id: Option<String>,
    resume_descriptor: &crate::acp::session_descriptor::SessionDescriptor,
    open_token: Option<String>,
) -> Result<ResumeSessionResponse, SerializableAcpError> {
    let registry = app.state::<Arc<AgentRegistry>>();
    let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();
    let session_registry = app.state::<SessionRegistry>();
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
    let db = app.state::<DbConn>();
    let parsed_open_token = if let Some(raw_open_token) = open_token.as_deref() {
        let token = uuid::Uuid::parse_str(raw_open_token).map_err(|error| {
            SerializableAcpError::InvalidState {
                message: format!("Failed to parse open token for session {session_id}: {error}"),
            }
        })?;
        let hub = app.state::<Arc<AcpEventHubState>>();
        hub.gc_expired_reservations();
        if !hub.has_reservation_for_session(token, session_id) {
            return Err(SerializableAcpError::InvalidState {
                message: format!("Session open token is no longer valid for session {session_id}"),
            });
        }
        Some(token)
    } else {
        None
    };

    let cwd_str = cwd.to_string_lossy().to_string();
    let result = resume_or_create_session_client(
        &session_registry,
        session_id.to_string(),
        cwd_str,
        agent_id_enum.clone(),
        resolved_launch_mode_id.is_some(),
        resolved_launch_mode_id,
        || {
            let app = app.clone();
            let registry = registry.inner().clone();
            let opencode_manager = opencode_manager.inner().clone();
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

    if let Some(provider_session_id) = resume_descriptor.provider_session_id.as_deref() {
        session_registry
            .bind_provider_session_id(session_id, provider_session_id)
            .map_err(SerializableAcpError::from)?;
    }

    let transcript_snapshot = load_transcript_snapshot_for_resume(db.inner(), session_id).await?;
    transcript_projection_registry
        .restore_session_snapshot(session_id.to_string(), transcript_snapshot);

    if let Some(open_token) = parsed_open_token {
        let hub = app.state::<Arc<AcpEventHubState>>();
        let buffered_events = if let Some(events) =
            hub.claim_reservation_for_session(open_token, session_id)
        {
            events
        } else {
            return Err(SerializableAcpError::InvalidState {
                message: format!("Session open token is no longer valid for session {session_id}"),
            });
        };
        replay_buffered_transcript_events(
            hub.inner(),
            transcript_projection_registry.inner().as_ref(),
            session_id,
            buffered_events,
        );
    }

    let db = app.state::<DbConn>();
    let replay_context = resume_descriptor.clone().into();
    let stored_projection = load_stored_projection(db.inner(), &replay_context)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load stored session projection for session {session_id}: {error}"
            ),
        })?;
    if let Some(stored_projection) = stored_projection {
        projection_registry.restore_session_projection(stored_projection);
    }
    projection_registry.register_session(session_id.to_string(), agent_id_enum.clone());

    Ok(result)
}

#[cfg(test)]
mod transcript_buffer_tests {
    use super::replay_buffered_transcript_events;
    use crate::acp::event_hub::{AcpEventEnvelope, AcpEventHubState};
    use crate::acp::transcript_projection::{
        TranscriptDelta, TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole,
        TranscriptProjectionRegistry, TranscriptSegment,
    };
    use serde_json::{json, to_value};

    #[test]
    fn replay_buffered_transcript_events_replays_only_matching_transcript_deltas() {
        let hub = AcpEventHubState::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let mut receiver = hub.subscribe();

        replay_buffered_transcript_events(
            &hub,
            &transcript_projection_registry,
            "session-1",
            vec![
                AcpEventEnvelope {
                    seq: 7,
                    event_name: "acp-transcript-delta".to_string(),
                    session_id: Some("session-1".to_string()),
                    payload: to_value(TranscriptDelta {
                        event_seq: 7,
                        session_id: "session-1".to_string(),
                        snapshot_revision: 7,
                        operations: vec![TranscriptDeltaOperation::AppendEntry {
                            entry: TranscriptEntry {
                                entry_id: "assistant-1".to_string(),
                                role: TranscriptEntryRole::Assistant,
                                segments: vec![TranscriptSegment::Text {
                                    segment_id: "assistant-1:segment:7".to_string(),
                                    text: "hello".to_string(),
                                }],
                            },
                        }],
                    })
                    .expect("serialize delta"),
                    priority: "normal".to_string(),
                    droppable: false,
                    emitted_at_ms: 1,
                },
                AcpEventEnvelope {
                    seq: 8,
                    event_name: "acp-session-update".to_string(),
                    session_id: Some("session-1".to_string()),
                    payload: json!({ "type": "agentMessageChunk" }),
                    priority: "normal".to_string(),
                    droppable: true,
                    emitted_at_ms: 2,
                },
                AcpEventEnvelope {
                    seq: 9,
                    event_name: "acp-transcript-delta".to_string(),
                    session_id: Some("session-2".to_string()),
                    payload: json!({ "eventSeq": 9 }),
                    priority: "normal".to_string(),
                    droppable: false,
                    emitted_at_ms: 3,
                },
            ],
        );

        let replayed = receiver
            .try_recv()
            .expect("matching transcript delta should replay");
        assert_eq!(replayed.seq, 7);
        let runtime_snapshot = transcript_projection_registry
            .snapshot_for_session("session-1")
            .expect("runtime snapshot");
        assert_eq!(runtime_snapshot.entries.len(), 1);
        assert!(
            receiver.try_recv().is_err(),
            "non-matching events must not replay"
        );
    }
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
) -> CommandResult<NewSessionResponse> {
    expected_acp_command_result("acp_fork_session", async {
        tracing::info!(session_id = %session_id, cwd = %cwd, agent_id = ?agent_id, "acp_fork_session called");
        let db = app.state::<DbConn>();
        let fork_target =
            resolve_fork_session_target(db.inner(), &session_id, &cwd, agent_id.as_deref()).await?;
        let cwd = validate_session_cwd(&fork_target.launch_cwd, ProjectAccessReason::Other)?;
        let registry = app.state::<Arc<AgentRegistry>>();
        let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();
        let session_registry = app.state::<SessionRegistry>();
        let projection_registry = app.state::<Arc<ProjectionRegistry>>();
        let agent_id_enum = fork_target.launch_agent_id.clone();

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
            .fork_session(
                fork_target.fork_parent_session_id.clone(),
                cwd.to_string_lossy().to_string(),
            )
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
    .await)
}

/// Close a session and clean up its client
#[tauri::command]
#[specta::specta]
pub async fn acp_close_session(
    app: AppHandle,
    session_id: String,
) -> CommandResult<()> {
    expected_acp_command_result("acp_close_session", async {
    tracing::info!(session_id = %session_id, "acp_close_session called");
    let session_registry = app.state::<SessionRegistry>();
    let session_policy = app.state::<Arc<SessionPolicyRegistry>>();
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
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

    session_policy.remove(&session_id);

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
    transcript_projection_registry.remove_session(&session_id);

    Ok(())
    }
    .await)
}

fn projection_has_runtime_state(snapshot: &SessionProjectionSnapshot) -> bool {
    snapshot.session.is_some()
        || !snapshot.operations.is_empty()
        || !snapshot.interactions.is_empty()
}

#[cfg(test)]
mod tests {
    use super::{
        persist_session_metadata_for_cwd, resolve_fork_session_target, resolve_requested_agent_id,
        resolve_resume_launch_mode_id, resolve_resume_session_target,
    };
    use crate::acp::error::SerializableAcpError;
    use crate::acp::projections::{
        InteractionResponse, InteractionSnapshot, InteractionState, SessionProjectionSnapshot,
        SessionSnapshot, SessionTurnState,
    };
    use crate::acp::registry::AgentRegistry;
    use crate::acp::session_descriptor::{
        SessionCompatibilityInput, SessionDescriptorCompatibility, SessionReplayContext,
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
    use std::sync::Arc;
    use tempfile::tempdir;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory SQLite");
        Migrator::up(&db, None)
            .await
            .expect("Failed to run migrations");
        db
    }

    async fn replay_context_for_session(db: &DbConn, session_id: &str) -> SessionReplayContext {
        let metadata = SessionMetadataRepository::get_by_id(db, session_id)
            .await
            .expect("load metadata");
        SessionMetadataRepository::resolve_existing_session_replay_context_from_metadata(
            session_id,
            metadata.as_ref(),
            SessionCompatibilityInput::default(),
        )
        .expect("replay context")
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
                active_turn_failure: None,
                last_terminal_turn_id: None,
            }),
            operations: vec![],
            interactions: vec![InteractionSnapshot {
                id: "permission-1".to_string(),
                session_id: "session-priority".to_string(),
                kind: crate::acp::projections::InteractionKind::Permission,
                state: InteractionState::Pending,
                json_rpc_request_id: Some(7),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                ),
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
                    auto_accepted: false,
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
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                ),
                permission: "Execute".to_string(),
                patterns: vec![],
                metadata: json!({ "command": "bun test" }),
                always: vec![],
                auto_accepted: false,
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

        let replay_context = replay_context_for_session(&db, "session-priority").await;
        let stored_projection = load_stored_projection(&db, &replay_context)
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

    #[tokio::test]
    async fn resume_resolution_prefers_persisted_agent_over_ui_agent_selection() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-copilot",
            "/project",
            "copilot",
            Some("/project/.worktrees/feature-a"),
        )
        .await
        .unwrap();

        let resolved =
            resolve_resume_session_target(&db, "session-copilot", "/fallback-project", None)
                .await
                .expect("resume target");

        assert_eq!(resolved.descriptor.agent_id, CanonicalAgentId::Copilot);
        assert_eq!(
            resolved.descriptor.compatibility,
            SessionDescriptorCompatibility::Canonical
        );
        assert_eq!(
            resolved.descriptor.effective_cwd,
            "/project/.worktrees/feature-a"
        );
    }

    #[tokio::test]
    async fn resume_resolution_rejects_existing_claude_session_missing_provider_id() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-claude",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();

        let error = resolve_resume_session_target(&db, "session-claude", "/fallback-project", None)
            .await
            .expect_err("resume should fail");

        match error {
            SerializableAcpError::ProtocolError { message } => {
                assert_eq!(
                    message,
                    "session session-claude is not resumable because persisted descriptor facts are missing: provider_session_id"
                );
            }
            other => panic!("expected protocol error, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn resume_resolution_rejects_existing_session_with_incompatible_override() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-copilot",
            "/project",
            "copilot",
            None,
        )
        .await
        .unwrap();

        let error = resolve_resume_session_target(
            &db,
            "session-copilot",
            "/fallback-project",
            Some("claude-code"),
        )
        .await
        .expect_err("override should fail");

        match error {
            SerializableAcpError::ProtocolError { message } => {
                assert_eq!(
                    message,
                    "session session-copilot is bound to copilot and cannot resume with override claude-code"
                );
            }
            other => panic!("expected protocol error, got {:?}", other),
        }
    }

    #[test]
    fn resume_launch_mode_resolution_maps_copilot_modes_to_protocol_uris() {
        let registry = Arc::new(AgentRegistry::new());

        let build_mode =
            resolve_resume_launch_mode_id(&registry, &CanonicalAgentId::Copilot, Some("build"))
                .expect("build launch mode");
        let plan_mode =
            resolve_resume_launch_mode_id(&registry, &CanonicalAgentId::Copilot, Some("plan"))
                .expect("plan launch mode");
        let no_mode = resolve_resume_launch_mode_id(&registry, &CanonicalAgentId::Copilot, None)
            .expect("missing launch mode");

        assert_eq!(
            build_mode,
            Some("https://agentclientprotocol.com/protocol/session-modes#agent".to_string())
        );
        assert_eq!(
            plan_mode,
            Some("https://agentclientprotocol.com/protocol/session-modes#plan".to_string())
        );
        assert_eq!(no_mode, None);
    }

    #[test]
    fn requested_agent_resolution_prefers_explicit_override() {
        let resolved =
            resolve_requested_agent_id(Some("copilot"), Some(CanonicalAgentId::ClaudeCode));

        assert_eq!(resolved, CanonicalAgentId::Copilot);
    }

    #[tokio::test]
    async fn fork_resolution_prefers_source_descriptor_agent_over_active_agent() {
        let db = setup_test_db().await;
        let temp = tempdir().expect("temp dir");
        let repo_path = temp.path().join("repo");
        let worktree_path = temp.path().join("worktrees").join("feature-a");
        let gitdir_path = repo_path.join(".git").join("worktrees").join("feature-a");

        std::fs::create_dir_all(&gitdir_path).expect("create gitdir");
        std::fs::create_dir_all(&worktree_path).expect("create worktree");
        std::fs::write(
            worktree_path.join(".git"),
            format!("gitdir: {}\n", gitdir_path.display()),
        )
        .expect("write .git file");
        let canonical_worktree_path = worktree_path
            .canonicalize()
            .unwrap_or_else(|_| worktree_path.clone());

        persist_session_metadata_for_cwd(
            &db,
            "session-copilot",
            &CanonicalAgentId::Copilot,
            &worktree_path,
        )
        .await
        .unwrap();

        let resolved =
            resolve_fork_session_target(&db, "session-copilot", "/fallback-project", None)
                .await
                .expect("fork target");

        assert_eq!(resolved.launch_agent_id, CanonicalAgentId::Copilot);
        assert_eq!(resolved.fork_parent_session_id, "session-copilot");
        assert_eq!(
            resolved.launch_cwd,
            canonical_worktree_path.to_string_lossy()
        );
    }

    #[tokio::test]
    async fn fork_resolution_uses_provider_history_id_for_claude_sessions() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-claude",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();
        SessionMetadataRepository::set_provider_session_id(
            &db,
            "session-claude",
            "provider-session-1",
        )
        .await
        .unwrap();

        let resolved =
            resolve_fork_session_target(&db, "session-claude", "/fallback-project", None)
                .await
                .expect("fork target");

        assert_eq!(resolved.launch_agent_id, CanonicalAgentId::ClaudeCode);
        assert_eq!(resolved.fork_parent_session_id, "provider-session-1");
    }

    #[tokio::test]
    async fn fork_resolution_rejects_existing_claude_session_missing_provider_id() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-claude",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();

        let error = resolve_fork_session_target(&db, "session-claude", "/fallback-project", None)
            .await
            .expect_err("fork should fail");

        match error {
            SerializableAcpError::ProtocolError { message } => {
                assert_eq!(
                    message,
                    "session session-claude is not forkable because persisted descriptor facts are missing: provider_session_id"
                );
            }
            other => panic!("expected protocol error, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn fork_resolution_allows_intentional_override_without_ui_leak() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-copilot",
            "/project",
            "copilot",
            None,
        )
        .await
        .unwrap();

        let resolved = resolve_fork_session_target(
            &db,
            "session-copilot",
            "/fallback-project",
            Some("cursor"),
        )
        .await
        .expect("fork target");

        assert_eq!(resolved.launch_agent_id, CanonicalAgentId::Cursor);
        assert_eq!(resolved.fork_parent_session_id, "session-copilot");
    }
}
