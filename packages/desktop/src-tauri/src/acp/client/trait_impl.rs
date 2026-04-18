use super::*;
use crate::acp::client_trait::ReconnectSessionMethod;
use async_trait::async_trait;

impl Drop for AcpClient {
    fn drop(&mut self) {
        tracing::warn!(
            cwd = %self.cwd.display(),
            provider = self.provider.as_ref().map(|provider| provider.id()).unwrap_or("unknown"),
            stderr = self.stderr_buffer.as_ref().and_then(crate::acp::client_loop::read_stderr_buffer),
            reason = "AcpClient::drop",
            "Stopping ACP client from Drop"
        );
        self.stop();
    }
}

/// Implement AgentClient trait for AcpClient
#[async_trait]
impl AgentClient for AcpClient {
    async fn start(&mut self) -> AcpResult<()> {
        self.start().await
    }

    async fn initialize(&mut self) -> AcpResult<InitializeResponse> {
        self.initialize().await
    }

    async fn new_session(&mut self, cwd: String) -> AcpResult<NewSessionResponse> {
        self.new_session(cwd).await
    }

    async fn resume_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        self.resume_session(session_id, cwd).await
    }

    async fn load_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        self.load_session(session_id, cwd).await
    }

    fn reconnect_method(&self) -> ReconnectSessionMethod {
        self.provider
            .as_ref()
            .map(|provider| provider.reconnect_method())
            .unwrap_or_default()
    }

    async fn fork_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<NewSessionResponse> {
        self.fork_session(session_id, cwd).await
    }

    async fn set_session_model(&mut self, session_id: String, model_id: String) -> AcpResult<()> {
        self.set_session_model(session_id, model_id).await
    }

    async fn set_session_mode(&mut self, session_id: String, mode_id: String) -> AcpResult<()> {
        self.set_session_mode(session_id, mode_id).await
    }

    async fn set_session_config_option(
        &mut self,
        session_id: String,
        config_id: String,
        value: String,
    ) -> AcpResult<Value> {
        self.set_session_config_option(session_id, config_id, value)
            .await
    }

    async fn send_prompt(&mut self, request: PromptRequest) -> AcpResult<Value> {
        self.send_prompt(request).await
    }

    async fn send_prompt_fire_and_forget(&mut self, request: PromptRequest) -> AcpResult<()> {
        self.send_prompt_fire_and_forget(request).await
    }

    async fn cancel(&mut self, session_id: String) -> AcpResult<()> {
        self.cancel(session_id).await
    }

    async fn list_sessions(&mut self, cwd: Option<String>) -> AcpResult<ListSessionsResponse> {
        self.list_sessions(cwd).await
    }

    // Permission/question replies use default implementation (no-op)
    // These are only supported for OpenCode HTTP client

    async fn respond(&self, request_id: u64, result: Value) -> AcpResult<()> {
        self.respond_with_permission_tracking(request_id, result)
            .await
    }

    fn stop(&mut self) {
        self.stop()
    }
}
