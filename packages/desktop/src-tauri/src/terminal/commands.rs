use crate::commands::observability::{CommandResult, unexpected_command_result};
use crate::terminal::manager::TerminalManager;
use crate::terminal::types::{
    CreateTerminalRequest, CreateTerminalResponse, TerminalOutputResponse, WaitForExitResponse,
};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

/// Create a new terminal and execute a command
#[tauri::command]
#[specta::specta]
pub async fn terminal_create(
    app: AppHandle,
    request: CreateTerminalRequest,
) -> CommandResult<CreateTerminalResponse> {
    unexpected_command_result("terminal_create", "Failed to create terminal", async {
        tracing::info!(
            session_id = %request.session_id,
            command = %request.command,
            "terminal_create called"
        );

        let manager = app.state::<Arc<TerminalManager>>();
        let result = manager.create_terminal(request).await;
        result
    }.await)
}

/// Get current output from a terminal
#[tauri::command]
#[specta::specta]
pub async fn terminal_output(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
) -> CommandResult<TerminalOutputResponse> {
    unexpected_command_result("terminal_output", "Failed to get terminal output", async {
        tracing::debug!(
            session_id = %session_id,
            terminal_id = %terminal_id,
            "terminal_output called"
        );

        let manager = app.state::<Arc<TerminalManager>>();
        manager.get_output(&terminal_id).await
    }.await)
}

/// Wait for a terminal process to exit
#[tauri::command]
#[specta::specta]
pub async fn terminal_wait_for_exit(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
) -> CommandResult<WaitForExitResponse> {
    unexpected_command_result("terminal_wait_for_exit", "Failed to wait for terminal exit", async {
        tracing::debug!(
            session_id = %session_id,
            terminal_id = %terminal_id,
            "terminal_wait_for_exit called"
        );

        let manager = app.state::<Arc<TerminalManager>>();
        manager.wait_for_exit(&terminal_id).await
    }.await)
}

/// Kill a running terminal process
#[tauri::command]
#[specta::specta]
pub async fn terminal_kill(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
) -> CommandResult<()> {
    unexpected_command_result("terminal_kill", "Failed to kill terminal", async {
        tracing::info!(
            session_id = %session_id,
            terminal_id = %terminal_id,
            "terminal_kill called"
        );

        let manager = app.state::<Arc<TerminalManager>>();
        manager.kill(&terminal_id).await
    }.await)
}

/// Release terminal resources
#[tauri::command]
#[specta::specta]
pub async fn terminal_release(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
) -> CommandResult<()> {
    unexpected_command_result("terminal_release", "Failed to release terminal", async {
        tracing::info!(
            session_id = %session_id,
            terminal_id = %terminal_id,
            "terminal_release called"
        );

        let manager = app.state::<Arc<TerminalManager>>();
        manager.release(&terminal_id).await
    }.await)
}
