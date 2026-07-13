//! Provider tool-name → `ToolKind` tables wired to tool_identity adapters.

use crate::acp::parsers::{get_parser, AgentType};
use crate::acp::session::ingress::tool_identity::{
    classify_raw_tool_call, providers, ClassifiedToolData, ToolClassificationHints,
};
use crate::acp::session_update::ToolKind;
use crate::acp::types::CanonicalAgentId;

/// Provider tool identity table — registered on every `ProviderPlugin` for ingress normalization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolTable {
    pub agent_id: CanonicalAgentId,
}

impl ToolTable {
    #[must_use]
    pub const fn new(agent_id: CanonicalAgentId) -> Self {
        Self { agent_id }
    }

    fn agent_type(&self) -> AgentType {
        match self.agent_id {
            CanonicalAgentId::ClaudeCode => AgentType::ClaudeCode,
            CanonicalAgentId::Copilot => AgentType::Copilot,
            CanonicalAgentId::OpenCode => AgentType::OpenCode,
            CanonicalAgentId::Cursor => AgentType::Cursor,
            CanonicalAgentId::Codex => AgentType::Codex,
            CanonicalAgentId::Forge | CanonicalAgentId::Custom(_) => AgentType::ClaudeCode,
        }
    }

    /// Resolve a provider tool name to canonical [`ToolKind`] via the tool_identity adapter table.
    #[must_use]
    pub fn detect_tool_kind(&self, name: &str) -> ToolKind {
        providers::detect_tool_kind(self.agent_type(), name)
    }

    /// Classify raw tool arguments through the tool_identity ingress path.
    #[must_use]
    pub fn classify_raw_tool_call(
        &self,
        tool_call_id: &str,
        raw_arguments: &serde_json::Value,
        hints: ToolClassificationHints<'_>,
    ) -> ClassifiedToolData {
        classify_raw_tool_call(
            get_parser(self.agent_type()),
            tool_call_id,
            raw_arguments,
            hints,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ToolKind;

    #[test]
    fn tool_table_delegates_detect_tool_kind_to_reconciler_adapters() {
        let table = ToolTable::new(CanonicalAgentId::Codex);
        assert_eq!(table.detect_tool_kind("shell_command"), ToolKind::Execute);
    }

    #[test]
    fn tool_table_classifies_raw_tool_call_with_adapter_hints() {
        let table = ToolTable::new(CanonicalAgentId::Copilot);
        let classified = table.classify_raw_tool_call(
            "tool-1",
            &serde_json::json!({ "file_path": "/repo/README.md" }),
            ToolClassificationHints {
                name: Some("read"),
                title: None,
                kind: None,
                kind_hint: None,
                locations: None,
            },
        );
        assert_eq!(classified.kind, ToolKind::Read);
    }
}
