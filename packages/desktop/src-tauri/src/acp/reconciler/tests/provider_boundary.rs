//! Unit 3: provider edge owns ACP kind hints (`kind_payload`) and name tables (`providers::*`).

use crate::acp::parsers::AgentType;
use crate::acp::reconciler::kind_payload;
use crate::acp::reconciler::providers;

#[test]
fn kind_payload_lives_under_reconciler_not_parsers() {
    assert_eq!(
        kind_payload::infer_kind_from_payload("id", None, Some("read")),
        Some(crate::acp::session_update::ToolKind::Read)
    );
}

#[test]
fn provider_dispatch_still_classifies_through_reducer_surface() {
    let raw = crate::acp::reconciler::RawClassificationInput {
        id: "t1",
        name: Some("read_file"),
        title: None,
        kind_hint: None,
        arguments: &serde_json::json!({}),
    };
    let out = providers::classify(AgentType::ClaudeCode, &raw);
    assert_eq!(out.kind, crate::acp::session_update::ToolKind::Read);
}
