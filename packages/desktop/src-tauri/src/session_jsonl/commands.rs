use crate::commands::observability::{unexpected_command_result, CommandResult};
use crate::db::repository::ProjectRepository;
use crate::history::indexer::{IndexStatus, IndexerHandle};
use crate::session_jsonl::cache;
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
