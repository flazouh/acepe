//! Cursor history parser.
//!
//! Reads conversation history from Cursor's agent transcripts stored at:
//! `~/.cursor/projects/{project-slug}/agent-transcripts/{session-id}.json`
//! plus modern JSONL transcript layouts under session subdirectories.
//!
//! This format is similar to Claude Code's history structure.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader};
use uuid::Uuid;

use super::types::CursorChatEntry;
use crate::acp::types::CanonicalAgentId;
use crate::history::constants::{MAX_PROJECTS_TO_SCAN, MAX_SESSIONS_PER_PROJECT};
use crate::session_jsonl::types::{
    ContentBlock, FullSession, HistoryEntry, OrderedMessage, SessionStats,
};

mod storage;
mod txt_transcript;

#[cfg(test)]
pub(crate) use txt_transcript::ParsingAnalysis;

/// Get the Cursor home directory (~/.cursor).
pub fn get_cursor_home_dir() -> Result<PathBuf> {
    dirs::home_dir()
        .map(|h| h.join(".cursor"))
        .ok_or_else(|| anyhow!("Cannot determine home directory"))
}

/// Get the Cursor projects directory (~/.cursor/projects).
pub fn get_cursor_projects_dir() -> Result<PathBuf> {
    get_cursor_home_dir().map(|h| h.join("projects"))
}

/// Convert a project path to Cursor's slug format.
/// `/Users/example/Documents/sample-repo` -> `Users-example-Documents-sample-repo`
pub fn path_to_slug(path: &str) -> String {
    path.trim_start_matches('/').replace('/', "-")
}

/// A code attachment in a Cursor transcript message.
/// Represents content from `<code_selection>` blocks within `<attached_files>`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct CodeAttachment {
    /// The file path of the attached code
    pub path: String,
    /// The line range (e.g., "1-10")
    pub lines: Option<String>,
    /// The actual code content
    pub content: String,
}

/// A message in a Cursor agent transcript.
/// Note: `text` is optional because tool messages have `toolResult` instead.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CursorTranscriptMessage {
    pub role: String,
    #[serde(default)]
    pub text: Option<String>,
    /// Code attachments from `<attached_files>` blocks
    #[serde(default)]
    pub attachments: Option<Vec<CodeAttachment>>,
}

#[derive(Debug, Clone, Deserialize)]
struct CursorJsonlTranscriptEntry {
    role: String,
    #[serde(default)]
    message: Option<CursorJsonlMessage>,
    #[serde(default)]
    content: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct CursorJsonlMessage {
    #[serde(default)]
    content: Option<serde_json::Value>,
}

/// Scan agent transcripts across projects (JSON format only).
/// When `project_paths` is non-empty, only scans matching project slugs.
/// For SQLite format, use `scan_sqlite_chats()`.
/// For combined results, use `scan_all_chats()`.
pub async fn scan_all_transcripts(project_paths: &[String]) -> Result<Vec<CursorChatEntry>> {
    let projects_dir = get_cursor_projects_dir()?;

    if !tokio::fs::try_exists(&projects_dir).await.unwrap_or(false) {
        tracing::info!("Cursor projects directory not found: {:?}", projects_dir);
        return Ok(Vec::new());
    }

    // Pre-compute target slugs for filtering (empty = scan all)
    let target_slugs: std::collections::HashSet<String> =
        project_paths.iter().map(|p| path_to_slug(p)).collect();

    let mut all_entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&projects_dir).await?;
    let mut projects_processed = 0usize;

    while let Some(project_entry) = read_dir.next_entry().await? {
        if projects_processed >= MAX_PROJECTS_TO_SCAN {
            break;
        }
        let project_path = project_entry.path();
        // Use DirEntry file_type (async, no extra stat) instead of blocking is_dir()
        let file_type = match project_entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }

        let project_slug = project_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Skip slugs that don't match when filtering is active
        if !target_slugs.is_empty() && !target_slugs.contains(&project_slug) {
            continue;
        }

        let workspace_path = resolve_workspace_path(&project_slug, project_paths);

        let transcripts_dir = project_path.join("agent-transcripts");
        if !tokio::fs::try_exists(&transcripts_dir)
            .await
            .unwrap_or(false)
        {
            continue;
        }

        projects_processed += 1;

        match scan_project_transcripts(&transcripts_dir, &workspace_path).await {
            Ok(entries) => {
                tracing::debug!(
                    project = %project_slug,
                    count = entries.len(),
                    "Found JSON agent transcripts"
                );
                all_entries.extend(entries);
            }
            Err(e) => {
                tracing::warn!(
                    project = %project_slug,
                    error = %e,
                    "Failed to scan JSON agent transcripts"
                );
            }
        }
    }

    tracing::info!(
        total = all_entries.len(),
        filtered = !target_slugs.is_empty(),
        "Scanned Cursor JSON transcripts"
    );

    Ok(all_entries)
}

/// Scan all Cursor chats across JSON and SQLite formats.
/// This combines results from `scan_all_transcripts()` and `scan_sqlite_chats()`.
///
/// Note: Workspace composer sessions (state.vscdb) are intentionally excluded because
/// they only contain metadata (title, timestamps) without full conversation content.
/// Including them would show sessions that fail to load when clicked.
///
/// Optionally accepts project paths to attempt hash-to-path mapping for SQLite chats.
pub async fn scan_all_chats_with_projects(
    project_paths: &[String],
) -> Result<Vec<CursorChatEntry>> {
    // Scan JSON and SQLite formats in parallel
    // (Workspace composers excluded - they only have metadata, not loadable content)
    let (json_result, sqlite_result) = tokio::join!(
        scan_all_transcripts(project_paths),
        scan_sqlite_chats_with_projects(project_paths)
    );

    let mut all_entries = json_result?;
    let sqlite_entries = sqlite_result?;

    all_entries.extend(sqlite_entries);

    // Deduplicate by ID (same session might appear in multiple formats)
    let mut seen_ids = std::collections::HashSet::new();
    all_entries.retain(|e| seen_ids.insert(e.id.clone()));

    tracing::info!(
        total = all_entries.len(),
        "Scanned all Cursor chats (JSON + SQLite)"
    );

    Ok(all_entries)
}

/// Scan all Cursor chats across both JSON and SQLite formats (without project mapping).
pub async fn scan_all_chats() -> Result<Vec<CursorChatEntry>> {
    scan_all_chats_with_projects(&[]).await
}

/// Convert a Cursor slug back to a path.
///
/// This is a best-effort fallback only. Cursor's slug format is lossy because
/// both path separators and literal hyphens are encoded as `-`.
pub fn slug_to_path(slug: &str) -> String {
    format!("/{}", slug.replace('-', "/"))
}

fn resolve_workspace_path(project_slug: &str, project_paths: &[String]) -> String {
    if let Some(project_path) = project_paths
        .iter()
        .find(|project_path| path_to_slug(project_path) == project_slug)
    {
        return project_path.clone();
    }

    slug_to_path(project_slug)
}

/// Scan agent transcripts in a specific project directory.
/// Limited to 100 sessions per project for startup performance.
/// Files are processed in parallel (up to 8 concurrent) for speed.
pub async fn scan_project_transcripts(
    transcripts_dir: &PathBuf,
    workspace_path: &str,
) -> Result<Vec<CursorChatEntry>> {
    use futures::stream::{self, StreamExt};

    let transcript_files = collect_transcript_files(transcripts_dir).await?;

    // Cap to MAX_SESSIONS_PER_PROJECT files before spawning parallel work
    let capped_files: Vec<_> = transcript_files
        .into_iter()
        .filter_map(|file_path| {
            let file_name = file_path.file_name()?.to_str()?;
            let extension = transcript_extension(&file_path)?;
            let session_id = file_name.trim_end_matches(extension).to_string();
            Some((file_path, session_id))
        })
        .take(MAX_SESSIONS_PER_PROJECT)
        .collect();

    let workspace = workspace_path.to_string();
    let entries: Vec<CursorChatEntry> = stream::iter(capped_files)
        .map(|(file_path, session_id)| {
            let ws = workspace.clone();
            async move {
                match extract_transcript_metadata(&file_path, &session_id, &ws).await {
                    Ok(Some(entry)) => Some(entry),
                    Ok(None) => None,
                    Err(e) => {
                        tracing::warn!(
                            file = %file_path.display(),
                            error = %e,
                            "Failed to parse transcript"
                        );
                        None
                    }
                }
            }
        })
        .buffer_unordered(8)
        .filter_map(|opt| async { opt })
        .collect()
        .await;

    Ok(entries)
}

async fn collect_transcript_files(transcripts_dir: &PathBuf) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut read_dir = tokio::fs::read_dir(transcripts_dir).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let entry_path = entry.path();
        let file_type = match entry.file_type().await {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if file_type.is_file() {
            if transcript_extension(&entry_path).is_some() {
                files.push(entry_path);
            }
            continue;
        }

        if !file_type.is_dir() {
            continue;
        }

        let mut nested_entries = match tokio::fs::read_dir(&entry_path).await {
            Ok(nested) => nested,
            Err(_) => continue,
        };

        while let Some(nested_entry) = nested_entries.next_entry().await? {
            let nested_path = nested_entry.path();
            let nested_type = match nested_entry.file_type().await {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };

            if nested_type.is_file() && transcript_extension(&nested_path).is_some() {
                files.push(nested_path);
            }
        }
    }

    Ok(files)
}

fn transcript_extension(path: &std::path::Path) -> Option<&'static str> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("json") => Some(".json"),
        Some("txt") => Some(".txt"),
        Some("jsonl") => Some(".jsonl"),
        _ => None,
    }
}

/// Extract metadata from a single transcript file.
/// Supports .json, .txt, and .jsonl transcript formats.
///
/// For .txt and .jsonl files, uses BufReader with early termination to avoid
/// reading entire files (some can be 10MB+). Only reads until the first user
/// message is found. Falls back to full read for .json files (JSON arrays
/// can't be partially parsed).
pub async fn extract_transcript_metadata(
    file_path: &PathBuf,
    session_id: &str,
    workspace_path: &str,
) -> Result<Option<CursorChatEntry>> {
    let extension = file_path.extension().and_then(|ext| ext.to_str());

    let title = match extension {
        Some("txt") => extract_title_fast_txt(file_path).await?,
        Some("jsonl") => extract_title_fast_jsonl(file_path).await?,
        // .json files are JSON arrays — must read fully
        _ => extract_title_full_read(file_path).await?,
    };

    // Get file modification time as timestamp
    let metadata = tokio::fs::metadata(file_path).await?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);

    Ok(Some(CursorChatEntry {
        id: session_id.to_string(),
        title,
        workspace_path: Some(workspace_path.to_string()),
        created_at: modified,
        updated_at: modified,
        message_count: 0, // Not needed for metadata scan
        source_path: Some(file_path.display().to_string()),
    }))
}

/// 64KB safety cap for BufReader-based extraction to prevent unbounded reads.
const FAST_READ_BYTE_CAP: usize = 64 * 1024;

/// Extract title from a .txt transcript using BufReader with early termination.
/// Reads line-by-line, stops at first user message.
async fn extract_title_fast_txt(file_path: &PathBuf) -> Result<Option<String>> {
    let file = tokio::fs::File::open(file_path).await?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut bytes_read = 0usize;
    let mut in_user_block = false;
    let mut user_text = String::new();

    while let Some(line) = lines.next_line().await? {
        bytes_read += line.len() + 1; // +1 for newline
        if bytes_read > FAST_READ_BYTE_CAP {
            break;
        }

        if line.starts_with("user:") {
            in_user_block = true;
            user_text.clear();
            continue;
        }

        if in_user_block {
            // End of user block: assistant marker or another user marker
            if line.starts_with("assistant:") || line.starts_with("A:") {
                break; // We have the first user message
            }
            user_text.push_str(&line);
            user_text.push('\n');
        }
    }

    if user_text.is_empty() {
        return Ok(None);
    }

    let extracted = txt_transcript::extract_user_text(&user_text);
    let trimmed = extracted.trim();
    if trimmed.is_empty() || txt_transcript::is_command_message(trimmed) {
        return Ok(None);
    }

    Ok(Some(txt_transcript::truncate_title(trimmed)))
}

/// Extract title from a .jsonl transcript using BufReader with early termination.
/// Reads line-by-line, stops at first user role entry.
async fn extract_title_fast_jsonl(file_path: &PathBuf) -> Result<Option<String>> {
    let file = tokio::fs::File::open(file_path).await?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut bytes_read = 0usize;

    while let Some(line) = lines.next_line().await? {
        bytes_read += line.len() + 1;
        if bytes_read > FAST_READ_BYTE_CAP {
            break;
        }

        let trimmed_line = line.trim();
        if trimmed_line.is_empty() {
            continue;
        }

        let entry: CursorJsonlTranscriptEntry = match serde_json::from_str(trimmed_line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        if entry.role != "user" {
            continue;
        }

        // Found first user message — extract title
        let raw_text = entry
            .message
            .as_ref()
            .and_then(|m| m.content.as_ref())
            .or(entry.content.as_ref())
            .map(extract_text_from_json_value)
            .unwrap_or_default();

        let (user_text, _) = txt_transcript::extract_user_content(&raw_text);
        let trimmed = user_text.trim();
        if trimmed.is_empty() || txt_transcript::is_command_message(trimmed) {
            continue; // Skip command messages, try next user message
        }

        return Ok(Some(txt_transcript::truncate_title(trimmed)));
    }

    Ok(None)
}

/// Fallback: full read for .json files (JSON arrays can't be partially parsed).
async fn extract_title_full_read(file_path: &PathBuf) -> Result<Option<String>> {
    let content = tokio::fs::read_to_string(file_path).await?;
    if content.trim().is_empty() {
        return Ok(None);
    }

    let messages = parse_transcript_messages(file_path, &content)?;
    if messages.is_empty() {
        return Ok(None);
    }

    Ok(txt_transcript::extract_title_from_messages(&messages))
}

/// Extract a display title from the first meaningful user message.
pub async fn discover_all_chats(project_paths: &[String]) -> Result<Vec<CursorChatEntry>> {
    // Scan all formats (JSON, SQLite, workspace storage), passing project paths for filtering
    let all_entries = scan_all_chats_with_projects(project_paths).await?;

    // Filter by project paths if provided
    if project_paths.is_empty() {
        return Ok(all_entries);
    }

    let filtered: Vec<CursorChatEntry> = all_entries
        .into_iter()
        .filter(|entry| {
            // Only include entries with a matching workspace_path
            // (entries without workspace_path are from unmapped sources and should be excluded)
            entry.workspace_path.as_ref().is_some_and(|wp| {
                project_paths
                    .iter()
                    .any(|pp| wp == pp || wp.starts_with(pp) || pp.starts_with(wp))
            })
        })
        .collect();

    Ok(filtered)
}

/// Convert CursorChatEntry to HistoryEntry for compatibility with existing system.
pub fn to_history_entry(entry: &CursorChatEntry) -> HistoryEntry {
    let timestamp = entry.updated_at.or(entry.created_at).unwrap_or(0);
    let updated_at = entry.updated_at.unwrap_or(timestamp);

    // Clean the title: strip artifact tags and truncate.
    // Falls back to short ID if title is entirely artifacts/commands.
    let id_fallback = entry.id[..8.min(entry.id.len())].to_string();
    let raw_title = entry.title.clone().unwrap_or_else(|| id_fallback.clone());
    let display =
        crate::history::title_utils::derive_session_title(&raw_title, 100).unwrap_or(id_fallback);

    HistoryEntry {
        id: Uuid::new_v4().to_string(),
        session_id: entry.id.clone(),
        display,
        project: entry.workspace_path.clone().unwrap_or_default(),
        timestamp,
        pasted_contents: serde_json::json!({}),
        agent_id: CanonicalAgentId::Cursor, // We're in cursor_history parser, so it's always Cursor
        updated_at,
        source_path: entry.source_path.clone(),
        parent_id: None,
        worktree_path: None,
        pr_number: None,
        worktree_deleted: None,
        session_lifecycle_state: Some(crate::db::repository::SessionLifecycleState::Persisted),
            sequence_id: None,
    }
}

/// Load a full conversation from a transcript file.
/// Supports .json, .txt, and .jsonl transcript formats.
pub async fn load_full_conversation(session_id: &str, project_path: &str) -> Result<FullSession> {
    let projects_dir = get_cursor_projects_dir()?;
    let slug = path_to_slug(project_path);
    let transcripts_dir = projects_dir.join(&slug).join("agent-transcripts");

    // Try legacy flat transcripts plus modern jsonl layouts
    let json_path = transcripts_dir.join(format!("{}.json", session_id));
    let txt_path = transcripts_dir.join(format!("{}.txt", session_id));
    let jsonl_path = transcripts_dir.join(format!("{}.jsonl", session_id));
    let nested_jsonl_path = transcripts_dir
        .join(session_id)
        .join(format!("{}.jsonl", session_id));

    let transcript_path = if tokio::fs::try_exists(&json_path).await.unwrap_or(false) {
        json_path
    } else if tokio::fs::try_exists(&txt_path).await.unwrap_or(false) {
        txt_path
    } else if tokio::fs::try_exists(&jsonl_path).await.unwrap_or(false) {
        jsonl_path
    } else if tokio::fs::try_exists(&nested_jsonl_path)
        .await
        .unwrap_or(false)
    {
        nested_jsonl_path
    } else {
        PathBuf::new() // Will trigger fallback search below
    };

    tracing::debug!(
        session_id = %session_id,
        project_path = %project_path,
        slug = %slug,
        expected_path = %transcript_path.display(),
        "Attempting to load Cursor session"
    );

    if !tokio::fs::try_exists(&transcript_path)
        .await
        .unwrap_or(false)
    {
        tracing::warn!(
            session_id = %session_id,
            project_path = %project_path,
            expected_path = %transcript_path.display(),
            "Session not found at expected path, searching across all projects"
        );

        // Try to find in any project (session_id might be in a different project)
        match find_transcript_by_id(session_id).await? {
            Some(session) => {
                tracing::info!(
                    session_id = %session_id,
                    found_in_project = %session.project_path,
                    "Found session in different project via fallback search"
                );
                return Ok(session);
            }
            None => {
                tracing::error!(
                    session_id = %session_id,
                    project_path = %project_path,
                    expected_path = %transcript_path.display(),
                    "Session not found in any project after fallback search"
                );
                return Err(anyhow!(
                    "Transcript not found: {} in project {} (searched across all projects)",
                    session_id,
                    project_path
                ));
            }
        }
    }

    parse_transcript_file(&transcript_path, session_id, project_path).await
}

/// Find a transcript by session ID across all projects.
pub async fn find_transcript_by_id(session_id: &str) -> Result<Option<FullSession>> {
    let projects_dir = get_cursor_projects_dir()?;

    if !projects_dir.exists() {
        tracing::debug!(
            session_id = %session_id,
            projects_dir = %projects_dir.display(),
            "Cursor projects directory does not exist"
        );
        return Ok(None);
    }

    tracing::debug!(
        session_id = %session_id,
        projects_dir = %projects_dir.display(),
        "Searching for session across all projects"
    );

    let mut read_dir = tokio::fs::read_dir(&projects_dir).await?;
    let mut searched_count = 0;

    while let Some(project_entry) = read_dir.next_entry().await? {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }

        searched_count += 1;
        let project_slug = project_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let workspace_path = slug_to_path(project_slug);

        // Try legacy flat transcripts plus modern jsonl layouts
        let json_path = project_path
            .join("agent-transcripts")
            .join(format!("{}.json", session_id));
        let txt_path = project_path
            .join("agent-transcripts")
            .join(format!("{}.txt", session_id));
        let jsonl_path = project_path
            .join("agent-transcripts")
            .join(format!("{}.jsonl", session_id));
        let nested_jsonl_path = project_path
            .join("agent-transcripts")
            .join(session_id)
            .join(format!("{}.jsonl", session_id));

        let transcript_path = if json_path.exists() {
            json_path
        } else if txt_path.exists() {
            txt_path
        } else if jsonl_path.exists() {
            jsonl_path
        } else if nested_jsonl_path.exists() {
            nested_jsonl_path
        } else {
            continue;
        };

        tracing::info!(
            session_id = %session_id,
            found_in_project = %workspace_path,
            project_slug = %project_slug,
            transcript_path = %transcript_path.display(),
            "Found session in project"
        );
        return Ok(Some(
            parse_transcript_file(&transcript_path, session_id, &workspace_path).await?,
        ));
    }

    tracing::debug!(
        session_id = %session_id,
        projects_searched = searched_count,
        "Session not found after searching all projects"
    );

    Ok(None)
}

/// Find a Cursor SQLite store.db path for a session id.
///
/// Layout:
/// ~/.cursor/chats/{project-hash}/{session-id}/store.db
pub async fn find_session_by_id(session_id: &str) -> Result<Option<FullSession>> {
    if let Some(session) = find_transcript_by_id(session_id).await? {
        return Ok(Some(session));
    }

    find_sqlite_session_by_id(session_id).await
}

/// Load a Cursor session directly from its source path.
/// This is O(1) vs O(n) search through all projects.
///
/// Supports:
/// - JSON/TXT/JSONL transcripts: ~/.cursor/projects/{slug}/agent-transcripts/{id}.json
/// - SQLite store.db: ~/.cursor/chats/{hash}/{agent}/store.db
/// - Workspace composer state.vscdb: Not supported (metadata only, no full messages)
pub async fn load_session_from_source(
    session_id: &str,
    source_path: &str,
) -> Result<Option<FullSession>> {
    use std::path::Path;

    crate::path_safety::validate_path_segment(session_id, "session_id")
        .map_err(anyhow::Error::msg)?;

    let path = Path::new(source_path);

    if !path.exists() {
        tracing::warn!(
            source_path = %source_path,
            session_id = %session_id,
            "Source file no longer exists"
        );
        return Ok(None);
    }

    // Restrict source_path to under Cursor home to prevent arbitrary file read
    let cursor_home = get_cursor_home_dir()?;
    let path_buf = path.to_path_buf();
    let cursor_home_buf = cursor_home.clone();
    let allowed = tokio::task::spawn_blocking(move || {
        let canonical_path = std::fs::canonicalize(&path_buf).ok()?;
        let canonical_home = std::fs::canonicalize(&cursor_home_buf).ok()?;
        canonical_path.starts_with(&canonical_home).then_some(())
    })
    .await
    .map_err(|e| anyhow!("spawn_blocking: {}", e))?;
    if allowed.is_none() {
        tracing::warn!(
            source_path = %source_path,
            "Source path is outside Cursor home, rejecting"
        );
        return Ok(None);
    }

    let extension = path.extension().and_then(|e| e.to_str());

    match extension {
        Some("json") | Some("txt") | Some("jsonl") => {
            // Transcript file - parse directly
            let workspace = extract_workspace_from_transcript_path(path);
            let result = parse_transcript_file(&path.to_path_buf(), session_id, &workspace).await;
            result.map(Some)
        }
        Some("db") => {
            // SQLite store.db - use cursor_sqlite_parser
            let workspace = extract_workspace_from_db_path(path);
            let result = crate::history::cursor_sqlite_parser::parse_cursor_store_db(
                path,
                session_id,
                workspace.as_deref(),
            )
            .await;
            result.map(Some)
        }
        Some("vscdb") => {
            // Workspace composer state.vscdb - metadata only, can't load full messages
            tracing::warn!(
                session_id = %session_id,
                source_path = %source_path,
                "Workspace composer sessions (state.vscdb) only contain metadata, not full messages"
            );
            Err(anyhow!(
                "Workspace composer sessions only contain metadata, not full conversation messages"
            ))
        }
        _ => {
            tracing::warn!(
                source_path = %source_path,
                extension = ?extension,
                "Unknown source file format for Cursor session"
            );
            Ok(None)
        }
    }
}

/// Extract workspace path from a transcript file path.
/// ~/.cursor/projects/{slug}/agent-transcripts/{id}.json -> slug_to_path(slug)
fn extract_workspace_from_transcript_path(path: &std::path::Path) -> String {
    // Path structures:
    // .../projects/{slug}/agent-transcripts/{id}.json
    // .../projects/{slug}/agent-transcripts/{id}.jsonl
    // .../projects/{slug}/agent-transcripts/{id}/{id}.jsonl
    for ancestor in path.ancestors() {
        if ancestor
            .file_name()
            .is_some_and(|name| name == "agent-transcripts")
        {
            if let Some(project_dir) = ancestor.parent() {
                let slug = project_dir
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy();
                return slug_to_path(&slug);
            }
        }
    }
    String::new()
}

/// Extract workspace path from a store.db path (if possible).
/// ~/.cursor/chats/{hash}/{agent}/store.db -> can't recover easily
fn extract_workspace_from_db_path(_path: &std::path::Path) -> Option<String> {
    // For SQLite store.db, we can't easily recover the workspace path from the path alone
    // because {hash} is an MD5 hash of the workspace path.
    // The workspace path would need to be passed in from the scan results.
    None
}

/// Parse a transcript file into a FullSession.
/// Supports .json, .txt, and .jsonl transcript formats.
pub async fn parse_transcript_file(
    file_path: &PathBuf,
    session_id: &str,
    project_path: &str,
) -> Result<FullSession> {
    let content = tokio::fs::read_to_string(file_path).await?;

    let messages = parse_transcript_messages(file_path, &content)?;

    // Get file modification time
    let metadata = tokio::fs::metadata(file_path).await?;
    let created_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| {
            chrono::DateTime::from_timestamp_millis(d.as_millis() as i64)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
        })
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    // Extract title
    let title = txt_transcript::extract_title_from_messages(&messages)
        .unwrap_or_else(|| "Cursor Conversation".to_string());

    // Convert messages to OrderedMessage format
    let mut ordered_messages = Vec::new();
    let mut stats = SessionStats {
        total_messages: 0,
        user_messages: 0,
        assistant_messages: 0,
        tool_uses: 0,
        tool_results: 0,
        thinking_blocks: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
    };

    for (idx, msg) in messages.iter().enumerate() {
        let ordered = parse_transcript_message(msg, idx, &mut stats);
        ordered_messages.push(ordered);
    }

    stats.total_messages = ordered_messages.len();

    Ok(FullSession {
        session_id: session_id.to_string(),
        project_path: project_path.to_string(),
        title,
        created_at,
        messages: ordered_messages,
        stats,
    })
}

fn parse_transcript_messages(
    file_path: &std::path::Path,
    content: &str,
) -> Result<Vec<CursorTranscriptMessage>> {
    match file_path.extension().and_then(|ext| ext.to_str()) {
        Some("txt") => Ok(txt_transcript::parse_txt_transcript_content(content)),
        Some("jsonl") => parse_jsonl_transcript_content(content),
        _ => Ok(serde_json::from_str(content)?),
    }
}

fn parse_jsonl_transcript_content(content: &str) -> Result<Vec<CursorTranscriptMessage>> {
    let mut messages = Vec::new();

    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let entry: CursorJsonlTranscriptEntry = serde_json::from_str(line)?;
        if entry.role != "user" && entry.role != "assistant" {
            continue;
        }

        let raw_text = entry
            .message
            .as_ref()
            .and_then(|message| message.content.as_ref())
            .or(entry.content.as_ref())
            .map(extract_text_from_json_value)
            .unwrap_or_default();

        if entry.role == "user" {
            let (user_text, attachments) = txt_transcript::extract_user_content(&raw_text);
            messages.push(CursorTranscriptMessage {
                role: entry.role,
                text: (!user_text.trim().is_empty()).then_some(user_text),
                attachments,
            });
            continue;
        }

        messages.push(CursorTranscriptMessage {
            role: entry.role,
            text: (!raw_text.trim().is_empty()).then_some(raw_text),
            attachments: None,
        });
    }

    Ok(messages)
}

fn extract_text_from_json_value(value: &serde_json::Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }

    if let Some(array) = value.as_array() {
        let parts = array
            .iter()
            .filter_map(extract_text_part)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        return parts.join("\n");
    }

    extract_text_part(value).unwrap_or_default()
}

fn extract_text_part(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.get("text").and_then(|item| item.as_str()) {
        return Some(text.to_string());
    }

    if let Some(content) = value.get("content") {
        let nested_text = extract_text_from_json_value(content);
        if !nested_text.is_empty() {
            return Some(nested_text);
        }
    }

    None
}

/// Parse a single transcript message to OrderedMessage format.
fn parse_transcript_message(
    msg: &CursorTranscriptMessage,
    idx: usize,
    stats: &mut SessionStats,
) -> OrderedMessage {
    match msg.role.as_str() {
        "user" => stats.user_messages += 1,
        "assistant" => stats.assistant_messages += 1,
        _ => {}
    }

    // Parse the text content for thinking blocks and tool calls
    let mut content_blocks =
        parse_message_content(msg.text.as_deref().unwrap_or(""), &msg.role, stats);

    // Add code attachments as content blocks
    if let Some(attachments) = &msg.attachments {
        for attachment in attachments {
            content_blocks.push(ContentBlock::CodeAttachment {
                path: attachment.path.clone(),
                lines: attachment.lines.clone(),
                content: attachment.content.clone(),
            });
        }
    }

    OrderedMessage {
        uuid: format!("msg-{}", idx),
        parent_uuid: None,
        role: msg.role.clone(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        content_blocks,
        model: None,
        usage: None,
        request_id: None,
        is_meta: false,
        source_tool_use_id: None, // Cursor doesn't support skill meta messages
        tool_use_result: None,    // Cursor doesn't have tool_use_result
        source_tool_assistant_uuid: None, // Cursor doesn't have source_tool_assistant_uuid
    }
}

/// Parse message content, extracting thinking blocks and cleaning up text.
fn parse_message_content(text: &str, role: &str, stats: &mut SessionStats) -> Vec<ContentBlock> {
    let mut blocks = Vec::new();

    if role == "assistant" {
        // Extract all <think>...</think> blocks first.
        let mut search_start = 0usize;
        while let Some(rel_start) = text[search_start..].find("<think>") {
            let think_start = search_start + rel_start;
            let content_start = think_start + "<think>".len();
            let Some(rel_end) = text[content_start..].find("</think>") else {
                break;
            };
            let think_end = content_start + rel_end;
            let thinking = text[content_start..think_end].trim();
            if !thinking.is_empty() {
                stats.thinking_blocks += 1;
                blocks.push(ContentBlock::Thinking {
                    thinking: thinking.to_string(),
                    signature: None,
                });
            }
            search_start = think_end + "</think>".len();
        }

        let cleaned_assistant = txt_transcript::sanitize_cursor_assistant_text(text);
        if !cleaned_assistant.is_empty() {
            blocks.push(ContentBlock::Text {
                text: cleaned_assistant,
            });
        }
        return blocks;
    }

    // For user messages, extract from <user_query> if present
    let cleaned_text = if role == "user" {
        txt_transcript::extract_user_text(text)
    } else {
        text.to_string()
    };

    if !cleaned_text.trim().is_empty() {
        blocks.push(ContentBlock::Text {
            text: cleaned_text.trim().to_string(),
        });
    }

    blocks
}

pub async fn has_cursor_history(project_path: &str) -> bool {
    let projects_dir = match get_cursor_projects_dir() {
        Ok(dir) => dir,
        Err(_) => return false,
    };

    let slug = path_to_slug(project_path);
    let transcripts_dir = projects_dir.join(&slug).join("agent-transcripts");

    transcripts_dir.exists()
}

/// Check if Cursor is installed.
pub fn is_cursor_installed() -> bool {
    get_cursor_home_dir().map(|d| d.exists()).unwrap_or(false)
}

#[cfg(test)]
pub(crate) fn parse_txt_transcript_content(content: &str) -> Vec<CursorTranscriptMessage> {
    txt_transcript::parse_txt_transcript_content(content)
}

#[cfg(test)]
pub(crate) fn analyze_transcript_parsing(content: &str) -> txt_transcript::ParsingAnalysis {
    txt_transcript::analyze_transcript_parsing(content)
}

#[cfg(test)]
fn extract_user_text(text: &str) -> String {
    txt_transcript::extract_user_text(text)
}

#[cfg(test)]
fn truncate_title(title: &str) -> String {
    txt_transcript::truncate_title(title)
}

#[cfg(test)]
fn is_command_message(content: &str) -> bool {
    txt_transcript::is_command_message(content)
}

#[cfg(test)]
fn sanitize_cursor_assistant_text(text: &str) -> String {
    txt_transcript::sanitize_cursor_assistant_text(text)
}

pub async fn scan_workspace_composers(project_paths: &[String]) -> Result<Vec<CursorChatEntry>> {
    storage::scan_workspace_composers(project_paths).await
}

#[cfg(test)]
pub(crate) async fn scan_workspace_composers_in_dir_for_tests(
    workspace_storage_dir: &Path,
    project_paths: &[String],
) -> Result<Vec<CursorChatEntry>> {
    storage::scan_workspace_composers_in_dir(workspace_storage_dir, project_paths).await
}

pub async fn scan_sqlite_chats_with_projects(
    project_paths: &[String],
) -> Result<Vec<CursorChatEntry>> {
    storage::scan_sqlite_chats_with_projects(project_paths).await
}

pub async fn scan_sqlite_chats() -> Result<Vec<CursorChatEntry>> {
    storage::scan_sqlite_chats().await
}

#[cfg(test)]
async fn find_sqlite_store_db_for_session(
    chats_dir: &Path,
    session_id: &str,
) -> Result<Option<PathBuf>> {
    storage::find_sqlite_store_db_for_session(chats_dir, session_id).await
}

pub async fn find_sqlite_session_by_id(session_id: &str) -> Result<Option<FullSession>> {
    storage::find_sqlite_session_by_id(session_id).await
}

/// Resolve the store.db path for a Cursor session (SQLite chat storage).
/// Returns None if the session is not found under ~/.cursor/chats.
pub async fn get_sqlite_store_db_path_for_session(session_id: &str) -> Result<Option<PathBuf>> {
    let chats_dir = get_cursor_home_dir()?.join("chats");
    storage::find_sqlite_store_db_for_session(&chats_dir, session_id).await
}

/// Produce a diagnostic report for why a session got its title (or fallback).
/// Opens the given store.db and reports meta, blob contents, and title derivation.
pub async fn diagnose_cursor_session_title_from_path(
    db_path: &std::path::Path,
) -> Result<String, anyhow::Error> {
    let path = db_path.to_path_buf();
    let report = tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        storage::diagnose_title_sync(&conn)
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking: {}", e))??;
    Ok(report)
}

#[cfg(test)]
mod tests;
