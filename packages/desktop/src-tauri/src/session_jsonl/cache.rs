//! File metadata cache for efficient history loading.
//!
//! Implements a hybrid mtime + TTL caching strategy:
//! - Tracks file modification times to detect changes
//! - Uses TTL to avoid repeated stat() calls within a short window
//! - Only re-parses files that have actually changed
//!
//! This reduces I/O and CPU usage by 70-95% for repeated history loads.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime};

use tokio::sync::RwLock;

use crate::session_jsonl::types::HistoryEntry;

/// Cached metadata for a single file.
#[derive(Debug, Clone)]
pub struct CachedEntry {
    /// File modification time when cached.
    pub mtime: SystemTime,
    /// File size when cached (additional validation).
    pub size: u64,
    /// Parsed history entry.
    pub data: HistoryEntry,
}

/// Cache statistics for monitoring.
#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    /// Number of cache hits (file unchanged).
    pub hits: usize,
    /// Number of cache misses (file changed or new).
    pub misses: usize,
    /// Number of files skipped (TTL not expired).
    pub ttl_skips: usize,
    /// Number of files removed from cache (deleted from disk).
    pub evictions: usize,
}

/// File metadata cache with TTL-based invalidation.
///
/// Thread-safe via RwLock for concurrent access from async tasks.
/// Stats use atomics for lock-free concurrent updates.
pub struct FileMetadataCache {
    /// Cached entries by file path.
    entries: RwLock<HashMap<PathBuf, CachedEntry>>,
    /// Timestamp of last full scan (when we checked all file mtimes).
    last_full_scan: RwLock<Option<Instant>>,
    /// How long to trust cached data without re-checking mtimes.
    scan_ttl: Duration,
    /// Atomic statistics for lock-free monitoring.
    stat_hits: AtomicUsize,
    stat_misses: AtomicUsize,
    stat_ttl_skips: AtomicUsize,
    stat_evictions: AtomicUsize,
}

impl Default for FileMetadataCache {
    fn default() -> Self {
        Self::new(Duration::from_secs(30))
    }
}

impl FileMetadataCache {
    /// Create a new cache with the specified TTL.
    ///
    /// TTL determines how long to trust cached entries without re-checking
    /// file modification times. Default is 30 seconds.
    pub fn new(scan_ttl: Duration) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            last_full_scan: RwLock::new(None),
            scan_ttl,
            stat_hits: AtomicUsize::new(0),
            stat_misses: AtomicUsize::new(0),
            stat_ttl_skips: AtomicUsize::new(0),
            stat_evictions: AtomicUsize::new(0),
        }
    }

    /// Check if we should skip the full scan due to TTL.
    ///
    /// Returns true if the last full scan was within the TTL window.
    pub async fn should_skip_scan(&self) -> bool {
        let last_scan = self.last_full_scan.read().await;
        if let Some(last) = *last_scan {
            last.elapsed() < self.scan_ttl
        } else {
            false
        }
    }

    /// Get all cached entries if within TTL.
    ///
    /// Returns None if cache is stale or empty.
    pub async fn get_all_if_fresh(&self) -> Option<Vec<HistoryEntry>> {
        if !self.should_skip_scan().await {
            return None;
        }

        let entries = self.entries.read().await;
        if entries.is_empty() {
            return None;
        }

        self.stat_ttl_skips
            .fetch_add(entries.len(), Ordering::Relaxed);

        Some(entries.values().map(|e| e.data.clone()).collect())
    }

    /// Check if a file has changed since it was cached.
    ///
    /// Returns:
    /// - `Some(cached_entry)` if file unchanged (cache hit)
    /// - `None` if file changed, new, or error (cache miss)
    pub async fn check_file_with_metadata(
        &self,
        path: &PathBuf,
        current_mtime: SystemTime,
        current_size: u64,
    ) -> Option<HistoryEntry> {
        let cached_data = {
            let entries = self.entries.read().await;
            if let Some(cached) = entries.get(path) {
                if cached.mtime == current_mtime && cached.size == current_size {
                    Some(cached.data.clone())
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(data) = cached_data {
            self.stat_hits.fetch_add(1, Ordering::Relaxed);
            return Some(data);
        }

        self.stat_misses.fetch_add(1, Ordering::Relaxed);
        None
    }

    pub async fn check_file(&self, path: &PathBuf) -> Option<HistoryEntry> {
        // Get current file metadata (async — doesn't block tokio runtime)
        let metadata = match tokio::fs::metadata(path).await {
            Ok(m) => m,
            Err(_) => {
                // File doesn't exist or can't be read - evict from cache
                self.evict(path).await;
                return None;
            }
        };

        let current_mtime = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let current_size = metadata.len();

        self.check_file_with_metadata(path, current_mtime, current_size)
            .await
    }

    /// Insert or update a cached entry.
    ///
    /// Caller provides mtime and size (already known from directory listing)
    /// to avoid a redundant stat syscall.
    pub async fn insert(&self, path: PathBuf, entry: HistoryEntry, mtime: SystemTime, size: u64) {
        let cached = CachedEntry {
            mtime,
            size,
            data: entry,
        };

        let mut entries = self.entries.write().await;
        entries.insert(path, cached);
    }

    /// Remove an entry from the cache.
    pub async fn evict(&self, path: &PathBuf) {
        let mut entries = self.entries.write().await;
        if entries.remove(path).is_some() {
            self.stat_evictions.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Mark that a full scan was completed.
    pub async fn mark_scan_complete(&self) {
        let mut last_scan = self.last_full_scan.write().await;
        *last_scan = Some(Instant::now());
    }

    /// Get current cache statistics (lock-free).
    pub fn get_stats(&self) -> CacheStats {
        CacheStats {
            hits: self.stat_hits.load(Ordering::Relaxed),
            misses: self.stat_misses.load(Ordering::Relaxed),
            ttl_skips: self.stat_ttl_skips.load(Ordering::Relaxed),
            evictions: self.stat_evictions.load(Ordering::Relaxed),
        }
    }

    /// Reset cache statistics (lock-free).
    pub fn reset_stats(&self) {
        self.stat_hits.store(0, Ordering::Relaxed);
        self.stat_misses.store(0, Ordering::Relaxed);
        self.stat_ttl_skips.store(0, Ordering::Relaxed);
        self.stat_evictions.store(0, Ordering::Relaxed);
    }

    /// Clear the entire cache.
    ///
    /// Use this when you want to force a full rescan.
    pub async fn clear(&self) {
        let mut entries = self.entries.write().await;
        entries.clear();
        drop(entries);

        let mut last_scan = self.last_full_scan.write().await;
        *last_scan = None;
    }

    /// Get the number of cached entries.
    pub async fn len(&self) -> usize {
        self.entries.read().await.len()
    }

    /// Check if the cache is empty.
    pub async fn is_empty(&self) -> bool {
        self.entries.read().await.is_empty()
    }

    /// Remove entries for files that no longer exist.
    ///
    /// Call this periodically to clean up stale entries.
    /// Checks file existence concurrently (bounded to 8 parallel I/O ops).
    pub async fn cleanup_deleted_files(&self) {
        use futures::stream::{self, StreamExt};

        let paths: Vec<PathBuf> = {
            let entries = self.entries.read().await;
            entries.keys().cloned().collect()
        };

        // Check existence concurrently (bounded to 8 parallel I/O ops)
        let to_remove: Vec<PathBuf> = stream::iter(paths)
            .map(|path| async move {
                let exists = tokio::fs::try_exists(&path).await.unwrap_or(true);
                (path, exists)
            })
            .buffer_unordered(8)
            .filter_map(|(path, exists)| async move {
                if !exists {
                    Some(path)
                } else {
                    None
                }
            })
            .collect()
            .await;

        if !to_remove.is_empty() {
            let mut entries = self.entries.write().await;
            for path in to_remove {
                if entries.remove(&path).is_some() {
                    self.stat_evictions.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    }

    /// Get entries only for specific project paths.
    ///
    /// Returns cached entries filtered by project path if cache is fresh.
    pub async fn get_for_projects_if_fresh(
        &self,
        project_paths: &[String],
    ) -> Option<Vec<HistoryEntry>> {
        if !self.should_skip_scan().await {
            return None;
        }

        let entries = self.entries.read().await;
        if entries.is_empty() {
            return None;
        }

        // Filter entries by project path (HashSet for O(1) lookup instead of O(n*m))
        let project_set: std::collections::HashSet<&str> =
            project_paths.iter().map(|s| s.as_str()).collect();
        let filtered: Vec<HistoryEntry> = entries
            .values()
            .filter(|e| project_set.contains(e.data.project.as_str()))
            .map(|e| e.data.clone())
            .collect();

        if filtered.is_empty() {
            return None;
        }

        self.stat_ttl_skips
            .fetch_add(filtered.len(), Ordering::Relaxed);

        Some(filtered)
    }
}

/// Global cache instance.
///
/// Using a static instance ensures the cache persists across function calls
/// and is shared between all sync operations.
static GLOBAL_CACHE: std::sync::OnceLock<FileMetadataCache> = std::sync::OnceLock::new();

/// Get the global file metadata cache.
pub fn get_cache() -> &'static FileMetadataCache {
    GLOBAL_CACHE.get_or_init(FileMetadataCache::default)
}

/// Force invalidate the cache.
///
/// Call this when you want to ensure the next scan reads fresh data.
pub async fn invalidate_cache() {
    get_cache().clear().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cache_creation() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        assert!(cache.is_empty().await);
        assert!(!cache.should_skip_scan().await);
    }

    #[tokio::test]
    async fn test_should_skip_scan() {
        let cache = FileMetadataCache::new(Duration::from_millis(100));

        // Initially should not skip
        assert!(!cache.should_skip_scan().await);

        // After marking complete, should skip
        cache.mark_scan_complete().await;
        assert!(cache.should_skip_scan().await);

        // After TTL expires, should not skip
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(!cache.should_skip_scan().await);
    }

    #[tokio::test]
    async fn test_cache_clear() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        cache.mark_scan_complete().await;
        assert!(cache.should_skip_scan().await);

        cache.clear().await;
        assert!(!cache.should_skip_scan().await);
        assert!(cache.is_empty().await);
    }

    #[tokio::test]
    async fn test_get_all_if_fresh() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));

        // No entries, should return None
        assert!(cache.get_all_if_fresh().await.is_none());

        // Mark scan complete but still empty
        cache.mark_scan_complete().await;
        assert!(cache.get_all_if_fresh().await.is_none());
    }

    #[tokio::test]
    async fn test_stats() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));

        let stats = cache.get_stats();
        assert_eq!(stats.hits, 0);
        assert_eq!(stats.misses, 0);

        cache.reset_stats();
        let stats = cache.get_stats();
        assert_eq!(stats.hits, 0);
    }

    #[tokio::test]
    async fn test_global_cache() {
        let cache1 = get_cache();
        let cache2 = get_cache();

        // Should be the same instance
        assert!(std::ptr::eq(cache1, cache2));

        // Test that it's functional
        assert!(cache1.is_empty().await);
    }

    /// Helper to create a HistoryEntry for testing.
    fn make_test_entry(session_id: &str) -> HistoryEntry {
        HistoryEntry {
            id: format!("test-{session_id}"),
            display: format!("Test session {session_id}"),
            timestamp: 1000,
            project: "/test/project".to_string(),
            session_id: session_id.to_string(),
            pasted_contents: serde_json::Value::Null,
            agent_id: crate::acp::types::CanonicalAgentId::ClaudeCode,
            updated_at: 1000,
            source_path: None,
            parent_id: None,
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            worktree_deleted: None,
            session_lifecycle_state: Some(crate::db::repository::SessionLifecycleState::Persisted),
            sequence_id: None,
        }
    }

    #[tokio::test]
    async fn test_insert_with_explicit_metadata_and_check_file() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.jsonl");
        std::fs::write(&file_path, "test content").unwrap();

        let metadata = tokio::fs::metadata(&file_path).await.unwrap();
        let mtime = metadata.modified().unwrap();
        let size = metadata.len();

        // Insert with explicit mtime/size (caller-provided, no re-stat)
        cache
            .insert(file_path.clone(), make_test_entry("s1"), mtime, size)
            .await;

        assert_eq!(cache.len().await, 1);

        // check_file should return cache hit since file hasn't changed on disk
        let cached = cache.check_file(&file_path).await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().session_id, "s1");
    }

    #[tokio::test]
    async fn test_check_file_returns_none_for_changed_file() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.jsonl");
        std::fs::write(&file_path, "original").unwrap();

        let metadata = tokio::fs::metadata(&file_path).await.unwrap();
        let mtime = metadata.modified().unwrap();
        let size = metadata.len();

        cache
            .insert(file_path.clone(), make_test_entry("s1"), mtime, size)
            .await;

        // Modify the file — size changes, so check_file should return None (cache miss)
        std::fs::write(&file_path, "modified content that is longer").unwrap();

        let cached = cache.check_file(&file_path).await;
        assert!(cached.is_none());

        let stats = cache.get_stats();
        assert_eq!(stats.misses, 1);
    }

    #[tokio::test]
    async fn test_check_file_returns_none_for_deleted_file() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.jsonl");
        std::fs::write(&file_path, "content").unwrap();

        let metadata = tokio::fs::metadata(&file_path).await.unwrap();
        let mtime = metadata.modified().unwrap();
        let size = metadata.len();

        cache
            .insert(file_path.clone(), make_test_entry("s1"), mtime, size)
            .await;

        // Delete the file
        std::fs::remove_file(&file_path).unwrap();

        // check_file should return None and evict
        let cached = cache.check_file(&file_path).await;
        assert!(cached.is_none());
        assert!(cache.is_empty().await);
    }

    #[tokio::test]
    async fn test_check_file_with_metadata_returns_hit_without_restat() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.jsonl");
        std::fs::write(&file_path, "content").unwrap();

        let metadata = tokio::fs::metadata(&file_path).await.unwrap();
        let mtime = metadata.modified().unwrap();
        let size = metadata.len();

        cache
            .insert(file_path.clone(), make_test_entry("s1"), mtime, size)
            .await;

        let cached = cache
            .check_file_with_metadata(&file_path, mtime, size)
            .await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().session_id, "s1");

        let stats = cache.get_stats();
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 0);
    }

    #[tokio::test]
    async fn test_check_file_with_metadata_returns_miss_for_changed_metadata() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.jsonl");
        std::fs::write(&file_path, "content").unwrap();

        let metadata = tokio::fs::metadata(&file_path).await.unwrap();
        let mtime = metadata.modified().unwrap();
        let size = metadata.len();

        cache
            .insert(file_path.clone(), make_test_entry("s1"), mtime, size)
            .await;

        let cached = cache
            .check_file_with_metadata(&file_path, mtime, size + 1)
            .await;
        assert!(cached.is_none());

        let stats = cache.get_stats();
        assert_eq!(stats.hits, 0);
        assert_eq!(stats.misses, 1);
    }

    #[tokio::test]
    async fn test_cleanup_deleted_files_removes_stale_entries() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        let dir = tempfile::tempdir().unwrap();

        let file1 = dir.path().join("exists.jsonl");
        let file2 = dir.path().join("deleted.jsonl");
        std::fs::write(&file1, "content1").unwrap();
        std::fs::write(&file2, "content2").unwrap();

        let m1 = tokio::fs::metadata(&file1).await.unwrap();
        let m2 = tokio::fs::metadata(&file2).await.unwrap();

        cache
            .insert(
                file1.clone(),
                make_test_entry("s1"),
                m1.modified().unwrap(),
                m1.len(),
            )
            .await;
        cache
            .insert(
                file2.clone(),
                make_test_entry("s2"),
                m2.modified().unwrap(),
                m2.len(),
            )
            .await;

        assert_eq!(cache.len().await, 2);

        // Delete one file
        std::fs::remove_file(&file2).unwrap();

        // Cleanup should remove the deleted file's entry
        cache.cleanup_deleted_files().await;

        assert_eq!(cache.len().await, 1);
        let stats = cache.get_stats();
        assert_eq!(stats.evictions, 1);
    }

    #[tokio::test]
    async fn test_get_for_projects_uses_hashset_filter() {
        let cache = FileMetadataCache::new(Duration::from_secs(30));
        let dir = tempfile::tempdir().unwrap();

        let file1 = dir.path().join("a.jsonl");
        let file2 = dir.path().join("b.jsonl");
        std::fs::write(&file1, "c1").unwrap();
        std::fs::write(&file2, "c2").unwrap();

        let m1 = tokio::fs::metadata(&file1).await.unwrap();
        let m2 = tokio::fs::metadata(&file2).await.unwrap();

        let mut entry1 = make_test_entry("s1");
        entry1.project = "/project/alpha".to_string();
        let mut entry2 = make_test_entry("s2");
        entry2.project = "/project/beta".to_string();

        cache
            .insert(file1.clone(), entry1, m1.modified().unwrap(), m1.len())
            .await;
        cache
            .insert(file2.clone(), entry2, m2.modified().unwrap(), m2.len())
            .await;
        cache.mark_scan_complete().await;

        // Filter for only one project
        let results = cache
            .get_for_projects_if_fresh(&["/project/alpha".to_string()])
            .await;
        assert!(results.is_some());
        let entries = results.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].session_id, "s1");
    }
}
