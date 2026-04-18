use std::cmp::Reverse;

use crate::acp::types::CanonicalAgentId;
use crate::commands::observability::{unexpected_command_result, CommandResult};
use crate::db::repository::{ProjectRepository, SessionMetadataRepository};
use crate::history::indexer::{IndexStatus, IndexerHandle};
use crate::session_jsonl::cache;
use crate::session_jsonl::parser;
use crate::session_jsonl::types::{ConvertedSession, FullSession, HistoryEntry, SessionMessage};
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

fn get_logger_id() -> String {
    Uuid::new_v4().to_string()[..8].to_string()
}

/// Get database connection from app state
fn get_db(app: &AppHandle) -> State<'_, DbConn> {
    app.state::<DbConn>()
}

/// Get session history entries from SQLite index (jsonl-backed).
///
/// This is the optimized entry point for thread listing:
/// 1. Gets all projects from the database
/// 2. Queries session_metadata for those projects (fast SQLite query)
/// 3. Falls back to file scanning if index is empty (with auto-indexing trigger)
///
/// Performance: ~10-50ms vs 800-2000ms for file scanning
#[tauri::command]
#[specta::specta]
pub async fn get_session_history(app: AppHandle) -> CommandResult<Vec<HistoryEntry>> {
    unexpected_command_result("get_session_history", "Failed to get session history", async {

        let logger_id = get_logger_id();
        let start = std::time::Instant::now();
        tracing::info!(logger_id = %logger_id, "Loading conversations from index");

        let db = get_db(&app);

        // Get all projects from database
        let db_projects = ProjectRepository::get_all(&db).await.map_err(|e| {
            tracing::error!(logger_id = %logger_id, error = %e, "Failed to get projects");
            e.to_string()
        })?;

        let project_paths: Vec<String> = db_projects.iter().map(|p| p.path.clone()).collect();

        tracing::info!(logger_id = %logger_id, projects_count = project_paths.len(), "Found projects in database");

        // If no projects in database, return empty list
        if project_paths.is_empty() {
            tracing::info!(logger_id = %logger_id, "No projects in database, returning empty history");
            return Ok(Vec::new());
        }

        // Query from SQLite index (fast path)
        let indexed_sessions = SessionMetadataRepository::get_for_projects(&db, &project_paths)
            .await
            .map_err(|e| e.to_string())?;

        if indexed_sessions.is_empty() {
            // Index might be empty (first run or corrupted)
            // Trigger background indexing and fall back to file scan
            tracing::info!(logger_id = %logger_id, "Index empty, triggering background indexing and falling back to file scan");

            // Trigger async indexing if indexer is available
            if let Some(indexer) = app.try_state::<IndexerHandle>() {
                let indexer_clone = indexer.inner().clone();
                let paths_clone = project_paths.clone();
                tokio::spawn(async move {
                    if let Err(e) = indexer_clone.full_scan(paths_clone).await {
                        tracing::error!(error = %e, "Background indexing failed");
                    }
                });
            }

            // Fall back to file scanning for this request
            let mut all_entries = parser::scan_projects(&project_paths)
                .await
                .map_err(|e| e.to_string())?;
            all_entries.sort_by_key(|entry| Reverse(entry.timestamp));

            let duration_ms = start.elapsed().as_millis();
            tracing::info!(
                logger_id = %logger_id,
                conversations_count = all_entries.len(),
                duration_ms = duration_ms,
                source = "files",
                "Loaded conversations (fallback to file scan)"
            );

            return Ok(all_entries);
        }

        // Convert indexed sessions to HistoryEntry (already sorted by timestamp DESC)
        let entries: Vec<HistoryEntry> = indexed_sessions
            .into_iter()
            .map(|s| {
                let session_lifecycle_state = s.lifecycle_state();

                HistoryEntry {
                    id: s.id.clone(),
                    display: s.display,
                    timestamp: s.timestamp,
                    project: s.project_path,
                    session_id: s.id,
                    pasted_contents: serde_json::json!({}),
                    agent_id: CanonicalAgentId::parse(&s.agent_id), // Convert from DB string to enum
                    updated_at: s.timestamp,
                    source_path: None, // Claude Code sessions are found via JSONL path convention
                    parent_id: None,
                    worktree_path: s.worktree_path,
                    pr_number: None,
                    worktree_deleted: None,
                    session_lifecycle_state: Some(session_lifecycle_state),
                    sequence_id: s.sequence_id,
                }
            })
            .collect();

        let duration_ms = start.elapsed().as_millis();
        tracing::info!(
            logger_id = %logger_id,
            conversations_count = entries.len(),
            projects_count = project_paths.len(),
            duration_ms = duration_ms,
            source = "index",
            "Loaded conversations from index"
        );

        Ok(entries)

    }.await)
}

/// Get current session indexing status.
///
/// Returns the status of the background indexer: Idle, Indexing (with progress),
/// Ready (with session count), or Error.
#[tauri::command]
#[specta::specta]
pub async fn get_index_status(app: AppHandle) -> CommandResult<IndexStatus> {
    unexpected_command_result(
        "get_index_status",
        "Failed to get index status",
        async {
            if let Some(indexer) = app.try_state::<IndexerHandle>() {
                indexer.get_status().await.map_err(|e| e.to_string())
            } else {
                Ok(IndexStatus::Idle)
            }
        }
        .await,
    )
}

/// Force re-index all sessions.
///
/// Triggers a full scan of all project directories and rebuilds the index.
/// This runs in the background and returns immediately.
#[tauri::command]
#[specta::specta]
pub async fn reindex_sessions(app: AppHandle) -> CommandResult<()> {
    unexpected_command_result(
        "reindex_sessions",
        "Failed to reindex sessions",
        async {
            let logger_id = get_logger_id();
            tracing::info!(logger_id = %logger_id, "Manual reindex triggered");

            let db = get_db(&app);
            let db_projects = ProjectRepository::get_all(&db)
                .await
                .map_err(|e| e.to_string())?;

            let project_paths: Vec<String> = db_projects.iter().map(|p| p.path.clone()).collect();

            if let Some(indexer) = app.try_state::<IndexerHandle>() {
                let indexer_clone = indexer.inner().clone();
                tokio::spawn(async move {
                    if let Err(e) = indexer_clone.full_scan(project_paths).await {
                        tracing::error!(error = %e, "Manual reindex failed");
                    }
                });
            }

            Ok(())
        }
        .await,
    )
}

#[cfg(test)]
mod tests {
    // Note: test_get_session_history removed - requires AppHandle which is complex to mock
    // Use integration tests or test parser functions directly instead
}

#[tauri::command]
#[specta::specta]
pub async fn get_session_messages(
    session_id: String,
    project_path: String,
) -> CommandResult<Vec<SessionMessage>> {
    unexpected_command_result(
        "get_session_messages",
        "Failed to get session messages",
        async {
            let logger_id = get_logger_id();
            tracing::info!(
                logger_id = %logger_id,
                session_id = %session_id,
                project_path = %project_path,
                "Loading session messages"
            );

            let result = parser::read_session_messages(&session_id, &project_path)
                .await
                .map_err(|e| {
                    tracing::error!(
                        logger_id = %logger_id,
                        session_id = %session_id,
                        error = %e,
                        "Failed to load session messages"
                    );
                    e.to_string()
                })?;

            tracing::info!(
                logger_id = %logger_id,
                messages_count = result.len(),
                session_id = %session_id,
                "Loaded messages for session"
            );
            Ok(result)
        }
        .await,
    )
}

/// Get full session data with ordered messages, thinking blocks, tool calls, and stats.
/// This is the comprehensive parser that extracts all conversation data from a Claude session.
#[tauri::command]
#[specta::specta]
pub async fn get_full_session(
    session_id: String,
    project_path: String,
) -> CommandResult<FullSession> {
    unexpected_command_result(
        "get_full_session",
        "Failed to get full session",
        async {
            let logger_id = get_logger_id();
            tracing::info!(
                logger_id = %logger_id,
                session_id = %session_id,
                project_path = %project_path,
                "Parsing full session"
            );

            let result = parser::parse_full_session(&session_id, &project_path)
                .await
                .map_err(|e| {
                    tracing::error!(
                        logger_id = %logger_id,
                        session_id = %session_id,
                        error = %e,
                        "Failed to parse full session"
                    );
                    e.to_string()
                })?;

            tracing::info!(
                logger_id = %logger_id,
                total_messages = result.stats.total_messages,
                user_messages = result.stats.user_messages,
                assistant_messages = result.stats.assistant_messages,
                tool_uses = result.stats.tool_uses,
                thinking_blocks = result.stats.thinking_blocks,
                "Parsed session"
            );

            Ok(result)
        }
        .await,
    )
}

/// Get converted session data with pre-converted entries.
/// This is the optimized version that moves conversion from JavaScript to Rust.
/// Returns entries ready for display without further client-side processing.
#[tauri::command]
#[specta::specta]
pub async fn get_converted_session(
    session_id: String,
    project_path: String,
) -> CommandResult<ConvertedSession> {
    unexpected_command_result(
        "get_converted_session",
        "Failed to get converted session",
        async {
            let logger_id = get_logger_id();
            tracing::info!(
                logger_id = %logger_id,
                session_id = %session_id,
                project_path = %project_path,
                "Parsing and converting session"
            );

            // Parse full session and convert using shared converter
            let full_session = parser::parse_full_session(&session_id, &project_path)
                .await
                .map_err(|e| {
                    tracing::error!(
                        logger_id = %logger_id,
                        session_id = %session_id,
                        error = %e,
                        "Failed to parse session"
                    );
                    e.to_string()
                })?;

            let result =
                crate::session_converter::convert_claude_full_session_to_entries(&full_session);

            tracing::info!(
                logger_id = %logger_id,
                entries_count = result.entries.len(),
                total_messages = result.stats.total_messages,
                "Parsed and converted session"
            );

            Ok(result)
        }
        .await,
    )
}

/// Cache statistics for monitoring performance.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatsResponse {
    /// Number of cache hits (file unchanged since last check).
    pub hits: usize,
    /// Number of cache misses (file changed or new).
    pub misses: usize,
    /// Number of files returned from TTL cache without checking mtime.
    pub ttl_skips: usize,
    /// Number of entries evicted from cache (deleted files).
    pub evictions: usize,
    /// Number of entries currently in cache.
    pub cached_entries: usize,
    /// Cache hit rate as a percentage.
    pub hit_rate: f64,
}

/// Get cache statistics for monitoring.
///
/// Returns statistics about cache performance including hit rate,
/// which helps diagnose caching effectiveness.
#[tauri::command]
#[specta::specta]
pub async fn get_cache_stats() -> CommandResult<CacheStatsResponse> {
    unexpected_command_result(
        "get_cache_stats",
        "Failed to get cache stats",
        async {
            let cache = cache::get_cache();
            let stats = cache.get_stats();
            let total = stats.hits + stats.misses;
            let hit_rate = if total > 0 {
                stats.hits as f64 / total as f64 * 100.0
            } else {
                0.0
            };

            Ok(CacheStatsResponse {
                hits: stats.hits,
                misses: stats.misses,
                ttl_skips: stats.ttl_skips,
                evictions: stats.evictions,
                cached_entries: cache.len().await,
                hit_rate,
            })
        }
        .await,
    )
}

/// Invalidate the file metadata cache.
///
/// Forces the next history load to re-scan all files from disk.
/// Use this when you know files have changed externally.
#[tauri::command]
#[specta::specta]
pub async fn invalidate_history_cache() -> CommandResult<()> {
    unexpected_command_result(
        "invalidate_history_cache",
        "Failed to invalidate history cache",
        async {
            let logger_id = get_logger_id();
            tracing::info!(logger_id = %logger_id, "Invalidating history cache");

            cache::invalidate_cache().await;

            tracing::info!(logger_id = %logger_id, "History cache invalidated");
            Ok(())
        }
        .await,
    )
}

/// Reset cache statistics.
///
/// Clears the hit/miss counters to start fresh monitoring.
#[tauri::command]
#[specta::specta]
pub async fn reset_cache_stats() -> CommandResult<()> {
    unexpected_command_result(
        "reset_cache_stats",
        "Failed to reset cache stats",
        async {
            cache::get_cache().reset_stats();
            Ok(())
        }
        .await,
    )
}
