use crate::commands::observability::{unexpected_command_result, CommandResult};
use crate::db::repository::SessionMetadataRow;
use std::cmp::Reverse;
#[cfg(test)]
use std::collections::HashSet;
#[cfg(test)]
use std::path::Path;
#[cfg(test)]
use std::sync::{Mutex, OnceLock};
#[cfg(test)]
use std::time::Instant;

use super::*;

fn indexed_source_path(file_path: String) -> Option<String> {
    SessionMetadataRepository::normalized_source_path(&file_path)
}

fn derive_title_from_converted_session(
    session: &crate::acp::session_thread_snapshot::SessionThreadSnapshot,
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

fn resolve_indexed_session_title(
    session_id: &str,
    display: &str,
    title_overridden: bool,
    session: Option<&crate::acp::session_thread_snapshot::SessionThreadSnapshot>,
) -> String {
    if title_overridden {
        return display.to_string();
    }

    if let Some(session) = session {
        if let Some(title) = derive_title_from_converted_session(session) {
            return title;
        }
        if !session.title.trim().is_empty() {
            return session.title.clone();
        }
    }

    crate::history::title_utils::derive_session_title(display, 100)
        .unwrap_or_else(|| session_id[..8.min(session_id.len())].to_string())
}

fn derive_indexed_session_title(session_id: &str, display: &str, title_overridden: bool) -> String {
    resolve_indexed_session_title(session_id, display, title_overridden, None)
}

fn copilot_session_to_history_entry(
    session: crate::copilot_history::CopilotListedSession,
) -> HistoryEntry {
    HistoryEntry {
        id: session.session_id.clone(),
        display: session.title,
        timestamp: session.updated_at_ms,
        project: session.project_path,
        session_id: session.session_id.clone(),
        pasted_contents: serde_json::json!({}),
        agent_id: CanonicalAgentId::Copilot,
        updated_at: session.updated_at_ms,
        source_path: Some(crate::copilot_history::missing_transcript_marker(
            &session.session_id,
        )),
        parent_id: None,
        worktree_path: session.worktree_path,
        pr_number: None,
        pr_link_mode: None,
        worktree_deleted: None,
        session_lifecycle_state: Some(SessionLifecycleState::Persisted),
        sequence_id: None,
        usage_stats: None,
    }
}

#[cfg(test)]
fn filter_hidden_external_file_scan_entries(
    mut entries: Vec<HistoryEntry>,
    external_hidden_paths: &std::collections::HashSet<String>,
) -> Vec<HistoryEntry> {
    if external_hidden_paths.is_empty() {
        return entries;
    }

    entries.retain(|entry| !external_hidden_paths.contains(&entry.project));
    entries
}

#[tauri::command]
#[specta::specta]
pub async fn scan_project_sessions(
    app: AppHandle,
    project_paths: Vec<String>,
) -> CommandResult<Vec<HistoryEntry>> {
    unexpected_command_result(
        "scan_project_sessions",
        "Failed to scan project sessions",
        async {
            let db = app.try_state::<DbConn>().map(|s| s.inner().clone());
            let mut sorted = project_paths.clone();
            sorted.sort();
            let key = format!("scan:{}", sorted.join("|"));

            SCAN_CACHE
                .get_or_fetch(key, || async {
                    scan_indexed_project_sessions_inner(project_paths, db).await
                })
                .await
        }
        .await,
    )
}

async fn scan_indexed_project_sessions_inner(
    project_paths: Vec<String>,
    db: Option<DbConn>,
) -> Result<Vec<HistoryEntry>, String> {
    let db = db.ok_or_else(|| "No DbConn available for canonical session summaries".to_string())?;
    let external_hidden_paths = crate::history::visibility::load_external_hidden_paths_or_empty(
        &db,
        &project_paths,
        "scan_project_sessions",
    )
    .await;
    let lookup = SessionMetadataRepository::get_recent_for_projects_bounded(
        &db,
        &project_paths,
        &external_hidden_paths,
    )
    .await
    .map_err(|error| format!("Failed to load canonical session summaries: {error}"))?;
    let mut entries = indexed_session_rows_to_history_entries(lookup.entries);
    let ids = entries
        .iter()
        .map(|entry| entry.session_id.clone())
        .collect::<Vec<_>>();
    let mut usage =
        crate::db::repository::SessionHistoryEnrichmentRepository::get_usage_for_session_ids(
            &db, &ids,
        )
        .await
        .map_err(|error| format!("Failed to load canonical session enrichment: {error}"))?;
    for entry in &mut entries {
        entry.usage_stats = usage.remove(&entry.session_id);
    }
    entries.sort_by_key(|entry| Reverse(entry.timestamp));
    Ok(entries)
}

#[tauri::command]
#[specta::specta]
pub async fn get_startup_sessions(
    app: AppHandle,
    session_ids: Vec<String>,
) -> CommandResult<crate::session_jsonl::types::StartupSessionsResponse> {
    unexpected_command_result(
        "get_startup_sessions",
        "Failed to get startup sessions",
        async {
            let db = app
                .try_state::<DbConn>()
                .map(|state| state.inner().clone())
                .ok_or_else(|| "No DbConn available".to_string())?;

            get_startup_sessions_inner(&db, session_ids).await
        }
        .await,
    )
}

async fn get_startup_sessions_inner(
    db: &DbConn,
    session_ids: Vec<String>,
) -> Result<crate::session_jsonl::types::StartupSessionsResponse, String> {
    let mut indexed = SessionMetadataRepository::get_for_session_ids(db, &session_ids)
        .await
        .map_err(|error| format!("Failed to load startup session metadata: {error}"))?;

    let startup_order: std::collections::HashMap<String, usize> = session_ids
        .into_iter()
        .enumerate()
        .map(|(index, session_id)| (session_id, index))
        .collect();

    indexed.sort_by_key(|row| startup_order.get(&row.id).copied().unwrap_or(usize::MAX));

    let indexed_ids = indexed.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let mut usage_by_session =
        crate::db::repository::SessionHistoryEnrichmentRepository::get_usage_for_session_ids(
            db,
            &indexed_ids,
        )
        .await
        .map_err(|error| format!("Failed to load canonical session usage enrichment: {error}"))?;

    let alias_remaps = std::collections::HashMap::new();

    let mut entries: Vec<HistoryEntry> = Vec::with_capacity(indexed.len());
    for session in indexed {
        let session_lifecycle_state = session.lifecycle_state();
        let usage_stats = usage_by_session.remove(&session.id);
        let entry = HistoryEntry {
            id: session.id.clone(),
            display: session.display,
            timestamp: session.timestamp,
            project: session.project_path,
            session_id: session.id,
            pasted_contents: serde_json::json!({}),
            agent_id: CanonicalAgentId::parse(&session.agent_id),
            updated_at: session.timestamp,
            source_path: indexed_source_path(session.file_path),
            parent_id: None,
            worktree_path: session.worktree_path,
            worktree_deleted: None,
            pr_number: session.pr_number.map(|number| number as i64),
            pr_link_mode: session.pr_link_mode,
            session_lifecycle_state: Some(session_lifecycle_state),
            sequence_id: session.sequence_id,
            usage_stats,
        };
        entries.push(entry);
    }

    Ok(crate::session_jsonl::types::StartupSessionsResponse {
        entries,
        alias_remaps,
    })
}

#[cfg(test)]
fn merge_history_entries_by_id(
    mut primary: Vec<HistoryEntry>,
    secondary: Vec<HistoryEntry>,
) -> Vec<HistoryEntry> {
    let mut seen = primary
        .iter()
        .map(|entry| entry.id.clone())
        .collect::<std::collections::HashSet<_>>();
    for entry in secondary {
        if seen.insert(entry.id.clone()) {
            primary.push(entry);
        }
    }
    primary
}

#[cfg(test)]
fn project_paths_missing_from_index(
    project_paths: &[String],
    indexed_entries: &[HistoryEntry],
) -> Vec<String> {
    let indexed_project_paths = indexed_entries
        .iter()
        .map(|entry| entry.project.as_str())
        .collect::<std::collections::HashSet<_>>();
    let mut seen = std::collections::HashSet::new();

    project_paths
        .iter()
        .filter(|project_path| {
            !indexed_project_paths.contains(project_path.as_str())
                && seen.insert((*project_path).clone())
        })
        .cloned()
        .collect()
}

#[cfg(test)]
async fn scan_copilot_history_entries(
    project_paths: &[String],
) -> Result<Vec<HistoryEntry>, String> {
    crate::copilot_history::list_workspace_sessions(project_paths)
        .await
        .map(|sessions| {
            sessions
                .into_iter()
                .map(copilot_session_to_history_entry)
                .collect()
        })
}

fn indexed_session_rows_to_history_entries(indexed: Vec<SessionMetadataRow>) -> Vec<HistoryEntry> {
    let mut entries: Vec<HistoryEntry> = Vec::with_capacity(indexed.len());
    for s in indexed {
        let session_lifecycle_state = s.lifecycle_state();
        let display = derive_indexed_session_title(&s.id, &s.display, s.title_overridden);
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
            worktree_deleted: None,
            pr_number: s.pr_number.map(|n| n as i64),
            pr_link_mode: s.pr_link_mode,
            session_lifecycle_state: Some(session_lifecycle_state),
            sequence_id: s.sequence_id,
            usage_stats: None,
        });
    }
    entries
}

#[cfg(test)]
async fn scan_project_sessions_from_files(
    project_paths: &[String],
    external_hidden_paths: &std::collections::HashSet<String>,
) -> Vec<HistoryEntry> {
    // tokio::join! polls on the same task (no Send required), so we share the slice.
    let (claude_result, cursor_result, opencode_result, codex_result, copilot_result) = tokio::join!(
        session_jsonl_parser::scan_projects(project_paths),
        cursor_parser::discover_all_chats(project_paths),
        opencode_parser::scan_sessions(project_paths),
        codex_scanner::scan_sessions(project_paths),
        scan_copilot_history_entries(project_paths),
    );

    let mut entries = Vec::new();

    match claude_result {
        Ok(claude_entries) => entries.extend(claude_entries),
        Err(e) => tracing::warn!(error = %e, "Claude scanner failed"),
    };

    match cursor_result {
        Ok(cursor_entries) => {
            entries.extend(cursor_entries.iter().map(cursor_parser::to_history_entry));
        }
        Err(e) => tracing::warn!(error = %e, "Cursor scanner failed"),
    };

    match opencode_result {
        Ok(opencode_entries) => entries.extend(opencode_entries),
        Err(e) => tracing::warn!(error = %e, "OpenCode scanner failed"),
    };

    match codex_result {
        Ok(codex_entries) => entries.extend(codex_entries),
        Err(e) => tracing::warn!(error = %e, "Codex scanner failed"),
    };

    match copilot_result {
        Ok(copilot_entries) => entries.extend(copilot_entries),
        Err(e) => tracing::warn!(error = %e, "Copilot scanner failed"),
    };

    filter_hidden_external_file_scan_entries(entries, external_hidden_paths)
}

#[cfg(test)]
async fn scan_project_sessions_inner(
    project_paths: Vec<String>,
    db: Option<DbConn>,
) -> Result<Vec<HistoryEntry>, String> {
    let scan_start = Instant::now();
    let external_hidden_paths = match &db {
        Some(db) => {
            crate::history::visibility::load_external_hidden_paths_or_empty(
                db,
                &project_paths,
                "scan_project_sessions",
            )
            .await
        }
        None => std::collections::HashSet::new(),
    };

    // Try SQLite index for ALL agents (fast path: ~10-50ms)
    let from_index = match &db {
        Some(db) => {
            let idx_start = Instant::now();
            let result = SessionMetadataRepository::get_recent_for_projects_bounded(
                db,
                &project_paths,
                &external_hidden_paths,
            )
            .await;
            let idx_ms = idx_start.elapsed().as_millis();
            match &result {
                Ok(lookup) => tracing::info!(
                    elapsed_ms = idx_ms,
                    count = lookup.entries.len(),
                    db_row_count = lookup.db_row_count,
                    "SQLite index query completed"
                ),
                Err(e) => tracing::warn!(
                    elapsed_ms = idx_ms,
                    error = %e,
                    "SQLite index query failed"
                ),
            }
            match result.ok() {
                Some(lookup) if lookup.db_row_count > 0 => Some(lookup.entries),
                _ => None,
            }
        }
        None => {
            tracing::warn!("No DbConn available — skipping index fast path");
            None
        }
    };

    if let Some(indexed) = from_index {
        let index_count = indexed.len();

        // Self-heal: reconcile stale Acepe-managed registry placeholders that now
        // have a real on-disk Claude JSONL, BEFORE conversion (the conversion lowers
        // placeholder paths to `None`, so eligibility must be read off the raw rows).
        // Reconcile-only; transcript-less placeholders are left intact (never dropped).
        // Keyed on `row.id` so the substitution targets the same display entry.
        let reconciled_by_id = match &db {
            Some(db) => reconcile_indexed_placeholder_rows(db, &indexed).await,
            None => std::collections::HashMap::new(),
        };

        let mut entries = indexed_session_rows_to_history_entries(indexed);
        let indexed_ids = entries
            .iter()
            .map(|entry| entry.session_id.clone())
            .collect::<Vec<_>>();
        if let Some(db) = &db {
            if let Ok(mut usage_by_session) = crate::db::repository::SessionHistoryEnrichmentRepository::get_usage_for_session_ids(
                    db,
                    &indexed_ids,
                )
                .await
            {
                for entry in &mut entries {
                    entry.usage_stats = usage_by_session.remove(&entry.session_id);
                }
            }
        }
        if !reconciled_by_id.is_empty() {
            for entry in entries.iter_mut() {
                if let Some(reconciled) = reconciled_by_id.get(&entry.id) {
                    *entry = reconciled.clone();
                }
            }
        }
        let missing_project_paths = project_paths_missing_from_index(&project_paths, &entries);

        if !missing_project_paths.is_empty() {
            let file_scan_start = Instant::now();
            let file_entries =
                scan_project_sessions_from_files(&missing_project_paths, &external_hidden_paths)
                    .await;
            let file_entry_count = file_entries.len();
            entries = merge_history_entries_by_id(entries, file_entries);
            tracing::info!(
                missing_project_count = missing_project_paths.len(),
                file_entry_count,
                file_scan_ms = file_scan_start.elapsed().as_millis(),
                "Supplemented indexed session scan with file scan for unindexed projects"
            );
        }

        match scan_copilot_history_entries(&project_paths).await {
            Ok(copilot_entries) => {
                entries = merge_history_entries_by_id(entries, copilot_entries);
            }
            Err(error) => {
                tracing::warn!(error = %error, "Copilot scanner failed while supplementing index");
            }
        }
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.timestamp));
        tracing::info!(
            total_entries = entries.len(),
            index_entries = index_count,
            missing_project_count = missing_project_paths.len(),
            total_ms = scan_start.elapsed().as_millis(),
            source = "index+missing-files",
            "Session scan complete (from index)"
        );
        return Ok(entries);
    }

    // Index empty — full scan all agents in parallel
    tracing::info!("SQLite index empty, falling back to file scan");
    let file_scan_start = Instant::now();
    let mut entries =
        scan_project_sessions_from_files(&project_paths, &external_hidden_paths).await;

    tracing::info!(
        total_entries = entries.len(),
        file_scan_ms = file_scan_start.elapsed().as_millis(),
        total_ms = scan_start.elapsed().as_millis(),
        source = "files",
        "Session scan complete (from file scan)"
    );

    entries.sort_by_key(|entry| std::cmp::Reverse(entry.timestamp));

    Ok(entries)
}

/// Process-local cache of `(row.id, mtime, size)` triples whose on-disk Claude
/// JSONL was present but failed to yield a confident title (missing/empty/torn
/// first user message, slash-command-only, or `Untitled` fallback).
///
/// Bounds re-parsing of present-but-unparseable files to once per file mutation:
/// a cached triple is skipped without re-reading the file. The cache key includes
/// `(mtime, size)` so any real file change re-admits the file for another attempt.
#[cfg(test)]
fn placeholder_reconcile_negative_cache() -> &'static Mutex<HashSet<(String, i64, i64)>> {
    static CACHE: OnceLock<Mutex<HashSet<(String, i64, i64)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Eligibility (pure, no I/O) for on-scan placeholder reconciliation.
///
/// A row is eligible only when it is an Acepe-managed plain `__session_registry__/<id>`
/// registry placeholder with a still-pending transcript. This excludes:
/// - `__worktree__/<id>` markers (fail the prefix check),
/// - nested markers such as `__session_registry__/copilot_missing/<id>` (inner slash),
/// - already-reconciled rows with a real path / `file_size > 0` (not `is_transcript_pending`).
#[cfg(test)]
fn is_reconcilable_placeholder_row(row: &SessionMetadataRow) -> bool {
    const REGISTRY_PREFIX: &str = "__session_registry__/";

    if !row.is_acepe_managed || !row.is_transcript_pending() {
        return false;
    }

    match row.file_path.strip_prefix(REGISTRY_PREFIX) {
        // Plain `__session_registry__/<id>` — no inner slash in the remainder.
        Some(remainder) => !remainder.contains('/'),
        None => false,
    }
}

/// Build the reconciled `HistoryEntry` for a placeholder row that successfully
/// reconciled from disk. Keyed/displayed under `row.id` (the canonical Acepe
/// identity == the JSONL filename we statted), NOT the content `sessionId`
/// returned by extraction (which can differ for forked/resumed transcripts).
#[cfg(test)]
fn reconciled_history_entry(
    row: &SessionMetadataRow,
    display: String,
    timestamp: i64,
    relative_path: String,
) -> HistoryEntry {
    let worktree_deleted = row
        .worktree_path
        .as_ref()
        .map(|path| !Path::new(path).exists());
    HistoryEntry {
        id: row.id.clone(),
        display,
        timestamp,
        project: row.project_path.clone(),
        session_id: row.id.clone(),
        pasted_contents: serde_json::json!({}),
        agent_id: CanonicalAgentId::ClaudeCode,
        updated_at: timestamp,
        source_path: indexed_source_path(relative_path),
        parent_id: None,
        worktree_path: row.worktree_path.clone(),
        worktree_deleted,
        pr_number: row.pr_number.map(|number| number as i64),
        pr_link_mode: row.pr_link_mode.clone(),
        session_lifecycle_state: Some(SessionLifecycleState::Persisted),
        sequence_id: row.sequence_id,
        usage_stats: None,
    }
}

/// Reconcile a single placeholder `SessionMetadataRow` from its on-disk Claude
/// JSONL — if (and only if) it is safe to do so. Reconcile-only; **never deletes**.
///
/// Returns `Some(reconciled HistoryEntry)` only on a *successful* reconcile
/// (real path + stat + confident title written via `upsert`). Returns `None`
/// (leaving the row untouched) for an ineligible row, an absent/empty/unreadable
/// JSONL, a non-confident/fallback title, or an upsert that reported no change.
///
/// A confident title is required (Decision 7): once a placeholder flips to
/// non-placeholder nothing on the scan path re-corrects it, so a degraded read
/// must not be made terminal.
#[cfg(test)]
async fn reconcile_placeholder_row(
    db: &DbConn,
    row: &SessionMetadataRow,
) -> Result<Option<HistoryEntry>, String> {
    if !is_reconcilable_placeholder_row(row) {
        return Ok(None);
    }

    let jsonl_root = match crate::session_jsonl::parser::get_session_jsonl_root() {
        Ok(root) => root,
        Err(_) => return Ok(None),
    };
    let slug = crate::session_jsonl::parser::path_to_slug(&row.project_path);
    let relative_path = format!("{slug}/{id}.jsonl", id = row.id);
    let absolute_path = jsonl_root.join("projects").join(&relative_path);

    // Stat: absent / empty file ⇒ legitimately-pending session, leave untouched.
    let metadata = match tokio::fs::metadata(&absolute_path).await {
        Ok(metadata) => metadata,
        Err(_) => return Ok(None),
    };
    let real_size = metadata.len() as i64;
    if real_size == 0 {
        return Ok(None);
    }
    let real_mtime = metadata
        .modified()
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Negative cache: a present-but-unparseable file at this exact (mtime,size)
    // was already rejected; skip without re-reading.
    let cache_key = (row.id.clone(), real_mtime, real_size);
    if let Ok(cache) = placeholder_reconcile_negative_cache().lock() {
        if cache.contains(&cache_key) {
            return Ok(None);
        }
    }

    let record_negative = || {
        if let Ok(mut cache) = placeholder_reconcile_negative_cache().lock() {
            cache.insert(cache_key.clone());
        }
    };

    let extracted =
        match crate::session_jsonl::parser::extract_thread_metadata(&absolute_path).await {
            Ok(Some(entry)) => entry,
            Ok(None) => {
                record_negative();
                return Ok(None);
            }
            Err(error) => {
                tracing::debug!(
                    session_id = %row.id,
                    error = %error,
                    "Failed to extract metadata while reconciling placeholder row"
                );
                // Transient read error — do not poison the cache; retry next scan.
                return Ok(None);
            }
        };

    // Title-finality guard: only reconcile on a confident, non-fallback title.
    let Some(confident_title) = confident_reconciled_title(&extracted.display) else {
        record_negative();
        return Ok(None);
    };

    let upserted = SessionMetadataRepository::upsert(
        db,
        row.id.clone(),
        confident_title.clone(),
        extracted.timestamp,
        row.project_path.clone(),
        CanonicalAgentId::ClaudeCode.to_string_with_prefix(),
        relative_path.clone(),
        real_mtime,
        real_size,
    )
    .await
    .map_err(|error| format!("Failed to upsert reconciled placeholder row: {error}"))?;

    if !upserted {
        return Ok(None);
    }

    Ok(Some(reconciled_history_entry(
        row,
        confident_title,
        extracted.timestamp,
        relative_path,
    )))
}

/// Self-heal pass over a scan's raw indexed rows: reconcile every eligible
/// registry placeholder that now has a real on-disk Claude JSONL, returning a
/// map of `row.id -> reconciled HistoryEntry` for the *successful* reconciles only.
///
/// Bounded to placeholder rows (`is_reconcilable_placeholder_row`); non-placeholder
/// rows are skipped without I/O. A reconcile that fails or declines for one row
/// (helper `Err`/`None`) does **not** abort the scan — that row simply stays a
/// placeholder and is absent from the returned map (its existing entry is kept).
#[cfg(test)]
async fn reconcile_indexed_placeholder_rows(
    db: &DbConn,
    rows: &[SessionMetadataRow],
) -> std::collections::HashMap<String, HistoryEntry> {
    let mut reconciled = std::collections::HashMap::new();
    for row in rows {
        if !is_reconcilable_placeholder_row(row) {
            continue;
        }
        match reconcile_placeholder_row(db, row).await {
            Ok(Some(entry)) => {
                reconciled.insert(row.id.clone(), entry);
            }
            Ok(None) => {}
            Err(error) => {
                tracing::debug!(
                    session_id = %row.id,
                    error = %error,
                    "Placeholder reconcile failed during scan; leaving row as placeholder"
                );
            }
        }
    }
    reconciled
}

/// Derive a confident, non-fallback title from an extracted first-user-message
/// `display`. Returns `None` for empty/slash-command/fallback content (e.g.
/// the `"Untitled conversation"` sentinel emitted for content-less transcripts).
#[cfg(test)]
fn confident_reconciled_title(extracted_display: &str) -> Option<String> {
    if extracted_display == "Untitled conversation" {
        return None;
    }
    crate::history::title_utils::derive_session_title(extracted_display, 100)
}

#[cfg(test)]
mod tests {
    use super::{
        confident_reconciled_title, copilot_session_to_history_entry, derive_indexed_session_title,
        derive_title_from_converted_session, filter_hidden_external_file_scan_entries,
        indexed_source_path, is_reconcilable_placeholder_row, merge_history_entries_by_id,
        placeholder_reconcile_negative_cache, project_paths_missing_from_index,
        reconcile_placeholder_row, resolve_indexed_session_title,
        scan_indexed_project_sessions_inner, scan_project_sessions_inner,
    };
    use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
    use crate::acp::types::CanonicalAgentId;
    use crate::copilot_history::CopilotListedSession;
    use crate::db::repository::{SessionLifecycleState, SessionMetadataRow};
    use crate::session_jsonl::types::HistoryEntry;
    use crate::session_jsonl::types::{StoredContentBlock, StoredEntry, StoredUserMessage};
    use std::fs;

    fn make_session(title: &str, user_text: &str) -> SessionThreadSnapshot {
        let content = StoredContentBlock {
            block_type: "text".to_string(),
            text: Some(user_text.to_string()),
        };

        SessionThreadSnapshot {
            entries: vec![StoredEntry::User {
                id: "entry-1".to_string(),
                message: StoredUserMessage {
                    id: None,
                    content: content.clone(),
                    chunks: vec![content],
                    sent_at: None,
                },
                timestamp: Some("2026-04-06T00:00:00Z".to_string()),
            }],
            title: title.to_string(),
            created_at: "2026-04-06T00:00:00Z".to_string(),
            current_mode_id: None,
        }
    }

    fn make_history_entry(id: &str, project: &str, agent_id: &str) -> HistoryEntry {
        HistoryEntry {
            id: id.to_string(),
            display: id.to_string(),
            timestamp: 0,
            project: project.to_string(),
            session_id: id.to_string(),
            pasted_contents: serde_json::json!({}),
            agent_id: CanonicalAgentId::parse(agent_id),
            updated_at: 0,
            source_path: Some(format!("/tmp/{id}.jsonl")),
            parent_id: None,
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            worktree_deleted: None,
            session_lifecycle_state: Some(SessionLifecycleState::Persisted),
            sequence_id: None,
            usage_stats: None,
        }
    }

    #[tokio::test]
    async fn startup_session_metadata_does_not_parse_provider_history_for_usage() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect test database");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("run migrations");

        let temp = tempfile::tempdir().expect("create transcript directory");
        let transcript_path = temp.path().join("session-1.jsonl");
        fs::write(
            &transcript_path,
            r#"{"type":"user","cwd":"/repo","sessionId":"session-1","message":{"role":"user","content":"Measure this"},"timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"assistant","message":{"role":"assistant","content":"Done","usage":{"input_tokens":1200,"output_tokens":80}},"sessionId":"session-1","timestamp":"2025-12-16T19:53:42.812Z"}"#,
        )
        .expect("write transcript");

        crate::db::repository::SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Measure this".to_string(),
            1,
            "/repo".to_string(),
            "claude-code".to_string(),
            transcript_path.to_string_lossy().into_owned(),
            1,
            1,
        )
        .await
        .expect("insert session metadata");

        let response = super::get_startup_sessions_inner(&db, vec!["session-1".into()])
            .await
            .expect("load startup metadata");

        assert_eq!(response.entries.len(), 1);
        assert!(
            response.entries[0].usage_stats.is_none(),
            "first-display metadata must not parse provider history"
        );
    }

    #[tokio::test]
    async fn indexed_session_summaries_do_not_require_provider_files() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect test database");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("run migrations");
        crate::db::repository::SessionMetadataRepository::upsert(
            &db,
            "indexed-only".to_string(),
            "Already indexed".to_string(),
            10,
            "/repo".to_string(),
            "claude-code".to_string(),
            "/provider/file/that/does/not/exist.jsonl".to_string(),
            10,
            100,
        )
        .await
        .expect("insert session metadata");

        let entries = scan_indexed_project_sessions_inner(vec!["/repo".to_string()], Some(db))
            .await
            .expect("read indexed summaries");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].display, "Already indexed");
    }

    #[test]
    fn test_indexed_source_path_hides_worktree_sentinel() {
        assert_eq!(
            indexed_source_path("__worktree__/ses_legacy".to_string()),
            None
        );
    }

    #[test]
    fn converted_session_title_derivation_works() {
        let converted = make_session("Fallback", "Original transcript title");
        assert_eq!(
            derive_title_from_converted_session(&converted),
            Some("Original transcript title".to_string())
        );
    }

    #[test]
    fn title_override_should_short_circuit_indexed_derivation() {
        let row = SessionMetadataRow {
            id: "session-1".to_string(),
            display: "Design changes".to_string(),
            title_overridden: true,
            timestamp: 0,
            project_path: "/repo".to_string(),
            agent_id: "claude-code".to_string(),
            file_path: "file.jsonl".to_string(),
            file_mtime: 0,
            file_size: 0,
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            is_acepe_managed: false,
            sequence_id: Some(2),
        };

        let converted = make_session("Original transcript title", "Original transcript title");

        assert_eq!(
            resolve_indexed_session_title(
                &row.id,
                &row.display,
                row.title_overridden,
                Some(&converted)
            ),
            "Design changes"
        );
    }

    #[test]
    fn indexed_derivation_prefers_cached_display_without_loading_history() {
        assert_eq!(
            derive_indexed_session_title("session-1", "Ship sidebar instantly", false),
            "Ship sidebar instantly"
        );
    }

    #[test]
    fn file_scan_visibility_hides_external_entries_for_hidden_projects() {
        let entries = vec![
            make_history_entry("cursor-hidden", "/hidden", "cursor"),
            make_history_entry("codex-hidden", "/hidden", "codex"),
            make_history_entry("claude-visible", "/visible", "claude-code"),
        ];
        let hidden_projects = std::collections::HashSet::from([String::from("/hidden")]);

        let filtered = filter_hidden_external_file_scan_entries(entries, &hidden_projects);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "claude-visible");
        assert_eq!(filtered[0].project, "/visible");
    }

    #[test]
    fn copilot_sessions_convert_to_visible_history_entries() {
        let session = CopilotListedSession {
            session_id: "copilot-session-1".to_string(),
            title: "Review Acepe".to_string(),
            updated_at_ms: 1_777_000_000_000,
            project_path: "/Users/alex/Documents/acepe".to_string(),
            worktree_path: None,
            cwd: "/Users/alex/Documents/acepe".to_string(),
        };

        let entry = copilot_session_to_history_entry(session);

        assert_eq!(entry.id, "copilot-session-1");
        assert_eq!(entry.project, "/Users/alex/Documents/acepe");
        assert_eq!(entry.agent_id, CanonicalAgentId::Copilot);
        assert_eq!(entry.display, "Review Acepe");
        assert_eq!(
            entry.session_lifecycle_state,
            Some(SessionLifecycleState::Persisted)
        );
    }

    #[test]
    fn indexed_entries_can_be_supplemented_with_copilot_file_entries() {
        let indexed = vec![make_history_entry("claude-1", "/repo", "claude-code")];
        let copilot = vec![
            make_history_entry("copilot-1", "/repo", "copilot"),
            make_history_entry("claude-1", "/repo", "copilot"),
        ];

        let merged = merge_history_entries_by_id(indexed, copilot);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].id, "claude-1");
        assert_eq!(merged[1].id, "copilot-1");
        assert_eq!(merged[1].agent_id, CanonicalAgentId::Copilot);
    }

    #[test]
    fn finds_projects_missing_from_index_lookup() {
        let indexed = vec![make_history_entry(
            "godmode-1",
            "/Users/ace/personal/godmode",
            "claude-code",
        )];
        let requested_projects = vec![
            "/Users/ace/personal/fluentai".to_string(),
            "/Users/ace/personal/godmode".to_string(),
        ];

        let missing = project_paths_missing_from_index(&requested_projects, &indexed);

        assert_eq!(missing, vec!["/Users/ace/personal/fluentai".to_string()]);
    }

    // ------------------------------------------------------------------
    // U1: on-scan placeholder reconciliation
    // ------------------------------------------------------------------

    use crate::db::repository::SessionMetadataRepository;
    use crate::session_jsonl::parser::path_to_slug;
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    fn claude_home_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct ClaudeHomeGuard {
        previous_value: Option<String>,
    }

    impl ClaudeHomeGuard {
        fn set(path: &Path) -> Self {
            let previous_value = std::env::var("CLAUDE_HOME").ok();
            std::env::set_var("CLAUDE_HOME", path);
            Self { previous_value }
        }
    }

    impl Drop for ClaudeHomeGuard {
        fn drop(&mut self) {
            if let Some(previous_value) = &self.previous_value {
                std::env::set_var("CLAUDE_HOME", previous_value);
            } else {
                std::env::remove_var("CLAUDE_HOME");
            }
        }
    }

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory SQLite");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("Failed to run migrations");
        db
    }

    /// Write a parseable Claude transcript with a real first user message.
    /// `content_session_id` is the internal `sessionId` recorded in the JSONL,
    /// which may differ from `file_id` (the filename / Acepe row id) for
    /// forked/resumed transcripts.
    fn write_claude_jsonl(
        claude_root: &Path,
        project_path: &str,
        file_id: &str,
        content_session_id: &str,
        first_user_text: &str,
    ) {
        let project_dir = claude_root
            .join("projects")
            .join(path_to_slug(project_path));
        std::fs::create_dir_all(&project_dir).expect("create project dir");
        let file_path = project_dir.join(format!("{file_id}.jsonl"));
        let line = serde_json::json!({
            "type": "user",
            "cwd": project_path,
            "sessionId": content_session_id,
            "message": { "role": "user", "content": first_user_text },
            "timestamp": "2026-06-28T12:00:00.000Z",
        });
        std::fs::write(&file_path, format!("{line}\n")).expect("write jsonl");
    }

    /// Seed a plain `__session_registry__/<id>` placeholder row (display
    /// `"Session <hex>"`, mtime/size 0, is_acepe_managed) via the real creation
    /// primitive used by deferred sessions.
    async fn seed_placeholder_row(
        db: &DbConn,
        session_id: &str,
        project_path: &str,
    ) -> SessionMetadataRow {
        SessionMetadataRepository::ensure_exists(db, session_id, project_path, "claude-code", None)
            .await
            .expect("seed placeholder row");
        let row = SessionMetadataRepository::get_by_id(db, session_id)
            .await
            .expect("load seeded row")
            .expect("seeded row exists");
        assert!(row.is_transcript_pending(), "seed must be a placeholder");
        assert!(row.is_acepe_managed, "seed must be acepe-managed");
        assert!(row.file_path.starts_with("__session_registry__/"));
        row
    }

    fn make_row(
        id: &str,
        project_path: &str,
        file_path: &str,
        mtime: i64,
        size: i64,
    ) -> SessionMetadataRow {
        SessionMetadataRow {
            id: id.to_string(),
            display: format!("Session {}", &id[..8.min(id.len())]),
            title_overridden: false,
            timestamp: 0,
            project_path: project_path.to_string(),
            agent_id: "claude-code".to_string(),
            file_path: file_path.to_string(),
            file_mtime: mtime,
            file_size: size,
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            is_acepe_managed: true,
            sequence_id: Some(1),
        }
    }

    #[test]
    fn confident_title_rejects_fallbacks_and_commands() {
        assert_eq!(
            confident_reconciled_title("Reply with only the word hello"),
            Some("Reply with only the word hello".to_string())
        );
        assert_eq!(confident_reconciled_title("Untitled conversation"), None);
        assert_eq!(confident_reconciled_title("   "), None);
        assert_eq!(confident_reconciled_title("/clear"), None);
    }

    #[test]
    fn eligibility_excludes_worktree_copilot_missing_and_real_rows() {
        // Plain registry placeholder ⇒ eligible.
        assert!(is_reconcilable_placeholder_row(&make_row(
            "abc",
            "/repo",
            "__session_registry__/abc",
            0,
            0,
        )));
        // Worktree marker ⇒ ineligible (fails prefix).
        assert!(!is_reconcilable_placeholder_row(&make_row(
            "abc",
            "/repo",
            "__worktree__/abc",
            0,
            0,
        )));
        // copilot_missing nested marker ⇒ ineligible (inner slash).
        assert!(!is_reconcilable_placeholder_row(&make_row(
            "abc",
            "/repo",
            "__session_registry__/copilot_missing/abc",
            0,
            0,
        )));
        // Already-real row (real path + size) ⇒ ineligible (not pending).
        assert!(!is_reconcilable_placeholder_row(&make_row(
            "abc",
            "/repo",
            "slug/abc.jsonl",
            1_700_000_000,
            12345,
        )));
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn reconciles_placeholder_with_real_jsonl_keyed_on_row_id() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/reconcile-project";
        let id = "11111111-1111-1111-1111-111111111111";

        let db = setup_test_db().await;
        let row = seed_placeholder_row(&db, id, project).await;
        write_claude_jsonl(
            temp.path(),
            project,
            id,
            id,
            "Reply with only the word hello",
        );

        let result = reconcile_placeholder_row(&db, &row)
            .await
            .expect("reconcile ok");
        let entry = result.expect("reconciled entry");
        assert_eq!(entry.id, id);
        assert_eq!(entry.display, "Reply with only the word hello");
        assert!(entry.source_path.is_some());

        // DB row is no longer a placeholder.
        let updated = SessionMetadataRepository::get_by_id(&db, id)
            .await
            .unwrap()
            .unwrap();
        assert!(!updated.is_transcript_pending());
        assert!(updated.file_size > 0);
        assert_eq!(updated.display, "Reply with only the word hello");
        assert_eq!(
            updated.file_path,
            format!("{}/{}.jsonl", path_to_slug(project), id)
        );
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn reconcile_keys_on_row_id_when_content_session_id_differs() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/forked-project";
        let row_id = "22222222-2222-2222-2222-222222222222";
        let content_session_id = "99999999-9999-9999-9999-999999999999";

        let db = setup_test_db().await;
        let row = seed_placeholder_row(&db, row_id, project).await;
        // Filename == row_id, but internal sessionId differs (forked/resumed).
        write_claude_jsonl(
            temp.path(),
            project,
            row_id,
            content_session_id,
            "Forked conversation title",
        );

        let entry = reconcile_placeholder_row(&db, &row)
            .await
            .expect("reconcile ok")
            .expect("reconciled entry");
        assert_eq!(entry.id, row_id);

        // The row.id row was reconciled, not a new/other row.
        let updated = SessionMetadataRepository::get_by_id(&db, row_id)
            .await
            .unwrap()
            .unwrap();
        assert!(!updated.is_transcript_pending());
        assert_eq!(updated.display, "Forked conversation title");
        // No row created under the content sessionId.
        assert!(
            SessionMetadataRepository::get_by_id(&db, content_session_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn no_jsonl_leaves_placeholder_untouched_and_not_deleted() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/pending-project";
        let id = "33333333-3333-3333-3333-333333333333";

        let db = setup_test_db().await;
        let row = seed_placeholder_row(&db, id, project).await;
        // No JSONL written on disk.

        let result = reconcile_placeholder_row(&db, &row).await.expect("ok");
        assert!(result.is_none());

        // Row still present and still a placeholder — never deleted.
        let after = SessionMetadataRepository::get_by_id(&db, id)
            .await
            .unwrap()
            .expect("row not deleted");
        assert!(after.is_transcript_pending());
        assert_eq!(after.file_path, format!("__session_registry__/{id}"));
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn non_confident_title_leaves_placeholder_and_negatively_caches() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/slash-project";
        let id = "44444444-4444-4444-4444-444444444444";

        // Clear any cross-test residue for this key space.
        placeholder_reconcile_negative_cache()
            .lock()
            .unwrap()
            .clear();

        let db = setup_test_db().await;
        let row = seed_placeholder_row(&db, id, project).await;
        // First user message is a slash command ⇒ extraction yields no confident title.
        write_claude_jsonl(temp.path(), project, id, id, "/clear");

        let first = reconcile_placeholder_row(&db, &row).await.expect("ok");
        assert!(first.is_none());

        // Row left as placeholder.
        let after = SessionMetadataRepository::get_by_id(&db, id)
            .await
            .unwrap()
            .unwrap();
        assert!(after.is_transcript_pending());

        // The (id, mtime, size) triple is negatively cached.
        let metadata = std::fs::metadata(
            temp.path()
                .join("projects")
                .join(path_to_slug(project))
                .join(format!("{id}.jsonl")),
        )
        .unwrap();
        let size = metadata.len() as i64;
        let mtime = metadata
            .modified()
            .unwrap()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(placeholder_reconcile_negative_cache()
            .lock()
            .unwrap()
            .contains(&(id.to_string(), mtime, size)));

        // Second call with same (mtime,size) is a cache hit ⇒ still None, row unchanged.
        let second = reconcile_placeholder_row(&db, &row).await.expect("ok");
        assert!(second.is_none());
        let after2 = SessionMetadataRepository::get_by_id(&db, id)
            .await
            .unwrap()
            .unwrap();
        assert!(after2.is_transcript_pending());
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn worktree_marker_row_is_ineligible() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/worktree-project";
        let id = "55555555-5555-5555-5555-555555555555";

        let db = setup_test_db().await;
        // Even with a real JSONL present, a __worktree__ row must not reconcile.
        write_claude_jsonl(temp.path(), project, id, id, "Should not reconcile");
        let row = make_row(id, project, &format!("__worktree__/{id}"), 0, 0);

        let result = reconcile_placeholder_row(&db, &row).await.expect("ok");
        assert!(result.is_none());
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn copilot_missing_marker_row_is_ineligible() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/copilot-project";
        let id = "66666666-6666-6666-6666-666666666666";

        let db = setup_test_db().await;
        write_claude_jsonl(temp.path(), project, id, id, "Should not reconcile");
        let row = make_row(
            id,
            project,
            &format!("__session_registry__/copilot_missing/{id}"),
            0,
            0,
        );

        let result = reconcile_placeholder_row(&db, &row).await.expect("ok");
        assert!(result.is_none());
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn already_real_row_is_ineligible() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/real-project";
        let id = "77777777-7777-7777-7777-777777777777";

        let db = setup_test_db().await;
        // Real path + non-zero size ⇒ not pending ⇒ ineligible.
        let row = make_row(
            id,
            project,
            &format!("{}/{}.jsonl", path_to_slug(project), id),
            1_700_000_000,
            4096,
        );
        assert!(!row.is_transcript_pending());

        let result = reconcile_placeholder_row(&db, &row).await.expect("ok");
        assert!(result.is_none());
    }

    // ------------------------------------------------------------------
    // U2: wire self-heal into scan_project_sessions_inner
    // ------------------------------------------------------------------

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn scan_reconciles_placeholder_and_returns_derived_title() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/scan-reconcile-project";
        let id = "a1111111-1111-1111-1111-111111111111";

        let db = setup_test_db().await;
        seed_placeholder_row(&db, id, project).await;
        write_claude_jsonl(
            temp.path(),
            project,
            id,
            id,
            "Reply with only the word hello",
        );

        let entries = scan_project_sessions_inner(vec![project.to_string()], Some(db.clone()))
            .await
            .expect("scan ok");

        let entry = entries
            .iter()
            .find(|entry| entry.id == id)
            .expect("placeholder present in scan result");
        assert_eq!(entry.display, "Reply with only the word hello");
        assert!(!entry.display.starts_with("Session "));
        assert!(entry.source_path.is_some());

        // DB row reconciled in place.
        let updated = SessionMetadataRepository::get_by_id(&db, id)
            .await
            .unwrap()
            .unwrap();
        assert!(!updated.is_transcript_pending());
        assert_eq!(updated.display, "Reply with only the word hello");
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn scan_reconciles_only_placeholders_with_jsonl_keeping_others() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/scan-mixed-project";
        let id_with = "b1111111-1111-1111-1111-111111111111";
        let id_without = "b2222222-2222-2222-2222-222222222222";

        let db = setup_test_db().await;
        seed_placeholder_row(&db, id_with, project).await;
        seed_placeholder_row(&db, id_without, project).await;
        // Only id_with has an on-disk transcript.
        write_claude_jsonl(
            temp.path(),
            project,
            id_with,
            id_with,
            "Mixed scan reconcile title",
        );

        let entries = scan_project_sessions_inner(vec![project.to_string()], Some(db.clone()))
            .await
            .expect("scan ok");

        let reconciled = entries
            .iter()
            .find(|entry| entry.id == id_with)
            .expect("reconciled placeholder present");
        assert_eq!(reconciled.display, "Mixed scan reconcile title");

        // Transcript-less placeholder stays a "Session <hex>" and is NOT dropped.
        let pending = entries
            .iter()
            .find(|entry| entry.id == id_without)
            .expect("transcript-less placeholder still listed (not dropped)");
        assert!(pending.display.starts_with("Session "));

        // And the row was not deleted from the DB.
        let after = SessionMetadataRepository::get_by_id(&db, id_without)
            .await
            .unwrap()
            .expect("transcript-less placeholder row not deleted");
        assert!(after.is_transcript_pending());
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn scan_with_only_real_rows_is_unchanged() {
        let _lock = claude_home_test_lock().lock().unwrap();
        let temp = TempDir::new().unwrap();
        let _home = ClaudeHomeGuard::set(temp.path());
        let project = "/Users/test/scan-real-project";
        let id = "c1111111-1111-1111-1111-111111111111";

        let db = setup_test_db().await;
        // Seed a placeholder then reconcile it via a real upsert so the row is a
        // non-placeholder going into the scan (no eligible placeholders remain).
        seed_placeholder_row(&db, id, project).await;
        let relative_path = format!("{}/{}.jsonl", path_to_slug(project), id);
        SessionMetadataRepository::upsert(
            &db,
            id.to_string(),
            "Already real title".to_string(),
            1_700_000_000,
            project.to_string(),
            CanonicalAgentId::ClaudeCode.to_string_with_prefix(),
            relative_path,
            1_700_000_000,
            4096,
        )
        .await
        .expect("upsert real row");

        let entries = scan_project_sessions_inner(vec![project.to_string()], Some(db.clone()))
            .await
            .expect("scan ok");

        let entry = entries
            .iter()
            .find(|entry| entry.id == id)
            .expect("real row present");
        assert_eq!(entry.display, "Already real title");

        // Row untouched (still non-placeholder, same display).
        let after = SessionMetadataRepository::get_by_id(&db, id)
            .await
            .unwrap()
            .unwrap();
        assert!(!after.is_transcript_pending());
        assert_eq!(after.display, "Already real title");
    }
}

/// Discover all projects with sessions from all agents.
///
/// Scans Claude Code, Cursor, OpenCode, Codex, and Copilot sources directly without requiring
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
pub async fn discover_all_projects_with_sessions() -> CommandResult<Vec<HistoryEntry>> {
    unexpected_command_result(
        "discover_all_projects_with_sessions",
        "Failed to discover projects with sessions",
        async {
            SCAN_CACHE
                .get_or_fetch("discover".to_string(), || async {
                    discover_all_projects_with_sessions_inner().await
                })
                .await
        }
        .await,
    )
}

async fn discover_all_projects_with_sessions_inner() -> Result<Vec<HistoryEntry>, String> {
    // Scan all sources in parallel
    let (claude_result, cursor_result, opencode_result, codex_result, copilot_result) = tokio::join!(
        session_jsonl_parser::scan_all_threads(),
        cursor_parser::discover_all_chats(&[]),
        opencode_parser::scan_sessions(&[]),
        codex_scanner::scan_sessions(&[]),
        crate::copilot_history::list_workspace_sessions(&[]),
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

    match copilot_result {
        Ok(copilot_entries) => {
            entries.extend(
                copilot_entries
                    .into_iter()
                    .map(copilot_session_to_history_entry),
            );
        }
        Err(e) => tracing::warn!(error = %e, "Copilot discovery failed"),
    }

    // Sort by timestamp descending (most recent first)
    entries.sort_by_key(|entry| Reverse(entry.timestamp));

    Ok(entries)
}
