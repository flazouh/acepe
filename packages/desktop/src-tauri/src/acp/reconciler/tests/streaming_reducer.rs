//! Streaming normalization must use the same semantic + projection path as non-streamed classification.

use crate::acp::parsers::AgentType;
use crate::acp::reconciler::{providers, semantic_transition, RawClassificationInput};
use crate::acp::session_update::{ToolArguments, ToolKind};

#[test]
fn semantic_transition_matches_provider_classify_for_streaming_shape() {
    let raw = RawClassificationInput {
        id: "t1",
        name: Some("unknown"),
        title: Some("unknown"),
        kind_hint: Some("other"),
        arguments: &serde_json::json!({
            "description": "Mark all done",
            "query": "UPDATE todos SET status = 'done'"
        }),
    };
    let direct = providers::classify(AgentType::Copilot, &raw);
    let transition = semantic_transition(AgentType::Copilot, &raw);

    assert_eq!(direct.kind, transition.record.kind);
    assert_eq!(direct.arguments, transition.projected_arguments);
    assert_eq!(transition.record.kind, ToolKind::Todo);
    assert!(matches!(
        transition.projected_arguments,
        ToolArguments::Think { raw: Some(_), .. }
    ));
}
