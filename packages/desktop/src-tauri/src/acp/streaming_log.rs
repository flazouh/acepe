//! Dev-only streaming data logger.
//!
//! Logs both raw incoming data and emitted ACP events to the same JSONL file,
//! distinguished by a `"direction"` field: `"in"` for raw agent data, `"out"` for
//! normalized ACP events sent to the frontend. Only active in debug builds.

use serde_json::Value;
use std::path::PathBuf;

#[cfg(debug_assertions)]
use std::fs::{self, OpenOptions};
#[cfg(debug_assertions)]
use std::io::Write;
#[cfg(debug_assertions)]
use std::path::Path;
#[cfg(debug_assertions)]
use std::sync::OnceLock;
#[cfg(debug_assertions)]
use std::time::{Duration, SystemTime};

#[cfg(debug_assertions)]
const LOG_RETENTION_DAYS: u64 = 14;
#[cfg(debug_assertions)]
const MAX_LOG_FILE_BYTES: u64 = 50 * 1024 * 1024;
#[cfg(debug_assertions)]
const MAX_LOG_DIR_BYTES: u64 = 500 * 1024 * 1024;

/// Get the log directory path
#[cfg(debug_assertions)]
fn log_dir() -> PathBuf {
    // Use the project's logs directory
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("logs");
    path.push("streaming");
    path
}

/// Ensure the log directory exists
#[cfg(debug_assertions)]
fn ensure_log_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(log_dir())
}

#[cfg(debug_assertions)]
fn should_skip_file_write(path: &Path) -> std::io::Result<bool> {
    if !path.exists() {
        return Ok(false);
    }

    let metadata = fs::metadata(path)?;
    Ok(metadata.len() >= MAX_LOG_FILE_BYTES)
}

#[cfg(debug_assertions)]
fn prune_log_dir_if_needed() -> std::io::Result<()> {
    let now = SystemTime::now();
    let retention = Duration::from_secs(LOG_RETENTION_DAYS * 24 * 60 * 60);
    let path = log_dir();

    let mut files: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    for entry in fs::read_dir(&path)? {
        let entry = entry?;
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }
        let metadata = entry.metadata()?;
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

        if now.duration_since(modified).unwrap_or(Duration::ZERO) > retention {
            if let Err(error) = fs::remove_file(&entry_path) {
                tracing::warn!(error = %error, path = %entry_path.display(), "Failed to prune old streaming log");
            }
            continue;
        }

        files.push((entry_path, metadata.len(), modified));
    }

    let mut total_size: u64 = files.iter().map(|(_, size, _)| *size).sum();
    if total_size <= MAX_LOG_DIR_BYTES {
        return Ok(());
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    for (entry_path, size, _) in files {
        if total_size <= MAX_LOG_DIR_BYTES {
            break;
        }

        if let Err(error) = fs::remove_file(&entry_path) {
            tracing::warn!(error = %error, path = %entry_path.display(), "Failed to prune oversized streaming log directory");
            continue;
        }
        total_size = total_size.saturating_sub(size);
    }

    Ok(())
}

/// Get the log file path for a session
#[cfg(debug_assertions)]
fn log_file_path(session_id: &str) -> PathBuf {
    let mut path = log_dir();
    // Sanitize session_id for filename safety
    let safe_id: String = session_id
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    path.push(format!("{}.jsonl", safe_id));
    path
}

/// Append a log entry to the session's JSONL file.
#[cfg(debug_assertions)]
fn write_log_entry(session_id: &str, entry: &Value) {
    static INIT: OnceLock<bool> = OnceLock::new();

    INIT.get_or_init(|| {
        if let Err(e) = ensure_log_dir() {
            tracing::warn!(error = %e, "Failed to create streaming log directory");
            return false;
        }
        if let Err(e) = prune_log_dir_if_needed() {
            tracing::warn!(error = %e, "Failed to prune streaming logs");
        }
        tracing::info!(path = %log_dir().display(), "Streaming log directory ready");
        true
    });

    let file_path = log_file_path(session_id);
    if should_skip_file_write(&file_path).unwrap_or(false) {
        tracing::warn!(
            path = %file_path.display(),
            max_file_bytes = MAX_LOG_FILE_BYTES,
            "Skipping streaming log write because file reached size limit"
        );
        return;
    }

    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
    {
        Ok(mut file) => {
            if let Err(e) = writeln!(file, "{}", entry) {
                tracing::warn!(error = %e, "Failed to write streaming log entry");
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, path = %file_path.display(), "Failed to open streaming log file");
        }
    }
}

/// Log a raw incoming event from the agent (direction: "in").
/// Only active in debug builds.
#[cfg(debug_assertions)]
pub fn log_streaming_event(session_id: &str, raw_json: &Value) {
    let entry = serde_json::json!({
        "direction": "in",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": raw_json
    });
    write_log_entry(session_id, &entry);
}

/// Log a normalized ACP event emitted to the frontend (direction: "out").
/// Only active in debug builds.
#[cfg(debug_assertions)]
pub fn log_emitted_event(session_id: &str, update: &impl serde::Serialize) {
    let entry = serde_json::json!({
        "direction": "out",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": update
    });
    write_log_entry(session_id, &entry);
}

/// No-op in release builds
#[cfg(not(debug_assertions))]
pub fn log_streaming_event(_session_id: &str, _raw_json: &Value) {}

/// No-op in release builds
#[cfg(not(debug_assertions))]
pub fn log_emitted_event(_session_id: &str, _update: &impl serde::Serialize) {}

/// Get the log file path for a session (for opening in file manager).
/// Returns None in release builds.
#[cfg(debug_assertions)]
pub fn get_log_file_path(session_id: &str) -> Option<PathBuf> {
    let path = log_file_path(session_id);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// Get the log directory path (for opening in file manager).
/// Returns None in release builds.
#[cfg(debug_assertions)]
pub fn get_log_directory() -> Option<PathBuf> {
    let path = log_dir();
    if path.exists() {
        Some(path)
    } else {
        // Create it if it doesn't exist
        if ensure_log_dir().is_ok() {
            Some(path)
        } else {
            None
        }
    }
}

#[cfg(not(debug_assertions))]
pub fn get_log_file_path(_session_id: &str) -> Option<PathBuf> {
    None
}

#[cfg(not(debug_assertions))]
pub fn get_log_directory() -> Option<PathBuf> {
    None
}

/// Clear the log file for a session
#[cfg(debug_assertions)]
pub fn clear_session_log(session_id: &str) -> std::io::Result<()> {
    let path = log_file_path(session_id);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(not(debug_assertions))]
pub fn clear_session_log(_session_id: &str) -> std::io::Result<()> {
    Ok(())
}
