//! Provider plugin registry — one registration point per agent history and live source.

use crate::acp::parsers::AgentType;
use crate::acp::session::ingress::live::AcpLiveSource;
use crate::acp::session::ingress::providers::claude_code::ClaudeHistorySource;
use crate::acp::session::ingress::providers::codex::CodexHistorySource;
use crate::acp::session::ingress::providers::copilot::CopilotHistorySource;
use crate::acp::session::ingress::providers::cursor::CursorHistorySource;
use crate::acp::session::ingress::providers::opencode::OpenCodeHistorySource;
use crate::acp::session::ingress::source::{HistorySource, LiveSource};
use crate::acp::session::ingress::tool_table::ToolTable;
use crate::acp::types::CanonicalAgentId;

/// Bundled history + live ingress sources for one registered agent.
pub struct ProviderPlugin {
    pub agent_id: CanonicalAgentId,
    pub history: &'static dyn HistorySource,
    pub live: &'static dyn LiveSource,
    pub tool_table: &'static ToolTable,
}

/// Typed result for one plugin source capability.
///
/// Forge uses a separate machine protocol and custom agents have no declared
/// ingress contract yet, so neither may silently borrow another provider's
/// source implementation.
pub enum ProviderSourceCapability<T: ?Sized + 'static> {
    Available(&'static T),
    Unsupported { agent_id: CanonicalAgentId },
}

impl<T: ?Sized + 'static> ProviderSourceCapability<T> {
    fn available(self) -> Option<&'static T> {
        match self {
            Self::Available(source) => Some(source),
            Self::Unsupported { .. } => None,
        }
    }
}

static CURSOR_HISTORY: CursorHistorySource = CursorHistorySource;
static CLAUDE_HISTORY: ClaudeHistorySource = ClaudeHistorySource;
static OPENCODE_HISTORY: OpenCodeHistorySource = OpenCodeHistorySource;
static COPILOT_HISTORY: CopilotHistorySource = CopilotHistorySource;
static CODEX_HISTORY: CodexHistorySource = CodexHistorySource;

static CURSOR_LIVE: AcpLiveSource = AcpLiveSource::new(AgentType::Cursor, CanonicalAgentId::Cursor);
static CLAUDE_LIVE: AcpLiveSource =
    AcpLiveSource::new(AgentType::ClaudeCode, CanonicalAgentId::ClaudeCode);
static OPENCODE_LIVE: AcpLiveSource =
    AcpLiveSource::new(AgentType::OpenCode, CanonicalAgentId::OpenCode);
static COPILOT_LIVE: AcpLiveSource =
    AcpLiveSource::new(AgentType::Copilot, CanonicalAgentId::Copilot);
static CODEX_LIVE: AcpLiveSource = AcpLiveSource::new(AgentType::Codex, CanonicalAgentId::Codex);

static CURSOR_TOOL_TABLE: ToolTable = ToolTable::new(CanonicalAgentId::Cursor);
static CLAUDE_TOOL_TABLE: ToolTable = ToolTable::new(CanonicalAgentId::ClaudeCode);
static OPENCODE_TOOL_TABLE: ToolTable = ToolTable::new(CanonicalAgentId::OpenCode);
static COPILOT_TOOL_TABLE: ToolTable = ToolTable::new(CanonicalAgentId::Copilot);
static CODEX_TOOL_TABLE: ToolTable = ToolTable::new(CanonicalAgentId::Codex);

static PLUGINS: [ProviderPlugin; 5] = [
    ProviderPlugin {
        agent_id: CanonicalAgentId::Cursor,
        history: &CURSOR_HISTORY,
        live: &CURSOR_LIVE,
        tool_table: &CURSOR_TOOL_TABLE,
    },
    ProviderPlugin {
        agent_id: CanonicalAgentId::ClaudeCode,
        history: &CLAUDE_HISTORY,
        live: &CLAUDE_LIVE,
        tool_table: &CLAUDE_TOOL_TABLE,
    },
    ProviderPlugin {
        agent_id: CanonicalAgentId::OpenCode,
        history: &OPENCODE_HISTORY,
        live: &OPENCODE_LIVE,
        tool_table: &OPENCODE_TOOL_TABLE,
    },
    ProviderPlugin {
        agent_id: CanonicalAgentId::Copilot,
        history: &COPILOT_HISTORY,
        live: &COPILOT_LIVE,
        tool_table: &COPILOT_TOOL_TABLE,
    },
    ProviderPlugin {
        agent_id: CanonicalAgentId::Codex,
        history: &CODEX_HISTORY,
        live: &CODEX_LIVE,
        tool_table: &CODEX_TOOL_TABLE,
    },
];

/// Returns the registered plugin for `agent`, if any.
#[must_use]
pub fn plugin_for(agent: &CanonicalAgentId) -> Option<&'static ProviderPlugin> {
    PLUGINS.iter().find(|plugin| &plugin.agent_id == agent)
}

/// Returns the registered history source for `agent`, if any.
#[must_use]
pub fn history_source_for(agent: &CanonicalAgentId) -> Option<&'static dyn HistorySource> {
    history_capability_for(agent).available()
}

/// Returns the registered live source for `agent`, if any.
#[must_use]
pub fn live_source_for(agent: &CanonicalAgentId) -> Option<&'static dyn LiveSource> {
    live_capability_for(agent).available()
}

/// Resolve history support without collapsing unsupported providers into an
/// ambiguous `None` at the plugin boundary.
#[must_use]
pub fn history_capability_for(
    agent: &CanonicalAgentId,
) -> ProviderSourceCapability<dyn HistorySource> {
    match plugin_for(agent) {
        Some(plugin) => ProviderSourceCapability::Available(plugin.history),
        None => ProviderSourceCapability::Unsupported {
            agent_id: agent.clone(),
        },
    }
}

/// Resolve live normalization support with explicit Forge/Custom behavior.
#[must_use]
pub fn live_capability_for(agent: &CanonicalAgentId) -> ProviderSourceCapability<dyn LiveSource> {
    match plugin_for(agent) {
        Some(plugin) => ProviderSourceCapability::Available(plugin.live),
        None => ProviderSourceCapability::Unsupported {
            agent_id: agent.clone(),
        },
    }
}

/// Returns the registered tool table for `agent`, if any.
#[must_use]
pub fn tool_table_for(agent: &CanonicalAgentId) -> Option<&'static ToolTable> {
    plugin_for(agent).map(|plugin| plugin.tool_table)
}

/// Iterates every agent id with a registered plugin.
pub fn registered_agents() -> impl Iterator<Item = CanonicalAgentId> {
    PLUGINS.iter().map(|plugin| plugin.agent_id.clone())
}

#[cfg(test)]
mod tests {
    use super::{
        history_capability_for, live_capability_for, registered_agents, ProviderSourceCapability,
    };
    use crate::acp::types::CanonicalAgentId;

    #[test]
    fn forge_sources_are_explicitly_unsupported() {
        assert!(matches!(
            history_capability_for(&CanonicalAgentId::Forge),
            ProviderSourceCapability::Unsupported {
                agent_id: CanonicalAgentId::Forge
            }
        ));
        assert!(matches!(
            live_capability_for(&CanonicalAgentId::Forge),
            ProviderSourceCapability::Unsupported {
                agent_id: CanonicalAgentId::Forge
            }
        ));
    }

    #[test]
    fn custom_sources_are_explicitly_unsupported_without_faking_claude_ownership() {
        let custom = CanonicalAgentId::Custom("my-agent".to_string());
        assert!(matches!(
            history_capability_for(&custom),
            ProviderSourceCapability::Unsupported {
                agent_id: CanonicalAgentId::Custom(id)
            } if id == "my-agent"
        ));
        assert!(matches!(
            live_capability_for(&custom),
            ProviderSourceCapability::Unsupported {
                agent_id: CanonicalAgentId::Custom(id)
            } if id == "my-agent"
        ));
    }

    #[test]
    fn every_registered_provider_source_is_typed_as_available() {
        for agent_id in registered_agents() {
            assert!(matches!(
                history_capability_for(&agent_id),
                ProviderSourceCapability::Available(_)
            ));
            let ProviderSourceCapability::Available(live) = live_capability_for(&agent_id) else {
                panic!("registered provider {agent_id:?} must have live ingress");
            };
            assert_eq!(live.agent_id(), agent_id);
        }
    }
}
