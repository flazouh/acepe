//! Tauri commands for Cursor history.
//!
//! These commands are exposed to the TypeScript frontend for
//! loading Cursor conversation history.

use crate::cursor_history::parser;
use crate::session_jsonl::types::{ConvertedSession, FullSession, HistoryEntry};
use uuid::Uuid;
use crate::commands::observability::{
    CommandResult, SerializableCommandError, unexpected_command_result,
};

fn get_logger_id() -> String {
    Uuid::new_v4().to_string()[..8].to_string()
}

/// Get Cursor history entries for the given project paths.
///
/// Scans Cursor's agent transcripts and returns conversation metadata.
/// This is the discovery phase - returns lightweight metadata only.
#[tauri::command]
#[specta::specta]
pub async fn get_cursor_history(
    project_paths: Option<Vec<String>>,
) -> CommandResult<Vec<HistoryEntry>>  {
    unexpected_command_result("get_cursor_history", "Failed to get Cursor history", async {

        let logger_id = get_logger_id();
        let paths = project_paths.unwrap_or_default();

        tracing::info!(
            logger_id = %logger_id,
            project_count = paths.len(),
            "Loading Cursor history"
        );

        // Check if Cursor is installed
        if !parser::is_cursor_installed() {
            tracing::info!(logger_id = %logger_id, "Cursor not installed, returning empty history");
            return Ok(Vec::new());
        }

        // Discover all chat entries
        let chat_entries = parser::discover_all_chats(&paths).await.map_err(|e| {
            tracing::error!(logger_id = %logger_id, error = %e, "Failed to discover Cursor chats");
            e.to_string()
        })?;

        // Convert to HistoryEntry format
        let entries: Vec<HistoryEntry> = chat_entries.iter().map(parser::to_history_entry).collect();

        tracing::info!(
            logger_id = %logger_id,
            conversations_count = entries.len(),
            "Loaded Cursor history"
        );

        Ok(entries)

    }.await)
}

/// Get a full Cursor session with all messages.
///
/// This is the full load phase - returns complete conversation content.
#[tauri::command]
#[specta::specta]
pub async fn get_cursor_session(
    session_id: String,
    project_path: String,
) -> CommandResult<FullSession>  {
    unexpected_command_result("get_cursor_session", "Failed to get Cursor session", async {

        let logger_id = get_logger_id();

        tracing::info!(
            logger_id = %logger_id,
            session_id = %session_id,
            project_path = %project_path,
            "Loading Cursor session"
        );

        let session = parser::load_full_conversation(&session_id, &project_path)
            .await
            .map_err(|e| {
                tracing::error!(
                    logger_id = %logger_id,
                    session_id = %session_id,
                    error = %e,
                    "Failed to load Cursor session"
                );
                e.to_string()
            })?;

        tracing::info!(
            logger_id = %logger_id,
            session_id = %session_id,
            total_messages = session.stats.total_messages,
            user_messages = session.stats.user_messages,
            assistant_messages = session.stats.assistant_messages,
            "Loaded Cursor session"
        );

        Ok(session)

    }.await)
}

/// Get a converted Cursor session with entries ready for display.
///
/// This uses the shared converter to return ConvertedSession format,
/// consistent with Claude Code sessions.
#[tauri::command]
#[specta::specta]
pub async fn get_cursor_converted_session(
    session_id: String,
    project_path: String,
) -> CommandResult<ConvertedSession>  {
    unexpected_command_result("get_cursor_converted_session", "Failed to get converted Cursor session", async {

        let logger_id = get_logger_id();

        tracing::info!(
            logger_id = %logger_id,
            session_id = %session_id,
            project_path = %project_path,
            "Loading and converting Cursor session"
        );

        let full_session = parser::load_full_conversation(&session_id, &project_path)
            .await
            .map_err(|e| {
                let error_msg = format!(
                    "Failed to load Cursor session {} from project {}: {}",
                    session_id, project_path, e
                );
                tracing::error!(
                    logger_id = %logger_id,
                    session_id = %session_id,
                    project_path = %project_path,
                    error = %e,
                    "Failed to load Cursor session"
                );
                error_msg
            })?;

        let converted = crate::session_converter::convert_cursor_full_session_to_entries(&full_session);

        tracing::info!(
            logger_id = %logger_id,
            session_id = %session_id,
            entries_count = converted.entries.len(),
            total_messages = converted.stats.total_messages,
            "Converted Cursor session"
        );

        Ok(converted)

    }.await)
}

/// Check if a project has Cursor history available.
///
/// Returns true if Cursor history exists for the given project path.
#[tauri::command]
#[specta::specta]
pub async fn has_cursor_history(project_path: String) -> CommandResult<bool>  {
    unexpected_command_result("has_cursor_history", "Failed to check Cursor history", async {

        let logger_id = get_logger_id();

        tracing::debug!(
            logger_id = %logger_id,
            project_path = %project_path,
            "Checking for Cursor history"
        );

        let has_history = parser::has_cursor_history(&project_path).await;

        tracing::debug!(
            logger_id = %logger_id,
            project_path = %project_path,
            has_history = has_history,
            "Checked Cursor history"
        );

        Ok(has_history)

    }.await)
}

/// Get a converted Cursor session by searching across all projects.
///
/// This is a fallback command that searches for a session by ID only,
/// without requiring a project path. Useful when the stored project path
/// is incorrect or the session has been moved.
#[tauri::command]
#[specta::specta]
pub async fn get_cursor_converted_session_by_id(
    session_id: String,
) -> CommandResult<ConvertedSession>  {
    let logger_id = get_logger_id();

    tracing::info!(
        logger_id = %logger_id,
        session_id = %session_id,
        "Searching for Cursor session across all projects"
    );

    let full_session = unexpected_command_result(
        "get_cursor_converted_session_by_id",
        "Failed to get Cursor session by ID",
        parser::find_transcript_by_id(&session_id)
            .await
            .map_err(|e| {
                let error_msg = format!("Failed to search for Cursor session {}: {}", session_id, e);
                tracing::error!(
                    logger_id = %logger_id,
                    session_id = %session_id,
                    error = %e,
                    "Failed to find Cursor session"
                );
                error_msg
            }),
    )?
    .ok_or_else(|| {
        let error_msg = format!("Cursor session {} not found in any project", session_id);
        tracing::warn!(
            logger_id = %logger_id,
            session_id = %session_id,
            "Session not found in any project"
        );
        SerializableCommandError::expected("get_cursor_converted_session_by_id", error_msg)
    })?;

    let converted = crate::session_converter::convert_cursor_full_session_to_entries(&full_session);

    tracing::info!(
        logger_id = %logger_id,
        session_id = %session_id,
        found_in_project = %full_session.project_path,
        entries_count = converted.entries.len(),
        total_messages = converted.stats.total_messages,
        "Found and converted Cursor session"
    );

    Ok(converted)
}

/// Check if Cursor is installed on the system.
#[tauri::command]
#[specta::specta]
pub async fn is_cursor_installed() -> CommandResult<bool>  {
    unexpected_command_result("is_cursor_installed", "Failed to check if Cursor is installed", async {

        Ok(parser::is_cursor_installed())

    }.await)
}
