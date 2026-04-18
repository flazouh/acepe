use crate::acp::error::{AcpError, SerializableAcpError};
use crate::analytics;
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandErrorClassification {
    Expected,
    Unexpected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SerializableCommandErrorDomain {
    Acp(SerializableAcpError),
}

impl From<SerializableAcpError> for SerializableCommandErrorDomain {
    fn from(value: SerializableAcpError) -> Self {
        Self::Acp(value)
    }
}

impl From<AcpError> for SerializableCommandErrorDomain {
    fn from(value: AcpError) -> Self {
        Self::Acp(SerializableAcpError::from(value))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializableCommandErrorDiagnostics {
    pub summary: String,
}

impl SerializableCommandErrorDiagnostics {
    pub fn new(summary: impl Into<String>) -> Self {
        Self {
            summary: redact_sensitive_text(&summary.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializableCommandError {
    pub command_name: String,
    pub classification: CommandErrorClassification,
    pub backend_correlation_id: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<SerializableCommandErrorDomain>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<SerializableCommandErrorDiagnostics>,
}

pub type CommandResult<T> = Result<T, SerializableCommandError>;

impl SerializableCommandError {
    pub fn expected(command_name: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(
            command_name,
            CommandErrorClassification::Expected,
            message,
            None,
            None,
        )
    }

    pub fn unexpected(command_name: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(
            command_name,
            CommandErrorClassification::Unexpected,
            message,
            None,
            None,
        )
    }

    pub fn with_domain(mut self, domain: impl Into<SerializableCommandErrorDomain>) -> Self {
        self.domain = Some(domain.into());
        self
    }

    pub fn with_backend_event_id(mut self, backend_event_id: impl Into<String>) -> Self {
        self.backend_event_id = Some(backend_event_id.into());
        self
    }

    pub fn with_diagnostics(mut self, diagnostics: SerializableCommandErrorDiagnostics) -> Self {
        self.diagnostics = Some(diagnostics);
        self
    }

    fn new(
        command_name: impl Into<String>,
        classification: CommandErrorClassification,
        message: impl Into<String>,
        backend_event_id: Option<String>,
        diagnostics: Option<SerializableCommandErrorDiagnostics>,
    ) -> Self {
        Self {
            command_name: command_name.into(),
            classification,
            backend_correlation_id: Uuid::new_v4().to_string(),
            message: message.into(),
            backend_event_id,
            domain: None,
            diagnostics,
        }
    }
}

impl fmt::Display for SerializableCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

pub fn expected_acp_command_error(
    command_name: impl Into<String>,
    error: SerializableAcpError,
) -> SerializableCommandError {
    let message = error.to_string();
    SerializableCommandError::expected(command_name, message).with_domain(error)
}

#[allow(clippy::result_large_err)]
pub fn expected_acp_command_result<T>(
    command_name: &'static str,
    result: Result<T, SerializableAcpError>,
) -> CommandResult<T> {
    result.map_err(|error| expected_acp_command_error(command_name, error))
}

#[allow(clippy::result_large_err)]
pub fn expected_command_result<T>(
    command_name: &'static str,
    result: Result<T, String>,
) -> CommandResult<T> {
    result.map_err(|message| SerializableCommandError::expected(command_name, message))
}

#[allow(clippy::result_large_err)]
pub fn unexpected_command_result<T>(
    command_name: &'static str,
    message: &'static str,
    result: Result<T, String>,
) -> CommandResult<T> {
    result
        .map_err(|diagnostics| capture_unexpected_command_error(command_name, message, diagnostics))
}

pub fn capture_unexpected_command_error(
    command_name: impl Into<String>,
    message: impl Into<String>,
    diagnostics: impl Into<String>,
) -> SerializableCommandError {
    let mut error = SerializableCommandError::unexpected(command_name, message)
        .with_diagnostics(SerializableCommandErrorDiagnostics::new(diagnostics));

    if let Some(event_id) = capture_command_error_event(&error) {
        error = error.with_backend_event_id(event_id);
    }

    error
}

fn redact_sensitive_text(input: &str) -> String {
    match dirs::home_dir() {
        Some(home_dir) => {
            let home = home_dir.to_string_lossy();
            input.replace(home.as_ref(), "<user_home>")
        }
        None => input.to_string(),
    }
}

fn capture_command_error_event(error: &SerializableCommandError) -> Option<String> {
    if !analytics::is_analytics_enabled() {
        return None;
    }

    let event_id = sentry::with_scope(
        |scope| {
            scope.set_tag("command_name", error.command_name.as_str());
            scope.set_tag(
                "command_classification",
                match error.classification {
                    CommandErrorClassification::Expected => "expected",
                    CommandErrorClassification::Unexpected => "unexpected",
                },
            );
            scope.set_extra(
                "backend_correlation_id",
                error.backend_correlation_id.clone().into(),
            );

            if let Some(diagnostics) = &error.diagnostics {
                scope.set_extra("diagnostics_summary", diagnostics.summary.clone().into());
            }

            if let Some(domain) = &error.domain {
                let domain_name = match domain {
                    SerializableCommandErrorDomain::Acp(_) => "acp",
                };
                scope.set_extra("command_domain", domain_name.into());
            }
        },
        || sentry::capture_message(&error.message, sentry::Level::Error),
    );

    let event_id = event_id.to_string();
    if event_id == "00000000000000000000000000000000" {
        None
    } else {
        Some(event_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_command_error_preserves_acp_payload() {
        let error = SerializableCommandError::expected("acp_new_session", "Session not found")
            .with_domain(SerializableAcpError::SessionNotFound {
                session_id: "session-123".to_string(),
            });

        assert_eq!(error.classification, CommandErrorClassification::Expected);
        assert_eq!(error.command_name, "acp_new_session");
        assert!(matches!(
            error.domain,
            Some(SerializableCommandErrorDomain::Acp(
                SerializableAcpError::SessionNotFound { .. }
            ))
        ));
        assert!(!error.backend_correlation_id.is_empty());
    }

    #[test]
    fn diagnostics_redact_home_directory() {
        let Some(home_dir) = dirs::home_dir() else {
            return;
        };

        let message = format!("{}/projects/acepe/test.log", home_dir.to_string_lossy());
        let diagnostics = SerializableCommandErrorDiagnostics::new(message);

        assert!(diagnostics
            .summary
            .contains("<user_home>/projects/acepe/test.log"));
        assert!(!diagnostics
            .summary
            .contains(home_dir.to_string_lossy().as_ref()));
    }

    #[test]
    fn nested_acp_payload_round_trips_through_serialization() {
        let original = SerializableCommandError::unexpected("acp_send_prompt", "Protocol error")
            .with_domain(SerializableAcpError::ProtocolError {
                message: "stream closed".to_string(),
            })
            .with_backend_event_id("event-123")
            .with_diagnostics(SerializableCommandErrorDiagnostics::new(
                "/Users/alex/project/stream.log",
            ));

        let json = serde_json::to_string(&original).expect("serialize");
        let round_trip: SerializableCommandError =
            serde_json::from_str(&json).expect("deserialize");

        assert_eq!(round_trip.command_name, "acp_send_prompt");
        assert_eq!(
            round_trip.classification,
            CommandErrorClassification::Unexpected
        );
        assert_eq!(round_trip.backend_event_id.as_deref(), Some("event-123"));
        assert!(matches!(
            round_trip.domain,
            Some(SerializableCommandErrorDomain::Acp(
                SerializableAcpError::ProtocolError { .. }
            ))
        ));
    }
}
