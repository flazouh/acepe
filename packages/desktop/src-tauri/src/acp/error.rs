use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum SerializableAcpError {
    #[serde(rename = "agent_not_found")]
    AgentNotFound { agent_id: String },

    #[serde(rename = "no_provider_configured")]
    NoProviderConfigured,

    #[serde(rename = "session_not_found")]
    SessionNotFound { session_id: String },

    #[serde(rename = "client_not_started")]
    ClientNotStarted,

    #[serde(rename = "opencode_server_not_running")]
    OpenCodeServerNotRunning,

    #[serde(rename = "subprocess_spawn_failed")]
    SubprocessSpawnFailed { command: String, error: String },

    #[serde(rename = "json_rpc_error")]
    JsonRpcError { message: String },

    #[serde(rename = "protocol_error")]
    ProtocolError { message: String },

    #[serde(rename = "http_error")]
    HttpError { message: String },

    #[serde(rename = "serialization_error")]
    SerializationError { message: String },

    #[serde(rename = "channel_closed")]
    ChannelClosed,

    #[serde(rename = "timeout")]
    Timeout { operation: String },

    #[serde(rename = "invalid_state")]
    InvalidState { message: String },
}

impl From<AcpError> for SerializableAcpError {
    fn from(error: AcpError) -> Self {
        match error {
            AcpError::AgentNotFound(agent_id) => SerializableAcpError::AgentNotFound { agent_id },
            AcpError::NoProviderConfigured => SerializableAcpError::NoProviderConfigured,
            AcpError::SessionNotFound(session_id) => {
                SerializableAcpError::SessionNotFound { session_id }
            }
            AcpError::ClientNotStarted => SerializableAcpError::ClientNotStarted,
            AcpError::OpenCodeServerNotRunning => SerializableAcpError::OpenCodeServerNotRunning,
            AcpError::SubprocessSpawnFailed { command, source } => {
                SerializableAcpError::SubprocessSpawnFailed {
                    command,
                    error: source.to_string(),
                }
            }
            AcpError::JsonRpcError(message) => SerializableAcpError::JsonRpcError { message },
            AcpError::ProtocolError(message) => SerializableAcpError::ProtocolError { message },
            AcpError::HttpError(err) => SerializableAcpError::HttpError {
                message: err.to_string(),
            },
            AcpError::SerializationError(err) => SerializableAcpError::SerializationError {
                message: err.to_string(),
            },
            AcpError::ChannelClosed => SerializableAcpError::ChannelClosed,
            AcpError::Timeout(operation) => SerializableAcpError::Timeout { operation },
            AcpError::InvalidState(message) => SerializableAcpError::InvalidState { message },
        }
    }
}

impl std::fmt::Display for SerializableAcpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SerializableAcpError::AgentNotFound { agent_id } => {
                write!(f, "Agent not found: {}", agent_id)
            }
            SerializableAcpError::NoProviderConfigured => write!(f, "No agent provider configured"),
            SerializableAcpError::SessionNotFound { session_id } => {
                write!(f, "Session not found: {}", session_id)
            }
            SerializableAcpError::ClientNotStarted => write!(f, "Client not started"),
            SerializableAcpError::OpenCodeServerNotRunning => {
                write!(f, "OpenCode server not running")
            }
            SerializableAcpError::SubprocessSpawnFailed { command, error } => {
                write!(f, "Failed to spawn subprocess '{}': {}", command, error)
            }
            SerializableAcpError::JsonRpcError { message } => {
                write!(f, "JSON-RPC error: {}", message)
            }
            SerializableAcpError::ProtocolError { message } => {
                write!(f, "Protocol error: {}", message)
            }
            SerializableAcpError::HttpError { message } => {
                write!(f, "HTTP request failed: {}", message)
            }
            SerializableAcpError::SerializationError { message } => {
                write!(f, "Serialization error: {}", message)
            }
            SerializableAcpError::ChannelClosed => write!(f, "Channel closed unexpectedly"),
            SerializableAcpError::Timeout { operation } => {
                write!(f, "Operation timed out: {}", operation)
            }
            SerializableAcpError::InvalidState { message } => {
                write!(f, "Invalid state: {}", message)
            }
        }
    }
}

#[derive(Debug, Error)]
pub enum AcpError {
    #[error("Agent not found: {0}")]
    AgentNotFound(String),

    #[error("No agent provider configured")]
    NoProviderConfigured,

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Client not started")]
    ClientNotStarted,

    #[error("OpenCode server not running")]
    OpenCodeServerNotRunning,

    #[error("Failed to spawn subprocess: {source}")]
    SubprocessSpawnFailed {
        command: String,
        #[source]
        source: std::io::Error,
    },

    #[error("JSON-RPC error: {0}")]
    JsonRpcError(String),

    #[error("Protocol error: {0}")]
    ProtocolError(String),

    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Channel closed unexpectedly")]
    ChannelClosed,

    #[error("Operation timed out: {0}")]
    Timeout(String),

    #[error("Invalid state: {0}")]
    InvalidState(String),
}

pub type AcpResult<T> = Result<T, AcpError>;
