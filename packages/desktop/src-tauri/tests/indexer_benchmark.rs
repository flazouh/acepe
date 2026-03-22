use acepe_lib::codex_history::scanner as codex_scanner;
use acepe_lib::cursor_history::parser as cursor_parser;
use acepe_lib::db::repository::{
    ProjectRepository, SessionMetadataRecord, SessionMetadataRepository,
};
use acepe_lib::history::indexer::IndexerActor;
use acepe_lib::opencode_history::parser as opencode_parser;
use acepe_lib::session_jsonl::parser::{get_session_jsonl_root, path_to_slug};
use anyhow::{anyhow, Result};
use sea_orm::{Database, DbConn};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime};
use tempfile::TempDir;

fn live_benchmarks_enabled() -> bool {
    std::env::var("ACEPE_RUN_LIVE_BENCHMARKS")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

#[derive(Debug)]
struct ClaudeWalkMetrics {
    files_seen: usize,
    unchanged: usize,
    changed_or_new: usize,
    current_paths: HashSet<String>,
}

#[derive(Debug)]
struct BenchDb {
    _dir: TempDir,
    db: DbConn,
}

fn dev_db_path() -> Result<PathBuf> {
    let data_local = dirs::data_local_dir().ok_or_else(|| anyhow!("data_local_dir unavailable"))?;
    Ok(data_local.join("Acepe").join("acepe_dev.db"))
}

fn db_url(path: &Path) -> String {
    format!("sqlite://{}?mode=rwc", path.display())
}

async fn clone_dev_db() -> Result<BenchDb> {
    let source = dev_db_path()?;
    if !source.exists() {
        return Err(anyhow!("Acepe DB not found at {}", source.display()));
    }

    let temp_dir = tempfile::tempdir()?;
    let copied_path = temp_dir.path().join("acepe_bench.db");
    std::fs::copy(&source, &copied_path)?;

    let db = Database::connect(&db_url(&copied_path)).await?;
    Ok(BenchDb { _dir: temp_dir, db })
}

async fn get_project_paths(db: &DbConn) -> Result<Vec<String>> {
    let projects = ProjectRepository::get_all(db).await?;
    let paths: Vec<String> = projects.into_iter().map(|project| project.path).collect();
    if paths.is_empty() {
        return Err(anyhow!("No projects found in projects table"));
    }
    Ok(paths)
}

async fn benchmark_claude_walk(
    project_paths: &[String],
    indexed_map: &HashMap<String, (i64, i64)>,
) -> Result<ClaudeWalkMetrics> {
    let jsonl_root = get_session_jsonl_root()?;
    let projects_dir = jsonl_root.join("projects");

    let mut current_paths: HashSet<String> = HashSet::new();
    let mut files_seen = 0usize;
    let mut unchanged = 0usize;
    let mut changed_or_new = 0usize;

    for project_path in project_paths {
        let slug = path_to_slug(project_path);
        let project_dir = projects_dir.join(slug);
        if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
            continue;
        }

        let mut entries = match tokio::fs::read_dir(&project_dir).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let file_path = entry.path();
            if file_path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }

            let relative_path = match file_path.strip_prefix(&projects_dir) {
                Ok(relative) => relative.to_string_lossy().to_string(),
                Err(_) => continue,
            };

            current_paths.insert(relative_path.clone());
            files_seen += 1;

            let metadata = match tokio::fs::metadata(&file_path).await {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };

            let mtime = metadata
                .modified()
                .unwrap_or(SystemTime::UNIX_EPOCH)
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let size = metadata.len() as i64;

            match indexed_map.get(&relative_path) {
                Some(&(indexed_mtime, indexed_size))
                    if indexed_mtime == mtime && indexed_size == size =>
                {
                    unchanged += 1;
                }
                _ => {
                    changed_or_new += 1;
                }
            }
        }
    }

    Ok(ClaudeWalkMetrics {
        files_seen,
        unchanged,
        changed_or_new,
        current_paths,
    })
}

fn history_record_to_metadata_record(
    entry: &acepe_lib::session_jsonl::types::HistoryEntry,
) -> SessionMetadataRecord {
    (
        entry.session_id.clone(),
        entry.display.clone(),
        entry.timestamp,
        entry.project.clone(),
        entry.agent_id.to_string_with_prefix(),
        entry.source_path.clone().unwrap_or_default(),
        0,
        0,
    )
}

#[tokio::test]
async fn benchmark_incremental_scan_breakdown() -> Result<()> {
    if !live_benchmarks_enabled() {
        println!("Skipping benchmark_incremental_scan_breakdown (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return Ok(());
    }

    // End-to-end incremental scan benchmark on isolated DB copy.
    let e2e_db = clone_dev_db().await?;
    let project_paths = get_project_paths(&e2e_db.db).await?;

    let indexer = IndexerActor::spawn(Arc::new(e2e_db.db.clone()));
    let e2e_start = Instant::now();
    let e2e_result = indexer.incremental_scan(project_paths.clone()).await?;
    let e2e_elapsed_ms = e2e_start.elapsed().as_millis();
    indexer.shutdown().await?;

    println!("=== Incremental Scan (E2E) ===");
    println!("projects={}", project_paths.len());
    println!(
        "result: files_indexed={} files_unchanged={} files_deleted={} duration_ms={}",
        e2e_result.files_indexed,
        e2e_result.files_unchanged,
        e2e_result.files_deleted,
        e2e_result.duration_ms
    );
    println!("wall_clock_ms={}", e2e_elapsed_ms);

    // Stage-by-stage breakdown on a second isolated DB copy.
    let components_db = clone_dev_db().await?;
    let project_paths = get_project_paths(&components_db.db).await?;

    let indexed_load_start = Instant::now();
    let indexed_entries: Vec<(String, i64, i64)> =
        SessionMetadataRepository::get_all_file_paths_with_mtime(&components_db.db)
            .await?
            .into_iter()
            .filter(|(_, mtime, _)| *mtime > 0)
            .collect();
    let indexed_load_ms = indexed_load_start.elapsed().as_millis();

    let indexed_paths: HashSet<String> =
        indexed_entries.iter().map(|(p, _, _)| p.clone()).collect();
    let indexed_map: HashMap<String, (i64, i64)> = indexed_entries
        .into_iter()
        .map(|(path, mtime, size)| (path, (mtime, size)))
        .collect();

    let claude_walk_start = Instant::now();
    let walk_metrics = benchmark_claude_walk(&project_paths, &indexed_map).await?;
    let claude_walk_ms = claude_walk_start.elapsed().as_millis();

    let delete_start = Instant::now();
    let mut deleted = 0usize;
    for deleted_path in indexed_paths.difference(&walk_metrics.current_paths) {
        SessionMetadataRepository::delete_by_file_path(&components_db.db, deleted_path).await?;
        deleted += 1;
    }
    let delete_ms = delete_start.elapsed().as_millis();

    let cursor_start = Instant::now();
    let cursor_entries = cursor_parser::discover_all_chats(&project_paths).await?;
    let cursor_ms = cursor_start.elapsed().as_millis();

    let opencode_start = Instant::now();
    let opencode_entries = opencode_parser::scan_sessions(&project_paths).await?;
    let opencode_ms = opencode_start.elapsed().as_millis();

    let codex_start = Instant::now();
    let codex_entries = codex_scanner::scan_sessions(&project_paths).await?;
    let codex_ms = codex_start.elapsed().as_millis();

    let other_parallel_start = Instant::now();
    let (cursor_parallel, opencode_parallel, codex_parallel) = tokio::join!(
        cursor_parser::discover_all_chats(&project_paths),
        opencode_parser::scan_sessions(&project_paths),
        codex_scanner::scan_sessions(&project_paths),
    );
    let other_parallel_ms = other_parallel_start.elapsed().as_millis();

    let cursor_parallel_entries = cursor_parallel?;
    let opencode_parallel_entries = opencode_parallel?;
    let codex_parallel_entries = codex_parallel?;

    let convert_start = Instant::now();
    let mut records: Vec<SessionMetadataRecord> = Vec::new();
    records.extend(
        cursor_parallel_entries.iter().map(|entry| {
            history_record_to_metadata_record(&cursor_parser::to_history_entry(entry))
        }),
    );
    records.extend(
        opencode_parallel_entries
            .iter()
            .map(history_record_to_metadata_record),
    );
    records.extend(
        codex_parallel_entries
            .iter()
            .map(history_record_to_metadata_record),
    );
    let convert_ms = convert_start.elapsed().as_millis();

    let upsert_start = Instant::now();
    let upserted = SessionMetadataRepository::batch_upsert(&components_db.db, records).await?;
    let upsert_ms = upsert_start.elapsed().as_millis();

    println!("=== Incremental Scan (Component Breakdown) ===");
    println!("db_load_indexed_entries_ms={}", indexed_load_ms);
    println!(
        "claude_walk_ms={} files_seen={} unchanged={} changed_or_new={}",
        claude_walk_ms,
        walk_metrics.files_seen,
        walk_metrics.unchanged,
        walk_metrics.changed_or_new
    );
    println!("delete_stale_ms={} deleted={}", delete_ms, deleted);
    println!(
        "other_agents_single_ms: cursor={} opencode={} codex={}",
        cursor_ms, opencode_ms, codex_ms
    );
    println!(
        "other_agents_parallel_join_ms={} cursor_entries={} opencode_entries={} codex_entries={}",
        other_parallel_ms,
        cursor_parallel_entries.len(),
        opencode_parallel_entries.len(),
        codex_parallel_entries.len()
    );
    println!("other_agents_convert_ms={}", convert_ms);
    println!(
        "other_agents_batch_upsert_ms={} upserted={}",
        upsert_ms, upserted
    );

    // Keep assertions very loose: this is a diagnostics benchmark, not a perf gate.
    assert!(e2e_result.duration_ms > 0);
    assert!(other_parallel_ms > 0);

    // Prevent unused warnings for single-run results printed above.
    let _ = (
        cursor_entries.len(),
        opencode_entries.len(),
        codex_entries.len(),
    );

    Ok(())
}
