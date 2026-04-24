//! OpenCode history parser.
//!
//! Reads conversation history from OpenCode's storage files at:
//! `~/.local/share/opencode/storage`

use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use uuid::Uuid;

use super::types::{
    OpenCodeApiModel, OpenCodeApiPart, OpenCodeMessage, OpenCodeMessagePart, OpenCodeProject,
    OpenCodeSession,
};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::history::constants::{MAX_PROJECTS_TO_SCAN, MAX_SESSIONS_PER_PROJECT};
use crate::session_jsonl::types::HistoryEntry;
use serde::Deserialize;

/// Get the OpenCode storage directory.
/// OpenCode uses XDG standard paths (~/.local/share/opencode/storage) even on macOS,
/// so we check for that first before falling back to platform defaults.
pub fn get_storage_dir() -> Result<PathBuf> {
    // OpenCode uses XDG paths - check ~/.local/share first
    if let Some(home) = dirs::home_dir() {
        let xdg_path = home.join(".local/share/opencode/storage");
        if xdg_path.exists() {
            return Ok(xdg_path);
        }
    }

    // Fallback to platform default (for future compatibility)
    dirs::data_local_dir()
        .map(|d| d.join("opencode").join("storage"))
        .ok_or_else(|| anyhow!("Cannot determine data local directory"))
}

/// Scan all OpenCode projects and return a map of project hash to worktree path.
pub async fn scan_projects() -> Result<HashMap<String, String>> {
    let storage_dir = get_storage_dir()?;
    let projects_dir = storage_dir.join("project");

    if !projects_dir.exists() {
        tracing::info!("OpenCode projects directory not found: {:?}", projects_dir);
        return Ok(HashMap::new());
    }

    let mut project_map = HashMap::new();
    let mut read_dir = tokio::fs::read_dir(&projects_dir).await?;
    let mut projects_processed = 0usize;

    while let Some(entry) = read_dir.next_entry().await? {
        if projects_processed >= MAX_PROJECTS_TO_SCAN {
            break;
        }
        let path = entry.path();
        let file_type = entry.file_type().await?;
        if !file_type.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        match tokio::fs::read_to_string(&path).await {
            Ok(content) => match serde_json::from_str::<OpenCodeProject>(&content) {
                Ok(project) => {
                    project_map.insert(project.id.clone(), project.worktree.clone());
                    projects_processed += 1;
                    tracing::debug!(
                        project_id = %project.id,
                        worktree = %project.worktree,
                        "Found OpenCode project"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        file = %path.display(),
                        error = %e,
                        "Failed to parse OpenCode project file"
                    );
                }
            },
            Err(e) => {
                tracing::warn!(
                    file = %path.display(),
                    error = %e,
                    "Failed to read OpenCode project file"
                );
            }
        }
    }

    tracing::info!(count = project_map.len(), "Scanned OpenCode projects");

    Ok(project_map)
}

/// Scan OpenCode sessions and convert them to HistoryEntry.
/// Filters sessions by matching project paths.
pub async fn scan_sessions(project_paths: &[String]) -> Result<Vec<HistoryEntry>> {
    let storage_dir = get_storage_dir()?;
    let sessions_dir = storage_dir.join("session");

    if !sessions_dir.exists() {
        tracing::info!("OpenCode sessions directory not found: {:?}", sessions_dir);
        return Ok(Vec::new());
    }

    // First, scan projects to get hash -> path mapping
    let project_map = scan_projects().await?;

    // NEW: If no project paths provided, scan ALL sessions (discovery mode)
    let discovery_mode = project_paths.is_empty();

    // Build a set of project hashes that match the given project paths
    // Note: We never include "global" sessions - they are not tied to any project
    let mut matching_hashes = std::collections::HashSet::new();

    if !discovery_mode {
        for project_path in project_paths {
            // Find matching project hash
            for (hash, worktree) in &project_map {
                if worktree == project_path {
                    matching_hashes.insert(hash.clone());
                    break;
                }
            }
        }
    }

    let mut entries = Vec::new();
    let mut skipped_global_projects = 0usize;

    // Scan session directories
    let mut read_dir = tokio::fs::read_dir(&sessions_dir).await?;
    let mut projects_processed = 0usize;

    while let Some(entry) = read_dir.next_entry().await? {
        if discovery_mode && projects_processed >= MAX_PROJECTS_TO_SCAN {
            break;
        }
        let path = entry.path();
        let file_type = entry.file_type().await?;
        if !file_type.is_dir() {
            continue;
        }

        let project_hash = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Always skip global sessions - they are not tied to any project
        if project_hash == "global" {
            skipped_global_projects += 1;
            continue;
        }

        // Skip if this project hash doesn't match (only when NOT in discovery mode)
        if !discovery_mode && !matching_hashes.contains(&project_hash) {
            continue;
        }

        // Scan session files in this directory
        match scan_project_sessions(&path, &project_hash, &project_map).await {
            Ok(mut project_entries) => {
                entries.append(&mut project_entries);
                if discovery_mode {
                    projects_processed += 1;
                }
            }
            Err(e) => {
                tracing::warn!(
                    project_hash = %project_hash,
                    error = %e,
                    "Failed to scan OpenCode sessions for project"
                );
            }
        }
    }

    tracing::info!(
        count = entries.len(),
        skipped_global_projects,
        "Scanned OpenCode sessions"
    );

    Ok(entries)
}

/// Scan session files in a project directory.
/// Limited to 100 sessions per project for startup performance.
async fn scan_project_sessions(
    project_dir: &PathBuf,
    project_hash: &str,
    project_map: &HashMap<String, String>,
) -> Result<Vec<HistoryEntry>> {
    let mut entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(project_dir).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        // Stop after 100 sessions per project
        if entries.len() >= MAX_SESSIONS_PER_PROJECT {
            break;
        }

        let path = entry.path();
        if !entry.file_type().await?.is_file()
            || path.extension().and_then(|e| e.to_str()) != Some("json")
        {
            continue;
        }

        // Get file metadata for mtime
        let metadata = tokio::fs::metadata(&path).await?;
        let mtime = metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| anyhow!("File modification time is before UNIX epoch: {}", e))?
            .as_secs() as i64;

        match tokio::fs::read_to_string(&path).await {
            Ok(content) => {
                match serde_json::from_str::<OpenCodeSession>(&content) {
                    Ok(session) => {
                        // Get project path from hash
                        let project_path = if project_hash == "global" {
                            "global".to_string()
                        } else {
                            project_map
                                .get(project_hash)
                                .cloned()
                                .unwrap_or_else(|| format!("unknown:{}", project_hash))
                        };

                        // Convert to HistoryEntry
                        let history_entry = to_history_entry(
                            &session,
                            &project_path,
                            mtime,
                            Some(path.to_string_lossy().to_string()),
                        );
                        entries.push(history_entry);
                    }
                    Err(e) => {
                        tracing::warn!(
                            file = %path.display(),
                            error = %e,
                            "Failed to parse OpenCode session file"
                        );
                    }
                }
            }
            Err(e) => {
                tracing::warn!(
                    file = %path.display(),
                    error = %e,
                    "Failed to read OpenCode session file"
                );
            }
        }
    }

    Ok(entries)
}

/// Convert an OpenCode session to a HistoryEntry.
fn to_history_entry(
    session: &OpenCodeSession,
    project_path: &str,
    mtime: i64,
    source_path: Option<String>,
) -> HistoryEntry {
    let display = session.title.clone().unwrap_or_else(|| {
        let id_preview = session.id.chars().take(8).collect::<String>();
        format!("Session {}", id_preview)
    });

    HistoryEntry {
        id: Uuid::new_v5(&Uuid::NAMESPACE_URL, session.id.as_bytes()).to_string(),
        display,
        timestamp: session.time.created,
        project: project_path.to_string(),
        session_id: session.id.clone(),
        pasted_contents: serde_json::json!({}),
        agent_id: CanonicalAgentId::OpenCode,
        updated_at: session.time.updated.max(session.time.created).max(mtime),
        source_path,
        parent_id: session.parent_id.clone(),
        worktree_path: None,
        pr_number: None,
        pr_link_mode: None,
        worktree_deleted: None,
        session_lifecycle_state: Some(crate::db::repository::SessionLifecycleState::Persisted),
        sequence_id: None,
    }
}

/// Minimal struct for deserializing message files from disk.
/// OpenCode stores messages at `storage/message/{session_id}/{message_id}.json`.
///
/// Separate from `OpenCodeStoredMessage` because the disk format uses a nested
/// `model: { providerID, modelID }` object, while `OpenCodeStoredMessage` uses
/// flat `model_id` / `provider_id` fields (matching an older format).
#[derive(Debug, Deserialize)]
struct DiskMessage {
    id: String,
    #[serde(rename = "sessionID")]
    session_id: String,
    role: String,
    time: super::types::OpenCodeMessageTime,
    #[serde(default)]
    model: Option<OpenCodeApiModel>,
}

/// Validate that a string is safe to use as a path segment (no traversal).
fn validate_path_segment(segment: &str, label: &str) -> Result<()> {
    if segment.is_empty()
        || segment.contains('/')
        || segment.contains('\\')
        || segment.contains("..")
        || segment == "."
    {
        anyhow::bail!(
            "Invalid {}: contains path traversal characters: {}",
            label,
            segment
        );
    }
    Ok(())
}

/// Load a full OpenCode session from local storage files (no HTTP server needed).
///
/// Reads messages from `storage/message/{session_id}/` and parts from
/// `storage/part/{message_id}/`, then converts to `SessionThreadSnapshot` using
/// the same converter as the HTTP API path.
///
/// Uses a two-phase parallel approach:
/// 1. Read all message files concurrently
/// 2. Read all part files for all messages concurrently
///
/// # Arguments
/// * `session_id` - The OpenCode session ID (e.g., "ses_xxxxx")
/// * `source_path` - Optional path to the session metadata file (for title)
///
/// # Returns
/// `Some(SessionThreadSnapshot)` if messages were found on disk, `None` otherwise
pub async fn load_session_from_disk(
    session_id: &str,
    source_path: Option<&str>,
) -> Result<Option<SessionThreadSnapshot>> {
    validate_path_segment(session_id, "session_id")?;

    let storage_dir = get_storage_dir()?;
    let messages_dir = storage_dir.join("message").join(session_id);

    tracing::info!(
        session_id = %session_id,
        messages_dir = %messages_dir.display(),
        source_path = ?source_path,
        "Loading OpenCode session from disk"
    );

    // Phase 0: Read session title and list message files concurrently
    let (session_title, msg_dir_result) = tokio::join!(
        read_session_title(source_path),
        tokio::fs::read_dir(&messages_dir),
    );

    let mut read_dir = match msg_dir_result {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            tracing::info!(
                session_id = %session_id,
                messages_dir = %messages_dir.display(),
                "No local message directory found for OpenCode session"
            );
            return Ok(None);
        }
        Err(e) => return Err(e.into()),
    };

    // Collect all message file paths first (directory listing is cheap)
    let mut msg_paths: Vec<PathBuf> = Vec::new();
    while let Some(entry) = read_dir.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if !entry.file_type().await?.is_file() {
            continue;
        }
        msg_paths.push(path);
    }

    if msg_paths.is_empty() {
        tracing::info!(
            session_id = %session_id,
            messages_dir = %messages_dir.display(),
            "No message files found in local OpenCode storage"
        );
        return Ok(None);
    }

    tracing::info!(
        session_id = %session_id,
        message_file_count = msg_paths.len(),
        "Found message files on disk, parsing"
    );

    // Phase 1: Read and parse all message files concurrently
    let session_id_owned = session_id.to_string();
    let mut join_set = tokio::task::JoinSet::new();
    for path in msg_paths {
        let sid = session_id_owned.clone();
        join_set.spawn(async move {
            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|e| {
                    tracing::warn!(
                        file = %path.display(),
                        error = %e,
                        "Failed to read OpenCode message file"
                    );
                })
                .ok()?;

            let disk_msg: DiskMessage = serde_json::from_str(&content)
                .map_err(|e| {
                    tracing::warn!(
                        file = %path.display(),
                        error = %e,
                        "Failed to parse OpenCode message file"
                    );
                })
                .ok()?;

            // Skip messages from other sessions
            if disk_msg.session_id != sid {
                return None;
            }

            // Validate message ID before using in path construction
            if validate_path_segment(&disk_msg.id, "message_id").is_err() {
                tracing::warn!(message_id = %disk_msg.id, "Skipping message with invalid ID");
                return None;
            }

            Some(disk_msg)
        });
    }

    let mut disk_messages: Vec<DiskMessage> = Vec::new();
    while let Some(result) = join_set.join_next().await {
        if let Ok(Some(msg)) = result {
            disk_messages.push(msg);
        }
    }

    if disk_messages.is_empty() {
        tracing::info!(
            session_id = %session_id,
            "No valid messages found after parsing in local OpenCode storage"
        );
        return Ok(None);
    }

    tracing::info!(
        session_id = %session_id,
        parsed_message_count = disk_messages.len(),
        "Parsed OpenCode messages from disk"
    );

    // Phase 2: Read all parts for all messages concurrently
    let mut parts_join_set = tokio::task::JoinSet::new();
    for msg in &disk_messages {
        let storage = storage_dir.clone();
        let msg_id = msg.id.clone();
        parts_join_set.spawn(async move {
            let parts = read_message_parts(&storage, &msg_id).await;
            (msg_id, parts)
        });
    }

    let mut parts_by_message: HashMap<String, Vec<OpenCodeApiPart>> = HashMap::new();
    while let Some(result) = parts_join_set.join_next().await {
        if let Ok((msg_id, parts)) = result {
            parts_by_message.insert(msg_id, parts);
        }
    }

    // Phase 3: Assemble messages with their parts
    let mut messages: Vec<OpenCodeMessage> = Vec::with_capacity(disk_messages.len());
    for disk_msg in disk_messages {
        let parts = parts_by_message.remove(&disk_msg.id).unwrap_or_default();

        let converted_parts: Vec<OpenCodeMessagePart> =
            parts.into_iter().map(convert_api_part).collect();

        let model_str = disk_msg
            .model
            .as_ref()
            .map(|m| format!("{}/{}", m.provider_id, m.model_id));

        messages.push(OpenCodeMessage {
            id: disk_msg.id,
            role: disk_msg.role,
            parts: converted_parts,
            model: model_str,
            timestamp: Some(disk_msg.time.created.to_string()),
        });
    }

    // Sort messages by timestamp (ascending)
    messages.sort_unstable_by(|a, b| {
        let ts_a = a
            .timestamp
            .as_ref()
            .and_then(|t| t.parse::<i64>().ok())
            .unwrap_or(0);
        let ts_b = b
            .timestamp
            .as_ref()
            .and_then(|t| t.parse::<i64>().ok())
            .unwrap_or(0);
        ts_a.cmp(&ts_b)
    });

    tracing::info!(
        session_id = %session_id,
        message_count = messages.len(),
        "Loaded OpenCode session from local disk"
    );

    let snapshot = crate::session_converter::convert_opencode_messages_to_session(messages)
        .map_err(|e| anyhow!("Failed to convert OpenCode disk session: {}", e))?;

    let resolved_title = session_title
        .filter(|t| !t.is_empty())
        .unwrap_or(snapshot.title);

    Ok(Some(SessionThreadSnapshot {
        entries: snapshot.entries,
        title: resolved_title,
        created_at: snapshot.created_at,
        current_mode_id: snapshot.current_mode_id,
    }))
}

pub async fn load_thread_snapshot_from_disk(
    session_id: &str,
    source_path: Option<&str>,
) -> Result<Option<SessionThreadSnapshot>> {
    load_session_from_disk(session_id, source_path).await
}

/// Read the session title from the session metadata file on disk.
async fn read_session_title(source_path: Option<&str>) -> Option<String> {
    let sp = source_path?;
    let content = tokio::fs::read_to_string(sp).await.ok()?;
    let session: OpenCodeSession = serde_json::from_str(&content).ok()?;
    session.title
}

/// Read all part files for a message from `storage/part/{message_id}/`.
async fn read_message_parts(
    storage_dir: &std::path::Path,
    message_id: &str,
) -> Vec<OpenCodeApiPart> {
    let parts_dir = storage_dir.join("part").join(message_id);

    let mut read_dir = match tokio::fs::read_dir(&parts_dir).await {
        Ok(rd) => rd,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    parts_dir = %parts_dir.display(),
                    error = %e,
                    "Failed to read OpenCode parts directory"
                );
            }
            return Vec::new();
        }
    };

    let mut parts = Vec::new();

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match tokio::fs::read_to_string(&path).await {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(
                    file = %path.display(),
                    error = %e,
                    "Failed to read OpenCode part file"
                );
                continue;
            }
        };

        match serde_json::from_str::<OpenCodeApiPart>(&content) {
            Ok(part) => parts.push(part),
            Err(e) => {
                tracing::debug!(
                    file = %path.display(),
                    error = %e,
                    "Failed to parse OpenCode part file, skipping"
                );
            }
        }
    }

    // Sort parts by time start (if available)
    parts.sort_unstable_by_key(|p| p.time.as_ref().and_then(|t| t.start).unwrap_or(0));

    parts
}

/// Convert an OpenCode API part to an OpenCodeMessagePart.
///
/// Shared conversion logic used by both disk-based and HTTP API paths.
/// Takes ownership of the part to avoid unnecessary clones.
pub fn convert_api_part(part: OpenCodeApiPart) -> OpenCodeMessagePart {
    match part.part_type.as_str() {
        "text" | "reasoning" | "step-start" => OpenCodeMessagePart::Text {
            text: part.text.unwrap_or_default(),
        },
        "tool" | "tool-invocation" => {
            let tool_id = part.call_id.unwrap_or(part.id);
            let tool_name = part.tool.or(part.name).unwrap_or_default();
            let tool_input = part
                .state
                .as_ref()
                .and_then(|s| s.input.clone())
                .or(part.input)
                .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));

            OpenCodeMessagePart::ToolInvocation {
                id: tool_id,
                name: tool_name,
                input: tool_input,
                state: part.state,
            }
        }
        "tool-result" => {
            let tool_use_id = part.call_id.unwrap_or(part.id);
            let content = part
                .state
                .as_ref()
                .and_then(|s| s.output.clone())
                .or(part.text)
                .unwrap_or_default();

            OpenCodeMessagePart::ToolResult {
                tool_use_id,
                content,
            }
        }
        _ => OpenCodeMessagePart::Text {
            text: part.text.unwrap_or_default(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        convert_api_part, read_message_parts, read_session_title, scan_project_sessions,
        validate_path_segment, OpenCodeSession,
    };
    use crate::opencode_history::types::OpenCodeApiPart;
    use crate::opencode_history::{OpenCodeMessagePart, OpenCodeProject, OpenCodeTime};
    use std::collections::HashMap;
    use tempfile::tempdir;
    use uuid::Uuid;

    #[tokio::test]
    async fn scan_project_sessions_sets_source_path() {
        let temp_dir = tempdir().expect("temp dir");
        let project_dir = temp_dir.path().to_path_buf();
        let session_id = "session-123";
        let file_path = project_dir.join(format!("{}.json", session_id));

        let session = OpenCodeSession {
            id: session_id.to_string(),
            version: "1".to_string(),
            project_id: "hash123".to_string(),
            directory: "/project".to_string(),
            parent_id: None,
            title: Some("OpenCode Session".to_string()),
            time: OpenCodeTime {
                created: 10,
                updated: 20,
            },
        };

        tokio::fs::write(
            &file_path,
            serde_json::to_string(&session).expect("serialize"),
        )
        .await
        .expect("write session file");

        let project_hash = "hash123";
        let mut project_map = HashMap::new();
        project_map.insert(project_hash.to_string(), "/project".to_string());

        let entries = scan_project_sessions(&project_dir, project_hash, &project_map)
            .await
            .expect("scan sessions");

        let entry = entries.first().expect("entry");
        let expected_path = file_path.to_string_lossy().to_string();
        assert_eq!(entry.source_path, Some(expected_path));
    }

    #[test]
    fn to_history_entry_uses_deterministic_id() {
        let session = OpenCodeSession {
            id: "session-123".to_string(),
            version: "1".to_string(),
            project_id: "project-1".to_string(),
            directory: "/project".to_string(),
            title: None,
            time: OpenCodeTime {
                created: 1,
                updated: 2,
            },
            parent_id: None,
        };

        let entry = super::to_history_entry(&session, "/project", 0, None);
        let expected = Uuid::new_v5(&Uuid::NAMESPACE_URL, session.id.as_bytes()).to_string();

        assert_eq!(entry.id, expected);
    }

    #[test]
    fn opencode_project_without_updated_time_parses() {
        let raw = r#"{
			"id": "project-hash",
			"worktree": "/Users/example/Documents/acepe",
			"time": { "created": 1234 }
		}"#;

        let parsed: OpenCodeProject = serde_json::from_str(raw).expect("parse project");
        assert_eq!(parsed.time.created, 1234);
        assert_eq!(parsed.time.updated, 0);
    }

    // --- validate_path_segment tests ---

    #[test]
    fn validate_path_segment_accepts_normal_ids() {
        assert!(validate_path_segment("ses_abc123", "session_id").is_ok());
        assert!(validate_path_segment("msg-456-def", "message_id").is_ok());
    }

    #[test]
    fn validate_path_segment_rejects_traversal() {
        assert!(validate_path_segment("../etc", "id").is_err());
        assert!(validate_path_segment("foo/bar", "id").is_err());
        assert!(validate_path_segment("foo\\bar", "id").is_err());
        assert!(validate_path_segment("..", "id").is_err());
        assert!(validate_path_segment(".", "id").is_err());
        assert!(validate_path_segment("", "id").is_err());
    }

    // --- read_message_parts tests ---

    #[tokio::test]
    async fn read_message_parts_returns_empty_for_missing_dir() {
        let temp_dir = tempdir().expect("temp dir");
        let parts = read_message_parts(temp_dir.path(), "nonexistent-msg").await;
        assert!(parts.is_empty());
    }

    #[tokio::test]
    async fn read_message_parts_reads_and_sorts_parts() {
        let temp_dir = tempdir().expect("temp dir");
        let msg_id = "msg-001";
        let parts_dir = temp_dir.path().join("part").join(msg_id);
        tokio::fs::create_dir_all(&parts_dir)
            .await
            .expect("create parts dir");

        // Write two parts with different timestamps (second one first chronologically)
        let part_a = serde_json::json!({
            "id": "part-a",
            "sessionID": "ses-1",
            "messageID": msg_id,
            "type": "text",
            "text": "Second part",
            "time": { "start": 2000, "end": 2001 }
        });
        let part_b = serde_json::json!({
            "id": "part-b",
            "sessionID": "ses-1",
            "messageID": msg_id,
            "type": "text",
            "text": "First part",
            "time": { "start": 1000, "end": 1001 }
        });

        tokio::fs::write(
            parts_dir.join("part-a.json"),
            serde_json::to_string(&part_a).unwrap(),
        )
        .await
        .unwrap();
        tokio::fs::write(
            parts_dir.join("part-b.json"),
            serde_json::to_string(&part_b).unwrap(),
        )
        .await
        .unwrap();

        let parts = read_message_parts(temp_dir.path(), msg_id).await;
        assert_eq!(parts.len(), 2);
        // Should be sorted by time.start ascending
        assert_eq!(parts[0].id, "part-b"); // start=1000
        assert_eq!(parts[1].id, "part-a"); // start=2000
    }

    #[tokio::test]
    async fn read_message_parts_skips_malformed_files() {
        let temp_dir = tempdir().expect("temp dir");
        let msg_id = "msg-002";
        let parts_dir = temp_dir.path().join("part").join(msg_id);
        tokio::fs::create_dir_all(&parts_dir)
            .await
            .expect("create parts dir");

        // Write one valid part and one invalid part
        let valid_part = serde_json::json!({
            "id": "valid-part",
            "sessionID": "ses-1",
            "messageID": msg_id,
            "type": "text",
            "text": "Hello"
        });
        tokio::fs::write(
            parts_dir.join("valid.json"),
            serde_json::to_string(&valid_part).unwrap(),
        )
        .await
        .unwrap();
        tokio::fs::write(parts_dir.join("invalid.json"), "not valid json {{{")
            .await
            .unwrap();
        // Non-json file should be ignored
        tokio::fs::write(parts_dir.join("readme.txt"), "skip me")
            .await
            .unwrap();

        let parts = read_message_parts(temp_dir.path(), msg_id).await;
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].text.as_deref(), Some("Hello"));
    }

    // --- convert_api_part tests ---

    #[test]
    fn convert_api_part_text() {
        let part = OpenCodeApiPart {
            id: "p1".into(),
            session_id: "s1".into(),
            message_id: "m1".into(),
            part_type: "text".into(),
            text: Some("Hello world".into()),
            name: None,
            tool: None,
            call_id: None,
            input: None,
            snapshot: None,
            metadata: None,
            time: None,
            state: None,
        };
        let result = convert_api_part(part);
        match result {
            OpenCodeMessagePart::Text { text } => assert_eq!(text, "Hello world"),
            _ => panic!("Expected Text variant"),
        }
    }

    #[test]
    fn convert_api_part_tool_invocation() {
        let part = OpenCodeApiPart {
            id: "p2".into(),
            session_id: "s1".into(),
            message_id: "m1".into(),
            part_type: "tool-invocation".into(),
            text: None,
            name: Some("bash".into()),
            tool: None,
            call_id: Some("call-123".into()),
            input: Some(serde_json::json!({"command": "ls"})),
            snapshot: None,
            metadata: None,
            time: None,
            state: None,
        };
        let result = convert_api_part(part);
        match result {
            OpenCodeMessagePart::ToolInvocation {
                id, name, input, ..
            } => {
                assert_eq!(id, "call-123");
                assert_eq!(name, "bash");
                assert_eq!(input, serde_json::json!({"command": "ls"}));
            }
            _ => panic!("Expected ToolInvocation variant"),
        }
    }

    #[test]
    fn convert_api_part_tool_result() {
        let part = OpenCodeApiPart {
            id: "p3".into(),
            session_id: "s1".into(),
            message_id: "m1".into(),
            part_type: "tool-result".into(),
            text: Some("file1.txt\nfile2.txt".into()),
            name: None,
            tool: None,
            call_id: Some("call-123".into()),
            input: None,
            snapshot: None,
            metadata: None,
            time: None,
            state: None,
        };
        let result = convert_api_part(part);
        match result {
            OpenCodeMessagePart::ToolResult {
                tool_use_id,
                content,
            } => {
                assert_eq!(tool_use_id, "call-123");
                assert_eq!(content, "file1.txt\nfile2.txt");
            }
            _ => panic!("Expected ToolResult variant"),
        }
    }

    #[test]
    fn convert_api_part_unknown_type_falls_back_to_text() {
        let part = OpenCodeApiPart {
            id: "p4".into(),
            session_id: "s1".into(),
            message_id: "m1".into(),
            part_type: "some-future-type".into(),
            text: Some("content".into()),
            name: None,
            tool: None,
            call_id: None,
            input: None,
            snapshot: None,
            metadata: None,
            time: None,
            state: None,
        };
        let result = convert_api_part(part);
        match result {
            OpenCodeMessagePart::Text { text } => assert_eq!(text, "content"),
            _ => panic!("Expected Text variant"),
        }
    }

    // --- read_session_title tests ---

    #[tokio::test]
    async fn read_session_title_returns_title_from_session_file() {
        let temp_dir = tempdir().expect("temp dir");
        let session_file = temp_dir.path().join("session.json");

        let session = OpenCodeSession {
            id: "ses-1".into(),
            version: "1".into(),
            project_id: "proj-1".into(),
            directory: "/project".into(),
            parent_id: None,
            title: Some("My Session Title".into()),
            time: OpenCodeTime {
                created: 100,
                updated: 200,
            },
        };

        tokio::fs::write(&session_file, serde_json::to_string(&session).unwrap())
            .await
            .unwrap();

        let title = read_session_title(Some(session_file.to_str().unwrap())).await;
        assert_eq!(title, Some("My Session Title".to_string()));
    }

    #[tokio::test]
    async fn read_session_title_returns_none_for_missing_file() {
        let title = read_session_title(Some("/nonexistent/path.json")).await;
        assert_eq!(title, None);
    }

    #[tokio::test]
    async fn read_session_title_returns_none_when_no_path() {
        let title = read_session_title(None).await;
        assert_eq!(title, None);
    }

    /// Integration test: parse a real DiskMessage JSON from local storage.
    /// Verifies that DiskMessage can handle real-world OpenCode message files
    /// which may have extra fields (summary, agent, tools, etc.).
    #[test]
    fn disk_message_parses_real_format() {
        let json = r#"{
            "id": "msg_c8275abc5001NLeBhf2bGcLpwy",
            "sessionID": "ses_37d8a543cffegLBDTpO2GiaN62",
            "role": "user",
            "time": { "created": 1771715275722 },
            "summary": { "title": "Test title", "diffs": [] },
            "agent": "explore",
            "model": { "providerID": "openrouter", "modelID": "moonshotai/kimi-k2.5" },
            "tools": { "todowrite": false, "todoread": false, "task": false }
        }"#;

        let msg: super::DiskMessage = serde_json::from_str(json).expect("should parse DiskMessage");
        assert_eq!(msg.id, "msg_c8275abc5001NLeBhf2bGcLpwy");
        assert_eq!(msg.session_id, "ses_37d8a543cffegLBDTpO2GiaN62");
        assert_eq!(msg.role, "user");
        assert_eq!(msg.time.created, 1771715275722);
        assert!(msg.model.is_some());
        let model = msg.model.unwrap();
        assert_eq!(model.provider_id, "openrouter");
        assert_eq!(model.model_id, "moonshotai/kimi-k2.5");
    }

    /// Integration test: parse DiskMessage without optional fields.
    #[test]
    fn disk_message_parses_minimal_format() {
        let json = r#"{
            "id": "msg-1",
            "sessionID": "ses-1",
            "role": "assistant",
            "time": { "created": 100 }
        }"#;

        let msg: super::DiskMessage =
            serde_json::from_str(json).expect("should parse minimal DiskMessage");
        assert_eq!(msg.id, "msg-1");
        assert!(msg.model.is_none());
    }

    /// Integration test: load_session_from_disk with real local OpenCode data.
    /// Requires OpenCode storage at ~/.local/share/opencode/storage/.
    #[tokio::test]
    #[ignore] // Only runs manually: cargo test -p acepe disk_loads_real -- --ignored
    async fn disk_loads_real_opencode_session() {
        let storage_dir = super::get_storage_dir().expect("storage dir");
        let messages_dir = storage_dir.join("message");

        // Find first session with messages
        let mut rd = tokio::fs::read_dir(&messages_dir)
            .await
            .expect("read message dir");
        let first_session = rd
            .next_entry()
            .await
            .expect("next")
            .expect("at least one session");
        let session_id = first_session.file_name().to_string_lossy().to_string();

        eprintln!(
            "Testing load_session_from_disk with session_id={}",
            session_id
        );

        let result = super::load_session_from_disk(&session_id, None).await;
        match &result {
            Ok(Some(converted)) => {
                eprintln!(
                    "SUCCESS: title={:?}, entries={}",
                    converted.title,
                    converted.entries.len()
                );
                assert!(
                    !converted.entries.is_empty(),
                    "should have at least one entry"
                );
            }
            Ok(None) => panic!("load_session_from_disk returned None — no messages found"),
            Err(e) => panic!("load_session_from_disk returned error: {}", e),
        }
    }

    #[tokio::test]
    async fn read_session_title_returns_none_for_session_without_title() {
        let temp_dir = tempdir().expect("temp dir");
        let session_file = temp_dir.path().join("session.json");

        let session = OpenCodeSession {
            id: "ses-1".into(),
            version: "1".into(),
            project_id: "proj-1".into(),
            directory: "/project".into(),
            parent_id: None,
            title: None,
            time: OpenCodeTime {
                created: 100,
                updated: 200,
            },
        };

        tokio::fs::write(&session_file, serde_json::to_string(&session).unwrap())
            .await
            .unwrap();

        let title = read_session_title(Some(session_file.to_str().unwrap())).await;
        assert_eq!(title, None);
    }
}
