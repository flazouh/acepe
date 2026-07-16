//! Tool identity authority — canonical import path for reconciler-owned classification.
//!
//! `reconciler` remains for existing call sites; new ingress and session code should prefer
//! `crate::acp::tool_identity`.

pub use crate::acp::reconciler::providers::{
    ClaudeCodeAdapter, CodexAdapter, CopilotAdapter, CursorAdapter, OpenCodeAdapter,
};
pub use crate::acp::reconciler::{
    canonical_name_for_kind, classify_kind_from_provider_name, display_name_for_tool,
    infer_kind_from_payload, infer_kind_from_payload_for_agent, web_search_context_signals,
};

pub(crate) use crate::acp::reconciler::session_tool::ClassifiedToolData;
pub(crate) use crate::acp::reconciler::session_tool::{
    classify_serialized_tool_call, resolve_raw_tool_identity,
};
pub(crate) use crate::acp::reconciler::{
    classify_raw_tool_call, semantic_transition, RawClassificationInput, ToolClassificationHints,
};

pub(crate) use crate::acp::reconciler::providers;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn tool_identity_reexports_tool_classification_hints() {
        let hints = ToolClassificationHints {
            name: Some("Read"),
            title: None,
            kind: None,
            kind_hint: None,
            locations: None,
        };
        assert_eq!(hints.name, Some("Read"));
    }

    #[test]
    fn tool_identity_reexports_classify_kind_from_provider_name() {
        assert_eq!(
            classify_kind_from_provider_name(AgentType::Codex, "shell_command"),
            ToolKind::Execute
        );
    }
}
