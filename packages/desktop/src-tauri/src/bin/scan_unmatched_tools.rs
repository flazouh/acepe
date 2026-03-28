//! Scan streaming logs and historical session data; report tool names that the
//! Cursor adapter does not recognize (kind = Other).
//!
//! Two sources:
//! - LIVE (streaming): session/update with sessionUpdate "tool_call". Effective
//!   name = update.name ?? rawInput._toolName ?? update.title.
//! - HISTORICAL: raw message lines with type "assistant" and message.content
//!   array containing blocks with type "tool_use" and field "name" (same format
//!   as Claude History / full_session parser).
//!
//! Usage:
//!   cargo run --bin scan_unmatched_tools [-- <logs_dir>]
//!
//! Default logs_dir: ./logs/streaming (relative to cwd). Pass a directory that
//! contains both streaming and/or historical jsonl (same dir can have both).

use acepe_lib::acp::parsers::adapters::CursorAdapter;
use acepe_lib::acp::session_update::ToolKind;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Sample context for an unmatched tool.
#[derive(Debug, Clone)]
struct Sample {
    title: String,
    payload_kind: String,
    source: &'static str, // "streaming" | "historical"
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let logs_dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "logs/streaming".to_string());
    let logs_path = Path::new(&logs_dir);

    if !logs_path.is_dir() {
        eprintln!("Not a directory (or missing): {}", logs_path.display());
        std::process::exit(1);
    }

    let mut unmatched: HashMap<String, (u64, Vec<Sample>)> = HashMap::new();
    let mut total_streaming: u64 = 0;
    let mut total_historical: u64 = 0;

    for entry in std::fs::read_dir(logs_path)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "jsonl") {
            process_jsonl(
                &path,
                &mut unmatched,
                &mut total_streaming,
                &mut total_historical,
            )?;
        }
    }

    println!(
        "LIVE (streaming) tool_call updates scanned: {}",
        total_streaming
    );
    println!("HISTORICAL tool_use blocks scanned: {}", total_historical);
    println!("Unique unmatched tool names: {}", unmatched.len());
    println!();

    if unmatched.is_empty() {
        println!("No unmatched tool names.");
        return Ok(());
    }

    let mut names: Vec<_> = unmatched.into_iter().collect();
    names.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));

    println!("Unmatched (name => count, samples):");
    println!("---");
    for (name, (count, samples)) in names {
        println!("  \"{}\" => {} occurrences", name, count);
        for s in samples.iter().take(5) {
            println!(
                "    [{}] title=\"{}\" payload_kind=\"{}\"",
                s.source, s.title, s.payload_kind
            );
        }
        if samples.len() > 5 {
            println!("    ... and {} more", samples.len() - 5);
        }
        println!();
    }

    Ok(())
}

fn process_jsonl(
    path: &Path,
    unmatched: &mut HashMap<String, (u64, Vec<Sample>)>,
    total_streaming: &mut u64,
    total_historical: &mut u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let f = File::open(path)?;
    let reader = BufReader::new(f);

    for line in reader.lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let root: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // LIVE: session/update with tool_call
        if root
            .get("data")
            .and_then(|d| d.get("method"))
            .and_then(|m| m.as_str())
            == Some("session/update")
        {
            if let Some(update) = root
                .get("data")
                .and_then(|d| d.get("params"))
                .and_then(|p| p.get("update"))
            {
                if update.get("sessionUpdate").and_then(|v| v.as_str()) == Some("tool_call") {
                    *total_streaming += 1;
                    let payload_kind = update
                        .get("kind")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let title = update
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = update
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let raw_tool_name = update
                        .get("rawInput")
                        .and_then(|r| r.get("_toolName"))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let effective_name = name
                        .or(raw_tool_name)
                        .unwrap_or_else(|| title.clone())
                        .trim()
                        .to_string();
                    if !effective_name.is_empty() {
                        record_unmatched(
                            unmatched,
                            &effective_name,
                            &title,
                            &payload_kind,
                            "streaming",
                        );
                    }
                    continue;
                }
            }
        }

        // HISTORICAL: raw message with type "assistant" and message.content array
        if root.get("type").and_then(|v| v.as_str()) == Some("assistant") {
            let content = root.get("message").and_then(|m| m.get("content"));
            if let Some(arr) = content.and_then(|c| c.as_array()) {
                for item in arr {
                    if item.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                        continue;
                    }
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty());
                    if let Some(name) = name {
                        *total_historical += 1;
                        record_unmatched(unmatched, name, "", "", "historical");
                    }
                }
            }
        }
    }

    Ok(())
}

fn record_unmatched(
    unmatched: &mut HashMap<String, (u64, Vec<Sample>)>,
    effective_name: &str,
    title: &str,
    payload_kind: &str,
    source: &'static str,
) {
    let kind = CursorAdapter::normalize(effective_name);
    if kind != ToolKind::Other {
        return;
    }
    let sample = Sample {
        title: title.to_string(),
        payload_kind: payload_kind.to_string(),
        source,
    };
    unmatched
        .entry(effective_name.to_string())
        .or_insert_with(|| (0, Vec::with_capacity(5)))
        .0 += 1;
    let entry = unmatched.get_mut(effective_name).unwrap();
    if entry.1.len() < 5 {
        entry.1.push(sample);
    }
}
