use super::*;
use std::path::Path;

fn indexed_source_path(file_path: String) -> Option<String> {
    SessionMetadataRepository::normalized_source_path(&file_path)
}

fn derive_title_from_converted_session(
    session: &crate::session_jsonl::types::ConvertedSession,
) -> Option<String> {
    for entry in &session.entries {
        if let crate::session_jsonl::types::StoredEntry::User { message, .. } = entry {
            let text = message
                .chunks
                .iter()
                .filter(|block| block.block_type == "text")
                .filter_map(|block| block.text.as_deref())
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                return crate::history::title_utils::derive_session_title(&text, 100);
            }
        }
    }

    None
}

async fn derive_indexed_session_title(
    app: &AppHandle,
    session_id: &str,
    project_path: &str,
    agent_id: &str,
    file_path: &str,
    worktree_path: Option<&str>,
    display: &str,
) -> String {
    let source_path = SessionMetadataRepository::normalized_source_path(file_path);

    if worktree_path.is_some() {
        if let Ok(Some(session)) = crate::history::commands::session_loading::get_unified_session(
            app.clone(),
            session_id.to_string(),
            project_path.to_string(),
            agent_id.to_string(),
            source_path,
        )
        .await
        {
            if let Some(title) = derive_title_from_converted_session(&session) {
                return title;
            }
            if !session.title.trim().is_empty() {
                return session.title;
            }
        }
    }

    crate::history::title_utils::derive_session_title(display, 100)
        .unwrap_or_else(|| session_id[..8.min(session_id.len())].to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn scan_project_sessions(
    app: AppHandle,
    project_paths: Vec<String>,
) -> Result<Vec<HistoryEntry>, String> {
    let db = app.try_state::<DbConn>().map(|s| s.inner().clone());
    let mut sorted = project_paths.clone();
    sorted.sort();
    let key = format!("scan:{}", sorted.join("|"));

    SCAN_CACHE
        .get_or_fetch(key, || async {
            scan_project_sessions_inner(app, project_paths, db).await
        })
        .await
}

async fn scan_project_sessions_inner(
    app: AppHandle,
    project_paths: Vec<String>,
    db: Option<DbConn>,
) -> Result<Vec<HistoryEntry>, String> {
    let scan_start = Instant::now();

    // Try SQLite index for ALL agents (fast path: ~10-50ms)
    let from_index = match &db {
        Some(db) => {
            let idx_start = Instant::now();
            let result = SessionMetadataRepository::get_for_projects(db, &project_paths).await;
            let idx_ms = idx_start.elapsed().as_millis();
            match &result {
                Ok(entries) => tracing::info!(
                    elapsed_ms = idx_ms,
                    count = entries.len(),
                    "SQLite index query completed"
                ),
                Err(e) => tracing::warn!(
                    elapsed_ms = idx_ms,
                    error = %e,
                    "SQLite index query failed"
                ),
            }
            result.ok().filter(|entries| !entries.is_empty())
        }
        None => {
            tracing::warn!("No DbConn available — skipping index fast path");
            None
        }
    };

    if let Some(indexed) = from_index {
        let count = indexed.len();
        // DB already returns ORDER BY timestamp DESC — no sort needed
        let mut entries: Vec<HistoryEntry> = Vec::with_capacity(count);
        for s in indexed {
            let session_lifecycle_state = s.lifecycle_state();
            let display = derive_indexed_session_title(
                &app,
                &s.id,
                &s.project_path,
                &s.agent_id,
                &s.file_path,
                s.worktree_path.as_deref(),
                &s.display,
            )
            .await;
            let worktree_deleted = s
                .worktree_path
                .as_ref()
                .map(|path| !Path::new(path).exists());

            entries.push(HistoryEntry {
                id: s.id.clone(),
                display,
                timestamp: s.timestamp,
                project: s.project_path,
                session_id: s.id,
                pasted_contents: serde_json::json!({}),
                agent_id: CanonicalAgentId::parse(&s.agent_id),
                updated_at: s.timestamp,
                source_path: indexed_source_path(s.file_path),
                parent_id: None,
                worktree_path: s.worktree_path,
                worktree_deleted,
                pr_number: s.pr_number.map(|n| n as i64),
                session_lifecycle_state: Some(session_lifecycle_state),
            });
        }
        tracing::info!(
            total_entries = count,
            total_ms = scan_start.elapsed().as_millis(),
            source = "index",
            "Session scan complete (from index)"
        );
        return Ok(entries);
    }

    // Index empty — full scan all agents in parallel
    tracing::info!("SQLite index empty, falling back to file scan");
    let file_scan_start = Instant::now();

    // tokio::join! polls on the same task (no Send required), so we share the slice
    let (claude_result, cursor_result, opencode_result, codex_result) = tokio::join!(
        session_jsonl_parser::scan_projects(&project_paths),
        cursor_parser::discover_all_chats(&project_paths),
        opencode_parser::scan_sessions(&project_paths),
        codex_scanner::scan_sessions(&project_paths),
    );

    let file_scan_ms = file_scan_start.elapsed().as_millis();
    let mut entries = Vec::new();

    let claude_count = match claude_result {
        Ok(claude_entries) => {
            let count = claude_entries.len();
            entries.extend(claude_entries);
            count
        }
        Err(e) => {
            tracing::warn!(error = %e, "Claude scanner failed");
            0
        }
    };

    let cursor_count = match cursor_result {
        Ok(cursor_entries) => {
            let count = cursor_entries.len();
            entries.extend(cursor_entries.iter().map(cursor_parser::to_history_entry));
            count
        }
        Err(e) => {
            tracing::warn!(error = %e, "Cursor scanner failed");
            0
        }
    };

    let opencode_count = match opencode_result {
        Ok(opencode_entries) => {
            let count = opencode_entries.len();
            entries.extend(opencode_entries);
            count
        }
        Err(e) => {
            tracing::warn!(error = %e, "OpenCode scanner failed");
            0
        }
    };

    let codex_count = match codex_result {
        Ok(codex_entries) => {
            let count = codex_entries.len();
            entries.extend(codex_entries);
            count
        }
        Err(e) => {
            tracing::warn!(error = %e, "Codex scanner failed");
            0
        }
    };

    tracing::info!(
        claude_count,
        cursor_count,
        opencode_count,
        codex_count,
        total_entries = entries.len(),
        file_scan_ms,
        total_ms = scan_start.elapsed().as_millis(),
        source = "files",
        "Session scan complete (from file scan)"
    );

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::indexed_source_path;

    #[test]
    fn test_indexed_source_path_hides_worktree_sentinel() {
        assert_eq!(
            indexed_source_path("__worktree__/ses_legacy".to_string()),
            None
        );
    }
}

/// Discover all projects with sessions from all agents.
///
/// Scans Claude Code, Cursor, OpenCode, and Codex sources directly without requiring
/// projects to exist in the database first. This resolves the chicken-and-egg
/// problem where the "Open Project" dialog couldn't show sessions because no
/// projects were imported yet.
///
/// Results are cached for 5 seconds and concurrent identical requests coalesce.
///
/// # Returns
/// Vector of history entries sorted by timestamp (most recent first)
#[tauri::command]
#[specta::specta]
pub async fn discover_all_projects_with_sessions() -> Result<Vec<HistoryEntry>, String> {
    SCAN_CACHE
        .get_or_fetch("discover".to_string(), || async {
            discover_all_projects_with_sessions_inner().await
        })
        .await
}

async fn discover_all_projects_with_sessions_inner() -> Result<Vec<HistoryEntry>, String> {
    // Scan all sources in parallel
    let (claude_result, cursor_result, opencode_result, codex_result) = tokio::join!(
        session_jsonl_parser::scan_all_threads(),
        cursor_parser::discover_all_chats(&[]),
        opencode_parser::scan_sessions(&[]),
        codex_scanner::scan_sessions(&[]),
    );

    let mut entries = Vec::new();

    // Collect Claude entries
    match claude_result {
        Ok(claude_entries) => entries.extend(claude_entries),
        Err(e) => tracing::warn!(error = %e, "Claude discovery failed"),
    }

    // Collect Cursor entries (need to convert to HistoryEntry)
    match cursor_result {
        Ok(cursor_entries) => {
            entries.extend(cursor_entries.iter().map(cursor_parser::to_history_entry));
        }
        Err(e) => tracing::warn!(error = %e, "Cursor discovery failed"),
    }

    // Collect OpenCode entries
    match opencode_result {
        Ok(opencode_entries) => entries.extend(opencode_entries),
        Err(e) => tracing::warn!(error = %e, "OpenCode discovery failed"),
    }

    // Collect Codex entries
    match codex_result {
        Ok(codex_entries) => entries.extend(codex_entries),
        Err(e) => tracing::warn!(error = %e, "Codex discovery failed"),
    }

    // Sort by timestamp descending (most recent first)
    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(entries)
}
