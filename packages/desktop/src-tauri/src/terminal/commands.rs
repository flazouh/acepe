use crate::analytics::{self, AnalyticsEvent};
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
) -> Result<CreateTerminalResponse, String> {
    tracing::info!(
        session_id = %request.session_id,
        command = %request.command,
        "terminal_create called"
    );

    let manager = app.state::<Arc<TerminalManager>>();
    let result = manager.create_terminal(request).await;
    if result.is_ok() {
        analytics::track_event(app.clone(), AnalyticsEvent::TerminalOpened, None);
    }
    result
}

/// Get current output from a terminal
#[tauri::command]
#[specta::specta]
pub async fn terminal_output(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
) -> Result<TerminalOutputResponse, String> {
    tracing::debug!(
        session_id = %session_id,
        terminal_id = %terminal_id,
        "terminal_output called"
    );

    let manager = app.state::<Arc<TerminalManager>>();
    manager.get_output(&terminal_id).await
}

/// Wait for a terminal process to exit
#[tauri::command]
#[specta::specta]
pub async fn terminal_wait_for_exit(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
) -> Result<WaitForExitResponse, String> {
    tracing::debug!(
        session_id = %session_id,
        terminal_id = %terminal_id,
        "terminal_wait_for_exit called"
    );

    let manager = app.state::<Arc<TerminalManager>>();
    manager.wait_for_exit(&terminal_id).await
}

/// Kill a running terminal process
#[tauri::command]
#[specta::specta]
pub async fn terminal_kill(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
) -> Result<(), String> {
    tracing::info!(
        session_id = %session_id,
        terminal_id = %terminal_id,
        "terminal_kill called"
    );

    let manager = app.state::<Arc<TerminalManager>>();
    manager.kill(&terminal_id).await
}

/// Release terminal resources
#[tauri::command]
#[specta::specta]
pub async fn terminal_release(
    app: AppHandle,
    session_id: String,
    terminal_id: String,
) -> Result<(), String> {
    tracing::info!(
        session_id = %session_id,
        terminal_id = %terminal_id,
        "terminal_release called"
    );

    let manager = app.state::<Arc<TerminalManager>>();
    manager.release(&terminal_id).await
}
