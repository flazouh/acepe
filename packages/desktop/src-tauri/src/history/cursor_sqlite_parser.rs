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

fn extract_messages_from_blob_data(blobs: Vec<Vec<u8>>) -> Result<Vec<OrderedMessage>> {
    let mut messages = Vec::new();
    let mut seen_signatures = HashSet::new();

    for data in blobs {
        for message in parse_blob_messages(&data, messages.len())? {
            let signature = message_signature(&message);
            if seen_signatures.insert(signature) {
                messages.push(message);
            }
        }
    }

    Ok(strip_duplicate_status_text_from_reasoning_messages(
        messages,
    ))
}

fn parse_blob_messages(data: &[u8], index: usize) -> Result<Vec<OrderedMessage>> {
    if let Some(json_str) = extract_json_object_from_blob(data) {
        if let Ok(msg) = serde_json::from_str::<CursorStoreMessage>(&json_str) {
            if !matches!(msg.role.as_str(), "user" | "assistant" | "tool") {
                return Ok(Vec::new());
            }
            return convert_cursor_store_message(msg, index).map(|message| vec![message]);
        }
    }

    if let Some(text) = extract_plain_text_message_from_blob(data) {
        return Ok(vec![build_text_message("assistant", text, None, index)]);
    }

    Ok(Vec::new())
}

fn extract_json_object_from_blob(data: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(data);
    let start = text.find('{')?;
    let end = text.rfind('}')?;

    if end < start {
        return None;
    }

    Some(text[start..=end].to_string())
}

fn extract_plain_text_message_from_blob(data: &[u8]) -> Option<String> {
    let raw = String::from_utf8_lossy(data);
    let sanitized = extract_human_readable_text(raw.as_ref());
    if !sanitized.is_empty() && looks_like_plain_text_message(&sanitized) {
        return Some(sanitized);
    }

    None
}

fn extract_human_readable_text(text: &str) -> String {
    let lines = text
        .lines()
        .map(str::trim)
        .filter(|line| is_human_readable_line(line))
        .collect::<Vec<_>>();

    if lines.is_empty() {
        String::new()
    } else {
        sanitize_cursor_sqlite_text(&lines.join("\n"))
    }
}

fn is_human_readable_line(line: &str) -> bool {
    if line.len() <= 2 || line.contains('\u{fffd}') {
        return false;
    }

    let printable_chars = line
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || character.is_ascii_punctuation()
                || character.is_ascii_whitespace()
                || matches!(character, '•' | '—' | '–' | '…')
        })
        .count();
    let total_chars = line.chars().count();
    let alpha_chars = line
        .chars()
        .filter(|character| character.is_alphabetic())
        .count();
    let printable_ratio = printable_chars as f32 / total_chars as f32;

    printable_ratio > 0.85 && alpha_chars >= 3
}

fn looks_like_plain_text_message(text: &str) -> bool {
    if text.is_empty() || text.starts_with('{') {
        return false;
    }

    let has_sentence_chars = text.contains(' ') || text.contains('\n');
    let contains_path = text.contains('/') || text.contains('\\');
    let contains_code_markers = ["package ", "import ", "func ", "type ", "const ("]
        .iter()
        .any(|marker| text.contains(marker));

    has_sentence_chars && !contains_path && !contains_code_markers
}

fn build_text_message(
    role: &str,
    text: String,
    model: Option<String>,
    index: usize,
) -> OrderedMessage {
    OrderedMessage {
        uuid: format!("cursor-msg-{}", uuid::Uuid::new_v4()),
        parent_uuid: None,
        role: role.to_string(),
        timestamp: fallback_timestamp(index),
        content_blocks: vec![ContentBlock::Text { text }],
        model,
        usage: None,
        request_id: None,
        is_meta: false,
        source_tool_use_id: None,
        tool_use_result: None,
        source_tool_assistant_uuid: None,
    }
}

fn strip_duplicate_status_text_from_reasoning_messages(
    messages: Vec<OrderedMessage>,
) -> Vec<OrderedMessage> {
    let standalone_assistant_texts = messages
        .iter()
        .filter(|message| message.role == "assistant")
        .filter_map(|message| match message.content_blocks.as_slice() {
            [ContentBlock::Text { text }] => Some(text.clone()),
            _ => None,
        })
        .collect::<HashSet<_>>();

    messages
        .into_iter()
        .map(|mut message| {
            let has_thinking = message
                .content_blocks
                .iter()
                .any(|block| matches!(block, ContentBlock::Thinking { .. }));

            if has_thinking {
                message.content_blocks.retain(|block| {
                    !matches!(
                        block,
                        ContentBlock::Text { text } if standalone_assistant_texts.contains(text)
                    )
                });
            }

            message
        })
        .collect()
}

fn message_signature(message: &OrderedMessage) -> String {
    if let Some(narrative_signature) = narrative_message_signature(message) {
        return format!("{}|narrative:{}", message.role, narrative_signature);
    }

    let blocks = message
        .content_blocks
        .iter()
        .map(content_block_signature)
        .collect::<Vec<_>>()
        .join("|");
    format!("{}|{}", message.role, blocks)
}

fn narrative_message_signature(message: &OrderedMessage) -> Option<String> {
    let mut fragments = Vec::new();

    for block in &message.content_blocks {
        match block {
            ContentBlock::Text { text } => fragments.push(text.trim().to_string()),
            ContentBlock::Thinking { thinking, .. } => fragments.push(thinking.trim().to_string()),
            _ => return None,
        }
    }

    let signature = fragments
        .into_iter()
        .filter(|fragment| !fragment.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if signature.is_empty() {
        None
    } else {
        Some(signature)
    }
}

fn content_block_signature(block: &ContentBlock) -> String {
    match block {
        ContentBlock::Text { text } => format!("text:{text}"),
        ContentBlock::Thinking { thinking, .. } => format!("thinking:{thinking}"),
        ContentBlock::ToolUse { id, name, input } => {
            format!("tool_use:{id}:{name}:{}", input)
        }
        ContentBlock::ToolResult {
            tool_use_id,
            content,
        } => format!("tool_result:{tool_use_id}:{content}"),
        ContentBlock::CodeAttachment {
            path,
            lines,
            content,
        } => format!(
            "code_attachment:{path}:{}:{content}",
            lines.clone().unwrap_or_default()
        ),
    }
}

/// Convert Cursor message to OrderedMessage
fn convert_cursor_store_message(msg: CursorStoreMessage, index: usize) -> Result<OrderedMessage> {
    if msg.role == "tool" {
        return convert_cursor_tool_message(msg, index);
    }

    // Generate UUID for message if not present or if the raw ID is not unique
    // (Cursor stores id="1" for all thought-only assistant messages, causing
    // duplicate keys that break Virtua's keyed rendering in the frontend).
    let uuid = match msg.id.as_deref() {
        Some(id) if id.len() > 8 => id.to_string(),
        _ => format!("cursor-msg-{}", uuid::Uuid::new_v4()),
    };

    // Parse content blocks
    let content_blocks = parse_cursor_content(&msg.content)?;
    let timestamp =
        extract_timestamp_from_content(&msg.content).unwrap_or_else(|| fallback_timestamp(index));

    Ok(OrderedMessage {
        uuid,
        parent_uuid: None, // Cursor doesn't use parent_uuid threading
        role: msg.role,
        timestamp,
        content_blocks,
        model: msg.model,
        usage: None, // Cursor doesn't store token usage in blobs
        request_id: None,
        is_meta: false,
        source_tool_use_id: None, // Cursor doesn't support skill meta messages
        tool_use_result: None,    // Cursor doesn't have tool_use_result
        source_tool_assistant_uuid: None, // Cursor doesn't have source_tool_assistant_uuid
    })
}

fn convert_cursor_tool_message(msg: CursorStoreMessage, index: usize) -> Result<OrderedMessage> {
    let uuid = msg
        .id
        .clone()
        .unwrap_or_else(|| format!("cursor-tool-{}", uuid::Uuid::new_v4()));

    let mut content_blocks = Vec::new();

    if let Some(content_array) = msg.content.as_array() {
        for item in content_array {
            let block_type = item
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if !matches!(block_type, "tool_result" | "tool-result") {
                continue;
            }

            let tool_use_id = item
                .get("tool_use_id")
                .or_else(|| item.get("toolCallId"))
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();

            // Don't emit synthetic ToolUse here — the real ToolUse blocks come from
            // the assistant message's "tool-call" content blocks. Only emit ToolResult.
            let result = item
                .get("content")
                .or_else(|| item.get("result"))
                .and_then(|value| {
                    if let Some(text) = value.as_str() {
                        return Some(text.to_string());
                    }

                    value.as_array().map(|items| {
                        items
                            .iter()
                            .filter_map(|entry| entry.get("text").and_then(|text| text.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                })
                .unwrap_or_default();

            if !tool_use_id.is_empty() {
                content_blocks.push(ContentBlock::ToolResult {
                    tool_use_id,
                    content: result,
                });
            }
        }
    }

    Ok(OrderedMessage {
        uuid,
        parent_uuid: None,
        // Tool result messages must have role "user" so that the converter
        // collects their ToolResult blocks into the tool_results map.
        role: "user".to_string(),
        timestamp: extract_timestamp_from_content(&msg.content)
            .unwrap_or_else(|| fallback_timestamp(index)),
        content_blocks,
        model: msg.model,
        usage: None,
        request_id: None,
        is_meta: false,
        source_tool_use_id: None,
        tool_use_result: None,
        source_tool_assistant_uuid: None,
    })
}

fn fallback_timestamp(index: usize) -> String {
    let base = chrono::DateTime::parse_from_rfc3339("2025-01-01T00:00:00Z")
        .expect("hard-coded fallback timestamp should parse")
        .timestamp();
    let ts = base + (index as i64);
    chrono::DateTime::from_timestamp(ts, 0)
        .expect("fallback timestamp should be representable")
        .to_rfc3339()
}

/// Parse Cursor content format to ContentBlocks
fn parse_cursor_content(content: &JsonValue) -> Result<Vec<ContentBlock>> {
    let mut blocks = Vec::new();

    // Cursor content is either a string or an array
    if let Some(text) = content.as_str() {
        if let Some(thinking) = extract_thinking_content(text) {
            if !thinking.is_empty() {
                blocks.push(ContentBlock::Thinking {
                    thinking,
                    signature: None,
                });
            }
        }

        let visible_text = sanitize_cursor_sqlite_text(&remove_tag_block_ci(text, "think"));
        if !visible_text.is_empty() {
            blocks.push(ContentBlock::Text { text: visible_text });
        }
        return Ok(blocks);
    }

    // Array of content blocks
    if let Some(content_array) = content.as_array() {
        for item in content_array {
            if let Some(block_type) = item.get("type").and_then(|v| v.as_str()) {
                match block_type {
                    "text" => {
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            if let Some(thinking) = extract_thinking_content(text) {
                                if !thinking.is_empty() {
                                    blocks.push(ContentBlock::Thinking {
                                        thinking,
                                        signature: None,
                                    });
                                }
                            }

                            let visible_text =
                                sanitize_cursor_sqlite_text(&remove_tag_block_ci(text, "think"));
                            if !visible_text.is_empty() {
                                blocks.push(ContentBlock::Text { text: visible_text });
                            }
                        }
                    }
                    "reasoning" => {
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            let sanitized = sanitize_cursor_sqlite_text(text);
                            if sanitized.is_empty() {
                                continue;
                            }
                            blocks.push(ContentBlock::Thinking {
                                thinking: sanitized,
                                signature: None,
                            });
                        }
                    }
                    "thinking" => {
                        // Cursor uses <think> tags in text content
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            if text.contains("<think>") {
                                // Extract thinking content
                                if let Some(thinking) = extract_thinking_content(text) {
                                    blocks.push(ContentBlock::Thinking {
                                        thinking,
                                        signature: None,
                                    });
                                }
                            } else {
                                let sanitized = sanitize_cursor_sqlite_text(text);
                                if sanitized.is_empty() {
                                    continue;
                                }
                                blocks.push(ContentBlock::Text { text: sanitized });
                            }
                        }
                    }
                    "tool_use" | "tool-use" | "tool-call" => {
                        // Tool use block (Cursor uses "tool-call" type with "args" field)
                        let id = item
                            .get("id")
                            .or_else(|| item.get("toolCallId"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let name = item
                            .get("name")
                            .or_else(|| item.get("toolName"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let input = item
                            .get("input")
                            .or_else(|| item.get("arguments"))
                            .or_else(|| item.get("args"))
                            .cloned()
                            .unwrap_or(serde_json::json!({}));

                        if !id.is_empty() && !name.is_empty() {
                            blocks.push(ContentBlock::ToolUse { id, name, input });
                        }
                    }
                    "tool_result" | "tool-result" => {
                        // Tool result block
                        let tool_use_id = item
                            .get("tool_use_id")
                            .or_else(|| item.get("toolCallId"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        let content = item
                            .get("content")
                            .or_else(|| item.get("result"))
                            .and_then(|v| {
                                // Content can be string or array
                                if let Some(s) = v.as_str() {
                                    Some(s.to_string())
                                } else if let Some(arr) = v.as_array() {
                                    // Extract text from array
                                    let texts: Vec<String> = arr
                                        .iter()
                                        .filter_map(|item| {
                                            item.get("text")
                                                .and_then(|t| t.as_str())
                                                .map(|s| s.to_string())
                                        })
                                        .collect();
                                    Some(texts.join("\n"))
                                } else {
                                    None
                                }
                            })
                            .unwrap_or_default();

                        if !tool_use_id.is_empty() {
                            blocks.push(ContentBlock::ToolResult {
                                tool_use_id,
                                content,
                            });
                        }
                    }
                    _ => {
                        // Unknown block type - try to extract text
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            let sanitized = sanitize_cursor_sqlite_text(text);
                            if sanitized.is_empty() {
                                continue;
                            }
                            blocks.push(ContentBlock::Text { text: sanitized });
                        }
                    }
                }
            }
        }
    }

    Ok(blocks)
}

/// Extract thinking content from <think> tags (case-insensitive)
fn extract_thinking_content(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    if let Some(start_idx) = lower.find("<think>") {
        if let Some(end_idx) = lower.find("</think>") {
            let thinking = &text[start_idx + 7..end_idx];
            return Some(thinking.trim().to_string());
        }
    }
    None
}

fn sanitize_cursor_sqlite_text(text: &str) -> String {
    let mut result = text.replace("\r\n", "\n").replace('\r', "\n");
    if let Some(extracted) = extract_assistant_text_from_json_envelopes(&result) {
        result = extracted;
    }

    // Unwrap user_query tags: keep inner text, strip the tags themselves.
    // Must happen before blocked-tag removal so the content survives.
    result = unwrap_tag_ci(&result, "user_query");

    let blocked_tags = [
        "think",
        "system_reminder",
        "user_info",
        "git_status",
        "agent_transcripts",
        "agent_skills",
        "rules",
        "always_applied_workspace_rules",
        "always_applied_workspace_rule",
        "environment_context",
        "instructions",
    ];

    for tag in blocked_tags {
        result = remove_tag_block_ci(&result, tag);
        result = remove_tag_tokens_ci(&result, tag);
    }

    let lines = result
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !is_timestamp_line(line))
        .collect::<Vec<_>>();

    lines.join("\n").trim().to_string()
}

fn extract_assistant_text_from_json_envelopes(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(value) = serde_json::from_str::<JsonValue>(trimmed) {
        if let Some(assistant) = assistant_text_from_event(&value) {
            return Some(assistant);
        }
        if let Some(result) = value.get("result").and_then(|v| v.as_str()) {
            return Some(result.to_string());
        }
    }

    let mut assistant_text = String::new();
    let mut result_text = String::new();
    let mut parsed_any = false;

    for line in trimmed
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(value) = serde_json::from_str::<JsonValue>(line) else {
            continue;
        };

        parsed_any = true;
        if let Some(assistant) = assistant_text_from_event(&value) {
            assistant_text.push_str(&assistant);
            continue;
        }

        let event_type = value
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if event_type == "result" {
            if let Some(result) = value.get("result").and_then(|v| v.as_str()) {
                result_text.push_str(result);
            }
        }
    }

    if !assistant_text.is_empty() {
        return Some(assistant_text);
    }
    if !result_text.is_empty() {
        return Some(result_text);
    }
    if parsed_any {
        return Some(String::new());
    }

    None
}

fn assistant_text_from_event(value: &JsonValue) -> Option<String> {
    let event_type = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if event_type != "assistant" {
        return None;
    }

    let message = value.get("message")?;
    let content = message.get("content")?;

    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    let parts = content.as_array()?;

    let combined = parts
        .iter()
        .filter_map(|part| {
            let part_type = part.get("type").and_then(|v| v.as_str())?;
            if part_type != "text" {
                return None;
            }
            part.get("text").and_then(|v| v.as_str())
        })
        .collect::<String>();

    if combined.is_empty() {
        None
    } else {
        Some(combined)
    }
}

/// Extract timestamp from message content (if available)
fn extract_timestamp_from_content(content: &JsonValue) -> Option<String> {
    // Check for timestamp field
    if let Some(ts) = content.get("timestamp").and_then(|v| v.as_str()) {
        return Some(ts.to_string());
    }

    // Check in content array
    if let Some(arr) = content.as_array() {
        for item in arr {
            if let Some(ts) = item.get("timestamp").and_then(|v| v.as_str()) {
                return Some(ts.to_string());
            }
        }
    }

    None
}

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
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_thinking_content() {
        let text = "<think>\nThis is thinking content\n
</think>

\nThis is regular text";
        let thinking = extract_thinking_content(text);
        assert_eq!(thinking, Some("This is thinking content".to_string()));
    }

    #[test]
    fn test_extract_thinking_content_nested() {
        let text = "<think> Outer <thinking>inner</thinking> end</think> text";
        let thinking = extract_thinking_content(text);
        // Should extract content between <think> and </think>, then trim
        assert_eq!(
            thinking,
            Some("Outer <thinking>inner</thinking> end".to_string())
        );
    }

    #[test]
    fn test_extract_thinking_content_capitalized() {
        let text = "<THINKING>Thinking content</THINKING> text";
        let thinking = extract_thinking_content(text);
        // Case-sensitive match, so should return None for capitalized tags
        assert_eq!(thinking, None);
    }

    #[test]
    fn test_sanitize_cursor_sqlite_text_strips_transcript_wrappers() {
        let input = r#"
<think>internal</think> Hi again. How can I help you today?
<user_query>can you run ls?</user_query>
02:00:11
"#;

        let sanitized = sanitize_cursor_sqlite_text(input);
        // user_query inner text is preserved (unwrapped), think block and timestamps are stripped
        assert_eq!(
            sanitized,
            "Hi again. How can I help you today?\ncan you run ls?"
        );
        assert!(!sanitized.contains("<think>"));
        assert!(!sanitized.contains("<user_query>"));
    }

    #[test]
    fn test_parse_cursor_content_string_sanitizes_wrappers() {
        let content = JsonValue::String(
            "<think>internal</think> Hi again.\n<user_query>retry</user_query>\n02:00:11"
                .to_string(),
        );

        let blocks = parse_cursor_content(&content).expect("content should parse");
        assert_eq!(blocks.len(), 2);
        match &blocks[0] {
            ContentBlock::Thinking { thinking, .. } => assert_eq!(thinking, "internal"),
            _ => panic!("Expected thinking block"),
        }
        match &blocks[1] {
            // user_query inner text is preserved (unwrapped)
            ContentBlock::Text { text } => assert_eq!(text, "Hi again.\nretry"),
            _ => panic!("Expected text block"),
        }
    }

    #[test]
    fn test_sanitize_cursor_sqlite_text_extracts_assistant_from_ndjson_envelopes() {
        let input = r#"{"type":"system","subtype":"init"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"run ls"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"`ls` ran successfully."}]}}
{"type":"result","subtype":"success","result":"`ls` ran successfully."}"#;

        let sanitized = sanitize_cursor_sqlite_text(input);
        assert_eq!(sanitized, "`ls` ran successfully.");
    }

    #[test]
    fn test_truncate_title() {
        let long_text = "This is a very long title that should be truncated";
        let truncated = truncate_title(long_text, 20);
        assert_eq!(truncated.len(), 20);
        assert_eq!(truncated, "This is a very lo...".to_string());

        let short_text = "Short";
        let not_truncated = truncate_title(short_text, 20);
        assert_eq!(not_truncated, "Short".to_string());

        // Test very small max_len
        let tiny = truncate_title("Hello", 3);
        assert_eq!(tiny, "...".to_string());
    }

    #[test]
    fn test_extract_messages_from_blob_data_recovers_cursor_blob_sequence() {
        let blobs = vec![
            b"\nO\nM\nExploring the codebase to understand the project and identify improvements.\n"
                .to_vec(),
            br#"prefix{"role":"assistant","content":[{"type":"text","text":"I found the project structure."}]}"#
                .to_vec(),
            serde_json::to_vec(&json!({
                "role": "tool",
                "content": [{
                    "type": "tool-result",
                    "toolCallId": "tool_123",
                    "toolName": "Read",
                    "result": "package main"
                }]
            }))
            .expect("tool blob should serialize"),
        ];

        let messages = extract_messages_from_blob_data(blobs).expect("messages should parse");

        assert_eq!(messages.len(), 3);

        match &messages[0].content_blocks[..] {
            [ContentBlock::Text { text }] => assert_eq!(
                text,
                "Exploring the codebase to understand the project and identify improvements."
            ),
            other => panic!("expected status text block, got {other:?}"),
        }

        match &messages[1].content_blocks[..] {
            [ContentBlock::Text { text }] => {
                assert_eq!(text, "I found the project structure.")
            }
            other => panic!("expected assistant text block, got {other:?}"),
        }

        assert_eq!(messages[2].role, "user");
        match &messages[2].content_blocks[..] {
            // Tool messages only emit ToolResult — the ToolUse comes from
            // the assistant message's "tool-call" content blocks.
            [ContentBlock::ToolResult {
                tool_use_id,
                content,
            }] => {
                assert_eq!(tool_use_id, "tool_123");
                assert_eq!(content, "package main");
            }
            other => panic!("expected tool result block, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_real_cursor_plan_session() {
        // Load fixture
        let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/cursor_sessions/f441a0b8-plan-session.db");
        assert!(
            fixture_path.exists(),
            "Fixture not found: {}",
            fixture_path.display()
        );

        let session = parse_cursor_store_db(
            &fixture_path,
            "f441a0b8-ed9d-4dd2-8318-70cee2f29fa2",
            Some("/Users/example/Downloads/sample-go-project"),
        )
        .await
        .expect("Should parse store.db successfully");

        // Title should NOT be "New Agent" (meta.name) - should derive from first user message
        assert_ne!(
            session.title, "New Agent",
            "Title should be derived from user message, not meta name"
        );
        assert_ne!(session.title, "Untitled");

        // Should have user messages
        assert!(
            session.stats.user_messages >= 1,
            "Expected at least 1 user message, got {}",
            session.stats.user_messages
        );

        // Should have assistant messages
        assert!(
            session.stats.assistant_messages >= 2,
            "Expected at least 2 assistant messages, got {}",
            session.stats.assistant_messages
        );

        // Should have thinking/reasoning blocks
        assert!(
            session.stats.thinking_blocks >= 1,
            "Expected thinking blocks, got {}",
            session.stats.thinking_blocks
        );

        // Should have tool uses and results (the session used Glob and Read)
        assert!(
            session.stats.tool_uses >= 2,
            "Expected at least 2 tool uses, got {}",
            session.stats.tool_uses
        );
        assert!(
            session.stats.tool_results >= 2,
            "Expected at least 2 tool results, got {}",
            session.stats.tool_results
        );

        // No system messages should appear
        let system_messages = session
            .messages
            .iter()
            .filter(|m| m.role == "system")
            .count();
        assert_eq!(system_messages, 0, "System messages should be filtered out");

        // Deduplication: should NOT have adjacent assistant messages with identical text
        // Rows 9/10 and 27/28 are duplicates (one with reasoning blocks, one with <think> tags)
        for window in session.messages.windows(2) {
            if window[0].role == "assistant" && window[1].role == "assistant" {
                let text0 = extract_all_text(&window[0].content_blocks);
                let text1 = extract_all_text(&window[1].content_blocks);
                if !text0.is_empty() && !text1.is_empty() {
                    assert_ne!(text0, text1, "Found duplicate adjacent assistant messages");
                }
            }
        }

        // Total messages should be reasonable - not bloated with spurious plain-text messages
        // Expected: ~15-25 messages (user msgs + assistant msgs + tool results)
        assert!(
            session.stats.total_messages <= 30,
            "Too many messages ({}), likely spurious plain-text extraction",
            session.stats.total_messages
        );
        assert!(
            session.stats.total_messages >= 5,
            "Too few messages ({}), likely missing real content",
            session.stats.total_messages
        );

        // created_at should be from meta timestamp (1773096292029 ms = 2026-03-07T...)
        assert!(
            session.created_at.starts_with("2026-"),
            "created_at should be from 2026, got {}",
            session.created_at
        );

        // Title should not contain newlines
        assert!(
            !session.title.contains('\n'),
            "Title should not contain newlines: {:?}",
            session.title
        );

        // Print session summary for debugging
        println!("Session title: {:?}", session.title);
        println!("Total messages: {}", session.stats.total_messages);
        println!(
            "User: {}, Assistant: {}",
            session.stats.user_messages, session.stats.assistant_messages
        );
        println!(
            "Tool uses: {}, Tool results: {}",
            session.stats.tool_uses, session.stats.tool_results
        );
        println!("Thinking blocks: {}", session.stats.thinking_blocks);
        for (i, msg) in session.messages.iter().enumerate() {
            let block_types: Vec<&str> = msg
                .content_blocks
                .iter()
                .map(|b| match b {
                    ContentBlock::Text { .. } => "text",
                    ContentBlock::Thinking { .. } => "thinking",
                    ContentBlock::ToolUse { .. } => "tool_use",
                    ContentBlock::ToolResult { .. } => "tool_result",
                    ContentBlock::CodeAttachment { .. } => "code_attachment",
                })
                .collect();
            println!("  [{}] role={} blocks={:?}", i, msg.role, block_types);
        }
    }

    #[tokio::test]
    async fn cursor_store_fixture_parses_without_integration_target() {
        let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/cursor_sessions/f441a0b8-plan-session.db");
        assert!(
            fixture_path.exists(),
            "Fixture not found: {}",
            fixture_path.display()
        );

        let session = parse_cursor_store_db(
            &fixture_path,
            "f441a0b8-ed9d-4dd2-8318-70cee2f29fa2",
            Some("/Users/example/Downloads/sample-go-project"),
        )
        .await
        .expect("fixture should parse successfully");

        assert!(
            !session.messages.is_empty(),
            "fixture should include messages"
        );
        assert!(
            session.stats.user_messages >= 1,
            "fixture should include at least one user message"
        );
    }

    // Helper for dedup assertion
    fn extract_all_text(blocks: &[ContentBlock]) -> String {
        blocks
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}
