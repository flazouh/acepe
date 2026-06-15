//! Resume-seam characterization: history replay then live events for the same tool call.
//!
//! After U3, history and live paths derive the same authority-owned entry id for the
//! same tool_call_id — no duplicate rows and no id-scheme ReplaceSnapshot repair.

use crate::acp::parsers::AgentType;
use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind, TurnErrorData,
    TurnErrorInfo, TurnErrorKind, TurnErrorSource,
};
use crate::acp::transcript_projection::display_id::{
    assistant_boundary_entry_count_from_transcript_entries, derive_entry_id_for_snapshot_role,
    derive_tool_entry_id, turn_key_for_assistant_boundary,
};
use crate::acp::transcript_projection::snapshot::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::transcript_projection::{
    CanonicalTranscriptEvent, CanonicalTranscriptEventKind, TranscriptDeltaOperation,
    TranscriptProjectionRegistry,
};
use crate::session_jsonl::types::StoredEntry;

fn read_tool_call(provider_tool_id: &str) -> ToolCallData {
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

fn expected_tool_entry_id(provider_tool_id: &str) -> String {
    derive_tool_entry_id("session-start", provider_tool_id)
}

#[test]
fn resume_seam_stored_history_then_live_tool_call_shares_authority_entry_id() {
    let provider_tool_id = "toolu_resume_same";

    let history_snapshot = TranscriptSnapshot::from_stored_entries(
        40,
        &[StoredEntry::ToolCall {
            id: "jsonl-event-stored".to_string(),
            message: read_tool_call(provider_tool_id),
            timestamp: None,
        }],
    );
    let authority_entry_id = expected_tool_entry_id(provider_tool_id);
    assert_eq!(history_snapshot.entries[0].entry_id, authority_entry_id);

    let registry = TranscriptProjectionRegistry::new();
    registry.restore_session_snapshot("session-1".to_string(), history_snapshot);

    let live_delta = registry
        .apply_session_update_idle(
            500,
            &SessionUpdate::ToolCall {
                tool_call: read_tool_call(provider_tool_id),
                session_id: Some("session-1".to_string()),
            },
        )
        .expect("live tool delta after stored restore");

    assert!(matches!(
        &live_delta.operations[0],
        TranscriptDeltaOperation::AppendEntry { entry }
            if entry.entry_id == authority_entry_id
    ));

    let snapshot = registry
        .snapshot_for_session("session-1")
        .expect("post-resume snapshot");

    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].entry_id, authority_entry_id);
}

#[test]
fn resume_seam_canonical_history_then_live_tool_call_shares_authority_entry_id() {
    let provider_tool_id = "toolu_canonical_resume";
    let authority_entry_id = expected_tool_entry_id(provider_tool_id);

    let history_snapshot = TranscriptSnapshot::from_canonical_events(
        41,
        &[CanonicalTranscriptEvent {
            transcript_seq: 0,
            source: AgentType::Cursor,
            provider_row_id: "row-tool".to_string(),
            provider_msg_id: None,
            request_id: Some("req-1".to_string()),
            block_index: 0,
            display_id: provider_tool_id.to_string(),
            timestamp: "2026-05-18T00:00:00Z".to_string(),
            model: None,
            kind: CanonicalTranscriptEventKind::ToolUse {
                tool_call_id: provider_tool_id.to_string(),
                name: "Read".to_string(),
                input: serde_json::json!({ "file_path": "/tmp/file" }),
            },
        }],
    );
    assert_eq!(history_snapshot.entries[0].entry_id, authority_entry_id);

    let registry = TranscriptProjectionRegistry::new();
    registry.restore_session_snapshot("session-1".to_string(), history_snapshot);

    let live_delta = registry
        .apply_session_update_idle(
            501,
            &SessionUpdate::ToolCall {
                tool_call: read_tool_call(provider_tool_id),
                session_id: Some("session-1".to_string()),
            },
        )
        .expect("live tool delta after canonical restore");

    assert!(matches!(
        &live_delta.operations[0],
        TranscriptDeltaOperation::AppendEntry { entry }
            if entry.entry_id == authority_entry_id
    ));

    let snapshot = registry
        .snapshot_for_session("session-1")
        .expect("post-resume snapshot");

    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].entry_id, authority_entry_id);
}

#[test]
fn resume_seam_live_tool_status_update_upserts_same_authority_entry_id() {
    let provider_tool_id = "toolu_live_resume_replace";
    let authority_entry_id = expected_tool_entry_id(provider_tool_id);

    let registry = TranscriptProjectionRegistry::new();
    registry.restore_session_snapshot(
        "session-1".to_string(),
        TranscriptSnapshot {
            revision: 42,
            entries: vec![TranscriptEntry {
                entry_id: authority_entry_id.clone(),
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{authority_entry_id}:tool"),
                    text: "Read file".to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        },
    );

    let first = registry
        .apply_session_update_idle(
            600,
            &SessionUpdate::ToolCall {
                tool_call: read_tool_call(provider_tool_id),
                session_id: Some("session-1".to_string()),
            },
        )
        .expect("first live tool delta reuses restored authority id");
    let second = registry
        .apply_session_update_idle(
            601,
            &SessionUpdate::ToolCall {
                tool_call: read_tool_call(provider_tool_id),
                session_id: Some("session-1".to_string()),
            },
        )
        .expect("second live tool delta upserts same authority id");

    assert!(matches!(
        &first.operations[0],
        TranscriptDeltaOperation::AppendEntry { entry } if entry.entry_id == authority_entry_id
    ));
    assert!(matches!(
        &second.operations[0],
        TranscriptDeltaOperation::AppendEntry { entry } if entry.entry_id == authority_entry_id
    ));
    assert!(
        !matches!(
            &second.operations[0],
            TranscriptDeltaOperation::ReplaceSnapshot { .. }
        ),
        "same tool_call_id must not trigger ReplaceSnapshot id repair"
    );

    let snapshot = registry
        .snapshot_for_session("session-1")
        .expect("post-resume snapshot");
    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].entry_id, authority_entry_id);
}

#[test]
fn resume_seam_live_turn_error_uses_authority_error_entry_id() {
    let restored_entries = vec![TranscriptEntry {
        entry_id: expected_tool_entry_id("toolu_prior"),
        role: TranscriptEntryRole::Tool,
        segments: vec![TranscriptSegment::Text {
            segment_id: "prior:tool".to_string(),
            text: "prior tool".to_string(),
        }],
        attempt_id: None,
        timestamp_ms: None,
    }];
    let turn_key = turn_key_for_assistant_boundary(
        assistant_boundary_entry_count_from_transcript_entries(&restored_entries),
    );
    let authority_error_id =
        derive_entry_id_for_snapshot_role(&turn_key, &TranscriptEntryRole::Error, None);

    let registry = TranscriptProjectionRegistry::new();
    registry.restore_session_snapshot(
        "session-1".to_string(),
        TranscriptSnapshot {
            revision: 50,
            entries: restored_entries,
        },
    );

    let live_delta = registry
        .apply_session_update_idle(
            700,
            &SessionUpdate::TurnError {
                error: TurnErrorData::Structured(TurnErrorInfo {
                    message: "resume failed".to_string(),
                    kind: TurnErrorKind::Recoverable,
                    code: Some(429),
                    source: Some(TurnErrorSource::Process),
                }),
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-resume".to_string()),
            },
        )
        .expect("live turn error after restore");

    assert!(matches!(
        &live_delta.operations[0],
        TranscriptDeltaOperation::AppendEntry { entry }
            if entry.entry_id == authority_error_id
                && entry.role == TranscriptEntryRole::Error
    ));

    let snapshot = registry
        .snapshot_for_session("session-1")
        .expect("post-resume snapshot");
    assert_eq!(snapshot.entries.len(), 2);
    assert_eq!(
        snapshot.entries[1].entry_id, authority_error_id,
        "live TurnError must use authority-owned error entry id after history restore"
    );
}
