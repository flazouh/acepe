use super::*;
use crate::acp::client_trait::ReconnectSessionMethod;
use crate::acp::model_display::{build_models_for_display, ModelPresentationMetadata};
use crate::acp::parsers::provider_capabilities::provider_capabilities;
use std::path::Path;

#[async_trait]
impl AgentClient for OpenCodeHttpClient {
    async fn start(&mut self) -> AcpResult<()> {
        tracing::info!(
            project_key = %self.manager_project_key,
            "Starting OpenCodeHttpClient"
        );

        // Ensure the OpenCode server is running (SSE subscription is handled by manager)
        let mut manager = self.manager.lock().await;
        manager.ensure_running().await.map_err(|e| {
            AcpError::InvalidState(format!("Failed to ensure OpenCode server running: {}", e))
        })?;

        tracing::info!("OpenCodeHttpClient started");
        Ok(())
    }

    async fn initialize(&mut self) -> AcpResult<InitializeResponse> {
        // OpenCode HTTP mode doesn't have an initialize endpoint
        // Return a synthetic response
        Ok(InitializeResponse {
            protocol_version: 1,
            agent_capabilities: json!({
                "fs": {
                    "readTextFile": true,
                    "writeTextFile": true
                },
                "terminal": true
            }),
            agent_info: json!({
                "name": "OpenCode",
                "version": "1.0.0"
            }),
            auth_methods: vec![],
        })
    }

    async fn new_session(&mut self, cwd: String) -> AcpResult<NewSessionResponse> {
        let base_url = self.base_url().await?;
        let url = format!("{}/session", base_url);

        let body = json!({
            "directory": self.runtime_root,
        });

        let response = self
            .http_client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?;

        let session: Session = response.json().await.map_err(AcpError::HttpError)?;

        self.validate_session_binding(&session).await?;

        tracing::info!(
            session_id = %session.id,
            requested_cwd = %cwd,
            runtime_root = %self.runtime_root,
            manager_project_key = %self.manager_project_key,
            opencode_directory = %session.directory,
            opencode_project_id = %session.project_id,
            "Created new OpenCode session"
        );

        // Fetch available models from OpenCode's /provider endpoint
        let (available_models, current_model_id) = self.fetch_available_models().await?;
        let available_commands = self.fetch_available_commands().await;
        let mut response = NewSessionResponse {
            session_id: session.id,
            sequence_id: None,
            session_open: None,
            models: SessionModelState {
                available_models,
                current_model_id,
                models_display: Default::default(),
                provider_metadata: Some(self.provider.frontend_projection()),
            },
            modes: SessionModes {
                current_mode_id: "build".to_string(),
                available_modes: vec![
                    AvailableMode {
                        id: "build".to_string(),
                        name: "Build".to_string(),
                        description: Some("Build mode".to_string()),
                    },
                    AvailableMode {
                        id: "plan".to_string(),
                        name: "Plan".to_string(),
                        description: Some("Planning mode".to_string()),
                    },
                ],
            },
            available_commands,
            config_options: Vec::new(),
        };
        self.provider.apply_session_defaults(
            Path::new(&self.runtime_root),
            &mut response.models,
            &mut response.modes,
        )?;
        let capabilities = provider_capabilities(AgentType::OpenCode);
        response.models.models_display = build_models_for_display(
            &response.models.available_models,
            ModelPresentationMetadata {
                display_family: capabilities.model_display_family,
                usage_metrics: capabilities.usage_metrics_presentation,
            },
        );
        self.current_mode = Some(response.modes.current_mode_id.clone());
        self.seed_current_model(&response.models.current_model_id)?;

        Ok(response)
    }

    async fn resume_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        tracing::info!(
            session_id = %session_id,
            requested_cwd = %cwd,
            runtime_root = %self.runtime_root,
            manager_project_key = %self.manager_project_key,
            "Resuming OpenCode session"
        );

        // Fetch available models from OpenCode's /provider endpoint
        let (available_models, current_model_id) = self.fetch_available_models().await?;
        let available_commands = self.fetch_available_commands().await;
        let mut response = ResumeSessionResponse {
            models: SessionModelState {
                available_models,
                current_model_id,
                models_display: Default::default(),
                provider_metadata: Some(self.provider.frontend_projection()),
            },
            modes: SessionModes {
                current_mode_id: "build".to_string(),
                available_modes: vec![
                    AvailableMode {
                        id: "build".to_string(),
                        name: "Build".to_string(),
                        description: Some("Build mode".to_string()),
                    },
                    AvailableMode {
                        id: "plan".to_string(),
                        name: "Plan".to_string(),
                        description: Some("Planning mode".to_string()),
                    },
                ],
            },
            available_commands,
            config_options: Vec::new(),
        };
        self.provider.apply_session_defaults(
            Path::new(&self.runtime_root),
            &mut response.models,
            &mut response.modes,
        )?;
        let capabilities = provider_capabilities(AgentType::OpenCode);
        response.models.models_display = build_models_for_display(
            &response.models.available_models,
            ModelPresentationMetadata {
                display_family: capabilities.model_display_family,
                usage_metrics: capabilities.usage_metrics_presentation,
            },
        );
        self.current_mode = Some(response.modes.current_mode_id.clone());
        self.seed_current_model(&response.models.current_model_id)?;

        Ok(response)
    }

    fn reconnect_method(&self) -> ReconnectSessionMethod {
        self.provider.reconnect_method()
    }

    async fn fork_session(
        &mut self,
        _session_id: String,
        cwd: String,
    ) -> AcpResult<NewSessionResponse> {
        // OpenCode HTTP doesn't support forking, treat as new session
        self.new_session(cwd).await
    }

    async fn set_session_model(&mut self, _session_id: String, model_id: String) -> AcpResult<()> {
        self.seed_current_model(&model_id)
    }

    async fn set_session_mode(&mut self, _session_id: String, mode_id: String) -> AcpResult<()> {
        self.current_mode = Some(mode_id.clone());
        tracing::info!(mode_id = %mode_id, "OpenCode mode set");
        Ok(())
    }

    async fn send_prompt(&mut self, request: PromptRequest) -> AcpResult<Value> {
        let base_url = self.base_url().await?;
        let url = format!("{}/session/{}/prompt_async", base_url, request.session_id);

        // Get model from stored selection — a model must be set before sending a prompt
        let (provider_id, model_id) = match &self.current_model {
            Some(model) => (model.provider_id.clone(), model.model_id.clone()),
            None => {
                return Err(AcpError::InvalidState(
                    "No model selected. A model must be set before sending a prompt.".to_string(),
                ));
            }
        };

        // Get mode from stored selection or use default
        let agent = self
            .current_mode
            .clone()
            .unwrap_or_else(|| "build".to_string());

        tracing::info!(
            session_id = %request.session_id,
            runtime_root = %self.runtime_root,
            manager_project_key = %self.manager_project_key,
            provider_id = %provider_id,
            model_id = %model_id,
            agent = %agent,
            "Sending prompt to OpenCode"
        );

        // Convert ACP prompt request to OpenCode format
        let body = json!({
            "directory": self.runtime_root,
            "model": {
                "providerID": provider_id,
                "modelID": model_id
            },
            "agent": agent,
            "parts": request.prompt,
        });

        self.http_client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?;

        // OpenCode returns empty response for prompt
        // The actual response comes via SSE events
        Ok(json!({}))
    }

    async fn cancel(&mut self, session_id: String) -> AcpResult<()> {
        let base_url = self.base_url().await?;
        let url = format!("{}/session/{}/abort", base_url, session_id);

        let body = json!({
            "directory": self.runtime_root,
        });

        self.http_client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?;

        Ok(())
    }

    async fn reply_permission(&mut self, request_id: String, reply: String) -> AcpResult<bool> {
        Self::validate_request_id(&request_id)?;
        let base_url = self.base_url().await?;
        let url = format!("{}/permission/{}/reply", base_url, request_id);

        let body = json!({
            "reply": reply,  // "once" | "always" | "reject"
        });

        let response = self
            .http_client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?;

        let result: Value = response.json().await.map_err(AcpError::HttpError)?;
        Ok(result.as_bool().unwrap_or(false))
    }

    async fn reply_question(
        &mut self,
        request_id: String,
        answers: Vec<Vec<String>>,
    ) -> AcpResult<bool> {
        Self::validate_request_id(&request_id)?;
        let base_url = self.base_url().await?;
        let url = format!("{}/question/{}/reply", base_url, request_id);

        let body = json!({
            "answers": answers,
        });

        let response = self
            .http_client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(AcpError::HttpError)?
            .error_for_status()
            .map_err(AcpError::HttpError)?;

        let result: Value = response.json().await.map_err(AcpError::HttpError)?;
        Ok(result.as_bool().unwrap_or(false))
    }

    fn stop(&mut self) {
        // No cleanup needed - SSE is managed by OpenCodeManager
        tracing::info!("OpenCodeHttpClient stopped");
    }
}
