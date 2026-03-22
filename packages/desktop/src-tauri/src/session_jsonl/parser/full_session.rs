use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::session_jsonl::types::{
    ContentBlock, FullSession, OrderedMessage, SessionStats, TokenUsage,
};

use super::scan::find_session_file;
use super::text_utils::extract_display_name_from_content;

#[derive(Debug, Clone, Deserialize)]
struct RawMessage {
    #[serde(rename = "type")]
    _message_type: String,
    uuid: String,
    #[serde(rename = "parentUuid")]
    parent_uuid: Option<String>,
    timestamp: String,
    #[serde(rename = "sessionId")]
    _session_id: Option<String>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    message: Option<RawMessageContent>,
    _cwd: Option<String>,
    /// ID of the tool use this meta message is associated with (for skill content)
    #[serde(rename = "sourceToolUseID")]
    source_tool_use_id: Option<String>,
    /// Tool use result data - contains questions and answers for AskUserQuestion tool
    #[serde(rename = "toolUseResult")]
    tool_use_result: Option<serde_json::Value>,
    /// UUID of the assistant message containing the tool use that this result is for
    #[serde(rename = "sourceToolAssistantUUID")]
    source_tool_assistant_uuid: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawMessageContent {
    role: String,
    id: Option<String>,
    content: serde_json::Value,
    model: Option<String>,
    usage: Option<RawUsage>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawUsage {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    #[serde(rename = "cache_read_input_tokens")]
    cache_read_tokens: Option<i64>,
    #[serde(rename = "cache_creation_input_tokens")]
    cache_creation_tokens: Option<i64>,
}

/// Parse content blocks from raw JSON content
fn parse_content_blocks(content: &serde_json::Value) -> Vec<ContentBlock> {
    let mut blocks = Vec::new();

    if let Some(text) = content.as_str() {
        if !text.is_empty() {
            blocks.push(ContentBlock::Text {
                text: text.to_string(),
            });
        }
    } else if let Some(arr) = content.as_array() {
        for item in arr {
            let block_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");

            match block_type {
                "text" => {
                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                        blocks.push(ContentBlock::Text {
                            text: text.to_string(),
                        });
                    }
                }
                "thinking" => {
                    if let Some(thinking) = item.get("thinking").and_then(|v| v.as_str()) {
                        let signature = item
                            .get("signature")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        blocks.push(ContentBlock::Thinking {
                            thinking: thinking.to_string(),
                            signature,
                        });
                    }
                }
                "tool_use" => {
                    let id = item
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input = item.get("input").cloned().unwrap_or(serde_json::json!({}));
                    blocks.push(ContentBlock::ToolUse { id, name, input });
                }
                "tool_result" => {
                    let tool_use_id = item
                        .get("tool_use_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let content = if let Some(s) = item.get("content").and_then(|v| v.as_str()) {
                        s.to_string()
                    } else if let Some(arr) = item.get("content").and_then(|v| v.as_array()) {
                        // Concatenate text from array of content blocks
                        arr.iter()
                            .filter_map(|v| v.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n")
                    } else {
                        String::new()
                    };
                    blocks.push(ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                    });
                }
                _ => {}
            }
        }
    }

    blocks
}

/// Resolve a UUID through alias mappings created during assistant message coalescing.
/// A bounded loop avoids accidental infinite cycles.
fn resolve_uuid_alias(uuid: String, aliases: &HashMap<String, String>) -> String {
    let mut current = uuid;

    for _ in 0..32 {
        match aliases.get(&current) {
            Some(next) if next != &current => current = next.clone(),
            _ => break,
        }
    }

    current
}

/// Build a merge key for assistant message fragments.
/// Prefer the stable Claude message.id, falling back to requestId.
fn assistant_merge_key(message_id: Option<&str>, request_id: Option<&str>) -> Option<String> {
    if let Some(id) = message_id.filter(|id| !id.is_empty()) {
        return Some(format!("message:{id}"));
    }

    request_id
        .filter(|id| !id.is_empty())
        .map(|id| format!("request:{id}"))
}

/// Order messages by following the parentUuid chain
fn order_messages_by_parent(messages: Vec<OrderedMessage>) -> Vec<OrderedMessage> {
    let by_uuid: HashMap<String, OrderedMessage> = messages
        .iter()
        .map(|m| (m.uuid.clone(), m.clone()))
        .collect();

    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    let mut roots: Vec<String> = Vec::new();

    for m in &messages {
        if let Some(ref parent) = m.parent_uuid {
            if by_uuid.contains_key(parent) {
                children
                    .entry(parent.clone())
                    .or_default()
                    .push(m.uuid.clone());
            } else {
                roots.push(m.uuid.clone());
            }
        } else {
            roots.push(m.uuid.clone());
        }
    }

    // Sort children by timestamp
    for kids in children.values_mut() {
        kids.sort_by(|a, b| {
            let ts_a = by_uuid.get(a).map(|m| m.timestamp.as_str()).unwrap_or("");
            let ts_b = by_uuid.get(b).map(|m| m.timestamp.as_str()).unwrap_or("");
            ts_a.cmp(ts_b)
        });
    }

    // Walk the tree
    fn walk(
        uuid: &str,
        by_uuid: &HashMap<String, OrderedMessage>,
        children: &HashMap<String, Vec<String>>,
        result: &mut Vec<OrderedMessage>,
    ) {
        if let Some(msg) = by_uuid.get(uuid) {
            result.push(msg.clone());
            if let Some(kids) = children.get(uuid) {
                for kid in kids {
                    walk(kid, by_uuid, children, result);
                }
            }
        }
    }

    // Sort roots by timestamp
    roots.sort_by(|a, b| {
        let ts_a = by_uuid.get(a).map(|m| m.timestamp.as_str()).unwrap_or("");
        let ts_b = by_uuid.get(b).map(|m| m.timestamp.as_str()).unwrap_or("");
        ts_a.cmp(ts_b)
    });

    let mut result = Vec::new();
    for root in roots {
        walk(&root, &by_uuid, &children, &mut result);
    }

    result
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

        if let Some(usage) = &msg.usage {
            stats.total_input_tokens += usage.input_tokens;
            stats.total_output_tokens += usage.output_tokens;
        }
    }

    stats
}

/// Parse a full session with ordered messages, usage stats, and metadata.
/// Returns a FullSession with all messages ordered by parentUuid chain.
pub async fn parse_full_session(session_id: &str, project_path: &str) -> Result<FullSession> {
    let (session, _path) = parse_full_session_with_path(session_id, project_path).await?;
    Ok(session)
}

/// Parse a full session from an already-resolved file path.
/// Used for timing audits to separate file discovery from read+parse.
pub async fn parse_full_session_from_path(
    session_id: &str,
    project_path: &str,
    session_path: &PathBuf,
) -> Result<FullSession> {
    let (session, _) =
        parse_full_session_from_path_with_path(session_id, project_path, session_path).await?;
    Ok(session)
}

/// Parse a full session with ordered messages and return both the session and source file path.
/// The path can be used to track file modification time for stale session detection.
pub async fn parse_full_session_with_path(
    session_id: &str,
    project_path: &str,
) -> Result<(FullSession, PathBuf)> {
    let session_path = find_session_file(session_id, project_path).await?;
    parse_full_session_from_path_with_path(session_id, project_path, &session_path).await
}

/// Internal: parse from path, returns (FullSession, PathBuf) for compatibility.
async fn parse_full_session_from_path_with_path(
    session_id: &str,
    project_path: &str,
    session_path: &PathBuf,
) -> Result<(FullSession, PathBuf)> {
    let content = tokio::fs::read_to_string(session_path).await?;

    // Extract title using the same logic as extract_display_name_from_content()
    // This ensures session list and session header show the same title
    let title = extract_display_name_from_content(&content)
        .unwrap_or_else(|| "Untitled conversation".to_string());

    let mut messages: Vec<OrderedMessage> = Vec::new();
    let mut assistant_message_key_to_index: HashMap<String, usize> = HashMap::new();
    let mut uuid_aliases: HashMap<String, String> = HashMap::new();
    let mut created_at = String::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        // Try to parse as raw message
        let json: Value = match serde_json::from_str(line) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    line_preview = %&line[..line.len().min(200)],
                    "Failed to parse JSONL line during full session load"
                );
                continue;
            }
        };

        let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

        // Skip non-message types
        if msg_type != "user" && msg_type != "assistant" {
            continue;
        }

        let raw: RawMessage = match serde_json::from_value(json.clone()) {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(
                    session_id = %session_id,
                    msg_type = %msg_type,
                    error = %e,
                    "Failed to deserialize message into RawMessage"
                );
                continue;
            }
        };

        // Track earliest timestamp for created_at
        if created_at.is_empty() || raw.timestamp < created_at {
            created_at = raw.timestamp.clone();
        }

        let msg_content = match raw.message {
            Some(c) => c,
            None => continue,
        };

        let resolved_parent_uuid = raw
            .parent_uuid
            .clone()
            .map(|uuid| resolve_uuid_alias(uuid, &uuid_aliases));
        let resolved_source_tool_assistant_uuid = raw
            .source_tool_assistant_uuid
            .clone()
            .map(|uuid| resolve_uuid_alias(uuid, &uuid_aliases));
        let content_blocks = parse_content_blocks(&msg_content.content);
        let merge_key = if msg_content.role == "assistant" {
            assistant_merge_key(msg_content.id.as_deref(), raw.request_id.as_deref())
        } else {
            None
        };

        let usage = msg_content.usage.map(|u| TokenUsage {
            input_tokens: u.input_tokens.unwrap_or(0),
            output_tokens: u.output_tokens.unwrap_or(0),
            cache_read_tokens: u.cache_read_tokens.unwrap_or(0),
            cache_creation_tokens: u.cache_creation_tokens.unwrap_or(0),
        });

        if let Some(key) = merge_key {
            if let Some(existing_index) = assistant_message_key_to_index.get(&key).copied() {
                if let Some(existing) = messages.get_mut(existing_index) {
                    existing.content_blocks.extend(content_blocks);

                    if msg_content.model.is_some() {
                        existing.model = msg_content.model;
                    }
                    if usage.is_some() {
                        existing.usage = usage;
                    }
                    if raw.request_id.is_some() {
                        existing.request_id = raw.request_id.clone();
                    }

                    existing.is_meta = existing.is_meta || raw.is_meta.unwrap_or(false);

                    if raw.source_tool_use_id.is_some() {
                        existing.source_tool_use_id = raw.source_tool_use_id.clone();
                    }
                    if raw.tool_use_result.is_some() {
                        existing.tool_use_result = raw.tool_use_result.clone();
                    }
                    if resolved_source_tool_assistant_uuid.is_some() {
                        existing.source_tool_assistant_uuid = resolved_source_tool_assistant_uuid;
                    }

                    let previous_uuid = existing.uuid.clone();
                    if previous_uuid != raw.uuid {
                        uuid_aliases.insert(previous_uuid, raw.uuid.clone());
                        existing.uuid = raw.uuid.clone();
                    }
                }

                continue;
            }

            assistant_message_key_to_index.insert(key, messages.len());
        }

        messages.push(OrderedMessage {
            uuid: raw.uuid,
            parent_uuid: resolved_parent_uuid,
            role: msg_content.role,
            timestamp: raw.timestamp,
            content_blocks,
            model: msg_content.model,
            usage,
            request_id: raw.request_id,
            is_meta: raw.is_meta.unwrap_or(false),
            source_tool_use_id: raw.source_tool_use_id,
            tool_use_result: raw.tool_use_result,
            source_tool_assistant_uuid: resolved_source_tool_assistant_uuid,
        });
    }

    if !uuid_aliases.is_empty() {
        for message in &mut messages {
            message.uuid = resolve_uuid_alias(message.uuid.clone(), &uuid_aliases);
            message.parent_uuid = message
                .parent_uuid
                .take()
                .map(|uuid| resolve_uuid_alias(uuid, &uuid_aliases));
            message.source_tool_assistant_uuid = message
                .source_tool_assistant_uuid
                .take()
                .map(|uuid| resolve_uuid_alias(uuid, &uuid_aliases));
        }
    }

    // Order messages by parentUuid chain
    let ordered = order_messages_by_parent(messages);

    // Calculate stats
    let stats = calculate_stats(&ordered);

    let session = FullSession {
        session_id: session_id.to_string(),
        project_path: project_path.to_string(),
        title,
        created_at,
        messages: ordered,
        stats,
    };

    Ok((session, session_path.clone()))
}
