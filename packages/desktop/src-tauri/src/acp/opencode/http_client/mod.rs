use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::manager::OpenCodeManager;
use crate::acp::client::{
    AvailableMode, AvailableModel, InitializeResponse, NewSessionResponse, ResumeSessionResponse,
    SessionModelState, SessionModes,
};
use crate::acp::client_trait::AgentClient;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::model_display::get_transformer;
use crate::acp::parsers::AgentType;
use crate::acp::session_update::AvailableCommand;
use crate::acp::types::PromptRequest;
use crate::opencode_history::parser as opencode_history_parser;
use crate::opencode_history::types::{
    OpenCodeApiMessageResponse, OpenCodeMessage, OpenCodeMessagePart, OpenCodeSession,
};

mod agent_client_impl;
mod binding;
mod catalog;
mod session_api;
mod types;

use types::{ConfigResponse, OpenCodeCommand, OpenCodeModel, ProviderResponse, Session};

/// OpenCode HTTP client - stateless HTTP operations.
/// SSE subscription is managed by OpenCodeManager, not per-client.
pub struct OpenCodeHttpClient {
    /// Shared OpenCode manager (manages subprocess and SSE)
    manager: Arc<Mutex<OpenCodeManager>>,
    /// Canonical project key resolved by the manager registry.
    manager_project_key: String,
    /// HTTP client for API calls
    http_client: reqwest::Client,
    /// Current working directory
    current_directory: Option<String>,
    /// Current model selection (provider + model)
    current_model: Option<OpenCodeModel>,
    /// Current mode selection (build/plan)
    current_mode: Option<String>,
}

impl OpenCodeHttpClient {
    /// Create a new OpenCodeHttpClient
    pub fn new(
        manager: Arc<Mutex<OpenCodeManager>>,
        manager_project_key: String,
    ) -> AcpResult<Self> {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| AcpError::InvalidState(format!("Failed to create HTTP client: {}", e)))?;

        Ok(Self {
            manager,
            manager_project_key,
            http_client,
            current_directory: None,
            current_model: None,
            current_mode: None,
        })
    }

    /// Get the base URL for the OpenCode server
    async fn base_url(&self) -> AcpResult<String> {
        let manager = self.manager.lock().await;
        manager
            .base_url()
            .await
            .ok_or(AcpError::OpenCodeServerNotRunning)
    }

    fn seed_current_model(&mut self, model_id: &str) -> AcpResult<()> {
        if model_id.trim().is_empty() {
            self.current_model = None;
            return Ok(());
        }

        let parts: Vec<&str> = model_id.splitn(2, '/').collect();
        if parts.len() != 2 {
            return Err(AcpError::InvalidState(format!(
                "Invalid model ID format '{}'. Expected 'provider/model' format.",
                model_id
            )));
        }

        self.current_model = Some(OpenCodeModel {
            provider_id: parts[0].to_string(),
            model_id: parts[1].to_string(),
        });
        tracing::info!(
            provider_id = %parts[0],
            model_id = %parts[1],
            "OpenCode model set"
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests;
