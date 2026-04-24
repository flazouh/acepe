use crate::acp::client::{SessionModelState, SessionModes};
use crate::acp::error::{AcpError, AcpResult};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const COPILOT_CONFIG_RELATIVE_PATH: &str = ".copilot/config.json";

#[derive(Debug, Default, Deserialize)]
struct CopilotSettingsFile {
    model: Option<String>,
}

#[derive(Debug, Default)]
struct CopilotSettings {
    model: Option<String>,
}

pub fn apply_copilot_session_defaults(
    cwd: &Path,
    models: &mut SessionModelState,
    modes: &mut SessionModes,
) -> AcpResult<()> {
    apply_copilot_session_defaults_from_paths(dirs::home_dir().as_deref(), cwd, models, modes)
}

pub fn apply_copilot_session_defaults_from_paths(
    home_dir: Option<&Path>,
    project_root: &Path,
    models: &mut SessionModelState,
    _modes: &mut SessionModes,
) -> AcpResult<()> {
    let settings = load_copilot_settings_from_paths(home_dir, project_root)?;
    let Some(configured_model_id) = settings.model else {
        return Ok(());
    };

    let should_apply_model =
        models.current_model_id.trim().is_empty() || models.current_model_id == "auto";
    if !should_apply_model {
        return Ok(());
    }

    if models
        .available_models
        .iter()
        .any(|model| model.model_id == configured_model_id)
    {
        models.current_model_id = configured_model_id;
        return Ok(());
    }

    tracing::info!(
        configured_model_id = %configured_model_id,
        available_model_ids = ?models
            .available_models
            .iter()
            .map(|model| model.model_id.as_str())
            .collect::<Vec<_>>(),
        "Configured Copilot model is unavailable in the authoritative catalog; keeping default selection"
    );

    Ok(())
}

fn load_copilot_settings_from_paths(
    home_dir: Option<&Path>,
    project_root: &Path,
) -> AcpResult<CopilotSettings> {
    let mut settings = CopilotSettings::default();

    if let Some(home_dir) = home_dir {
        merge_copilot_settings_from_path(
            &mut settings,
            &home_dir.join(COPILOT_CONFIG_RELATIVE_PATH),
        )?;
    }

    merge_copilot_settings_from_path(
        &mut settings,
        &project_root.join(COPILOT_CONFIG_RELATIVE_PATH),
    )?;

    Ok(settings)
}

fn merge_copilot_settings_from_path(
    settings: &mut CopilotSettings,
    path: &PathBuf,
) -> AcpResult<()> {
    if !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(path).map_err(|error| {
        AcpError::InvalidState(format!(
            "Failed to read Copilot config at {}: {error}",
            path.display()
        ))
    })?;
    let file = serde_json::from_str::<CopilotSettingsFile>(&raw).map_err(|error| {
        AcpError::ProtocolError(format!(
            "Invalid Copilot config at {}: {error}",
            path.display()
        ))
    })?;

    if let Some(model) = file.model.and_then(normalize_model_id) {
        settings.model = Some(model);
    }

    Ok(())
}

fn normalize_model_id(model_id: String) -> Option<String> {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_string())
}
