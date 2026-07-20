//! Raw JSON transport parity — `AcpLiveSource::normalize` vs `normalize_update`.

use serde_json::{json, to_value};

use crate::acp::parsers::AgentType;
use crate::acp::projections::RouteDecision;
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session::ingress::plugin::live_source_for;
use crate::acp::session_update::{
    parse_session_update_with_agent, ContentChunk, SessionUpdate, ToolArguments, ToolCallData,
    ToolCallStatus, ToolKind,
};
use crate::acp::session_update_parser::session_update_notification_to_provider_events;
use crate::acp::types::{CanonicalAgentId, ContentBlock};

const EVENT_SEQ: i64 = 1;

fn assert_same_provider_event(actual: &ProviderEvent, expected: &ProviderEvent) {
    assert_eq!(actual.source, expected.source);
    assert_eq!(actual.provider_seq, expected.provider_seq);
    assert_eq!(actual.provider_row_id, expected.provider_row_id);
    assert_eq!(actual.timestamp_ms, expected.timestamp_ms);
    match (&actual.kind, &expected.kind) {
        (
            ProviderEventKind::UserText {
                text: a,
                attempt_id: aa,
            },
            ProviderEventKind::UserText {
                text: e,
                attempt_id: ea,
            },
        ) => {
            assert_eq!(a, e);
            assert_eq!(aa, ea);
        }
        (ProviderEventKind::ToolCall(a), ProviderEventKind::ToolCall(e)) => {
            assert_eq!(a.id, e.id);
            assert_eq!(a.name, e.name);
            assert_eq!(a.status, e.status);
        }
        _ => panic!(
            "provider event kinds differ: {:?} vs {:?}",
            actual.kind, expected.kind
        ),
    }
}

#[test]
fn acp_live_source_normalize_matches_normalize_update_user_chunk() {
    let agent = CanonicalAgentId::ClaudeCode;
    let live = live_source_for(&agent).expect("claude live source registered");
    let update = SessionUpdate::UserMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text {
                text: "hello from raw json".to_string(),
            },
            aggregation_hint: None,
        },
        session_id: Some("sess-parity-1".to_string()),
        attempt_id: Some("attempt-1".to_string()),
    };
    let raw = to_value(&update).expect("serialize session update");
    let parsed = parse_session_update_with_agent::<serde_json::Error>(&raw, AgentType::ClaudeCode)
        .expect("parse session update");

    let from_raw = live.normalize(&raw).expect("normalize raw json");
    let from_update = live
        .normalize_update(EVENT_SEQ, &parsed, RouteDecision::default())
        .expect("normalize_update");

    assert_eq!(from_raw.len(), 1);
    assert_same_provider_event(&from_raw[0], &from_update);
}

#[test]
fn session_update_notification_entry_point_matches_live_normalize() {
    let agent = CanonicalAgentId::ClaudeCode;
    let live = live_source_for(&agent).expect("claude live source registered");
    let flat_update = json!({
        "sessionUpdate": "user_message_chunk",
        "sessionId": "sess-parity-2",
        "content": { "type": "text", "text": "hello from notification" }
    });
    let notification = json!({
        "method": "session/update",
        "params": {
            "sessionId": "sess-parity-2",
            "update": flat_update.clone()
        }
    });

    let from_notification =
        session_update_notification_to_provider_events(AgentType::ClaudeCode, &notification)
            .expect("notification maps to provider events");
    let from_flat = live.normalize(&flat_update).expect("normalize flat update");

    assert_eq!(from_notification.len(), 1);
    assert_eq!(from_flat.len(), 1);
    assert_same_provider_event(&from_notification[0], &from_flat[0]);
}

#[test]
fn acp_live_source_normalize_matches_normalize_update_tool_call() {
    let agent = CanonicalAgentId::ClaudeCode;
    let live = live_source_for(&agent).expect("claude live source registered");
    let update = SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: "tool-parity-1".to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/repo/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some("Read README".to_string()),
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
        session_id: Some("sess-parity-1".to_string()),
    };
    let raw = to_value(&update).expect("serialize session update");
    let parsed = parse_session_update_with_agent::<serde_json::Error>(&raw, AgentType::ClaudeCode)
        .expect("parse session update");

    let from_raw = live.normalize(&raw).expect("normalize raw json");
    let from_update = live
        .normalize_update(EVENT_SEQ, &parsed, RouteDecision::default())
        .expect("normalize_update");

    assert_eq!(from_raw.len(), 1);
    assert_same_provider_event(&from_raw[0], &from_update);
}
