//! Characterization net for the three display-id assignment paths (A/B/C).

use crate::acp::parsers::AgentType;
use crate::acp::session_update::{
    ContentChunk, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
};
use crate::acp::transcript_projection::snapshot::{
    TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::transcript_projection::{
    CanonicalTranscriptEvent, CanonicalTranscriptEventKind, TranscriptDeltaOperation,
    TranscriptProjectionRegistry,
};
use crate::acp::transcript_viewport::projection::project_transcript_viewport_rows;
use crate::acp::types::ContentBlock;
use crate::session_jsonl::types::{
    StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    StoredUserMessage,
};

fn test_canonical_event(
    source: AgentType,
    transcript_seq: u64,
    display_id: &str,
    kind: CanonicalTranscriptEventKind,
) -> CanonicalTranscriptEvent {
    CanonicalTranscriptEvent {
        transcript_seq,
        source,
        provider_row_id: format!("row-{display_id}"),
        provider_msg_id: None,
        request_id: Some(format!("req-{transcript_seq}")),
        block_index: 0,
        display_id: display_id.to_string(),
        timestamp: "2026-05-18T00:00:00Z".to_string(),
        model: None,
        kind,
    }
}

fn sample_tool_call(provider_tool_id: &str, _stored_row_id: &str) -> ToolCallData {
    ToolCallData {
        id: provider_tool_id.to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some("/tmp/file".to_string()),
            source_context: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::InProgress,
        result: None,
        kind: Some(ToolKind::Read),
        title: Some("Read file".to_string()),
        locations: None,
        skill_meta: None,
        normalized_questions: None,
        normalized_todos: None,
        normalized_todo_update: None,
        parent_tool_use_id: None,
        task_children: None,
        question_answer: None,
        awaiting_plan_approval: false,
        plan_approval_request_id: None,
    }
}

#[test]
fn path_a_canonical_history_golden_entry_ids() {
    let events = vec![
        test_canonical_event(
            AgentType::Cursor,
            0,
            "user-1",
            CanonicalTranscriptEventKind::UserText {
                text: "hello".to_string(),
            },
        ),
        test_canonical_event(
            AgentType::Codex,
            1,
            "assistant-display-1",
            CanonicalTranscriptEventKind::AssistantText {
                text: "world".to_string(),
                parent_tool_use_id: None,
            },
        ),
        test_canonical_event(
            AgentType::OpenCode,
            2,
            "toolu_provider_read",
            CanonicalTranscriptEventKind::ToolUse {
                tool_call_id: "toolu_provider_read".to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({ "file_path": "/tmp/file" }),
                parent_tool_use_id: None,
            },
        ),
    ];

    let snapshot = TranscriptSnapshot::from_canonical_events(9, &events);

    assert_eq!(
        snapshot
            .entries
            .iter()
            .map(|entry| entry.entry_id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "acepe::entry::session-start::user::.",
            "acepe::entry::assistant-boundary:1::assistant::.",
            "acepe::entry::assistant-boundary:1::tool::toolu_provider_read",
        ]
    );
    assert_eq!(snapshot.entries[2].role, TranscriptEntryRole::Tool);
}

#[test]
fn path_b_stored_history_golden_entry_ids() {
    let snapshot = TranscriptSnapshot::from_stored_entries(
        7,
        &[
            StoredEntry::User {
                id: "user-1".to_string(),
                message: StoredUserMessage {
                    id: Some("user-1".to_string()),
                    content: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some("hello".to_string()),
                    },
                    chunks: vec![],
                    sent_at: None,
                },
                timestamp: None,
            },
            StoredEntry::Assistant {
                id: "assistant-1".to_string(),
                message: StoredAssistantMessage {
                    chunks: vec![StoredAssistantChunk {
                        chunk_type: "message".to_string(),
                        block: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some("world".to_string()),
                        },
                    }],
                    model: None,
                    display_model: None,
                    received_at: None,
                },
                timestamp: None,
            },
            StoredEntry::ToolCall {
                id: "jsonl-event-a".to_string(),
                message: sample_tool_call("provider-tool-id", "jsonl-event-a"),
                timestamp: None,
            },
        ],
    );

    assert_eq!(
        snapshot
            .entries
            .iter()
            .map(|entry| entry.entry_id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "acepe::entry::session-start::user::.",
            "acepe::entry::assistant-boundary:1::assistant::.",
            "acepe::entry::assistant-boundary:1::tool::provider-tool-id",
        ]
    );
    assert_eq!(
        snapshot.entries[2].segments,
        vec![TranscriptSegment::Text {
            segment_id: "acepe::entry::assistant-boundary:1::tool::provider-tool-id:tool"
                .to_string(),
            text: "Read file".to_string(),
        }]
    );
}

#[test]
fn path_c_live_streaming_golden_entry_ids() {
    let registry = TranscriptProjectionRegistry::new();

    registry
        .apply_session_update_idle(
            1,
            &SessionUpdate::UserMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "hello".to_string(),
                    },
                    aggregation_hint: None,
                },
                session_id: Some("session-1".to_string()),
                attempt_id: None,
            },
        )
        .expect("user delta");
    registry
        .apply_session_update_idle(
            2,
            &SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "world".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: None,
                message_id: None,
                parent_tool_use_id: None,
                session_id: Some("session-1".to_string()),
                produced_at_monotonic_ms: None,
            },
        )
        .expect("assistant delta");
    registry
        .apply_session_update_idle(
            3,
            &SessionUpdate::ToolCall {
                tool_call: sample_tool_call("provider-tool-id", "jsonl-event-a"),
                session_id: Some("session-1".to_string()),
            },
        )
        .expect("tool delta");

    let snapshot = registry
        .snapshot_for_session("session-1")
        .expect("live snapshot");

    assert_eq!(
        snapshot
            .entries
            .iter()
            .map(|entry| entry.entry_id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "acepe::entry::session-start::user::.",
            "acepe::entry::assistant-boundary:1::assistant::.",
            "acepe::entry::assistant-boundary:1::tool::provider-tool-id",
        ]
    );
}

#[test]
fn duplicate_provider_derived_entry_ids_no_longer_need_viewport_dup_suffix() {
    let authority_id = "acepe::entry::session-start::tool::toolu_bdrk_dup";
    let snapshot = TranscriptSnapshot {
        revision: 1,
        entries: vec![
            crate::acp::transcript_projection::TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: authority_id.to_string(),
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{authority_id}:tool:0"),
                    text: "first".to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            },
            crate::acp::transcript_projection::TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: format!("{authority_id}-second"),
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{authority_id}-second:tool:1"),
                    text: "second".to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            },
        ],
    };

    let rows = project_transcript_viewport_rows(&snapshot, &[], &[], None, None);

    assert_eq!(rows[0].row_id, format!("transcript:{authority_id}"));
    assert_eq!(
        rows[1].row_id,
        format!("transcript:{authority_id}-second"),
        "authority assigns distinct ids; no #dup suffix"
    );
}

#[test]
fn live_duplicate_tool_call_updates_upsert_same_authority_entry_id() {
    let registry = TranscriptProjectionRegistry::new();
    let authority_entry_id = "acepe::entry::session-start::tool::toolu_same";
    let first = registry
        .apply_session_update_idle(
            432,
            &SessionUpdate::ToolCall {
                tool_call: sample_tool_call("toolu_same", "toolu_same"),
                session_id: Some("session-1".to_string()),
            },
        )
        .expect("first tool delta");
    let second = registry
        .apply_session_update_idle(
            433,
            &SessionUpdate::ToolCall {
                tool_call: sample_tool_call("toolu_same", "toolu_same"),
                session_id: Some("session-1".to_string()),
            },
        )
        .expect("second tool delta");

    assert!(matches!(
        &first.operations[0],
        TranscriptDeltaOperation::AppendEntry { entry } if entry.entry_id == authority_entry_id
    ));
    assert!(matches!(
        &second.operations[0],
        TranscriptDeltaOperation::AppendEntry { entry } if entry.entry_id == authority_entry_id
    ));
    assert!(!matches!(
        &second.operations[0],
        TranscriptDeltaOperation::ReplaceSnapshot { .. }
    ));
}
