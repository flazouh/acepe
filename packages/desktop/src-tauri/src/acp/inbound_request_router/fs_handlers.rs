use crate::acp::commands::{acp_read_text_file, acp_write_text_file};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::helpers::{invalid_params, parse_params, request_error};
use super::types::{FsReadTextFileParamsRaw, FsWriteTextFileParamsRaw};
use super::InboundRoutingDecision;

pub(super) async fn handle_fs_read_text_file(params: &Value) -> InboundRoutingDecision {
    let parsed: FsReadTextFileParamsRaw = match parse_params(params)
        .map_err(|_| invalid_params("Invalid params: sessionId and path required"))
    {
        Ok(parsed) => parsed,
        Err(error_decision) => return error_decision,
    };

    let _session_id = match parsed.session_id {
        Some(session_id) => session_id,
        None => return invalid_params("Invalid params: sessionId and path required"),
    };
    let path = match parsed.path {
        Some(path) => path,
        None => return invalid_params("Invalid params: sessionId and path required"),
    };

    match acp_read_text_file(path, parsed.line, parsed.limit).await {
        Ok(content) => InboundRoutingDecision::Handle(json!({ "content": content })),
        Err(error) => request_error(error.to_string()),
    }
}

pub(super) async fn handle_fs_write_text_file(
    app_handle: Option<&AppHandle>,
    params: &Value,
) -> InboundRoutingDecision {
    let parsed: FsWriteTextFileParamsRaw = match parse_params(params)
        .map_err(|_| invalid_params("Invalid params: sessionId, path, and content required"))
    {
        Ok(parsed) => parsed,
        Err(error_decision) => return error_decision,
    };

    let session_id = match parsed.session_id {
        Some(session_id) => session_id,
        None => return invalid_params("Invalid params: sessionId, path, and content required"),
    };
    let path = match parsed.path {
        Some(path) => path,
        None => return invalid_params("Invalid params: sessionId, path, and content required"),
    };
    let content = match parsed.content {
        Some(content) => content,
        None => return invalid_params("Invalid params: sessionId, path, and content required"),
    };
    let app_handle = match app_handle {
        Some(app_handle) => app_handle.clone(),
        None => {
            return request_error(
                "App handle unavailable for session-scoped file writes".to_string(),
            )
        }
    };

    match acp_write_text_file(app_handle, path, content, session_id).await {
        Ok(()) => InboundRoutingDecision::Handle(json!({})),
        Err(error) => request_error(error.to_string()),
    }
}
