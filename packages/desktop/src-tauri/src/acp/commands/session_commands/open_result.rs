use super::super::*;
use super::*;

pub(super) async fn build_new_session_open_result(
    app: &AppHandle,
    response: &NewSessionResponse,
    fallback_agent_id: &CanonicalAgentId,
) -> Result<SessionOpenResult, SerializableAcpError> {
    let session_id = &response.session_id;
    let db = app.state::<DbConn>();
    let hub = app.state::<Arc<AcpEventHubState>>();
    let runtime_graph_registry = app.state::<Arc<SessionGraphRuntimeRegistry>>();
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
    let runtime_snapshot = runtime_graph_registry
        .supervisor()
        .snapshot_for_session(session_id)
        .map(|checkpoint| SessionGraphRuntimeSnapshot::from_checkpoint(&checkpoint))
        .ok_or_else(|| SerializableAcpError::InvalidState {
            message: format!("Missing lifecycle checkpoint for new session {session_id}"),
        })?;

    Ok(session_open_result_for_new_session(
        db.inner(),
        hub.inner(),
        NewSessionOpenResultInput {
            session_id: session_id.to_string(),
            agent_id,
            project_path,
            worktree_path: descriptor.worktree_path,
            source_path: descriptor.source_path,
            lifecycle: runtime_snapshot.lifecycle,
            capabilities: runtime_snapshot.capabilities,
        },
    )
    .await)
}

pub(super) fn capabilities_from_new_session_response(
    app: &AppHandle,
    response: &NewSessionResponse,
) -> SessionGraphCapabilities {
    let policy_registry = app.state::<Arc<SessionPolicyRegistry>>();
    SessionGraphCapabilities {
        models: Some(response.models.clone()),
        modes: Some(response.modes.clone()),
        available_commands: Some(response.available_commands.clone()),
        config_options: Some(
            crate::acp::session_update::sanitize_config_options_for_canonical(
                response.config_options.clone(),
            ),
        ),
        autonomous_enabled: Some(policy_registry.is_autonomous(&response.session_id)),
    }
}
