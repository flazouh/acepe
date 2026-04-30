//! Classifies resume-time `SerializableAcpError`s into canonical
//! [`FailureReason`] variants for the `SessionUpdate::ConnectionFailed`
//! envelope.
//!
//! The classifier owns *taxonomy only* — it never produces user-facing
//! English copy. The raw provider text continues to flow through the
//! envelope's `error` field, and the canonical TS reader composes the
//! user-facing message from `(agentId, failureReason)`. This preserves
//! the layer boundary: Rust owns the canonical truth, TS owns
//! presentation.
//!
//! Most session-not-found errors arrive here as
//! [`SerializableAcpError::SessionNotFound`] because
//! [`crate::acp::client::session_lifecycle::load_session`] converts both
//! `-32602 Session … not found` and (after the
//! `client_errors::is_session_not_found_error` extension) Copilot's
//! `-32002 Resource not found: Session …` into the typed variant. A
//! defensive `JsonRpcError` arm catches the raw form in case a future
//! code path bypasses the conversion.

use crate::acp::error::SerializableAcpError;
use crate::acp::lifecycle::FailureReason;
use crate::acp::types::CanonicalAgentId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ClassifiedResumeFailure {
    pub failure_reason: FailureReason,
}

/// Inspect a structured ACP error returned from `session/load` and pick
/// the canonical [`FailureReason`] for the `ConnectionFailed` envelope.
///
/// `agent_id` is reserved for future provider-specific dispatch (e.g.
/// distinguishing transport errors that mean different things across
/// providers); today the classification is agent-agnostic.
pub(crate) fn classify_resume_error(
    agent_id: &CanonicalAgentId,
    error: &SerializableAcpError,
) -> ClassifiedResumeFailure {
    match error {
        SerializableAcpError::SessionNotFound { .. } => ClassifiedResumeFailure {
            failure_reason: FailureReason::SessionGoneUpstream,
        },
        SerializableAcpError::JsonRpcError { message } => {
            // Defensive fallback: the conversion at `load_session` should
            // have already mapped these to `SessionNotFound`, but if a
            // future code path emits the raw form, we still classify
            // correctly.
            if is_resource_not_found_session(message)
                || is_session_not_found_invalid_params(message)
            {
                ClassifiedResumeFailure {
                    failure_reason: FailureReason::SessionGoneUpstream,
                }
            } else {
                if is_unrecognised_resource_not_found(message) {
                    tracing::warn!(
                        agent = ?agent_id,
                        message = %message,
                        "Unrecognised -32002 Resource not found body at resume boundary; \
                         classifying as ResumeFailed. If this is a session-gone signal, \
                         extend client_errors::is_session_not_found_error."
                    );
                }
                ClassifiedResumeFailure {
                    failure_reason: FailureReason::ResumeFailed,
                }
            }
        }
        _ => ClassifiedResumeFailure {
            failure_reason: FailureReason::ResumeFailed,
        },
    }
}

fn is_session_not_found_invalid_params(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("\"code\":-32602") && lower.contains("session") && lower.contains("not found")
}

fn is_resource_not_found_session(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("\"code\":-32002")
        && lower.contains("resource not found")
        && lower.contains("session")
}

fn is_unrecognised_resource_not_found(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("\"code\":-32002") && !is_resource_not_found_session(message)
}

#[cfg(test)]
mod tests {
    use super::{classify_resume_error, ClassifiedResumeFailure};
    use crate::acp::error::SerializableAcpError;
    use crate::acp::lifecycle::FailureReason;
    use crate::acp::types::CanonicalAgentId;

    fn assert_classified(
        error: &SerializableAcpError,
        agent: &CanonicalAgentId,
        expected: FailureReason,
    ) {
        let ClassifiedResumeFailure { failure_reason } = classify_resume_error(agent, error);
        assert_eq!(failure_reason, expected, "classification mismatch");
    }

    #[test]
    fn typed_session_not_found_classifies_as_session_gone_upstream() {
        let error = SerializableAcpError::SessionNotFound {
            session_id: "1ea29f08-a0ba-4356-99ad-0c09814e88cd".to_string(),
        };
        // Same outcome regardless of provider — taxonomy is agent-agnostic.
        for agent in [
            CanonicalAgentId::Copilot,
            CanonicalAgentId::Cursor,
            CanonicalAgentId::ClaudeCode,
        ] {
            assert_classified(&error, &agent, FailureReason::SessionGoneUpstream);
        }
    }

    #[test]
    fn copilot_raw_resource_not_found_classifies_as_session_gone_upstream() {
        // Defensive arm: catches the case where a future code path emits
        // the raw `-32002` body without going through `load_session`'s
        // conversion.
        let error = SerializableAcpError::JsonRpcError {
            message: "{\"code\":-32002,\"message\":\"Resource not found: Session 1ea29f08\"}"
                .to_string(),
        };
        assert_classified(
            &error,
            &CanonicalAgentId::Copilot,
            FailureReason::SessionGoneUpstream,
        );
    }

    #[test]
    fn raw_session_not_found_invalid_params_classifies_as_session_gone_upstream() {
        let error = SerializableAcpError::JsonRpcError {
            message: "{\"code\":-32602,\"data\":{\"message\":\"Session \\\"abc\\\" not found\"},\"message\":\"Invalid params\"}"
                .to_string(),
        };
        assert_classified(
            &error,
            &CanonicalAgentId::Cursor,
            FailureReason::SessionGoneUpstream,
        );
    }

    #[test]
    fn resource_not_found_for_non_session_resource_does_not_classify_as_session_gone() {
        // -32002 with a different body (e.g. Project) should not collapse
        // to SessionGoneUpstream — it's a different upstream condition.
        let error = SerializableAcpError::JsonRpcError {
            message: "{\"code\":-32002,\"message\":\"Resource not found: Project xyz\"}"
                .to_string(),
        };
        assert_classified(
            &error,
            &CanonicalAgentId::Copilot,
            FailureReason::ResumeFailed,
        );
    }

    #[test]
    fn unrelated_json_rpc_errors_classify_as_resume_failed() {
        let error = SerializableAcpError::JsonRpcError {
            message: "{\"code\":-32000,\"message\":\"Internal error\"}".to_string(),
        };
        assert_classified(
            &error,
            &CanonicalAgentId::Copilot,
            FailureReason::ResumeFailed,
        );
    }

    #[test]
    fn non_json_rpc_errors_classify_as_resume_failed() {
        let error = SerializableAcpError::ClientNotStarted;
        assert_classified(
            &error,
            &CanonicalAgentId::Copilot,
            FailureReason::ResumeFailed,
        );
    }

    #[test]
    fn malformed_json_body_classifies_as_resume_failed_without_panicking() {
        let error = SerializableAcpError::JsonRpcError {
            message: "this is not valid json at all".to_string(),
        };
        assert_classified(
            &error,
            &CanonicalAgentId::Copilot,
            FailureReason::ResumeFailed,
        );
    }
}
