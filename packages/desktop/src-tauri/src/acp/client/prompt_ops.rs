use super::*;

impl AcpClient {
    /// Send a prompt to the session (blocking - waits for response)
    ///
    /// @see https://agentclientprotocol.com/protocol/#prompt
    #[allow(dead_code)]
    pub async fn send_prompt(&mut self, request: PromptRequest) -> AcpResult<Value> {
        // Serialize the typed struct to JSON value
        // This ensures the field names match the ACP protocol specification
        let params = serde_json::to_value(&request).map_err(AcpError::SerializationError)?;

        self.send_request(acp_methods::PROMPT, params).await
    }

    /// Send a prompt without waiting for the response
    ///
    /// This is the preferred method for sending prompts as it returns immediately
    /// after writing to the subprocess stdin. The response will arrive via
    /// session/update notifications which are emitted as Tauri events.
    ///
    /// When the prompt completes, a TurnComplete event will be emitted.
    ///
    /// @see https://agentclientprotocol.com/protocol/#prompt
    pub async fn send_prompt_fire_and_forget(&mut self, request: PromptRequest) -> AcpResult<()> {
        // Store session_id before serialization for TurnComplete tracking
        let session_id = request.session_id.clone();

        let params = serde_json::to_value(&request).map_err(AcpError::SerializationError)?;
        client_rpc::send_prompt_fire_and_forget(
            &self.stdin_writer,
            &self.request_id,
            &self.prompt_request_sessions,
            session_id,
            acp_methods::PROMPT,
            params,
        )
        .await
    }
}
