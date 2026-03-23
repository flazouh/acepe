use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// OpenCode HTTP session representation
#[derive(Debug, Deserialize)]
pub struct Session {
    pub id: String,
    #[serde(rename = "projectID")]
    pub project_id: String,
    pub directory: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub title: Option<String>,
}

/// OpenCode provider response structure
#[derive(Debug, Deserialize, Serialize)]
pub struct ProviderResponse {
    pub connected: Vec<String>,
    pub all: Vec<Provider>,
    #[serde(default)]
    pub default: HashMap<String, String>,
}

/// OpenCode provider with models
#[derive(Debug, Deserialize, Serialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub models: HashMap<String, ProviderModel>,
}

/// OpenCode model within a provider
#[derive(Debug, Deserialize, Serialize)]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
}

/// OpenCode config response - contains user's configured model preference
#[derive(Debug, Deserialize)]
pub struct ConfigResponse {
    #[serde(default)]
    pub model: Option<String>,
}

/// OpenCode command representation from /command endpoint.
#[derive(Debug, Deserialize)]
pub(super) struct OpenCodeCommand {
    pub(super) name: String,
    #[serde(default)]
    pub(super) description: Option<String>,
}

/// Stored model selection for OpenCode.
/// OpenCode uses provider/model ID pairs for model selection.
#[derive(Debug, Clone)]
pub(super) struct OpenCodeModel {
    pub(super) provider_id: String,
    pub(super) model_id: String,
}
