use super::super::*;
use super::*;

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
    expected_acp_command_result(
        "acp_fork_session",
        async {
            let (fork_target, cwd, ready_dispatch_permit) =
                fork_preflight_with_app_handle(&app, &session_id, &cwd, agent_id.as_deref())
                    .await?;
            let registry = app.state::<Arc<AgentRegistry>>();
            let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();
            let session_registry = app.state::<SessionRegistry>();
            let projection_registry = app.state::<Arc<ProjectionRegistry>>();
            let db = app.state::<DbConn>();
            let supervisor = app.try_state::<Arc<SessionSupervisor>>();
            let agent_id_enum = fork_target.launch_agent_id.clone();

            let mut client = create_and_initialize_client(
                &registry,
                &opencode_manager,
                agent_id_enum.clone(),
                app.clone(),
                cwd.clone(),
                "fork session",
            )
            .await?;

            if let (Some(supervisor), Some(permit)) =
                (supervisor.as_ref(), ready_dispatch_permit.as_ref())
            {
                supervisor
                    .inner()
                    .validate_ready_dispatch_permit(permit)
                    .map_err(|error| SerializableAcpError::ProtocolError {
                        message: error.to_string(),
                    })?;
            }

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

            if let Some(old_client) =
                session_registry.store(result.session_id.clone(), client, agent_id_enum.clone())
            {
                tracing::warn!(
                    session_id = %redact_session_id(&result.session_id),
                    agent_id = %agent_id_enum.as_str(),
                    reason = "acp_fork_session replaced existing registry entry",
                    "Stopping replaced session client"
                );
                let mut old =
                    lock_session_client(&old_client, "acp_fork_session: replace lock").await?;
                old.stop();
                tracing::warn!(session_id = %result.session_id, "Replaced existing session client");
            }

            tracing::info!(
                original_session_id = %session_id,
                new_session_id = %result.session_id,
                "Session forked with dedicated client"
            );
            projection_registry.register_session(result.session_id.clone(), agent_id_enum.clone());
            let sequence_id = persist_session_metadata_for_cwd(
                db.inner(),
                &result.session_id,
                &agent_id_enum,
                &cwd,
            )
            .await?;
            let session_open = build_new_session_open_result(&app, &result, &agent_id_enum).await?;
            Ok(NewSessionResponse {
                creation_attempt_id: None,
                deferred_creation: false,
                sequence_id,
                session_open: Some(session_open),
                ..result
            })
        }
        .await,
    )
}

pub(crate) async fn fork_preflight_with_app_handle<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    cwd: &str,
    agent_id: Option<&str>,
) -> Result<
    (
        ResolvedForkSession,
        std::path::PathBuf,
        Option<ReadyDispatchPermit>,
    ),
    SerializableAcpError,
> {
    tracing::info!(session_id = %session_id, cwd = %cwd, agent_id = ?agent_id, "acp_fork_session called");
    let db = app.state::<DbConn>();
    let fork_target = resolve_fork_session_target(db.inner(), session_id, cwd, agent_id).await?;
    let cwd = validate_session_cwd(&fork_target.launch_cwd, ProjectAccessReason::Other)?;
    let ready_dispatch_permit = app
        .try_state::<Arc<SessionSupervisor>>()
        .map(|supervisor| {
            supervisor
                .inner()
                .issue_ready_dispatch_permit(session_id)
                .map_err(|error| SerializableAcpError::ProtocolError {
                    message: error.to_string(),
                })
        })
        .transpose()?;
    Ok((fork_target, cwd, ready_dispatch_permit))
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
            let hub = app
                .try_state::<Arc<AcpEventHubState>>()
                .map(|state| state.inner().clone());
            if let Some(buffer) = app.try_state::<Arc<
                crate::acp::pre_reservation_event_buffer::PreReservationEventBuffer,
            >>() {
                buffer.inner().discard(&session_id, "session_closed");
            }

            let agent_id = session_registry.get_agent_id(&session_id);

            if let Some(client_arc) = session_registry.remove(&session_id, "acp_close_session") {
                // Get exclusive access and stop the client
                tracing::warn!(
                    session_id = %redact_session_id(&session_id),
                    agent_id = ?agent_id,
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

            // GOD: emit a Detached(ClosedByClient) lifecycle envelope so canonical
            // readers see the disconnect through the canonical channel — no
            // client-side synthesis. Must run before projection cleanup so the
            // snapshot can still be built.
            emit_detached_lifecycle(
                &app,
                &hub,
                &session_id,
                crate::acp::lifecycle::DetachedReason::ClosedByClient,
            )
            .await;

            // Clean up streaming accumulator state for this session
            crate::acp::streaming_accumulator::cleanup_session_streaming(&session_id);
            projection_registry.remove_session(&session_id);
            transcript_projection_registry.remove_session(&session_id);

            Ok(())
        }
        .await,
    )
}
