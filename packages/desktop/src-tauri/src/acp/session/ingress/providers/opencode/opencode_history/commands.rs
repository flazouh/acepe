//! OpenCode history Tauri commands.

use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::acp::client_trait::AgentClient;
use crate::acp::opencode::{OpenCodeHttpClient, OpenCodeManagerRegistry};
use crate::acp::providers::OpenCodeProvider;
use crate::acp::session::delivery::history_load::load_materialized_from_history;
use crate::acp::session::fold_export::{default_session_title, MaterializedThreadSnapshot};
use crate::acp::session_thread_snapshot::ProviderOwnedSessionSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::commands::observability::{unexpected_command_result, CommandResult};
use crate::opencode_history::convert::{
    materialized_thread_snapshot_from_opencode_messages,
    provider_owned_snapshot_from_opencode_messages,
};
use crate::opencode_history::parser;
use crate::path_safety::validate_project_directory_from_str;
use crate::session_jsonl::types::HistoryEntry;

/// Get OpenCode history entries.
///
/// Lists sessions from the index, filtered by project paths.
#[tauri::command]
#[specta::specta]
pub async fn get_opencode_history(
    _db: State<'_, DatabaseConnection>,
    project_paths: Option<Vec<String>>,
) -> CommandResult<Vec<HistoryEntry>> {
    unexpected_command_result(
        "get_opencode_history",
        "Failed to get OpenCode history",
        async {
            let paths = project_paths.unwrap_or_default();
            let entries = parser::scan_sessions(&paths)
                .await
                .map_err(|e| format!("Failed to scan OpenCode sessions: {}", e))?;

            Ok(entries)
        }
        .await,
    )
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

    let provider = Arc::new(OpenCodeProvider);
    let client =
        OpenCodeHttpClient::new(manager, project_key, provider).map_err(|e| e.to_string())?;

    Ok(client)
}

fn resolve_project_root_for_history(project_path: &str) -> Result<std::path::PathBuf, String> {
    validate_project_directory_from_str(project_path)
        .map_err(|error| error.message_for(std::path::Path::new(project_path.trim())))
}

async fn try_load_opencode_materialized_from_disk(
    session_id: &str,
    directory: &str,
) -> Result<Option<MaterializedThreadSnapshot>, String> {
    load_materialized_from_history(&CanonicalAgentId::OpenCode, session_id, directory, None)
        .await
        .map_err(|error| error.to_string())
}

/// Fold-first OpenCode session load: disk ingress, then HTTP fallback.
pub(crate) async fn fetch_materialized_opencode_session(
    app: &AppHandle,
    session_id: &str,
    directory: &str,
) -> Result<MaterializedThreadSnapshot, String> {
    if let Ok(Some(materialized)) =
        try_load_opencode_materialized_from_disk(session_id, directory).await
    {
        return Ok(materialized);
    }

    let mut client = get_or_create_opencode_client(app, directory).await?;

    client
        .start()
        .await
        .map_err(|e| format!("Failed to start OpenCode server: {}", e))?;

    let messages = client
        .get_session_messages(session_id, directory)
        .await
        .map_err(|e| format!("Failed to fetch session messages: {}", e))?;

    Ok(materialized_thread_snapshot_from_opencode_messages(
        session_id,
        directory,
        &messages,
        Some(default_session_title(session_id)),
    ))
}

/// Get full provider-owned OpenCode session via HTTP API (auto-starts server if needed).
///
/// Tries fold-first local disk ingress via [`load_materialized_from_history`],
/// then falls back to HTTP when disk history is missing.
pub(crate) async fn fetch_provider_owned_opencode_session(
    app: &AppHandle,
    session_id: &str,
    directory: &str,
) -> Result<ProviderOwnedSessionSnapshot, String> {
    if let Ok(Some(materialized)) =
        try_load_opencode_materialized_from_disk(session_id, directory).await
    {
        return Ok(
            crate::acp::session::fold_export::provider_owned_snapshot_from_materialized(
                &materialized,
                default_session_title(session_id),
                Vec::new(),
            ),
        );
    }

    let mut client = get_or_create_opencode_client(app, directory).await?;

    client
        .start()
        .await
        .map_err(|e| format!("Failed to start OpenCode server: {}", e))?;

    let messages = client
        .get_session_messages(session_id, directory)
        .await
        .map_err(|e| format!("Failed to fetch session messages: {}", e))?;

    provider_owned_snapshot_from_opencode_messages(session_id, directory, messages, None)
        .map_err(|e| format!("Failed to convert session: {}", e))
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
) -> CommandResult<Vec<HistoryEntry>> {
    unexpected_command_result(
        "get_opencode_sessions_for_project",
        "Failed to get OpenCode sessions for project",
        async {
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
                        pr_link_mode: None,
                        worktree_deleted: None,
                        session_lifecycle_state: Some(
                            crate::db::repository::SessionLifecycleState::Persisted,
                        ),
                        sequence_id: None,
                        usage_stats: None,
                    }
                })
                .collect();

            Ok(entries)
        }
        .await,
    )
}
