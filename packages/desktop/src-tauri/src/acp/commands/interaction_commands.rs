use super::*;
use crate::acp::pending_prompt_registry::{
    remember_synthetic_user_prompt, synthetic_user_message_update,
};
use crate::acp::session_state_engine::{CapabilityPreviewState, SessionGraphRevision};
use crate::acp::ui_event_dispatcher::publish_direct_session_update;
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_CAPABILITY_MUTATION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct CapabilityMutationContext {
    event_hub: Arc<crate::acp::event_hub::AcpEventHubState>,
    runtime_registry: Arc<crate::acp::session_state_engine::SessionGraphRuntimeRegistry>,
    original_capabilities: crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    pending_capabilities: crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    pending_revision: SessionGraphRevision,
    last_event_seq: i64,
    transcript_revision: i64,
}

fn build_pending_capability_mutation_context<R, F>(
    app: &tauri::AppHandle<R>,
    session_id: &str,
    mutate_capabilities: F,
) -> Option<CapabilityMutationContext>
where
    R: tauri::Runtime,
    F: FnOnce(
        crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    ) -> crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
{
    let event_hub = app
        .try_state::<Arc<crate::acp::event_hub::AcpEventHubState>>()
        .map(|state| Arc::clone(state.inner()))?;
    let runtime_registry = app
        .try_state::<Arc<crate::acp::session_state_engine::SessionGraphRuntimeRegistry>>()
        .map(|state| Arc::clone(state.inner()))?;
    let projection_registry = app
        .try_state::<Arc<crate::acp::projections::ProjectionRegistry>>()
        .map(|state| Arc::clone(state.inner()));
    let transcript_projection_registry = app
        .try_state::<Arc<crate::acp::transcript_projection::TranscriptProjectionRegistry>>()
        .map(|state| Arc::clone(state.inner()));

    let runtime_snapshot = runtime_registry.snapshot_for_session(session_id);
    let last_event_seq = projection_registry
        .as_ref()
        .and_then(|registry| {
            registry
                .session_projection(session_id)
                .session
                .map(|snapshot| snapshot.last_event_seq)
        })
        .unwrap_or(0);
    let transcript_revision = transcript_projection_registry
        .as_ref()
        .and_then(|registry| {
            registry
                .snapshot_for_session(session_id)
                .map(|snapshot| snapshot.revision)
        })
        .unwrap_or(last_event_seq);
    let original_capabilities = runtime_snapshot.capabilities;
    let pending_capabilities = mutate_capabilities(original_capabilities.clone());
    let mutation_id = format!(
        "{session_id}-capability-mutation-{}",
        NEXT_CAPABILITY_MUTATION_ID.fetch_add(1, Ordering::Relaxed)
    );
    let pending_revision = SessionGraphRevision::new(
        runtime_snapshot.graph_revision.saturating_add(1),
        transcript_revision,
        last_event_seq,
    );

    super::session_commands::publish_session_state_envelope(
        &event_hub,
        runtime_registry.build_capabilities_envelope(
            session_id,
            pending_capabilities.clone(),
            pending_revision,
            Some(mutation_id),
            CapabilityPreviewState::Pending,
        ),
    );

    Some(CapabilityMutationContext {
        event_hub,
        runtime_registry,
        original_capabilities,
        pending_capabilities,
        pending_revision,
        last_event_seq,
        transcript_revision,
    })
}

fn finalize_capability_mutation(
    session_id: &str,
    context: CapabilityMutationContext,
    capabilities: crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    preview_state: CapabilityPreviewState,
) {
    let graph_revision = context
        .runtime_registry
        .replace_capabilities_with_graph_seed(
            session_id,
            context.pending_revision.graph_revision,
            capabilities.clone(),
        );
    let revision = SessionGraphRevision::new(
        graph_revision,
        context.transcript_revision,
        context.last_event_seq,
    );

    super::session_commands::publish_session_state_envelope(
        &context.event_hub,
        context.runtime_registry.build_capabilities_envelope(
            session_id,
            capabilities,
            revision,
            None,
            preview_state,
        ),
    );
}

async fn run_capability_mutation<T, RuntimeT, F, R>(
    app: &tauri::AppHandle<RuntimeT>,
    session_id: &str,
    mutate_capabilities: F,
    operation: impl std::future::Future<Output = Result<T, SerializableAcpError>>,
    refine_success: R,
) -> Result<T, SerializableAcpError>
where
    RuntimeT: tauri::Runtime,
    F: FnOnce(
        crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    ) -> crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    R: FnOnce(
        crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
        &T,
    ) -> crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
{
    let context = build_pending_capability_mutation_context(app, session_id, mutate_capabilities);

    match operation.await {
        Ok(value) => {
            if let Some(context) = context {
                let committed_capabilities =
                    refine_success(context.pending_capabilities.clone(), &value);
                finalize_capability_mutation(
                    session_id,
                    context,
                    committed_capabilities,
                    CapabilityPreviewState::Canonical,
                );
            }
            Ok(value)
        }
        Err(error) => {
            if let Some(context) = context {
                let original_capabilities = context.original_capabilities.clone();
                finalize_capability_mutation(
                    session_id,
                    context,
                    original_capabilities,
                    CapabilityPreviewState::Failed,
                );
            }
            Err(error)
        }
    }
}

fn set_pending_model_id(
    mut capabilities: crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    model_id: &str,
) -> crate::acp::session_state_engine::selectors::SessionGraphCapabilities {
    if let Some(models) = capabilities.models.as_mut() {
        models.current_model_id = model_id.to_string();
    } else {
        let mut models = crate::acp::client_session::default_session_model_state();
        models.current_model_id = model_id.to_string();
        capabilities.models = Some(models);
    }
    capabilities
}

fn set_pending_mode_id(
    mut capabilities: crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    mode_id: &str,
) -> crate::acp::session_state_engine::selectors::SessionGraphCapabilities {
    if let Some(modes) = capabilities.modes.as_mut() {
        modes.current_mode_id = mode_id.to_string();
    } else {
        capabilities.modes = Some(crate::acp::client_session::SessionModes {
            current_mode_id: mode_id.to_string(),
            available_modes: Vec::new(),
        });
    }
    capabilities
}

fn set_pending_config_option(
    mut capabilities: crate::acp::session_state_engine::selectors::SessionGraphCapabilities,
    config_id: &str,
    value: &str,
) -> crate::acp::session_state_engine::selectors::SessionGraphCapabilities {
    let updated_options = capabilities
        .config_options
        .into_iter()
        .map(|option| {
            if option.id == config_id {
                crate::acp::session_update::ConfigOptionData {
                    current_value: Some(serde_json::Value::String(value.to_string())),
                    ..option
                }
            } else {
                option
            }
        })
        .collect();
    capabilities.config_options =
        crate::acp::session_update::sanitize_config_options_for_canonical(updated_options);
    capabilities
}

fn config_options_from_response(
    response: &serde_json::Value,
) -> Option<Vec<crate::acp::session_update::ConfigOptionData>> {
    let config_options = response.get("configOptions")?.clone();
    serde_json::from_value(config_options)
        .map(crate::acp::session_update::sanitize_config_options_for_canonical)
        .ok()
}

pub(crate) async fn acp_set_model_for_handle<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    session_id: String,
    model_id: String,
) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_set_model",
        async {
            tracing::debug!(session_id = %session_id, model_id = %model_id, "acp_set_model called");
            let session_registry = app.state::<SessionRegistry>();

            // Get the client for this specific session
            let client_mutex = session_registry.get(&session_id).map_err(|e| {
        tracing::error!(session_id = %session_id, error = %e, "Session not found for set_model");
        SerializableAcpError::from(e)
    })?;

            let mut client_guard =
                lock_session_client(&client_mutex, "acp_set_model: lock").await?;
            run_capability_mutation(
                &app,
                &session_id,
                |capabilities| set_pending_model_id(capabilities, &model_id),
                async {
                    timeout(
                        SESSION_CLIENT_OPERATION_TIMEOUT,
                        client_guard.set_session_model(session_id.clone(), model_id.clone()),
                    )
                    .await
                    .map_err(|_| {
                        tracing::error!("acp_set_model operation timed out");
                        SerializableAcpError::Timeout {
                            operation: "acp_set_model: operation".to_string(),
                        }
                    })?
                    .map_err(SerializableAcpError::from)
                },
                |capabilities, _| capabilities,
            )
            .await
        }
        .await,
    )
}

/// Set the model for a session
#[tauri::command]
#[specta::specta]
pub async fn acp_set_model(
    app: AppHandle,
    session_id: String,
    model_id: String,
) -> CommandResult<()> {
    acp_set_model_for_handle(app, session_id, model_id).await
}

pub(crate) async fn acp_set_mode_for_handle<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    session_id: String,
    mode_id: String,
) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_set_mode",
        async {
            tracing::debug!(session_id = %session_id, mode_id = %mode_id, "acp_set_mode called");
            let session_registry = app.state::<SessionRegistry>();

            // Get the client for this specific session
            let client_mutex = session_registry.get(&session_id).map_err(|e| {
        tracing::error!(session_id = %session_id, error = %e, "Session not found for set_mode");
        SerializableAcpError::from(e)
    })?;

            let mut client_guard = lock_session_client(&client_mutex, "acp_set_mode: lock").await?;
            run_capability_mutation(
                &app,
                &session_id,
                |capabilities| set_pending_mode_id(capabilities, &mode_id),
                async {
                    timeout(
                        SESSION_CLIENT_OPERATION_TIMEOUT,
                        client_guard.set_session_mode(session_id.clone(), mode_id.clone()),
                    )
                    .await
                    .map_err(|_| {
                        tracing::error!("acp_set_mode operation timed out");
                        SerializableAcpError::Timeout {
                            operation: "acp_set_mode: operation".to_string(),
                        }
                    })?
                    .map_err(SerializableAcpError::from)
                },
                |capabilities, _| capabilities,
            )
            .await
        }
        .await,
    )
}

/// Set the mode for a session
#[tauri::command]
#[specta::specta]
pub async fn acp_set_mode(
    app: AppHandle,
    session_id: String,
    mode_id: String,
) -> CommandResult<()> {
    acp_set_mode_for_handle(app, session_id, mode_id).await
}

/// Set a configuration option for a session
#[tauri::command]
#[specta::specta]
pub async fn acp_set_config_option(
    app: AppHandle,
    session_id: String,
    config_id: String,
    value: String,
) -> CommandResult<Value> {
    acp_set_config_option_for_handle(app, session_id, config_id, value).await
}

pub(crate) async fn acp_set_config_option_for_handle<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    session_id: String,
    config_id: String,
    value: String,
) -> CommandResult<Value> {
    expected_acp_command_result("acp_set_config_option", async {
    tracing::debug!(session_id = %session_id, config_id = %config_id, value = %value, "acp_set_config_option called");
    let session_registry = app.state::<SessionRegistry>();

    let client_mutex = session_registry
        .get(&session_id)
        .map_err(|e| {
            tracing::error!(session_id = %session_id, error = %e, "Session not found for set_config_option");
            SerializableAcpError::from(e)
        })?;

    let mut client_guard =
        lock_session_client(&client_mutex, "acp_set_config_option: lock").await?;
    run_capability_mutation(
        &app,
        &session_id,
        |capabilities| set_pending_config_option(capabilities, &config_id, &value),
        async {
            timeout(
                SESSION_CLIENT_OPERATION_TIMEOUT,
                client_guard.set_session_config_option(
                    session_id.clone(),
                    config_id.clone(),
                    value.clone(),
                ),
            )
            .await
            .map_err(|_| {
                tracing::error!("acp_set_config_option operation timed out");
                SerializableAcpError::Timeout {
                    operation: "acp_set_config_option: operation".to_string(),
                }
            })?
            .map_err(SerializableAcpError::from)
        },
        |mut capabilities, response| {
            if let Some(config_options) = config_options_from_response(response) {
                capabilities.config_options = config_options;
            }
            capabilities
        },
    )
    .await
    }
    .await)
}

/// Send a prompt to a session (fire-and-forget)
///
/// This command returns immediately after sending the prompt to the subprocess.
/// The actual response will arrive via session/update notifications which are
/// emitted as Tauri events (`acp-session-update`).
pub(crate) async fn send_prompt_with_app_handle<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: String,
    request: Value,
) -> Result<(), SerializableAcpError> {
    tracing::debug!(session_id = %session_id, "acp_send_prompt called");

    // Deserialize the request Value to a typed PromptRequest
    // Enable streaming to get incremental message updates via session/update notifications
    let mut prompt_request: PromptRequest = serde_json::from_value(json!({
        "sessionId": session_id,
        "prompt": request,
        "stream": true
    }))
    .map_err(|e| SerializableAcpError::SerializationError {
        message: e.to_string(),
    })?;

    // Expand @[text:BASE64] tokens into <pasted-content> blocks before any backend
    // sees the prompt. This is the common chokepoint for all agent clients
    // (ACP subprocess, cc_sdk, OpenCode HTTP).
    crate::acp::attachment_token_expander::expand_text_tokens(&mut prompt_request);

    let session_registry = app.state::<SessionRegistry>();
    let supervisor = app.try_state::<Arc<crate::acp::lifecycle::SessionSupervisor>>();
    let reserved_before_send = supervisor
        .as_ref()
        .and_then(|state| state.inner().snapshot_for_session(&session_id))
        .is_some_and(|checkpoint| {
            checkpoint.lifecycle.status == crate::acp::lifecycle::LifecycleStatus::Reserved
        });
    let has_supervisor_snapshot = supervisor
        .as_ref()
        .and_then(|state| state.inner().snapshot_for_session(&session_id))
        .is_some();
    let ready_dispatch_permit = if reserved_before_send || !has_supervisor_snapshot {
        None
    } else {
        supervisor
            .as_ref()
            .map(|state| {
                state
                    .inner()
                    .issue_ready_dispatch_permit(&session_id)
                    .map_err(|error| SerializableAcpError::ProtocolError {
                        message: error.to_string(),
                    })
            })
            .transpose()?
    };

    // Get the client for this specific session
    let client_mutex = session_registry.get(&session_id).map_err(|e| {
        tracing::error!(session_id = %session_id, error = %e, "Session not found for send_prompt");
        SerializableAcpError::from(e)
    })?;

    let mut client_guard = lock_session_client(&client_mutex, "acp_send_prompt: lock").await?;
    if let (Some(supervisor), Some(permit)) = (supervisor.as_ref(), ready_dispatch_permit.as_ref())
    {
        supervisor
            .inner()
            .validate_ready_dispatch_permit(permit)
            .map_err(|error| SerializableAcpError::ProtocolError {
                message: error.to_string(),
            })?;
    }
    let synthetic_user_update = synthetic_user_message_update(&session_id, &prompt_request.prompt);
    let result = timeout(
        SESSION_CLIENT_OPERATION_TIMEOUT,
        client_guard.send_prompt_fire_and_forget(prompt_request),
    )
    .await
    .map_err(|_| {
        tracing::error!(session_id = %session_id, "acp_send_prompt operation timed out");
        SerializableAcpError::Timeout {
            operation: "acp_send_prompt: operation".to_string(),
        }
    })?
    .map_err(SerializableAcpError::from);

    let should_emit_reserved_lifecycle = reserved_before_send
        && supervisor
            .as_ref()
            .and_then(|state| state.inner().snapshot_for_session(&session_id))
            .is_some_and(|checkpoint| {
                checkpoint.lifecycle.status == crate::acp::lifecycle::LifecycleStatus::Reserved
            });

    if should_emit_reserved_lifecycle {
        let hub = app
            .try_state::<Arc<crate::acp::event_hub::AcpEventHubState>>()
            .map(|state| state.inner().clone());
        let update = match &result {
            Ok(()) => crate::acp::session_update::SessionUpdate::ConnectionComplete {
                session_id: session_id.clone(),
                attempt_id: 0,
                models: crate::acp::client_session::default_session_model_state(),
                modes: crate::acp::client_session::default_modes(),
                available_commands: Vec::new(),
                config_options: Vec::new(),
                autonomous_enabled: app
                    .try_state::<Arc<crate::acp::session_policy::SessionPolicyRegistry>>()
                    .map(|state| state.inner().is_autonomous(&session_id))
                    .unwrap_or(false),
            },
            Err(error) => crate::acp::session_update::SessionUpdate::ConnectionFailed {
                session_id: session_id.clone(),
                attempt_id: 0,
                error: error.to_string(),
            },
        };

        super::session_commands::emit_lifecycle_event(app, &hub, update, &session_id).await;
    }

    if result.is_ok() {
        if let Some(update) = synthetic_user_update {
            let published = publish_direct_session_update(app, update.clone()).await;
            if published {
                remember_synthetic_user_prompt(&update);
            }
        }
    }

    result
}

#[tauri::command]
#[specta::specta]
pub async fn acp_send_prompt(
    app: AppHandle,
    session_id: String,
    request: Value,
) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_send_prompt",
        send_prompt_with_app_handle(&app, session_id, request).await,
    )
}

/// Cancel a session
#[tauri::command]
#[specta::specta]
pub async fn acp_cancel(app: AppHandle, session_id: String) -> CommandResult<()> {
    expected_acp_command_result(
        "acp_cancel",
        async {
            tracing::debug!(session_id = %session_id, "acp_cancel called");
            let session_registry = app.state::<SessionRegistry>();

            // Get the client for this specific session
            let client_mutex = session_registry.get(&session_id).map_err(|e| {
        tracing::error!(session_id = %session_id, error = %e, "Session not found for cancel");
        SerializableAcpError::from(e)
    })?;

            let mut client_guard = lock_session_client(&client_mutex, "acp_cancel: lock").await?;
            let result = timeout(
                SESSION_CLIENT_OPERATION_TIMEOUT,
                client_guard.cancel(session_id),
            )
            .await
            .map_err(|_| {
                tracing::error!("acp_cancel operation timed out");
                SerializableAcpError::Timeout {
                    operation: "acp_cancel: operation".to_string(),
                }
            })?
            .map_err(SerializableAcpError::from);
            result
        }
        .await,
    )
}
