//! Session converter module.
//!
//! Agent-specific entry points:
//! - claude/cursor/codex use FullSession conversion
//! - opencode uses OpenCode message conversion

use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::session_update::TurnErrorKind;
use crate::cc_sdk::AssistantMessageError;
use crate::opencode_history::types::OpenCodeMessage;
use crate::session_jsonl::types::FullSession;

mod claude;
mod cursor;
mod fullsession;
mod opencode;

pub use crate::acp::session::ingress::canonical_events::materialize_canonical_transcript_events;
pub use crate::acp::session_update::tool_merge::{calculate_todo_timing, merge_tool_call_update};

#[cfg(test)]
use fullsession::parse_skill_meta_from_content;

pub fn convert_claude_full_session_to_thread_snapshot(
    session: &FullSession,
) -> SessionThreadSnapshot {
    claude::convert_claude_full_session_to_thread_snapshot(session)
}

pub fn convert_cursor_full_session_to_thread_snapshot(
    session: &FullSession,
) -> SessionThreadSnapshot {
    cursor::convert_cursor_full_session_to_thread_snapshot(session)
}

#[allow(dead_code)]
pub fn convert_opencode_messages_to_session(
    messages: Vec<OpenCodeMessage>,
) -> Result<SessionThreadSnapshot, String> {
    opencode::convert_opencode_messages_to_session(messages)
}

pub(crate) fn convert_opencode_messages_to_provider_owned_snapshot(
    messages: Vec<OpenCodeMessage>,
) -> Result<ProviderOwnedSessionSnapshot, String> {
    opencode::convert_opencode_messages_to_provider_owned_snapshot(messages)
}

fn extract_api_error_status_code(text: &str) -> Option<&str> {
    let marker = "API Error:";
    let marker_start = text.find(marker)?;
    let after_marker = &text[marker_start + marker.len()..];
    let trimmed = after_marker.trim_start();
    let code_end = trimmed
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(trimmed.len());
    (code_end > 0).then_some(&trimmed[..code_end])
}

fn assistant_error_kind(error: &AssistantMessageError) -> TurnErrorKind {
    match error {
        AssistantMessageError::AuthenticationFailed
        | AssistantMessageError::BillingError
        | AssistantMessageError::InvalidRequest => TurnErrorKind::Fatal,
        AssistantMessageError::RateLimit
        | AssistantMessageError::ServerError
        | AssistantMessageError::Unknown => TurnErrorKind::Recoverable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::AgentParser;
    use crate::acp::parsers::ClaudeCodeParser;
    use crate::acp::session_update::{ToolArguments, ToolCallStatus, ToolKind, TurnErrorKind};
    use crate::cc_sdk::AssistantMessageError;
    use crate::session_jsonl::types::{ContentBlock, OrderedMessage, SessionStats, StoredEntry};

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
                    provider_message_id: None,
                    timestamp: "2025-01-01T00:00:00Z".to_string(),
                    content_blocks: vec![ContentBlock::Text {
                        text: "Hello, world!".to_string(),
                    }],
                    model: None,
                    usage: None,
                    error: None,
                    request_id: None,
                    is_meta: false,
                    source_tool_use_id: None,
                    parent_tool_use_id: None,
                    tool_use_result: None,
                    source_tool_assistant_uuid: None,
                },
                OrderedMessage {
                    uuid: "assistant-1".to_string(),
                    parent_uuid: Some("user-1".to_string()),
                    role: "assistant".to_string(),
                    provider_message_id: None,
                    timestamp: "2025-01-01T00:00:01Z".to_string(),
                    content_blocks: vec![ContentBlock::Text {
                        text: "Hi there!".to_string(),
                    }],
                    model: Some("claude-opus-4-5-20251101".to_string()),
                    usage: None,
                    error: None,
                    request_id: None,
                    is_meta: false,
                    source_tool_use_id: None,
                    parent_tool_use_id: None,
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
        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

        assert_eq!(converted.title, "Test Session");
        assert_eq!(converted.entries.len(), 2);

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
    fn claude_history_restores_acepe_pasted_content_as_a_structured_user_block() {
        let mut full_session = create_test_full_session();
        full_session.messages[0].content_blocks = vec![
            ContentBlock::Text {
                text: "Please inspect this".to_string(),
            },
            ContentBlock::PastedContent {
                text: "first pasted line\nsecond pasted line".to_string(),
            },
        ];

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);
        let user_message = converted
            .entries
            .iter()
            .find_map(|entry| match entry {
                StoredEntry::User { message, .. } => Some(message),
                _ => None,
            })
            .expect("converted history should contain the user message");

        assert_eq!(
            user_message.content.text.as_deref(),
            Some("Please inspect this")
        );
        assert_eq!(user_message.chunks.len(), 2);
        assert_eq!(user_message.chunks[0].block_type, "text");
        assert_eq!(
            user_message.chunks[0].text.as_deref(),
            Some("Please inspect this")
        );
        assert_eq!(user_message.chunks[1].block_type, "pasted_content");
        assert_eq!(
            user_message.chunks[1].text.as_deref(),
            Some("first pasted line\nsecond pasted line")
        );

        let transcript = crate::acp::transcript_projection::TranscriptSnapshot::from_stored_entries(
            1,
            &converted.entries,
        );
        let transcript_json =
            serde_json::to_value(transcript).expect("transcript snapshot should serialize");
        assert_eq!(
            transcript_json["entries"][0]["segments"][1]["kind"],
            serde_json::json!("pastedContent")
        );
    }

    #[test]
    fn test_convert_assistant_provider_error_to_error_entry() {
        let mut full_session = create_test_full_session();
        full_session.messages[1].content_blocks = vec![ContentBlock::Text {
            text: "Failed to authenticate. API Error: 401 {\"error\":{\"message\":\"User not found.\",\"code\":401}}"
                .to_string(),
        }];
        full_session.messages[1].error = Some(AssistantMessageError::AuthenticationFailed);

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

        assert_eq!(converted.entries.len(), 2);
        assert!(!converted.entries.iter().any(|entry| {
            matches!(
                entry,
                StoredEntry::Assistant { message, .. }
                    if message
                        .chunks
                        .iter()
                        .any(|chunk| chunk.block.text.as_deref().is_some_and(|text| text.contains("Failed to authenticate")))
            )
        }));

        match &converted.entries[1] {
            StoredEntry::Error { id, message, .. } => {
                assert_eq!(id, "assistant-1");
                assert!(message.content.contains("Failed to authenticate"));
                assert!(message.content.contains("User not found"));
                assert_eq!(message.code, Some("401".to_string()));
                assert_eq!(message.kind, TurnErrorKind::Fatal);
            }
            _ => panic!("Assistant provider error should become an error entry"),
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

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

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
    fn test_convert_session_preserves_tool_call_position_inside_assistant_message() {
        let mut full_session = create_test_full_session();
        full_session.messages[1].content_blocks = vec![
            ContentBlock::Thinking {
                thinking: "Need to inspect files first.".to_string(),
                signature: None,
                redacted_provider_data: None,
            },
            ContentBlock::ToolUse {
                id: "tool-1".to_string(),
                name: "Bash".to_string(),
                input: serde_json::json!({ "command": "ls -la" }),
            },
            ContentBlock::Text {
                text: "Here is the answer after inspecting files.".to_string(),
            },
        ];
        full_session.messages[0]
            .content_blocks
            .push(ContentBlock::ToolResult {
                tool_use_id: "tool-1".to_string(),
                content: "README.md".to_string(),
            });
        full_session.stats.tool_uses = 1;
        full_session.stats.tool_results = 1;
        full_session.stats.thinking_blocks = 1;

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);
        let entry_kinds: Vec<&str> = converted
            .entries
            .iter()
            .map(|entry| match entry {
                StoredEntry::Assistant { .. } => "assistant",
                StoredEntry::ToolCall { .. } => "tool_call",
                _ => "other",
            })
            .collect();

        assert_eq!(
            entry_kinds,
            vec!["other", "assistant", "tool_call", "assistant"]
        );
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
                redacted_provider_data: None,
            },
        );

        full_session.stats.thinking_blocks = 1;

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

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
            provider_message_id: None,
            timestamp: "2025-01-01T00:00:02Z".to_string(),
            content_blocks: vec![ContentBlock::Text {
                text: "Meta message".to_string(),
            }],
            model: None,
            usage: None,
            error: None,
            request_id: None,
            is_meta: true,
            source_tool_use_id: None,
            parent_tool_use_id: None,
            tool_use_result: None,
            source_tool_assistant_uuid: None,
        });

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

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
                provider_message_id: None,
                timestamp: "2025-01-01T00:00:00Z".to_string(),
                content_blocks: vec![],
                model: None,
                usage: None,
                error: None,
                request_id: None,
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
        );

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

        // Empty user message should be skipped
        assert_eq!(converted.entries.len(), 2);
        assert!(!converted
            .entries
            .iter()
            .any(|e| matches!(e, StoredEntry::User { id, .. } if id == "empty-user")));
    }

    #[test]
    fn test_convert_session_skips_claude_local_command_user_messages() {
        let mut full_session = create_test_full_session();

        full_session.messages.insert(
            0,
            OrderedMessage {
                uuid: "command-user".to_string(),
                parent_uuid: None,
                role: "user".to_string(),
            provider_message_id: None,
                timestamp: "2025-01-01T00:00:00Z".to_string(),
                content_blocks: vec![ContentBlock::Text {
                    text: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>claude-sonnet-4-6</command-args>".to_string(),
                }],
                model: None,
                usage: None,
                error: None,
                request_id: None,
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
        );
        full_session.messages.insert(
            1,
            OrderedMessage {
                uuid: "command-stdout".to_string(),
                parent_uuid: None,
                role: "user".to_string(),
            provider_message_id: None,
                timestamp: "2025-01-01T00:00:00Z".to_string(),
                content_blocks: vec![ContentBlock::Text {
                    text: "<local-command-stdout>Set model to claude-sonnet-4-6</local-command-stdout>".to_string(),
                }],
                model: None,
                usage: None,
                error: None,
                request_id: None,
                is_meta: false,
                source_tool_use_id: None,
                parent_tool_use_id: None,
                tool_use_result: None,
                source_tool_assistant_uuid: None,
            },
        );

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

        assert!(!converted.entries.iter().any(|entry| {
            matches!(
                entry,
                StoredEntry::User { id, .. } if id == "command-user" || id == "command-stdout"
            )
        }));
        assert!(converted.entries.iter().any(|entry| {
            matches!(
                entry,
                StoredEntry::User { message, .. }
                    if message.content.text.as_deref() == Some("Hello, world!")
            )
        }));
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
            provider_message_id: None,
            timestamp: "2025-01-01T00:00:02Z".to_string(),
            content_blocks: vec![ContentBlock::Text {
                text: "Base directory for this skill: /path/to/mgrep\n\n---\nname: mgrep\ndescription: Semantic search tool\n---\n\n## Usage".to_string(),
            }],
            model: None,
            usage: None,
            error: None,
            request_id: None,
            is_meta: true,
            source_tool_use_id: Some("skill-tool-1".to_string()),
            parent_tool_use_id: None,
            tool_use_result: None,
            source_tool_assistant_uuid: None,
        });

        full_session.stats.tool_uses = 1;
        full_session.stats.tool_results = 1;

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

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
                match &message.arguments {
                    crate::acp::session_update::ToolArguments::Think { skill, .. } => {
                        assert_eq!(skill.as_deref(), Some("mgrep"));
                    }
                    other => panic!("Skill arguments should stay structured, got {other:?}"),
                }
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

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);

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

    #[test]
    fn claude_history_restores_agent_call_as_subagent_task_operation() {
        let mut full_session = create_test_full_session();
        full_session.messages[1]
            .content_blocks
            .push(ContentBlock::ToolUse {
                id: "toolu-agent-1".to_string(),
                name: "Agent".to_string(),
                input: serde_json::json!({
                    "description": "Find Claude history parsing seam",
                    "subagent_type": "Explore",
                    "prompt": "Inspect the provider history boundary"
                }),
            });

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);
        let agent_call = converted
            .entries
            .iter()
            .find_map(|entry| match entry {
                StoredEntry::ToolCall { message, .. } if message.id == "toolu-agent-1" => {
                    Some(message)
                }
                _ => None,
            })
            .expect("Agent history call should remain a canonical tool operation");

        assert_eq!(
            agent_call.kind,
            Some(crate::acp::session_update::ToolKind::Task)
        );
        match &agent_call.arguments {
            crate::acp::session_update::ToolArguments::Think {
                description,
                prompt,
                subagent_type,
                ..
            } => {
                assert_eq!(
                    description.as_deref(),
                    Some("Find Claude history parsing seam")
                );
                assert_eq!(
                    prompt.as_deref(),
                    Some("Inspect the provider history boundary")
                );
                assert_eq!(subagent_type.as_deref(), Some("Explore"));
            }
            other => panic!("Agent arguments should stay structured, got {other:?}"),
        }
    }

    #[test]
    fn claude_history_restores_task_create_as_canonical_todo_content() {
        let mut full_session = create_test_full_session();
        full_session.messages[1]
            .content_blocks
            .push(ContentBlock::ToolUse {
                id: "toolu-task-create-1".to_string(),
                name: "TaskCreate".to_string(),
                input: serde_json::json!({
                    "subject": "Build red feedback loop",
                    "description": "Add the regression test first",
                    "activeForm": "Building red feedback loop"
                }),
            });

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);
        let task_create = converted
            .entries
            .iter()
            .find_map(|entry| match entry {
                StoredEntry::ToolCall { message, .. } if message.id == "toolu-task-create-1" => {
                    Some(message)
                }
                _ => None,
            })
            .expect("TaskCreate should remain a canonical tool operation");

        assert_eq!(
            task_create.kind,
            Some(crate::acp::session_update::ToolKind::Todo)
        );
        let todos = task_create
            .normalized_todos
            .as_ref()
            .expect("TaskCreate should expose canonical Todo content");
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].content, "Build red feedback loop");
        assert_eq!(todos[0].active_form, "Building red feedback loop");
        assert_eq!(
            todos[0].status,
            crate::acp::session_update::TodoStatus::Pending
        );
    }

    #[test]
    fn claude_history_restores_task_update_as_same_canonical_todo_item() {
        let mut full_session = create_test_full_session();
        full_session.messages[1].content_blocks.extend([
            ContentBlock::ToolUse {
                id: "toolu-task-create-1".to_string(),
                name: "TaskCreate".to_string(),
                input: serde_json::json!({
                    "subject": "Build red feedback loop",
                    "description": "Add the regression test first",
                    "activeForm": "Building red feedback loop"
                }),
            },
            ContentBlock::ToolUse {
                id: "toolu-task-update-1".to_string(),
                name: "TaskUpdate".to_string(),
                input: serde_json::json!({
                    "taskId": "1",
                    "status": "in_progress"
                }),
            },
            ContentBlock::ToolUse {
                id: "toolu-task-update-2".to_string(),
                name: "TaskUpdate".to_string(),
                input: serde_json::json!({
                    "taskId": "1",
                    "status": "completed"
                }),
            },
        ]);

        let converted = convert_claude_full_session_to_thread_snapshot(&full_session);
        let todo_states = converted
            .entries
            .iter()
            .filter_map(|entry| match entry {
                StoredEntry::ToolCall { message, .. }
                    if matches!(
                        message.id.as_str(),
                        "toolu-task-create-1" | "toolu-task-update-1" | "toolu-task-update-2"
                    ) =>
                {
                    message
                        .normalized_todos
                        .as_ref()
                        .and_then(|todos| todos.first())
                        .map(|todo| (message.id.as_str(), todo.content.as_str(), todo.status))
                }
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(
            todo_states,
            vec![
                (
                    "toolu-task-create-1",
                    "Build red feedback loop",
                    crate::acp::session_update::TodoStatus::Pending,
                ),
                (
                    "toolu-task-update-1",
                    "Build red feedback loop",
                    crate::acp::session_update::TodoStatus::InProgress,
                ),
                (
                    "toolu-task-update-2",
                    "Build red feedback loop",
                    crate::acp::session_update::TodoStatus::Completed,
                ),
            ]
        );
    }
}
