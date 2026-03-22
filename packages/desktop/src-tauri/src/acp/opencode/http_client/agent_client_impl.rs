use super::*;

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
        // Store the working directory
        self.current_directory = Some(cwd.clone());

        let base_url = self.base_url().await?;
        let url = format!("{}/session", base_url);

        let body = json!({
            "directory": cwd,
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
            manager_project_key = %self.manager_project_key,
            opencode_directory = %session.directory,
            opencode_project_id = %session.project_id,
            "Created new OpenCode session"
        );

        // Initialize default mode
        self.current_mode = Some("build".to_string());

        // Fetch available models from OpenCode's /provider endpoint
        let (available_models, current_model_id) = self.fetch_available_models().await?;
        self.seed_current_model(&current_model_id)?;
        let available_commands = self.fetch_available_commands().await;

        let models_display = get_transformer(AgentType::OpenCode).transform(&available_models);

        Ok(NewSessionResponse {
            session_id: session.id,
            models: SessionModelState {
                available_models,
                current_model_id,
                models_display,
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
        })
    }

    async fn resume_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        // Store the working directory
        self.current_directory = Some(cwd.clone());

        tracing::info!(
            session_id = %session_id,
            requested_cwd = %cwd,
            manager_project_key = %self.manager_project_key,
            "Resuming OpenCode session"
        );

        // Initialize default mode
        self.current_mode = Some("build".to_string());

        // Fetch available models from OpenCode's /provider endpoint
        let (available_models, current_model_id) = self.fetch_available_models().await?;
        self.seed_current_model(&current_model_id)?;
        let available_commands = self.fetch_available_commands().await;

        let models_display = get_transformer(AgentType::OpenCode).transform(&available_models);

        // For HTTP mode, resuming is just setting the context
        // Per ACP protocol: ResumeSessionResponse does NOT include sessionId
        Ok(ResumeSessionResponse {
            models: SessionModelState {
                available_models,
                current_model_id,
                models_display,
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
        })
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
            requested_cwd = ?self.current_directory,
            manager_project_key = %self.manager_project_key,
            provider_id = %provider_id,
            model_id = %model_id,
            agent = %agent,
            "Sending prompt to OpenCode"
        );

        // Convert ACP prompt request to OpenCode format
        let body = json!({
            "directory": self.current_directory,
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

        // Ensure current_directory is set (same guard as send_prompt)
        let directory = self
            .current_directory
            .clone()
            .ok_or_else(|| AcpError::InvalidState("current_directory not set".to_string()))?;

        let body = json!({
            "directory": directory,
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
