use crate::acp::client::{
    AvailableModel, NewSessionResponse, ResumeSessionResponse, SessionModelState,
};
use crate::acp::client_session::default_modes;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::parsers::{provider_capabilities::provider_capabilities, AgentType};
use crate::acp::session_update::{ConfigOptionData, ConfigOptionValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_CODEX_MODEL_ID: &str = "gpt-5.3-codex";
const DEFAULT_REASONING_EFFORT: &str = "high";
const FAST_MODE_CONFIG_ID: &str = "fast_mode";
const REASONING_CONFIG_ID: &str = "reasoning_effort";
const CODEX_GLOBAL_CONFIG_RELATIVE_PATH: &str = ".codex/config.toml";

pub const CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS: &str =
    "# Plan Mode\n\nProduce a decision-complete implementation plan before execution.";
pub const CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS: &str =
    "# Default Mode\n\nMake reasonable assumptions and execute the user's request.";

const CODEX_REASONING_OPTIONS: [(&str, &str); 5] = [
    ("xhigh", "Extra High"),
    ("high", "High"),
    ("medium", "Medium"),
    ("low", "Low"),
    ("minimal", "Minimal"),
];

const BUILT_IN_CODEX_MODELS: [(&str, &str); 6] = [
    ("gpt-5.4", "GPT-5.4"),
    ("gpt-5.4-mini", "GPT-5.4 Mini"),
    ("gpt-5.3-codex", "GPT-5.3 Codex"),
    ("gpt-5.3-codex-spark", "GPT-5.3 Codex Spark"),
    ("gpt-5.2-codex", "GPT-5.2 Codex"),
    ("gpt-5.2", "GPT-5.2"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexNativeConfigState {
    pub current_model_id: String,
    pub reasoning_effort: String,
    pub fast_mode: bool,
}

#[derive(Debug, Default, Deserialize)]
struct CodexExternalConfig {
    model: Option<String>,
    model_reasoning_effort: Option<String>,
    service_tier: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexInteractionMode {
    Default,
    Plan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexExecutionProfile {
    Standard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum CodexApprovalPolicy {
    #[serde(rename = "never")]
    Never,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type")]
pub enum CodexSandboxPolicy {
    #[serde(rename = "dangerFullAccess")]
    DangerFullAccess,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CodexCollaborationModeSettings {
    pub model: String,
    #[serde(rename = "reasoning_effort")]
    pub reasoning_effort: String,
    #[serde(rename = "developer_instructions")]
    pub developer_instructions: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCollaborationMode {
    pub mode: String,
    pub settings: CodexCollaborationModeSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum CodexTurnInputItem {
    Text {
        text: String,
        #[serde(rename = "text_elements")]
        text_elements: Vec<Value>,
    },
    Image {
        url: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTurnStartParams {
    pub thread_id: String,
    pub input: Vec<CodexTurnInputItem>,
    pub model: String,
    pub effort: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<CodexApprovalPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_policy: Option<CodexSandboxPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collaboration_mode: Option<CodexCollaborationMode>,
}

pub fn default_codex_native_config_state() -> CodexNativeConfigState {
    CodexNativeConfigState {
        current_model_id: DEFAULT_CODEX_MODEL_ID.to_string(),
        reasoning_effort: DEFAULT_REASONING_EFFORT.to_string(),
        fast_mode: false,
    }
}

pub fn load_codex_native_config_state(cwd: &Path) -> AcpResult<CodexNativeConfigState> {
    load_codex_native_config_state_from_paths(
        codex_global_config_path().as_deref(),
        &cwd.join(CODEX_GLOBAL_CONFIG_RELATIVE_PATH),
    )
}

fn load_codex_native_config_state_from_paths(
    global_config_path: Option<&Path>,
    project_config_path: &Path,
) -> AcpResult<CodexNativeConfigState> {
    let mut state = default_codex_native_config_state();

    if let Some(global_config_path) = global_config_path {
        merge_codex_native_config_state_from_path(&mut state, global_config_path)?;
    }

    merge_codex_native_config_state_from_path(&mut state, project_config_path)?;

    Ok(state)
}

pub fn build_codex_native_session_model_state() -> SessionModelState {
    build_codex_native_session_model_state_with_state(&default_codex_native_config_state())
}

pub fn build_codex_native_config_options(state: &CodexNativeConfigState) -> Vec<ConfigOptionData> {
    vec![
        ConfigOptionData {
            id: REASONING_CONFIG_ID.to_string(),
            name: "Reasoning Effort".to_string(),
            category: REASONING_CONFIG_ID.to_string(),
            option_type: "select".to_string(),
            description: Some("Controls Codex reasoning depth.".to_string()),
            current_value: Some(Value::String(state.reasoning_effort.clone())),
            options: CODEX_REASONING_OPTIONS
                .into_iter()
                .map(|(value, label)| ConfigOptionValue {
                    name: label.to_string(),
                    value: Value::String(value.to_string()),
                    description: None,
                })
                .collect(),
        },
        ConfigOptionData {
            id: FAST_MODE_CONFIG_ID.to_string(),
            name: "Fast Mode".to_string(),
            category: FAST_MODE_CONFIG_ID.to_string(),
            option_type: "boolean".to_string(),
            description: Some("Uses the fast Codex service tier when available.".to_string()),
            current_value: Some(Value::Bool(state.fast_mode)),
            options: Vec::new(),
        },
    ]
}

pub fn build_codex_native_new_session_response(session_id: String) -> NewSessionResponse {
    build_codex_native_new_session_response_with_state(
        session_id,
        &default_codex_native_config_state(),
    )
}

pub fn build_codex_native_new_session_response_with_state(
    session_id: String,
    state: &CodexNativeConfigState,
) -> NewSessionResponse {
    NewSessionResponse {
        session_id,
        sequence_id: None,
        session_open: None,
        models: build_codex_native_session_model_state_with_state(state),
        modes: default_modes(),
        available_commands: vec![],
        config_options: build_codex_native_config_options(state),
    }
}

pub fn build_codex_native_resume_session_response(
    state: &CodexNativeConfigState,
) -> ResumeSessionResponse {
    ResumeSessionResponse {
        models: build_codex_native_session_model_state_with_state(state),
        modes: default_modes(),
        available_commands: vec![],
        config_options: build_codex_native_config_options(state),
    }
}

pub fn set_codex_native_model(state: &mut CodexNativeConfigState, model_id: &str) -> AcpResult<()> {
    state.current_model_id = normalize_model_id(model_id);
    Ok(())
}

pub fn set_codex_native_config_option(
    state: &mut CodexNativeConfigState,
    config_id: &str,
    value: &str,
) -> AcpResult<Vec<ConfigOptionData>> {
    match config_id {
        REASONING_CONFIG_ID => {
            state.reasoning_effort = normalize_reasoning_effort(value)?;
        }
        FAST_MODE_CONFIG_ID => {
            state.fast_mode = parse_boolean_config_value(value)?;
        }
        _ => {
            return Err(AcpError::ProtocolError(format!(
                "Unsupported Codex config option: {config_id}"
            )));
        }
    }

    Ok(build_codex_native_config_options(state))
}

pub fn build_codex_turn_start_params(
    thread_id: &str,
    input_text: &str,
    state: &CodexNativeConfigState,
    interaction_mode: Option<CodexInteractionMode>,
    execution_profile: CodexExecutionProfile,
) -> CodexTurnStartParams {
    build_codex_turn_start_params_from_input(
        thread_id,
        vec![CodexTurnInputItem::Text {
            text: input_text.to_string(),
            text_elements: vec![],
        }],
        state,
        interaction_mode,
        execution_profile,
    )
}

pub fn build_codex_turn_start_params_from_input(
    thread_id: &str,
    input: Vec<CodexTurnInputItem>,
    state: &CodexNativeConfigState,
    interaction_mode: Option<CodexInteractionMode>,
    _execution_profile: CodexExecutionProfile,
) -> CodexTurnStartParams {
    let collaboration_mode = interaction_mode.map(|mode| build_collaboration_mode(state, mode));

    CodexTurnStartParams {
        thread_id: thread_id.to_string(),
        input,
        model: state.current_model_id.clone(),
        effort: state.reasoning_effort.clone(),
        approval_policy: None,
        sandbox_policy: None,
        service_tier: if state.fast_mode {
            Some("fast".to_string())
        } else {
            None
        },
        collaboration_mode,
    }
}

pub fn resolve_codex_execution_profile_mode_id(
    mode_id: &str,
) -> AcpResult<(String, CodexExecutionProfile)> {
    match mode_id {
        "build" => Ok(("build".to_string(), CodexExecutionProfile::Standard)),
        "plan" => Ok(("plan".to_string(), CodexExecutionProfile::Standard)),
        _ => Err(AcpError::ProtocolError(format!(
            "Unsupported Codex mode: {mode_id}"
        ))),
    }
}

fn build_collaboration_mode(
    state: &CodexNativeConfigState,
    mode: CodexInteractionMode,
) -> CodexCollaborationMode {
    match mode {
        CodexInteractionMode::Default => CodexCollaborationMode {
            mode: "default".to_string(),
            settings: CodexCollaborationModeSettings {
                model: state.current_model_id.clone(),
                reasoning_effort: state.reasoning_effort.clone(),
                developer_instructions: CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS.to_string(),
            },
        },
        CodexInteractionMode::Plan => CodexCollaborationMode {
            mode: "plan".to_string(),
            settings: CodexCollaborationModeSettings {
                model: state.current_model_id.clone(),
                reasoning_effort: state.reasoning_effort.clone(),
                developer_instructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS.to_string(),
            },
        },
    }
}

fn build_codex_native_session_model_state_with_state(
    state: &CodexNativeConfigState,
) -> SessionModelState {
    let current_model_id = normalize_model_id(&state.current_model_id);
    let mut available_models = BUILT_IN_CODEX_MODELS
        .into_iter()
        .map(|(model_id, name)| AvailableModel {
            model_id: model_id.to_string(),
            name: name.to_string(),
            description: None,
        })
        .collect::<Vec<_>>();

    if !available_models
        .iter()
        .any(|model| model.model_id == current_model_id)
    {
        available_models.insert(
            0,
            AvailableModel {
                model_id: current_model_id.clone(),
                name: current_model_id.clone(),
                description: Some("Configured in Codex config.toml".to_string()),
            },
        );
    }

    SessionModelState {
        available_models,
        current_model_id,
        models_display: Default::default(),
        provider_metadata: Some(provider_capabilities(AgentType::Codex).frontend_projection),
    }
}

fn merge_codex_native_config_state_from_path(
    state: &mut CodexNativeConfigState,
    path: &Path,
) -> AcpResult<()> {
    if !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(path).map_err(|error| {
        AcpError::InvalidState(format!(
            "Failed to read Codex config at {}: {error}",
            path.display()
        ))
    })?;
    let config = toml::from_str::<CodexExternalConfig>(&raw).map_err(|error| {
        AcpError::ProtocolError(format!(
            "Invalid Codex config at {}: {error}",
            path.display()
        ))
    })?;

    merge_codex_native_config_state(state, config, path)
}

fn merge_codex_native_config_state(
    state: &mut CodexNativeConfigState,
    config: CodexExternalConfig,
    path: &Path,
) -> AcpResult<()> {
    if let Some(model) = config.model {
        state.current_model_id = normalize_model_id(&model);
    }

    if let Some(reasoning_effort) = config.model_reasoning_effort {
        state.reasoning_effort = normalize_reasoning_effort(&reasoning_effort).map_err(|_| {
            AcpError::ProtocolError(format!(
                "Unsupported Codex model_reasoning_effort in {}: {}",
                path.display(),
                reasoning_effort
            ))
        })?;
    }

    if let Some(service_tier) = config.service_tier {
        state.fast_mode = parse_codex_service_tier(&service_tier).map_err(|_| {
            AcpError::ProtocolError(format!(
                "Unsupported Codex service_tier in {}: {}",
                path.display(),
                service_tier
            ))
        })?;
    }

    Ok(())
}

fn normalize_model_id(model_id: &str) -> String {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return DEFAULT_CODEX_MODEL_ID.to_string();
    }

    trimmed.to_string()
}

fn normalize_reasoning_effort(value: &str) -> AcpResult<String> {
    let normalized_value = value.trim().to_lowercase();
    if CODEX_REASONING_OPTIONS
        .iter()
        .any(|(candidate_value, _)| *candidate_value == normalized_value)
    {
        return Ok(normalized_value);
    }

    Err(AcpError::ProtocolError(format!(
        "Unsupported Codex reasoning effort: {value}"
    )))
}

fn parse_codex_service_tier(value: &str) -> AcpResult<bool> {
    match value.trim().to_lowercase().as_str() {
        "fast" => Ok(true),
        "flex" => Ok(false),
        _ => Err(AcpError::ProtocolError(format!(
            "Unsupported Codex service tier: {value}"
        ))),
    }
}

fn parse_boolean_config_value(value: &str) -> AcpResult<bool> {
    let normalized_value = value.trim().to_lowercase();
    match normalized_value.as_str() {
        "true" | "on" | "enabled" | "1" => Ok(true),
        "false" | "off" | "disabled" | "0" => Ok(false),
        _ => Err(AcpError::ProtocolError(format!(
            "Unsupported Codex fast mode value: {value}"
        ))),
    }
}

fn codex_global_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(CODEX_GLOBAL_CONFIG_RELATIVE_PATH))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn new_session_response_uses_base_models_and_separate_config_options() {
        let response = build_codex_native_new_session_response("session-1".to_string());

        assert_eq!(response.session_id, "session-1");
        assert_eq!(response.models.current_model_id, DEFAULT_CODEX_MODEL_ID);
        assert!(response
            .models
            .available_models
            .iter()
            .any(|model| model.model_id == "gpt-5.3-codex"));
        assert!(!response
            .models
            .available_models
            .iter()
            .any(|model| model.model_id.ends_with("/high")));

        assert_eq!(response.config_options.len(), 2);
        assert_eq!(response.config_options[0].id, REASONING_CONFIG_ID);
        assert_eq!(response.config_options[1].id, FAST_MODE_CONFIG_ID);
        assert_eq!(
            response.config_options[0].current_value,
            Some(json!("high"))
        );
        assert_eq!(response.config_options[1].current_value, Some(json!(false)));
    }

    #[test]
    fn set_reasoning_effort_updates_config_without_mutating_model() {
        let mut state = default_codex_native_config_state();
        let config_options =
            set_codex_native_config_option(&mut state, REASONING_CONFIG_ID, "medium")
                .expect("reasoning config should update");

        assert_eq!(state.current_model_id, DEFAULT_CODEX_MODEL_ID);
        assert_eq!(state.reasoning_effort, "medium");
        assert!(!state.fast_mode);
        assert_eq!(config_options[0].current_value, Some(json!("medium")));
    }

    #[test]
    fn set_fast_mode_updates_boolean_toggle_without_mutating_reasoning() {
        let mut state = default_codex_native_config_state();
        state.reasoning_effort = "medium".to_string();

        let config_options =
            set_codex_native_config_option(&mut state, FAST_MODE_CONFIG_ID, "true")
                .expect("fast mode should update");

        assert_eq!(state.current_model_id, DEFAULT_CODEX_MODEL_ID);
        assert_eq!(state.reasoning_effort, "medium");
        assert!(state.fast_mode);
        assert_eq!(config_options[1].current_value, Some(json!(true)));
    }

    #[test]
    fn custom_models_are_accepted() {
        let mut state = default_codex_native_config_state();

        set_codex_native_model(&mut state, "gpt-oss-custom")
            .expect("custom models from Codex config should be accepted");

        assert_eq!(state.current_model_id, "gpt-oss-custom");
    }

    #[test]
    fn minimal_reasoning_effort_is_supported() {
        let mut state = default_codex_native_config_state();

        let config_options =
            set_codex_native_config_option(&mut state, REASONING_CONFIG_ID, "minimal")
                .expect("minimal reasoning should update");

        assert_eq!(state.reasoning_effort, "minimal");
        assert_eq!(config_options[0].current_value, Some(json!("minimal")));
        assert!(config_options[0]
            .options
            .iter()
            .any(|option| option.value == json!("minimal")));
    }

    #[test]
    fn turn_start_params_keep_service_tier_separate_from_reasoning_effort() {
        let mut state = default_codex_native_config_state();
        state.reasoning_effort = "xhigh".to_string();
        state.fast_mode = true;

        let params = build_codex_turn_start_params(
            "thread-1",
            "Implement the requested changes",
            &state,
            None,
            CodexExecutionProfile::Standard,
        );

        assert_eq!(params.thread_id, "thread-1");
        assert_eq!(params.model, DEFAULT_CODEX_MODEL_ID);
        assert_eq!(params.effort, "xhigh");
        assert_eq!(params.service_tier.as_deref(), Some("fast"));
        assert!(params.collaboration_mode.is_none());
    }

    #[test]
    fn plan_mode_turn_start_adds_collaboration_mode_settings() {
        let mut state = default_codex_native_config_state();
        state.reasoning_effort = "medium".to_string();

        let params = build_codex_turn_start_params(
            "thread-2",
            "Plan the migration",
            &state,
            Some(CodexInteractionMode::Plan),
            CodexExecutionProfile::Standard,
        );

        let collaboration_mode = params
            .collaboration_mode
            .expect("plan mode should include collaboration settings");
        assert_eq!(collaboration_mode.mode, "plan");
        assert_eq!(collaboration_mode.settings.model, DEFAULT_CODEX_MODEL_ID);
        assert_eq!(collaboration_mode.settings.reasoning_effort, "medium");
        assert_eq!(
            collaboration_mode.settings.developer_instructions,
            CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS
        );
    }

    #[test]
    fn resume_session_response_includes_configured_custom_model() {
        let state = CodexNativeConfigState {
            current_model_id: "gpt-oss-custom".to_string(),
            reasoning_effort: "medium".to_string(),
            fast_mode: false,
        };

        let response = build_codex_native_resume_session_response(&state);

        assert_eq!(response.models.current_model_id, "gpt-oss-custom");
        assert!(response
            .models
            .available_models
            .iter()
            .any(|model| model.model_id == "gpt-oss-custom"));
    }

    #[test]
    fn codex_config_state_prefers_project_config_over_global_config() {
        let temp = tempfile::tempdir().expect("tempdir");
        let global_config = temp.path().join("global.toml");
        let project_config = temp.path().join("project.toml");

        fs::write(
            &global_config,
            r#"
model = "gpt-5.4"
model_reasoning_effort = "low"
service_tier = "fast"
"#,
        )
        .expect("write global config");

        fs::write(
            &project_config,
            r#"
model = "gpt-oss-custom"
model_reasoning_effort = "minimal"
service_tier = "flex"
"#,
        )
        .expect("write project config");

        let state = load_codex_native_config_state_from_paths(
            Some(global_config.as_path()),
            project_config.as_path(),
        )
        .expect("config state should load");

        assert_eq!(state.current_model_id, "gpt-oss-custom");
        assert_eq!(state.reasoning_effort, "minimal");
        assert!(!state.fast_mode);
    }

    #[test]
    fn turn_start_params_serialize_to_codex_protocol_shape() {
        let params = build_codex_turn_start_params_from_input(
            "thread-3",
            vec![
                CodexTurnInputItem::Text {
                    text: "Review the patch".to_string(),
                    text_elements: vec![],
                },
                CodexTurnInputItem::Image {
                    url: "data:image/png;base64,AAAA".to_string(),
                },
            ],
            &default_codex_native_config_state(),
            Some(CodexInteractionMode::Plan),
            CodexExecutionProfile::Standard,
        );

        let serialized = serde_json::to_value(params).expect("params should serialize");
        assert_eq!(serialized["threadId"], json!("thread-3"));
        assert_eq!(serialized["input"][0]["type"], json!("text"));
        assert!(serialized["input"][0].get("text_elements").is_some());
        assert_eq!(serialized["input"][1]["type"], json!("image"));
        assert_eq!(
            serialized["collaborationMode"]["settings"]["reasoning_effort"],
            json!(DEFAULT_REASONING_EFFORT)
        );
        assert_eq!(
            serialized["collaborationMode"]["settings"]["developer_instructions"],
            json!(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS)
        );
    }

    #[test]
    fn invalid_config_updates_are_rejected() {
        let mut state = default_codex_native_config_state();

        let invalid_effort =
            set_codex_native_config_option(&mut state, REASONING_CONFIG_ID, "ultra");
        assert!(invalid_effort.is_err());

        let invalid_fast_mode =
            set_codex_native_config_option(&mut state, FAST_MODE_CONFIG_ID, "maybe");
        assert!(invalid_fast_mode.is_err());

        let invalid_config_id = set_codex_native_config_option(&mut state, "service_tier", "fast");
        assert!(invalid_config_id.is_err());
    }
}
