use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde_json::Value;
use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::OnceLock;
use uuid::Uuid;

/// Root directory for session jsonl files (e.g. Claude app storage or CLAUDE_HOME).
pub(super) fn get_session_jsonl_root() -> Result<PathBuf> {
    if let Ok(root) = std::env::var("CLAUDE_HOME") {
        return Ok(PathBuf::from(root));
    }
    dirs::home_dir()
        .map(|h| h.join(".claude"))
        .ok_or_else(|| anyhow!("Cannot determine home directory"))
}

pub(super) fn path_to_slug(path: &str) -> String {
    // Convert path to slug format used by Claude Code.
    // Claude Code replaces both '/' and '.' with '-'.
    // /Users/alex/.acepe/worktrees/foo -> -Users-alex--acepe-worktrees-foo
    path.replace(['/', '.'], "-")
}

/// Validates if a string is a valid UUID format.
/// Accepts both standard UUID format (8-4-4-4-12) and checks if it can be parsed as a UUID.
pub(super) fn is_valid_uuid(s: &str) -> bool {
    Uuid::parse_str(s).is_ok()
}

/// Parses an ISO 8601 timestamp string to milliseconds since Unix epoch.
/// Handles formats like "2025-12-16T19:53:41.812Z"
pub(super) fn parse_iso_timestamp_to_ms(timestamp_str: &str) -> Result<i64> {
    // Try parsing with chrono first (handles various ISO formats)
    match DateTime::parse_from_rfc3339(timestamp_str) {
        Ok(dt) => Ok(dt.timestamp_millis()),
        Err(_) => {
            // Fallback: try parsing as UTC directly
            match timestamp_str.parse::<DateTime<Utc>>() {
                Ok(dt) => Ok(dt.timestamp_millis()),
                Err(e) => Err(anyhow!(
                    "Failed to parse timestamp '{}': {}",
                    timestamp_str,
                    e
                )),
            }
        }
    }
}

/// Check if a message is a meta message.
fn is_meta_message(json: &Value) -> bool {
    json.get("isMeta")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Check if content is a command message.
/// Detects slash commands, XML command tags, and command output.
fn is_command_message(content: &str) -> bool {
    let trimmed = content.trim();
    trimmed.starts_with('/')
        || trimmed.contains("<command-name>")
        || trimmed.contains("<command-message>")
        || trimmed.contains("<local-command-stdout>")
}

/// Extract text from content value (handles both string and array formats).
/// Returns the first meaningful text found, or a placeholder for image-only content.
/// Returns None if no text or images are found.
fn extract_text_from_content(content: &Value) -> Option<String> {
    // Handle string content
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    // Handle array of content blocks
    if let Some(content_array) = content.as_array() {
        let mut text_parts: Vec<String> = Vec::new();
        let mut has_image = false;

        for block in content_array {
            // Check for text blocks
            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                if !text.trim().is_empty() {
                    text_parts.push(text.to_string());
                }
            }
            // Check for image blocks
            if block.get("type").and_then(|v| v.as_str()) == Some("image") {
                has_image = true;
            }
        }

        // If we found text, return it
        if !text_parts.is_empty() {
            return Some(text_parts.join(" "));
        }

        // If only images, return placeholder
        if has_image {
            return Some("[Image]".to_string());
        }
    }

    None
}

/// Extracts display name from file content by finding the first meaningful user message.
/// Returns None if no meaningful content is found (the conversation should be skipped).
pub(super) fn extract_display_name_from_content(content: &str) -> Option<String> {
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let json: Value = match serde_json::from_str(line) {
            Ok(json) => json,
            Err(_) => continue,
        };

        if json.get("type").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }

        if let Some(name) = extract_display_name_from_user_message(&json) {
            return Some(name);
        }
    }

    None
}

/// Find the largest valid UTF-8 character boundary at or before `idx`.
fn floor_char_boundary(s: &str, idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    let mut boundary = idx;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

/// Strip XML-style system tags from text content.
/// Removes all XML tag pairs (e.g. <ide_*>, <pasted-content>, <system-reminder>,
/// <user_info>, <git_status>, etc.) and their content.
fn strip_artifact_tags(text: &str) -> Cow<'_, str> {
    static OPEN_TAG: OnceLock<Regex> = OnceLock::new();
    let open_tag = OPEN_TAG.get_or_init(|| Regex::new(r"<([a-zA-Z][a-zA-Z0-9_-]*)[^>]*>").unwrap());

    let tag_names: Vec<String> = open_tag
        .captures_iter(text)
        .map(|cap| cap[1].to_string())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    if tag_names.is_empty() {
        return Cow::Borrowed(text);
    }

    let mut result = text.to_string();
    for tag in &tag_names {
        let pattern_str = format!(
            r"(?s)<{tag}[^>]*>.*?</{tag}[^>]*>|<{tag}[^>]*>.*$",
            tag = regex::escape(tag)
        );
        if let Ok(pattern) = Regex::new(&pattern_str) {
            result = pattern.replace_all(&result, "").into_owned();
        }
    }

    if result == text {
        Cow::Borrowed(text)
    } else {
        Cow::Owned(result)
    }
}

/// Extract display name from a user message JSON value.
/// Returns None if the message is meta, a command, or has no meaningful text.
pub(super) fn extract_display_name_from_user_message(json: &Value) -> Option<String> {
    if is_meta_message(json) {
        return None;
    }

    let message_content = json.get("message").and_then(|m| m.get("content"))?;
    let text = extract_text_from_content(message_content)?;

    // Strip system artifact tags before processing
    let cleaned = strip_artifact_tags(&text);
    let trimmed = cleaned.trim();

    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("warmup") || is_command_message(trimmed) {
        return None;
    }

    if trimmed.len() > 100 {
        let truncate_at = floor_char_boundary(trimmed, 100);
        Some(format!("{}...", &trimmed[..truncate_at]))
    } else {
        Some(trimmed.to_string())
    }
}
