use super::*;

impl AcpClient {
    /// Set the model for a session
    pub async fn set_session_model(
        &mut self,
        session_id: String,
        model_id: String,
    ) -> AcpResult<()> {
        let params = json!({
            "sessionId": session_id,
            "modelId": model_id
        });

        self.send_request(acp_methods::SESSION_SET_MODEL, params)
            .await?;
        Ok(())
    }

    /// Set the mode for a session
    ///
    /// Sends the mode change request to the agent. If the agent doesn't support
    /// session/set_mode (returns "method not found"), we silently ignore the error
    /// to allow mode switching in the UI even for agents that don't implement it natively.
    pub async fn set_session_mode(&mut self, session_id: String, mode_id: String) -> AcpResult<()> {
        let outbound_mode_id = self
            .provider
            .as_ref()
            .map(|provider| provider.map_outbound_mode_id(&mode_id))
            .unwrap_or(mode_id.clone());
        let params = json!({
            "sessionId": session_id,
            "modeId": outbound_mode_id
        });

        // Send to agent - some handle it natively, others will return "method not found"
        match self
            .send_request(acp_methods::SESSION_SET_MODE, params)
            .await
        {
            Ok(_) => {
                tracing::debug!(mode = %mode_id, outbound_mode = %outbound_mode_id, "Agent accepted session/set_mode");
            }
            Err(err) if is_method_not_found_error(&err) => {
                // Agent doesn't support session/set_mode - that's OK for UI mode switching
                tracing::debug!(mode = %mode_id, outbound_mode = %outbound_mode_id, "Agent doesn't support session/set_mode, ignoring");
            }
            Err(err) => {
                // Unexpected error - log but don't fail to allow UI mode switching
                tracing::warn!(mode = %mode_id, outbound_mode = %outbound_mode_id, error = %err, "session/set_mode failed, ignoring");
            }
        }
        Ok(())
    }

    /// Set a configuration option for a session.
    ///
    /// Sends a `session/set_config_option` request to the agent. The response contains
    /// the full updated set of config options (changing one option may affect others).
    pub async fn set_session_config_option(
        &mut self,
        session_id: String,
        config_id: String,
        value: String,
    ) -> AcpResult<Value> {
        let params = json!({
            "sessionId": session_id,
            "configId": config_id,
            "value": value
        });

        self.send_request(acp_methods::SESSION_SET_CONFIG_OPTION, params)
            .await
    }
}
