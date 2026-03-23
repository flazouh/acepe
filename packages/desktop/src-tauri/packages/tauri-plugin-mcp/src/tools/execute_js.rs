use serde::{Serialize, Serializer};
use serde_json::Value;
use std::fmt;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime};

use crate::error::Error;
use crate::socket_server::SocketResponse;

// Define a custom error type for JavaScript execution operations
#[derive(Debug)]
pub enum ExecuteJsError {
    WebviewOperation(String),
    JavaScriptError(String),

    Timeout(String),
}

// Implement Display for the error
impl fmt::Display for ExecuteJsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExecuteJsError::WebviewOperation(s) => write!(f, "JavaScript execution error: {}", s),
            ExecuteJsError::JavaScriptError(s) => write!(f, "JavaScript error: {}", s),
            ExecuteJsError::Timeout(s) => write!(f, "Operation timed out: {}", s),
        }
    }
}

// Make the error serializable
impl Serialize for ExecuteJsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// Support conversion from timeout error
impl From<mpsc::RecvTimeoutError> for ExecuteJsError {
    fn from(err: mpsc::RecvTimeoutError) -> Self {
        ExecuteJsError::Timeout(format!(
            "Timeout waiting for JavaScript execution response: {}",
            err
        ))
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ExecuteJsRequest {
    window_label: Option<String>,
    code: String,
    timeout_ms: Option<u64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ExecuteJsResponse {
    result: String,
    #[serde(rename = "type")]
    result_type: String,
}

pub async fn handle_execute_js<R: Runtime>(
    app: &AppHandle<R>,
    payload: Value,
) -> Result<SocketResponse, Error> {
    let request: ExecuteJsRequest = serde_json::from_value(payload)
        .map_err(|e| Error::Anyhow(format!("Invalid payload for executeJs: {}", e)))?;

    // Get the window label or use "main" as default
    let window_label = request
        .window_label
        .clone()
        .unwrap_or_else(|| "main".to_string());

    // Verify the window exists
    let _window = app
        .get_webview_window(&window_label)
        .ok_or_else(|| Error::Anyhow(format!("Window not found: {}", window_label)))?;

    // Execute JavaScript and get the result
    let result = execute_js_in_window(app.clone(), request).await;

    // Handle the result
    match result {
        Ok(response) => {
            // Serialize the response
            let data = serde_json::to_value(response)
                .map_err(|e| Error::Anyhow(format!("Failed to serialize response: {}", e)))?;

            Ok(SocketResponse {
                success: true,
                data: Some(data),
                error: None,
            })
        }
        Err(e) => Ok(SocketResponse {
            success: false,
            data: None,
            error: Some(e.to_string()),
        }),
    }
}

// Helper function to execute JS in a window and await response
async fn execute_js_in_window<R: Runtime>(
    app: AppHandle<R>,
    params: ExecuteJsRequest,
) -> Result<ExecuteJsResponse, ExecuteJsError> {
    // Get window label
    let window_label = params
        .window_label
        .clone()
        .unwrap_or_else(|| "main".to_string());

    // Get timeout or use default (5 seconds)
    let timeout = Duration::from_millis(params.timeout_ms.unwrap_or(5000));

    // Emit event to execute the JavaScript in the specified window
    app.emit_to(&window_label, "execute-js", &params.code)
        .map_err(|e| {
            ExecuteJsError::WebviewOperation(format!("Failed to emit execute-js event: {}", e))
        })?;

    // Set up a channel to receive the response
    let (tx, rx) = mpsc::channel();

    // Listen for response
    app.once("execute-js-response", move |event| {
        let payload = event.payload().to_string();
        let _ = tx.send(payload);
    });

    // Wait for the response with timeout
    match rx.recv_timeout(timeout) {
        Ok(result_string) => {
            // Parse the response JSON
            let response: Value = serde_json::from_str(&result_string).map_err(|e| {
                ExecuteJsError::JavaScriptError(format!("Failed to parse response: {}", e))
            })?;

            // Check if result contains an error
            if let Some(error) = response.get("error") {
                if let Some(error_str) = error.as_str() {
                    return Err(ExecuteJsError::JavaScriptError(error_str.to_string()));
                } else {
                    return Err(ExecuteJsError::JavaScriptError(
                        "Unknown JavaScript execution error".to_string(),
                    ));
                }
            }

            // Build the ExecuteJsResponse
            let result = response
                .get("result")
                .and_then(|r| r.as_str())
                .unwrap_or("[Result could not be stringified]")
                .to_string();

            let result_type = response
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string();

            Ok(ExecuteJsResponse {
                result,
                result_type,
            })
        }
        Err(e) => Err(e.into()),
    }
}
