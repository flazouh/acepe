//! File index service with caching.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use tokio::sync::RwLock;
use tracing::{debug, info};

use super::git::{get_git_overview_summary, get_git_status, get_git_status_summary};
use super::scanner::scan_project;
use super::types::{FileGitStatus, IndexedFile, ProjectGitOverview, ProjectIndex};

/// Cache TTL in seconds.
const CACHE_TTL_SECS: u64 = 60;

/// Cached project index with timestamp.
struct CachedIndex {
    index: ProjectIndex,
    created_at: Instant,
}

impl CachedIndex {
    fn is_expired(&self) -> bool {
        self.created_at.elapsed() > Duration::from_secs(CACHE_TTL_SECS)
    }
}

/// File index service that manages project file indexing with caching.
pub struct FileIndexService {
    /// Cache of project indexes, keyed by project path.
    cache: DashMap<String, CachedIndex>,
    /// Set of projects currently being indexed (to prevent duplicate work).
    indexing: Arc<RwLock<std::collections::HashSet<String>>>,
}

impl FileIndexService {
    /// Create a new file index service.
    pub fn new() -> Self {
        Self {
            cache: DashMap::new(),
            indexing: Arc::new(RwLock::new(std::collections::HashSet::new())),
        }
    }

    /// Get project index, using cache if available.
    ///
    /// Returns cached data immediately if fresh, otherwise triggers background refresh.
    pub async fn get_project_index(&self, project_path: &str) -> Result<ProjectIndex, String> {
        // Check cache first
        if let Some(cached) = self.cache.get(project_path) {
            if !cached.is_expired() {
                debug!("Cache hit for project: {}", project_path);
                return Ok(cached.index.clone());
            }
        }

        // Check if already indexing
        {
            let indexing = self.indexing.read().await;
            if indexing.contains(project_path) {
                // Return stale cache if available, otherwise wait
                if let Some(cached) = self.cache.get(project_path) {
                    debug!("Returning stale cache while indexing: {}", project_path);
                    return Ok(cached.index.clone());
                }
            }
        }

        // Mark as indexing
        {
            let mut indexing = self.indexing.write().await;
            indexing.insert(project_path.to_string());
        }

        // Perform indexing
        let result = self.index_project(project_path).await;

        // Remove from indexing set
        {
            let mut indexing = self.indexing.write().await;
            indexing.remove(project_path);
        }

        result
    }

    /// Perform the actual indexing work.
    async fn index_project(&self, project_path: &str) -> Result<ProjectIndex, String> {
        let path = Path::new(project_path);

        info!("Indexing project: {}", project_path);
        let start = Instant::now();

        // Run file scanning and git status in parallel (both are blocking tasks)
        let path_for_scan = path.to_path_buf();
        let path_for_git = path.to_path_buf();

        let (files_result, git_result) = tokio::join!(
            tokio::task::spawn_blocking(move || scan_project(&path_for_scan).unwrap_or_default()),
            tokio::task::spawn_blocking(move || get_git_status(&path_for_git).unwrap_or_default())
        );

        let files: Vec<IndexedFile> =
            files_result.map_err(|e| format!("Failed to scan project: {}", e))?;
        let git_status: Vec<FileGitStatus> =
            git_result.map_err(|e| format!("Failed to get git status: {}", e))?;

        let total_duration = start.elapsed();
        debug!(
            "File scan and git status completed in parallel in {:?}",
            total_duration
        );

        // Build git status lookup map for O(1) access (keyed by path, value is full FileGitStatus)
        let git_status_map: std::collections::HashMap<&str, &FileGitStatus> =
            git_status.iter().map(|s| (s.path.as_str(), s)).collect();

        // Merge git status into files
        let mut files_with_status: Vec<IndexedFile> = files
            .into_iter()
            .map(|mut f| {
                f.git_status = git_status_map.get(f.path.as_str()).map(|s| (*s).clone());
                f
            })
            .collect();

        // Sort: modified files first, then alphabetically by path
        files_with_status.sort_by(|a, b| {
            let a_has_status = a.git_status.is_some();
            let b_has_status = b.git_status.is_some();
            match (a_has_status, b_has_status) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.path.cmp(&b.path),
            }
        });

        let total_files = files_with_status.len() as u64;
        let total_lines: u64 = files_with_status.iter().map(|f| f.line_count).sum();

        let index = ProjectIndex {
            project_path: project_path.to_string(),
            files: files_with_status,
            git_status,
            total_files,
            total_lines,
        };

        info!(
            "Indexed {} files ({} lines) in {:?}",
            total_files, total_lines, total_duration
        );

        // Update cache
        self.cache.insert(
            project_path.to_string(),
            CachedIndex {
                index: index.clone(),
                created_at: Instant::now(),
            },
        );

        Ok(index)
    }

    /// Get git status only (faster than full index).
    pub async fn get_git_status_only(
        &self,
        project_path: &str,
    ) -> Result<Vec<FileGitStatus>, String> {
        let path = Path::new(project_path).to_path_buf();

        tokio::task::spawn_blocking(move || {
            get_git_status(&path).map_err(|e| format!("Failed to get git status: {}", e))
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }

    /// Get git status summary only (no per-file diff stats).
    ///
    /// Intended for UI surfaces where side-effect-safe metadata is required.
    pub async fn get_git_status_summary_only(
        &self,
        project_path: &str,
    ) -> Result<Vec<FileGitStatus>, String> {
        let path = Path::new(project_path).to_path_buf();

        tokio::task::spawn_blocking(move || {
            get_git_status_summary(&path).map_err(|e| format!("Failed to get git status: {}", e))
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }

    /// Get branch + TCC-safe git status summary in one pass.
    pub async fn get_git_overview_summary(
        &self,
        project_path: &str,
    ) -> Result<ProjectGitOverview, String> {
        let path = Path::new(project_path).to_path_buf();

        tokio::task::spawn_blocking(move || {
            get_git_overview_summary(&path)
                .map_err(|e| format!("Failed to get git overview: {}", e))
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }

    /// Invalidate cache for a project.
    pub fn invalidate(&self, project_path: &str) {
        self.cache.remove(project_path);
    }

    /// Invalidate all caches.
    pub fn invalidate_all(&self) {
        self.cache.clear();
    }
}

impl Default for FileIndexService {
    fn default() -> Self {
        Self::new()
    }
}
