use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::acp::provider::AgentProvider;
use crate::acp::providers::{
    ClaudeCodeProvider, CodexProvider, CursorProvider, CustomAgentConfig, OpenCodeProvider,
};
use crate::acp::types::CanonicalAgentId;

/// How an agent is made available to the user.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind")]
pub enum AgentAvailabilityKind {
    /// Bundled with the app (custom agents)
    #[serde(rename = "bundled")]
    Bundled,
    /// Downloadable on demand (all built-in agents)
    #[serde(rename = "installable")]
    Installable { installed: bool },
}

/// Information about an available agent
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub icon: String,
    /// Whether the agent's command is available in PATH
    pub available: bool,
    /// How this agent is provisioned
    pub availability_kind: AgentAvailabilityKind,
}

/// Registry for managing all available agents (built-in and custom)
pub struct AgentRegistry {
    // Built-in agents are stored as trait objects for flexibility
    built_in: HashMap<CanonicalAgentId, Arc<dyn AgentProvider>>,
    // Custom agents are stored as owned configurations
    custom: Mutex<HashMap<CanonicalAgentId, Arc<dyn AgentProvider>>>,
}

impl AgentRegistry {
    /// Shared agent ordering for all list/get-first operations.
    const AGENT_ORDER: [CanonicalAgentId; 4] = [
        CanonicalAgentId::ClaudeCode,
        CanonicalAgentId::Cursor,
        CanonicalAgentId::OpenCode,
        CanonicalAgentId::Codex,
    ];

    /// Create a new agent registry with built-in agents pre-registered
    pub fn new() -> Self {
        let mut built_in: HashMap<CanonicalAgentId, Arc<dyn AgentProvider>> = HashMap::new();

        // Register built-in providers
        built_in.insert(
            CanonicalAgentId::OpenCode,
            Arc::new(OpenCodeProvider) as Arc<dyn AgentProvider>,
        );
        built_in.insert(
            CanonicalAgentId::ClaudeCode,
            Arc::new(ClaudeCodeProvider) as Arc<dyn AgentProvider>,
        );
        built_in.insert(
            CanonicalAgentId::Cursor,
            Arc::new(CursorProvider) as Arc<dyn AgentProvider>,
        );
        built_in.insert(
            CanonicalAgentId::Codex,
            Arc::new(CodexProvider) as Arc<dyn AgentProvider>,
        );

        Self {
            built_in,
            custom: Mutex::new(HashMap::new()),
        }
    }

    /// Get a provider by agent ID (checks built-in first, then custom)
    pub fn get(&self, agent_id: &CanonicalAgentId) -> Option<Arc<dyn AgentProvider>> {
        // Check built-in first
        if let Some(provider) = self.built_in.get(agent_id) {
            return Some(provider.clone());
        }

        // Check custom
        match self.custom.lock() {
            Ok(custom) => custom.get(agent_id).cloned(),
            Err(error) => {
                tracing::error!(%error, "Custom agents mutex poisoned while fetching provider");
                None
            }
        }
    }

    /// List all available agents (both built-in and custom)
    pub fn list_all(&self) -> Vec<AgentInfo> {
        self.list_agents_with_availability_checks(true)
    }

    /// List all agents for UI display without runtime command probing.
    /// This avoids startup filesystem traversal side effects on macOS.
    pub fn list_all_for_ui(&self) -> Vec<AgentInfo> {
        self.list_agents_with_availability_checks(false)
    }

    fn list_agents_with_availability_checks(&self, check_availability: bool) -> Vec<AgentInfo> {
        let mut agents = Vec::new();

        // Add built-in agents in consistent order.
        for agent_id in &Self::AGENT_ORDER {
            if let Some(provider) = self.built_in.get(agent_id) {
                let availability_kind = Self::availability_kind_for(agent_id);
                let available = match &availability_kind {
                    AgentAvailabilityKind::Bundled => {
                        if check_availability {
                            provider.is_available()
                        } else {
                            true
                        }
                    }
                    AgentAvailabilityKind::Installable { installed } => *installed,
                };
                agents.push(AgentInfo {
                    id: provider.id().to_string(),
                    name: provider.name().to_string(),
                    icon: provider.icon().to_string(),
                    available,
                    availability_kind,
                });
            }
        }

        // Add custom agents (sorted by ID for consistency)
        let custom = match self.custom.lock() {
            Ok(custom) => custom,
            Err(error) => {
                tracing::error!(%error, "Custom agents mutex poisoned while listing providers");
                return agents;
            }
        };
        let mut custom_agents: Vec<_> = custom.values().collect();
        custom_agents.sort_by_key(|provider| provider.id());

        for provider in custom_agents {
            agents.push(AgentInfo {
                id: provider.id().to_string(),
                name: provider.name().to_string(),
                icon: provider.icon().to_string(),
                available: if check_availability {
                    provider.is_available()
                } else {
                    true
                },
                availability_kind: AgentAvailabilityKind::Bundled,
            });
        }

        agents
    }

    /// Determine the availability kind for a built-in agent.
    ///
    /// All built-in agents are installable (downloaded on demand).
    fn availability_kind_for(agent_id: &CanonicalAgentId) -> AgentAvailabilityKind {
        match agent_id {
            CanonicalAgentId::ClaudeCode
            | CanonicalAgentId::Cursor
            | CanonicalAgentId::OpenCode
            | CanonicalAgentId::Codex => {
                let installed = crate::acp::agent_installer::is_installed(agent_id);
                AgentAvailabilityKind::Installable { installed }
            }
            _ => AgentAvailabilityKind::Bundled,
        }
    }

    /// Get the first available agent in priority order
    /// Priority: claude-code > cursor > opencode > codex
    pub fn get_first_available(&self) -> Option<CanonicalAgentId> {
        const PRIORITY_ORDER: &[CanonicalAgentId] = &[
            CanonicalAgentId::ClaudeCode,
            CanonicalAgentId::Cursor,
            CanonicalAgentId::OpenCode,
            CanonicalAgentId::Codex,
        ];

        for agent_id in PRIORITY_ORDER {
            if let Some(provider) = self.built_in.get(agent_id) {
                if provider.is_available() {
                    return Some(agent_id.clone());
                }
            }
        }

        // Check custom agents as fallback
        match self.custom.lock() {
            Ok(custom) => {
                for (id, provider) in custom.iter() {
                    if provider.is_available() {
                        return Some(id.clone());
                    }
                }
            }
            Err(error) => {
                tracing::error!(%error, "Custom agents mutex poisoned while resolving first available agent");
            }
        }

        None
    }

    /// Register a custom agent
    pub fn register_custom(&self, config: CustomAgentConfig) -> Result<()> {
        let id = CanonicalAgentId::parse(&config.id);
        let provider: Arc<dyn AgentProvider> = Arc::new(config);

        let mut custom = self
            .custom
            .lock()
            .map_err(|error| anyhow!("Custom agents mutex poisoned: {error}"))?;
        custom.insert(id, provider);

        Ok(())
    }

    /// Check if an agent exists
    pub fn exists(&self, agent_id: &CanonicalAgentId) -> bool {
        self.get(agent_id).is_some()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_all_for_ui_returns_built_ins_in_stable_order() {
        let registry = AgentRegistry::new();
        let agents = registry.list_all_for_ui();
        let ids = agents.into_iter().map(|agent| agent.id).collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec![
                "claude-code".to_string(),
                "cursor".to_string(),
                "opencode".to_string(),
                "codex".to_string(),
            ]
        );
    }

    #[test]
    fn list_all_for_ui_marks_custom_agents_available_without_runtime_probe() {
        let registry = AgentRegistry::new();
        registry
            .register_custom(CustomAgentConfig {
                id: "custom-agent".to_string(),
                name: "Custom Agent".to_string(),
                command: "definitely-not-installed-command".to_string(),
                args: vec![],
                env: HashMap::new(),
            })
            .expect("register custom agent");

        let agent = registry
            .list_all_for_ui()
            .into_iter()
            .find(|entry| entry.id == "custom-agent")
            .expect("custom agent should be listed");

        assert!(
            agent.available,
            "custom agents should be selectable in UI listing"
        );
    }
}
