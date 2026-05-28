use super::super::*;
use super::*;

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
    acp_set_session_autonomous_for_handle(app, session_id, enabled).await
}

pub(crate) async fn acp_set_session_autonomous_for_handle<R: tauri::Runtime>(
    app: AppHandle<R>,
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
            let canonical_emit =
                prepare_autonomous_capability_emit(&app, &session_id, enabled).await?;
            session_policy.set_autonomous(&session_id, enabled);
            publish_autonomous_capability_emit(&session_id, canonical_emit);

            Ok(())
        }
        .await,
    )
}

pub(super) struct AutonomousCapabilityEmit {
    event_hub: Arc<AcpEventHubState>,
    runtime_registry: Arc<SessionGraphRuntimeRegistry>,
    revision: SessionGraphRevision,
    capabilities: SessionGraphCapabilities,
}

pub(super) async fn prepare_autonomous_capability_emit<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    enabled: bool,
) -> Result<AutonomousCapabilityEmit, SerializableAcpError> {
    let event_hub = app
        .try_state::<Arc<AcpEventHubState>>()
        .map(|state| Arc::clone(state.inner()))
        .ok_or_else(|| SerializableAcpError::InvalidState {
            message: "Cannot emit autonomous capability update without event hub".to_string(),
        })?;
    let runtime_registry = app
        .try_state::<Arc<SessionGraphRuntimeRegistry>>()
        .map(|state| Arc::clone(state.inner()))
        .ok_or_else(|| SerializableAcpError::InvalidState {
            message: "Cannot emit autonomous capability update without runtime registry"
                .to_string(),
        })?;
    let db = app
        .try_state::<DbConn>()
        .ok_or_else(|| SerializableAcpError::InvalidState {
            message: "Cannot emit autonomous capability update without database".to_string(),
        })?;
    let transcript_projection_registry = app
        .try_state::<Arc<TranscriptProjectionRegistry>>()
        .map(|state| Arc::clone(state.inner()))
        .ok_or_else(|| SerializableAcpError::InvalidState {
            message: "Cannot emit autonomous capability update without transcript registry"
                .to_string(),
        })?;

    let revision = load_live_session_graph_revision(
        db.inner(),
        transcript_projection_registry.as_ref(),
        Some(runtime_registry.as_ref()),
        session_id,
    )
    .await?;
    let mut capabilities = runtime_registry
        .snapshot_for_session(session_id)
        .capabilities;
    capabilities.autonomous_enabled = Some(enabled);

    Ok(AutonomousCapabilityEmit {
        event_hub,
        runtime_registry,
        revision,
        capabilities,
    })
}

pub(super) fn publish_autonomous_capability_emit(session_id: &str, emit: AutonomousCapabilityEmit) {
    let graph_revision = emit.runtime_registry.replace_capabilities_with_graph_seed(
        session_id,
        emit.revision.graph_revision,
        emit.capabilities.clone(),
    );
    let revision = SessionGraphRevision::new(
        graph_revision,
        emit.revision.transcript_revision,
        emit.revision.last_event_seq,
    );
    publish_session_state_envelope(
        &emit.event_hub,
        emit.runtime_registry.build_capabilities_envelope(
            session_id,
            emit.capabilities,
            revision,
            None,
            crate::acp::session_state_engine::CapabilityPreviewState::Canonical,
        ),
    );
}
