use crate::acp::model_display::ModelsForDisplay;
use crate::acp::provider::{AgentProvider, FrontendProviderProjection};
use crate::acp::session_update::AvailableCommand;
use crate::acp::session_update::ConfigOptionData;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    pub protocol_version: u32,
    #[serde(default = "default_json_object")]
    pub agent_capabilities: Value,
    #[serde(default = "default_json_object")]
    pub agent_info: Value,
    #[serde(default)]
    pub auth_methods: Vec<Value>,
}

fn default_json_object() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionResponse {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence_id: Option<i32>,
    #[serde(default = "default_session_model_state")]
    pub models: SessionModelState,
    #[serde(
        default = "default_modes",
        deserialize_with = "deserialize_modes_or_default"
    )]
    pub modes: SessionModes,
    #[serde(default)]
    pub available_commands: Vec<AvailableCommand>,
    #[serde(default)]
    pub config_options: Vec<ConfigOptionData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSessionResponse {
    #[serde(default = "default_session_model_state")]
    pub models: SessionModelState,
    #[serde(
        default = "default_modes",
        deserialize_with = "deserialize_modes_or_default"
    )]
    pub modes: SessionModes,
    #[serde(default)]
    pub available_commands: Vec<AvailableCommand>,
    #[serde(default)]
    pub config_options: Vec<ConfigOptionData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionModelState {
    #[serde(default)]
    pub available_models: Vec<AvailableModel>,
    #[serde(default = "default_current_model_id")]
    pub current_model_id: String,
    #[serde(default)]
    pub models_display: ModelsForDisplay,
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub provider_metadata: Option<FrontendProviderProjection>,
}

fn default_current_model_id() -> String {
    "auto".to_string()
}

pub(crate) fn default_session_model_state() -> SessionModelState {
    SessionModelState {
        available_models: Vec::new(),
        current_model_id: default_current_model_id(),
        models_display: ModelsForDisplay::default(),
        provider_metadata: None,
    }
}

pub(crate) fn apply_provider_metadata(
    provider: &dyn AgentProvider,
    model_state: &mut SessionModelState,
) {
    model_state.provider_metadata = Some(provider.frontend_projection());
}

pub(crate) fn apply_provider_model_fallback(
    provider: &dyn AgentProvider,
    model_state: &mut SessionModelState,
) {
    if !model_state.available_models.is_empty() {
        return;
    }

    if let Some(candidate) = provider.model_fallback_for_empty_list(&model_state.current_model_id) {
        model_state.available_models.push(AvailableModel {
            model_id: candidate.model_id,
            name: candidate.name,
            description: candidate.description,
        });
    }
}

fn normalize_model_token(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_ansi = if let Some((prefix, suffix)) = trimmed.split_once('[') {
        if !prefix.is_empty()
            && suffix.ends_with(']')
            && suffix[..suffix.len() - 1]
                .chars()
                .all(|c| c.is_ascii_alphanumeric())
        {
            prefix
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    let cleaned = without_ansi
        .trim()
        .trim_matches(|c: char| c == '`' || c == '"' || c == '\'' || c == ',' || c == ';');

    if cleaned.is_empty() {
        return None;
    }

    let looks_like_model = cleaned.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || c == '-'
            || c == '_'
            || c == '.'
            || c == '/'
            || c == '+'
            || c == ':'
    });

    if !looks_like_model || !cleaned.chars().any(|c| c.is_ascii_alphanumeric()) {
        return None;
    }

    Some(cleaned.to_string())
}

fn parse_models_from_json_value(value: &Value) -> Vec<AvailableModel> {
    fn from_array(items: &[Value]) -> Vec<AvailableModel> {
        let mut seen = HashSet::new();
        let mut models = Vec::new();

        for item in items {
            let model = if let Some(model_id) = item.as_str() {
                normalize_model_token(model_id).map(|normalized| AvailableModel {
                    model_id: normalized.clone(),
                    name: normalized,
                    description: None,
                })
            } else if let Some(obj) = item.as_object() {
                let model_id = obj
                    .get("modelId")
                    .and_then(Value::as_str)
                    .or_else(|| obj.get("id").and_then(Value::as_str))
                    .or_else(|| obj.get("name").and_then(Value::as_str))
                    .and_then(normalize_model_token);

                model_id.map(|id| AvailableModel {
                    model_id: id.clone(),
                    name: obj
                        .get("name")
                        .and_then(Value::as_str)
                        .and_then(normalize_model_token)
                        .unwrap_or_else(|| id.clone()),
                    description: obj
                        .get("description")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|desc| !desc.is_empty())
                        .map(ToOwned::to_owned),
                })
            } else {
                None
            };

            if let Some(model) = model {
                if seen.insert(model.model_id.clone()) {
                    models.push(model);
                }
            }
        }

        models
    }

    match value {
        Value::Array(items) => from_array(items),
        Value::Object(obj) => {
            if let Some(models) = obj
                .get("models")
                .and_then(Value::as_array)
                .map(|items| from_array(items))
            {
                return models;
            }

            if let Some(models) = obj
                .get("availableModels")
                .and_then(Value::as_array)
                .map(|items| from_array(items))
            {
                return models;
            }

            if let Some(models) = obj
                .get("data")
                .and_then(Value::as_object)
                .and_then(|data| data.get("models"))
                .and_then(Value::as_array)
                .map(|items| from_array(items))
            {
                return models;
            }

            Vec::new()
        }
        _ => Vec::new(),
    }
}

fn parse_models_from_plaintext(stdout: &str) -> Vec<AvailableModel> {
    let normalized_stdout = stdout.trim();
    let lower_stdout = normalized_stdout.to_ascii_lowercase();
    if lower_stdout.contains("not logged in")
        || lower_stdout.contains("please run /login")
        || lower_stdout.contains("please login")
        || lower_stdout.contains("authentication")
        || lower_stdout.contains("unauthorized")
        || lower_stdout.contains("forbidden")
    {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    let mut models = Vec::new();

    for line in normalized_stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("available models")
            || lower.starts_with("models")
            || lower.starts_with("model")
        {
            continue;
        }

        let without_bullets = trimmed
            .trim_start_matches(|c: char| {
                c.is_ascii_whitespace()
                    || c == '-'
                    || c == '*'
                    || c == '•'
                    || c == '['
                    || c == ']'
                    || c == '('
                    || c == ')'
            })
            .trim();

        if without_bullets.is_empty() {
            continue;
        }

        let token = without_bullets
            .split_whitespace()
            .next()
            .map(|t| t.trim_matches(|c: char| c == ',' || c == ';' || c == ':'))
            .unwrap_or("");

        let Some(model_id) = normalize_model_token(token) else {
            continue;
        };

        if seen.insert(model_id.clone()) {
            models.push(AvailableModel {
                model_id: model_id.clone(),
                name: model_id,
                description: None,
            });
        }
    }

    models
}

pub(crate) fn parse_model_discovery_output(stdout: &str) -> Vec<AvailableModel> {
    if let Ok(value) = serde_json::from_str::<Value>(stdout) {
        let from_json = parse_models_from_json_value(&value);
        if !from_json.is_empty() {
            return from_json;
        }
    }
    parse_models_from_plaintext(stdout)
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub model_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AvailableMode {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionModes {
    #[serde(default = "default_mode_id")]
    pub current_mode_id: String,
    #[serde(default)]
    pub available_modes: Vec<AvailableMode>,
}

fn default_mode_id() -> String {
    "build".to_string()
}

pub(crate) fn default_modes() -> SessionModes {
    SessionModes {
        current_mode_id: "build".to_string(),
        available_modes: vec![
            build_mode(),
            AvailableMode {
                id: "plan".to_string(),
                name: "Plan".to_string(),
                description: Some(
                    "Read-only mode - agent can only read files and provide suggestions"
                        .to_string(),
                ),
            },
        ],
    }
}

fn deserialize_modes_or_default<'de, D>(deserializer: D) -> Result<SessionModes, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<SessionModes>::deserialize(deserializer)?;
    Ok(opt.unwrap_or_else(default_modes))
}

fn build_mode() -> AvailableMode {
    AvailableMode {
        id: "build".to_string(),
        name: "Build".to_string(),
        description: Some("Normal mode - agent can read and write files".to_string()),
    }
}

impl SessionModes {
    pub fn normalize_with_provider(self, provider: &dyn AgentProvider) -> Self {
        if self.available_modes.is_empty() {
            return default_modes();
        }

        let visible_mode_ids = provider.visible_mode_ids();
        let mut seen_ids = HashSet::new();
        let mut normalized_modes: Vec<AvailableMode> = self
            .available_modes
            .into_iter()
            .map(|m| AvailableMode {
                id: provider.normalize_mode_id(&m.id),
                name: m.name,
                description: m.description,
            })
            .filter(|m| visible_mode_ids.contains(&m.id.as_str()))
            .filter(|m| seen_ids.insert(m.id.clone()))
            .collect();

        if normalized_modes.is_empty() {
            return default_modes();
        }

        if visible_mode_ids.contains(&"build") && !normalized_modes.iter().any(|m| m.id == "build")
        {
            normalized_modes.insert(0, build_mode());
        }

        let normalized_current = provider.normalize_mode_id(&self.current_mode_id);

        let current_mode_id = if normalized_modes.iter().any(|m| m.id == normalized_current) {
            normalized_current
        } else {
            normalized_modes
                .first()
                .map(|m| m.id.clone())
                .unwrap_or_else(|| "build".to_string())
        };

        SessionModes {
            current_mode_id,
            available_modes: normalized_modes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsResponse {
    pub sessions: Vec<SessionInfo>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub cwd: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}
