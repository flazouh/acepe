use super::super::*;
use super::*;

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
        let provider_uses_deferred_creation = registry
            .get(&agent_id_enum)
            .is_some_and(|provider| provider.communication_mode() == CommunicationMode::CcSdk);
        let (project_path, worktree_path) = session_metadata_context_from_cwd(&cwd);
        let creation_attempt_id = if let Some(launch_token) = launch_token.as_deref() {
            launch_token.to_string()
        } else {
            SessionMetadataRepository::create_creation_attempt(
                db.inner(),
                &project_path,
                agent_id_enum.as_str(),
                worktree_path.as_deref(),
            )
            .await
            .map_err(|error| {
                creation_failure(
                    CreationFailureKind::MetadataCommitFailed,
                    format!("Failed to create session creation attempt: {error}"),
                    None,
                    None,
                    true,
                )
            })?
            .id
        };

        // Create and initialize client with cwd so subprocess spawns in correct directory
        let mut client = match create_and_initialize_client(
            &registry,
            &opencode_manager,
            agent_id_enum.clone(),
            app.clone(),
            cwd.clone(),
            "new session",
        )
        .await
        {
            Ok(client) => client,
            Err(error) => {
                mark_creation_attempt_failed(
                    db.inner(),
                    &creation_attempt_id,
                    &format!("client-initialization-failed: {error}"),
                )
                .await;
                // Authentication-required is NOT a creation failure — it's a
                // recoverable precondition ("sign in to continue"). Surface the
                // typed signal verbatim so the panel renders a neutral sign-in
                // card (composer stays usable), instead of burying it in a
                // CreationFailure that would render error chrome.
                if matches!(error, SerializableAcpError::AuthenticationRequired { .. }) {
                    return Err(error);
                }
                return Err(creation_failure_classified(
                    CreationFailureKind::ProviderFailedBeforeId,
                    &error,
                    None,
                    Some(creation_attempt_id),
                    true,
                ));
            }
        };
        if provider_uses_deferred_creation {
            client.bind_pending_creation_attempt(Some(creation_attempt_id.clone()));
        }

        // Create the session
        tracing::debug!("Creating session");
        let result = match client
            .new_session(cwd.to_string_lossy().to_string())
            .await
        {
            Ok(result) => result,
            Err(error) => {
                tracing::error!(error = %error, "New session failed");
                mark_creation_attempt_failed(
                    db.inner(),
                    &creation_attempt_id,
                    &format!("provider-new-session-failed: {error}"),
                )
                .await;
                return Err(creation_failure(
                    CreationFailureKind::ProviderFailedBeforeId,
                    error.to_string(),
                    None,
                    Some(creation_attempt_id),
                    true,
                ));
            }
        };
        if let Err(error) = validate_provider_session_id_for_creation(&result.session_id) {
            mark_creation_attempt_failed(
                db.inner(),
                &creation_attempt_id,
                &format!("provider-session-id-invalid: {error}"),
            )
            .await;
            client.discard_pre_reservation_events(&result.session_id, "invalid_provider_session_id");
            client.stop();
            let message = error.to_string();
            return Err(creation_failure(
                CreationFailureKind::InvalidProviderSessionId,
                message,
                Some(result.session_id),
                Some(creation_attempt_id),
                false,
            ));
        }

        let sequence_id = if provider_uses_deferred_creation {
            SessionMetadataRepository::record_creation_attempt_requested_provider_session_id(
                db.inner(),
                &creation_attempt_id,
                &result.session_id,
            )
            .await
            .map_err(|error| {
                client.stop();
                creation_failure(
                    CreationFailureKind::MetadataCommitFailed,
                    format!(
                        "Failed to bind requested provider session id {} to creation attempt {creation_attempt_id}: {error}",
                        result.session_id
                    ),
                    Some(result.session_id.clone()),
                    Some(creation_attempt_id.clone()),
                    true,
                )
            })?;
            if let Some(launch_token) = launch_token.as_deref() {
                SessionMetadataRepository::get_reserved_worktree_launch(db.inner(), launch_token)
                    .await
                    .map_err(|error| {
                        creation_failure(
                            CreationFailureKind::LaunchTokenUnavailable,
                            format!(
                            "Failed to load deferred worktree launch {launch_token}: {error}"
                        ),
                            Some(result.session_id.clone()),
                            Some(creation_attempt_id.clone()),
                            true,
                        )
                    })?
                    .map(|reserved| reserved.sequence_id)
            } else {
                None
            }
        } else if let Some(launch_token) = launch_token.as_deref() {
            match SessionMetadataRepository::consume_reserved_worktree_launch(
                db.inner(),
                launch_token,
                &result.session_id,
                agent_id_enum.as_str(),
            )
            .await
            {
                Ok(sequence_id) => sequence_id,
                Err(error) => {
                    tracing::error!(
                        error = %error,
                        launch_token,
                        session_id = %result.session_id,
                        "Prepared worktree launch consumption failed; stopping session client"
                    );
                    mark_creation_attempt_failed(
                        db.inner(),
                        &creation_attempt_id,
                        &format!("worktree-launch-promotion-failed: {error}"),
                    )
                    .await;
                    client.discard_pre_reservation_events(
                        &result.session_id,
                        "worktree_launch_promotion_failed",
                    );
                    client.stop();
                    return Err(creation_failure(
                        CreationFailureKind::LaunchTokenUnavailable,
                        format!(
                            "Failed to consume prepared worktree launch {launch_token} for session {}: {error}",
                            result.session_id
                        ),
                        Some(result.session_id),
                        Some(creation_attempt_id),
                        true,
                    ));
                }
            }
        } else {
            let promoted = match SessionMetadataRepository::promote_creation_attempt(
                db.inner(),
                &creation_attempt_id,
                &result.session_id,
            )
            .await
            {
                Ok(promoted) => promoted,
                Err(error) => {
                    tracing::error!(
                        error = %error,
                        attempt_id = %creation_attempt_id,
                        session_id = %result.session_id,
                        "Creation attempt promotion failed; stopping session client"
                    );
                    mark_creation_attempt_failed(
                        db.inner(),
                        &creation_attempt_id,
                        &format!("metadata-promotion-failed: {error}"),
                    )
                    .await;
                    client.discard_pre_reservation_events(
                        &result.session_id,
                        "metadata_promotion_failed",
                    );
                    client.stop();
                    return Err(creation_failure(
                        CreationFailureKind::MetadataCommitFailed,
                        format!(
                            "Failed to promote creation attempt {creation_attempt_id} into session {}: {error}",
                            result.session_id
                        ),
                        Some(result.session_id),
                        Some(creation_attempt_id),
                        true,
                    ));
                }
            };
            promoted.sequence_id
        };
        if !provider_uses_deferred_creation {
            ensure_session_anchor_snapshots(db.inner(), &result.session_id, &agent_id_enum)
                .await
                .map_err(|error| {
                    client.discard_pre_reservation_events(
                        &result.session_id,
                        "anchor_snapshot_failed",
                    );
                    creation_failure(
                        CreationFailureKind::MetadataCommitFailed,
                        format!(
                        "Failed to persist canonical session anchors for session {}: {error}",
                        result.session_id
                    ),
                        Some(result.session_id.clone()),
                        Some(creation_attempt_id.clone()),
                        true,
                    )
                })?;
        }

        tracing::info!(
            session_id = %result.session_id,
            "New session created with dedicated client"
        );
        projection_registry.register_session(result.session_id.clone(), agent_id_enum.clone());
        if !provider_uses_deferred_creation {
            let initial_capabilities = capabilities_from_new_session_response(&app, &result);
            client.begin_pre_reservation_drain(&result.session_id);
            app.state::<Arc<crate::acp::lifecycle::SessionSupervisor>>()
                .inner()
                .reserve_with_capabilities(
                    db.inner(),
                    projection_registry.inner(),
                    &result.session_id,
                    initial_capabilities,
                )
                .await
                .map_err(|error| {
                    tracing::error!(
                        session_id = %result.session_id,
                        error = %error,
                        "Failed to reserve supervisor runtime checkpoint for new session"
                    );
                    client.discard_pre_reservation_events(
                        &result.session_id,
                        "lifecycle_reservation_failed",
                    );
                    client.stop();
                    creation_failure(
                        CreationFailureKind::MetadataCommitFailed,
                        format!(
                            "Failed to reserve lifecycle runtime checkpoint for session {}: {error}",
                            result.session_id
                        ),
                        Some(result.session_id.clone()),
                        Some(creation_attempt_id.clone()),
                        true,
                    )
                })?;
            client.drain_pre_reservation_events(&result.session_id);
        }

        // Store the client keyed by session_id only after session metadata and
        // supervisor state are durably attached.
        if let Some(old_client) =
            session_registry.store(result.session_id.clone(), client, agent_id_enum.clone())
        {
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

        session_registry
            .cache_ready_snapshot(
                &result.session_id,
                ResumeSessionResponse {
                    models: result.models.clone(),
                    modes: result.modes.clone(),
                    available_commands: result.available_commands.clone(),
                    config_options: result.config_options.clone(),
                },
            )
            .map_err(SerializableAcpError::from)?;

        let session_open = if provider_uses_deferred_creation {
            None
        } else {
            Some(build_new_session_open_result(&app, &result, &agent_id_enum).await?)
        };

        Ok(NewSessionResponse {
            creation_attempt_id: Some(creation_attempt_id),
            deferred_creation: provider_uses_deferred_creation,
            sequence_id,
            session_open,
            ..result
        })
    }
    .await)
}
