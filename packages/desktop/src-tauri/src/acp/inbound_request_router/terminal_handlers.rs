use crate::terminal::commands::{
    terminal_create, terminal_kill, terminal_output, terminal_release, terminal_wait_for_exit,
};
use crate::terminal::types::CreateTerminalRequest;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::helpers::{
    invalid_params, parse_params, parse_terminal_request_params, request_error, terminal_app_handle,
};
use super::types::TerminalCreateParamsRaw;
use super::InboundRoutingDecision;

pub(super) async fn handle_terminal_create(
    app_handle: Option<&AppHandle>,
    params: &Value,
) -> InboundRoutingDecision {
    let parsed: TerminalCreateParamsRaw = match parse_params(params)
        .map_err(|_| invalid_params("Invalid params: sessionId, command, and cwd required"))
    {
        Ok(parsed) => parsed,
        Err(error_decision) => return error_decision,
    };

    let session_id = match parsed.session_id {
        Some(session_id) => session_id,
        None => return invalid_params("Invalid params: sessionId, command, and cwd required"),
    };
    let command = match parsed.command {
        Some(command) => command,
        None => return invalid_params("Invalid params: sessionId, command, and cwd required"),
    };
    let cwd = match parsed.cwd {
        Some(cwd) if !cwd.trim().is_empty() => cwd,
        _ => return invalid_params("Invalid params: sessionId, command, and cwd required"),
    };

    let app = match terminal_app_handle(app_handle) {
        Ok(app) => app,
        Err(error_decision) => return error_decision,
    };

    let request = CreateTerminalRequest {
        session_id,
        command,
        args: parsed.args,
        cwd: Some(cwd),
        env: parsed.env,
        output_byte_limit: parsed.output_byte_limit,
    };

    match terminal_create(app, request).await {
        Ok(result) => match serde_json::to_value(result) {
            Ok(value) => InboundRoutingDecision::Handle(value),
            Err(error) => request_error(format!(
                "Failed to serialize terminal/create result: {error}"
            )),
        },
        Err(error) => request_error(error.message),
    }
}

pub(super) async fn handle_terminal_output(
    app_handle: Option<&AppHandle>,
    params: &Value,
) -> InboundRoutingDecision {
    let app = match terminal_app_handle(app_handle) {
        Ok(app) => app,
        Err(error_decision) => return error_decision,
    };

    let (session_id, terminal_id) = match parse_terminal_request_params(params) {
        Ok(tuple) => tuple,
        Err(error_decision) => return error_decision,
    };

    match terminal_output(app, session_id, terminal_id).await {
        Ok(result) => match serde_json::to_value(result) {
            Ok(value) => InboundRoutingDecision::Handle(value),
            Err(error) => request_error(format!(
                "Failed to serialize terminal/output result: {error}"
            )),
        },
        Err(error) => request_error(error.message),
    }
}

pub(super) async fn handle_terminal_wait_for_exit(
    app_handle: Option<&AppHandle>,
    params: &Value,
) -> InboundRoutingDecision {
    let app = match terminal_app_handle(app_handle) {
        Ok(app) => app,
        Err(error_decision) => return error_decision,
    };

    let (session_id, terminal_id) = match parse_terminal_request_params(params) {
        Ok(tuple) => tuple,
        Err(error_decision) => return error_decision,
    };

    match terminal_wait_for_exit(app, session_id, terminal_id).await {
        Ok(result) => match serde_json::to_value(result) {
            Ok(value) => InboundRoutingDecision::Handle(value),
            Err(error) => request_error(format!(
                "Failed to serialize terminal/wait_for_exit result: {error}"
            )),
        },
        Err(error) => request_error(error.message),
    }
}

pub(super) async fn handle_terminal_kill(
    app_handle: Option<&AppHandle>,
    params: &Value,
) -> InboundRoutingDecision {
    let app = match terminal_app_handle(app_handle) {
        Ok(app) => app,
        Err(error_decision) => return error_decision,
    };

    let (session_id, terminal_id) = match parse_terminal_request_params(params) {
        Ok(tuple) => tuple,
        Err(error_decision) => return error_decision,
    };

    match terminal_kill(app, session_id, terminal_id).await {
        Ok(()) => InboundRoutingDecision::Handle(json!({})),
        Err(error) => request_error(error.message),
    }
}

pub(super) async fn handle_terminal_release(
    app_handle: Option<&AppHandle>,
    params: &Value,
) -> InboundRoutingDecision {
    let app = match terminal_app_handle(app_handle) {
        Ok(app) => app,
        Err(error_decision) => return error_decision,
    };

    let (session_id, terminal_id) = match parse_terminal_request_params(params) {
        Ok(tuple) => tuple,
        Err(error_decision) => return error_decision,
    };

    match terminal_release(app, session_id, terminal_id).await {
        Ok(()) => InboundRoutingDecision::Handle(json!({})),
        Err(error) => request_error(error.message),
    }
}
