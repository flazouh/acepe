//! Status normalization for ACP tool calls.
//!
//! All agents map the same set of synonym strings to four canonical statuses.
//! This module centralises that logic so individual parsers don't duplicate it.

/// Normalize an explicit status string to one of the four canonical values.
///
/// Returns `None` for unrecognised strings.
pub fn normalize_status(status: &str) -> Option<String> {
    let s = status.trim();
    let canonical = if s.eq_ignore_ascii_case("pending") {
        "pending"
    } else if s.eq_ignore_ascii_case("in_progress")
        || s.eq_ignore_ascii_case("inprogress")
        || s.eq_ignore_ascii_case("running")
        || s.eq_ignore_ascii_case("started")
    {
        "in_progress"
    } else if s.eq_ignore_ascii_case("completed")
        || s.eq_ignore_ascii_case("complete")
        || s.eq_ignore_ascii_case("success")
        || s.eq_ignore_ascii_case("succeeded")
        || s.eq_ignore_ascii_case("done")
        || s.eq_ignore_ascii_case("ok")
    {
        "completed"
    } else if s.eq_ignore_ascii_case("failed")
        || s.eq_ignore_ascii_case("fail")
        || s.eq_ignore_ascii_case("error")
        || s.eq_ignore_ascii_case("errored")
        || s.eq_ignore_ascii_case("cancelled")
        || s.eq_ignore_ascii_case("canceled")
        || s.eq_ignore_ascii_case("interrupted")
        || s.eq_ignore_ascii_case("aborted")
        || s.eq_ignore_ascii_case("timed_out")
        || s.eq_ignore_ascii_case("timeout")
    {
        "failed"
    } else {
        return None;
    };
    Some(canonical.to_string())
}

/// Case-insensitive substring search for ASCII needles.
fn contains_ascii_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

/// Infer a status from free-text output (command output, error messages, etc.).
///
/// Returns `None` when no pattern matches.
pub fn infer_status_from_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Failure indicators
    if contains_ascii_ignore_case(trimmed, "command not found")
        || contains_ascii_ignore_case(
            trimmed,
            "is not recognized as an internal or external command",
        )
        || contains_ascii_ignore_case(trimmed, "no such file or directory")
        || contains_ascii_ignore_case(trimmed, "permission denied")
    {
        return Some("failed".to_string());
    }

    // In-progress indicators
    if contains_ascii_ignore_case(trimmed, "process running with session id") {
        return Some("in_progress".to_string());
    }

    // Success indicators — check specific exit code 0 before generic exit code
    if contains_ascii_ignore_case(trimmed, "process exited with code 0")
        || contains_ascii_ignore_case(trimmed, "exit code: 0")
        || contains_ascii_ignore_case(trimmed, "exit code 0")
    {
        return Some("completed".to_string());
    }

    // Generic failure exit codes
    if contains_ascii_ignore_case(trimmed, "process exited with code")
        || contains_ascii_ignore_case(trimmed, "exit code:")
        || contains_ascii_ignore_case(trimmed, "exit code ")
    {
        return Some("failed".to_string());
    }

    // Explicit failure keywords (include "canceled" for US spelling)
    if contains_ascii_ignore_case(trimmed, "interrupted")
        || contains_ascii_ignore_case(trimmed, "cancelled")
        || contains_ascii_ignore_case(trimmed, "canceled")
        || contains_ascii_ignore_case(trimmed, "aborted")
    {
        return Some("failed".to_string());
    }

    None
}

/// Infer status from a result value (exit-code objects, text output).
///
/// For objects: tries output/stdout/stderr text inference first, then `status` field,
/// then `exitCode`/`exit_code`. For strings/arrays, delegates to text or content-block logic.
pub fn infer_status_from_result(result: Option<&serde_json::Value>) -> Option<String> {
    let value = result?;

    if let Some(text) = value.as_str() {
        return infer_status_from_text(text);
    }

    if let Some(obj) = value.as_object() {
        let output_text = obj
            .get("output")
            .or_else(|| obj.get("stdout"))
            .or_else(|| obj.get("stderr"))
            .or_else(|| obj.get("aggregated_output"))
            .or_else(|| obj.get("formatted_output"))
            .and_then(|v| v.as_str());
        if let Some(inferred) = output_text.and_then(infer_status_from_text) {
            if inferred == "failed" {
                return Some("failed".to_string());
            }
        }

        if let Some(status_str) = obj.get("status").and_then(|v| v.as_str()) {
            if let Some(canonical) = normalize_status(status_str) {
                return Some(canonical);
            }
        }

        if let Some(code) = obj
            .get("exit_code")
            .or_else(|| obj.get("exitCode"))
            .and_then(|v| v.as_i64())
        {
            return if code == 0 {
                Some("completed".to_string())
            } else {
                Some("failed".to_string())
            };
        }

        if let Some(inferred) = output_text.and_then(infer_status_from_text) {
            return Some(inferred);
        }
    }

    if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(s) = infer_status_from_result(Some(item)) {
                return Some(s);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_canonical_statuses() {
        assert_eq!(normalize_status("pending"), Some("pending".to_string()));
        assert_eq!(normalize_status("completed"), Some("completed".to_string()));
        assert_eq!(
            normalize_status("in_progress"),
            Some("in_progress".to_string())
        );
        assert_eq!(normalize_status("failed"), Some("failed".to_string()));
    }

    #[test]
    fn normalizes_synonyms() {
        assert_eq!(normalize_status("running"), Some("in_progress".to_string()));
        assert_eq!(normalize_status("done"), Some("completed".to_string()));
        assert_eq!(normalize_status("cancelled"), Some("failed".to_string()));
        assert_eq!(normalize_status("timeout"), Some("failed".to_string()));
    }

    #[test]
    fn returns_none_for_unknown() {
        assert_eq!(normalize_status("banana"), None);
    }

    #[test]
    fn infers_failure_from_text() {
        assert_eq!(
            infer_status_from_text("command not found"),
            Some("failed".to_string())
        );
        assert_eq!(
            infer_status_from_text("process exited with code 1"),
            Some("failed".to_string())
        );
    }

    #[test]
    fn infers_completion_from_text() {
        assert_eq!(
            infer_status_from_text("process exited with code 0"),
            Some("completed".to_string())
        );
    }
}
