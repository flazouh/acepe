use super::*;

fn should_retry_initialize_with_fallback(error: &AcpError) -> bool {
    match error {
        AcpError::JsonRpcError(message) => message.contains("Agent process exited unexpectedly"),
        AcpError::ChannelClosed => true,
        AcpError::InvalidState(message) => {
            message.contains("Failed to write to stdin") || message.contains("Broken pipe")
        }
        _ => false,
    }
}

impl AcpClient {
    /// Initialize the ACP connection
    pub async fn initialize(&mut self) -> AcpResult<InitializeResponse> {
        loop {
            tracing::info!(
                attempt = self.spawn_config_index + 1,
                "Initializing ACP connection"
            );
            let params = self
                .provider
                .as_ref()
                .map(|provider| {
                    provider.initialize_params("acepe-desktop", env!("CARGO_PKG_VERSION"))
                })
                .unwrap_or_else(|| {
                    json!({
                        "protocolVersion": 1,
                        "clientCapabilities": {
                            "fs": {
                                "readTextFile": true,
                                "writeTextFile": true
                            },
                            "terminal": true,
                            "_meta": {
                                "askUserQuestion": true
                            }
                        }
                    })
                });

            let result = match self.send_request(acp_methods::INITIALIZE, params).await {
                Ok(result) => result,
                Err(error) if should_retry_initialize_with_fallback(&error) => {
                    if !self.advance_spawn_config() {
                        return Err(error);
                    }

                    tracing::warn!(
                        error = %error,
                        retry_attempt = self.spawn_config_index + 1,
                        "Initialize failed after subprocess exit, retrying with fallback launcher"
                    );
                    tracing::warn!(
                        cwd = %self.cwd.display(),
                        reason = "initialize retry with fallback launcher",
                        "Stopping ACP client before fallback respawn"
                    );
                    self.stop();
                    self.start().await?;
                    continue;
                }
                Err(error) => return Err(error),
            };
            let response: InitializeResponse =
                serde_json::from_value(result).map_err(AcpError::SerializationError)?;
            self.authenticate_if_required(&response).await?;

            tracing::info!(
                protocol_version = response.protocol_version,
                attempt = self.spawn_config_index + 1,
                "Initialize successful"
            );
            return Ok(response);
        }
    }

    /// Create a new session and get available models
    pub async fn new_session(&mut self, cwd: String) -> AcpResult<NewSessionResponse> {
        tracing::info!(cwd = %cwd, "Creating new session");
        let params = json!({
            "cwd": cwd,
            "mcpServers": []
        });

        let result = self.send_request(acp_methods::SESSION_NEW, params).await?;
        let mut response: NewSessionResponse =
            serde_json::from_value(result).map_err(AcpError::SerializationError)?;

        tracing::debug!(
            raw_modes_count = response.modes.available_modes.len(),
            raw_current_mode = %response.modes.current_mode_id,
            raw_mode_ids = ?response.modes.available_modes.iter().map(|m| &m.id).collect::<Vec<_>>(),
            "Raw modes from agent before normalization"
        );

        // Ensure modes are populated (agents like Codex may not return modes)
        let provider = self
            .provider
            .as_ref()
            .ok_or(AcpError::NoProviderConfigured)?;
        response.modes = response.modes.normalize_with_provider(provider.as_ref());
        self.hydrate_missing_models_for_provider(provider.as_ref(), &mut response.models)
            .await;
        apply_provider_model_fallback(provider.as_ref(), &mut response.models);

        // Populate models_display using agent-specific transformer
        let agent_type = self
            .provider
            .as_ref()
            .map(|p| p.parser_agent_type())
            .unwrap_or(AgentType::ClaudeCode);
        response.models.models_display =
            get_transformer(agent_type).transform(&response.models.available_models);
        self.set_active_session_id(Some(response.session_id.clone()));

        tracing::info!(
            session_id = %response.session_id,
            modes_count = response.modes.available_modes.len(),
            current_mode = %response.modes.current_mode_id,
            "New session created"
        );
        Ok(response)
    }

    /// Resume an existing session
    /// Per ACP protocol: ResumeSessionResponse does NOT include sessionId
    pub async fn resume_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        tracing::info!(session_id = %session_id, cwd = %cwd, "Resuming session");
        let params = json!({
            "sessionId": session_id.clone(),
            "cwd": cwd.clone(),
            "mcpServers": []
        });

        let result = match self
            .send_request(acp_methods::SESSION_RESUME, params.clone())
            .await
        {
            Ok(result) => result,
            Err(err) if is_method_not_found_error(&err) => {
                tracing::warn!("session/resume not supported, falling back to session/load");
                return self.load_session(session_id, cwd).await;
            }
            Err(err) if is_session_not_found_error(&err) => {
                return Err(AcpError::SessionNotFound(session_id.clone()));
            }
            Err(err) => return Err(err),
        };
        self.finalize_resume_response(session_id, result, "resume")
            .await
    }

    /// Load an existing session with replay semantics.
    ///
    /// This always uses ACP `session/load`, which replays historical updates.
    pub async fn load_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        tracing::info!(session_id = %session_id, cwd = %cwd, "Loading session");
        let params = json!({
            "sessionId": session_id.clone(),
            "cwd": cwd.clone(),
            "mcpServers": []
        });

        let _replay_guard = ReplayGuard::activate(&self.is_replay_active);
        let result = match self.send_request(acp_methods::SESSION_LOAD, params).await {
            Ok(result) => result,
            Err(err) if is_session_not_found_error(&err) => {
                return Err(AcpError::SessionNotFound(session_id.clone()));
            }
            Err(err) => return Err(err),
        };

        self.finalize_resume_response(session_id, result, "load")
            .await
    }

    async fn finalize_resume_response(
        &mut self,
        session_id: String,
        result: serde_json::Value,
        operation: &str,
    ) -> AcpResult<ResumeSessionResponse> {
        let mut response: ResumeSessionResponse =
            serde_json::from_value(result).map_err(AcpError::SerializationError)?;

        tracing::debug!(
            raw_modes_count = response.modes.available_modes.len(),
            raw_current_mode = %response.modes.current_mode_id,
            raw_mode_ids = ?response.modes.available_modes.iter().map(|m| &m.id).collect::<Vec<_>>(),
            "Raw modes from agent before normalization (resume)"
        );

        // Ensure modes are populated (agents like Codex may not return modes)
        let provider = self
            .provider
            .as_ref()
            .ok_or(AcpError::NoProviderConfigured)?;
        response.modes = response.modes.normalize_with_provider(provider.as_ref());
        self.hydrate_missing_models_for_provider(provider.as_ref(), &mut response.models)
            .await;
        apply_provider_model_fallback(provider.as_ref(), &mut response.models);

        // Populate models_display using agent-specific transformer
        let agent_type = self
            .provider
            .as_ref()
            .map(|p| p.parser_agent_type())
            .unwrap_or(AgentType::ClaudeCode);
        response.models.models_display =
            get_transformer(agent_type).transform(&response.models.available_models);
        self.set_active_session_id(Some(session_id.clone()));

        tracing::info!(
            session_id = %session_id,
            modes_count = response.modes.available_modes.len(),
            current_mode = %response.modes.current_mode_id,
            operation = operation,
            "Session ready"
        );
        Ok(response)
    }

    /// Fork an existing session (creates a new session with copied history)
    pub async fn fork_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<NewSessionResponse> {
        tracing::info!(session_id = %session_id, cwd = %cwd, "Forking session");
        let params = json!({
            "sessionId": session_id,
            "cwd": cwd,
            "mcpServers": []
        });

        let result = self.send_request(acp_methods::SESSION_FORK, params).await?;
        let mut response: NewSessionResponse =
            serde_json::from_value(result).map_err(AcpError::SerializationError)?;

        tracing::debug!(
            raw_modes_count = response.modes.available_modes.len(),
            raw_current_mode = %response.modes.current_mode_id,
            raw_mode_ids = ?response.modes.available_modes.iter().map(|m| &m.id).collect::<Vec<_>>(),
            "Raw modes from agent before normalization (fork)"
        );

        // Ensure modes are populated (agents like Codex may not return modes)
        let provider = self
            .provider
            .as_ref()
            .ok_or(AcpError::NoProviderConfigured)?;
        response.modes = response.modes.normalize_with_provider(provider.as_ref());
        self.hydrate_missing_models_for_provider(provider.as_ref(), &mut response.models)
            .await;
        apply_provider_model_fallback(provider.as_ref(), &mut response.models);

        // Populate models_display using agent-specific transformer
        let agent_type = self
            .provider
            .as_ref()
            .map(|p| p.parser_agent_type())
            .unwrap_or(AgentType::ClaudeCode);
        response.models.models_display =
            get_transformer(agent_type).transform(&response.models.available_models);
        self.set_active_session_id(Some(response.session_id.clone()));

        tracing::info!(
            session_id = %response.session_id,
            modes_count = response.modes.available_modes.len(),
            current_mode = %response.modes.current_mode_id,
            "Session forked"
        );
        Ok(response)
    }

    /// Cancel a session
    ///
    /// This sends a JSON-RPC notification (no id, no response expected) to cancel
    /// the current operation in the session.
    pub async fn cancel(&mut self, session_id: String) -> AcpResult<()> {
        let params = json!({
            "sessionId": session_id
        });

        tracing::debug!(session_id = %session_id, "Sending cancel notification");
        client_rpc::send_notification(&self.stdin_writer, acp_methods::SESSION_CANCEL, params)
            .await?;

        tracing::debug!(session_id = %session_id, "Cancel notification sent");
        Ok(())
    }

    /// List sessions from the agent
    ///
    /// Calls session/list to retrieve available sessions. Optional cwd parameter
    /// filters sessions to a specific working directory.
    pub async fn list_sessions(&mut self, cwd: Option<String>) -> AcpResult<ListSessionsResponse> {
        self.list_sessions_page(cwd, None).await
    }

    /// List a page of sessions from the agent.
    pub async fn list_sessions_page(
        &mut self,
        cwd: Option<String>,
        cursor: Option<String>,
    ) -> AcpResult<ListSessionsResponse> {
        tracing::info!(cwd = ?cwd, cursor = ?cursor, "Listing sessions");
        let params = build_list_sessions_params(cwd, cursor);

        let result = self.send_request(acp_methods::SESSION_LIST, params).await?;
        let response: ListSessionsResponse =
            serde_json::from_value(result).map_err(AcpError::SerializationError)?;

        tracing::info!(count = response.sessions.len(), "Listed sessions");
        Ok(response)
    }
}

fn build_list_sessions_params(cwd: Option<String>, cursor: Option<String>) -> serde_json::Value {
    let mut params = serde_json::Map::new();

    if let Some(path) = cwd {
        params.insert("cwd".to_string(), json!(path));
    }

    if let Some(value) = cursor {
        params.insert("cursor".to_string(), json!(value));
    }

    serde_json::Value::Object(params)
}

#[cfg(test)]
mod tests {
    use super::build_list_sessions_params;
    use serde_json::json;

    #[test]
    fn list_sessions_params_include_cursor_when_present() {
        assert_eq!(
            build_list_sessions_params(Some("/repo".to_string()), Some("cursor-1".to_string())),
            json!({
                "cwd": "/repo",
                "cursor": "cursor-1"
            })
        );
    }

    #[test]
    fn list_sessions_params_omit_empty_fields() {
        assert_eq!(build_list_sessions_params(None, None), json!({}));
    }
}
