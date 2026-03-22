use crate::acp::client::{
    InitializeResponse, ListSessionsResponse, NewSessionResponse, ResumeSessionResponse,
};
use crate::acp::error::AcpResult;
use crate::acp::types::PromptRequest;
use async_trait::async_trait;
use serde_json::Value;

/// Communication mode for agent providers
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommunicationMode {
    /// JSON-RPC over stdio (subprocess)
    Subprocess,
    /// HTTP REST API + SSE
    Http,
}

/// Trait for agent client implementations
/// Enables polymorphism between subprocess-based (ACP) and HTTP-based (OpenCode) clients
#[async_trait]
pub trait AgentClient: Send + Sync {
    /// Start the client (spawn process or connect to server)
    async fn start(&mut self) -> AcpResult<()>;

    /// Initialize the protocol connection
    async fn initialize(&mut self) -> AcpResult<InitializeResponse>;

    /// Create a new session
    async fn new_session(&mut self, cwd: String) -> AcpResult<NewSessionResponse>;

    /// Resume an existing session
    /// Per ACP protocol: ResumeSessionResponse does NOT include sessionId
    async fn resume_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<ResumeSessionResponse>;

    /// Fork a session (creates a new session with copied history)
    async fn fork_session(
        &mut self,
        session_id: String,
        cwd: String,
    ) -> AcpResult<NewSessionResponse>;

    /// Set model for session
    async fn set_session_model(&mut self, session_id: String, model_id: String) -> AcpResult<()>;

    /// Set mode for session
    async fn set_session_mode(&mut self, session_id: String, mode_id: String) -> AcpResult<()>;

    /// Set a configuration option for a session
    ///
    /// Returns the full updated config options from the agent.
    /// Default implementation returns "method not found" style error for agents that don't support it.
    async fn set_session_config_option(
        &mut self,
        _session_id: String,
        _config_id: String,
        _value: String,
    ) -> AcpResult<Value> {
        Err(crate::acp::error::AcpError::ProtocolError(
            "session/set_config_option not supported by this agent".to_string(),
        ))
    }

    /// Send prompt to session (blocking - waits for response)
    async fn send_prompt(&mut self, request: PromptRequest) -> AcpResult<Value>;

    /// Send prompt without waiting for response (fire-and-forget)
    ///
    /// This is the preferred method for sending prompts as it returns immediately.
    /// The response will arrive via session/update notifications emitted as events.
    ///
    /// Default implementation calls send_prompt and discards the result.
    async fn send_prompt_fire_and_forget(&mut self, request: PromptRequest) -> AcpResult<()> {
        self.send_prompt(request).await?;
        Ok(())
    }

    /// Cancel/abort session
    async fn cancel(&mut self, session_id: String) -> AcpResult<()>;

    /// List sessions from the agent
    ///
    /// Returns available sessions, optionally filtered by cwd.
    /// Default implementation returns empty list (for agents that don't support this).
    async fn list_sessions(&mut self, _cwd: Option<String>) -> AcpResult<ListSessionsResponse> {
        Ok(ListSessionsResponse {
            sessions: vec![],
            next_cursor: None,
        })
    }

    /// Reply to permission request (OpenCode-specific, no-op for ACP clients)
    async fn reply_permission(&mut self, _request_id: String, _reply: String) -> AcpResult<bool> {
        // Default implementation: not supported
        Ok(false)
    }

    /// Reply to question request (OpenCode-specific, no-op for ACP clients)
    async fn reply_question(
        &mut self,
        _request_id: String,
        _answers: Vec<Vec<String>>,
    ) -> AcpResult<bool> {
        // Default implementation: not supported
        Ok(false)
    }

    /// Respond to an inbound JSON-RPC request (ACP-specific)
    /// This sends a JSON-RPC response back to the subprocess for requests
    /// like client/requestPermission. The request_id is the JSON-RPC id.
    async fn respond(&self, _request_id: u64, _result: Value) -> AcpResult<()> {
        // Default implementation: not supported (OpenCode uses HTTP, not JSON-RPC)
        Ok(())
    }

    /// Stop the client (sync - called from Drop)
    fn stop(&mut self);
}
