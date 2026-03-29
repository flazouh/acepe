//! Codex session scanner.
//!
//! Scans Codex sessions from local rollout files under `~/.codex/sessions`.
//! This mirrors disk-based scanning used by other agent histories and avoids
//! spawning subprocesses during background discovery.

use anyhow::Result;
use chrono::{DateTime, Utc};
use ignore::WalkBuilder;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::sync::Mutex;

use crate::acp::types::CanonicalAgentId;
use crate::history::constants::{MAX_PROJECTS_TO_SCAN, MAX_SESSIONS_PER_PROJECT};
use crate::session_jsonl::types::HistoryEntry;

#[derive(Debug, Clone)]
struct SessionMetadata {
    session_id: String,
    cwd: String,
    title: Option<String>,
    updated_at: i64,
    source_path: String,
}

#[derive(Debug, Clone)]
struct SessionMetadataFast {
    session_id: String,
    cwd: String,
    title: Option<String>,
    updated_at: i64,
    source_path: String,
}

/// Scan Codex sessions and convert them to HistoryEntry.
///
/// Sessions are discovered from local rollout files and filtered by project paths.
///
/// # Arguments
/// * `project_paths` - Project paths to filter sessions (empty = discovery mode)
///
/// # Returns
/// Vector of history entries for Codex sessions
pub async fn scan_sessions(project_paths: &[String]) -> Result<Vec<HistoryEntry>> {
    static CODEX_SCAN_GUARD: OnceLock<Mutex<()>> = OnceLock::new();
    let scan_guard = CODEX_SCAN_GUARD.get_or_init(|| Mutex::new(()));
    let _guard = match scan_guard.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            tracing::debug!("Codex scan already in progress, skipping duplicate request");
            return Ok(Vec::new());
        }
    };

    let Some(codex_sessions_root) = codex_sessions_root() else {
        tracing::debug!("Codex sessions directory is not available, skipping scan");
        return Ok(Vec::new());
    };

    let project_paths_vec = project_paths.to_vec();
    tokio::task::spawn_blocking(move || {
        scan_sessions_from_root(codex_sessions_root.as_path(), &project_paths_vec)
    })
    .await
    .unwrap_or_else(|error| {
        tracing::warn!(error = %error, "Codex session scan task failed");
        Ok(Vec::new())
    })
}

/// Scan Codex sessions for indexing using metadata-only extraction.
///
/// This avoids full rollout parsing and reads only early `session_meta` records
/// plus file mtime fallback to derive ordering metadata.
pub async fn scan_sessions_metadata_only(project_paths: &[String]) -> Result<Vec<HistoryEntry>> {
    static CODEX_SCAN_GUARD: OnceLock<Mutex<()>> = OnceLock::new();
    let scan_guard = CODEX_SCAN_GUARD.get_or_init(|| Mutex::new(()));
    let _guard = match scan_guard.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            tracing::debug!("Codex scan already in progress, skipping duplicate request");
            return Ok(Vec::new());
        }
    };

    let Some(codex_sessions_root) = codex_sessions_root() else {
        tracing::debug!("Codex sessions directory is not available, skipping scan");
        return Ok(Vec::new());
    };

    let project_paths_vec = project_paths.to_vec();
    tokio::task::spawn_blocking(move || {
        scan_sessions_metadata_only_from_root(codex_sessions_root.as_path(), &project_paths_vec)
    })
    .await
    .unwrap_or_else(|error| {
        tracing::warn!(
            error = %error,
            "Codex metadata-only session scan task failed"
        );
        Ok(Vec::new())
    })
}

fn codex_sessions_root() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let sessions_dir = home.join(".codex").join("sessions");
    if sessions_dir.exists() {
        return Some(sessions_dir);
    }
    None
}

fn scan_sessions_from_root(
    sessions_root: &Path,
    project_paths: &[String],
) -> Result<Vec<HistoryEntry>> {
    if !sessions_root.exists() {
        return Ok(Vec::new());
    }

    let mut metadata_entries: Vec<SessionMetadata> = Vec::new();

    for walk_entry in WalkBuilder::new(sessions_root)
        .standard_filters(false)
        .build()
    {
        let Ok(walk_entry) = walk_entry else {
            continue;
        };

        if !walk_entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
        {
            continue;
        }

        let file_name = walk_entry.file_name().to_string_lossy();
        if !file_name.starts_with("rollout-") || !file_name.ends_with(".jsonl") {
            continue;
        }

        if let Some(metadata) = parse_rollout_metadata(walk_entry.path()) {
            metadata_entries.push(metadata);
        }
    }

    metadata_entries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    let discovery_mode = project_paths.is_empty();
    let requested_projects: HashSet<&str> = project_paths.iter().map(String::as_str).collect();

    let mut entries: Vec<HistoryEntry> = Vec::new();
    let mut discovery_projects_seen: HashSet<String> = HashSet::new();
    let mut sessions_per_project: HashMap<String, usize> = HashMap::new();

    for metadata in metadata_entries {
        if !discovery_mode && !requested_projects.contains(metadata.cwd.as_str()) {
            continue;
        }

        if discovery_mode
            && !discovery_projects_seen.contains(&metadata.cwd)
            && discovery_projects_seen.len() >= MAX_PROJECTS_TO_SCAN
        {
            continue;
        }

        if discovery_mode {
            discovery_projects_seen.insert(metadata.cwd.clone());
        }

        let session_count = sessions_per_project
            .entry(metadata.cwd.clone())
            .or_insert(0);
        if *session_count >= MAX_SESSIONS_PER_PROJECT {
            continue;
        }

        *session_count += 1;
        entries.push(to_history_entry(&metadata));
    }

    Ok(entries)
}

fn parse_rollout_metadata(path: &Path) -> Option<SessionMetadata> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut title: Option<String> = None;
    let mut updated_at: Option<i64> = None;

    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if let Some(line_updated_at) =
            parse_rfc3339_millis(record.get("timestamp").and_then(Value::as_str))
        {
            updated_at =
                Some(updated_at.map_or(line_updated_at, |current| current.max(line_updated_at)));
        }

        let record_type = record
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = record.get("payload").unwrap_or(&Value::Null);

        if record_type == "session_meta" {
            if session_id.is_none() {
                session_id = payload
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }

            if cwd.is_none() {
                cwd = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }

            if let Some(meta_updated_at) =
                parse_rfc3339_millis(payload.get("timestamp").and_then(Value::as_str))
            {
                updated_at = Some(
                    updated_at.map_or(meta_updated_at, |current| current.max(meta_updated_at)),
                );
            }
        }

        if title.is_none() {
            title = extract_user_message(record_type, payload);
        }
    }

    let session_id = session_id?;
    let cwd = cwd?;
    let updated_at = updated_at
        .or_else(|| file_modified_millis(path))
        .unwrap_or_else(|| Utc::now().timestamp_millis());

    Some(SessionMetadata {
        session_id,
        cwd,
        title,
        updated_at,
        source_path: path.to_string_lossy().to_string(),
    })
}

fn parse_rollout_metadata_fast(path: &Path) -> Option<SessionMetadataFast> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut title: Option<String> = None;
    let mut updated_at: Option<i64> = None;

    // Read up to 150 lines to find session_meta and first user message.
    // session_meta is near the top; the first user message typically follows within 10-20 lines.
    for line in reader.lines().take(150) {
        let Ok(line) = line else {
            continue;
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        let record_type = record
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = record.get("payload").unwrap_or(&Value::Null);

        if record_type == "session_meta" && session_id.is_none() {
            session_id = payload
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string);
            cwd = payload
                .get("cwd")
                .and_then(Value::as_str)
                .map(str::to_string);
            updated_at = parse_rfc3339_millis(payload.get("timestamp").and_then(Value::as_str))
                .or_else(|| file_modified_millis(path));
        }

        if title.is_none() {
            title = extract_user_message(record_type, payload);
        }

        // Stop early once we have both metadata and a title
        if session_id.is_some() && title.is_some() {
            break;
        }
    }

    let session_id = session_id?;
    let cwd = cwd?;
    let updated_at = updated_at.unwrap_or_else(|| Utc::now().timestamp_millis());

    Some(SessionMetadataFast {
        session_id,
        cwd,
        title,
        updated_at,
        source_path: path.to_string_lossy().to_string(),
    })
}

fn extract_user_message(record_type: &str, payload: &Value) -> Option<String> {
    match record_type {
        "event_msg" => extract_event_user_message(payload),
        "response_item" => extract_response_item_user_message(payload),
        _ => None,
    }
}

fn extract_event_user_message(payload: &Value) -> Option<String> {
    if payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        != "user_message"
    {
        return None;
    }

    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();

    if message.is_empty() {
        return None;
    }

    Some(message.to_string())
}

fn extract_response_item_user_message(payload: &Value) -> Option<String> {
    if payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        != "message"
    {
        return None;
    }

    if payload
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or_default()
        != "user"
    {
        return None;
    }

    let content_items = payload.get("content").and_then(Value::as_array)?;
    let mut parts: Vec<String> = Vec::new();

    for content_item in content_items {
        let text = content_item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();

        if text.is_empty() {
            continue;
        }

        // Skip system-injected context blocks
        if text.starts_with("<environment_context>")
            || text.starts_with("<permissions ")
            || text.starts_with("<app-context>")
            || text.starts_with("<collaboration_mode>")
            || text.starts_with("# AGENTS.md")
            || text.starts_with("# Instructions")
        {
            continue;
        }

        parts.push(text.to_string());
    }

    if parts.is_empty() {
        return None;
    }

    Some(parts.join("\n\n"))
}

fn parse_rfc3339_millis(timestamp: Option<&str>) -> Option<i64> {
    let timestamp = timestamp?;
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|datetime| datetime.timestamp_millis())
}

fn file_modified_millis(path: &Path) -> Option<i64> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let elapsed = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(elapsed.as_millis() as i64)
}

fn scan_sessions_metadata_only_from_root(
    sessions_root: &Path,
    project_paths: &[String],
) -> Result<Vec<HistoryEntry>> {
    if !sessions_root.exists() {
        return Ok(Vec::new());
    }

    let mut metadata_entries: Vec<SessionMetadataFast> = Vec::new();

    for walk_entry in WalkBuilder::new(sessions_root)
        .standard_filters(false)
        .build()
    {
        let Ok(walk_entry) = walk_entry else {
            continue;
        };

        if !walk_entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
        {
            continue;
        }

        let file_name = walk_entry.file_name().to_string_lossy();
        if !file_name.starts_with("rollout-") || !file_name.ends_with(".jsonl") {
            continue;
        }

        if let Some(metadata) = parse_rollout_metadata_fast(walk_entry.path()) {
            metadata_entries.push(metadata);
        }
    }

    metadata_entries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    let discovery_mode = project_paths.is_empty();
    let requested_projects: HashSet<&str> = project_paths.iter().map(String::as_str).collect();

    let mut entries: Vec<HistoryEntry> = Vec::new();
    let mut discovery_projects_seen: HashSet<String> = HashSet::new();
    let mut sessions_per_project: HashMap<String, usize> = HashMap::new();

    for metadata in metadata_entries {
        if !discovery_mode && !requested_projects.contains(metadata.cwd.as_str()) {
            continue;
        }

        if discovery_mode
            && !discovery_projects_seen.contains(&metadata.cwd)
            && discovery_projects_seen.len() >= MAX_PROJECTS_TO_SCAN
        {
            continue;
        }

        if discovery_mode {
            discovery_projects_seen.insert(metadata.cwd.clone());
        }

        let session_count = sessions_per_project
            .entry(metadata.cwd.clone())
            .or_insert(0);
        if *session_count >= MAX_SESSIONS_PER_PROJECT {
            continue;
        }

        *session_count += 1;
        entries.push(to_history_entry_fast(&metadata));
    }

    Ok(entries)
}

/// Fast extraction of just the `cwd` from a rollout file.
/// Reads only until the first `session_meta` record is found, then stops.
fn extract_cwd(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);

    for line in reader.lines().take(20) {
        let Ok(line) = line else { continue };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        let record_type = record
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        if record_type == "session_meta" {
            return record
                .get("payload")
                .and_then(|p| p.get("cwd"))
                .and_then(Value::as_str)
                .map(str::to_string);
        }
    }

    None
}

/// Walk all rollout files and extract their cwds quickly.
/// Returns a Vec of (file_path, cwd) pairs.
fn collect_rollout_cwds(sessions_root: &Path) -> Vec<(PathBuf, String)> {
    if !sessions_root.exists() {
        return Vec::new();
    }

    let mut results = Vec::new();

    for walk_entry in WalkBuilder::new(sessions_root)
        .standard_filters(false)
        .build()
    {
        let Ok(walk_entry) = walk_entry else { continue };

        if !walk_entry
            .file_type()
            .map(|ft| ft.is_file())
            .unwrap_or(false)
        {
            continue;
        }

        let file_name = walk_entry.file_name().to_string_lossy();
        if !file_name.starts_with("rollout-") || !file_name.ends_with(".jsonl") {
            continue;
        }

        if let Some(cwd) = extract_cwd(walk_entry.path()) {
            results.push((walk_entry.path().to_path_buf(), cwd));
        }
    }

    results
}

/// Count Codex sessions for a specific project path.
/// Fast: only reads the first few lines of each file to extract cwd.
pub async fn count_sessions_for_project(project_path: &str) -> Result<u32> {
    let Some(sessions_root) = codex_sessions_root() else {
        return Ok(0);
    };

    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        let cwds = collect_rollout_cwds(&sessions_root);
        let count = cwds.iter().filter(|(_, cwd)| cwd == &project_path).count();
        Ok(count as u32)
    })
    .await
    .unwrap_or(Ok(0))
}

/// List all unique project paths from Codex sessions.
/// Fast: only reads the first few lines of each file to extract cwd.
pub async fn list_project_paths() -> Result<Vec<String>> {
    let Some(sessions_root) = codex_sessions_root() else {
        return Ok(Vec::new());
    };

    tokio::task::spawn_blocking(move || {
        let cwds = collect_rollout_cwds(&sessions_root);
        let mut paths: Vec<String> = cwds
            .into_iter()
            .map(|(_, cwd)| cwd)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        paths.sort();
        Ok(paths)
    })
    .await
    .unwrap_or(Ok(Vec::new()))
}

/// Convert Codex session metadata to a HistoryEntry.
fn to_history_entry(metadata: &SessionMetadata) -> HistoryEntry {
    let display = metadata
        .title
        .as_deref()
        .and_then(|t| crate::history::title_utils::derive_session_title(t, 100))
        .unwrap_or_else(|| {
            let id_preview = metadata.session_id.chars().take(8).collect::<String>();
            format!("Session {id_preview}")
        });

    HistoryEntry {
        id: metadata.session_id.clone(),
        display,
        timestamp: metadata.updated_at,
        project: metadata.cwd.clone(),
        session_id: metadata.session_id.clone(),
        pasted_contents: serde_json::json!({}),
        agent_id: CanonicalAgentId::Codex,
        updated_at: metadata.updated_at,
        source_path: Some(metadata.source_path.clone()),
        parent_id: None,
        worktree_path: None,
        pr_number: None,
        worktree_deleted: None,
        session_lifecycle_state: Some(
            crate::db::repository::SessionLifecycleState::Persisted,
        ),
    }
}

fn to_history_entry_fast(metadata: &SessionMetadataFast) -> HistoryEntry {
    let display = metadata
        .title
        .as_deref()
        .and_then(|t| crate::history::title_utils::derive_session_title(t, 100))
        .unwrap_or_else(|| {
            let id_preview = metadata.session_id.chars().take(8).collect::<String>();
            format!("Session {id_preview}")
        });

    HistoryEntry {
        id: metadata.session_id.clone(),
        display,
        timestamp: metadata.updated_at,
        project: metadata.cwd.clone(),
        session_id: metadata.session_id.clone(),
        pasted_contents: serde_json::json!({}),
        agent_id: CanonicalAgentId::Codex,
        updated_at: metadata.updated_at,
        source_path: Some(metadata.source_path.clone()),
        parent_id: None,
        worktree_path: None,
        pr_number: None,
        worktree_deleted: None,
        session_lifecycle_state: Some(
            crate::db::repository::SessionLifecycleState::Persisted,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::constants::{MAX_PROJECTS_TO_SCAN, MAX_SESSIONS_PER_PROJECT};
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    #[test]
    fn to_history_entry_uses_title_when_present() {
        let metadata = SessionMetadata {
            session_id: "test-session-123".to_string(),
            cwd: "/home/user/project".to_string(),
            title: Some("My Test Session".to_string()),
            updated_at: 1705314600000,
            source_path: "/tmp/rollout.jsonl".to_string(),
        };

        let entry = to_history_entry(&metadata);

        assert_eq!(entry.display, "My Test Session");
        assert_eq!(entry.project, "/home/user/project");
        assert_eq!(entry.session_id, "test-session-123");
        assert_eq!(entry.agent_id, CanonicalAgentId::Codex);
        assert_eq!(entry.source_path.as_deref(), Some("/tmp/rollout.jsonl"));
    }

    #[test]
    fn to_history_entry_uses_session_id_preview_when_no_title() {
        let metadata = SessionMetadata {
            session_id: "abcdefgh-1234-5678".to_string(),
            cwd: "/project".to_string(),
            title: None,
            updated_at: 1705314600000,
            source_path: "/tmp/rollout.jsonl".to_string(),
        };

        let entry = to_history_entry(&metadata);

        assert_eq!(entry.display, "Session abcdefgh");
    }

    #[test]
    fn to_history_entry_uses_session_id_as_id() {
        let metadata = SessionMetadata {
            session_id: "codex-session-abc123".to_string(),
            cwd: "/project".to_string(),
            title: None,
            updated_at: 1705314600000,
            source_path: "/tmp/rollout.jsonl".to_string(),
        };

        let entry = to_history_entry(&metadata);

        assert_eq!(entry.id, "codex-session-abc123");
        assert_eq!(entry.id, entry.session_id);
    }

    #[test]
    fn scan_sessions_from_root_supports_discovery_and_sets_source_path() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        let path_a = path_str(temp_dir.path(), "2026/02/13/rollout-a.jsonl");
        let path_b = path_str(temp_dir.path(), "2026/02/13/rollout-b.jsonl");

        write_rollout_file(
            temp_dir.path(),
            "2026/02/13/rollout-a.jsonl",
            "session-a",
            "/workspace/a",
            "Fix alpha bug",
            "2026-02-13T10:00:00Z",
        );
        write_rollout_file(
            temp_dir.path(),
            "2026/02/13/rollout-b.jsonl",
            "session-b",
            "/workspace/b",
            "Fix beta bug",
            "2026-02-13T12:00:00Z",
        );

        let entries = scan_sessions_from_root(temp_dir.path(), &[]).expect("scan should succeed");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].session_id, "session-b");
        assert_eq!(entries[1].session_id, "session-a");
        assert_eq!(entries[0].source_path.as_deref(), Some(path_b.as_str()));
        assert_eq!(entries[1].source_path.as_deref(), Some(path_a.as_str()));
    }

    #[test]
    fn scan_sessions_from_root_filters_by_project_paths() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");
        write_rollout_file(
            temp_dir.path(),
            "2026/02/13/rollout-a.jsonl",
            "session-a",
            "/workspace/a",
            "Fix alpha bug",
            "2026-02-13T10:00:00Z",
        );
        write_rollout_file(
            temp_dir.path(),
            "2026/02/13/rollout-b.jsonl",
            "session-b",
            "/workspace/b",
            "Fix beta bug",
            "2026-02-13T12:00:00Z",
        );

        let entries = scan_sessions_from_root(temp_dir.path(), &["/workspace/a".to_string()])
            .expect("scan should succeed");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].session_id, "session-a");
        assert_eq!(entries[0].project, "/workspace/a");
    }

    #[test]
    fn scan_sessions_from_root_respects_project_and_session_limits() {
        let temp_dir = TempDir::new().expect("failed to create temp dir");

        for index in 0..(MAX_PROJECTS_TO_SCAN + 3) {
            let project = format!("/workspace/{index}");
            let session_id = format!("project-only-{index}");
            let timestamp = format!("2026-02-13T{:02}:00:00Z", index % 24);
            let file = format!("2026/02/13/rollout-project-{index}.jsonl");
            write_rollout_file(
                temp_dir.path(),
                &file,
                &session_id,
                &project,
                "Limit test",
                &timestamp,
            );
        }

        for index in 0..(MAX_SESSIONS_PER_PROJECT + 8) {
            let session_id = format!("session-in-one-project-{index}");
            let minute = index % 60;
            let second = (index / 60) % 60;
            let timestamp = format!("2026-02-13T10:{minute:02}:{second:02}Z");
            let file = format!("2026/02/13/rollout-one-project-{index}.jsonl");
            write_rollout_file(
                temp_dir.path(),
                &file,
                &session_id,
                "/workspace/one-project",
                "One project limit test",
                &timestamp,
            );
        }

        let discovery_entries =
            scan_sessions_from_root(temp_dir.path(), &[]).expect("discovery should succeed");
        let unique_projects: std::collections::HashSet<String> = discovery_entries
            .iter()
            .map(|entry| entry.project.clone())
            .collect();
        assert!(unique_projects.len() <= MAX_PROJECTS_TO_SCAN);

        let filtered_entries =
            scan_sessions_from_root(temp_dir.path(), &["/workspace/one-project".to_string()])
                .expect("filtered scan should succeed");
        assert_eq!(filtered_entries.len(), MAX_SESSIONS_PER_PROJECT);
    }

    fn write_rollout_file(
        root: &Path,
        relative_path: &str,
        session_id: &str,
        cwd: &str,
        user_message: &str,
        timestamp: &str,
    ) {
        let path = root.join(relative_path);
        let parent = path.parent().expect("path must have parent");
        fs::create_dir_all(parent).expect("failed to create directories");

        let session_meta = json!({
            "timestamp": timestamp,
            "type": "session_meta",
            "payload": {
                "id": session_id,
                "timestamp": timestamp,
                "cwd": cwd
            }
        });

        let user_event = json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "message": user_message
            }
        });

        let content = format!("{session_meta}\n{user_event}\n");
        fs::write(&path, content).expect("failed to write rollout file");
    }

    fn path_str(root: &Path, relative_path: &str) -> String {
        root.join(relative_path).to_string_lossy().to_string()
    }
}
