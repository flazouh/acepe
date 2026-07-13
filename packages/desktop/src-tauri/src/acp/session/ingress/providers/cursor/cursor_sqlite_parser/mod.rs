//! Parser for Cursor's store.db SQLite format.
//!
//! Extracts conversation messages from Cursor's ~/.cursor/chats/{hash}/{agent}/store.db files.
//! The store.db format contains:
//! - `meta` table: Hex-encoded JSON with session metadata
//! - `blobs` table: Mix of JSON messages and binary state data
//!
//! We extract only the JSON message blobs (user/assistant/tool) and ignore binary blobs.

use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashSet;
use std::path::Path;

use crate::history::tag_utils::{
    is_timestamp_line, remove_tag_block_ci, remove_tag_tokens_ci, unwrap_tag_ci,
};
use crate::session_jsonl::types::{ContentBlock, FullSession, OrderedMessage, SessionStats};

/// Metadata from store.db meta table. Shared by full-load (history) and scan (cursor_history).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorStoreMeta {
    #[allow(dead_code)]
    pub agent_id: String,
    pub name: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub mode: Option<String>,
    pub created_at: Option<i64>,
    #[serde(default)]
    #[allow(dead_code)]
    pub last_used_model: Option<String>,
}

/// Default agent name in Cursor store.db meta when no custom name is set.
pub const CURSOR_DEFAULT_AGENT_NAME: &str = "New Agent";

/// Resolve session title: derive from first meaningful user text, or fallback to meta name / "Untitled".
/// Single policy for both scan and full-load paths.
pub fn resolve_cursor_session_title(conn: &Connection, meta_name: &str) -> String {
    first_meaningful_user_text_for_title(conn).unwrap_or_else(|| {
        if meta_name == CURSOR_DEFAULT_AGENT_NAME {
            "Untitled".to_string()
        } else {
            crate::history::title_utils::normalize_display_title(meta_name)
        }
    })
}

/// Message blob from store.db (JSON format)
#[derive(Debug, Clone, Deserialize, Serialize)]
struct CursorStoreMessage {
    role: String,
    #[serde(default)]
    id: Option<String>,
    content: JsonValue,
    #[serde(default)]
    model: Option<String>,
}

/// Parse a full session from Cursor's store.db
pub async fn parse_cursor_store_db(
    db_path: &Path,
    session_id: &str,
    workspace_path: Option<&str>,
) -> Result<FullSession> {
    let db_path = db_path.to_owned();
    let session_id = session_id.to_string();
    let workspace_path = workspace_path.map(|s| s.to_string());

    tokio::task::spawn_blocking(move || {
        // Open SQLite database in read-only mode with a busy timeout.
        // Read-only prevents WAL lock contention when Cursor is running,
        // and busy_timeout prevents indefinite hangs on locked databases.
        let conn = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .context("Failed to open Cursor store.db")?;
        conn.busy_timeout(std::time::Duration::from_secs(2))
            .context("Failed to set busy timeout")?;

        // Extract metadata from meta table
        let meta = extract_meta(&conn)?;

        // Single pass over blobs: messages + title candidate (avoids second blob iteration)
        let (messages, title_candidate) = extract_messages_and_title_candidate(&conn)?;
        let stats = calculate_stats(&messages);
        let title = title_candidate.unwrap_or_else(|| {
            if meta.name == CURSOR_DEFAULT_AGENT_NAME {
                "Untitled".to_string()
            } else {
                crate::history::title_utils::normalize_display_title(&meta.name)
            }
        });

        // Convert created_at from milliseconds to ISO8601
        let created_at = if let Some(ms) = meta.created_at {
            chrono::DateTime::from_timestamp_millis(ms)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
        } else {
            chrono::Utc::now().to_rfc3339()
        };

        Ok(FullSession {
            session_id,
            project_path: workspace_path.unwrap_or_default(),
            title,
            created_at,
            messages,
            stats,
        })
    })
    .await
    .context("Blocking task panicked")?
}

/// Extract metadata from meta table
fn extract_meta(conn: &Connection) -> Result<CursorStoreMeta> {
    let mut stmt = conn
        .prepare("SELECT value FROM meta WHERE key = '0'")
        .context("Failed to prepare meta query")?;

    let hex_value: String = stmt
        .query_row([], |row| row.get(0))
        .context("Failed to read meta table")?;

    // Decode hex to string
    let json_bytes = hex::decode(&hex_value).context("Failed to decode hex meta value")?;
    let json_str = String::from_utf8(json_bytes).context("Failed to parse meta value as UTF-8")?;

    // Parse JSON
    let meta: CursorStoreMeta =
        serde_json::from_str(&json_str).context("Failed to parse meta JSON")?;

    Ok(meta)
}

/// Single pass over blobs: collect messages and first meaningful title candidate.
fn extract_messages_and_title_candidate(
    conn: &Connection,
) -> Result<(Vec<OrderedMessage>, Option<String>)> {
    let mut stmt = conn
        .prepare("SELECT data FROM blobs ORDER BY rowid")
        .context("Failed to prepare blobs query")?;

    let rows = stmt
        .query_map([], |row| {
            let data: Vec<u8> = row.get(0)?;
            Ok(data)
        })
        .context("Failed to query blobs")?;

    let mut blob_data = Vec::new();
    let mut title_candidate = None;

    for row in rows {
        let data = row.context("Failed to read blob row")?;
        if title_candidate.is_none() {
            title_candidate = first_meaningful_title_from_blob(&data);
        }
        blob_data.push(data);
    }

    let messages = extract_messages_from_blob_data(blob_data)?;
    Ok((messages, title_candidate))
}

mod blob;
use blob::*;
mod content;
use content::*;
/// First user text that derives to a meaningful session title (shared by scan and full-load).
///
/// Iterates blobs in order; per blob prefers `<user_query>` content, then JSON role=user content.
/// Returns the first candidate for which `derive_session_title(candidate, 100)` is `Some`,
/// so context-only blobs (e.g. `<user_info>`) are skipped.
pub fn first_meaningful_user_text_for_title(conn: &Connection) -> Option<String> {
    let mut stmt = conn.prepare("SELECT data FROM blobs ORDER BY rowid").ok()?;
    let rows = stmt
        .query_map([], |row| {
            let data: Vec<u8> = row.get(0)?;
            Ok(data)
        })
        .ok()?;

    for row in rows {
        let Ok(data) = row else { continue };
        let text = String::from_utf8_lossy(&data);

        // Prefer <user_query> within this blob
        let candidate = extract_tag_content(&text, "user_query")
            .and_then(|q| {
                let t = q.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(t.to_string())
                }
            })
            .or_else(|| {
                // Else JSON role=user content (string or first block text)
                let msg = serde_json::from_str::<serde_json::Value>(&text).ok()?;
                if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
                    return None;
                }
                if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                    let trimmed = content.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
                if let Some(blocks) = msg.get("content").and_then(|c| c.as_array()) {
                    for block in blocks {
                        if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                            let trimmed = t.trim();
                            if !trimmed.is_empty() {
                                return Some(trimmed.to_string());
                            }
                        }
                    }
                }
                None
            });

        if let Some(ref c) = candidate {
            if let Some(derived) = crate::history::title_utils::derive_session_title(c, 100) {
                return Some(derived);
            }
        }
    }
    None
}

/// If this blob yields a candidate that derives to a title, return that derived title (single-blob helper for single-pass).
fn first_meaningful_title_from_blob(data: &[u8]) -> Option<String> {
    let (user_query, json_user) = blob_title_candidates(data);
    for candidate in [user_query.as_ref(), json_user.as_ref()]
        .into_iter()
        .flatten()
    {
        if let Some(derived) = crate::history::title_utils::derive_session_title(candidate, 100) {
            return Some(derived);
        }
    }
    None
}

/// Per-blob title candidates for diagnostics. Returns (user_query_content, json_user_content).
pub fn blob_title_candidates(data: &[u8]) -> (Option<String>, Option<String>) {
    let text = String::from_utf8_lossy(data);
    let user_query = extract_tag_content(&text, "user_query")
        .map(|q| q.trim().to_string())
        .filter(|q| !q.is_empty());
    let json_user = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|msg| {
            if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
                return None;
            }
            if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
            msg.get("content")
                .and_then(|c| c.as_array())
                .and_then(|blocks| {
                    blocks.iter().find_map(|block| {
                        block
                            .get("text")
                            .and_then(|t| t.as_str())
                            .map(|t| t.trim().to_string())
                    })
                })
                .filter(|t| !t.is_empty())
        });
    (user_query, json_user)
}

/// Extract content between `<tag>` and `</tag>` (case-insensitive).
fn extract_tag_content(text: &str, tag: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let open = format!("<{}", tag);
    let close = format!("</{}", tag);

    let start = lower.find(&open)?;
    let open_end = lower[start..].find('>')? + start + 1;
    let close_start = lower[open_end..].find(&close)? + open_end;

    Some(text[open_end..close_start].to_string())
}

/// Truncate title to max length (used by tests).
#[allow(dead_code)]
fn truncate_title(text: &str, max_len: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_len {
        text.to_string()
    } else {
        // Ensure final length is <= max_len by taking max_len - 3 chars before appending "..."
        let truncate_len = max_len.saturating_sub(3);
        let truncated: String = text.chars().take(truncate_len).collect();
        format!("{}...", truncated)
    }
}

/// Calculate session statistics from messages
fn calculate_stats(messages: &[OrderedMessage]) -> SessionStats {
    let mut stats = SessionStats {
        total_messages: messages.len(),
        user_messages: 0,
        assistant_messages: 0,
        tool_uses: 0,
        tool_results: 0,
        thinking_blocks: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
    };

    for msg in messages {
        match msg.role.as_str() {
            "user" => stats.user_messages += 1,
            "assistant" => stats.assistant_messages += 1,
            _ => {}
        }

        for block in &msg.content_blocks {
            match block {
                ContentBlock::ToolUse { .. } => stats.tool_uses += 1,
                ContentBlock::ToolResult { .. } => stats.tool_results += 1,
                ContentBlock::Thinking { .. } => stats.thinking_blocks += 1,
                _ => {}
            }
        }
    }

    stats
}

#[cfg(test)]
mod tests;
