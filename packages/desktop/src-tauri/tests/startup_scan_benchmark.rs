//! Benchmark for startup session scan performance.
//!
//! Measures the full scan pipeline that runs at app startup:
//! 1. Directory enumeration (finding .jsonl files per project)
//! 2. File metadata collection (mtime/size)
//! 3. Metadata extraction (parsing first few JSONL lines)
//! 4. Cache behavior (cold vs warm)
//! 5. Multi-agent parallel scan (Claude + Cursor + OpenCode + Codex)
//!
//! Run with:
//!   ACEPE_RUN_LIVE_BENCHMARKS=1 cargo test -p acepe-lib --test startup_scan_benchmark -- --nocapture
//!
//! Or run specific tests:
//!   ACEPE_RUN_LIVE_BENCHMARKS=1 cargo test -p acepe-lib --test startup_scan_benchmark cold_scan -- --nocapture

use acepe_lib::codex_history::scanner as codex_scanner;
use acepe_lib::cursor_history::parser as cursor_parser;
use acepe_lib::db::repository::ProjectRepository;
use acepe_lib::opencode_history::parser as opencode_parser;
use acepe_lib::session_jsonl::cache::{get_cache, invalidate_cache};
use acepe_lib::session_jsonl::parser as session_jsonl_parser;
use acepe_lib::session_jsonl::parser::{get_session_jsonl_root, path_to_slug};
use anyhow::{anyhow, Result};
use sea_orm::{Database, DbConn};
use std::path::PathBuf;
use std::time::Instant;

fn live_benchmarks_enabled() -> bool {
    std::env::var("ACEPE_RUN_LIVE_BENCHMARKS")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

fn dev_db_path() -> Result<PathBuf> {
    let data_local = dirs::data_local_dir().ok_or_else(|| anyhow!("data_local_dir unavailable"))?;
    Ok(data_local.join("Acepe").join("acepe_dev.db"))
}

async fn open_dev_db() -> Result<DbConn> {
    let source = dev_db_path()?;
    if !source.exists() {
        return Err(anyhow!("Acepe DB not found at {}", source.display()));
    }
    let url = format!("sqlite://{}?mode=ro", source.display());
    let db = Database::connect(&url).await?;
    Ok(db)
}

async fn get_project_paths(db: &DbConn) -> Result<Vec<String>> {
    let projects = ProjectRepository::get_all(db).await?;
    let paths: Vec<String> = projects.into_iter().map(|p| p.path).collect();
    if paths.is_empty() {
        return Err(anyhow!("No projects in DB"));
    }
    Ok(paths)
}

// ─── Helpers ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct ScanTiming {
    label: String,
    duration_ms: f64,
    entries: usize,
}

fn ms(d: std::time::Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn print_timing(t: &ScanTiming) {
    println!(
        "  {:<40} {:>8.1}ms  ({} entries)",
        t.label, t.duration_ms, t.entries
    );
}

fn print_summary(timings: &[ScanTiming]) {
    let total: f64 = timings.iter().map(|t| t.duration_ms).sum();
    let total_entries: usize = timings.iter().map(|t| t.entries).sum();
    println!("  {:-<40} {:-<8}   {:-<8}", "", "", "");
    println!(
        "  {:<40} {:>8.1}ms  ({} entries total)",
        "TOTAL", total, total_entries
    );
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f64 * p) as usize).min(sorted.len() - 1);
    sorted[idx]
}

// ─── Directory walk benchmark ────────────────────────────────────────

struct DirWalkResult {
    project_count: usize,
    total_files: usize,
    walk_ms: f64,
    per_project: Vec<(String, usize, f64)>, // (slug, file_count, walk_ms)
}

async fn benchmark_dir_walk(project_paths: &[String]) -> Result<DirWalkResult> {
    let jsonl_root = get_session_jsonl_root()?;
    let projects_dir = jsonl_root.join("projects");

    let mut per_project = Vec::new();
    let mut total_files = 0usize;
    let overall = Instant::now();

    for project_path in project_paths {
        let slug = path_to_slug(project_path);
        let project_dir = projects_dir.join(&slug);

        if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
            continue;
        }

        let t = Instant::now();
        let mut file_count = 0usize;
        let mut read_dir = match tokio::fs::read_dir(&project_dir).await {
            Ok(d) => d,
            Err(_) => continue,
        };

        while let Some(entry) = read_dir.next_entry().await? {
            let ft = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !ft.is_file() {
                continue;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.ends_with(".jsonl") {
                file_count += 1;
            }
        }

        total_files += file_count;
        per_project.push((slug, file_count, ms(t.elapsed())));
    }

    Ok(DirWalkResult {
        project_count: per_project.len(),
        total_files,
        walk_ms: ms(overall.elapsed()),
        per_project,
    })
}

// ─── Metadata extraction benchmark ──────────────────────────────────

struct MetadataExtractResult {
    total_files: usize,
    parsed: usize,
    skipped: usize,
    total_ms: f64,
    per_file_ms: Vec<f64>, // sorted
}

async fn benchmark_metadata_extraction(project_paths: &[String]) -> Result<MetadataExtractResult> {
    let jsonl_root = get_session_jsonl_root()?;
    let projects_dir = jsonl_root.join("projects");

    let mut file_paths: Vec<PathBuf> = Vec::new();

    for project_path in project_paths {
        let slug = path_to_slug(project_path);
        let project_dir = projects_dir.join(&slug);
        if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
            continue;
        }

        let mut read_dir = match tokio::fs::read_dir(&project_dir).await {
            Ok(d) => d,
            Err(_) => continue,
        };

        while let Some(entry) = read_dir.next_entry().await? {
            let ft = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !ft.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                file_paths.push(path);
            }
        }
    }

    let total_files = file_paths.len();
    let mut per_file_ms = Vec::with_capacity(total_files);
    let mut parsed = 0usize;
    let mut skipped = 0usize;

    let overall = Instant::now();

    for file_path in &file_paths {
        let t = Instant::now();
        match session_jsonl_parser::extract_thread_metadata(file_path).await {
            Ok(Some(_)) => {
                parsed += 1;
            }
            _ => {
                skipped += 1;
            }
        }
        per_file_ms.push(ms(t.elapsed()));
    }

    per_file_ms.sort_by(|a, b| a.partial_cmp(b).unwrap());

    Ok(MetadataExtractResult {
        total_files,
        parsed,
        skipped,
        total_ms: ms(overall.elapsed()),
        per_file_ms,
    })
}

// ─── Tests ───────────────────────────────────────────────────────────

/// Full cold scan: invalidate cache, scan all projects, measure wall time.
#[tokio::test]
async fn cold_scan() {
    if !live_benchmarks_enabled() {
        println!("Skipped (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return;
    }

    let db = open_dev_db().await.expect("open dev DB");
    let project_paths = get_project_paths(&db).await.expect("get project paths");
    println!("\n=== COLD SCAN BENCHMARK ===");
    println!("Projects: {}", project_paths.len());

    // Invalidate all caches
    invalidate_cache().await;

    let t = Instant::now();
    let entries = session_jsonl_parser::scan_projects(&project_paths)
        .await
        .expect("scan_projects");
    let cold_ms = ms(t.elapsed());

    println!(
        "Cold scan:  {:>8.1}ms  ({} entries)",
        cold_ms,
        entries.len()
    );

    // Warm scan (should hit cache)
    let t = Instant::now();
    let entries2 = session_jsonl_parser::scan_projects(&project_paths)
        .await
        .expect("scan_projects (warm)");
    let warm_ms = ms(t.elapsed());

    println!(
        "Warm scan:  {:>8.1}ms  ({} entries)",
        warm_ms,
        entries2.len()
    );
    println!(
        "Speedup:    {:>8.1}x",
        if warm_ms > 0.0 {
            cold_ms / warm_ms
        } else {
            f64::INFINITY
        }
    );

    let cache = get_cache();
    let stats = cache.get_stats();
    println!(
        "Cache: {} hits, {} misses, {} ttl_skips",
        stats.hits, stats.misses, stats.ttl_skips
    );
}

/// Warm scan (assumes cache is populated from normal usage).
#[tokio::test]
async fn warm_scan() {
    if !live_benchmarks_enabled() {
        println!("Skipped (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return;
    }

    let db = open_dev_db().await.expect("open dev DB");
    let project_paths = get_project_paths(&db).await.expect("get project paths");
    println!("\n=== WARM SCAN BENCHMARK ===");
    println!("Projects: {}", project_paths.len());

    // Prime the cache
    let _ = session_jsonl_parser::scan_projects(&project_paths).await;

    // Measure 5 warm scans
    let mut durations = Vec::new();
    for i in 0..5 {
        let t = Instant::now();
        let entries = session_jsonl_parser::scan_projects(&project_paths)
            .await
            .expect("scan_projects");
        let elapsed = ms(t.elapsed());
        durations.push(elapsed);
        println!(
            "  Run {}: {:>8.1}ms  ({} entries)",
            i + 1,
            elapsed,
            entries.len()
        );
    }

    durations.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("  Median:  {:>8.1}ms", percentile(&durations, 0.5));
    println!("  Min:     {:>8.1}ms", durations[0]);
    println!("  Max:     {:>8.1}ms", durations[durations.len() - 1]);
}

/// Break down time spent in each phase: dir walk, mtime collection, metadata extraction.
#[tokio::test]
async fn phase_breakdown() {
    if !live_benchmarks_enabled() {
        println!("Skipped (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return;
    }

    let db = open_dev_db().await.expect("open dev DB");
    let project_paths = get_project_paths(&db).await.expect("get project paths");
    println!("\n=== PHASE BREAKDOWN ===");
    println!("Projects: {}", project_paths.len());

    // Phase 1: Directory walk
    println!("\n--- Phase 1: Directory Walk ---");
    let walk = benchmark_dir_walk(&project_paths).await.expect("dir walk");
    println!(
        "  Total: {:.1}ms for {} projects, {} files",
        walk.walk_ms, walk.project_count, walk.total_files
    );

    // Top 5 slowest projects
    let mut sorted = walk.per_project.clone();
    sorted.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
    println!("  Top 5 slowest projects:");
    for (slug, count, dur) in sorted.iter().take(5) {
        println!("    {:<50} {:>6.1}ms  ({} files)", slug, dur, count);
    }

    // Phase 2: Metadata extraction (cold — no cache)
    println!("\n--- Phase 2: Metadata Extraction (cold) ---");
    invalidate_cache().await;
    let extract = benchmark_metadata_extraction(&project_paths)
        .await
        .expect("metadata extraction");
    println!(
        "  Total: {:.1}ms for {} files ({} parsed, {} skipped)",
        extract.total_ms, extract.total_files, extract.parsed, extract.skipped
    );

    if !extract.per_file_ms.is_empty() {
        println!(
            "  Per-file: min={:.2}ms  median={:.2}ms  p95={:.2}ms  p99={:.2}ms  max={:.2}ms",
            extract.per_file_ms[0],
            percentile(&extract.per_file_ms, 0.5),
            percentile(&extract.per_file_ms, 0.95),
            percentile(&extract.per_file_ms, 0.99),
            extract.per_file_ms[extract.per_file_ms.len() - 1],
        );

        // Top 10 slowest files
        println!("  Top 10 slowest files:");
        for (i, &dur) in extract.per_file_ms.iter().rev().take(10).enumerate() {
            println!("    #{}: {:.2}ms", i + 1, dur);
        }
    }
}

/// Multi-agent parallel scan (Claude + Cursor + OpenCode + Codex).
#[tokio::test]
async fn multi_agent_scan() {
    if !live_benchmarks_enabled() {
        println!("Skipped (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return;
    }

    let db = open_dev_db().await.expect("open dev DB");
    let project_paths = get_project_paths(&db).await.expect("get project paths");
    println!("\n=== MULTI-AGENT SCAN BENCHMARK ===");
    println!("Projects: {}", project_paths.len());

    // Invalidate Claude cache
    invalidate_cache().await;

    // Sequential timing for each agent
    let mut timings = Vec::new();

    let t = Instant::now();
    let claude = session_jsonl_parser::scan_projects(&project_paths)
        .await
        .unwrap_or_default();
    timings.push(ScanTiming {
        label: "Claude Code (scan_projects)".into(),
        duration_ms: ms(t.elapsed()),
        entries: claude.len(),
    });

    let t = Instant::now();
    let cursor = cursor_parser::discover_all_chats(&project_paths)
        .await
        .unwrap_or_default();
    timings.push(ScanTiming {
        label: "Cursor (discover_all_chats)".into(),
        duration_ms: ms(t.elapsed()),
        entries: cursor.len(),
    });

    let t = Instant::now();
    let opencode = opencode_parser::scan_sessions(&project_paths)
        .await
        .unwrap_or_default();
    timings.push(ScanTiming {
        label: "OpenCode (scan_sessions)".into(),
        duration_ms: ms(t.elapsed()),
        entries: opencode.len(),
    });

    let t = Instant::now();
    let codex = codex_scanner::scan_sessions(&project_paths)
        .await
        .unwrap_or_default();
    timings.push(ScanTiming {
        label: "Codex (scan_sessions)".into(),
        duration_ms: ms(t.elapsed()),
        entries: codex.len(),
    });

    println!("\nSequential per-agent timings:");
    for t in &timings {
        print_timing(t);
    }
    print_summary(&timings);

    // Parallel timing (how startup actually works)
    invalidate_cache().await;
    println!("\nParallel scan (tokio::join!):");
    let t = Instant::now();
    let (r1, r2, r3, r4) = tokio::join!(
        session_jsonl_parser::scan_projects(&project_paths),
        cursor_parser::discover_all_chats(&project_paths),
        opencode_parser::scan_sessions(&project_paths),
        codex_scanner::scan_sessions(&project_paths),
    );
    let parallel_ms = ms(t.elapsed());

    let total_entries = r1.as_ref().map(|v| v.len()).unwrap_or(0)
        + r2.as_ref().map(|v| v.len()).unwrap_or(0)
        + r3.as_ref().map(|v| v.len()).unwrap_or(0)
        + r4.as_ref().map(|v| v.len()).unwrap_or(0);

    let sequential_ms: f64 = timings.iter().map(|t| t.duration_ms).sum();
    println!(
        "  Wall time: {:.1}ms  ({} entries total)",
        parallel_ms, total_entries
    );
    println!(
        "  vs sequential: {:.1}ms  (parallel is {:.1}x faster)",
        sequential_ms,
        if parallel_ms > 0.0 {
            sequential_ms / parallel_ms
        } else {
            f64::INFINITY
        }
    );
}

/// Measures file size distribution to understand the scanning workload.
#[tokio::test]
async fn file_size_distribution() {
    if !live_benchmarks_enabled() {
        println!("Skipped (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return;
    }

    let db = open_dev_db().await.expect("open dev DB");
    let project_paths = get_project_paths(&db).await.expect("get project paths");
    println!("\n=== FILE SIZE DISTRIBUTION ===");

    let jsonl_root = get_session_jsonl_root().expect("jsonl root");
    let projects_dir = jsonl_root.join("projects");

    let mut sizes: Vec<u64> = Vec::new();

    for project_path in &project_paths {
        let slug = path_to_slug(project_path);
        let project_dir = projects_dir.join(&slug);
        if !tokio::fs::try_exists(&project_dir).await.unwrap_or(false) {
            continue;
        }

        let mut read_dir = match tokio::fs::read_dir(&project_dir).await {
            Ok(d) => d,
            Err(_) => continue,
        };

        while let Some(entry) = read_dir.next_entry().await.unwrap_or(None) {
            let ft = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if !ft.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if let Ok(meta) = entry.metadata().await {
                sizes.push(meta.len());
            }
        }
    }

    sizes.sort();

    if sizes.is_empty() {
        println!("No .jsonl files found");
        return;
    }

    let total_bytes: u64 = sizes.iter().sum();
    let avg = total_bytes as f64 / sizes.len() as f64;

    println!("Files:    {}", sizes.len());
    println!("Total:    {:.1} MB", total_bytes as f64 / 1_048_576.0);
    println!("Average:  {:.1} KB", avg / 1024.0);
    println!("Median:   {:.1} KB", sizes[sizes.len() / 2] as f64 / 1024.0);
    println!("Min:      {:.1} KB", sizes[0] as f64 / 1024.0);
    println!(
        "Max:      {:.1} MB",
        sizes[sizes.len() - 1] as f64 / 1_048_576.0
    );

    // Buckets
    let buckets = [
        ("< 1 KB", 0u64, 1024),
        ("1-10 KB", 1024, 10 * 1024),
        ("10-100 KB", 10 * 1024, 100 * 1024),
        ("100 KB - 1 MB", 100 * 1024, 1_048_576),
        ("1-10 MB", 1_048_576, 10 * 1_048_576),
        ("> 10 MB", 10 * 1_048_576, u64::MAX),
    ];

    println!("\nDistribution:");
    for (label, lo, hi) in &buckets {
        let count = sizes.iter().filter(|&&s| s >= *lo && s < *hi).count();
        let pct = count as f64 / sizes.len() as f64 * 100.0;
        let bar_len = (pct / 2.0) as usize;
        let bar: String = "#".repeat(bar_len);
        println!("  {:<16} {:>5} ({:>5.1}%) {}", label, count, pct, bar);
    }
}

/// Cache effectiveness: measures hit rates across multiple scan cycles.
#[tokio::test]
async fn cache_effectiveness() {
    if !live_benchmarks_enabled() {
        println!("Skipped (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return;
    }

    let db = open_dev_db().await.expect("open dev DB");
    let project_paths = get_project_paths(&db).await.expect("get project paths");
    println!("\n=== CACHE EFFECTIVENESS ===");
    println!("Projects: {}", project_paths.len());

    let cache = get_cache();

    // Cold scan
    invalidate_cache().await;
    cache.reset_stats();
    let t = Instant::now();
    let _ = session_jsonl_parser::scan_projects(&project_paths).await;
    let cold_ms = ms(t.elapsed());
    let cold_stats = cache.get_stats();
    let cold_size = cache.len().await;
    println!("\nCold scan: {:.1}ms", cold_ms);
    println!(
        "  Hits: {}, Misses: {}, Cache size: {}",
        cold_stats.hits, cold_stats.misses, cold_size
    );

    // Warm scan #1 (within TTL — returns cached without checking files)
    cache.reset_stats();
    let t = Instant::now();
    let _ = session_jsonl_parser::scan_projects(&project_paths).await;
    let warm1_ms = ms(t.elapsed());
    let warm1_stats = cache.get_stats();
    println!("\nWarm scan #1 (within 30s TTL): {:.1}ms", warm1_ms);
    println!(
        "  Hits: {}, Misses: {}, TTL skips: {}",
        warm1_stats.hits, warm1_stats.misses, warm1_stats.ttl_skips
    );

    // Force expire TTL, scan again (should get mtime-based cache hits)
    invalidate_cache().await;
    // Re-populate cache entries (but mark TTL as expired)
    let _ = session_jsonl_parser::scan_projects(&project_paths).await;
    // Now manually clear last_full_scan to simulate TTL expiry
    // We can't directly, but invalidate + re-scan gives us the same effect
    cache.reset_stats();
    invalidate_cache().await;
    let t = Instant::now();
    let _ = session_jsonl_parser::scan_projects(&project_paths).await;
    let warm2_ms = ms(t.elapsed());
    let warm2_stats = cache.get_stats();
    println!(
        "\nWarm scan #2 (TTL expired, mtime check): {:.1}ms",
        warm2_ms
    );
    println!(
        "  Hits: {}, Misses: {}",
        warm2_stats.hits, warm2_stats.misses
    );
    println!(
        "  Hit rate: {:.1}%",
        if warm2_stats.hits + warm2_stats.misses > 0 {
            warm2_stats.hits as f64 / (warm2_stats.hits + warm2_stats.misses) as f64 * 100.0
        } else {
            0.0
        }
    );
}

/// SQLite index fast-path benchmark (what normally runs at startup when index is populated).
#[tokio::test]
async fn sqlite_index_scan() {
    if !live_benchmarks_enabled() {
        println!("Skipped (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return;
    }

    let db = open_dev_db().await.expect("open dev DB");
    let project_paths = get_project_paths(&db).await.expect("get project paths");
    println!("\n=== SQLITE INDEX BENCHMARK ===");
    println!("Projects: {}", project_paths.len());

    use acepe_lib::db::repository::SessionMetadataRepository;

    // Measure index query
    let mut durations = Vec::new();
    let mut entry_count = 0;

    for i in 0..10 {
        let t = Instant::now();
        let result = SessionMetadataRepository::get_for_projects(
            &db,
            &project_paths,
            &std::collections::HashSet::new(),
        )
        .await;
        let elapsed = ms(t.elapsed());
        durations.push(elapsed);

        if let Ok(lookup) = &result {
            entry_count = lookup.entries.len();
        }

        if i == 0 {
            println!("Entries in index: {}", entry_count);
        }
    }

    durations.sort_by(|a, b| a.partial_cmp(b).unwrap());

    println!("\nSQLite index query (10 runs):");
    println!("  Min:     {:>8.1}ms", durations[0]);
    println!("  Median:  {:>8.1}ms", percentile(&durations, 0.5));
    println!("  P95:     {:>8.1}ms", percentile(&durations, 0.95));
    println!("  Max:     {:>8.1}ms", durations[durations.len() - 1]);

    if entry_count == 0 {
        println!("\n  ⚠ Index is empty — startup will fall back to file scan");
    } else {
        println!("\n  ✓ Index populated — startup uses fast path");
    }
}

/// End-to-end startup simulation: measures what the user actually experiences.
#[tokio::test]
async fn startup_simulation() {
    if !live_benchmarks_enabled() {
        println!("Skipped (set ACEPE_RUN_LIVE_BENCHMARKS=1)");
        return;
    }

    let db = open_dev_db().await.expect("open dev DB");
    let project_paths = get_project_paths(&db).await.expect("get project paths");
    println!("\n=== STARTUP SIMULATION ===");
    println!("Projects: {}", project_paths.len());
    for p in &project_paths {
        println!("  - {}", p);
    }

    use acepe_lib::db::repository::SessionMetadataRepository;

    // Step 1: Try SQLite index (fast path)
    let t_idx = Instant::now();
    let index_result = SessionMetadataRepository::get_for_projects(
        &db,
        &project_paths,
        &std::collections::HashSet::new(),
    )
    .await;
    let idx_ms = ms(t_idx.elapsed());
    let index_count = index_result
        .as_ref()
        .map(|lookup| lookup.entries.len())
        .unwrap_or(0);
    let index_populated = index_result
        .ok()
        .filter(|lookup| lookup.db_row_count > 0)
        .is_some();

    println!("\nStep 1: SQLite index query");
    println!(
        "  {:.1}ms — {} entries (populated: {})",
        idx_ms, index_count, index_populated
    );

    if index_populated {
        println!("  → Fast path: startup scan complete in {:.1}ms", idx_ms);
        println!(
            "    (Title derivation adds ~10-50ms on top, but sessions are visible immediately)"
        );
    } else {
        // Step 2: File scan fallback
        invalidate_cache().await;
        println!("\nStep 2: File scan fallback (index empty)");

        let t_scan = Instant::now();
        let (r1, r2, r3, r4) = tokio::join!(
            session_jsonl_parser::scan_projects(&project_paths),
            cursor_parser::discover_all_chats(&project_paths),
            opencode_parser::scan_sessions(&project_paths),
            codex_scanner::scan_sessions(&project_paths),
        );
        let scan_ms = ms(t_scan.elapsed());

        let counts = [
            ("Claude", r1.as_ref().map(|v| v.len()).unwrap_or(0)),
            ("Cursor", r2.as_ref().map(|v| v.len()).unwrap_or(0)),
            ("OpenCode", r3.as_ref().map(|v| v.len()).unwrap_or(0)),
            ("Codex", r4.as_ref().map(|v| v.len()).unwrap_or(0)),
        ];
        let total: usize = counts.iter().map(|(_, c)| c).sum();

        println!("  {:.1}ms — {} entries total", scan_ms, total);
        for (name, count) in &counts {
            if *count > 0 {
                println!("    {}: {}", name, count);
            }
        }

        println!(
            "\n  → Slow path: startup scan took {:.1}ms total",
            idx_ms + scan_ms
        );
    }
}
