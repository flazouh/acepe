use crate::acp::client::{AvailableMode, AvailableModel, SessionModelState, SessionModes};
use crate::acp::error::{AcpError, AcpResult};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const OPENCODE_GLOBAL_CONFIG_RELATIVE_PATH: &str = ".config/opencode/opencode.json";
const OPENCODE_PROJECT_CONFIG_NAME: &str = "opencode.json";

#[derive(Debug, Default, Deserialize)]
struct OpenCodeSettingsFile {
    model: Option<String>,
    #[serde(default, alias = "defaultAgent")]
    default_agent: Option<String>,
}

#[derive(Debug, Default)]
struct OpenCodeSettings {
    model: Option<String>,
    default_agent: Option<String>,
}

pub fn apply_opencode_session_defaults(
    cwd: &Path,
    models: &mut SessionModelState,
    modes: &mut SessionModes,
) -> AcpResult<()> {
    apply_opencode_session_defaults_from_paths(dirs::home_dir().as_deref(), cwd, models, modes)
}

pub fn apply_opencode_session_defaults_from_paths(
    home_dir: Option<&Path>,
    project_root: &Path,
    models: &mut SessionModelState,
    modes: &mut SessionModes,
) -> AcpResult<()> {
    let settings = load_opencode_settings_from_paths(home_dir, project_root)?;

    if let Some(default_agent) = settings.default_agent {
        if !modes
            .available_modes
            .iter()
            .any(|mode| mode.id == default_agent)
        {
            modes.available_modes.insert(
                0,
                AvailableMode::new(
                    default_agent.clone(),
                    default_agent.clone(),
                    Some("Configured in opencode.json".to_string()),
                ),
            );
        }
        modes.current_mode_id = default_agent;
    }

    let should_apply_model = models
        .current_model_id
        .as_deref()
        .map(|model_id| model_id.trim().is_empty() || model_id == "auto")
        .unwrap_or(true);
    if !should_apply_model {
        return Ok(());
    }

    let Some(configured_model_id) = settings.model else {
        return Ok(());
    };

    models.current_model_id = Some(configured_model_id.clone());
    if !models
        .available_models
        .iter()
        .any(|model| model.model_id == configured_model_id)
    {
        models.available_models.insert(
            0,
            AvailableModel {
                model_id: configured_model_id.clone(),
                name: configured_model_id,
                description: Some("Configured in opencode.json".to_string()),
            },
        );
    }

    Ok(())
}

fn load_opencode_settings_from_paths(
    home_dir: Option<&Path>,
    project_root: &Path,
) -> AcpResult<OpenCodeSettings> {
    let mut settings = OpenCodeSettings::default();

    if let Some(home_dir) = home_dir {
        merge_opencode_settings_from_path(
            &mut settings,
            &home_dir.join(OPENCODE_GLOBAL_CONFIG_RELATIVE_PATH),
        )?;
    }

    merge_opencode_settings_from_path(
        &mut settings,
        &project_root.join(OPENCODE_PROJECT_CONFIG_NAME),
    )?;

    Ok(settings)
}

fn merge_opencode_settings_from_path(
    settings: &mut OpenCodeSettings,
    path: &PathBuf,
) -> AcpResult<()> {
    if !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(path).map_err(|error| {
        AcpError::InvalidState(format!(
            "Failed to read OpenCode config at {}: {error}",
            path.display()
        ))
    })?;
    let file = serde_json::from_str::<OpenCodeSettingsFile>(&raw).map_err(|error| {
        AcpError::ProtocolError(format!(
            "Invalid OpenCode config at {}: {error}",
            path.display()
        ))
    })?;

    if let Some(model) = file.model.and_then(normalize_model_id) {
        settings.model = Some(model);
    }
    if let Some(default_agent) = file.default_agent.and_then(normalize_agent_id) {
        settings.default_agent = Some(default_agent);
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

fn normalize_agent_id(agent_id: String) -> Option<String> {
    let trimmed = agent_id.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_string())
}
