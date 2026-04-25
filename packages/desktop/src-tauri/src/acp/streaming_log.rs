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
use std::sync::{Mutex, OnceLock};
#[cfg(debug_assertions)]
use std::time::{Duration, SystemTime};

#[cfg(debug_assertions)]
const LOG_RETENTION_DAYS: u64 = 14;
#[cfg(debug_assertions)]
const MAX_LOG_FILE_BYTES: u64 = 50 * 1024 * 1024;
#[cfg(debug_assertions)]
const MAX_LOG_DIR_BYTES: u64 = 500 * 1024 * 1024;
#[cfg(debug_assertions)]
const MAX_LOG_VALUE_CHARS: usize = 16 * 1024;
#[cfg(debug_assertions)]
const REDACTED: &str = "[REDACTED]";

#[cfg(debug_assertions)]
fn log_io_lock() -> &'static Mutex<()> {
    static LOG_IO_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOG_IO_LOCK.get_or_init(|| Mutex::new(()))
}

/// Get the log directory path
#[cfg(debug_assertions)]
fn log_dir() -> PathBuf {
    static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
    LOG_DIR
        .get_or_init(|| {
            #[cfg(test)]
            {
                return std::env::temp_dir()
                    .join("Acepe")
                    .join("logs")
                    .join("streaming");
            }
            #[cfg(not(test))]
            {
                let base_dir = dirs::data_local_dir()
                    .or_else(dirs::cache_dir)
                    .unwrap_or_else(std::env::temp_dir);
                base_dir.join("Acepe").join("logs").join("streaming")
            }
        })
        .clone()
}

#[cfg(debug_assertions)]
fn project_manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[cfg(debug_assertions)]
fn is_inside_path(path: &Path, ancestor: &Path) -> bool {
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let canonical_ancestor = ancestor
        .canonicalize()
        .unwrap_or_else(|_| ancestor.to_path_buf());
    canonical_path.starts_with(canonical_ancestor)
}

#[cfg(debug_assertions)]
pub(crate) fn streaming_log_dir_is_outside_project() -> bool {
    !is_inside_path(&log_dir(), &project_manifest_dir())
}

/// Ensure the log directory exists
#[cfg(debug_assertions)]
fn ensure_log_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(log_dir())
}

#[cfg(debug_assertions)]
fn sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.contains("token")
        || lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.contains("authorization")
        || lower.contains("credential")
}

#[cfg(debug_assertions)]
fn looks_like_secret(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("bearer ")
        || lower.contains("sk-")
        || lower.contains("ghp_")
        || lower.contains("github_pat_")
        || lower.contains("api_key=")
        || lower.contains("apikey=")
        || lower.contains("password=")
        || lower.contains("authorization:")
}

#[cfg(debug_assertions)]
fn truncate_log_string(value: &str) -> Value {
    let char_count = value.chars().count();
    if char_count <= MAX_LOG_VALUE_CHARS {
        return Value::String(value.to_string());
    }

    let truncated = value.chars().take(MAX_LOG_VALUE_CHARS).collect::<String>();
    serde_json::json!({
        "truncated": true,
        "originalChars": char_count,
        "value": truncated
    })
}

#[cfg(debug_assertions)]
pub(crate) fn sanitize_log_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let sanitized = object
                .iter()
                .map(|(key, value)| {
                    let next_value = if sensitive_key(key) {
                        Value::String(REDACTED.to_string())
                    } else {
                        sanitize_log_value(value)
                    };
                    (key.clone(), next_value)
                })
                .collect::<serde_json::Map<String, Value>>();
            Value::Object(sanitized)
        }
        Value::Array(values) => Value::Array(values.iter().map(sanitize_log_value).collect()),
        Value::String(value) => {
            if looks_like_secret(value) {
                Value::String(REDACTED.to_string())
            } else {
                truncate_log_string(value)
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
    }
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
    let _guard = log_io_lock()
        .lock()
        .expect("streaming log IO lock should not be poisoned");
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
    let data = sanitize_log_value(raw_json);
    let entry = serde_json::json!({
        "direction": "in",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": data
    });
    write_log_entry(session_id, &entry);
}

/// Log a structured debug event to the session streaming log.
/// Only active in debug builds.
#[cfg(debug_assertions)]
pub fn log_debug_event(session_id: &str, event: &str, payload: &Value) {
    let mut data =
        serde_json::Map::from_iter([("event".to_string(), Value::String(event.to_string()))]);

    if let Some(object) = payload.as_object() {
        for (key, value) in object {
            data.insert(key.clone(), value.clone());
        }
    } else {
        data.insert("payload".to_string(), payload.clone());
    }

    log_streaming_event(session_id, &Value::Object(data));
}

/// Log a normalized ACP event emitted to the frontend (direction: "out").
/// Only active in debug builds.
#[cfg(debug_assertions)]
pub fn log_emitted_event(session_id: &str, update: &impl serde::Serialize) {
    let data = serde_json::to_value(update).unwrap_or_else(|error| {
        serde_json::json!({
            "serializationError": error.to_string()
        })
    });
    let data = sanitize_log_value(&data);
    let entry = serde_json::json!({
        "direction": "out",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "data": data
    });
    write_log_entry(session_id, &entry);
}

/// No-op in release builds
#[cfg(not(debug_assertions))]
pub fn log_streaming_event(_session_id: &str, _raw_json: &Value) {}

/// No-op in release builds.
#[cfg(not(debug_assertions))]
pub fn log_debug_event(_session_id: &str, _event: &str, _payload: &Value) {}

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
    let _guard = log_io_lock()
        .lock()
        .expect("streaming log IO lock should not be poisoned");
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sanitizes_sensitive_keys_and_secret_like_values() {
        let sanitized = sanitize_log_value(&json!({
            "api_key": "sk-secret",
            "nested": {
                "authorization": "Bearer abc",
                "content": "normal text"
            },
            "message": "password=hunter2"
        }));

        assert_eq!(sanitized["api_key"], "[REDACTED]");
        assert_eq!(sanitized["nested"]["authorization"], "[REDACTED]");
        assert_eq!(sanitized["nested"]["content"], "normal text");
        assert_eq!(sanitized["message"], "[REDACTED]");
    }

    #[test]
    fn truncates_large_string_payloads_before_disk_write() {
        let large = "x".repeat(MAX_LOG_VALUE_CHARS + 4);
        let sanitized = sanitize_log_value(&json!({ "content": large }));

        assert_eq!(sanitized["content"]["truncated"], true);
        assert_eq!(
            sanitized["content"]["originalChars"],
            MAX_LOG_VALUE_CHARS + 4
        );
    }

    #[test]
    fn debug_streaming_log_directory_is_outside_source_tree() {
        assert!(streaming_log_dir_is_outside_project());
    }

    #[test]
    fn log_debug_event_writes_named_payload_to_session_log() {
        let session_id = "streaming-log-debug-event-test";
        let _ = clear_session_log(session_id);

        log_debug_event(
            session_id,
            "permission.callback.received",
            &json!({
                "source": "can_use_tool",
                "toolCallId": "toolu_123"
            }),
        );

        let path = get_log_file_path(session_id).expect("log file path should exist");
        let contents = std::fs::read_to_string(&path).expect("should read log file");
        let entry: Value = serde_json::from_str(
            contents
                .lines()
                .last()
                .expect("log file should contain an entry"),
        )
        .expect("log entry should parse as json");

        assert_eq!(entry["direction"], "in");
        assert_eq!(entry["data"]["event"], "permission.callback.received");
        assert_eq!(entry["data"]["source"], "can_use_tool");
        assert_eq!(entry["data"]["toolCallId"], "toolu_123");

        let _ = clear_session_log(session_id);
    }
}
