//! Characterization pins for Cursor's four ingress edges (plan 015 U1).
//!
//! Edge map draft (R3):
//! | Edge | Entry | Normalizer | Tests in this module |
//! |------|-------|------------|----------------------|
//! | Live parse | `acp/parsers/cursor_parser.rs` via `acp_fields::extract_tool_call_id` | `normalize_tool_call_id` | `live_parse_and_history_restore_agree_on_canonical_tool_call_id` |
//! | History restore | `session_converter/cursor.rs` + `fullsession.rs` | `normalize_tool_call_id` | `live_parse_and_history_restore_agree_on_canonical_tool_call_id` |
//! | Enrichment index | `providers/cursor/enrichment.rs` `build_persisted_tool_use_index` | `normalize_tool_call_id` | enrichment inline tests (`enriches_sparse_*`, `persisted_tool_use_index_*`) |
//! | Snapshot rehydration | `transcript_projection/snapshot.rs` + `display_id.rs` | `normalize_tool_call_id` (idempotent) | `snapshot_rehydration_*` |

use super::*;
use crate::acp::parsers::acp_fields::normalize_tool_call_id;
use crate::acp::parsers::AgentType;
use crate::acp::session::fold_export::thread_snapshot_from_full_session;
use crate::acp::session_update::{ToolArguments, ToolCallStatus, ToolKind};
use crate::acp::transcript_projection::display_id::tool_call_id_from_authority_entry_id;
use crate::acp::transcript_projection::snapshot::TranscriptSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::{
    ContentBlock, FullSession, OrderedMessage, SessionStats, StoredEntry,
};
use serde_json::json;

const RAW_COMPOSITE_ID: &str =
    "call_Wn1fy43fPwtgTmTwe53Bno3P\nfc_061be5537213afbd0169f36b1dc28c81998a9514839fc91b89";
const CANONICAL_COMPOSITE_ID: &str =
    "call_Wn1fy43fPwtgTmTwe53Bno3P%0Afc_061be5537213afbd0169f36b1dc28c81998a9514839fc91b89";

fn cursor_parser() -> CursorParser {
    CursorParser
}

fn full_session_with_tool_use(raw_tool_id: &str) -> FullSession {
    FullSession {
        session_id: "cursor-ingress-edge-parity".to_string(),
        project_path: "/tmp/project".to_string(),
        title: "Cursor Session".to_string(),
        created_at: "2026-06-11T00:00:00+00:00".to_string(),
        stats: SessionStats {
            total_messages: 1,
            user_messages: 0,
            assistant_messages: 1,
            tool_uses: 1,
            tool_results: 0,
            thinking_blocks: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
        },
        messages: vec![OrderedMessage {
            uuid: "assistant-1".to_string(),
            parent_uuid: None,
            role: "assistant".to_string(),
            provider_message_id: None,
            timestamp: "2026-06-11T00:00:01+00:00".to_string(),
            content_blocks: vec![ContentBlock::ToolUse {
                id: raw_tool_id.to_string(),
                name: "Glob".to_string(),
                input: json!({
                    "target_directory": "/tmp/project",
                    "glob_pattern": "**/*"
                }),
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
        }],
    }
}

mod live_parse_edge {
    use super::*;

    #[test]
    fn live_parse_normalizes_composite_tool_call_ids() {
        let parser = cursor_parser();
        let tool_call = parser
            .parse_tool_call(&json!({
                "toolCallId": RAW_COMPOSITE_ID,
                "title": "Find",
                "kind": "search",
                "rawInput": {}
            }))
            .unwrap();
        let tool_update = parser
            .parse_tool_call_update(
                &json!({
                    "toolCallId": RAW_COMPOSITE_ID,
                    "status": "completed",
                    "rawOutput": { "totalFiles": 0 }
                }),
                None,
            )
            .unwrap();

        assert_eq!(tool_call.id, CANONICAL_COMPOSITE_ID);
        assert_eq!(tool_update.tool_call_id, CANONICAL_COMPOSITE_ID);
        assert!(!tool_call.id.contains('\n'));
    }
}

mod history_restore_edge {
    use super::*;

    #[test]
    fn history_restore_normalizes_composite_tool_call_ids() {
        let snapshot = thread_snapshot_from_full_session(
            &full_session_with_tool_use(RAW_COMPOSITE_ID),
            CanonicalAgentId::Cursor,
            AgentType::Cursor,
        );
        let (stored_id, message) = snapshot
            .entries
            .iter()
            .find_map(|entry| match entry {
                StoredEntry::ToolCall { id, message, .. } => Some((id, message)),
                _ => None,
            })
            .expect("restored tool call");

        assert_eq!(stored_id, CANONICAL_COMPOSITE_ID);
        assert_eq!(message.id, CANONICAL_COMPOSITE_ID);
        assert!(!message.id.contains('\n'));
    }
}

mod cross_edge_parity {
    use super::*;

    #[test]
    fn live_parse_and_history_restore_agree_on_canonical_tool_call_id() {
        let parser = cursor_parser();
        let live_id = parser
            .parse_tool_call(&json!({
                "toolCallId": RAW_COMPOSITE_ID,
                "title": "Find",
                "kind": "search",
                "rawInput": {}
            }))
            .unwrap()
            .id;

        let history_snapshot = thread_snapshot_from_full_session(
            &full_session_with_tool_use(RAW_COMPOSITE_ID),
            CanonicalAgentId::Cursor,
            AgentType::Cursor,
        );
        let history_id = history_snapshot
            .entries
            .iter()
            .find_map(|entry| match entry {
                StoredEntry::ToolCall { id, .. } => Some(id.clone()),
                _ => None,
            })
            .expect("history tool call id");

        assert_eq!(
            live_id, history_id,
            "live ingress and history restore must emit the same canonical tool-call id"
        );
        assert_eq!(live_id, CANONICAL_COMPOSITE_ID);
    }
}

mod normalizer_idempotence {
    use super::*;

    #[test]
    fn normalize_is_idempotent_for_percent_and_newline_composite_ids() {
        let raw = "tool%provider\ncursor";
        let once = normalize_tool_call_id(raw);
        let twice = normalize_tool_call_id(&once);
        assert_eq!(once, "tool%25provider%0Acursor");
        assert_eq!(
            once, twice,
            "re-applying normalize on already-normalized ids must not double-escape (%0A -> %250A)"
        );
    }

    #[test]
    fn normalize_is_idempotent_for_newline_only_composite_ids() {
        let once = normalize_tool_call_id(RAW_COMPOSITE_ID);
        let twice = normalize_tool_call_id(&once);
        assert_eq!(once, CANONICAL_COMPOSITE_ID);
        assert_eq!(once, twice);
    }
}

mod snapshot_rehydration_edge {
    use super::*;
    use crate::acp::session_update::ToolCallData;

    #[test]
    fn snapshot_rehydration_preserves_already_normalized_tool_call_ids() {
        let snapshot = TranscriptSnapshot::from_stored_entries(
            1,
            &[StoredEntry::ToolCall {
                id: CANONICAL_COMPOSITE_ID.to_string(),
                message: ToolCallData {
                    id: CANONICAL_COMPOSITE_ID.to_string(),
                    name: "Glob".to_string(),
                    arguments: ToolArguments::Glob {
                        pattern: Some("**/*".to_string()),
                        path: Some("/tmp/project".to_string()),
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Completed,
                    result: None,
                    kind: Some(ToolKind::Glob),
                    title: Some("Find".to_string()),
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
                },
                timestamp: None,
            }],
        );

        let entry_id = snapshot.entries[0].entry_id.clone();
        let round_tripped = tool_call_id_from_authority_entry_id(&entry_id)
            .expect("authority entry id should carry normalized tool-call suffix");
        assert_eq!(
            round_tripped, CANONICAL_COMPOSITE_ID,
            "snapshot rehydration must not re-normalize already-normalized stored ids"
        );
        assert!(
            !round_tripped.contains("%250A"),
            "double-encoding at rehydration would break operation join keys"
        );
    }

    #[test]
    fn snapshot_rehydration_normalizes_raw_stored_tool_call_ids_once() {
        let raw_id = "tool%provider\ncursor";
        let snapshot = TranscriptSnapshot::from_stored_entries(
            2,
            &[StoredEntry::ToolCall {
                id: raw_id.to_string(),
                message: ToolCallData {
                    id: raw_id.to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Read {
                        file_path: Some("/tmp/file".to_string()),
                        source_context: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Completed,
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
                },
                timestamp: None,
            }],
        );

        let round_tripped = tool_call_id_from_authority_entry_id(&snapshot.entries[0].entry_id)
            .expect("tool suffix");
        assert_eq!(round_tripped, "tool%25provider%0Acursor");
        assert_eq!(
            normalize_tool_call_id(&round_tripped),
            round_tripped,
            "rehydrated id must remain stable under a second normalization pass"
        );
    }
}
