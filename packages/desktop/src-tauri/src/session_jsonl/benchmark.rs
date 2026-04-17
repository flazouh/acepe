//! Benchmark script for Claude session parsing.
//!
//! Run with: cargo test benchmark_session_parsing --release -- --nocapture

use crate::session_jsonl::parser::{get_session_jsonl_root, parse_full_session};
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// Statistics for session parsing benchmark
#[derive(Debug)]
#[allow(dead_code)]
pub struct BenchmarkStats {
    pub total_sessions: usize,
    pub successful_parses: usize,
    pub failed_parses: usize,
    pub total_time: Duration,
    pub avg_time: Duration,
    pub min_time: Duration,
    pub max_time: Duration,
    pub median_time: Duration,
    pub p95_time: Duration,
    pub p99_time: Duration,
    pub slowest_session: Option<(String, Duration, usize)>,
    pub largest_session: Option<(String, usize, Duration)>,
}

/// Individual session result
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct SessionResult {
    session_id: String,
    project_path: String,
    duration: Duration,
    message_count: usize,
    entry_count: usize,
    file_size_bytes: u64,
}

/// Session to benchmark
struct SessionToBenchmark {
    session_id: String,
    project_path: String,
    file_path: PathBuf,
}

/// Scan ALL sessions without any limits (for benchmarking)
async fn scan_all_sessions_unlimited() -> anyhow::Result<Vec<SessionToBenchmark>> {
    let jsonl_root = get_session_jsonl_root()?;
    let projects_dir = jsonl_root.join("projects");

    if !projects_dir.exists() {
        anyhow::bail!("Claude projects directory not found: {:?}", projects_dir);
    }

    let mut all_sessions = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&projects_dir).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let project_slug = entry.file_name();
        let project_slug_str = project_slug.to_string_lossy();

        if project_slug_str.starts_with('.') {
            continue;
        }

        let project_dir = entry.path();
        if !project_dir.is_dir() {
            continue;
        }

        // Convert slug back to project path
        let project_path = if project_slug_str.starts_with('-') {
            project_slug_str.replacen('-', "/", 1).replace('-', "/")
        } else {
            project_slug_str.to_string()
        };

        // Read all .jsonl files in this project folder
        let mut project_read_dir = match tokio::fs::read_dir(&project_dir).await {
            Ok(dir) => dir,
            Err(_) => continue,
        };

        while let Some(file_entry) = project_read_dir.next_entry().await? {
            let file_path = file_entry.path();
            let file_name = file_entry.file_name();
            let file_name_str = file_name.to_string_lossy();

            // Only process .jsonl files that look like UUIDs
            if file_name_str.ends_with(".jsonl") {
                let session_id = file_name_str.trim_end_matches(".jsonl");
                // Basic UUID validation
                if session_id.len() == 36 && session_id.contains('-') {
                    all_sessions.push(SessionToBenchmark {
                        session_id: session_id.to_string(),
                        project_path: project_path.clone(),
                        file_path,
                    });
                }
            }
        }
    }

    Ok(all_sessions)
}

/// Run benchmark on all Claude sessions
pub async fn benchmark_all_sessions() -> anyhow::Result<BenchmarkStats> {
    println!("Scanning for all Claude sessions (no limits)...");

    let all_sessions = scan_all_sessions_unlimited().await?;

    println!("Found {} sessions to benchmark\n", all_sessions.len());

    if all_sessions.is_empty() {
        return Ok(BenchmarkStats {
            total_sessions: 0,
            successful_parses: 0,
            failed_parses: 0,
            total_time: Duration::ZERO,
            avg_time: Duration::ZERO,
            min_time: Duration::ZERO,
            max_time: Duration::ZERO,
            median_time: Duration::ZERO,
            p95_time: Duration::ZERO,
            p99_time: Duration::ZERO,
            slowest_session: None,
            largest_session: None,
        });
    }

    let mut results: Vec<SessionResult> = Vec::new();
    let mut failed_parses = 0;
    let overall_start = Instant::now();

    for (i, session) in all_sessions.iter().enumerate() {
        // Get file size
        let file_size = tokio::fs::metadata(&session.file_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        let start = Instant::now();

        match parse_full_session(&session.session_id, &session.project_path).await {
            Ok(full_session) => {
                let duration = start.elapsed();

                // Convert to entries to get entry count
                let converted =
                    crate::session_converter::convert_claude_full_session_to_entries(&full_session);

                results.push(SessionResult {
                    session_id: session.session_id.clone(),
                    project_path: session.project_path.clone(),
                    duration,
                    message_count: full_session.messages.len(),
                    entry_count: converted.entries.len(),
                    file_size_bytes: file_size,
                });

                if (i + 1) % 500 == 0 {
                    println!("Processed {}/{} sessions...", i + 1, all_sessions.len());
                }
            }
            Err(e) => {
                failed_parses += 1;
                if failed_parses <= 5 {
                    eprintln!("Failed to parse session {}: {}", session.session_id, e);
                }
            }
        }
    }

    let total_time = overall_start.elapsed();

    if results.is_empty() {
        return Ok(BenchmarkStats {
            total_sessions: all_sessions.len(),
            successful_parses: 0,
            failed_parses,
            total_time,
            avg_time: Duration::ZERO,
            min_time: Duration::ZERO,
            max_time: Duration::ZERO,
            median_time: Duration::ZERO,
            p95_time: Duration::ZERO,
            p99_time: Duration::ZERO,
            slowest_session: None,
            largest_session: None,
        });
    }

    // Sort by duration for percentile calculations
    let mut durations: Vec<Duration> = results.iter().map(|r| r.duration).collect();
    durations.sort();

    let min_time = durations[0];
    let max_time = durations[durations.len() - 1];
    let median_time = durations[durations.len() / 2];
    let p95_idx = (durations.len() as f64 * 0.95) as usize;
    let p99_idx = (durations.len() as f64 * 0.99) as usize;
    let p95_time = durations[p95_idx.min(durations.len() - 1)];
    let p99_time = durations[p99_idx.min(durations.len() - 1)];

    let total_duration: Duration = durations.iter().sum();
    let avg_time = total_duration / results.len() as u32;

    // Find slowest session
    let slowest = results
        .iter()
        .max_by_key(|r| r.duration)
        .map(|r| (r.session_id.clone(), r.duration, r.message_count));

    // Find largest session (by message count)
    let largest = results
        .iter()
        .max_by_key(|r| r.message_count)
        .map(|r| (r.session_id.clone(), r.message_count, r.duration));

    // Print detailed results
    println!("\n========================================");
    println!("       BENCHMARK RESULTS");
    println!("========================================\n");

    println!(
        "Sessions: {} total, {} successful, {} failed",
        all_sessions.len(),
        results.len(),
        failed_parses
    );
    println!();

    println!("Timing Statistics:");
    println!("  Total time:  {:>10.2?}", total_time);
    println!("  Average:     {:>10.2?}", avg_time);
    println!("  Minimum:     {:>10.2?}", min_time);
    println!("  Maximum:     {:>10.2?}", max_time);
    println!("  Median:      {:>10.2?}", median_time);
    println!("  P95:         {:>10.2?}", p95_time);
    println!("  P99:         {:>10.2?}", p99_time);
    println!();

    if let Some((id, duration, msg_count)) = &slowest {
        println!("Slowest Session:");
        println!("  ID:          {}", id);
        println!("  Duration:    {:?}", duration);
        println!("  Messages:    {}", msg_count);
        println!();
    }

    if let Some((id, msg_count, duration)) = &largest {
        println!("Largest Session (by message count):");
        println!("  ID:          {}", id);
        println!("  Messages:    {}", msg_count);
        println!("  Duration:    {:?}", duration);
        println!();
    }

    // Print top 10 slowest sessions
    println!("Top 10 Slowest Sessions:");
    println!(
        "{:<40} {:>12} {:>8} {:>12}",
        "Session ID", "Duration", "Messages", "File Size"
    );
    println!("{:-<40} {:-<12} {:-<8} {:-<12}", "", "", "", "");

    let mut sorted_results = results.clone();
    sorted_results.sort_by_key(|result| std::cmp::Reverse(result.duration));

    for result in sorted_results.iter().take(10) {
        let file_size_kb = result.file_size_bytes as f64 / 1024.0;
        println!(
            "{:<40} {:>12.2?} {:>8} {:>10.1}KB",
            &result.session_id[..result.session_id.len().min(40)],
            result.duration,
            result.message_count,
            file_size_kb
        );
    }
    println!();

    // Print size vs time correlation
    println!("Size vs Time Analysis:");
    let mut by_size: Vec<_> = results.iter().collect();
    by_size.sort_by_key(|r| r.file_size_bytes);

    let small_sessions: Vec<_> = by_size.iter().take(by_size.len() / 3).collect();
    let medium_sessions: Vec<_> = by_size
        .iter()
        .skip(by_size.len() / 3)
        .take(by_size.len() / 3)
        .collect();
    let large_sessions: Vec<_> = by_size.iter().skip(2 * by_size.len() / 3).collect();

    fn avg_duration(sessions: &[&&SessionResult]) -> Duration {
        if sessions.is_empty() {
            return Duration::ZERO;
        }
        let total: Duration = sessions.iter().map(|s| s.duration).sum();
        total / sessions.len() as u32
    }

    fn avg_size(sessions: &[&&SessionResult]) -> f64 {
        if sessions.is_empty() {
            return 0.0;
        }
        sessions
            .iter()
            .map(|s| s.file_size_bytes as f64)
            .sum::<f64>()
            / sessions.len() as f64
            / 1024.0
    }

    println!(
        "  Small files  (avg {:>8.1}KB):  avg parse time {:?}",
        avg_size(&small_sessions),
        avg_duration(&small_sessions)
    );
    println!(
        "  Medium files (avg {:>8.1}KB):  avg parse time {:?}",
        avg_size(&medium_sessions),
        avg_duration(&medium_sessions)
    );
    println!(
        "  Large files  (avg {:>8.1}KB):  avg parse time {:?}",
        avg_size(&large_sessions),
        avg_duration(&large_sessions)
    );

    Ok(BenchmarkStats {
        total_sessions: all_sessions.len(),
        successful_parses: results.len(),
        failed_parses,
        total_time,
        avg_time,
        min_time,
        max_time,
        median_time,
        p95_time,
        p99_time,
        slowest_session: slowest,
        largest_session: largest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Run manually with: cargo test benchmark_session_parsing --release -- --nocapture --ignored
    #[tokio::test]
    #[ignore] // Takes 30-40s parsing all sessions - run explicitly when needed
    async fn benchmark_session_parsing() {
        println!("\n\n");
        println!("╔══════════════════════════════════════════════════════════════╗");
        println!("║        CLAUDE SESSION PARSING BENCHMARK                      ║");
        println!("╚══════════════════════════════════════════════════════════════╝");
        println!();

        match benchmark_all_sessions().await {
            Ok(stats) => {
                println!("\n========================================");
                println!("       SUMMARY");
                println!("========================================");
                println!("Total sessions:    {}", stats.total_sessions);
                println!("Successful:        {}", stats.successful_parses);
                println!("Failed:            {}", stats.failed_parses);
                println!("Average parse:     {:?}", stats.avg_time);
                println!("P95 parse:         {:?}", stats.p95_time);
                println!("Max parse:         {:?}", stats.max_time);
            }
            Err(e) => {
                eprintln!("Benchmark failed: {}", e);
            }
        }
    }
}
