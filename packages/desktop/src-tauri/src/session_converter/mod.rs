//! Session converter module.
//!
//! Agent-specific entry points:
//! - claude/cursor/codex use FullSession conversion
//! - opencode uses OpenCode message conversion

use crate::acp::session_update::{TodoStatus, ToolCallData, ToolCallStatus, ToolCallUpdateData};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::opencode_history::types::OpenCodeMessage;
use crate::session_jsonl::types::{ConvertedSession, FullSession, StoredEntry};
use std::collections::HashMap;

mod claude;
mod codex;
mod cursor;
mod fullsession;
mod opencode;

#[cfg(test)]
use fullsession::parse_skill_meta_from_content;

pub fn convert_claude_full_session_to_entries(session: &FullSession) -> ConvertedSession {
    claude::convert_claude_full_session_to_entries(session)
}

pub fn convert_claude_full_session_to_thread_snapshot(
    session: &FullSession,
) -> SessionThreadSnapshot {
    claude::convert_claude_full_session_to_thread_snapshot(session)
}

pub fn convert_cursor_full_session_to_entries(session: &FullSession) -> ConvertedSession {
    cursor::convert_cursor_full_session_to_entries(session)
}

pub fn convert_cursor_full_session_to_thread_snapshot(
    session: &FullSession,
) -> SessionThreadSnapshot {
    cursor::convert_cursor_full_session_to_thread_snapshot(session)
}

#[allow(dead_code)]
pub fn convert_codex_full_session_to_entries(session: &FullSession) -> ConvertedSession {
    codex::convert_codex_full_session_to_entries(session)
}

#[allow(dead_code)]
pub fn convert_codex_full_session_to_thread_snapshot(
    session: &FullSession,
) -> SessionThreadSnapshot {
    codex::convert_codex_full_session_to_thread_snapshot(session)
}

pub fn convert_opencode_messages_to_session(
    messages: Vec<OpenCodeMessage>,
) -> Result<ConvertedSession, String> {
    opencode::convert_opencode_messages_to_session(messages)
}

fn parse_timestamp_to_millis(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

pub(crate) fn merge_tool_call_update(tool_call: &mut ToolCallData, update: &ToolCallUpdateData) {
    if let Some(status) = &update.status {
        if !is_terminal_tool_call_status(&tool_call.status) || is_terminal_tool_call_status(status)
        {
            tool_call.status = status.clone();
        }
    }

    if let Some(title) = &update.title {
        tool_call.title = Some(title.clone());
    }

    if let Some(locations) = &update.locations {
        tool_call.locations = Some(locations.clone());
    }

    if let Some(arguments) = update
        .arguments
        .as_ref()
        .or(update.streaming_arguments.as_ref())
    {
        tool_call.arguments = arguments.clone();
    }

    if tool_call.result.is_none() {
        if let Some(result) = &update.result {
            tool_call.result = Some(result.clone());
        }
    }

    if let Some(normalized_questions) = &update.normalized_questions {
        tool_call.normalized_questions = Some(normalized_questions.clone());
    }

    if let Some(normalized_todos) = &update.normalized_todos {
        tool_call.normalized_todos = Some(normalized_todos.clone());
    }
}

fn is_terminal_tool_call_status(status: &ToolCallStatus) -> bool {
    matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed)
}

pub fn calculate_todo_timing(entries: &mut [StoredEntry]) {
    let mut task_timings: HashMap<String, (Option<i64>, Option<i64>)> = HashMap::new();
    let mut previous_states: HashMap<String, TodoStatus> = HashMap::new();

    for entry in entries.iter() {
        if let StoredEntry::ToolCall {
            message, timestamp, ..
        } = entry
        {
            if let Some(todos) = &message.normalized_todos {
                let entry_timestamp = timestamp
                    .as_ref()
                    .and_then(|t| parse_timestamp_to_millis(t));

                for todo in todos {
                    let prev_status = previous_states.get(&todo.content);
                    let timing = task_timings
                        .entry(todo.content.clone())
                        .or_insert((None, None));

                    if todo.status == TodoStatus::InProgress
                        && prev_status != Some(&TodoStatus::InProgress)
                    {
                        timing.0 = entry_timestamp;
                    }

                    if todo.status == TodoStatus::Completed
                        && prev_status != Some(&TodoStatus::Completed)
                    {
                        timing.1 = entry_timestamp;
                    }

                    previous_states.insert(todo.content.clone(), todo.status);
                }
            }
        }
    }

    for entry in entries.iter_mut() {
        if let StoredEntry::ToolCall { message, .. } = entry {
            if let Some(todos) = &mut message.normalized_todos {
                for todo in todos.iter_mut() {
                    if let Some((started_at, completed_at)) = task_timings.get(&todo.content) {
                        todo.started_at = *started_at;
                        todo.completed_at = *completed_at;

                        if let (Some(start), Some(end)) = (started_at, completed_at) {
                            let duration = end - start;
                            if duration >= 0 {
                                todo.duration = Some(duration);
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::AgentParser;
    use crate::acp::parsers::ClaudeCodeParser;
    use crate::acp::session_update::{ToolArguments, ToolCallStatus, ToolKind};
    use crate::session_jsonl::types::{ContentBlock, OrderedMessage, SessionStats};

    fn create_test_full_session() -> FullSession {
        FullSession {
            session_id: "test-session-123".to_string(),
            project_path: "/test/project".to_string(),
            title: "Test Session".to_string(),
            created_at: "2025-01-01T00:00:00Z".to_string(),
            messages: vec![
                OrderedMessage {
                    uuid: "user-1".to_string(),
                    parent_uuid: None,
                    role: "user".to_string(),
                    timestamp: "2025-01-01T00:00:00Z".to_string(),
                    content_blocks: vec![ContentBlock::Text {
                        text: "Hello, world!".to_string(),
                    }],
                    model: None,
                    usage: None,
                    request_id: None,
                    is_meta: false,
                    source_tool_use_id: None,
                    tool_use_result: None,
                    source_tool_assistant_uuid: None,
                },
                OrderedMessage {
                    uuid: "assistant-1".to_string(),
                    parent_uuid: Some("user-1".to_string()),
                    role: "assistant".to_string(),
                    timestamp: "2025-01-01T00:00:01Z".to_string(),
                    content_blocks: vec![ContentBlock::Text {
                        text: "Hi there!".to_string(),
                    }],
                    model: Some("claude-opus-4-5-20251101".to_string()),
                    usage: None,
                    request_id: None,
                    is_meta: false,
                    source_tool_use_id: None,
                    tool_use_result: None,
                    source_tool_assistant_uuid: None,
                },
            ],
            stats: SessionStats {
                total_messages: 2,
                user_messages: 1,
                assistant_messages: 1,
                tool_uses: 0,
                tool_results: 0,
                thinking_blocks: 0,
                total_input_tokens: 10,
                total_output_tokens: 5,
            },
        }
    }

    #[test]
    fn test_convert_basic_session() {
        let full_session = create_test_full_session();
        let converted = convert_claude_full_session_to_entries(&full_session);

        assert_eq!(converted.title, "Test Session");
        assert_eq!(converted.entries.len(), 2);
        assert_eq!(converted.stats.total_messages, 2);

        // Check user entry
        match &converted.entries[0] {
            StoredEntry::User { id, message, .. } => {
                assert_eq!(id, "user-1");
                assert_eq!(message.content.text, Some("Hello, world!".to_string()));
            }
            _ => panic!("First entry should be user"),
        }

        // Check assistant entry
        match &converted.entries[1] {
            StoredEntry::Assistant { id, message, .. } => {
                assert_eq!(id, "assistant-1");
                assert_eq!(message.chunks.len(), 1);
                assert_eq!(message.model, Some("claude-opus-4-5-20251101".to_string()));
            }
            _ => panic!("Second entry should be assistant"),
        }
    }

    #[test]
    fn test_convert_session_with_tool_use() {
        let mut full_session = create_test_full_session();

        // Add a tool use to assistant message
        full_session.messages[1]
            .content_blocks
            .push(ContentBlock::ToolUse {
                id: "tool-1".to_string(),
                name: "read_file".to_string(),
                input: serde_json::json!({"path": "/test/file.txt"}),
            });

        // Add tool result to user message
        full_session.messages[0]
            .content_blocks
            .push(ContentBlock::ToolResult {
                tool_use_id: "tool-1".to_string(),
                content: "File contents".to_string(),
            });

        full_session.stats.tool_uses = 1;
        full_session.stats.tool_results = 1;

        let converted = convert_claude_full_session_to_entries(&full_session);

        // Should have user, assistant, and tool_call entries
        assert_eq!(converted.entries.len(), 3);

        // Find tool call entry
        let tool_entry = converted
            .entries
            .iter()
            .find(|e| matches!(e, StoredEntry::ToolCall { .. }))
            .expect("Should have tool call entry");

        match tool_entry {
            StoredEntry::ToolCall { id, message, .. } => {
                assert_eq!(id, "tool-1");
                assert_eq!(message.name, "Read");
                assert_eq!(message.status, ToolCallStatus::Completed);
                assert_eq!(
                    message.result,
                    Some(serde_json::Value::String("File contents".to_string()))
                );
                assert_eq!(message.kind, Some(ToolKind::Read));
            }
            _ => panic!("Should be tool call"),
        }
    }

    #[test]
    fn test_convert_session_with_thinking() {
        let mut full_session = create_test_full_session();

        // Add thinking block to assistant message
        full_session.messages[1].content_blocks.insert(
            0,
            ContentBlock::Thinking {
                thinking: "Let me think about this...".to_string(),
                signature: None,
            },
        );

        full_session.stats.thinking_blocks = 1;

        let converted = convert_claude_full_session_to_entries(&full_session);

        match &converted.entries[1] {
            StoredEntry::Assistant { message, .. } => {
                assert_eq!(message.chunks.len(), 2);
                // First chunk should be thought
                assert_eq!(message.chunks[0].chunk_type, "thought");
                assert_eq!(
                    message.chunks[0].block.text,
                    Some("Let me think about this...".to_string())
                );
                // Second chunk should be message
                assert_eq!(message.chunks[1].chunk_type, "message");
            }
            _ => panic!("Should be assistant entry"),
        }
    }

    #[test]
    fn test_convert_session_skips_meta_messages() {
        let mut full_session = create_test_full_session();

        // Add a meta message
        full_session.messages.push(OrderedMessage {
            uuid: "meta-1".to_string(),
            parent_uuid: None,
            role: "user".to_string(),
            timestamp: "2025-01-01T00:00:02Z".to_string(),
            content_blocks: vec![ContentBlock::Text {
                text: "Meta message".to_string(),
            }],
            model: None,
            usage: None,
            request_id: None,
            is_meta: true,
            source_tool_use_id: None,
            tool_use_result: None,
            source_tool_assistant_uuid: None,
        });

        let converted = convert_claude_full_session_to_entries(&full_session);

        // Meta message should be skipped
        assert_eq!(converted.entries.len(), 2);
        assert!(!converted
            .entries
            .iter()
            .any(|e| matches!(e, StoredEntry::User { id, .. } if id == "meta-1")));
    }

    #[test]
    fn test_convert_session_empty_user_message() {
        let mut full_session = create_test_full_session();

        // Add empty user message
        full_session.messages.insert(
            0,
            OrderedMessage {
                uuid: "empty-user".to_string(),
                parent_uuid: None,
                role: "user".to_string(),
                timestamp: "2025-01-01T00:00:00Z".to_string(),
                content_blocks: vec![],
                model: None,
                usage: None,
                request_id: None,
                is_meta: false,
                source_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
        );

        let converted = convert_claude_full_session_to_entries(&full_session);

        // Empty user message should be skipped
        assert_eq!(converted.entries.len(), 2);
        assert!(!converted
            .entries
            .iter()
            .any(|e| matches!(e, StoredEntry::User { id, .. } if id == "empty-user")));
    }

    #[test]
    fn test_detect_tool_kind() {
        assert_eq!(ClaudeCodeParser.detect_tool_kind("read"), ToolKind::Read);
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("read_file"),
            ToolKind::Read
        );
        assert_eq!(ClaudeCodeParser.detect_tool_kind("edit"), ToolKind::Edit);
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("edit_file"),
            ToolKind::Edit
        );
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("execute"),
            ToolKind::Execute
        );
        assert_eq!(ClaudeCodeParser.detect_tool_kind("bash"), ToolKind::Execute);
        assert_eq!(ClaudeCodeParser.detect_tool_kind("glob"), ToolKind::Glob);
        assert_eq!(ClaudeCodeParser.detect_tool_kind("grep"), ToolKind::Search);
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("webfetch"),
            ToolKind::Fetch
        );
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("websearch"),
            ToolKind::WebSearch
        );
        assert_eq!(ClaudeCodeParser.detect_tool_kind("task"), ToolKind::Task);
        assert_eq!(ClaudeCodeParser.detect_tool_kind("todo"), ToolKind::Todo);
        assert_eq!(ClaudeCodeParser.detect_tool_kind("move"), ToolKind::Move);
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("delete"),
            ToolKind::Delete
        );
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("exitplanmode"),
            ToolKind::ExitPlanMode
        );
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("unknown_tool"),
            ToolKind::Other
        );

        // Test MCP prefix stripping
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("mcp__acp__Bash"),
            ToolKind::Execute
        );
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("mcp__acp__Read"),
            ToolKind::Read
        );
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("mcp__acp__Edit"),
            ToolKind::Edit
        );
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("mcp__acp__Grep"),
            ToolKind::Search
        );
        assert_eq!(
            ClaudeCodeParser.detect_tool_kind("mcp__server__UnknownTool"),
            ToolKind::Other
        );
    }

    #[test]
    fn test_convert_opencode_basic_messages() {
        use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};

        let messages = vec![
            OpenCodeMessage {
                id: "user-1".to_string(),
                role: "user".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Hello, world!".to_string(),
                }],
                model: None,
                timestamp: Some("2025-01-01T00:00:00Z".to_string()),
            },
            OpenCodeMessage {
                id: "assistant-1".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Hi there!".to_string(),
                }],
                model: Some("claude-3-7-sonnet-20250219".to_string()),
                timestamp: Some("2025-01-01T00:00:01Z".to_string()),
            },
        ];

        let converted = convert_opencode_messages_to_session(messages).unwrap();

        assert_eq!(converted.entries.len(), 2);
        assert_eq!(converted.stats.total_messages, 2);
        assert_eq!(converted.stats.user_messages, 1);
        assert_eq!(converted.stats.assistant_messages, 1);

        // Check user entry
        match &converted.entries[0] {
            StoredEntry::User { id, message, .. } => {
                assert_eq!(id, "user-1");
                assert_eq!(message.content.text, Some("Hello, world!".to_string()));
            }
            _ => panic!("First entry should be user"),
        }

        // Check assistant entry
        match &converted.entries[1] {
            StoredEntry::Assistant { id, message, .. } => {
                assert_eq!(id, "assistant-1");
                assert_eq!(message.chunks.len(), 1);
                assert_eq!(
                    message.model,
                    Some("claude-3-7-sonnet-20250219".to_string())
                );
            }
            _ => panic!("Second entry should be assistant"),
        }
    }

    #[test]
    fn test_convert_opencode_with_tool_use() {
        use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};

        let messages = vec![
            OpenCodeMessage {
                id: "user-1".to_string(),
                role: "user".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Read a file".to_string(),
                }],
                model: None,
                timestamp: Some("2025-01-01T00:00:00Z".to_string()),
            },
            OpenCodeMessage {
                id: "assistant-1".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::ToolInvocation {
                    id: "tool-1".to_string(),
                    name: "read_file".to_string(),
                    input: serde_json::json!({"path": "/test/file.txt"}),
                    state: None,
                }],
                model: Some("claude-3-7-sonnet-20250219".to_string()),
                timestamp: Some("2025-01-01T00:00:01Z".to_string()),
            },
            OpenCodeMessage {
                id: "user-2".to_string(),
                role: "user".to_string(),
                parts: vec![OpenCodeMessagePart::ToolResult {
                    tool_use_id: "tool-1".to_string(),
                    content: "File contents".to_string(),
                }],
                model: None,
                timestamp: Some("2025-01-01T00:00:02Z".to_string()),
            },
        ];

        let converted = convert_opencode_messages_to_session(messages).unwrap();

        // Should have user entry and tool_call entry
        // Note: assistant message has no text, so no assistant entry is created
        // Second user message has only tool result, so no user entry is created
        assert_eq!(converted.entries.len(), 2);
        assert_eq!(converted.stats.tool_uses, 1);
        assert_eq!(converted.stats.tool_results, 1);

        // Find tool call entry
        let tool_entry = converted
            .entries
            .iter()
            .find(|e| matches!(e, StoredEntry::ToolCall { .. }))
            .expect("Should have tool call entry");

        match tool_entry {
            StoredEntry::ToolCall { id, message, .. } => {
                assert_eq!(id, "tool-1");
                assert_eq!(message.name, "Read");
                assert_eq!(message.status, ToolCallStatus::Completed);
                assert_eq!(
                    message.result,
                    Some(serde_json::Value::String("File contents".to_string()))
                );
                assert_eq!(message.kind, Some(ToolKind::Read));
            }
            _ => panic!("Should be tool call"),
        }
    }

    #[test]
    fn test_convert_opencode_empty_user_message() {
        use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};

        let messages = vec![
            OpenCodeMessage {
                id: "user-1".to_string(),
                role: "user".to_string(),
                parts: vec![], // Empty message
                model: None,
                timestamp: Some("2025-01-01T00:00:00Z".to_string()),
            },
            OpenCodeMessage {
                id: "assistant-1".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Response".to_string(),
                }],
                model: None,
                timestamp: Some("2025-01-01T00:00:01Z".to_string()),
            },
        ];

        let converted = convert_opencode_messages_to_session(messages).unwrap();

        // Empty user message should be skipped
        assert_eq!(converted.entries.len(), 1);
        assert!(!converted
            .entries
            .iter()
            .any(|e| matches!(e, StoredEntry::User { id, .. } if id == "user-1")));
    }

    #[test]
    fn test_convert_opencode_webfetch_search_url_maps_to_web_search() {
        use crate::opencode_history::types::{
            OpenCodeApiToolState, OpenCodeMessage, OpenCodeMessagePart,
        };

        let messages = vec![
            OpenCodeMessage {
                id: "user-1".to_string(),
                role: "user".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Search GitHub for CLAUDE.md".to_string(),
                }],
                model: None,
                timestamp: Some("2025-01-01T00:00:00Z".to_string()),
            },
            OpenCodeMessage {
                id: "assistant-1".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::ToolInvocation {
                    id: "call-search-1".to_string(),
                    name: "webfetch".to_string(),
                    input: serde_json::json!({
                        "url": "https://github.com/search?q=CLAUDE.md+boris&type=code",
                        "format": "markdown"
                    }),
                    state: Some(OpenCodeApiToolState {
                        status: "completed".to_string(),
                        input: None,
                        output: Some("search results".to_string()),
                        error: None,
                        metadata: None,
                    }),
                }],
                model: None,
                timestamp: Some("2025-01-01T00:00:01Z".to_string()),
            },
        ];

        let converted = convert_opencode_messages_to_session(messages).unwrap();

        let tool_entry = converted
            .entries
            .iter()
            .find(|e| matches!(e, StoredEntry::ToolCall { .. }))
            .expect("Should have tool call entry");

        match tool_entry {
            StoredEntry::ToolCall { message, .. } => {
                assert_eq!(message.kind, Some(ToolKind::WebSearch));
                match &message.arguments {
                    ToolArguments::WebSearch { query } => {
                        assert_eq!(query.as_deref(), Some("CLAUDE.md boris"));
                    }
                    _ => panic!("Expected web search arguments"),
                }
            }
            _ => panic!("Should be tool call"),
        }
    }

    #[test]
    fn test_parse_skill_meta_extracts_file_path() {
        let content = r#"Base directory for this skill: /Users/example/.claude/plugins/cache/test-skill/0.0.0/skills/test

## Description
This is a test skill."#;

        let meta = parse_skill_meta_from_content(content);
        assert_eq!(
            meta.file_path,
            Some("/Users/example/.claude/plugins/cache/test-skill/0.0.0/skills/test".to_string())
        );
    }

    #[test]
    fn test_parse_skill_meta_extracts_yaml_description() {
        let content = r#"Base directory for this skill: /path/to/skill

---
name: test-skill
description: A test skill for testing purposes
---

## Usage
Use this skill for testing."#;

        let meta = parse_skill_meta_from_content(content);
        assert_eq!(
            meta.description,
            Some("A test skill for testing purposes".to_string())
        );
    }

    #[test]
    fn test_parse_skill_meta_extracts_first_paragraph_as_description() {
        let content = r#"Base directory for this skill: /path/to/skill

---
name: test-skill
---

This is the first paragraph that should be extracted as description.

## Usage
More content here."#;

        let meta = parse_skill_meta_from_content(content);
        assert_eq!(
            meta.description,
            Some(
                "This is the first paragraph that should be extracted as description.".to_string()
            )
        );
    }

    #[test]
    fn test_parse_skill_meta_truncates_long_description() {
        let long_text = "A".repeat(250);
        let content = format!(
            "Base directory for this skill: /path/to/skill\n\n---\nname: test\n---\n\n{}",
            long_text
        );

        let meta = parse_skill_meta_from_content(&content);
        assert!(meta.description.is_some());
        let desc = meta.description.unwrap();
        assert!(desc.len() <= 203); // 200 + "..."
        assert!(desc.ends_with("..."));
    }

    #[test]
    fn test_parse_skill_meta_handles_missing_fields() {
        let content = "Some random content without skill metadata";

        let meta = parse_skill_meta_from_content(content);
        assert!(meta.file_path.is_none());
        assert!(meta.description.is_none());
    }

    #[test]
    fn test_skill_meta_linked_to_tool_call() {
        let mut full_session = create_test_full_session();

        // Add a Skill tool use to assistant message
        full_session.messages[1]
            .content_blocks
            .push(ContentBlock::ToolUse {
                id: "skill-tool-1".to_string(),
                name: "Skill".to_string(),
                input: serde_json::json!({"skill": "mgrep", "args": "search query"}),
            });

        // Add tool result to user message
        full_session.messages[0]
            .content_blocks
            .push(ContentBlock::ToolResult {
                tool_use_id: "skill-tool-1".to_string(),
                content: "Launching skill: mgrep".to_string(),
            });

        // Add a meta message linked to the skill tool call
        full_session.messages.push(OrderedMessage {
            uuid: "meta-skill-1".to_string(),
            parent_uuid: None,
            role: "user".to_string(),
            timestamp: "2025-01-01T00:00:02Z".to_string(),
            content_blocks: vec![ContentBlock::Text {
                text: "Base directory for this skill: /path/to/mgrep\n\n---\nname: mgrep\ndescription: Semantic search tool\n---\n\n## Usage".to_string(),
            }],
            model: None,
            usage: None,
            request_id: None,
            is_meta: true,
            source_tool_use_id: Some("skill-tool-1".to_string()),
            tool_use_result: None,
            source_tool_assistant_uuid: None,
        });

        full_session.stats.tool_uses = 1;
        full_session.stats.tool_results = 1;

        let converted = convert_claude_full_session_to_entries(&full_session);

        // Find the Skill tool call entry
        let skill_entry = converted
            .entries
            .iter()
            .find(|e| matches!(e, StoredEntry::ToolCall { message, .. } if message.name == "Skill"))
            .expect("Should have Skill tool call entry");

        match skill_entry {
            StoredEntry::ToolCall { message, .. } => {
                assert!(
                    message.skill_meta.is_some(),
                    "Skill tool call should have skill_meta"
                );
                let meta = message.skill_meta.as_ref().unwrap();
                assert_eq!(meta.file_path, Some("/path/to/mgrep".to_string()));
                assert_eq!(meta.description, Some("Semantic search tool".to_string()));
            }
            _ => panic!("Should be tool call"),
        }
    }

    #[test]
    fn test_non_skill_tool_calls_have_no_skill_meta() {
        let mut full_session = create_test_full_session();

        // Add a non-Skill tool use
        full_session.messages[1]
            .content_blocks
            .push(ContentBlock::ToolUse {
                id: "read-tool-1".to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({"file_path": "/path/to/file.txt"}),
            });

        full_session.messages[0]
            .content_blocks
            .push(ContentBlock::ToolResult {
                tool_use_id: "read-tool-1".to_string(),
                content: "File contents".to_string(),
            });

        full_session.stats.tool_uses = 1;
        full_session.stats.tool_results = 1;

        let converted = convert_claude_full_session_to_entries(&full_session);

        // Find the Read tool call entry
        let read_entry = converted
            .entries
            .iter()
            .find(|e| matches!(e, StoredEntry::ToolCall { message, .. } if message.name == "Read"))
            .expect("Should have Read tool call entry");

        match read_entry {
            StoredEntry::ToolCall { message, .. } => {
                assert!(
                    message.skill_meta.is_none(),
                    "Non-Skill tool calls should not have skill_meta"
                );
            }
            _ => panic!("Should be tool call"),
        }
    }
}
