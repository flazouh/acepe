//! Provider-owned tool name normalization and classification dispatch (Unit 3).
//!
//! Each provider resolves its own tool names to [`ToolKind`]; the result flows into
//! [`classify_with_provider_name_kind`] which applies the shared fallback heuristics.
//! No shared `Reconciler` trait — provider logic is a plain match arm here.

use crate::acp::parsers::AgentType;
use crate::acp::reconciler::{
    classify_with_provider_name_kind, ClassificationOutput, RawClassificationInput,
};
use crate::acp::session_update::ToolKind;

pub mod claude_code;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod open_code;
pub mod shared_chat;

pub use claude_code::ClaudeCodeAdapter;
pub use codex::CodexAdapter;
pub use copilot::CopilotAdapter;
pub use cursor::CursorAdapter;
pub use open_code::OpenCodeAdapter;

/// Zero-allocation check: name matches any of the candidates (ASCII case-insensitive).
pub(crate) fn any_eq(name: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|c| name.eq_ignore_ascii_case(c))
}

fn resolve_provider_kind(name: Option<&str>, normalize: fn(&str) -> ToolKind) -> Option<ToolKind> {
    let name = name
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .filter(|v| !v.eq_ignore_ascii_case("unknown"))?;

    let kind = normalize(name);
    if kind == ToolKind::Other {
        None
    } else {
        Some(kind)
    }
}

/// Dispatch to the provider's name table, then fall through shared classification heuristics.
pub(crate) fn classify(agent: AgentType, raw: &RawClassificationInput<'_>) -> ClassificationOutput {
    let provider_kind = match agent {
        AgentType::ClaudeCode => resolve_provider_kind(raw.name, ClaudeCodeAdapter::normalize),
        AgentType::Copilot => resolve_provider_kind(raw.name, CopilotAdapter::normalize),
        AgentType::Cursor => resolve_provider_kind(raw.name, CursorAdapter::normalize),
        AgentType::Codex => resolve_provider_kind(raw.name, CodexAdapter::normalize),
        AgentType::OpenCode => resolve_provider_kind(raw.name, OpenCodeAdapter::normalize),
    };
    classify_with_provider_name_kind(agent, provider_kind, raw)
}

pub(crate) fn detect_tool_kind(agent: AgentType, name: &str) -> ToolKind {
    classify(
        agent,
        &RawClassificationInput {
            id: "",
            name: Some(name),
            title: None,
            kind_hint: None,
            arguments: &serde_json::Value::Null,
        },
    )
    .kind
}

pub(crate) fn is_web_search_tool_call_id(agent: AgentType, id: &str) -> bool {
    match agent {
        AgentType::Cursor => CursorAdapter::is_web_search_tool_call_id(id),
        AgentType::ClaudeCode | AgentType::Copilot | AgentType::Codex | AgentType::OpenCode => {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{classify, detect_tool_kind};
    use crate::acp::parsers::AgentType;
    use crate::acp::reconciler::RawClassificationInput;
    use crate::acp::session_update::{ToolArguments, ToolKind};

    #[test]
    fn delegates_provider_name_detection_through_reconciler() {
        assert_eq!(
            detect_tool_kind(AgentType::Copilot, "update_todos"),
            ToolKind::Todo
        );
        assert_eq!(
            detect_tool_kind(AgentType::Cursor, "codebase_search"),
            ToolKind::Search
        );
        assert_eq!(
            detect_tool_kind(AgentType::Codex, "shell_command"),
            ToolKind::Execute
        );
    }

    #[test]
    fn detects_read_lints_through_provider_classifiers() {
        for agent in [
            AgentType::ClaudeCode,
            AgentType::Copilot,
            AgentType::Cursor,
            AgentType::Codex,
            AgentType::OpenCode,
        ] {
            assert_eq!(detect_tool_kind(agent, "read_lints"), ToolKind::ReadLints);
        }
    }

    #[test]
    fn uses_argument_shape_when_provider_lookup_misses() {
        let output = classify(
            AgentType::Copilot,
            &RawClassificationInput {
                id: "tool-sql",
                name: Some("unknown"),
                title: Some("Mark all done"),
                kind_hint: Some("other"),
                arguments: &serde_json::json!({
                    "description": "Mark all done",
                    "query": "UPDATE todos SET status = 'done'"
                }),
            },
        );

        assert_eq!(output.kind, ToolKind::Todo);
        assert!(matches!(
            output.arguments,
            ToolArguments::Think { raw: Some(_), .. }
        ));
    }

    #[test]
    fn detects_read_lints_from_title_when_provider_name_is_unknown() {
        let output = classify(
            AgentType::Copilot,
            &RawClassificationInput {
                id: "tool-read-lints",
                name: Some("unknown"),
                title: Some("Read Lints"),
                kind_hint: Some("other"),
                arguments: &serde_json::json!({ "diagnostics": [] }),
            },
        );

        assert_eq!(output.kind, ToolKind::ReadLints);
        assert!(matches!(output.arguments, ToolArguments::ReadLints { .. }));
    }
}
