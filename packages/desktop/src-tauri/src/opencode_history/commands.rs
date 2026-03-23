//! OpenCode history Tauri commands.

use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::acp::client_trait::AgentClient;
use crate::acp::opencode::{OpenCodeHttpClient, OpenCodeManagerRegistry};
use crate::opencode_history::parser;
use crate::path_safety::validate_project_directory_from_str;
use crate::session_converter;
use crate::session_jsonl::types::{ConvertedSession, HistoryEntry};

/// Get OpenCode history entries.
///
/// Lists sessions from the index, filtered by project paths.
#[tauri::command]
#[specta::specta]
pub async fn get_opencode_history(
    _db: State<'_, DatabaseConnection>,
    project_paths: Option<Vec<String>>,
) -> Result<Vec<HistoryEntry>, String> {
    let paths = project_paths.unwrap_or_default();
    let entries = parser::scan_sessions(&paths)
        .await
        .map_err(|e| format!("Failed to scan OpenCode sessions: {}", e))?;

    Ok(entries)
}

/// Get or create OpenCode HTTP client.
///
/// This helper function gets the OpenCode manager from app state
/// and creates a new HTTP client for session loading.
async fn get_or_create_opencode_client(
    app: &AppHandle,
    project_path: &str,
) -> Result<OpenCodeHttpClient, String> {
    let registry: State<'_, Arc<OpenCodeManagerRegistry>> = app
        .try_state()
        .ok_or_else(|| "OpenCodeManagerRegistry not found in app state".to_string())?;
    let resolved_project_root = resolve_project_root_for_history(project_path)?;

    let (project_key, manager) = registry
        .get_or_start(&resolved_project_root)
        .await
        .map_err(|e| format!("Failed to get OpenCode manager: {}", e))?;

    let client = OpenCodeHttpClient::new(manager, project_key).map_err(|e| e.to_string())?;

    Ok(client)
}

fn resolve_project_root_for_history(project_path: &str) -> Result<std::path::PathBuf, String> {
    validate_project_directory_from_str(project_path)
        .map_err(|error| error.message_for(std::path::Path::new(project_path.trim())))
}

/// Get full OpenCode session via HTTP API (auto-starts server if needed).
///
/// This command:
/// 1. Gets or creates OpenCodeHttpClient
/// 2. Ensures OpenCode server is running (auto-start)
/// 3. Fetches session messages via HTTP API
/// 4. Converts to unified format
#[tauri::command]
#[specta::specta]
pub async fn get_opencode_session(
    app: AppHandle,
    session_id: String,
    directory: String,
) -> Result<ConvertedSession, String> {
    // Get or create OpenCode HTTP client
    let mut client = get_or_create_opencode_client(&app, &directory).await?;

    // Ensure OpenCode server is running (auto-start)
    client
        .start()
        .await
        .map_err(|e| format!("Failed to start OpenCode server: {}", e))?;

    // Fetch session messages via HTTP API
    let messages = client
        .get_session_messages(&session_id, &directory)
        .await
        .map_err(|e| format!("Failed to fetch session messages: {}", e))?;

    // Convert to unified format
    let converted = session_converter::convert_opencode_messages_to_session(messages)
        .map_err(|e| format!("Failed to convert session: {}", e))?;

    Ok(converted)
}

/// Get converted OpenCode session (alias for get_opencode_session).
///
/// This is a convenience command that calls get_opencode_session.
#[tauri::command]
#[specta::specta]
pub async fn get_opencode_converted_session(
    app: AppHandle,
    session_id: String,
    directory: String,
) -> Result<ConvertedSession, String> {
    get_opencode_session(app, session_id, directory).await
}

/// Get OpenCode sessions for a specific project via HTTP API.
///
/// This command:
/// 1. Gets the OpenCodeManager from app state
/// 2. Creates an HTTP client
/// 3. Calls list_sessions with the project_path as directory filter
/// 4. Maps each OpenCodeSession to HistoryEntry
/// 5. Returns the list of history entries
#[tauri::command]
#[specta::specta]
pub async fn get_opencode_sessions_for_project(
    app: AppHandle,
    project_path: String,
) -> Result<Vec<HistoryEntry>, String> {
    use crate::acp::types::CanonicalAgentId;
    use uuid::Uuid;

    // Get or create OpenCode HTTP client
    let mut client = get_or_create_opencode_client(&app, &project_path).await?;

    // Ensure OpenCode server is running (auto-start)
    client
        .start()
        .await
        .map_err(|e| format!("Failed to start OpenCode server: {}", e))?;

    // Fetch sessions for the project via HTTP API
    let sessions = client
        .list_sessions(Some(project_path.clone()))
        .await
        .map_err(|e| format!("Failed to fetch sessions for project: {}", e))?;

    // Convert sessions to HistoryEntry format
    let entries: Vec<HistoryEntry> = sessions
        .iter()
        .map(|session| {
            let display = session.title.clone().unwrap_or_else(|| {
                let id_preview = session.id.chars().take(8).collect::<String>();
                format!("Session {}", id_preview)
            });

            HistoryEntry {
                id: Uuid::new_v5(&Uuid::NAMESPACE_URL, session.id.as_bytes()).to_string(),
                display,
                timestamp: session.time.created,
                project: project_path.clone(),
                session_id: session.id.clone(),
                pasted_contents: serde_json::json!({}),
                agent_id: CanonicalAgentId::OpenCode,
                updated_at: session.time.updated,
                source_path: None,
                parent_id: session.parent_id.clone(),
                worktree_path: None,
                pr_number: None,
                worktree_deleted: None,
            }
        })
        .collect();

    Ok(entries)
}
