use acepe_lib::codex_history::scanner as codex_scanner;
use acepe_lib::db::repository::ProjectRepository;
use anyhow::{anyhow, Result};
use ignore::WalkBuilder;
use sea_orm::{Database, DbConn};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};
use tempfile::TempDir;

fn live_benchmarks_enabled() -> bool {
    std::env::var("ACEPE_RUN_LIVE_BENCHMARKS")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

#[derive(Debug)]
struct BenchDb {
    _dir: TempDir,
    db: DbConn,
}

#[derive(Debug)]
struct RolloutFileStat {
    path: PathBuf,
    modified: SystemTime,
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

async fn project_paths_from_db(db: &DbConn) -> Result<Vec<String>> {
    let projects = ProjectRepository::get_all(db).await?;
    Ok(projects.into_iter().map(|project| project.path).collect())
}

fn codex_sessions_root() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("home_dir unavailable"))?;
    Ok(home.join(".codex").join("sessions"))
}

fn list_rollout_files(sessions_root: &Path) -> Vec<RolloutFileStat> {
    let mut files = Vec::new();
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

        let metadata = match std::fs::metadata(walk_entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

        files.push(RolloutFileStat {
            path: walk_entry.path().to_path_buf(),
            modified,
        });
    }
    files
}

fn extract_cwd_fast(path: &Path) -> Option<String> {
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
        if record_type != "session_meta" {
            continue;
        }

        return record
            .get("payload")
            .and_then(|payload| payload.get("cwd"))
            .and_then(Value::as_str)
            .map(str::to_string);
    }

    None
}

fn parse_rollout_metadata_full(path: &Path) -> Option<(String, String, i64)> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut updated_at: Option<i64> = None;

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if let Some(line_updated_at) = record
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_rfc3339_millis)
        {
            updated_at =
                Some(updated_at.map_or(line_updated_at, |current| current.max(line_updated_at)));
        }

        if record
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            != "session_meta"
        {
            continue;
        }

        let payload = record.get("payload").unwrap_or(&Value::Null);
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
    }

    let session_id = session_id?;
    let cwd = cwd?;
    let updated_at = updated_at.unwrap_or(0);
    Some((session_id, cwd, updated_at))
}

fn parse_rfc3339_millis(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|datetime| datetime.timestamp_millis())
}

#[tokio::test]
async fn benchmark_codex_scanner_components() -> Result<()> {
    if !live_benchmarks_enabled() {
        println!("Skipping benchmark_codex_scanner_components (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return Ok(());
    }

    let bench_db = clone_dev_db().await?;
    let project_paths = project_paths_from_db(&bench_db.db).await?;
    let requested_projects: HashSet<String> = project_paths.into_iter().collect();

    let sessions_root = codex_sessions_root()?;
    if !sessions_root.exists() {
        println!("Codex sessions root does not exist, skipping benchmark");
        return Ok(());
    }

    let walk_start = Instant::now();
    let rollout_files = list_rollout_files(&sessions_root);
    let walk_ms = walk_start.elapsed().as_millis();

    let fast_filter_start = Instant::now();
    let mut filtered_paths: Vec<PathBuf> = Vec::new();
    for file in &rollout_files {
        if let Some(cwd) = extract_cwd_fast(&file.path) {
            if requested_projects.contains(&cwd) {
                filtered_paths.push(file.path.clone());
            }
        }
    }
    let fast_filter_ms = fast_filter_start.elapsed().as_millis();

    let full_parse_all_start = Instant::now();
    let mut parse_all_ok = 0usize;
    for file in &rollout_files {
        if parse_rollout_metadata_full(&file.path).is_some() {
            parse_all_ok += 1;
        }
    }
    let full_parse_all_ms = full_parse_all_start.elapsed().as_millis();

    let full_parse_filtered_start = Instant::now();
    let mut parse_filtered_ok = 0usize;
    for path in &filtered_paths {
        if parse_rollout_metadata_full(path).is_some() {
            parse_filtered_ok += 1;
        }
    }
    let full_parse_filtered_ms = full_parse_filtered_start.elapsed().as_millis();

    let sort_start = Instant::now();
    let mut sorted = rollout_files
        .iter()
        .map(|file| (file.path.clone(), file.modified))
        .collect::<Vec<_>>();
    sorted.sort_by(|left, right| right.1.cmp(&left.1));
    let sort_ms = sort_start.elapsed().as_millis();

    let codex_scan_start = Instant::now();
    let codex_entries =
        codex_scanner::scan_sessions(&requested_projects.into_iter().collect::<Vec<_>>()).await?;
    let codex_scan_ms = codex_scan_start.elapsed().as_millis();

    let metadata_only_scan_start = Instant::now();
    let metadata_only_entries =
        codex_scanner::scan_sessions_metadata_only(&project_paths_from_db(&bench_db.db).await?)
            .await?;
    let metadata_only_scan_ms = metadata_only_scan_start.elapsed().as_millis();

    let mut per_project_counts: HashMap<String, usize> = HashMap::new();
    for entry in &codex_entries {
        *per_project_counts
            .entry(entry.project.clone())
            .or_insert(0usize) += 1;
    }

    println!("=== Codex Scanner Component Benchmark ===");
    println!("rollout_files={} walk_ms={}", rollout_files.len(), walk_ms);
    println!(
        "fast_cwd_filter_ms={} filtered_files={}",
        fast_filter_ms,
        filtered_paths.len()
    );
    println!(
        "full_parse_all_ms={} parsed_ok={}",
        full_parse_all_ms, parse_all_ok
    );
    println!(
        "full_parse_filtered_ms={} parsed_ok={}",
        full_parse_filtered_ms, parse_filtered_ok
    );
    println!("sort_by_mtime_ms={}", sort_ms);
    println!(
        "codex_scan_sessions_ms={} entries={} per_project_counts={:?}",
        codex_scan_ms,
        codex_entries.len(),
        per_project_counts
    );
    println!(
        "codex_scan_sessions_metadata_only_ms={} entries={}",
        metadata_only_scan_ms,
        metadata_only_entries.len()
    );

    assert!(codex_scan_ms > 0);
    Ok(())
}
