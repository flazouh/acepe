use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreationFailureKind {
    ProviderFailedBeforeId,
    InvalidProviderSessionId,
    ProviderIdentityMismatch,
    MetadataCommitFailed,
    LaunchTokenUnavailable,
    CreationAttemptExpired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationFailure {
    pub kind: CreationFailureKind,
    pub message: String,
    pub session_id: Option<String>,
    pub creation_attempt_id: Option<String>,
    pub retryable: bool,
}

impl CreationFailure {
    pub fn new(
        kind: CreationFailureKind,
        message: impl Into<String>,
        session_id: Option<String>,
        creation_attempt_id: Option<String>,
        retryable: bool,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            session_id,
            creation_attempt_id,
            retryable,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderHistoryFailureKind {
    ProviderUnavailable,
    ProviderHistoryMissing,
    ProviderUnparseable,
    ProviderValidationFailed,
    StaleLineageRecovery,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHistoryFailure {
    pub kind: ProviderHistoryFailureKind,
    pub message: String,
    pub session_id: Option<String>,
    pub retryable: bool,
}

impl ProviderHistoryFailure {
    pub fn new(
        kind: ProviderHistoryFailureKind,
        message: impl Into<String>,
        session_id: Option<String>,
        retryable: bool,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            session_id,
            retryable,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

    #[serde(rename = "creation_failed")]
    CreationFailed(CreationFailure),

    #[serde(rename = "provider_history_failed")]
    ProviderHistoryFailed(ProviderHistoryFailure),

    #[serde(rename = "viewport_session_not_attached")]
    ViewportSessionNotAttached { session_id: String },
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

impl From<crate::acp::provider::ProviderHistoryLoadError> for SerializableAcpError {
    fn from(error: crate::acp::provider::ProviderHistoryLoadError) -> Self {
        let (kind, message, retryable) = match error {
            crate::acp::provider::ProviderHistoryLoadError::ProviderUnavailable { message } => (
                ProviderHistoryFailureKind::ProviderUnavailable,
                message,
                true,
            ),
            crate::acp::provider::ProviderHistoryLoadError::ProviderHistoryMissing { message } => (
                ProviderHistoryFailureKind::ProviderHistoryMissing,
                message,
                false,
            ),
            crate::acp::provider::ProviderHistoryLoadError::ProviderUnparseable { message } => (
                ProviderHistoryFailureKind::ProviderUnparseable,
                message,
                false,
            ),
            crate::acp::provider::ProviderHistoryLoadError::ProviderValidationFailed {
                message,
            } => (
                ProviderHistoryFailureKind::ProviderValidationFailed,
                message,
                false,
            ),
            crate::acp::provider::ProviderHistoryLoadError::StaleLineageRecovery { message } => (
                ProviderHistoryFailureKind::StaleLineageRecovery,
                message,
                true,
            ),
            crate::acp::provider::ProviderHistoryLoadError::Internal { message } => {
                (ProviderHistoryFailureKind::Internal, message, true)
            }
        };

        SerializableAcpError::ProviderHistoryFailed(ProviderHistoryFailure::new(
            kind, message, None, retryable,
        ))
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
            SerializableAcpError::CreationFailed(failure) => {
                write!(
                    f,
                    "Creation failed ({:?}): {}",
                    failure.kind, failure.message
                )
            }
            SerializableAcpError::ProviderHistoryFailed(failure) => {
                write!(
                    f,
                    "Provider history failed ({:?}): {}",
                    failure.kind, failure.message
                )
            }
            SerializableAcpError::ViewportSessionNotAttached { session_id } => {
                write!(
                    f,
                    "No canonical transcript viewport is attached for session {}",
                    session_id
                )
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

#[cfg(test)]
mod tests {
    use super::SerializableAcpError;

    #[test]
    fn viewport_session_not_attached_serializes_with_snake_case_tag_and_session_id() {
        let error = SerializableAcpError::ViewportSessionNotAttached {
            session_id: "session-abc".to_string(),
        };

        let value = serde_json::to_value(&error).expect("serialize");
        assert_eq!(value["type"], "viewport_session_not_attached");
        assert_eq!(value["data"]["session_id"], "session-abc");
    }

    #[test]
    fn viewport_session_not_attached_round_trips() {
        let error = SerializableAcpError::ViewportSessionNotAttached {
            session_id: "session-xyz".to_string(),
        };

        let json = serde_json::to_string(&error).expect("serialize");
        let decoded: SerializableAcpError = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded, error);
    }

    #[test]
    fn viewport_session_not_attached_display_mentions_session() {
        let error = SerializableAcpError::ViewportSessionNotAttached {
            session_id: "session-123".to_string(),
        };

        assert!(error.to_string().contains("session-123"));
    }
}
