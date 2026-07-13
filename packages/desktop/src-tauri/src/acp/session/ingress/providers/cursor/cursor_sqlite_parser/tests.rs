//! Cohesive characterization coverage for Cursor SQLite decoding and sanitization.

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
fn test_sanitize_cursor_sqlite_text_strips_timestamp_wrapper_and_mcp_instructions() {
    // Real per-turn shape from Cursor acp-sessions store.db: the composed
    // model-facing prompt wraps the user's text in <timestamp> + <user_query>.
    let turn = "<timestamp>Saturday, Jul 11, 2026, 9:42 PM (UTC+2)</timestamp>\n<user_query>\nhi\n</user_query>";
    assert_eq!(sanitize_cursor_sqlite_text(turn), "hi");

    // Real session-start preamble shape: pure injected context, no user text.
    // Must sanitize to empty so no ghost user bubble is created.
    let preamble = "<user_info>\nOS Version: darwin 25.5.0\n</user_info>\n\n<mcp_instructions description=\"Instructions provided by MCP servers to help use them properly\">\nServer: railway\nRailway MCP server.\n</mcp_instructions>";
    assert_eq!(sanitize_cursor_sqlite_text(preamble), "");
}

#[tokio::test]
async fn test_cursor_store_db_transcript_excludes_prompt_scaffolding_and_wire_bytes() {
    // Minimised fixture built from a real live session (c2a34686) that rendered
    // provider junk in the transcript: mcp_instructions preamble, <timestamp>
    // wrappers, and protobuf wire bytes leaking into text.
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cursor_sessions/c2a34686-junk-session.db");
    assert!(
        fixture_path.exists(),
        "Fixture not found: {}",
        fixture_path.display()
    );

    let session = parse_cursor_store_db(
        &fixture_path,
        "c2a34686-f99a-4632-90e2-e036b96124c2",
        Some("/Users/alex/Documents/sandbox"),
    )
    .await
    .expect("Should parse store.db successfully");

    // The only real user turn in the fixture is "hi" — the injected-context
    // preamble must not surface as a user message, and the <timestamp>
    // wrapper must be stripped from the turn.
    let user_texts: Vec<String> = session
        .messages
        .iter()
        .filter(|m| m.role == "user")
        .flat_map(|m| m.content_blocks.iter())
        .filter_map(|b| match b {
            ContentBlock::Text { text } => Some(text.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(user_texts, vec!["hi".to_string()]);

    let mut all_visible_text = String::new();
    for message in &session.messages {
        for block in &message.content_blocks {
            let text = match block {
                ContentBlock::Text { text } => text,
                ContentBlock::Thinking { thinking, .. } => thinking,
                _ => continue,
            };
            all_visible_text.push_str(text);
            all_visible_text.push('\n');
            // No provider prompt scaffolding may reach canonical text.
            assert!(
                !text.contains("<mcp_instructions") && !text.contains("<timestamp"),
                "prompt scaffolding leaked into transcript text: {text:?}"
            );
            // No protobuf wire bytes may reach canonical text.
            assert!(
                text.chars()
                    .all(|c| !c.is_control() || c == '\n' || c == '\t'),
                "control bytes leaked into transcript text: {text:?}"
            );
        }
    }

    // Context-breakdown metadata blob must not become a message.
    assert!(
        !all_visible_text.contains("summarized_conversation"),
        "context-breakdown metadata leaked: {all_visible_text:?}"
    );
    // Protobuf strings must decode cleanly, without stray varint length
    // bytes glued to the front ("eThe user sent…", "MChecking…").
    assert!(
        all_visible_text.contains("The user sent a simple greeting."),
        "expected clean protobuf text extraction, got: {all_visible_text:?}"
    );
    assert!(
        !all_visible_text.contains("eThe user sent"),
        "stray varint length byte leaked: {all_visible_text:?}"
    );
    assert!(
        !all_visible_text.contains("MChecking"),
        "stray varint length byte leaked: {all_visible_text:?}"
    );

    // Cursor's routine encrypted redacted-reasoning blocks (present on
    // essentially every assistant reply) must not surface as Thinking
    // blocks — downstream they render as "Thought -> [REDACTED]".
    for message in &session.messages {
        for block in &message.content_blocks {
            if let ContentBlock::Thinking {
                thinking,
                redacted_provider_data,
                ..
            } = block
            {
                assert!(
                    redacted_provider_data.is_none() && !thinking.trim().is_empty(),
                    "redacted-reasoning leaked as an empty Thinking block"
                );
            }
        }
    }
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
        "<think>internal</think> Hi again.\n<user_query>retry</user_query>\n02:00:11".to_string(),
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
fn test_parse_cursor_content_drops_routine_redacted_reasoning_payload() {
    // Cursor attaches an encrypted `redacted-reasoning` block to essentially
    // every assistant reply. It is provider replay metadata, not transcript
    // truth: surfacing it as a Thinking block renders a junk
    // "Thought -> [REDACTED]" entry on every assistant message.
    let content = json!([
        {
            "type": "redacted-reasoning",
            "data": "opaque-provider-payload"
        },
        {
            "type": "text",
            "text": "Visible answer"
        }
    ]);

    let blocks = parse_cursor_content(&content).expect("content should parse");

    assert_eq!(
        blocks.len(),
        1,
        "redacted-reasoning must not become a block"
    );
    match &blocks[0] {
        ContentBlock::Text { text } => assert_eq!(text, "Visible answer"),
        other => panic!("expected visible text block, got {other:?}"),
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
    // Real store.db status blobs are protobuf wire format: an outer
    // length-delimited field 1 wrapping an inner field 1 whose payload is
    // the status string. The old lossy line scan leaked the inner length
    // byte as a stray prefix letter (e.g. "MChecking…").
    let status_text =
        b"Exploring the codebase to understand the project and identify improvements.\n";
    let mut inner = vec![0x0a, status_text.len() as u8];
    inner.extend_from_slice(status_text);
    let mut status_blob = vec![0x0a, inner.len() as u8];
    status_blob.extend_from_slice(&inner);

    let blobs = vec![
            status_blob,
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

#[test]
fn test_parse_cursor_content_recovers_sdk_tool_call_read_args() {
    let content = json!([
        {
            "type": "toolCall",
            "toolCallId": "tool_read_123",
            "message": {
                "type": "read",
                "args": {
                    "path": "/repo/src/main.ts"
                },
                "result": {
                    "status": "success",
                    "value": {
                        "content": "export const value = 1;",
                        "totalLines": 1,
                        "fileSize": 23
                    }
                }
            }
        }
    ]);

    let blocks = parse_cursor_content(&content).expect("content should parse");

    match blocks.as_slice() {
        [ContentBlock::ToolUse { id, name, input }, ContentBlock::ToolResult {
            tool_use_id,
            content,
        }] => {
            assert_eq!(id, "tool_read_123");
            assert_eq!(name, "Read");
            assert_eq!(input["path"], "/repo/src/main.ts");
            assert_eq!(tool_use_id, "tool_read_123");
            assert_eq!(content, "export const value = 1;");
        }
        other => panic!("expected sdk read tool use and result blocks, got {other:?}"),
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
                ContentBlock::PastedContent { .. } => "pasted_content",
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
