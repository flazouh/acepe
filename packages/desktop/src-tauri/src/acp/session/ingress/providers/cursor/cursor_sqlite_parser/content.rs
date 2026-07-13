//! Cursor message conversion, content-block parsing, and text sanitization.

use super::*;

/// Convert Cursor message to OrderedMessage
pub(super) fn convert_cursor_store_message(
    msg: CursorStoreMessage,
    index: usize,
) -> Result<OrderedMessage> {
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
        provider_message_id: None,
        timestamp,
        content_blocks,
        model: msg.model,
        usage: None, // Cursor doesn't store token usage in blobs
        error: None,
        request_id: None,
        is_meta: false,
        source_tool_use_id: None, // Cursor doesn't support skill meta messages
        parent_tool_use_id: None,
        tool_use_result: None,            // Cursor doesn't have tool_use_result
        source_tool_assistant_uuid: None, // Cursor doesn't have source_tool_assistant_uuid
    })
}

pub(super) fn convert_cursor_tool_message(
    msg: CursorStoreMessage,
    index: usize,
) -> Result<OrderedMessage> {
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
        provider_message_id: None,
        timestamp: extract_timestamp_from_content(&msg.content)
            .unwrap_or_else(|| fallback_timestamp(index)),
        content_blocks,
        model: msg.model,
        usage: None,
        error: None,
        request_id: None,
        is_meta: false,
        source_tool_use_id: None,
        parent_tool_use_id: None,
        tool_use_result: None,
        source_tool_assistant_uuid: None,
    })
}

pub(super) fn fallback_timestamp(index: usize) -> String {
    let base = chrono::DateTime::parse_from_rfc3339("2025-01-01T00:00:00Z")
        .expect("hard-coded fallback timestamp should parse")
        .timestamp();
    let ts = base + (index as i64);
    chrono::DateTime::from_timestamp(ts, 0)
        .expect("fallback timestamp should be representable")
        .to_rfc3339()
}

/// Parse Cursor content format to ContentBlocks
pub(super) fn parse_cursor_content(content: &JsonValue) -> Result<Vec<ContentBlock>> {
    let mut blocks = Vec::new();

    // Cursor content is either a string or an array
    if let Some(text) = content.as_str() {
        if let Some(thinking) = extract_thinking_content(text) {
            if !thinking.is_empty() {
                blocks.push(ContentBlock::Thinking {
                    thinking,
                    signature: None,
                    redacted_provider_data: None,
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
                                        redacted_provider_data: None,
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
                                redacted_provider_data: None,
                            });
                        }
                    }
                    "redacted-reasoning" => {
                        // Cursor attaches an encrypted redacted-reasoning block to
                        // essentially every assistant reply. It is provider replay
                        // metadata, not transcript truth — drop it so it never
                        // renders as a "Thought -> [REDACTED]" entry.
                        continue;
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
                                        redacted_provider_data: None,
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
                    "tool_use" | "tool-use" | "tool-call" | "toolCall" => {
                        if let Some(block) = parse_cursor_tool_use_block(item) {
                            let tool_use_id = match &block {
                                ContentBlock::ToolUse { id, .. } => id.clone(),
                                _ => String::new(),
                            };
                            blocks.push(block);
                            if let Some(result_block) =
                                parse_cursor_inline_tool_result_block(item, &tool_use_id)
                            {
                                blocks.push(result_block);
                            }
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
pub(super) fn extract_thinking_content(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    if let Some(start_idx) = lower.find("<think>") {
        if let Some(end_idx) = lower.find("</think>") {
            let thinking = &text[start_idx + 7..end_idx];
            return Some(thinking.trim().to_string());
        }
    }
    None
}

pub(super) fn sanitize_cursor_sqlite_text(text: &str) -> String {
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
        "mcp_instructions",
        "timestamp",
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

pub(super) fn extract_assistant_text_from_json_envelopes(text: &str) -> Option<String> {
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

pub(super) fn assistant_text_from_event(value: &JsonValue) -> Option<String> {
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
pub(super) fn extract_timestamp_from_content(content: &JsonValue) -> Option<String> {
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
