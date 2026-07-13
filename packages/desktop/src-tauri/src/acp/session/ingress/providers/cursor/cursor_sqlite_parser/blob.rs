//! Cohesive binary/blob decoding, protobuf text extraction, and message deduplication.

use super::*;

pub(super) fn extract_messages_from_blob_data(blobs: Vec<Vec<u8>>) -> Result<Vec<OrderedMessage>> {
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

pub(super) fn parse_blob_messages(data: &[u8], index: usize) -> Result<Vec<OrderedMessage>> {
    if let Some(json_str) = extract_json_object_from_blob(data) {
        if let Ok(msg) = serde_json::from_str::<CursorStoreMessage>(&json_str) {
            if !matches!(msg.role.as_str(), "user" | "assistant" | "tool") {
                return Ok(Vec::new());
            }
            return convert_cursor_store_message(msg, index).map(|message| {
                // A message whose content reduces to nothing after
                // sanitization (e.g. an injected-context-only preamble)
                // must not become a transcript entry.
                if message.content_blocks.is_empty() {
                    Vec::new()
                } else {
                    vec![message]
                }
            });
        }
    }

    if let Some(text) = extract_plain_text_message_from_blob(data) {
        return Ok(vec![build_text_message("assistant", text, None, index)]);
    }

    Ok(Vec::new())
}

pub(super) fn extract_json_object_from_blob(data: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(data);
    let start = text.find('{')?;
    let end = text.rfind('}')?;

    if end < start {
        return None;
    }

    Some(text[start..=end].to_string())
}

pub(super) fn extract_plain_text_message_from_blob(data: &[u8]) -> Option<String> {
    // Gate on the legacy line-scan verdict first: it is what keeps metadata
    // blobs (request ids, queued-draft echoes, todo titles, token strings)
    // out of the transcript, because their raw form has no sentence
    // characters. Only blobs it admits may become messages at all.
    let legacy = extract_human_readable_text(String::from_utf8_lossy(data).as_ref());
    if legacy.is_empty() || !looks_like_plain_text_message(&legacy) {
        return None;
    }

    // Cursor's acp-sessions store persists non-JSON blobs as protobuf. For
    // admitted blobs, prefer decoding the wire format: the lossy line scan
    // leaks varint length bytes ("MChecking…") and adjacent metadata fields
    // ("summarized_conversation") into the text.
    if let Some(mut strings) = extract_protobuf_strings(data) {
        // Judge the blob on ALL decoded strings first: metadata blobs (e.g.
        // the context breakdown) carry workspace URIs and identifier fields
        // that mark the whole blob as non-narrative.
        let all_fields = sanitize_cursor_sqlite_text(&strings.join("\n"));
        if all_fields.is_empty() || !looks_like_plain_text_message(&all_fields) {
            return None;
        }
        // Identifier-ish fields (uuids, tool ids) carry no spaces; only keep
        // prose strings as message content.
        strings.retain(|s| s.trim().contains(' '));
        let sanitized = sanitize_cursor_sqlite_text(&strings.join("\n"));
        if !sanitized.is_empty() && looks_like_plain_text_message(&sanitized) {
            return Some(sanitized);
        }
        // Valid wire format but no clean narrative text — metadata, not a
        // message.
        return None;
    }

    // Genuine plain-text blob.
    Some(legacy)
}

const MAX_PROTOBUF_NESTING_DEPTH: usize = 6;

/// Decode a blob as protobuf wire format and collect human-readable string
/// fields, recursing into nested length-delimited messages. Returns `None`
/// when the blob does not parse as wire format (e.g. it is plain text).
pub(super) fn extract_protobuf_strings(data: &[u8]) -> Option<Vec<String>> {
    let mut strings = Vec::new();
    if collect_protobuf_strings(data, 0, &mut strings) {
        Some(strings)
    } else {
        None
    }
}

pub(super) fn collect_protobuf_strings(data: &[u8], depth: usize, out: &mut Vec<String>) -> bool {
    let mut offset = 0;

    while offset < data.len() {
        let Some((key, key_len)) = read_protobuf_varint(&data[offset..]) else {
            return false;
        };
        offset += key_len;

        let field_number = key >> 3;
        if field_number == 0 {
            return false;
        }

        match key & 0x7 {
            // Varint
            0 => {
                let Some((_, value_len)) = read_protobuf_varint(&data[offset..]) else {
                    return false;
                };
                offset += value_len;
            }
            // 64-bit
            1 => {
                if data.len() - offset < 8 {
                    return false;
                }
                offset += 8;
            }
            // 32-bit
            5 => {
                if data.len() - offset < 4 {
                    return false;
                }
                offset += 4;
            }
            // Length-delimited: string, bytes, or nested message
            2 => {
                let Some((payload_len, len_len)) = read_protobuf_varint(&data[offset..]) else {
                    return false;
                };
                offset += len_len;
                let Ok(payload_len) = usize::try_from(payload_len) else {
                    return false;
                };
                if data.len() - offset < payload_len {
                    return false;
                }
                let payload = &data[offset..offset + payload_len];
                offset += payload_len;

                // Prefer the nested-message interpretation: wrapper headers
                // are often printable ASCII (a length byte like 0x4d reads as
                // "M"), so a naive text-first check would keep wire bytes
                // glued to the real string ("MChecking…").
                let mut handled = false;
                if depth < MAX_PROTOBUF_NESTING_DEPTH {
                    let mut nested = Vec::new();
                    if collect_protobuf_strings(payload, depth + 1, &mut nested)
                        && !nested.is_empty()
                    {
                        out.append(&mut nested);
                        handled = true;
                    }
                }
                if !handled {
                    if let Ok(text) = std::str::from_utf8(payload) {
                        if is_protobuf_text_field(text) {
                            out.push(text.to_string());
                        }
                    }
                    // Anything else is opaque bytes (hashes, ids) — skip the
                    // payload, don't reject the whole blob.
                }
            }
            // Groups (3/4) are unused by Cursor; anything else is not wire format.
            _ => return false,
        }
    }

    true
}

pub(super) fn read_protobuf_varint(data: &[u8]) -> Option<(u64, usize)> {
    let mut value: u64 = 0;
    for (index, byte) in data.iter().enumerate().take(10) {
        if index == 9 && *byte > 1 {
            return None;
        }
        value |= u64::from(byte & 0x7f) << (7 * index);
        if byte & 0x80 == 0 {
            return Some((value, index + 1));
        }
    }
    None
}

/// A length-delimited payload counts as a text field only when it reads as
/// human-authored text rather than an identifier, label key, or binary that
/// happens to be valid UTF-8.
pub(super) fn is_protobuf_text_field(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.len() < 4 {
        return false;
    }

    let has_forbidden_control = trimmed
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\t' && c != '\r');
    if has_forbidden_control {
        return false;
    }

    let alpha_chars = trimmed.chars().filter(|c| c.is_alphabetic()).count();
    alpha_chars >= 3
}

pub(super) fn extract_human_readable_text(text: &str) -> String {
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

pub(super) fn is_human_readable_line(line: &str) -> bool {
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

pub(super) fn looks_like_plain_text_message(text: &str) -> bool {
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

pub(super) fn normalize_cursor_sdk_tool_name(name: &str) -> String {
    let trimmed = name.trim();
    let normalized = match trimmed {
        "read" => "Read",
        "write" => "Write",
        "delete" => "Delete",
        "glob" => "Glob",
        "grep" => "Grep",
        "shell" => "Shell",
        "edit" => "Edit",
        "ls" => "Ls",
        "readLints" => "ReadLints",
        "semSearch" => "SemanticSearch",
        "generateImage" => "GenerateImage",
        "createPlan" => "CreatePlan",
        "updateTodos" => "UpdateTodos",
        "task" => "Task",
        _ => trimmed,
    };
    normalized.to_string()
}

pub(super) fn parse_cursor_tool_use_block(item: &JsonValue) -> Option<ContentBlock> {
    let message = item.get("message").unwrap_or(item);
    let id = item
        .get("id")
        .or_else(|| item.get("toolCallId"))
        .or_else(|| message.get("id"))
        .or_else(|| message.get("toolCallId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let name = item
        .get("name")
        .or_else(|| item.get("toolName"))
        .or_else(|| message.get("name"))
        .or_else(|| message.get("toolName"))
        .or_else(|| message.get("type"))
        .and_then(|v| v.as_str())
        .map(normalize_cursor_sdk_tool_name)
        .filter(|value| !value.is_empty())?;
    let input = item
        .get("input")
        .or_else(|| item.get("arguments"))
        .or_else(|| item.get("args"))
        .or_else(|| message.get("input"))
        .or_else(|| message.get("arguments"))
        .or_else(|| message.get("args"))
        .cloned()
        .unwrap_or(serde_json::json!({}));

    Some(ContentBlock::ToolUse { id, name, input })
}

pub(super) fn extract_cursor_tool_result_text(value: &JsonValue) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }

    if let Some(content) = value.get("content").and_then(|content| content.as_str()) {
        return Some(content.to_string());
    }

    if let Some(result) = value.get("result") {
        return extract_cursor_tool_result_text(result);
    }

    if let Some(result_value) = value.get("value") {
        return extract_cursor_tool_result_text(result_value);
    }

    if let Some(error) = value.get("error") {
        return extract_cursor_tool_result_text(error)
            .or_else(|| serde_json::to_string(error).ok());
    }

    None
}

pub(super) fn parse_cursor_inline_tool_result_block(
    item: &JsonValue,
    tool_use_id: &str,
) -> Option<ContentBlock> {
    let message = item.get("message").unwrap_or(item);
    let result = message.get("result").or_else(|| item.get("result"))?;
    let content = extract_cursor_tool_result_text(result)?;

    Some(ContentBlock::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content,
    })
}

pub(super) fn build_text_message(
    role: &str,
    text: String,
    model: Option<String>,
    index: usize,
) -> OrderedMessage {
    OrderedMessage {
        uuid: format!("cursor-msg-{}", uuid::Uuid::new_v4()),
        parent_uuid: None,
        role: role.to_string(),
        provider_message_id: None,
        timestamp: fallback_timestamp(index),
        content_blocks: vec![ContentBlock::Text { text }],
        model,
        usage: None,
        error: None,
        request_id: None,
        is_meta: false,
        source_tool_use_id: None,
        parent_tool_use_id: None,
        tool_use_result: None,
        source_tool_assistant_uuid: None,
    }
}

pub(super) fn strip_duplicate_status_text_from_reasoning_messages(
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

pub(super) fn message_signature(message: &OrderedMessage) -> String {
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

pub(super) fn narrative_message_signature(message: &OrderedMessage) -> Option<String> {
    let mut fragments = Vec::new();

    for block in &message.content_blocks {
        match block {
            ContentBlock::Text { text } => fragments.push(text.trim().to_string()),
            ContentBlock::Thinking {
                thinking,
                redacted_provider_data,
                ..
            } => fragments.push(thinking_signature_fragment(
                thinking,
                redacted_provider_data.as_deref(),
            )),
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

pub(super) fn content_block_signature(block: &ContentBlock) -> String {
    match block {
        ContentBlock::Text { text } => format!("text:{text}"),
        ContentBlock::PastedContent { text } => format!("pasted_content:{text}"),
        ContentBlock::Thinking {
            thinking,
            redacted_provider_data,
            ..
        } => format!(
            "thinking:{}",
            thinking_signature_fragment(thinking, redacted_provider_data.as_deref())
        ),
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

pub(super) fn thinking_signature_fragment(
    thinking: &str,
    redacted_provider_data: Option<&str>,
) -> String {
    match redacted_provider_data {
        Some(data) => format!("{}\nredacted-data:{}", thinking.trim(), data),
        _ => thinking.trim().to_string(),
    }
}
