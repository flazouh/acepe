use crate::acp::error::AcpError;
use crate::acp::session_update::{TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource};
use serde_json::Value;

pub(crate) fn is_method_not_found_error(error: &AcpError) -> bool {
    match error {
        AcpError::JsonRpcError(message) => {
            message.contains("\"code\":-32601") || message.contains("Method not found")
        }
        _ => false,
    }
}

pub(crate) fn is_session_not_found_error(error: &AcpError) -> bool {
    match error {
        AcpError::SessionNotFound(_) => true,
        AcpError::JsonRpcError(message) => {
            let lower = message.to_lowercase();
            lower.contains("\"code\":-32602")
                && lower.contains("session")
                && lower.contains("not found")
        }
        _ => false,
    }
}

pub(crate) fn is_low_fd_startup_error(error: &AcpError) -> bool {
    is_low_fd_error_message(&error.to_string())
}

pub(crate) fn is_low_fd_error_message(message: &str) -> bool {
    let message_lower = message.to_lowercase();
    message_lower.contains("low max file descriptors")
        || message_lower.contains("current limit:")
        || message_lower.contains("too many open files")
        || message_lower.contains("emfile")
}

/// Extract structured turn error data from a JSON-RPC error response.
pub(crate) fn extract_turn_error(error: &Value) -> TurnErrorData {
    let message = extract_error_message(error);
    let code = error
        .get("code")
        .and_then(|c| c.as_i64())
        .and_then(|c| i32::try_from(c).ok());
    let kind = classify_turn_error_kind(&message, code);
    let source = classify_turn_error_source(&message);

    TurnErrorData::Structured(TurnErrorInfo {
        message,
        kind,
        code,
        source: Some(source),
    })
}

/// Extract a user-friendly error message from a JSON-RPC error response.
fn extract_error_message(error: &Value) -> String {
    if let Some(data_message) = error
        .get("data")
        .and_then(|d| d.get("message"))
        .and_then(|m| m.as_str())
    {
        return data_message.to_string();
    }

    if let Some(message) = error.get("message").and_then(|m| m.as_str()) {
        return message.to_string();
    }

    serde_json::to_string(error).unwrap_or_else(|_| "Unknown error".to_string())
}

fn classify_turn_error_kind(message: &str, code: Option<i32>) -> TurnErrorKind {
    let message_lower = message.to_lowercase();

    if message_lower.contains("processtransport is not ready")
        || message_lower.contains("process exited")
        || message_lower.contains("process error")
        || matches!(code, Some(-32001))
    {
        return TurnErrorKind::Fatal;
    }

    TurnErrorKind::Recoverable
}

fn classify_turn_error_source(message: &str) -> TurnErrorSource {
    let message_lower = message.to_lowercase();

    if message_lower.contains("processtransport") || message_lower.contains("process") {
        return TurnErrorSource::Process;
    }

    TurnErrorSource::JsonRpc
}

#[cfg(test)]
mod tests {
    use super::{
        extract_turn_error, is_low_fd_error_message, is_low_fd_startup_error,
        is_method_not_found_error, is_session_not_found_error,
    };
    use crate::acp::error::AcpError;
    use crate::acp::session_update::{TurnErrorData, TurnErrorKind};
    use serde_json::json;

    #[test]
    fn detects_method_not_found_error() {
        let error = AcpError::JsonRpcError(
            "{\"code\":-32601,\"message\":\"Method not found\"}".to_string(),
        );
        assert!(is_method_not_found_error(&error));
    }

    #[test]
    fn ignores_non_method_not_found_errors() {
        let error = AcpError::JsonRpcError("{\"code\":-32000}".to_string());
        assert!(!is_method_not_found_error(&error));
    }

    #[test]
    fn detects_session_not_found_error() {
        let error = AcpError::JsonRpcError(
            "{\"code\":-32602,\"data\":{\"message\":\"Session \\\"abc\\\" not found\"},\"message\":\"Invalid params\"}".to_string(),
        );
        assert!(is_session_not_found_error(&error));
    }

    #[test]
    fn ignores_other_invalid_params_errors_for_session_not_found_detector() {
        let error =
            AcpError::JsonRpcError("{\"code\":-32602,\"message\":\"Invalid params\"}".to_string());
        assert!(!is_session_not_found_error(&error));
    }

    #[test]
    fn detects_low_fd_errors_from_agent_message() {
        let error = AcpError::JsonRpcError(
            "Agent process exited unexpectedly:\nerror: An unknown error occurred, possibly due to low max file descriptors (Unexpected)\nCurrent limit: 256".to_string(),
        );

        assert!(is_low_fd_startup_error(&error));
    }

    #[test]
    fn detects_emfile_style_low_fd_errors() {
        assert!(is_low_fd_error_message(
            "spawn failed with EMFILE: too many open files"
        ));
    }

    #[test]
    fn ignores_non_fd_startup_errors() {
        let error = AcpError::JsonRpcError(
            "Agent process exited unexpectedly:\npermission denied".to_string(),
        );

        assert!(!is_low_fd_startup_error(&error));
    }

    #[test]
    fn classifies_process_transport_errors_as_fatal() {
        let error = json!({
            "code": -32000,
            "message": "ProcessTransport is not ready"
        });

        let turn_error = extract_turn_error(&error);

        match turn_error {
            TurnErrorData::Structured(payload) => {
                assert_eq!(payload.kind, TurnErrorKind::Fatal);
                assert_eq!(payload.message, "ProcessTransport is not ready");
            }
            TurnErrorData::Legacy(_) => panic!("Expected structured turn error"),
        }
    }

    #[test]
    fn classifies_rate_limit_errors_as_recoverable() {
        let error = json!({
            "code": -32000,
            "message": "Rate limit exceeded"
        });

        let turn_error = extract_turn_error(&error);

        match turn_error {
            TurnErrorData::Structured(payload) => {
                assert_eq!(payload.kind, TurnErrorKind::Recoverable);
                assert_eq!(payload.message, "Rate limit exceeded");
            }
            TurnErrorData::Legacy(_) => panic!("Expected structured turn error"),
        }
    }
}
