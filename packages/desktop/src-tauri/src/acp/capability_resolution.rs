use crate::acp::client_session::{
    apply_provider_metadata, apply_provider_model_fallback, default_modes, default_session_model_state,
    AvailableMode, AvailableModel, SessionModelState, SessionModes,
};
use crate::acp::error::AcpResult;
use crate::acp::model_display::build_models_for_display;
use crate::acp::provider::{AgentProvider, FrontendProviderProjection};
use crate::acp::runtime_resolver::resolve_effective_runtime;
use serde::Serialize;
use specta::Type;
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedCapabilityStatus {
    Resolved,
    Partial,
    Unsupported,
    Failed,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCapabilities {
    pub status: ResolvedCapabilityStatus,
    pub available_models: Vec<AvailableModel>,
    pub current_model_id: String,
    pub models_display: crate::acp::model_display::ModelsForDisplay,
    pub provider_metadata: FrontendProviderProjection,
    pub available_modes: Vec<AvailableMode>,
    pub current_mode_id: String,
}

pub async fn discover_models_from_provider_cli(
    provider: &dyn AgentProvider,
    cwd: &Path,
) -> Vec<AvailableModel> {
    let attempts = provider.model_discovery_commands();
    if attempts.is_empty() {
        return Vec::new();
    }

    for attempt in attempts {
        let runtime = resolve_effective_runtime(provider.id(), cwd, &attempt, None);
        let mut command = Command::new(&runtime.command);
        command.args(&runtime.args);
        command.kill_on_drop(true);
        command.stdin(Stdio::null());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.current_dir(&runtime.cwd);

        for (key, value) in &runtime.env {
            command.env(key, value);
        }

        let output = match timeout(Duration::from_secs(10), command.output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => {
                tracing::debug!(
                    provider = provider.id(),
                    command = %runtime.command,
                    args = ?runtime.args,
                    error = %error,
                    "Failed to execute provider model discovery command"
                );
                continue;
            }
            Err(_) => {
                tracing::debug!(
                    provider = provider.id(),
                    command = %runtime.command,
                    args = ?runtime.args,
                    "Provider model discovery command timed out"
                );
                continue;
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let mut models = crate::acp::client_session::parse_model_discovery_output(&stdout);
        if !models.is_empty() {
            models.sort_by(|left, right| left.model_id.cmp(&right.model_id));
            return models;
        }
    }

    Vec::new()
}

fn apply_default_model_candidates(
    provider: &dyn AgentProvider,
    model_state: &mut SessionModelState,
) {
    if !model_state.available_models.is_empty() {
        return;
    }

    let candidates = provider.default_model_candidates();
    if candidates.is_empty() {
        return;
    }

    model_state.available_models = candidates
        .into_iter()
        .map(|candidate| AvailableModel {
            model_id: candidate.model_id,
            name: candidate.name,
            description: candidate.description,
        })
        .collect();
}

fn normalize_current_model_id(model_state: &mut SessionModelState) {
    let has_current_model = model_state
        .available_models
        .iter()
        .any(|model| model.model_id == model_state.current_model_id);

    if has_current_model {
        return;
    }

    if let Some(first_model) = model_state.available_models.first() {
        model_state.current_model_id = first_model.model_id.clone();
        return;
    }

    model_state.current_model_id.clear();
}

fn finalize_capabilities(
    provider: &dyn AgentProvider,
    cwd: &Path,
    status: ResolvedCapabilityStatus,
    mut models: SessionModelState,
    raw_modes: SessionModes,
) -> AcpResult<ResolvedCapabilities> {
    let mut modes = raw_modes.normalize_with_provider(provider);

    apply_default_model_candidates(provider, &mut models);
    provider.apply_session_defaults(cwd, &mut models, &mut modes)?;
    apply_provider_model_fallback(provider, &mut models);
    normalize_current_model_id(&mut models);
    apply_provider_metadata(provider, &mut models);
    models.models_display =
        build_models_for_display(&models.available_models, provider.model_presentation_metadata());

    Ok(ResolvedCapabilities {
        status,
        available_models: models.available_models,
        current_model_id: models.current_model_id,
        models_display: models.models_display,
        provider_metadata: models
            .provider_metadata
            .unwrap_or_else(|| provider.frontend_projection()),
        available_modes: modes.available_modes,
        current_mode_id: modes.current_mode_id,
    })
}

pub fn resolve_static_capabilities(
    provider: &dyn AgentProvider,
    cwd: &Path,
    status: ResolvedCapabilityStatus,
    models: SessionModelState,
    raw_modes: SessionModes,
) -> AcpResult<ResolvedCapabilities> {
    finalize_capabilities(provider, cwd, status, models, raw_modes)
}

pub async fn resolve_live_capabilities(
    provider: &dyn AgentProvider,
    cwd: &Path,
    mut models: SessionModelState,
    raw_modes: SessionModes,
) -> AcpResult<ResolvedCapabilities> {
    if models.available_models.is_empty() {
        let discovered_models = discover_models_from_provider_cli(provider, cwd).await;
        if !discovered_models.is_empty() {
            models.available_models = discovered_models;
        }
    }

    let status = if models.available_models.is_empty() {
        ResolvedCapabilityStatus::Partial
    } else {
        ResolvedCapabilityStatus::Resolved
    };

    finalize_capabilities(provider, cwd, status, models, raw_modes)
}

pub async fn resolve_generic_preconnection_capabilities(
    provider: &dyn AgentProvider,
    cwd: &Path,
) -> ResolvedCapabilities {
    let mut models = default_session_model_state();
    let discovered_models = discover_models_from_provider_cli(provider, cwd).await;
    if !discovered_models.is_empty() {
        models.available_models = discovered_models;
    }

    let status = if models.available_models.is_empty() && provider.default_model_candidates().is_empty() {
        ResolvedCapabilityStatus::Partial
    } else {
        ResolvedCapabilityStatus::Resolved
    };

    match finalize_capabilities(provider, cwd, status, models, default_modes()) {
        Ok(capabilities) => capabilities,
        Err(error) => failed_capabilities(provider, error.to_string()),
    }
}

pub fn unsupported_capabilities(provider: &dyn AgentProvider) -> ResolvedCapabilities {
    ResolvedCapabilities {
        status: ResolvedCapabilityStatus::Unsupported,
        available_models: Vec::new(),
        current_model_id: String::new(),
        models_display: Default::default(),
        provider_metadata: provider.frontend_projection(),
        available_modes: Vec::new(),
        current_mode_id: String::new(),
    }
}

pub fn failed_capabilities(provider: &dyn AgentProvider, error: String) -> ResolvedCapabilities {
    tracing::warn!(provider = provider.id(), error = %error, "Failed to resolve capabilities");
    ResolvedCapabilities {
        status: ResolvedCapabilityStatus::Failed,
        available_models: Vec::new(),
        current_model_id: String::new(),
        models_display: Default::default(),
        provider_metadata: provider.frontend_projection(),
        available_modes: default_modes().available_modes,
        current_mode_id: "build".to_string(),
    }
}
