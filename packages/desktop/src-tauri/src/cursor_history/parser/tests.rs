use super::*;
use tempfile::tempdir;

#[test]
fn test_path_to_slug() {
    assert_eq!(
        path_to_slug("/Users/example/Documents/sample-repo"),
        "Users-example-Documents-sample-repo"
    );
    assert_eq!(path_to_slug("/home/user/project"), "home-user-project");
}

#[test]
fn test_slug_to_path() {
    assert_eq!(slug_to_path("home-user-project"), "/home/user/project");
}

#[test]
fn test_resolve_workspace_path_prefers_known_project_path() {
    let project_paths = vec!["/Users/example/Documents/sample-repo".to_string()];

    assert_eq!(
        resolve_workspace_path("Users-example-Documents-sample-repo", &project_paths),
        "/Users/example/Documents/sample-repo"
    );
}

#[test]
fn test_extract_user_text() {
    let input = "<user_query>\nHello world\n</user_query>";
    assert_eq!(extract_user_text(input), "Hello world");

    let with_info = "<user_info>OS: darwin</user_info>\n<user_query>Test</user_query>";
    assert_eq!(extract_user_text(with_info), "Test");

    let plain = "Just plain text";
    assert_eq!(extract_user_text(plain), "Just plain text");
}

#[test]
fn test_truncate_title() {
    let short = "Short title";
    assert_eq!(truncate_title(short), "Short title");

    let multiline = "First line\nSecond line\nThird line";
    assert_eq!(truncate_title(multiline), "First line");

    let long = "A".repeat(150);
    let truncated = truncate_title(&long);
    assert!(truncated.ends_with("..."));
    assert_eq!(truncated.chars().count(), 103); // 100 chars + "..."

    // Test with multi-byte UTF-8 characters (Cyrillic)
    let cyrillic = "а".repeat(150); // Cyrillic 'а' is 2 bytes
    let truncated_cyrillic = truncate_title(&cyrillic);
    assert!(truncated_cyrillic.ends_with("..."));
    assert_eq!(truncated_cyrillic.chars().count(), 103); // Should work with multibyte chars
}

#[test]
fn test_is_command_message() {
    assert!(is_command_message("/help"));
    assert!(is_command_message("<command-name>test</command-name>"));
    assert!(!is_command_message("Regular message"));
}

#[test]
fn test_parse_message_content_with_thinking() {
    let mut stats = SessionStats {
        total_messages: 0,
        user_messages: 0,
        assistant_messages: 0,
        tool_uses: 0,
        tool_results: 0,
        thinking_blocks: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
    };
    let text = "<think>\nLet me analyze this...\n</think>\nHere's my answer.";

    let blocks = parse_message_content(text, "assistant", &mut stats);

    assert_eq!(blocks.len(), 2);
    assert_eq!(stats.thinking_blocks, 1);

    match &blocks[0] {
        ContentBlock::Thinking { thinking, .. } => {
            assert_eq!(thinking, "Let me analyze this...");
        }
        _ => panic!("Expected Thinking block"),
    }

    match &blocks[1] {
        ContentBlock::Text { text } => {
            assert_eq!(text, "Here's my answer.");
        }
        _ => panic!("Expected Text block"),
    }
}

#[test]
fn test_sanitize_cursor_assistant_text_strips_internal_wrappers() {
    let input = r#"
<think>internal reasoning</think> Hi again. How can I help you today?
<user_query>can you try ls?</user_query>
02:00:11
"#;

    let sanitized = sanitize_cursor_assistant_text(input);
    // user_query content is now unwrapped (preserved), not stripped
    assert_eq!(
        sanitized,
        "Hi again. How can I help you today?\ncan you try ls?"
    );
    assert!(!sanitized.contains("<think>"));
    assert!(!sanitized.contains("<user_query>"));
}

#[test]
fn test_parse_message_content_assistant_with_mixed_transcript_wrappers() {
    let mut stats = SessionStats {
        total_messages: 0,
        user_messages: 0,
        assistant_messages: 0,
        tool_uses: 0,
        tool_results: 0,
        thinking_blocks: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
    };

    let text = r#"
<think>The user is just saying hi again.</think> Hi again. How can I help you today?
<user_query>can you try to execute an "ls" command ?</user_query>
02:00:11
"#;

    let blocks = parse_message_content(text, "assistant", &mut stats);

    assert_eq!(stats.thinking_blocks, 1);
    assert_eq!(blocks.len(), 2);
    match &blocks[0] {
        ContentBlock::Thinking { thinking, .. } => {
            assert_eq!(thinking, "The user is just saying hi again.");
        }
        _ => panic!("Expected Thinking block"),
    }
    match &blocks[1] {
        ContentBlock::Text { text } => {
            // user_query content is now unwrapped (preserved), not stripped
            assert_eq!(
                text,
                "Hi again. How can I help you today?\ncan you try to execute an \"ls\" command ?"
            );
            assert!(!text.contains("<user_query>"));
        }
        _ => panic!("Expected Text block"),
    }
}

// ============================================
// Transcript Parsing Tests (TDD)
// ============================================

#[test]
fn test_parse_transcript_with_extra_fields() {
    // Real Cursor transcripts have additional fields like `thinking` and `toolCalls`
    // that we don't use but must not break parsing
    let json = r#"[
          {
            "role": "user",
            "text": "Hello, please help me",
            "thinking": null,
            "toolCalls": []
          },
          {
            "role": "assistant",
            "text": "I'll help you with that",
            "thinking": "Let me analyze the request",
            "toolCalls": [{"tool": "readFile", "args": {}}]
          }
        ]"#;

    let result: Result<Vec<CursorTranscriptMessage>, _> = serde_json::from_str(json);
    assert!(
        result.is_ok(),
        "Should parse messages with extra fields: {:?}",
        result.err()
    );

    let messages = result.unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[0].text, Some("Hello, please help me".to_string()));
    assert_eq!(messages[1].role, "assistant");
    assert_eq!(
        messages[1].text,
        Some("I'll help you with that".to_string())
    );
}

#[test]
fn test_parse_transcript_with_tool_result_no_text() {
    // Tool result messages have `toolResult` instead of `text`
    // This was causing "missing field `text`" parsing errors
    let json = r#"[
          {"role": "user", "text": "Read file.txt"},
          {"role": "assistant", "text": "I'll read that file for you"},
          {
            "role": "tool",
            "toolResult": {"content": "file contents here"},
            "toolCallId": "call_123"
          }
        ]"#;

    let result: Result<Vec<CursorTranscriptMessage>, _> = serde_json::from_str(json);
    assert!(
        result.is_ok(),
        "Should parse messages without text field: {:?}",
        result.err()
    );

    let messages = result.unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[2].role, "tool");
    assert_eq!(messages[2].text, None); // Tool messages have no text
}

#[test]
fn test_parse_transcript_basic() {
    // Basic transcript without extra fields should still work
    let json = r#"[
          {"role": "user", "text": "Test message"},
          {"role": "assistant", "text": "Response"}
        ]"#;

    let result: Result<Vec<CursorTranscriptMessage>, _> = serde_json::from_str(json);
    assert!(result.is_ok());

    let messages = result.unwrap();
    assert_eq!(messages.len(), 2);
}

// ============================================
// Text Transcript Parsing Tests (TDD)
// ============================================

#[test]
fn test_parse_txt_transcript_simple() {
    // Simple conversation with user query and assistant response
    let txt = r#"user:
<user_query>
remove the [TIMING] logs
</user_query>

A:
<think>
The user wants to remove timing logs.
</think>
I'll search for those logs and remove them."#;

    let messages = parse_txt_transcript_content(txt);

    assert_eq!(messages.len(), 2, "Should have user and assistant messages");
    assert_eq!(messages[0].role, "user");
    assert_eq!(
        messages[0].text,
        Some("remove the [TIMING] logs".to_string())
    );
    assert_eq!(messages[1].role, "assistant");
    // Assistant text should include both thinking and response
    assert!(messages[1]
        .text
        .as_ref()
        .unwrap()
        .contains("search for those logs"));
}

#[test]
fn test_parse_txt_transcript_with_tool_calls() {
    let txt = r#"user:
<user_query>
Read the file
</user_query>

A:
<think>
I need to read the file.
</think>
Let me read that file.

[Tool call] grep
  pattern: \[TIMING\]

[Tool result] grep

A:
<think>
Found the results.
</think>
I found 7 instances."#;

    let messages = parse_txt_transcript_content(txt);

    // Tool calls/results are currently skipped (informational only)
    // So we should have: user + 2 assistant messages
    assert_eq!(
        messages.len(),
        3,
        "Should have user + 2 assistant messages (tool calls skipped)"
    );
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[1].role, "assistant");
    assert_eq!(messages[2].role, "assistant");
}

#[test]
fn test_parse_txt_transcript_empty() {
    let messages = parse_txt_transcript_content("");
    assert!(messages.is_empty());
}

#[test]
fn test_parse_txt_transcript_user_only() {
    let txt = r#"user:
<user_query>
Hello world
</user_query>"#;

    let messages = parse_txt_transcript_content(txt);
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[0].text, Some("Hello world".to_string()));
}

#[test]
fn test_parse_txt_transcript_real_format_with_assistant() {
    // Real Cursor transcript format uses "assistant:" not "A:"
    let txt = r#"user:
<user_query>
Hello world
</user_query>

assistant:
<think>
Let me think about this.
</think>
Here's my response to your greeting."#;

    let messages = parse_txt_transcript_content(txt);

    assert_eq!(messages.len(), 2, "Should have user and assistant messages");
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[0].text, Some("Hello world".to_string()));
    assert_eq!(messages[1].role, "assistant");
    assert!(messages[1]
        .text
        .as_ref()
        .unwrap()
        .contains("response to your greeting"));
}

#[test]
fn test_parse_txt_transcript_with_attached_files() {
    // Real Cursor transcript with attached files
    let txt = r#"user:
<attached_files>

<code_selection path="/Users/example/project/src/main.ts" lines="1-10">
     1|import { App } from './app';
     2|
     3|const app = new App();
     4|app.start();
</code_selection>

</attached_files>

<user_query>
Can you explain this code?
</user_query>

assistant:
<think>
The user is asking about the main.ts file.
</think>
This code initializes and starts the application."#;

    let messages = parse_txt_transcript_content(txt);

    assert_eq!(messages.len(), 2, "Should have user and assistant messages");
    assert_eq!(messages[0].role, "user");

    // The user message text should contain the query
    assert!(messages[0]
        .text
        .as_ref()
        .unwrap()
        .contains("Can you explain this code?"));

    // The user message should have attachments
    assert!(
        messages[0].attachments.is_some(),
        "User message should have attachments"
    );
    let attachments = messages[0].attachments.as_ref().unwrap();
    assert_eq!(attachments.len(), 1, "Should have one attachment");

    // Verify attachment details
    let attachment = &attachments[0];
    assert_eq!(attachment.path, "/Users/example/project/src/main.ts");
    assert_eq!(attachment.lines, Some("1-10".to_string()));
    assert!(attachment.content.contains("import { App }"));

    // Assistant message should work normally
    assert_eq!(messages[1].role, "assistant");
    assert!(messages[1]
        .text
        .as_ref()
        .unwrap()
        .contains("initializes and starts"));
}

#[test]
fn test_parse_txt_transcript_with_multiple_attachments() {
    let txt = r#"user:
<attached_files>

<code_selection path="/project/a.ts" lines="1-5">
const a = 1;
</code_selection>

<code_selection path="/project/b.ts" lines="10-20">
const b = 2;
</code_selection>

</attached_files>

<user_query>
Compare these files
</user_query>

assistant:
They define different constants."#;

    let messages = parse_txt_transcript_content(txt);

    assert_eq!(messages.len(), 2);

    let attachments = messages[0].attachments.as_ref().unwrap();
    assert_eq!(attachments.len(), 2, "Should have two attachments");
    assert_eq!(attachments[0].path, "/project/a.ts");
    assert_eq!(attachments[1].path, "/project/b.ts");
}

#[test]
fn test_parse_jsonl_transcript_content_reads_modern_cursor_transcript() {
    let content = concat!(
            "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<attached_files>\\n\\n<code_selection path=\\\"/project/a.ts\\\" lines=\\\"1-2\\\">\\nconst a = 1;\\n</code_selection>\\n\\n</attached_files>\\n<user_query>\\nPlease review this file\\n</user_query>\"}]}}\n",
            "{\"role\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Exploring the codebase to understand its structure and suggest improvements.\"}]}}\n"
        );

    let messages = parse_jsonl_transcript_content(content).unwrap();

    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[0].text.as_deref(), Some("Please review this file"));
    let attachments = messages[0].attachments.as_ref().unwrap();
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments[0].path, "/project/a.ts");
    assert_eq!(messages[1].role, "assistant");
    assert_eq!(
        messages[1].text.as_deref(),
        Some("Exploring the codebase to understand its structure and suggest improvements.")
    );
}

#[tokio::test]
async fn test_extract_transcript_metadata_supports_nested_jsonl_transcripts() {
    let temp = tempdir().unwrap();
    let session_id = "session-123";
    let transcript_dir = temp.path().join("agent-transcripts").join(session_id);
    std::fs::create_dir_all(&transcript_dir).unwrap();
    let transcript_path = transcript_dir.join(format!("{}.jsonl", session_id));

    std::fs::write(
            &transcript_path,
            concat!(
                "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<user_query>\\nFix the parser\\n</user_query>\"}]}}\n",
                "{\"role\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Tracing the parser flow.\"}]}}\n"
            ),
        )
        .unwrap();

    let entry = extract_transcript_metadata(&transcript_path, session_id, "/tmp/project")
        .await
        .unwrap()
        .unwrap();

    assert_eq!(entry.id, session_id);
    assert_eq!(entry.title.as_deref(), Some("Fix the parser"));
    // message_count is 0 for fast metadata extraction (only title is needed)
    assert_eq!(
        entry.source_path.as_deref(),
        Some(transcript_path.to_str().unwrap())
    );
}

#[test]
fn test_extract_workspace_from_nested_jsonl_transcript_path() {
    let path = Path::new(
            "/Users/example/.cursor/projects/Users-example-Documents-acepe/agent-transcripts/session-123/session-123.jsonl",
        );

    assert_eq!(
        extract_workspace_from_transcript_path(path),
        "/Users/example/Documents/acepe"
    );
}

#[tokio::test]
async fn test_find_sqlite_store_db_for_session_finds_existing_store_db() {
    let temp = tempdir().unwrap();
    let chats_dir = temp.path().join("chats");
    let hash_dir = chats_dir.join("abcd1234");
    let session_id = "session-123";
    let session_dir = hash_dir.join(session_id);
    std::fs::create_dir_all(&session_dir).unwrap();
    std::fs::write(session_dir.join("store.db"), b"").unwrap();

    let found = find_sqlite_store_db_for_session(&chats_dir, session_id)
        .await
        .unwrap();
    assert!(found.is_some());
    assert_eq!(found.unwrap(), session_dir.join("store.db"));
}

#[tokio::test]
async fn test_find_sqlite_store_db_for_session_returns_none_when_missing() {
    let temp = tempdir().unwrap();
    let chats_dir = temp.path().join("chats");
    std::fs::create_dir_all(chats_dir.join("hash-a").join("other-session")).unwrap();
    std::fs::write(
        chats_dir
            .join("hash-a")
            .join("other-session")
            .join("store.db"),
        b"",
    )
    .unwrap();

    let found = find_sqlite_store_db_for_session(&chats_dir, "missing-session")
        .await
        .unwrap();
    assert!(found.is_none());
}

#[tokio::test]
async fn test_find_acp_sessions_store_db_finds_session() {
    let temp = tempdir().unwrap();
    let acp_dir = temp.path().join("acp-sessions");
    let session_id = "33e32f56-flat-layout";
    let session_dir = acp_dir.join(session_id);
    std::fs::create_dir_all(&session_dir).unwrap();
    std::fs::write(session_dir.join("store.db"), b"").unwrap();

    let found = find_acp_sessions_store_db_for_session(&acp_dir, session_id)
        .await
        .unwrap();
    assert_eq!(found, Some(session_dir.join("store.db")));
}

#[tokio::test]
async fn test_find_acp_sessions_store_db_returns_none_when_missing() {
    let temp = tempdir().unwrap();
    let acp_dir = temp.path().join("acp-sessions");
    std::fs::create_dir_all(acp_dir.join("other-session")).unwrap();
    std::fs::write(acp_dir.join("other-session").join("store.db"), b"").unwrap();

    let found = find_acp_sessions_store_db_for_session(&acp_dir, "missing-session")
        .await
        .unwrap();
    assert!(found.is_none());
}

#[tokio::test]
async fn test_find_acp_sessions_store_db_returns_none_when_dir_absent() {
    let temp = tempdir().unwrap();
    let acp_dir = temp.path().join("acp-sessions-does-not-exist");

    let found = find_acp_sessions_store_db_for_session(&acp_dir, "any-session")
        .await
        .unwrap();
    assert!(found.is_none());
}
