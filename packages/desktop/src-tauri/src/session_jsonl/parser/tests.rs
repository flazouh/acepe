use super::*;
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::{ContentBlock, HistoryEntry, SessionMessage, StoredEntry};
use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tempfile::TempDir;

use super::scan::{extract_session_id_from_file, find_session_file_in};
use super::text_utils::{is_valid_uuid, parse_iso_timestamp_to_ms, path_to_slug};

// Helper to create a temporary .claude directory structure
fn setup_test_claude_dir() -> Result<(TempDir, PathBuf)> {
    let temp_dir = TempDir::new()?;
    let claude_dir = temp_dir.path().join(".claude");
    fs::create_dir_all(&claude_dir)?;
    fs::create_dir_all(claude_dir.join("projects"))?;
    Ok((temp_dir, claude_dir))
}

fn claude_home_test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct ClaudeHomeGuard {
    previous_value: Option<String>,
}

impl ClaudeHomeGuard {
    fn set(path: &Path) -> Self {
        let previous_value = std::env::var("CLAUDE_HOME").ok();
        std::env::set_var("CLAUDE_HOME", path);
        Self { previous_value }
    }
}

impl Drop for ClaudeHomeGuard {
    fn drop(&mut self) {
        if let Some(previous_value) = &self.previous_value {
            std::env::set_var("CLAUDE_HOME", previous_value);
        } else {
            std::env::remove_var("CLAUDE_HOME");
        }
    }
}

// Helper to override get_session_jsonl_root for testing
#[allow(dead_code)]
fn set_test_claude_dir(_claude_dir: &Path) {
    // We'll need to pass the directory through a different mechanism
    // For now, we'll use environment variable or a test-specific function
}

#[tokio::test]
async fn test_parse_iso_timestamp_to_ms() {
    // Test valid ISO timestamp
    let result = parse_iso_timestamp_to_ms("2025-12-16T19:53:41.812Z");
    assert!(result.is_ok());
    let timestamp = result.unwrap();
    assert!(timestamp > 0);

    // Test another format
    let result2 = parse_iso_timestamp_to_ms("2025-12-16T19:53:41Z");
    assert!(result2.is_ok());

    // Test invalid timestamp
    let result3 = parse_iso_timestamp_to_ms("invalid");
    assert!(result3.is_err());
}

#[tokio::test]
async fn test_extract_thread_metadata_agent_file() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    // Create an agent-*.jsonl file
    let file_path = projects_dir.join("agent-a123456.jsonl");
    let content = r#"{"parentUuid":null,"isSidechain":true,"userType":"external","cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440000","version":"2.0.70","gitBranch":"","agentId":"a123456","type":"user","message":{"role":"user","content":"Hello, this is a test message"},"uuid":"e21dc86d-d45f-46fd-9bb3-d46273217df2","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert_eq!(entry.session_id, "550e8400-e29b-41d4-a716-446655440000");
    assert_eq!(entry.project, "/Users/test");
    assert!(entry.display.contains("Hello"));
    assert!(entry.timestamp > 0);
}

#[tokio::test]
async fn test_extract_thread_metadata_uuid_file() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    // Create a UUID-named file
    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let file_path = projects_dir.join(format!("{}.jsonl", session_id));
    let content = r#"{"parentUuid":null,"isSidechain":true,"userType":"external","cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440000","version":"2.0.70","gitBranch":"","agentId":"a123456","type":"user","message":{"role":"user","content":"Test message"},"uuid":"e21dc86d-d45f-46fd-9bb3-d46273217df2","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert_eq!(entry.session_id, session_id);
}

#[tokio::test]
async fn test_extract_thread_metadata_empty_file() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    // Create an empty UUID-named file
    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let file_path = projects_dir.join(format!("{}.jsonl", session_id));
    fs::write(&file_path, "").unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert_eq!(entry.session_id, session_id);
    assert_eq!(entry.timestamp, 0);
}

#[tokio::test]
async fn test_extract_thread_metadata_warmup_message() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    let content = r#"{"parentUuid":null,"isSidechain":true,"userType":"external","cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440000","version":"2.0.70","gitBranch":"","agentId":"a123456","type":"user","message":{"role":"user","content":"Warmup"},"uuid":"e21dc86d-d45f-46fd-9bb3-d46273217df2","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // Sessions with only "Warmup" message should be skipped (return None)
    assert!(
        result.is_none(),
        "Sessions with only Warmup message should be skipped"
    );
}

#[tokio::test]
async fn test_extract_thread_metadata_long_display() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    let long_content = "a".repeat(150);
    let content = format!(
        r#"{{"parentUuid":null,"isSidechain":true,"userType":"external","cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440000","version":"2.0.70","gitBranch":"","agentId":"a123456","type":"user","message":{{"role":"user","content":"{}"}},"uuid":"e21dc86d-d45f-46fd-9bb3-d46273217df2","timestamp":"2025-12-16T19:53:41.812Z"}}"#,
        long_content
    );
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    // Should be truncated to 100 chars + "..."
    assert!(entry.display.len() <= 103);
    assert!(entry.display.ends_with("..."));
}

#[tokio::test]
async fn test_extract_thread_metadata_no_user_message_first() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // First message is assistant, second is user
    let content = r#"{"type":"assistant","message":{"role":"assistant","content":"Hello"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"This is the actual user message"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert!(entry.display.contains("actual user message"));
}

#[tokio::test]
async fn test_extract_thread_metadata_invalid_json() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    fs::write(&file_path, "invalid json content").unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn test_extract_thread_metadata_sync_matches_async_for_malformed_then_valid_user() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    let content = "not valid json\n{\"type\":\"user\",\"cwd\":\"/Users/test\",\"sessionId\":\"550e8400-e29b-41d4-a716-446655440000\",\"message\":{\"role\":\"user\",\"content\":\"Meaningful message\"},\"timestamp\":\"2025-12-16T19:53:41.812Z\"}";
    fs::write(&file_path, content).unwrap();

    let async_result = extract_thread_metadata(&file_path).await.unwrap();
    let sync_result = super::scan::extract_thread_metadata_sync_for_test(&file_path).unwrap();

    let async_entry = async_result.expect("async result should exist");
    let sync_entry = sync_result.expect("sync result should exist");

    assert_eq!(sync_entry.session_id, async_entry.session_id);
    assert_eq!(sync_entry.display, async_entry.display);
    assert_eq!(sync_entry.timestamp, async_entry.timestamp);
    assert_eq!(sync_entry.project, async_entry.project);
}

#[tokio::test]
async fn test_extract_thread_metadata_sync_missing_file_matches_async() {
    let file_path = PathBuf::from("/tmp/acepe-session-jsonl-does-not-exist.jsonl");

    let async_result = extract_thread_metadata(&file_path).await.unwrap();
    let sync_result = super::scan::extract_thread_metadata_sync_for_test(&file_path).unwrap();

    assert!(async_result.is_none());
    assert!(sync_result.is_none());
}

#[tokio::test]
async fn test_extract_thread_metadata_no_session_id() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("invalid.jsonl");
    let content = r#"{"type":"user","message":{"role":"user","content":"test"},"timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn test_extract_thread_metadata_content_array() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    let content = r#"{"parentUuid":null,"isSidechain":true,"userType":"external","cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440000","version":"2.0.70","gitBranch":"","agentId":"a123456","type":"user","message":{"role":"user","content":[{"type":"text","text":"Array content message"}]},"uuid":"e21dc86d-d45f-46fd-9bb3-d46273217df2","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert!(entry.display.contains("Array content message"));
}

#[tokio::test]
async fn test_extract_display_name_skips_meta_messages() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // First message is meta, second is meaningful user message
    let content = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Caveat: The messages below were generated by the user while running local commands."},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"This is the actual meaningful message"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert!(entry.display.contains("actual meaningful message"));
    assert!(!entry.display.contains("Caveat"));
}

#[tokio::test]
async fn test_extract_display_name_skips_slash_commands() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // First message is a slash command, second is meaningful
    let content = r#"{"type":"user","message":{"role":"user","content":"/cost"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"What is the cost of this operation?"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert!(entry.display.contains("cost of this operation"));
    assert!(!entry.display.starts_with("/"));
}

#[tokio::test]
async fn test_extract_display_name_skips_xml_command_tags() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // First message has XML command tags, second is meaningful
    let content = r#"{"type":"user","message":{"role":"user","content":"<command-name>/cost</command-name>\n<command-message>cost</command-message>"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"I need to understand the pricing"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert!(entry.display.contains("understand the pricing"));
    assert!(!entry.display.contains("<command-name>"));
}

#[tokio::test]
async fn test_extract_display_name_skips_command_output() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // First message is command output, second is meaningful
    let content = r#"{"type":"user","message":{"role":"user","content":"<local-command-stdout>You are currently using your subscription</local-command-stdout>"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"Thanks for the information"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert!(entry.display.contains("Thanks for the information"));
    assert!(!entry.display.contains("<local-command-stdout>"));
}

#[tokio::test]
async fn test_extract_display_name_finds_meaningful_message() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // Multiple meta/command messages, then meaningful message
    let content = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta message"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"/help"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}
{"type":"user","message":{"role":"user","content":"How do I implement authentication?"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:43.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert!(entry.display.contains("implement authentication"));
}

#[tokio::test]
async fn test_extract_display_name_handles_mixed_content() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // Mixed content: assistant, meta, command, then meaningful user message
    let content = r#"{"type":"assistant","message":{"role":"assistant","content":"Hello"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:40.812Z"}
{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"<command-name>/test</command-name>"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}
{"type":"user","message":{"role":"user","content":"Can you help me debug this issue?"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:43.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert!(entry.display.contains("help me debug"));
}

#[tokio::test]
async fn test_extract_display_name_fallback_to_project_name() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // Only meta and command messages, no meaningful content
    let content = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta message"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test/myproject","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"/cost"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // Sessions with no meaningful content should be skipped (return None)
    assert!(
        result.is_none(),
        "Sessions with only meta/command messages should be skipped"
    );
}

#[tokio::test]
async fn test_extract_display_name_fallback_untitled() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // Only meta/command messages, no project path
    let content = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"/help"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // Sessions with no meaningful content should be skipped (return None)
    assert!(
        result.is_none(),
        "Sessions with only meta/command messages should be skipped"
    );
}

#[tokio::test]
async fn test_extract_display_name_empty_content() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // Empty or whitespace-only content
    let content = r#"{"type":"user","message":{"role":"user","content":"   "},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // Sessions with only whitespace content should be skipped (return None)
    assert!(
        result.is_none(),
        "Sessions with only whitespace content should be skipped"
    );
}

#[tokio::test]
async fn test_extract_display_name_only_meta_messages() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // All messages are meta
    let content = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta 1"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta 2"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // Sessions with only meta messages should be skipped (return None)
    assert!(
        result.is_none(),
        "Sessions with only meta messages should be skipped"
    );
}

#[tokio::test]
async fn test_extract_display_name_only_commands() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    // All messages are commands
    let content = r#"{"type":"user","message":{"role":"user","content":"/cost"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"<command-name>/help</command-name>"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // Sessions with only command messages should be skipped (return None)
    assert!(
        result.is_none(),
        "Sessions with only command messages should be skipped"
    );
}

// =================================================================
// TDD TESTS: Sessions without meaningful content should be SKIPPED
// =================================================================
// These tests define the NEW expected behavior:
// Sessions that have no meaningful user content should return None
// instead of falling back to "Conversation in {project}" titles.

#[tokio::test]
async fn test_should_skip_session_with_only_warmup_message() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-warmup.jsonl");
    // Session with only "Warmup" message - should be skipped
    let content = r#"{"parentUuid":null,"isSidechain":true,"userType":"external","cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440000","version":"2.0.70","gitBranch":"","agentId":"a123456","type":"user","message":{"role":"user","content":"Warmup"},"uuid":"e21dc86d-d45f-46fd-9bb3-d46273217df2","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // NEW EXPECTED BEHAVIOR: Should return None (skip session)
    assert!(
        result.is_none(),
        "Sessions with only 'Warmup' message should be skipped"
    );
}

#[tokio::test]
async fn test_should_skip_session_with_only_meta_messages() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-meta.jsonl");
    // Session with only meta messages - should be skipped
    let content = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta 1"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta 2"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // NEW EXPECTED BEHAVIOR: Should return None (skip session)
    assert!(
        result.is_none(),
        "Sessions with only meta messages should be skipped"
    );
}

#[tokio::test]
async fn test_should_skip_session_with_only_slash_commands() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-commands.jsonl");
    // Session with only slash commands - should be skipped
    let content = r#"{"type":"user","message":{"role":"user","content":"/cost"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"/help"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // NEW EXPECTED BEHAVIOR: Should return None (skip session)
    assert!(
        result.is_none(),
        "Sessions with only slash commands should be skipped"
    );
}

#[tokio::test]
async fn test_should_skip_session_with_only_xml_commands() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-xml.jsonl");
    // Session with only XML command tags - should be skipped
    let content = r#"{"type":"user","message":{"role":"user","content":"<command-name>/cost</command-name>"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // NEW EXPECTED BEHAVIOR: Should return None (skip session)
    assert!(
        result.is_none(),
        "Sessions with only XML commands should be skipped"
    );
}

#[tokio::test]
async fn test_should_skip_session_with_only_whitespace_content() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-whitespace.jsonl");
    // Session with only whitespace content - should be skipped
    let content = r#"{"type":"user","message":{"role":"user","content":"   "},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // NEW EXPECTED BEHAVIOR: Should return None (skip session)
    assert!(
        result.is_none(),
        "Sessions with only whitespace content should be skipped"
    );
}

#[tokio::test]
async fn test_should_skip_session_with_mixed_unmeaningful_content() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-mixed.jsonl");
    // Session with mix of meta, commands, and warmup - no meaningful content
    let content = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta message"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"/cost"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}
{"type":"user","message":{"role":"user","content":"Warmup"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:43.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // NEW EXPECTED BEHAVIOR: Should return None (skip session)
    assert!(
        result.is_none(),
        "Sessions with only meta/commands/warmup should be skipped"
    );
}

#[tokio::test]
async fn test_should_not_skip_session_with_at_least_one_meaningful_message() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-valid.jsonl");
    // Session with unmeaningful messages followed by one meaningful message
    let content = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"Meta"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"user","message":{"role":"user","content":"/help"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}
{"type":"user","message":{"role":"user","content":"How do I fix this bug?"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:43.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    // Should NOT be skipped - has at least one meaningful message
    assert!(
        result.is_some(),
        "Sessions with at least one meaningful message should NOT be skipped"
    );
    let entry = result.unwrap();
    assert!(
        entry.display.contains("fix this bug"),
        "Display should show the meaningful message"
    );
}

#[tokio::test]
async fn test_scan_all_threads_empty() {
    // Test with no projects directory
    let (_temp_dir, _claude_dir) = setup_test_claude_dir().unwrap();

    // Temporarily override get_session_jsonl_root for this test
    // Since we can't easily mock it, we'll test the actual behavior
    // by creating the structure and using it
    // Test with empty projects directory - using integration test helper instead
    // This test is covered by test_scan_all_threads_empty_project
}

// Note: Testing scan_all_threads requires mocking get_session_jsonl_root
// which is difficult without dependency injection. We'll test the core logic
// through extract_thread_metadata which is the main function.

#[tokio::test]
async fn test_extract_session_id_from_file_uuid_filename() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let file_path = projects_dir.join(format!("{}.jsonl", session_id));
    fs::write(&file_path, "").unwrap();

    let result = extract_session_id_from_file(&file_path).await.unwrap();
    assert_eq!(result, Some(session_id.to_string()));
}

#[tokio::test]
async fn test_extract_session_id_from_file_uuid_filename_user_provided() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    // Test with the user-provided session ID
    let session_id = "5f4a93a0-e8fc-4272-a71d-f69a7f3a68fa";
    let file_path = projects_dir.join(format!("{}.jsonl", session_id));
    fs::write(&file_path, "").unwrap();

    let result = extract_session_id_from_file(&file_path).await.unwrap();
    assert_eq!(
        result,
        Some(session_id.to_string()),
        "Failed to parse user-provided session ID"
    );
}

#[test]
fn test_is_valid_uuid() {
    // Test valid UUIDs (with hyphens - standard format)
    assert!(
        is_valid_uuid("5f4a93a0-e8fc-4272-a71d-f69a7f3a68fa"),
        "User-provided session ID should be valid"
    );
    assert!(is_valid_uuid("550e8400-e29b-41d4-a716-446655440000"));
    assert!(is_valid_uuid("00000000-0000-0000-0000-000000000000"));

    // Test valid UUIDs (without hyphens - also accepted by uuid crate)
    assert!(
        is_valid_uuid("5f4a93a0e8fc4272a71df69a7f3a68fa"),
        "UUID without hyphens should also be valid"
    );

    // Test invalid UUIDs
    assert!(!is_valid_uuid("not-a-uuid"));
    assert!(!is_valid_uuid("5f4a93a0-e8fc-4272-a71d")); // Too short
    assert!(!is_valid_uuid("5f4a93a0-e8fc-4272-a71d-f69a7f3a68fa-extra")); // Too long
    assert!(!is_valid_uuid("5f4a93a0-e8fc-4272-a71d-f69a7f3a68fz")); // Invalid hex character
}

#[tokio::test]
async fn test_extract_session_id_from_file_agent_filename() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-a123456.jsonl");
    let content = r#"{"sessionId":"550e8400-e29b-41d4-a716-446655440000","type":"user"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_session_id_from_file(&file_path).await.unwrap();
    assert_eq!(
        result,
        Some("550e8400-e29b-41d4-a716-446655440000".to_string())
    );
}

#[tokio::test]
async fn test_extract_session_id_from_file_invalid() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("invalid.jsonl");
    fs::write(&file_path, "").unwrap();

    let result = extract_session_id_from_file(&file_path).await.unwrap();
    assert_eq!(result, None);
}

#[tokio::test]
async fn test_path_to_slug() {
    // Claude Code uses leading dash for absolute paths
    assert_eq!(path_to_slug("/Users/example"), "-Users-example");
    assert_eq!(
        path_to_slug("/Users/example/Documents"),
        "-Users-example-Documents"
    );
    assert_eq!(path_to_slug("Users-example"), "Users-example");
}

#[tokio::test]
async fn test_find_session_file_direct() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects");
    let project_slug = path_to_slug("/Users/test");
    let project_dir = projects_dir.join(&project_slug);
    fs::create_dir_all(&project_dir).unwrap();

    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let file_path = project_dir.join(format!("{}.jsonl", session_id));
    fs::write(&file_path, "test content").unwrap();

    // We need to mock get_session_jsonl_root for this test
    // For now, we'll test the logic indirectly
}

// Integration test helper that uses a custom claude directory
async fn test_scan_all_threads_with_dir(claude_dir: &Path) -> Result<Vec<HistoryEntry>> {
    let projects_dir = claude_dir.join("projects");
    if !projects_dir.exists() {
        return Ok(Vec::new());
    }

    let mut all_entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&projects_dir).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let project_slug = entry.file_name();
        let project_slug_str = project_slug.to_string_lossy();

        if project_slug_str.starts_with('.') {
            continue;
        }

        let project_path = entry.path();
        if !project_path.is_dir() {
            continue;
        }

        let mut project_read_dir = match tokio::fs::read_dir(&project_path).await {
            Ok(dir) => dir,
            Err(_) => continue,
        };

        while let Some(file_entry) = project_read_dir.next_entry().await? {
            let file_path = file_entry.path();
            if !file_entry.file_type().await?.is_file() {
                continue;
            }

            let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if !file_name.ends_with(".jsonl") {
                continue;
            }

            if let Ok(Some(mut entry)) = extract_thread_metadata(&file_path).await {
                if entry.project.is_empty() {
                    let project_path_str = if project_slug_str.starts_with('-') {
                        project_slug_str.replace('-', "/")
                    } else {
                        format!("/{}", project_slug_str.replace('-', "/"))
                    };
                    entry.project = project_path_str;
                }
                all_entries.push(entry);
            }
        }
    }

    all_entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(all_entries)
}

#[tokio::test]
async fn test_scan_all_threads_integration() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects");

    // Create test project folder
    let project_slug = path_to_slug("/Users/test");
    let project_dir = projects_dir.join(&project_slug);
    fs::create_dir_all(&project_dir).unwrap();

    // Create multiple thread files
    let file1 = project_dir.join("agent-a111111.jsonl");
    let content1 = r#"{"parentUuid":null,"isSidechain":true,"userType":"external","cwd":"/Users/test","sessionId":"11111111-1111-1111-1111-111111111111","version":"2.0.70","gitBranch":"","agentId":"a111111","type":"user","message":{"role":"user","content":"First message"},"uuid":"e21dc86d-d45f-46fd-9bb3-d46273217df2","timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file1, content1).unwrap();

    let file2 = project_dir.join("22222222-2222-2222-2222-222222222222.jsonl");
    let content2 = r#"{"parentUuid":null,"isSidechain":true,"userType":"external","cwd":"/Users/test","sessionId":"22222222-2222-2222-2222-222222222222","version":"2.0.70","gitBranch":"","agentId":"a222222","type":"user","message":{"role":"user","content":"Second message"},"uuid":"e21dc86d-d45f-46fd-9bb3-d46273217df2","timestamp":"2025-12-16T20:53:41.812Z"}"#;
    fs::write(&file2, content2).unwrap();

    // Test with custom directory
    let result = test_scan_all_threads_with_dir(&claude_dir).await.unwrap();
    assert_eq!(result.len(), 2);
    // Should be sorted by timestamp descending
    assert_eq!(result[0].session_id, "22222222-2222-2222-2222-222222222222");
    assert_eq!(result[1].session_id, "11111111-1111-1111-1111-111111111111");
}

#[tokio::test]
async fn test_scan_all_threads_hidden_files() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects");

    // Create hidden directory
    let hidden_dir = projects_dir.join(".hidden");
    fs::create_dir_all(&hidden_dir).unwrap();
    fs::write(hidden_dir.join("agent-a111111.jsonl"), "test").unwrap();

    // Create normal directory
    let project_slug = path_to_slug("/Users/test");
    let project_dir = projects_dir.join(&project_slug);
    fs::create_dir_all(&project_dir).unwrap();
    let file = project_dir.join("agent-a111111.jsonl");
    let content = r#"{"sessionId":"11111111-1111-1111-1111-111111111111","cwd":"/Users/test","type":"user","message":{"role":"user","content":"test"},"timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file, content).unwrap();

    let result = test_scan_all_threads_with_dir(&claude_dir).await.unwrap();
    // Should only find the non-hidden file
    assert_eq!(result.len(), 1);
}

#[tokio::test]
async fn test_scan_all_threads_empty_project() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects");

    let project_slug = path_to_slug("/Users/test");
    let project_dir = projects_dir.join(&project_slug);
    fs::create_dir_all(&project_dir).unwrap();
    // No files in project directory

    let result = test_scan_all_threads_with_dir(&claude_dir).await.unwrap();
    assert_eq!(result.len(), 0);
}

#[tokio::test]
#[ignore] // Ignore by default - requires real Claude history files
async fn test_real_file_with_summary() {
    // Test on a file that has a summary
    let file_path = PathBuf::from("/Users/example/.claude/projects/-Users-example-Documents-sample-repo/35c55ab2-7600-4a4c-946b-1e1473f80225.jsonl");

    if !file_path.exists() {
        println!("Test file does not exist, skipping test");
        return;
    }

    println!("\n=== Testing extract_thread_metadata ===");
    match extract_thread_metadata(&file_path).await {
        Ok(Some(entry)) => {
            println!("✓ Successfully extracted metadata:");
            println!("  Session ID: {}", entry.session_id);
            println!("  Title: {}", entry.display);
            println!("  Project: {}", entry.project);
            println!("  Timestamp: {}", entry.timestamp);

            // Verify it extracted the summary
            assert!(
                !entry.display.is_empty(),
                "Display name should not be empty"
            );
            if entry.display.contains("Conversation history") {
                println!("✓ Summary extraction working! Title: {}", entry.display);
            } else {
                println!(
                    "⚠ Title doesn't match expected summary, got: {}",
                    entry.display
                );
            }
        }
        Ok(None) => {
            panic!("Failed to extract metadata - returned None");
        }
        Err(e) => {
            panic!("Failed to extract metadata: {}", e);
        }
    }

    println!("\n=== Testing read_messages_from_file ===");
    match read_messages_from_file(&file_path).await {
        Ok(messages) => {
            println!("✓ Successfully parsed {} messages", messages.len());

            let user_count = messages
                .iter()
                .filter(|m| matches!(m, SessionMessage::Message(msg) if msg.message.role == "user"))
                .count();
            let assistant_count = messages.iter()
                .filter(|m| matches!(m, SessionMessage::Message(msg) if msg.message.role == "assistant"))
                .count();
            let queue_count = messages
                .iter()
                .filter(|m| matches!(m, SessionMessage::QueueOperation(_)))
                .count();

            println!("  User messages: {}", user_count);
            println!("  Assistant messages: {}", assistant_count);
            println!("  Queue operations: {}", queue_count);

            // Show first few messages
            println!("\nFirst 3 messages:");
            for (i, msg) in messages.iter().take(3).enumerate() {
                match msg {
                    SessionMessage::Message(m) => {
                        let preview = match &m.message.content.first() {
                            Some(ContentBlock::Text { text }) => {
                                if text.len() > 50 {
                                    format!("{}...", &text[..50])
                                } else {
                                    text.clone()
                                }
                            }
                            _ => "non-text content".to_string(),
                        };
                        println!("  [{}] {}: {}", i + 1, m.message.role, preview);
                    }
                    SessionMessage::QueueOperation(op) => {
                        println!("  [{}] QueueOperation: {}", i + 1, op.op_type);
                    }
                }
            }

            assert!(!messages.is_empty(), "Should have at least one message");
        }
        Err(e) => {
            panic!("Failed to read messages: {}", e);
        }
    }

    println!("\n=== All tests passed! ===");
}

#[tokio::test]
#[ignore] // Ignore by default - requires real Claude history files
async fn test_real_file_without_summary() {
    // Test on a file that might not have a summary
    let file_path = PathBuf::from("/Users/example/.claude/projects/-Users-example-Documents-sample-repo/037829eb-e264-4e3a-b60d-9eb303b2598d.jsonl");

    if !file_path.exists() {
        println!("Test file does not exist, skipping test");
        return;
    }

    println!("\n=== Testing file without summary ===");
    match extract_thread_metadata(&file_path).await {
        Ok(Some(entry)) => {
            println!("✓ Successfully extracted metadata:");
            println!("  Session ID: {}", entry.session_id);
            println!("  Title: {}", entry.display);
            println!("  Project: {}", entry.project);

            // Should fall back to user message or project name
            assert!(
                !entry.display.is_empty(),
                "Display name should not be empty"
            );
            println!("✓ Title extraction working: {}", entry.display);
        }
        Ok(None) => {
            panic!("Failed to extract metadata - returned None");
        }
        Err(e) => {
            panic!("Failed to extract metadata: {}", e);
        }
    }
}

#[tokio::test]
#[ignore] // Ignore by default - requires real Claude history files
async fn test_most_recent_session() {
    // Test on the most recent session file
    let file_path = PathBuf::from("/Users/example/.claude/projects/-Users-example-Documents-fluentai/038e127d-239a-4aad-baf7-f7ade1438f7f.jsonl");

    if !file_path.exists() {
        println!("Test file does not exist, skipping test");
        return;
    }

    println!("\n=== Testing Most Recent Session ===");
    println!("File: {}", file_path.display());

    // Test metadata extraction
    println!("\n--- Testing extract_thread_metadata ---");
    let metadata = match extract_thread_metadata(&file_path).await {
        Ok(Some(entry)) => {
            println!("✓ Successfully extracted metadata:");
            println!("  Session ID: {}", entry.session_id);
            println!("  Display Name: {}", entry.display);
            println!("  Project: {}", entry.project);
            println!(
                "  Timestamp: {} ({})",
                entry.timestamp,
                chrono::DateTime::from_timestamp_millis(entry.timestamp)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
                    .unwrap_or_else(|| "invalid".to_string())
            );

            assert!(
                !entry.display.is_empty(),
                "Display name should not be empty"
            );
            assert!(
                !entry.session_id.is_empty(),
                "Session ID should not be empty"
            );
            entry
        }
        Ok(None) => {
            panic!("Failed to extract metadata - returned None");
        }
        Err(e) => {
            panic!("Failed to extract metadata: {}", e);
        }
    };

    // Test message reading
    println!("\n--- Testing read_messages_from_file ---");
    let messages = match read_messages_from_file(&file_path).await {
        Ok(messages) => messages,
        Err(e) => {
            panic!("Failed to read messages: {}", e);
        }
    };

    // Count by type
    let user_count = messages
        .iter()
        .filter(|m| matches!(m, SessionMessage::Message(msg) if msg.message.role == "user"))
        .count();
    let assistant_count = messages
        .iter()
        .filter(|m| matches!(m, SessionMessage::Message(msg) if msg.message.role == "assistant"))
        .count();
    let queue_count = messages
        .iter()
        .filter(|m| matches!(m, SessionMessage::QueueOperation(_)))
        .count();
    let conversation_messages = user_count + assistant_count;

    println!("✓ Successfully parsed {} total messages", messages.len());
    println!("\n  Message breakdown:");
    println!("    User messages: {}", user_count);
    println!("    Assistant messages: {}", assistant_count);
    println!("    Queue operations (will be filtered): {}", queue_count);
    println!("    Total conversation messages: {}", conversation_messages);

    // Count tool calls
    let mut tool_use_count = 0;
    let mut tool_result_count = 0;
    let mut tool_calls_with_results: Vec<serde_json::Value> = Vec::new();

    // Build a map of tool_use_id -> tool_result for pairing
    use std::collections::HashMap;
    let mut tool_results_map: HashMap<String, &SessionMessage> = HashMap::new();
    let mut tool_uses: Vec<(usize, &SessionMessage)> = Vec::new();

    for (idx, msg) in messages.iter().enumerate() {
        if let SessionMessage::Message(m) = msg {
            for content_block in &m.message.content {
                match content_block {
                    ContentBlock::ToolUse {
                        id: _,
                        name: _,
                        input: _,
                    } => {
                        tool_use_count += 1;
                        tool_uses.push((idx, msg));
                    }
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content: _,
                    } => {
                        tool_result_count += 1;
                        tool_results_map.insert(tool_use_id.clone(), msg);
                    }
                    _ => {}
                }
            }
        }
    }

    // Pair up tool uses with their results
    for (idx, tool_use_msg) in tool_uses.iter().take(5) {
        if let SessionMessage::Message(m) = tool_use_msg {
            let mut tool_uses_in_msg = Vec::new();
            let mut tool_results_in_msg = Vec::new();

            for content_block in &m.message.content {
                if let ContentBlock::ToolUse { id, name, input } = content_block {
                    tool_uses_in_msg.push(json!({
                        "id": id,
                        "name": name,
                        "input": input,
                    }));

                    // Find matching result
                    if let Some(SessionMessage::Message(rm)) = tool_results_map.get(id) {
                        for result_block in &rm.message.content {
                            if let ContentBlock::ToolResult {
                                tool_use_id,
                                content,
                            } = result_block
                            {
                                if tool_use_id == id {
                                    tool_results_in_msg.push(json!({
                                        "tool_use_id": tool_use_id,
                                        "content": content,
                                    }));
                                }
                            }
                        }
                    }
                }
            }

            if !tool_uses_in_msg.is_empty() {
                tool_calls_with_results.push(json!({
                    "message_index": idx + 1,
                    "message_uuid": m.uuid,
                    "message_timestamp": m.timestamp,
                    "tool_uses": tool_uses_in_msg,
                    "tool_results": tool_results_in_msg,
                }));
            }
        }
    }

    // Build JSON result with full content
    use serde_json::json;
    let result = json!({
        "file": file_path.to_string_lossy(),
        "metadata": {
            "session_id": metadata.session_id,
            "display_name": metadata.display,
            "project": metadata.project,
            "timestamp": metadata.timestamp,
            "timestamp_formatted": chrono::DateTime::from_timestamp_millis(metadata.timestamp)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
                .unwrap_or_else(|| "invalid".to_string()),
        },
        "messages": {
            "total": messages.len(),
            "user": user_count,
            "assistant": assistant_count,
            "queue_operations": queue_count,
            "conversation_messages": conversation_messages,
            "tool_uses": tool_use_count,
            "tool_results": tool_result_count,
        },
        "sample_messages": {
            "first_5": messages.iter().take(5).enumerate().map(|(i, msg)| {
                match msg {
                    SessionMessage::Message(m) => {
                        let mut content_blocks = Vec::new();
                        for block in &m.message.content {
                            match block {
                                ContentBlock::Text { text } => {
                                    content_blocks.push(json!({
                                        "type": "text",
                                        "text": text,
                                        "text_length": text.len(),
                                        "preview": if text.len() > 200 {
                                            format!("{}...", &text[..200])
                                        } else {
                                            text.clone()
                                        },
                                    }));
                                }
                                ContentBlock::ToolUse { id, name, input } => {
                                    content_blocks.push(json!({
                                        "type": "tool_use",
                                        "id": id,
                                        "name": name,
                                        "input": input,
                                    }));
                                }
                                ContentBlock::ToolResult { tool_use_id, content } => {
                                    content_blocks.push(json!({
                                        "type": "tool_result",
                                        "tool_use_id": tool_use_id,
                                        "content": content,
                                        "content_length": content.len(),
                                    }));
                                }
                                ContentBlock::Thinking { thinking, signature } => {
                                    content_blocks.push(json!({
                                        "type": "thinking",
                                        "thinking": thinking,
                                        "signature": signature,
                                        "thinking_length": thinking.len(),
                                    }));
                                }
                                ContentBlock::CodeAttachment { path, lines, content } => {
                                    content_blocks.push(json!({
                                        "type": "code_attachment",
                                        "path": path,
                                        "lines": lines,
                                        "content_length": content.len(),
                                    }));
                                }
                            }
                        }
                        json!({
                            "index": i + 1,
                            "type": "message",
                            "role": m.message.role,
                            "uuid": m.uuid,
                            "timestamp": m.timestamp,
                            "content_blocks": content_blocks,
                            "content_blocks_count": content_blocks.len(),
                        })
                    }
                    SessionMessage::QueueOperation(op) => {
                        json!({
                            "index": i + 1,
                            "type": "queue_operation",
                            "op_type": op.op_type,
                            "filtered": true,
                        })
                    }
                }
            }).collect::<Vec<_>>(),
            "last_3": messages.iter().rev().take(3).enumerate().map(|(i, msg)| {
                let idx = messages.len() - i;
                match msg {
                    SessionMessage::Message(m) => {
                        let mut content_blocks = Vec::new();
                        for block in &m.message.content {
                            match block {
                                ContentBlock::Text { text } => {
                                    content_blocks.push(json!({
                                        "type": "text",
                                        "text": text,
                                        "text_length": text.len(),
                                        "preview": if text.len() > 200 {
                                            format!("{}...", &text[..200])
                                        } else {
                                            text.clone()
                                        },
                                    }));
                                }
                                ContentBlock::ToolUse { id, name, input } => {
                                    content_blocks.push(json!({
                                        "type": "tool_use",
                                        "id": id,
                                        "name": name,
                                        "input": input,
                                    }));
                                }
                                ContentBlock::ToolResult { tool_use_id, content } => {
                                    content_blocks.push(json!({
                                        "type": "tool_result",
                                        "tool_use_id": tool_use_id,
                                        "content": content,
                                        "content_length": content.len(),
                                    }));
                                }
                                ContentBlock::Thinking { thinking, signature } => {
                                    content_blocks.push(json!({
                                        "type": "thinking",
                                        "thinking": thinking,
                                        "signature": signature,
                                        "thinking_length": thinking.len(),
                                    }));
                                }
                                ContentBlock::CodeAttachment { path, lines, content } => {
                                    content_blocks.push(json!({
                                        "type": "code_attachment",
                                        "path": path,
                                        "lines": lines,
                                        "content_length": content.len(),
                                    }));
                                }
                            }
                        }
                        json!({
                            "index": idx,
                            "type": "message",
                            "role": m.message.role,
                            "uuid": m.uuid,
                            "timestamp": m.timestamp,
                            "content_blocks": content_blocks,
                            "content_blocks_count": content_blocks.len(),
                        })
                    }
                    SessionMessage::QueueOperation(op) => {
                        json!({
                            "index": idx,
                            "type": "queue_operation",
                            "op_type": op.op_type,
                            "filtered": true,
                        })
                    }
                }
            }).collect::<Vec<_>>(),
        },
        "tool_calls": {
            "total_tool_uses": tool_use_count,
            "total_tool_results": tool_result_count,
            "sample_tool_calls": tool_calls_with_results,
        }
    });

    // Output JSON to file
    let json_output = serde_json::to_string_pretty(&result).unwrap();
    let output_file = std::env::temp_dir().join("claude_parser_test_result.json");
    std::fs::write(&output_file, &json_output).unwrap();

    println!("\n✓ JSON result written to: {}", output_file.display());
    println!("\n=== JSON Result ===");
    println!("{}", json_output);

    assert!(!messages.is_empty(), "Should have at least one message");
    assert!(
        conversation_messages > 0,
        "Should have at least one conversation message"
    );

    println!(
        "\n✓ Parser test passed! Filtered {} queue operations, kept {} conversation messages",
        queue_count, conversation_messages
    );
}

/// Test that process_cached_entry_for_project corrects mismatched project paths.
///
/// This is a regression test for a bug where cached entries with
/// stale project paths (from the cwd field) were returned as-is
/// without being corrected to the database project path.
#[test]
fn test_process_cached_entry_for_project_corrects_mismatch() {
    // Create an entry with a "wrong" project path (from cwd subdirectory)
    let cached_entry = HistoryEntry {
        id: "test-id".to_string(),
        display: "Test conversation".to_string(),
        timestamp: 1234567890,
        project: "/Users/test/Documents/project/subdir".to_string(), // Wrong - from cwd
        session_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        pasted_contents: serde_json::json!({}),
        agent_id: CanonicalAgentId::ClaudeCode,
        updated_at: 1234567890,
        source_path: None,
        parent_id: None,
        worktree_path: None,
        pr_number: None,
        worktree_deleted: None,
        session_lifecycle_state: Some(crate::db::repository::SessionLifecycleState::Persisted),
        sequence_id: None,
    };

    let expected_project = "/Users/test/Documents/project"; // Correct - from database

    // Process the cached entry with the expected project path
    let result = process_cached_entry_for_project(cached_entry.clone(), expected_project);

    // Verify the project was corrected
    assert_eq!(
        result.project, expected_project,
        "process_cached_entry_for_project should override project to expected value"
    );

    // Other fields should remain unchanged
    assert_eq!(result.id, cached_entry.id);
    assert_eq!(result.session_id, cached_entry.session_id);
    assert_eq!(result.display, cached_entry.display);
    assert_eq!(result.timestamp, cached_entry.timestamp);
}

/// Test that process_cached_entry_for_project doesn't modify matching paths.
#[test]
fn test_process_cached_entry_for_project_no_change_when_matching() {
    let project_path = "/Users/test/Documents/project";
    let cached_entry = HistoryEntry {
        id: "test-id".to_string(),
        display: "Test conversation".to_string(),
        timestamp: 1234567890,
        project: project_path.to_string(), // Already correct
        session_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        pasted_contents: serde_json::json!({}),
        agent_id: CanonicalAgentId::ClaudeCode,
        updated_at: 1234567890,
        source_path: None,
        parent_id: None,
        worktree_path: None,
        pr_number: None,
        worktree_deleted: None,
        session_lifecycle_state: Some(crate::db::repository::SessionLifecycleState::Persisted),
        sequence_id: None,
    };

    let result = process_cached_entry_for_project(cached_entry.clone(), project_path);

    // Should remain unchanged
    assert_eq!(result.project, project_path);
}

/// Full integration test demonstrating the cache bug scenario.
#[tokio::test]
async fn test_cache_hit_project_path_override_scenario() {
    use crate::session_jsonl::cache::{get_cache, invalidate_cache};

    // Setup: Create a temp directory structure mimicking Claude's layout
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();

    let parent_project_path = "/Users/test/Documents/project";
    let parent_slug = path_to_slug(parent_project_path);
    let parent_project_dir = claude_dir.join("projects").join(&parent_slug);
    fs::create_dir_all(&parent_project_dir).unwrap();

    // Create a session file with cwd pointing to a SUBDIRECTORY
    let subdirectory_path = "/Users/test/Documents/project/subdir";
    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let file_path = parent_project_dir.join(format!("{}.jsonl", session_id));
    let content = format!(
        r#"{{"parentUuid":null,"cwd":"{}","sessionId":"{}","type":"user","message":{{"role":"user","content":"Test message"}},"timestamp":"2025-12-16T19:53:41.812Z"}}"#,
        subdirectory_path, session_id
    );
    fs::write(&file_path, &content).unwrap();

    // Clear cache and extract metadata
    invalidate_cache().await;
    let metadata = extract_thread_metadata(&file_path).await.unwrap().unwrap();
    assert_eq!(
        metadata.project, subdirectory_path,
        "extract_thread_metadata uses cwd from file"
    );

    // Insert into cache (simulating scan_all_threads behavior)
    let cache = get_cache();
    let file_meta = tokio::fs::metadata(&file_path).await.unwrap();
    cache
        .insert(
            file_path.clone(),
            metadata.clone(),
            file_meta.modified().unwrap(),
            file_meta.len(),
        )
        .await;

    // Get cached entry
    let cached = cache.check_file(&file_path).await.unwrap();
    assert_eq!(
        cached.project, subdirectory_path,
        "Cached entry has wrong project (from cwd)"
    );

    // THE FIX: Use process_cached_entry_for_project to correct the project path
    let corrected = process_cached_entry_for_project(cached, parent_project_path);
    assert_eq!(
        corrected.project, parent_project_path,
        "After fix: project should be corrected to database project path"
    );

    invalidate_cache().await;
}

#[tokio::test]
async fn test_scan_projects_streaming_emits_entries_progressively_per_project() {
    use crate::session_jsonl::cache::invalidate_cache;

    let lock = claude_home_test_lock().lock().unwrap();
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let project_path = "/Users/test/project".to_string();
    let project_slug = path_to_slug(&project_path);
    let project_dir = claude_dir.join("projects").join(&project_slug);
    fs::create_dir_all(&project_dir).unwrap();

    let newer_session_id = "11111111-1111-1111-1111-111111111111";
    let older_session_id = "22222222-2222-2222-2222-222222222222";

    let older_file = project_dir.join(format!("{}.jsonl", older_session_id));
    let newer_file = project_dir.join(format!("{}.jsonl", newer_session_id));

    fs::write(
        &older_file,
        format!(
            r#"{{"type":"user","cwd":"{}","sessionId":"{}","message":{{"role":"user","content":"older"}},"timestamp":"2025-12-16T19:53:41.812Z"}}"#,
            project_path, older_session_id
        ),
    )
    .unwrap();
    fs::write(
        &newer_file,
        format!(
            r#"{{"type":"user","cwd":"{}","sessionId":"{}","message":{{"role":"user","content":"newer"}},"timestamp":"2025-12-16T20:53:41.812Z"}}"#,
            project_path, newer_session_id
        ),
    )
    .unwrap();
    let _claude_home = ClaudeHomeGuard::set(&claude_dir);
    drop(lock);
    invalidate_cache().await;

    let mut emitted_ids = Vec::new();
    let entries = scan_projects_streaming(std::slice::from_ref(&project_path), |entry| {
        emitted_ids.push(entry.session_id.clone());
    })
    .await
    .unwrap();

    invalidate_cache().await;

    let returned_ids: Vec<String> = entries
        .iter()
        .map(|entry| entry.session_id.clone())
        .collect();
    assert_eq!(
        returned_ids,
        vec![newer_session_id.to_string(), older_session_id.to_string()]
    );
    assert_eq!(emitted_ids.len(), returned_ids.len());
    assert!(emitted_ids.contains(&newer_session_id.to_string()));
    assert!(emitted_ids.contains(&older_session_id.to_string()));
}

/// Test that find_session_file returns immediately when direct path exists.
/// This verifies O(1) lookup behavior - no scanning of other files.
#[tokio::test]
async fn test_find_session_file_direct_path_no_scanning() {
    let lock = claude_home_test_lock().lock().unwrap();
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let project_path = "/Users/test/project";
    let project_slug = path_to_slug(project_path);
    let project_dir = claude_dir.join("projects").join(&project_slug);
    fs::create_dir_all(&project_dir).unwrap();

    // Create the target session file with valid content
    let session_id = "e7c7842a-1374-42ba-b7bc-8898f0d3e9f9";
    let target_file = project_dir.join(format!("{}.jsonl", session_id));
    let content = format!(
        r#"{{"sessionId":"{}","type":"user","message":{{"role":"user","content":"test"}},"timestamp":"2025-01-01T00:00:00Z"}}"#,
        session_id
    );
    fs::write(&target_file, content).unwrap();

    // Create many other session files that should NOT be scanned
    for i in 0..100 {
        let other_file = project_dir.join(format!("agent-{}.jsonl", i));
        // Write invalid content - if these are scanned, they would cause errors
        fs::write(&other_file, "INVALID_JSON_SHOULD_NOT_BE_PARSED").unwrap();
    }
    let _claude_home = ClaudeHomeGuard::set(&claude_dir);
    drop(lock);

    // Call find_session_file - it should return immediately without scanning agent-* files
    let result = find_session_file(session_id, project_path).await;

    assert!(result.is_ok(), "find_session_file should succeed");
    let found_path = result.unwrap();
    assert_eq!(
        found_path, target_file,
        "Should find the direct path without scanning other files"
    );
}

/// Test that parse_converted_session only reads the specific session file.
#[tokio::test]
async fn test_parse_converted_session_single_file_read() {
    let lock = claude_home_test_lock().lock().unwrap();
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let project_path = "/Users/test/project";
    let project_slug = path_to_slug(project_path);
    let project_dir = claude_dir.join("projects").join(&project_slug);
    fs::create_dir_all(&project_dir).unwrap();

    // Create a valid session file
    let session_id = "f8a7b6c5-d4e3-42f1-a0b9-c8d7e6f5a4b3";
    let target_file = project_dir.join(format!("{}.jsonl", session_id));
    let content = format!(
        r#"{{"sessionId":"{}","type":"user","uuid":"msg-1","message":{{"role":"user","content":"Hello"}},"timestamp":"2025-01-01T00:00:00Z"}}
{{"sessionId":"{}","type":"assistant","uuid":"msg-2","parentUuid":"msg-1","message":{{"role":"assistant","content":"Hi there!"}},"timestamp":"2025-01-01T00:00:01Z"}}"#,
        session_id, session_id
    );
    fs::write(&target_file, content).unwrap();

    // Create many other files that should NOT be accessed
    for i in 0..50 {
        let other_file = project_dir.join(format!(
            "{}-{}-{}-{}-{i:012}.jsonl",
            uuid::Uuid::new_v4()
                .as_hyphenated()
                .to_string()
                .split('-')
                .next()
                .unwrap(),
            "0000",
            "0000",
            "0000",
        ));
        fs::write(&other_file, "INVALID").unwrap();
    }
    let _claude_home = ClaudeHomeGuard::set(&claude_dir);
    drop(lock);

    // Call parse_converted_session
    let result = parse_converted_session(session_id, project_path).await;

    assert!(
        result.is_ok(),
        "parse_converted_session should succeed: {:?}",
        result.err()
    );
    let session = result.unwrap();
    assert_eq!(session.entries.len(), 2, "Should have 2 messages");
}

/// Regression test: Claude transcripts can split one assistant response into
/// multiple JSONL lines (same message.id/requestId). We should merge these
/// fragments into one assistant entry.
#[tokio::test]
async fn test_parse_converted_session_merges_fragmented_assistant_response() {
    let lock = claude_home_test_lock().lock().unwrap();
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let project_path = "/Users/test/project";
    let project_slug = path_to_slug(project_path);
    let project_dir = claude_dir.join("projects").join(&project_slug);
    fs::create_dir_all(&project_dir).unwrap();

    let session_id = "11111111-2222-4333-8444-555555555555";
    let session_file = project_dir.join(format!("{}.jsonl", session_id));

    let content = format!(
        r#"{{"sessionId":"{}","type":"user","uuid":"u1","message":{{"role":"user","content":"Start"}},"timestamp":"2025-01-01T00:00:00Z"}}
{{"sessionId":"{}","type":"assistant","uuid":"a1","parentUuid":"u1","requestId":"req-1","message":{{"id":"msg-1","type":"message","role":"assistant","content":[{{"type":"text","text":"We just now, JUST now, got Next Steps"}}]}},"timestamp":"2025-01-01T00:00:01Z"}}
{{"sessionId":"{}","type":"assistant","uuid":"a2","parentUuid":"a1","requestId":"req-1","message":{{"id":"msg-1","type":"message","role":"assistant","content":[{{"type":"text","text":"Test in browser - Visit /blog and /blog/attention-queue"}}]}},"timestamp":"2025-01-01T00:00:02Z"}}
{{"sessionId":"{}","type":"assistant","uuid":"a3","parentUuid":"a2","requestId":"req-1","message":{{"id":"msg-1","type":"message","role":"assistant","content":[{{"type":"text","text":"Ready to ship!"}}]}},"timestamp":"2025-01-01T00:00:03Z"}}
{{"sessionId":"{}","type":"user","uuid":"u2","parentUuid":"a3","message":{{"role":"user","content":"Thanks"}},"timestamp":"2025-01-01T00:00:04Z"}}"#,
        session_id, session_id, session_id, session_id, session_id
    );
    fs::write(&session_file, content).unwrap();
    let _claude_home = ClaudeHomeGuard::set(&claude_dir);
    drop(lock);
    let result = parse_converted_session(session_id, project_path).await;

    assert!(
        result.is_ok(),
        "parse_converted_session should succeed: {:?}",
        result.err()
    );
    let converted = result.unwrap();

    let assistant_count = converted
        .entries
        .iter()
        .filter(|entry| matches!(entry, StoredEntry::Assistant { .. }))
        .count();

    assert_eq!(
        assistant_count, 1,
        "Fragmented assistant response should merge into a single assistant entry"
    );
}

// ============================================
// Agent ID Normalization Tests
// ============================================

#[tokio::test]
async fn test_agent_id_normalization_7_char_hex() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    // Create a file with 7-char hex agentId (common in Claude CLI)
    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let file_path = projects_dir.join(format!("{}.jsonl", session_id));
    let content = r#"{"parentUuid":null,"cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440000","agentId":"ab46dbc","type":"user","message":{"role":"user","content":"Test message"},"timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert_eq!(
        entry.agent_id,
        CanonicalAgentId::ClaudeCode,
        "We're in session_jsonl parser, so agent_id is always ClaudeCode"
    );
}

#[tokio::test]
async fn test_agent_id_normalization_8_char_hex() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    // Create a file with 8-char hex agentId (also common in Claude CLI)
    let session_id = "550e8400-e29b-41d4-a716-446655440001";
    let file_path = projects_dir.join(format!("{}.jsonl", session_id));
    let content = r#"{"parentUuid":null,"cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440001","agentId":"014d0ce4","type":"user","message":{"role":"user","content":"Test message"},"timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert_eq!(
        entry.agent_id,
        CanonicalAgentId::ClaudeCode,
        "We're in session_jsonl parser, so agent_id is always ClaudeCode"
    );
}

// Note: These normalization tests are no longer relevant since we set the enum directly
// based on parser context. All session_jsonl parser entries are CanonicalAgentId::ClaudeCode.
// Tests for other agents would be in their respective parser test modules.

#[tokio::test]
async fn test_agent_id_normalization_missing_defaults_to_claude_code() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    // Create a file without agentId field - should default to "claude-code"
    let session_id = "550e8400-e29b-41d4-a716-446655440005";
    let file_path = projects_dir.join(format!("{}.jsonl", session_id));
    let content = r#"{"parentUuid":null,"cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440005","type":"user","message":{"role":"user","content":"Test message"},"timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert_eq!(
        entry.agent_id,
        CanonicalAgentId::ClaudeCode,
        "We're in session_jsonl parser, so agent_id is always ClaudeCode"
    );
}

#[tokio::test]
async fn test_agent_id_normalization_claude_string() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    // Create a file with "claude" agentId - we're in session_jsonl parser, so it's always ClaudeCode
    let session_id = "550e8400-e29b-41d4-a716-446655440006";
    let file_path = projects_dir.join(format!("{}.jsonl", session_id));
    let content = r#"{"parentUuid":null,"cwd":"/Users/test","sessionId":"550e8400-e29b-41d4-a716-446655440006","agentId":"claude","type":"user","message":{"role":"user","content":"Test message"},"timestamp":"2025-12-16T19:53:41.812Z"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    assert_eq!(
        entry.agent_id,
        CanonicalAgentId::ClaudeCode,
        "We're in session_jsonl parser, so agent_id is always ClaudeCode"
    );
}

#[tokio::test]
async fn test_extract_display_name_prefers_summary_entry() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-with-summary.jsonl");
    // Session with user message AND a summary entry — uses first user message for speed
    let content = r#"{"type":"user","message":{"role":"user","content":"hi"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"assistant","message":{"role":"assistant","content":"Hello! How can I help?"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:42.812Z"}
{"type":"summary","summary":"Session Title From Claude","leafUuid":"abc123"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    // Uses first user message (not summary) — avoids reading entire file
    assert_eq!(
        entry.display, "hi",
        "Should use first user message for fast scanning"
    );
}

#[tokio::test]
async fn test_extract_display_name_uses_first_user_message() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects").join("test-project");
    fs::create_dir_all(&projects_dir).unwrap();

    let file_path = projects_dir.join("agent-multi-summary.jsonl");
    // Session with multiple messages — uses the first user message
    let content = r#"{"type":"user","message":{"role":"user","content":"first message"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/test","timestamp":"2025-12-16T19:53:41.812Z"}
{"type":"summary","summary":"First Title","leafUuid":"abc123"}
{"type":"user","message":{"role":"user","content":"second message"},"sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-12-16T19:53:43.812Z"}
{"type":"summary","summary":"Updated Title After More Work","leafUuid":"def456"}"#;
    fs::write(&file_path, content).unwrap();

    let result = extract_thread_metadata(&file_path).await.unwrap();
    assert!(result.is_some());
    let entry = result.unwrap();
    // Uses first user message, stops reading early
    assert_eq!(
        entry.display, "first message",
        "Should use first user message for fast scanning"
    );
}

// =================================================================
// TDD TESTS: find_session_file_in — slug fast path + scan fallback
// =================================================================

#[tokio::test]
async fn test_find_session_file_in_direct_slug_path() {
    // File exists at the slug-derived path → found on first try (O(1))
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects");

    let session_id = "550e8400-e29b-41d4-a716-446655440000";
    let project_path = "/Users/example/Documents/myproject";
    let slug = path_to_slug(project_path);
    let project_dir = projects_dir.join(&slug);
    fs::create_dir_all(&project_dir).unwrap();
    let expected = project_dir.join(format!("{}.jsonl", session_id));
    fs::write(&expected, "{}").unwrap();

    let result = find_session_file_in(session_id, project_path, &projects_dir)
        .await
        .unwrap();
    assert_eq!(result, expected);
}

#[tokio::test]
async fn test_find_session_file_in_scan_fallback_for_worktree() {
    // File exists in a different dir (worktree slug mismatch) → found via O(n) scan.
    // Reproduces the bug: worktree_path has dots, old code computed wrong slug,
    // so the direct lookup fails and scan must find it.
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects");

    let session_id = "08875fe0-1234-5678-abcd-ef1234567890";
    // Correct slug for /Users/example/.acepe/worktrees/abc/feat is
    // -Users-example--acepe-worktrees-abc-feat (dots become dashes)
    let correct_slug = "-Users-example--acepe-worktrees-abc-feat";
    let correct_dir = projects_dir.join(correct_slug);
    fs::create_dir_all(&correct_dir).unwrap();
    let expected = correct_dir.join(format!("{}.jsonl", session_id));
    fs::write(&expected, "{}").unwrap();

    // Call with a project_path whose slug does NOT match correct_slug,
    // simulating a lookup that must fall back to scanning.
    // (Any path whose slug differs from correct_slug will trigger the fallback.)
    let wrong_project_path = "/Users/example/.acepe/worktrees/abc/feat_WRONG";
    let result = find_session_file_in(session_id, wrong_project_path, &projects_dir)
        .await
        .unwrap();
    assert_eq!(result, expected);
}

#[tokio::test]
async fn test_find_session_file_in_not_found() {
    let (_temp_dir, claude_dir) = setup_test_claude_dir().unwrap();
    let projects_dir = claude_dir.join("projects");

    let result = find_session_file_in(
        "deadbeef-0000-0000-0000-000000000000",
        "/Users/example/no-such-project",
        &projects_dir,
    )
    .await;
    assert!(result.is_err(), "Should return Err when session not found");
}

#[test]
fn test_path_to_slug_replaces_dots_for_worktree_paths() {
    // Claude Code converts both '/' and '.' to '-' when computing project slugs.
    // Worktree paths like /Users/example/.acepe/... have dots that must become dashes
    // so that acepe looks in the correct ~/.claude/projects/ directory.
    //
    // Real case: worktree_path = /Users/example/.acepe/worktrees/6d4131f5197e/happy-canyon
    // Actual dir: ~/.claude/projects/-Users-example--acepe-worktrees-6d4131f5197e-happy-canyon/
    let slug = path_to_slug("/Users/example/.acepe/worktrees/6d4131f5197e/happy-canyon");
    assert_eq!(
        slug,
        "-Users-example--acepe-worktrees-6d4131f5197e-happy-canyon"
    );
}

#[test]
fn test_path_to_slug_regular_paths_unaffected() {
    // Paths without dots should produce the same slug as before.
    let slug = path_to_slug("/Users/example/Documents/acepe");
    assert_eq!(slug, "-Users-example-Documents-acepe");
}
