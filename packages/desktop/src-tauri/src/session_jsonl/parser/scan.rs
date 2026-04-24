use anyhow::{anyhow, Result};
use serde_json::Value;
use std::cmp::Reverse;
use std::io::BufRead;
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::acp::types::CanonicalAgentId;
use crate::history::constants::{MAX_PROJECTS_TO_SCAN, MAX_SESSIONS_PER_PROJECT};
use crate::session_jsonl::cache::get_cache;
use crate::session_jsonl::types::{HistoryEntry, SessionMessage};

use super::text_utils::{
    extract_display_name_from_user_message, get_session_jsonl_root, is_valid_uuid,
    parse_iso_timestamp_to_ms, path_to_slug,
};

struct MetadataParseState {
    first_message_json: Option<Value>,
    display: Option<String>,
    saw_any_line: bool,
}

impl MetadataParseState {
    fn new() -> Self {
        Self {
            first_message_json: None,
            display: None,
            saw_any_line: false,
        }
    }

    fn process_line(&mut self, file_path: &std::path::Path, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        self.saw_any_line = true;

        let json: Value = match serde_json::from_str(line) {
            Ok(json) => json,
            Err(e) => {
                tracing::error!(
                    file = %file_path.display(),
                    error = %e,
                    line_preview = %&line[..line.len().min(200)],
                    "Failed to parse JSONL line during session scan"
                );
                return;
            }
        };

        let msg_type = json.get("type").and_then(|v| v.as_str());

        if let Some("file-history-snapshot" | "queue-operation" | "summary") = msg_type {
            return;
        }

        let is_user = msg_type == Some("user");
        let is_assistant = msg_type == Some("assistant");

        if !is_user && !is_assistant {
            return;
        }

        if self.first_message_json.is_none() {
            self.first_message_json = Some(json.clone());
        }

        if is_user && self.display.is_none() {
            self.display = extract_display_name_from_user_message(&json);
        }
    }

    fn is_complete(&self) -> bool {
        self.first_message_json.is_some() && self.display.is_some()
    }

    fn into_history_entry(self, file_name: &str) -> Result<Option<HistoryEntry>> {
        let base_name = file_name.strip_suffix(".jsonl").unwrap_or(file_name);

        if !self.saw_any_line {
            if is_valid_uuid(base_name) {
                return Ok(Some(HistoryEntry {
                    id: base_name.to_string(),
                    display: "Untitled conversation".to_string(),
                    timestamp: 0,
                    project: "".to_string(),
                    session_id: base_name.to_string(),
                    pasted_contents: serde_json::json!({}),
                    agent_id: CanonicalAgentId::ClaudeCode,
                    updated_at: 0,
                    source_path: None,
                    parent_id: None,
                    worktree_path: None,
                    pr_number: None,
                    pr_link_mode: None,
                    worktree_deleted: None,
                    session_lifecycle_state: Some(
                        crate::db::repository::SessionLifecycleState::Persisted,
                    ),
                    sequence_id: None,
                }));
            }
            return Ok(None);
        }

        let first_json = match self.first_message_json {
            Some(json) => json,
            None => return Ok(None),
        };

        let display = match self.display {
            Some(value) => value,
            None => return Ok(None),
        };

        let session_id = if let Some(sid) = first_json.get("sessionId").and_then(|v| v.as_str()) {
            sid.to_string()
        } else if is_valid_uuid(base_name) {
            base_name.to_string()
        } else {
            return Ok(None);
        };

        let timestamp = first_json
            .get("timestamp")
            .and_then(|v| v.as_str())
            .and_then(|ts| parse_iso_timestamp_to_ms(ts).ok())
            .unwrap_or(0);

        let project = first_json
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        Ok(Some(HistoryEntry {
            id: session_id.clone(),
            display,
            timestamp,
            project,
            session_id,
            pasted_contents: serde_json::json!({}),
            agent_id: CanonicalAgentId::ClaudeCode,
            updated_at: timestamp,
            source_path: None,
            parent_id: None,
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            worktree_deleted: None,
            session_lifecycle_state: Some(crate::db::repository::SessionLifecycleState::Persisted),
            sequence_id: None,
        }))
    }
}

fn build_history_entry_from_values(
    file_path: &std::path::Path,
    file_name: &str,
    lines: impl IntoIterator<Item = std::result::Result<String, std::io::Error>>,
) -> Result<Option<HistoryEntry>> {
    let mut state = MetadataParseState::new();

    for line_result in lines {
        let line = line_result?;
        state.process_line(file_path, &line);
        if state.is_complete() {
            break;
        }
    }

    state.into_history_entry(file_name)
}

fn extract_thread_metadata_sync(file_path: &std::path::Path) -> Result<Option<HistoryEntry>> {
    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("Invalid file name"))?;

    if !file_name.ends_with(".jsonl") {
        return Ok(None);
    }

    let file = match std::fs::File::open(file_path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };

    let reader = std::io::BufReader::new(file);
    build_history_entry_from_values(file_path, file_name, reader.lines())
}

#[cfg(test)]
pub(super) fn extract_thread_metadata_sync_for_test(
    file_path: &std::path::Path,
) -> Result<Option<HistoryEntry>> {
    extract_thread_metadata_sync(file_path)
}

pub async fn extract_thread_metadata(file_path: &PathBuf) -> Result<Option<HistoryEntry>> {
    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("Invalid file name"))?;

    if !file_name.ends_with(".jsonl") {
        return Ok(None);
    }

    let file = match tokio::fs::File::open(file_path).await {
        Ok(f) => f,
        Err(_) => return Ok(None),
    };

    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut state = MetadataParseState::new();

    while let Some(line) = lines.next_line().await? {
        state.process_line(file_path, &line);
        if state.is_complete() {
            break;
        }
    }

    state.into_history_entry(file_name)
}

/// Scans all project folders and extracts thread metadata from all .jsonl files.
/// Returns a sorted list of HistoryEntry objects (most recent first).
///
/// Uses a hybrid mtime + TTL caching strategy for efficiency.
/// Note: This scans ALL projects which can be slow. Prefer scan_projects() for normal use.
pub async fn scan_all_threads() -> Result<Vec<HistoryEntry>> {
    let cache = get_cache();

    // Fast path: if cache is fresh, return all cached entries
    if let Some(cached_entries) = cache.get_all_if_fresh().await {
        let mut entries = cached_entries;
        entries.sort_by_key(|entry| Reverse(entry.timestamp));
        return Ok(entries);
    }

    let jsonl_root = get_session_jsonl_root()?;
    let projects_dir = jsonl_root.join("projects");

    if !tokio::fs::try_exists(&projects_dir).await.unwrap_or(false) {
        return Ok(Vec::new());
    }

    let mut all_entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&projects_dir).await?;
    let mut projects_processed = 0usize;

    // Iterate through project folders
    while let Some(entry) = read_dir.next_entry().await? {
        if projects_processed >= MAX_PROJECTS_TO_SCAN {
            break;
        }
        let project_slug = entry.file_name();
        let project_slug_str = project_slug.to_string_lossy();

        // Skip hidden files and directories
        if project_slug_str.starts_with('.') {
            continue;
        }

        let project_path = entry.path();
        // Reuse DirEntry file_type — no extra syscall
        let ft = match entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_dir() {
            continue;
        }

        projects_processed += 1;

        // Collect all .jsonl files with their modification times
        let mut project_read_dir = match tokio::fs::read_dir(&project_path).await {
            Ok(dir) => dir,
            Err(_) => {
                continue;
            }
        };

        let mut files_with_mtime: Vec<(std::path::PathBuf, std::time::SystemTime, u64)> =
            Vec::new();

        while let Some(file_entry) = project_read_dir.next_entry().await? {
            let file_path = file_entry.path();

            // Reuse DirEntry metadata — zero extra syscalls (no blocking is_file())
            let file_type = match file_entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !file_type.is_file() {
                continue;
            }

            let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if !file_name.ends_with(".jsonl") {
                continue;
            }

            // Get modification time and size from DirEntry metadata (already available, no extra stat)
            if let Ok(metadata) = file_entry.metadata().await {
                if let Ok(mtime) = metadata.modified() {
                    files_with_mtime.push((file_path, mtime, metadata.len()));
                }
            }
        }

        // Sort by modification time (most recent first)
        files_with_mtime.sort_by_key(|entry| Reverse(entry.1));

        // Only process the most recent sessions per project
        let mut sessions_in_project = 0usize;

        for (file_path, mtime, size) in files_with_mtime {
            if sessions_in_project >= MAX_SESSIONS_PER_PROJECT {
                break;
            }

            // Check cache first - only parse if file changed
            if let Some(cached_entry) = cache
                .check_file_with_metadata(&file_path, mtime, size)
                .await
            {
                all_entries.push(cached_entry);
                sessions_in_project += 1;
                continue;
            }

            // Extract metadata from file
            match extract_thread_metadata(&file_path).await {
                Ok(Some(mut entry)) => {
                    // If project path is empty, try to derive from folder slug
                    if entry.project.is_empty() {
                        let project_path_str = if project_slug_str.starts_with('-') {
                            project_slug_str.replace('-', "/")
                        } else {
                            format!("/{}", project_slug_str.replace('-', "/"))
                        };
                        entry.project = project_path_str.to_string();
                    }
                    // Update cache — mtime/size already known from dir listing
                    cache.insert(file_path, entry.clone(), mtime, size).await;
                    all_entries.push(entry);
                    sessions_in_project += 1;
                }
                Ok(None) => {
                    // File doesn't contain valid metadata, skip it
                }
                Err(_) => {
                    // Failed to parse, skip it
                }
            }
        }
    }

    // Mark scan complete for TTL tracking
    cache.mark_scan_complete().await;

    // Sort by timestamp descending (most recent first)
    all_entries.sort_by_key(|entry| Reverse(entry.timestamp));

    Ok(all_entries)
}

/// Processes a cached entry for a specific project, ensuring the project path is correct.
///
/// This fixes a bug where cached entries could have stale project paths (from the session's
/// cwd field) that don't match the database project path we're scanning for.
///
/// # Arguments
/// * `cached_entry` - The entry from cache
/// * `expected_project_path` - The database project path we're scanning
///
/// # Returns
/// The entry with project path corrected if necessary
#[inline]
pub fn process_cached_entry_for_project(
    mut cached_entry: HistoryEntry,
    expected_project_path: &str,
) -> HistoryEntry {
    if cached_entry.project != expected_project_path {
        cached_entry.project = expected_project_path.to_string();
    }
    cached_entry
}

/// Scans only specific project directories and extracts thread metadata.
/// This is the efficient version that only scans workspace projects.
/// Returns a sorted list of HistoryEntry objects (most recent first).
///
/// Uses a hybrid mtime + TTL caching strategy:
/// - If cache is fresh (within TTL), returns cached entries immediately
/// - Otherwise, checks file modification times and only re-parses changed files
/// - This reduces I/O and CPU usage by 70-95% for repeated calls
pub async fn scan_projects(project_paths: &[String]) -> Result<Vec<HistoryEntry>> {
    scan_projects_streaming(project_paths, |_| {}).await
}

/// Scan projects with streaming support.
/// Calls `on_entry` for each session as it's discovered, enabling progressive UI updates.
pub async fn scan_projects_streaming<F>(
    project_paths: &[String],
    mut on_entry: F,
) -> Result<Vec<HistoryEntry>>
where
    F: FnMut(&HistoryEntry),
{
    let cache = get_cache();

    // Fast path: if cache is fresh, return cached entries
    // Still emit events for each cached entry for UI consistency
    if let Some(cached_entries) = cache.get_for_projects_if_fresh(project_paths).await {
        let mut entries = cached_entries;
        entries.sort_by_key(|entry| Reverse(entry.timestamp));
        // Emit all cached entries
        for entry in &entries {
            on_entry(entry);
        }
        return Ok(entries);
    }

    let jsonl_root = get_session_jsonl_root()?;
    let projects_dir = jsonl_root.join("projects");

    if !tokio::fs::try_exists(&projects_dir).await.unwrap_or(false) {
        tracing::warn!(projects_dir = ?projects_dir, "Projects directory not found");
        return Ok(Vec::new());
    }

    let mut all_entries = Vec::new();
    let mut cache_hits = 0usize;
    let mut cache_misses = 0usize;

    for project_path in project_paths {
        let slug = path_to_slug(project_path);
        let project_dir = projects_dir.join(&slug);

        if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
            continue;
        }

        // Collect all .jsonl files with their modification times
        let mut project_read_dir = match tokio::fs::read_dir(&project_dir).await {
            Ok(dir) => dir,
            Err(_) => {
                continue;
            }
        };

        let mut files_with_mtime: Vec<(std::path::PathBuf, std::time::SystemTime, u64)> =
            Vec::new();

        while let Some(file_entry) = project_read_dir.next_entry().await? {
            let file_path = file_entry.path();

            // Reuse DirEntry metadata — zero extra syscalls (no blocking is_file())
            let file_type = match file_entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !file_type.is_file() {
                continue;
            }

            let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if !file_name.ends_with(".jsonl") {
                continue;
            }

            // Get modification time and size from DirEntry metadata (already available, no extra stat)
            if let Ok(metadata) = file_entry.metadata().await {
                if let Ok(mtime) = metadata.modified() {
                    files_with_mtime.push((file_path, mtime, metadata.len()));
                }
            }
        }

        // Sort by modification time (most recent first) — needed for take() to pick most recent
        files_with_mtime.sort_by_key(|entry| Reverse(entry.1));

        // Process files in parallel within this project (8 concurrent — leaves cores for UI thread)
        use futures::stream::{self, StreamExt};

        let project_path_owned = project_path.to_string();
        let project_results: Vec<(Option<HistoryEntry>, bool)> =
            stream::iter(files_with_mtime.into_iter().take(MAX_SESSIONS_PER_PROJECT))
                .map(|(file_path, mtime, size)| {
                    let project_path_ref = &project_path_owned;
                    async move {
                        // Check cache first — only parse if file changed
                        if let Some(cached_entry) = cache
                            .check_file_with_metadata(&file_path, mtime, size)
                            .await
                        {
                            let corrected =
                                process_cached_entry_for_project(cached_entry, project_path_ref);
                            return (Some(corrected), true); // (entry, is_cache_hit)
                        }

                        // Cache miss — parse file
                        let blocking_file_path = file_path.clone();
                        match tokio::task::spawn_blocking(move || {
                            extract_thread_metadata_sync(&blocking_file_path)
                        })
                        .await
                        {
                            Ok(Ok(Some(mut entry))) => {
                                entry.project = project_path_ref.clone();
                                cache.insert(file_path, entry.clone(), mtime, size).await;
                                (Some(entry), false)
                            }
                            Ok(Ok(None)) => (None, false),
                            Ok(Err(e)) => {
                                tracing::error!(
                                    file_path = %file_path.display(),
                                    error = %e,
                                    "Failed to parse session file"
                                );
                                (None, false)
                            }
                            Err(e) => {
                                tracing::error!(
                                    file_path = %file_path.display(),
                                    error = %e,
                                    "Failed to join blocking session parse task"
                                );
                                (None, false)
                            }
                        }
                    }
                })
                .buffer_unordered(8)
                .collect()
                .await;

        // Emit per project after collection so callbacks remain progressive.
        for (entry_opt, is_hit) in project_results {
            if is_hit {
                cache_hits += 1;
            } else {
                cache_misses += 1;
            }
            if let Some(entry) = entry_opt {
                on_entry(&entry);
                all_entries.push(entry);
            }
        }
    }

    // Mark scan complete for TTL tracking
    cache.mark_scan_complete().await;

    // Sort by timestamp descending (most recent first)
    all_entries.sort_by_key(|entry| Reverse(entry.timestamp));

    tracing::info!(
        project_count = project_paths.len(),
        entries_count = all_entries.len(),
        cache_hits = cache_hits,
        cache_misses = cache_misses,
        hit_rate = format!(
            "{:.1}%",
            if cache_hits + cache_misses > 0 {
                cache_hits as f64 / (cache_hits + cache_misses) as f64 * 100.0
            } else {
                0.0
            }
        ),
        "Scanned workspace projects with caching"
    );

    Ok(all_entries)
}

/// Search one project directory for a session file.
/// Tries `{session_id}.jsonl` first, then scans for `agent-*.jsonl` files.
async fn find_in_dir(session_id: &str, project_dir: &std::path::Path) -> Result<Option<PathBuf>> {
    let direct_path = project_dir.join(format!("{}.jsonl", session_id));
    if tokio::fs::try_exists(&direct_path).await.unwrap_or(false) {
        return Ok(Some(direct_path));
    }

    let mut read_dir = match tokio::fs::read_dir(project_dir).await {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };

    while let Some(entry) = read_dir.next_entry().await? {
        let file_path = entry.path();
        if !entry.file_type().await?.is_file() {
            continue;
        }
        let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if file_name.starts_with("agent-") && file_name.ends_with(".jsonl") {
            match extract_session_id_from_file(&file_path).await {
                Ok(Some(id)) if id == session_id => return Ok(Some(file_path)),
                _ => continue,
            }
        }
    }

    Ok(None)
}

/// Find a session file within a given projects directory.
///
/// 1. Fast path — look in `projects_dir / path_to_slug(project_path)` (O(1)).
/// 2. Fallback — scan every subdirectory of `projects_dir` (O(n)) to handle
///    slug mismatches (e.g. worktree paths stored with old slug algorithms).
pub(super) async fn find_session_file_in(
    session_id: &str,
    project_path: &str,
    projects_dir: &std::path::Path,
) -> Result<PathBuf> {
    // Fast path: slug-based lookup.
    let slug = path_to_slug(project_path);
    let project_dir = projects_dir.join(&slug);
    if let Some(path) = find_in_dir(session_id, &project_dir).await? {
        return Ok(path);
    }

    // Fallback: scan all project dirs in case the slug doesn't match.
    if tokio::fs::try_exists(projects_dir).await.unwrap_or(false) {
        let mut read_dir = tokio::fs::read_dir(projects_dir).await?;
        while let Some(entry) = read_dir.next_entry().await? {
            let dir_path = entry.path();
            if !entry.file_type().await?.is_dir() {
                continue;
            }
            // Already checked this one in the fast path.
            if dir_path == project_dir {
                continue;
            }
            if let Some(path) = find_in_dir(session_id, &dir_path).await? {
                tracing::warn!(
                    session_id = %session_id,
                    expected_dir = ?project_dir,
                    found_dir = ?dir_path,
                    "Session found via fallback scan (slug mismatch)"
                );
                return Ok(path);
            }
        }
    }

    Err(anyhow!(
        "Session file not found for session_id={} in project={}",
        session_id,
        project_path
    ))
}

/// Finds the file path for a session, handling both {sessionId}.jsonl and agent-*.jsonl formats.
pub(crate) async fn find_session_file(session_id: &str, project_path: &str) -> Result<PathBuf> {
    let jsonl_root = get_session_jsonl_root()?;
    find_session_file_in(session_id, project_path, &jsonl_root.join("projects")).await
}

/// Reads messages directly from a file path.
pub async fn read_messages_from_file(file_path: &PathBuf) -> Result<Vec<SessionMessage>> {
    let content = tokio::fs::read_to_string(file_path).await?;

    let messages: Vec<SessionMessage> = content
        .lines()
        .filter_map(|line| {
            if line.is_empty() {
                return None;
            }
            match serde_json::from_str::<SessionMessage>(line) {
                Ok(msg) => Some(msg),
                Err(e) => {
                    tracing::warn!(error = %e, "Failed to parse message");
                    None
                }
            }
        })
        .collect();

    tracing::info!(
        messages_count = messages.len(),
        file_path = %file_path.to_string_lossy(),
        "Loaded messages from file"
    );

    Ok(messages)
}

pub async fn read_session_messages(
    session_id: &str,
    project_path: &str,
) -> Result<Vec<SessionMessage>> {
    let session_path = find_session_file(session_id, project_path).await?;
    read_messages_from_file(&session_path).await
}

/// Extracts session ID from a thread file.
/// For files named `agent-*.jsonl`, reads the first line to get the sessionId.
/// For files named `{sessionId}.jsonl`, uses the filename.
pub(super) async fn extract_session_id_from_file(file_path: &PathBuf) -> Result<Option<String>> {
    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("Invalid file name"))?;

    // If it's a UUID format (sessionId.jsonl), use the filename
    if file_name.ends_with(".jsonl") {
        let base_name = file_name.strip_suffix(".jsonl").unwrap_or(file_name);
        // Check if it's a valid UUID format
        if is_valid_uuid(base_name) {
            return Ok(Some(base_name.to_string()));
        }

        // If it's an agent-*.jsonl file, read the first line to get sessionId
        if base_name.starts_with("agent-") {
            let content = tokio::fs::read_to_string(file_path).await?;
            if let Some(first_line) = content.lines().next() {
                if !first_line.is_empty() {
                    match serde_json::from_str::<Value>(first_line) {
                        Ok(json) => {
                            if let Some(session_id) = json.get("sessionId").and_then(|v| v.as_str())
                            {
                                return Ok(Some(session_id.to_string()));
                            }
                        }
                        Err(e) => {
                            tracing::warn!(file_name = %file_name, error = %e, "Failed to parse first line");
                        }
                    }
                }
            }
        }
    }

    Ok(None)
}
