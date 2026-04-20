use super::*;
use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::{ProjectionRegistry, SessionProjectionSnapshot};
use crate::acp::session_descriptor::{
    ResolvedForkSession, ResolvedResumeSession, SessionCompatibilityInput,
    SessionDescriptorCompatibility, SessionReplayContext,
};
use crate::acp::session_journal::{
    decode_serialized_events, load_stored_projection, SessionJournalEventPayload,
};
use crate::acp::session_open_snapshot::{
    resolve_canonical_session_title, session_open_result_for_new_session, SessionOpenFound,
    SessionOpenResult,
};
use crate::acp::session_policy::SessionPolicyRegistry;
use crate::acp::session_registry::redact_session_id;
use crate::acp::session_state_engine::bridge::build_snapshot_envelope;
use crate::acp::session_state_engine::envelope::SessionStateEnvelope;
use crate::acp::session_state_engine::protocol::SessionStatePayload;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeRegistry, SessionGraphRuntimeSnapshot,
};
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle, SessionGraphLifecycleStatus,
};
use crate::acp::transcript_projection::{TranscriptProjectionRegistry, TranscriptSnapshot};
use crate::acp::types::CanonicalAgentId;
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use crate::db::repository::{
    SessionJournalEventRepository, SessionMetadataRepository, SessionMetadataRow,
    SessionProjectionSnapshotRepository, SessionTranscriptSnapshotRepository,
};
use sea_orm::DbConn;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use std::sync::Arc;

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

    ensure_session_anchor_snapshots(db, session_id, agent_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to persist canonical session anchors for session {session_id}: {error}"
            ),
        })?;

    Ok(sequence_id)
}

async fn ensure_session_anchor_snapshots(
    db: &DbConn,
    session_id: &str,
    agent_id: &CanonicalAgentId,
) -> anyhow::Result<()> {
    if SessionTranscriptSnapshotRepository::get(db, session_id)
        .await?
        .is_none()
    {
        SessionTranscriptSnapshotRepository::set(
            db,
            session_id,
            &TranscriptSnapshot::from_stored_entries(0, &[]),
        )
        .await?;
    }

    if SessionProjectionSnapshotRepository::get(db, session_id)
        .await?
        .is_none()
    {
        SessionProjectionSnapshotRepository::set(
            db,
            session_id,
            &SessionProjectionSnapshot {
                session: Some(crate::acp::projections::SessionSnapshot::new(
                    session_id.to_string(),
                    Some(agent_id.clone()),
                )),
                operations: Vec::new(),
                interactions: Vec::new(),
            },
        )
        .await?;
    }

    Ok(())
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

async fn build_new_session_open_result(
    app: &AppHandle,
    session_id: &str,
    fallback_agent_id: &CanonicalAgentId,
) -> Result<SessionOpenResult, SerializableAcpError> {
    let db = app.state::<DbConn>();
    let hub = app.state::<Arc<AcpEventHubState>>();
    let metadata = SessionMetadataRepository::get_by_id(db.inner(), session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load persisted metadata for new session {session_id}: {error}"
            ),
        })?
        .ok_or_else(|| SerializableAcpError::SessionNotFound {
            session_id: session_id.to_string(),
        })?;
    let descriptor = metadata.descriptor_facts();
    let agent_id = descriptor
        .agent_id
        .unwrap_or_else(|| fallback_agent_id.clone());
    let project_path = descriptor.project_path.unwrap_or_default();

    Ok(session_open_result_for_new_session(
        db.inner(),
        hub.inner(),
        session_id,
        agent_id,
        project_path,
        descriptor.worktree_path,
        descriptor.source_path,
    )
    .await)
}

/// Initialize the ACP connection.
///
/// With per-session clients, this is now a lightweight check.
/// Actual initialization happens per-session in acp_new_session.
#[tauri::command]
#[specta::specta]
pub async fn acp_initialize(_app: AppHandle) -> CommandResult<InitializeResponse> {
    expected_acp_command_result(
        "acp_initialize",
        async {
            tracing::info!("acp_initialize called (per-session architecture - no global client)");

            // Return a mock response - real initialization happens per-session
            Ok(InitializeResponse {
                protocol_version: 1,
                agent_capabilities: serde_json::json!({}),
                agent_info: serde_json::json!({}),
                auth_methods: vec![],
            })
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn acp_get_event_bridge_info(app: AppHandle) -> CommandResult<AcpEventBridgeInfo> {
    expected_acp_command_result(
        "acp_get_event_bridge_info",
        async {
            let hub = app.state::<Arc<AcpEventHubState>>();
            hub.get_bridge_info().await.ok_or_else(|| {
                tracing::error!("ACP event bridge server not initialized");
                SerializableAcpError::InvalidState {
                    message: "ACP event bridge server not initialized".to_string(),
                }
            })
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn acp_set_session_autonomous(
    app: AppHandle,
    session_id: String,
    enabled: bool,
) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_set_session_autonomous",
        async {
            tracing::debug!(
                session_id = %session_id,
                enabled,
                "acp_set_session_autonomous called"
            );

            let session_policy = app.state::<Arc<SessionPolicyRegistry>>();
            session_policy.set_autonomous(&session_id, enabled);

            Ok(())
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn acp_get_session_state(
    app: AppHandle,
    session_id: String,
) -> CommandResult<SessionStateEnvelope> {
    expected_acp_command_result("acp_get_session_state", async {
        let lookup = load_session_projection_lookup(&app, &session_id).await?;
        let db = app.state::<DbConn>();
        let transcript_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
        let canonical_session_id = lookup
            .replay_context
            .as_ref()
            .map(|context| context.local_session_id.clone())
            .unwrap_or_else(|| session_id.clone());
        let canonical_metadata = if canonical_session_id == session_id {
            lookup.metadata.clone()
        } else {
            SessionMetadataRepository::get_by_id(db.inner(), &canonical_session_id)
                .await
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!(
                        "Failed to load session metadata for state lookup {canonical_session_id}: {error}"
                    ),
                })?
        };
        let descriptor = canonical_metadata.as_ref().map(SessionMetadataRow::descriptor_facts);
        let SessionProjectionSnapshot {
            session,
            operations,
            interactions,
        } = lookup.projection;
        let projection_session = session.as_ref();
        let last_event_seq = projection_session
            .map(|session| session.last_event_seq)
            .unwrap_or(0);
        let transcript_snapshot = transcript_registry
            .snapshot_for_session(&canonical_session_id)
            .or_else(|| transcript_registry.snapshot_for_session(&session_id))
            .or(
                SessionTranscriptSnapshotRepository::get(db.inner(), &canonical_session_id)
                    .await
                    .map_err(|error| SerializableAcpError::InvalidState {
                        message: format!(
                            "Failed to load transcript snapshot for state lookup {canonical_session_id}: {error}"
                        ),
                    })?,
            )
            .unwrap_or_else(|| TranscriptSnapshot::from_stored_entries(last_event_seq, &[]));
        let agent_id = lookup
            .replay_context
            .as_ref()
            .map(|context| context.agent_id.clone())
            .or_else(|| descriptor.as_ref().and_then(|facts| facts.agent_id.clone()))
            .or_else(|| projection_session.and_then(|session| session.agent_id.clone()))
            .unwrap_or(CanonicalAgentId::ClaudeCode);
        let project_path = lookup
            .replay_context
            .as_ref()
            .map(|context| context.project_path.clone())
            .or_else(|| descriptor.as_ref().and_then(|facts| facts.project_path.clone()))
            .unwrap_or_default();
        let worktree_path = lookup
            .replay_context
            .as_ref()
            .and_then(|context| context.worktree_path.clone())
            .or_else(|| descriptor.as_ref().and_then(|facts| facts.worktree_path.clone()));
        let source_path = lookup
            .replay_context
            .as_ref()
            .and_then(|context| context.source_path.clone())
            .or_else(|| descriptor.as_ref().and_then(|facts| facts.source_path.clone()));
        let found = SessionOpenFound {
            requested_session_id: session_id.clone(),
            canonical_session_id: canonical_session_id.clone(),
            is_alias: session_id != canonical_session_id,
            last_event_seq,
            open_token: String::new(),
            agent_id,
            project_path,
            worktree_path,
            source_path,
            transcript_snapshot,
            session_title: resolve_canonical_session_title(
                canonical_metadata.as_ref(),
                &canonical_session_id,
            ),
            operations,
            interactions,
            turn_state: projection_session
                .map(|session| session.turn_state.clone())
                .unwrap_or(crate::acp::projections::SessionTurnState::Idle),
            message_count: projection_session
                .map(|session| session.message_count)
                .unwrap_or(0),
            active_turn_failure: projection_session.and_then(|session| session.active_turn_failure.clone()),
            last_terminal_turn_id: projection_session
                .and_then(|session| session.last_terminal_turn_id.clone()),
        };

        let runtime_snapshot = runtime_snapshot_for_refresh(
            app.try_state::<Arc<SessionGraphRuntimeRegistry>>()
                .map(|registry| registry.inner().as_ref()),
            &canonical_session_id,
        );

        Ok(build_snapshot_envelope(
            &found,
            runtime_snapshot.lifecycle,
            runtime_snapshot.capabilities,
        ))
    }
    .await)
}

#[derive(Debug, Clone)]
struct SessionProjectionLookup {
    projection: SessionProjectionSnapshot,
    metadata: Option<SessionMetadataRow>,
    replay_context: Option<SessionReplayContext>,
}

async fn load_session_projection_lookup(
    app: &AppHandle,
    session_id: &str,
) -> Result<SessionProjectionLookup, SerializableAcpError> {
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let runtime_projection = projection_registry.session_projection(session_id);
    let db = app.state::<DbConn>();
    let metadata = SessionMetadataRepository::get_by_id(db.inner(), session_id)
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
                session_id,
                Some(row),
                SessionCompatibilityInput::default(),
            )
        })
        .transpose()
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Failed to resolve replay context for session {session_id}: {error}"),
        })?;

    if projection_has_runtime_state(&runtime_projection) {
        return Ok(SessionProjectionLookup {
            projection: runtime_projection,
            metadata,
            replay_context,
        });
    }

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
        return Ok(SessionProjectionLookup {
            projection: stored_projection,
            metadata,
            replay_context,
        });
    }

    let Some(_metadata) = metadata.as_ref() else {
        return Ok(SessionProjectionLookup {
            projection: runtime_projection,
            metadata,
            replay_context,
        });
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
        return Ok(SessionProjectionLookup {
            projection: runtime_projection,
            metadata,
            replay_context,
        });
    };

    let imported_projection = ProjectionRegistry::project_thread_snapshot(
        session_id,
        Some(
            replay_context
                .as_ref()
                .expect("replay context should exist with metadata")
                .agent_id
                .clone(),
        ),
        &imported_thread_snapshot,
    );

    Ok(SessionProjectionLookup {
        projection: imported_projection,
        metadata,
        replay_context,
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
        let session_open =
            build_new_session_open_result(&app, &result.session_id, &agent_id_enum).await?;

        Ok(NewSessionResponse {
            sequence_id,
            session_open: Some(session_open),
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
        let agent_id_enum = resume_target.descriptor.agent_id.clone();

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
                    launch_mode_id,
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
                    emit_lifecycle_event(&app_clone, &hub, update, &session_id).await;
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
                    emit_lifecycle_event(&app_clone, &hub, update, &session_id).await;
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
                    emit_lifecycle_event(&app_clone, &hub, update, &session_id).await;
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
                emit_lifecycle_event(&app_panic, &hub, update, &session_id_panic).await;
            }
        });

        Ok(())
    }
    .await)
}

/// Emit a lifecycle event directly to the event hub, bypassing the rate-limited dispatcher.
async fn emit_lifecycle_event(
    app: &AppHandle,
    hub: &Option<Arc<AcpEventHubState>>,
    update: crate::acp::session_update::SessionUpdate,
    session_id: &str,
) {
    let Some(hub) = hub else {
        tracing::warn!(session_id = %session_id, "Event hub unavailable, lifecycle event dropped");
        return;
    };
    if let Some(runtime_registry) = app.try_state::<Arc<SessionGraphRuntimeRegistry>>() {
        runtime_registry
            .inner()
            .apply_session_update(session_id, &update);
    }
    let session_state_envelopes =
        build_live_session_state_envelopes(&update, revision_placeholder());
    let event = crate::acp::ui_event_dispatcher::AcpUiEvent::session_update(update.clone());
    if let Err(err) = event.publish_direct(hub) {
        tracing::error!(session_id = %session_id, error = %err, "Failed to publish lifecycle event");
    }

    let revision = match load_live_session_graph_revision(
        app.state::<DbConn>().inner(),
        app.state::<Arc<TranscriptProjectionRegistry>>().inner(),
        session_id,
    )
    .await
    {
        Ok(revision) => revision,
        Err(error) => {
            tracing::error!(
                session_id = %session_id,
                error = %error,
                "Failed to determine live session graph revision for lifecycle envelope"
            );
            return;
        }
    };
    for envelope in session_state_envelopes
        .into_iter()
        .map(|envelope| rewrite_session_state_revision(envelope, revision))
    {
        publish_session_state_envelope(hub, envelope);
    }
}

async fn load_live_session_graph_revision(
    db: &DbConn,
    transcript_projection_registry: &TranscriptProjectionRegistry,
    session_id: &str,
) -> Result<SessionGraphRevision, SerializableAcpError> {
    let last_event_seq = SessionJournalEventRepository::max_event_seq(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to determine live session graph revision for session {session_id}: {error}"
            ),
        })?
        .unwrap_or(0);
    let transcript_revision = transcript_projection_registry
        .snapshot_for_session(session_id)
        .or(SessionTranscriptSnapshotRepository::get(db, session_id)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to determine transcript frontier for session {session_id}: {error}"
                ),
            })?)
        .map(|snapshot| snapshot.revision)
        .unwrap_or(0);
    Ok(SessionGraphRevision::new(
        last_event_seq,
        transcript_revision,
        last_event_seq,
    ))
}

fn runtime_snapshot_for_refresh(
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
    session_id: &str,
) -> SessionGraphRuntimeSnapshot {
    runtime_registry
        .map(|registry| registry.snapshot_for_session(session_id))
        .unwrap_or_default()
}

pub(crate) fn build_live_session_state_envelopes(
    update: &crate::acp::session_update::SessionUpdate,
    revision: SessionGraphRevision,
) -> Vec<SessionStateEnvelope> {
    match update {
        crate::acp::session_update::SessionUpdate::ConnectionComplete {
            session_id,
            models,
            modes,
            available_commands,
            config_options,
            ..
        } => {
            let capabilities = SessionGraphCapabilities {
                models: Some(models.clone()),
                modes: Some(modes.clone()),
                available_commands: available_commands.clone(),
                config_options: config_options.clone(),
            };
            vec![
                SessionStateEnvelope {
                    session_id: session_id.clone(),
                    graph_revision: revision.graph_revision,
                    last_event_seq: revision.last_event_seq,
                    payload: SessionStatePayload::Capabilities {
                        capabilities: Box::new(capabilities),
                        revision,
                    },
                },
                SessionStateEnvelope {
                    session_id: session_id.clone(),
                    graph_revision: revision.graph_revision,
                    last_event_seq: revision.last_event_seq,
                    payload: SessionStatePayload::Lifecycle {
                        lifecycle: SessionGraphLifecycle {
                            status: SessionGraphLifecycleStatus::Ready,
                            error_message: None,
                            can_reconnect: true,
                        },
                        revision,
                    },
                },
            ]
        }
        crate::acp::session_update::SessionUpdate::ConnectionFailed {
            session_id, error, ..
        } => vec![SessionStateEnvelope {
            session_id: session_id.clone(),
            graph_revision: revision.graph_revision,
            last_event_seq: revision.last_event_seq,
            payload: SessionStatePayload::Lifecycle {
                lifecycle: SessionGraphLifecycle {
                    status: SessionGraphLifecycleStatus::Error,
                    error_message: Some(error.clone()),
                    can_reconnect: true,
                },
                revision,
            },
        }],
        _ => Vec::new(),
    }
}

const fn revision_placeholder() -> SessionGraphRevision {
    SessionGraphRevision::new(0, 0, 0)
}

fn rewrite_session_state_revision(
    mut envelope: SessionStateEnvelope,
    revision: SessionGraphRevision,
) -> SessionStateEnvelope {
    envelope.graph_revision = revision.graph_revision;
    envelope.last_event_seq = revision.last_event_seq;
    envelope.payload = match envelope.payload {
        SessionStatePayload::Capabilities { capabilities, .. } => {
            SessionStatePayload::Capabilities {
                capabilities,
                revision,
            }
        }
        SessionStatePayload::Lifecycle { lifecycle, .. } => SessionStatePayload::Lifecycle {
            lifecycle,
            revision,
        },
        payload => payload,
    };
    envelope
}

fn publish_session_state_envelope(hub: &Arc<AcpEventHubState>, envelope: SessionStateEnvelope) {
    let session_state_payload = serde_json::to_value(&envelope).unwrap_or_else(|error| {
        tracing::error!(
            %error,
            session_id = %envelope.session_id,
            graph_revision = envelope.graph_revision,
            last_event_seq = envelope.last_event_seq,
            "Failed to serialize ACP session state envelope"
        );
        Value::Null
    });
    let session_state_event = crate::acp::ui_event_dispatcher::AcpUiEvent::json_event(
        "acp-session-state",
        session_state_payload,
        Some(envelope.session_id.clone()),
        crate::acp::ui_event_dispatcher::AcpUiEventPriority::Normal,
        false,
    );
    if let Err(error) = session_state_event.publish_direct(hub) {
        tracing::error!(
            error = %error,
            session_id = %envelope.session_id,
            graph_revision = envelope.graph_revision,
            last_event_seq = envelope.last_event_seq,
            "Failed to publish direct ACP session state envelope"
        );
    }
}

fn replay_buffered_session_state_events(
    hub: &AcpEventHubState,
    session_id: &str,
    frontier_last_event_seq: i64,
    buffered_events: Vec<crate::acp::event_hub::AcpEventEnvelope>,
) {
    let replayable = buffered_events
        .into_iter()
        .filter(|event| event.event_name == "acp-session-state")
        .filter(|event| event.session_id.as_deref() == Some(session_id))
        .filter(|event| {
            serde_json::from_value::<SessionStateEnvelope>(event.payload.clone())
                .map(|envelope| envelope.last_event_seq > frontier_last_event_seq)
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    if replayable.is_empty() {
        return;
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

    let journal_max = SessionJournalEventRepository::max_event_seq(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to determine journal cutoff for resumed session {session_id}: {error}"
            ),
        })?;
    let metadata = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load session metadata for resumed session {session_id}: {error}"
            ),
        })?;
    let has_metadata = metadata.is_some();
    if has_metadata && journal_max == Some(1) {
        let first_event = crate::db::entities::session_journal_event::Entity::find()
            .filter(crate::db::entities::session_journal_event::Column::SessionId.eq(session_id))
            .filter(crate::db::entities::session_journal_event::Column::EventSeq.eq(1))
            .one(db)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to inspect journal events for resumed session {session_id}: {error}"
                ),
            })?;
        if first_event
            .as_ref()
            .is_some_and(|event| event.event_kind == "materialization_barrier")
        {
            return Ok(TranscriptSnapshot::from_stored_entries(1, &[]));
        }
    }
    if let Some(metadata) = metadata {
        if let Some(transcript) =
            rebuild_transcript_snapshot_from_journal(db, session_id, &metadata).await?
        {
            return Ok(transcript);
        }

        return Ok(TranscriptSnapshot::from_stored_entries(
            journal_max.unwrap_or(0),
            &[],
        ));
    }

    Err(SerializableAcpError::InvalidState {
        message: format!("Missing canonical transcript snapshot for resumed session {session_id}"),
    })
}

async fn rebuild_transcript_snapshot_from_journal(
    db: &DbConn,
    session_id: &str,
    metadata: &SessionMetadataRow,
) -> Result<Option<TranscriptSnapshot>, SerializableAcpError> {
    let Some(agent_id) = metadata.agent_id_enum() else {
        return Ok(None);
    };

    let replay_context = SessionReplayContext {
        local_session_id: session_id.to_string(),
        history_session_id: metadata.history_session_id().to_string(),
        agent_id: agent_id.clone(),
        parser_agent_type: crate::acp::parsers::AgentType::from_canonical(&agent_id),
        project_path: metadata.project_path.clone(),
        worktree_path: metadata.worktree_path.clone(),
        effective_cwd: metadata
            .effective_project_path()
            .unwrap_or(metadata.project_path.as_str())
            .to_string(),
        source_path: SessionMetadataRepository::normalized_source_path(&metadata.file_path),
        compatibility: SessionDescriptorCompatibility::Canonical,
    };
    let rows = SessionJournalEventRepository::list_serialized(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load journal rows for resumed session {session_id}: {error}"
            ),
        })?;
    let events = decode_serialized_events(&replay_context, rows).map_err(|error| {
        SerializableAcpError::InvalidState {
            message: format!(
                "Failed to decode journal rows for resumed session {session_id}: {error}"
            ),
        }
    })?;
    let transcript_registry = TranscriptProjectionRegistry::new();
    let mut saw_projection_update = false;

    for event in events {
        let SessionJournalEventPayload::ProjectionUpdate { update } = event.payload else {
            continue;
        };
        saw_projection_update = true;
        let session_update = update.into_session_update();
        let _ = transcript_registry.apply_session_update(event.event_seq, &session_update);
    }

    if !saw_projection_update {
        return Ok(None);
    }

    Ok(transcript_registry.snapshot_for_session(session_id))
}

/// The heavy async work extracted from `acp_resume_session`.
/// This runs inside `tokio::spawn` under a `RESUME_SESSION_TIMEOUT` deadline.
async fn async_resume_session_work(
    app: &AppHandle,
    session_id: &str,
    cwd: PathBuf,
    agent_id_enum: CanonicalAgentId,
    launch_mode_id: Option<String>,
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
        launch_mode_id,
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

    let replay_context: crate::acp::session_descriptor::SessionReplayContext =
        resume_descriptor.clone().into();
    crate::history::commands::session_loading::ensure_canonical_session_materialized(
        app.clone(),
        &replay_context,
    )
    .await
    .map_err(|error| SerializableAcpError::InvalidState {
        message: format!(
            "Failed to materialize canonical session state for resumed session {session_id}: {error}"
        ),
    })?;
    let transcript_snapshot = load_transcript_snapshot_for_resume(db.inner(), session_id).await?;
    transcript_projection_registry
        .restore_session_snapshot(session_id.to_string(), transcript_snapshot);

    if let Some(open_token) = parsed_open_token {
        let hub = app.state::<Arc<AcpEventHubState>>();
        let claim = if let Some(claim) = hub.claim_reservation_for_session(open_token, session_id) {
            claim
        } else {
            return Err(SerializableAcpError::InvalidState {
                message: format!("Session open token is no longer valid for session {session_id}"),
            });
        };
        replay_buffered_session_state_events(
            hub.inner(),
            session_id,
            claim.last_event_seq,
            claim.buffered_events,
        );
    }

    let db = app.state::<DbConn>();
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
    use super::replay_buffered_session_state_events;
    use crate::acp::event_hub::{AcpEventEnvelope, AcpEventHubState};
    use crate::acp::session_state_engine::protocol::{SessionStateDelta, SessionStatePayload};
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_state_engine::SessionStateEnvelope;
    use serde_json::{json, to_value};

    #[test]
    fn replay_buffered_session_state_events_replays_only_matching_post_frontier_envelopes() {
        let hub = AcpEventHubState::new();
        let mut receiver = hub.subscribe();

        replay_buffered_session_state_events(
            &hub,
            "session-1",
            7,
            vec![
                AcpEventEnvelope {
                    seq: 7,
                    event_name: "acp-session-state".to_string(),
                    session_id: Some("session-1".to_string()),
                    payload: to_value(SessionStateEnvelope {
                        session_id: "session-1".to_string(),
                        graph_revision: 7,
                        last_event_seq: 7,
                        payload: SessionStatePayload::Delta {
                            delta: SessionStateDelta {
                                from_revision: SessionGraphRevision::new(6, 6, 6),
                                to_revision: SessionGraphRevision::new(7, 7, 7),
                                transcript_operations: vec![],
                                changed_fields: vec!["transcriptSnapshot".to_string()],
                            },
                        },
                    })
                    .expect("serialize envelope"),
                    priority: "normal".to_string(),
                    droppable: false,
                    emitted_at_ms: 1,
                },
                AcpEventEnvelope {
                    seq: 8,
                    event_name: "acp-session-state".to_string(),
                    session_id: Some("session-1".to_string()),
                    payload: to_value(SessionStateEnvelope {
                        session_id: "session-1".to_string(),
                        graph_revision: 8,
                        last_event_seq: 8,
                        payload: SessionStatePayload::Delta {
                            delta: SessionStateDelta {
                                from_revision: SessionGraphRevision::new(7, 7, 7),
                                to_revision: SessionGraphRevision::new(8, 8, 8),
                                transcript_operations: vec![],
                                changed_fields: vec!["transcriptSnapshot".to_string()],
                            },
                        },
                    })
                    .expect("serialize envelope"),
                    priority: "normal".to_string(),
                    droppable: false,
                    emitted_at_ms: 2,
                },
                AcpEventEnvelope {
                    seq: 9,
                    event_name: "acp-session-update".to_string(),
                    session_id: Some("session-1".to_string()),
                    payload: json!({ "type": "agentMessageChunk" }),
                    priority: "normal".to_string(),
                    droppable: true,
                    emitted_at_ms: 3,
                },
                AcpEventEnvelope {
                    seq: 10,
                    event_name: "acp-session-state".to_string(),
                    session_id: Some("session-2".to_string()),
                    payload: json!({ "lastEventSeq": 9 }),
                    priority: "normal".to_string(),
                    droppable: false,
                    emitted_at_ms: 4,
                },
            ],
        );

        let replayed = receiver
            .try_recv()
            .expect("matching post-frontier envelope should replay");
        assert_eq!(replayed.seq, 8);
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
        let session_open =
            build_new_session_open_result(&app, &result.session_id, &agent_id_enum).await?;
        Ok(NewSessionResponse {
            sequence_id,
            session_open: Some(session_open),
            ..result
        })
    }
    .await)
}

/// Close a session and clean up its client
#[tauri::command]
#[specta::specta]
pub async fn acp_close_session(app: AppHandle, session_id: String) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_close_session",
        async {
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
                let mut client =
                    lock_session_client(&client_arc, "acp_close_session: lock").await?;
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
                SessionProjectionSnapshotRepository::set(
                    db.inner(),
                    &session_id,
                    &runtime_projection,
                )
                .await
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!(
                        "Failed to persist projection snapshot for session {session_id}: {error}"
                    ),
                })?;
            }
            projection_registry.remove_session(&session_id);
            if let Some(transcript_snapshot) =
                transcript_projection_registry.snapshot_for_session(&session_id)
            {
                SessionTranscriptSnapshotRepository::set(
                    db.inner(),
                    &session_id,
                    &transcript_snapshot,
                )
                .await
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!(
                        "Failed to persist transcript snapshot for session {session_id}: {error}"
                    ),
                })?;
            }
            transcript_projection_registry.remove_session(&session_id);

            Ok(())
        }
        .await,
    )
}

fn projection_has_runtime_state(snapshot: &SessionProjectionSnapshot) -> bool {
    snapshot.session.is_some()
        || !snapshot.operations.is_empty()
        || !snapshot.interactions.is_empty()
}

#[cfg(test)]
mod tests {
    use super::{
        load_live_session_graph_revision, load_transcript_snapshot_for_resume,
        persist_session_metadata_for_cwd, resolve_fork_session_target, resolve_requested_agent_id,
        resolve_resume_session_target, runtime_snapshot_for_refresh,
    };
    use crate::acp::error::SerializableAcpError;
    use crate::acp::projections::{InteractionResponse, InteractionState};
    use crate::acp::session_descriptor::{
        SessionCompatibilityInput, SessionDescriptorCompatibility, SessionReplayContext,
    };
    use crate::acp::session_journal::load_stored_projection;
    use crate::acp::session_state_engine::{
        SessionGraphLifecycleStatus, SessionGraphRuntimeRegistry,
    };
    use crate::acp::session_update::{PermissionData, SessionUpdate};
    use crate::acp::transcript_projection::TranscriptSnapshot;
    use crate::acp::types::CanonicalAgentId;
    use crate::db::migrations::Migrator;
    use crate::db::repository::{
        SessionJournalEventRepository, SessionMetadataRepository,
        SessionTranscriptSnapshotRepository,
    };
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use serde_json::json;
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
    async fn load_stored_projection_rebuilds_from_journal_events() {
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
    async fn resume_requires_canonical_transcript_snapshot() {
        let db = setup_test_db().await;

        let error = load_transcript_snapshot_for_resume(&db, "missing-session")
            .await
            .expect_err("missing canonical transcript should error");

        let SerializableAcpError::InvalidState { message } = error else {
            panic!("expected invalid state error");
        };
        assert!(message.contains("Missing canonical transcript snapshot"));
    }

    #[tokio::test]
    async fn resume_uses_persisted_canonical_transcript_snapshot() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "resume-session",
            "/project",
            "claude-code",
            None,
        )
        .await
        .expect("seed metadata");
        SessionTranscriptSnapshotRepository::set(
            &db,
            "resume-session",
            &TranscriptSnapshot::from_stored_entries(3, &[]),
        )
        .await
        .expect("persist transcript snapshot");

        let transcript = load_transcript_snapshot_for_resume(&db, "resume-session")
            .await
            .expect("load transcript snapshot");

        assert_eq!(transcript.revision, 3);
    }

    #[tokio::test]
    async fn live_session_graph_revision_keeps_transcript_frontier_distinct() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "live-session",
            "/project",
            "claude-code",
            None,
        )
        .await
        .expect("seed metadata");
        SessionTranscriptSnapshotRepository::set(
            &db,
            "live-session",
            &TranscriptSnapshot::from_stored_entries(3, &[]),
        )
        .await
        .expect("persist transcript snapshot");
        SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
            .await
            .expect("append barrier 1");
        SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
            .await
            .expect("append barrier 2");
        SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
            .await
            .expect("append barrier 3");
        SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
            .await
            .expect("append barrier 4");
        SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
            .await
            .expect("append barrier 5");

        let revision = load_live_session_graph_revision(
            &db,
            &crate::acp::transcript_projection::TranscriptProjectionRegistry::new(),
            "live-session",
        )
        .await
        .expect("load live graph revision");

        assert_eq!(revision.graph_revision, 5);
        assert_eq!(revision.transcript_revision, 3);
        assert_eq!(revision.last_event_seq, 5);
    }

    #[test]
    fn runtime_snapshot_for_refresh_prefers_runtime_registry_state() {
        let registry = SessionGraphRuntimeRegistry::new();
        registry.apply_session_update(
            "session-1",
            &SessionUpdate::ConnectionComplete {
                session_id: "session-1".to_string(),
                attempt_id: 1,
                models: crate::acp::client_session::default_session_model_state(),
                modes: crate::acp::client_session::default_modes(),
                available_commands: vec![crate::acp::session_update::AvailableCommand {
                    name: "compact".to_string(),
                    description: "Compact".to_string(),
                    input: None,
                }],
                config_options: Vec::new(),
                autonomous_enabled: false,
            },
        );

        let snapshot = runtime_snapshot_for_refresh(Some(&registry), "session-1");

        assert_eq!(
            snapshot.lifecycle.status,
            SessionGraphLifecycleStatus::Ready
        );
        assert_eq!(snapshot.capabilities.available_commands.len(), 1);
    }

    #[tokio::test]
    async fn resume_returns_empty_transcript_for_existing_empty_session() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "empty-session",
            "/project",
            "claude-code",
            None,
        )
        .await
        .expect("seed metadata");

        let transcript = load_transcript_snapshot_for_resume(&db, "empty-session")
            .await
            .expect("empty persisted session should resume");

        assert_eq!(transcript.revision, 0);
        assert!(transcript.entries.is_empty());
    }

    #[tokio::test]
    async fn resume_returns_empty_transcript_for_barrier_only_session() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "barrier-only-session",
            "/project",
            "claude-code",
            None,
        )
        .await
        .expect("seed metadata");
        SessionJournalEventRepository::append_materialization_barrier(&db, "barrier-only-session")
            .await
            .expect("append barrier");

        let transcript = load_transcript_snapshot_for_resume(&db, "barrier-only-session")
            .await
            .expect("barrier-only session should resume");

        assert_eq!(transcript.revision, 1);
        assert!(transcript.entries.is_empty());
    }

    #[tokio::test]
    async fn resume_returns_empty_transcript_for_known_session_without_snapshot() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "journal-only-session",
            "/project",
            "claude-code",
            None,
        )
        .await
        .expect("seed metadata");
        SessionJournalEventRepository::append_materialization_barrier(&db, "journal-only-session")
            .await
            .expect("append barrier");
        SessionJournalEventRepository::append_materialization_barrier(&db, "journal-only-session")
            .await
            .expect("append second barrier");

        let transcript = load_transcript_snapshot_for_resume(&db, "journal-only-session")
            .await
            .expect("known session without snapshot should resume");

        assert_eq!(transcript.revision, 2);
        assert!(transcript.entries.is_empty());
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
