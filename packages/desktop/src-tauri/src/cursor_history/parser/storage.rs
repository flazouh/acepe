use anyhow::{anyhow, Result};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use std::path::{Path, PathBuf};

use super::get_cursor_home_dir;
use crate::cursor_history::types::CursorChatEntry;
use crate::history::constants::{MAX_PROJECTS_TO_SCAN, MAX_SESSIONS_PER_PROJECT};
use crate::path_safety::validate_path_segment;
use crate::session_jsonl::types::FullSession;

pub(super) async fn find_sqlite_store_db_for_session(
    chats_dir: &Path,
    session_id: &str,
) -> Result<Option<PathBuf>> {
    validate_path_segment(session_id, "session_id").map_err(anyhow::Error::msg)?;

    if !tokio::fs::try_exists(chats_dir).await.unwrap_or(false) {
        return Ok(None);
    }

    let mut project_dirs = tokio::fs::read_dir(chats_dir).await?;
    while let Some(project_entry) = project_dirs.next_entry().await? {
        let project_path = project_entry.path();
        let project_ft = match project_entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !project_ft.is_dir() {
            continue;
        }

        let store_db = project_path.join(session_id).join("store.db");
        if tokio::fs::try_exists(&store_db).await.unwrap_or(false) {
            return Ok(Some(store_db));
        }
    }

    Ok(None)
}

/// Look up an ACP-mode Cursor session's store.db by id.
///
/// ACP-mode sessions live under a flat `~/.cursor/acp-sessions/<session-id>/store.db`
/// layout (no project-hash directory level), unlike the interactive Cursor CLI which
/// uses `~/.cursor/chats/<project-hash>/<session-id>/store.db`.
pub(super) async fn find_acp_sessions_store_db_for_session(
    acp_sessions_dir: &Path,
    session_id: &str,
) -> Result<Option<PathBuf>> {
    validate_path_segment(session_id, "session_id").map_err(anyhow::Error::msg)?;

    if !tokio::fs::try_exists(acp_sessions_dir)
        .await
        .unwrap_or(false)
    {
        return Ok(None);
    }

    let store_db = acp_sessions_dir.join(session_id).join("store.db");
    if tokio::fs::try_exists(&store_db).await.unwrap_or(false) {
        Ok(Some(store_db))
    } else {
        Ok(None)
    }
}

/// Find and load a Cursor session by id from SQLite chat storage.
///
/// Searches in order:
/// 1. ACP-mode store: `~/.cursor/acp-sessions/<session-id>/store.db` (Acepe-launched cursor sessions)
/// 2. Interactive CLI store: `~/.cursor/chats/<project-hash>/<session-id>/store.db`
pub async fn find_sqlite_session_by_id(session_id: &str) -> Result<Option<FullSession>> {
    let acp_sessions_dir = get_cursor_acp_sessions_dir()?;
    if let Some(store_db_path) =
        find_acp_sessions_store_db_for_session(&acp_sessions_dir, session_id).await?
    {
        tracing::info!(
            session_id = %session_id,
            store_db = %store_db_path.display(),
            "Found Cursor session in ACP-mode store"
        );

        let workspace = read_acp_session_cwd(&acp_sessions_dir, session_id).await;
        let session = crate::history::cursor_sqlite_parser::parse_cursor_store_db(
            &store_db_path,
            session_id,
            workspace.as_deref(),
        )
        .await?;
        return Ok(Some(session));
    }

    let chats_dir = get_cursor_chats_dir()?;
    let Some(store_db_path) = find_sqlite_store_db_for_session(&chats_dir, session_id).await?
    else {
        return Ok(None);
    };

    tracing::info!(
        session_id = %session_id,
        store_db = %store_db_path.display(),
        "Found Cursor session in SQLite chat store"
    );

    // Workspace path recovery from hash isn't available here.
    let session = crate::history::cursor_sqlite_parser::parse_cursor_store_db(
        &store_db_path,
        session_id,
        None,
    )
    .await?;
    Ok(Some(session))
}

/// Read the `cwd` field from an ACP session's `meta.json` sidecar.
///
/// ACP-mode cursor sessions persist a `meta.json` next to `store.db` containing
/// `{"schemaVersion":1,"cwd":"...","title":"..."}`. The cwd is the workspace
/// path the agent was launched against — much more reliable than the MD5
/// reverse-lookup needed for `~/.cursor/chats/<hash>/`.
async fn read_acp_session_cwd(acp_sessions_dir: &Path, session_id: &str) -> Option<String> {
    let meta_path = acp_sessions_dir.join(session_id).join("meta.json");
    let bytes = tokio::fs::read(&meta_path).await.ok()?;
    #[derive(Deserialize)]
    struct AcpSessionMeta {
        cwd: Option<String>,
    }
    let meta: AcpSessionMeta = serde_json::from_slice(&bytes).ok()?;
    meta.cwd
}

/// Find a Cursor session by id across all supported persisted sources.
///
/// Search order:
/// 1. Transcript files (~/.cursor/projects/{slug}/agent-transcripts)
/// 2. SQLite chat stores (~/.cursor/chats/{hash}/{session-id}/store.db)
fn get_cursor_app_support_dir() -> Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .map(|h| h.join("Library/Application Support/Cursor"))
            .ok_or_else(|| anyhow!("Cannot determine home directory"))
    }

    #[cfg(not(target_os = "macos"))]
    {
        // TODO: Support Windows/Linux paths
        Err(anyhow!(
            "Workspace storage scanning not supported on this platform"
        ))
    }
}

/// Get the workspace storage directory.
fn get_workspace_storage_dir() -> Result<PathBuf> {
    get_cursor_app_support_dir().map(|d| d.join("User/workspaceStorage"))
}

/// Metadata for a composer entry from state.vscdb
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComposerHead {
    composer_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    created_at: Option<i64>,
    #[serde(default)]
    last_updated_at: Option<i64>,
    #[serde(default)]
    #[allow(dead_code)]
    unified_mode: Option<String>,
    #[serde(default)]
    subtitle: Option<String>,
}

/// Root structure for composer.composerData
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComposerData {
    all_composers: Vec<ComposerHead>,
}

/// Workspace.json structure
#[derive(Debug, Clone, Deserialize)]
struct WorkspaceJson {
    folder: String,
}

/// Scan all Cursor workspace storage for composer data.
///
/// This reads from ~/Library/Application Support/Cursor/User/workspaceStorage/{hash}/state.vscdb
/// and extracts composer metadata from the `composer.composerData` key.
pub async fn scan_workspace_composers(project_paths: &[String]) -> Result<Vec<CursorChatEntry>> {
    let workspace_storage_dir = match get_workspace_storage_dir() {
        Ok(dir) => dir,
        Err(e) => {
            tracing::debug!(error = %e, "Workspace storage not available");
            return Ok(Vec::new());
        }
    };

    scan_workspace_composers_in_dir(&workspace_storage_dir, project_paths).await
}

pub(super) async fn scan_workspace_composers_in_dir(
    workspace_storage_dir: &Path,
    project_paths: &[String],
) -> Result<Vec<CursorChatEntry>> {
    if !workspace_storage_dir.exists() {
        tracing::debug!(
            workspace_storage = %workspace_storage_dir.display(),
            "Cursor workspace storage directory not found"
        );
        return Ok(Vec::new());
    }

    let mut all_entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(workspace_storage_dir).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let workspace_path = entry.path();
        if !workspace_path.is_dir() {
            continue;
        }

        // Check for state.vscdb
        let state_db = workspace_path.join("state.vscdb");
        if !state_db.exists() {
            continue;
        }

        // Try to read workspace.json to get the folder path
        let workspace_json_path = workspace_path.join("workspace.json");
        let folder_path = if workspace_json_path.exists() {
            match tokio::fs::read_to_string(&workspace_json_path).await {
                Ok(content) => {
                    match serde_json::from_str::<WorkspaceJson>(&content) {
                        Ok(ws) => {
                            // Convert file:///path/to/folder to /path/to/folder
                            ws.folder.strip_prefix("file://").map(|s| s.to_string())
                        }
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            }
        } else {
            None
        };

        // Skip if this workspace doesn't match any of our project paths
        if !project_paths.is_empty() {
            if let Some(ref folder) = folder_path {
                let matches = project_paths
                    .iter()
                    .any(|pp| folder == pp || folder.starts_with(pp) || pp.starts_with(folder));
                if !matches {
                    continue;
                }
            } else {
                // No folder path and we have project filters - skip
                continue;
            }
        }

        // Parse composer data from state.vscdb
        match parse_workspace_composers(&state_db, folder_path.as_deref()).await {
            Ok(entries) => {
                if !entries.is_empty() {
                    tracing::debug!(
                        workspace = ?workspace_path.file_name(),
                        folder = ?folder_path,
                        count = entries.len(),
                        "Found workspace composers"
                    );
                    all_entries.extend(entries);
                }
            }
            Err(e) => {
                tracing::debug!(
                    workspace = ?workspace_path.file_name(),
                    error = %e,
                    "Failed to parse workspace composers"
                );
            }
        }
    }

    tracing::info!(
        total = all_entries.len(),
        "Scanned all Cursor workspace composers"
    );

    Ok(all_entries)
}

/// Parse composer entries from a workspace state.vscdb file.
async fn parse_workspace_composers(
    db_path: &Path,
    workspace_path: Option<&str>,
) -> Result<Vec<CursorChatEntry>> {
    let db_path_clone = db_path.to_path_buf();

    // Open SQLite and read composer.composerData
    let composer_data: Option<String> = tokio::task::spawn_blocking(move || {
        let conn = Connection::open_with_flags(
            &db_path_clone,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        conn.query_row(
            "SELECT value FROM ItemTable WHERE key = 'composer.composerData'",
            [],
            |row| row.get(0),
        )
        .ok()
        .ok_or_else(|| anyhow!("No composer.composerData found"))
    })
    .await??;

    let Some(data_json) = composer_data else {
        return Ok(Vec::new());
    };

    // Parse the JSON
    let composer_data: ComposerData = serde_json::from_str(&data_json)?;

    // Convert to CursorChatEntry
    let db_path_str = db_path.display().to_string();
    let entries: Vec<CursorChatEntry> = composer_data
        .all_composers
        .into_iter()
        .filter(|c| {
            // Filter out entries without names or with "untitled"
            c.name.as_ref().is_some_and(|n| !n.is_empty())
        })
        .map(|c| {
            let raw_title = c.name.or_else(|| {
                c.subtitle
                    .clone()
                    .or_else(|| Some(format!("Chat {}", &c.composer_id[..8])))
            });
            let title = raw_title.map(|t| crate::history::title_utils::normalize_display_title(&t));

            CursorChatEntry {
                id: c.composer_id,
                title,
                workspace_path: workspace_path.map(|s| s.to_string()),
                created_at: c.created_at,
                updated_at: c.last_updated_at.or(c.created_at),
                message_count: 0, // Not available in metadata
                source_path: Some(db_path_str.clone()),
            }
        })
        .collect();

    Ok(entries)
}

// ============================================
// SQLITE FORMAT PARSER (NEW CURSOR FORMAT)
// ============================================
// Uses shared CursorStoreMeta from history::cursor_sqlite_parser.

/// Get the Cursor chats directory (~/.cursor/chats).
fn get_cursor_chats_dir() -> Result<PathBuf> {
    get_cursor_home_dir().map(|h| h.join("chats"))
}

/// Get the Cursor ACP-sessions directory (~/.cursor/acp-sessions).
///
/// This is where `cursor-agent acp` (the ACP server cursor exposes for
/// programmatic clients like Acepe) persists its sessions. It is **separate
/// from** `~/.cursor/chats/` (interactive CLI) and `~/.cursor/projects/.../
/// agent-transcripts/` (exported transcripts).
fn get_cursor_acp_sessions_dir() -> Result<PathBuf> {
    get_cursor_home_dir().map(|h| h.join("acp-sessions"))
}

/// Scan ACP-mode Cursor sessions in `~/.cursor/acp-sessions/<id>/store.db`.
///
/// The layout is flat (one level: `<id>/store.db`, with a `meta.json` sidecar
/// containing the `cwd` workspace path). When `project_paths` is supplied, only
/// sessions whose `cwd` matches one of the supplied paths are returned.
async fn scan_acp_sessions_impl(
    acp_sessions_dir: &Path,
    project_paths: Option<&[String]>,
) -> Vec<CursorChatEntry> {
    if !tokio::fs::try_exists(acp_sessions_dir)
        .await
        .unwrap_or(false)
    {
        return Vec::new();
    }

    let project_filter: Option<std::collections::HashSet<&str>> =
        project_paths.map(|paths| paths.iter().map(|p| p.as_str()).collect());

    let mut entries = Vec::new();
    let mut read_dir = match tokio::fs::read_dir(acp_sessions_dir).await {
        Ok(rd) => rd,
        Err(error) => {
            tracing::warn!(
                dir = %acp_sessions_dir.display(),
                error = %error,
                "Failed to read ACP-sessions directory"
            );
            return entries;
        }
    };
    let mut sessions_processed = 0usize;

    while let Some(entry) = read_dir.next_entry().await.ok().flatten() {
        if sessions_processed >= MAX_SESSIONS_PER_PROJECT {
            break;
        }
        let session_dir = entry.path();
        let ft = match entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_dir() {
            continue;
        }

        let store_db = session_dir.join("store.db");
        if !tokio::fs::try_exists(&store_db).await.unwrap_or(false) {
            continue;
        }

        let cwd = match tokio::fs::read(session_dir.join("meta.json")).await {
            Ok(bytes) => {
                #[derive(Deserialize)]
                struct AcpSessionMeta {
                    cwd: Option<String>,
                }
                serde_json::from_slice::<AcpSessionMeta>(&bytes)
                    .ok()
                    .and_then(|m| m.cwd)
            }
            Err(_) => None,
        };

        if let (Some(filter), Some(cwd_value)) = (project_filter.as_ref(), cwd.as_deref()) {
            if !filter.contains(cwd_value) {
                continue;
            }
        }

        match parse_sqlite_chat(&store_db, "", cwd.as_deref()).await {
            Ok(Some(parsed)) => {
                entries.push(parsed);
                sessions_processed += 1;
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(
                    path = ?store_db,
                    error = %error,
                    "Failed to parse ACP-mode SQLite chat"
                );
            }
        }
    }

    tracing::info!(
        count = entries.len(),
        dir = %acp_sessions_dir.display(),
        "Scanned ACP-mode Cursor sessions"
    );
    entries
}

/// Scan SQLite-based Cursor chats. If `project_paths` is provided, resolves project hashes to
/// workspace paths via MD5; otherwise workspace_path is always None.
/// Limited to 100 projects and 100 sessions per project for startup performance.
async fn scan_sqlite_chats_impl(project_paths: Option<&[String]>) -> Result<Vec<CursorChatEntry>> {
    let chats_dir = get_cursor_chats_dir()?;
    let acp_sessions_dir = get_cursor_acp_sessions_dir()?;

    let mut all_entries = scan_acp_sessions_impl(&acp_sessions_dir, project_paths).await;

    if !tokio::fs::try_exists(&chats_dir).await.unwrap_or(false) {
        tracing::info!("Cursor chats directory not found: {:?}", chats_dir);
        return Ok(all_entries);
    }

    let hash_to_path: std::collections::HashMap<String, String> = project_paths
        .map(|paths| {
            paths
                .iter()
                .map(|p| {
                    let hash = format!("{:x}", md5::compute(p.as_bytes()));
                    (hash, p.clone())
                })
                .collect()
        })
        .unwrap_or_default();

    let mut read_dir = tokio::fs::read_dir(&chats_dir).await?;
    let mut projects_processed = 0usize;

    while let Some(project_entry) = read_dir.next_entry().await? {
        if projects_processed >= MAX_PROJECTS_TO_SCAN {
            break;
        }

        let project_path_dir = project_entry.path();
        let project_ft = match project_entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !project_ft.is_dir() {
            continue;
        }

        let project_hash = project_path_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let workspace_path = hash_to_path.get(&project_hash).cloned();

        let mut sessions_in_project = 0usize;
        if let Ok(mut agent_dir) = tokio::fs::read_dir(&project_path_dir).await {
            while let Some(agent_entry) = agent_dir.next_entry().await? {
                if sessions_in_project >= MAX_SESSIONS_PER_PROJECT {
                    break;
                }

                let agent_path = agent_entry.path();
                let agent_ft = match agent_entry.file_type().await {
                    Ok(ft) => ft,
                    Err(_) => continue,
                };
                if !agent_ft.is_dir() {
                    continue;
                }

                let store_db = agent_path.join("store.db");
                if !tokio::fs::try_exists(&store_db).await.unwrap_or(false) {
                    continue;
                }

                match parse_sqlite_chat(&store_db, &project_hash, workspace_path.as_deref()).await {
                    Ok(Some(entry)) => {
                        all_entries.push(entry);
                        sessions_in_project += 1;
                    }
                    Ok(None) => {}
                    Err(e) => {
                        tracing::warn!(path = ?store_db, error = %e, "Failed to parse SQLite chat");
                    }
                }
            }
        }

        projects_processed += 1;
    }

    tracing::info!(
        count = all_entries.len(),
        with_projects = project_paths.is_some(),
        "Scanned SQLite chats"
    );

    Ok(all_entries)
}

/// Scan all SQLite-based Cursor chats with project path mapping.
pub async fn scan_sqlite_chats_with_projects(
    project_paths: &[String],
) -> Result<Vec<CursorChatEntry>> {
    scan_sqlite_chats_impl(Some(project_paths)).await
}

/// Scan all SQLite-based Cursor chats from ~/.cursor/chats/ (no workspace path resolution).
pub async fn scan_sqlite_chats() -> Result<Vec<CursorChatEntry>> {
    scan_sqlite_chats_impl(None).await
}

/// Parse a single SQLite chat database.
async fn parse_sqlite_chat(
    db_path: &Path,
    _project_hash: &str,
    workspace_path: Option<&str>,
) -> Result<Option<CursorChatEntry>> {
    // Open SQLite connection (blocking operation)
    let db_path_clone = db_path.to_path_buf();
    let db_path_display = db_path.display().to_string();
    let workspace_owned = workspace_path.map(|s| s.to_string());

    let entry = tokio::task::spawn_blocking(move || -> Result<Option<CursorChatEntry>> {
        let conn = Connection::open_with_flags(
            &db_path_clone,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;

        // Read metadata from meta table
        let metadata_hex: Option<String> = conn
            .query_row("SELECT value FROM meta WHERE key = '0'", [], |row| {
                row.get(0)
            })
            .ok();

        let Some(metadata_hex) = metadata_hex else {
            return Ok(None);
        };

        let metadata_bytes = hex::decode(&metadata_hex)?;
        let metadata: crate::history::cursor_sqlite_parser::CursorStoreMeta =
            serde_json::from_slice(&metadata_bytes)?;

        // S8: shared resolution (same as full-load path)
        let title = crate::history::cursor_sqlite_parser::resolve_cursor_session_title(
            &conn,
            &metadata.name,
        );

        let created = metadata.created_at;
        Ok(Some(CursorChatEntry {
            id: metadata.agent_id.clone(),
            title: Some(title),
            created_at: metadata.created_at,
            updated_at: created,
            workspace_path: workspace_owned,
            message_count: 0,
            source_path: Some(db_path_display),
        }))
    })
    .await??;

    Ok(entry)
}

/// Build a diagnostic report for why a session got its title (or fallback).
/// Used by the debug_cursor_session_title binary to inspect a failing session.
pub(super) fn diagnose_title_sync(conn: &Connection) -> Result<String, anyhow::Error> {
    use std::fmt::Write;

    let mut out = String::new();
    use crate::history::cursor_sqlite_parser as cursor_parser;

    // Meta (shared struct)
    let metadata_hex: String = conn
        .query_row("SELECT value FROM meta WHERE key = '0'", [], |row| {
            row.get(0)
        })
        .map_err(|e| anyhow::anyhow!("meta table: {}", e))?;
    let metadata_bytes = hex::decode(&metadata_hex)?;
    let metadata: cursor_parser::CursorStoreMeta = serde_json::from_slice(&metadata_bytes)?;
    writeln!(out, "=== Meta ===")?;
    writeln!(out, "  agent_id: {}", metadata.agent_id)?;
    writeln!(out, "  name: {:?}", metadata.name)?;
    let resolved_title = cursor_parser::resolve_cursor_session_title(conn, &metadata.name);
    writeln!(
        out,
        "  resolved title (shared policy): {:?}",
        resolved_title
    )?;
    writeln!(out)?;

    // Blobs: use shared extraction for per-blob report
    let mut stmt = conn
        .prepare("SELECT data FROM blobs ORDER BY rowid")
        .map_err(|e| anyhow::anyhow!("prepare blobs: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            let data: Vec<u8> = row.get(0)?;
            Ok(data)
        })
        .map_err(|e| anyhow::anyhow!("query blobs: {}", e))?;

    for (blob_index, row) in rows.enumerate() {
        let data = row.map_err(|e| anyhow::anyhow!("blob row: {}", e))?;
        let (found_user_query, found_json_user) = cursor_parser::blob_title_candidates(&data);
        let text = String::from_utf8_lossy(&data);
        let preview: String = text
            .chars()
            .take(200)
            .collect::<String>()
            .replace('\n', " ");
        let more = if data.len() > 200 { "…" } else { "" };
        writeln!(out, "--- blob #{} ({} bytes) ---", blob_index, data.len())?;
        writeln!(out, "  preview: {}{}", preview, more)?;
        if let Some(q) = &found_user_query {
            let s: &str = q.as_str();
            writeln!(
                out,
                "  <user_query> found ({} chars): {:?}",
                q.len(),
                &s[..s.len().min(120)]
            )?;
        } else {
            writeln!(out, "  <user_query>: not found")?;
        }
        if let Some(c) = &found_json_user {
            let s: &str = c.as_str();
            writeln!(
                out,
                "  JSON role=user content ({} chars): {:?}",
                c.len(),
                &s[..s.len().min(120)]
            )?;
        } else {
            writeln!(out, "  JSON role=user: not found or empty")?;
        }
    }

    writeln!(out)?;
    writeln!(
        out,
        "=== Title derivation (shared first_meaningful_user_text_for_title) ==="
    )?;
    if let Some(t) = cursor_parser::first_meaningful_user_text_for_title(conn) {
        let s: &str = t.as_str();
        writeln!(
            out,
            "  first meaningful ({} chars): {:?}",
            t.len(),
            &s[..s.len().min(200)]
        )?;
        let derived = crate::history::title_utils::derive_session_title(&t, 100);
        writeln!(out, "  derive_session_title(100): {:?}", derived)?;
    } else {
        writeln!(out, "  (none — no blob yielded a derivable title)")?;
    }
    writeln!(out, "  final resolved title: {:?}", resolved_title)?;

    Ok(out)
}
