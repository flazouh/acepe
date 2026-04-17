use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::acp::provider::{AgentProvider, AgentUiVisibility, FrontendProviderProjection};
use crate::acp::providers::{
    ClaudeCodeProvider, CodexProvider, CopilotProvider, CursorProvider, CustomAgentConfig,
    ForgeProvider, OpenCodeProvider,
};
use crate::acp::types::CanonicalAgentId;

/// How an agent is made available to the user.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind")]
pub enum AgentAvailabilityKind {
    /// Available after setup; installed reflects whether the agent is ready to launch.
    #[serde(rename = "installable")]
    Installable { installed: bool },
}

/// Information about an available agent
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub icon: String,
    /// Current setup state for this agent.
    pub availability_kind: AgentAvailabilityKind,
    /// Visible UI modes that support wrapper-managed Autonomous execution.
    pub autonomous_supported_mode_ids: Vec<String>,
    /// Provider-owned metadata for shared frontend surfaces.
    pub provider_metadata: FrontendProviderProjection,
    /// Registry-owned default selection precedence for UI surfaces.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_selection_rank: Option<u16>,
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
    const AGENT_ORDER: [CanonicalAgentId; 5] = [
        CanonicalAgentId::ClaudeCode,
        CanonicalAgentId::Cursor,
        CanonicalAgentId::Copilot,
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
            CanonicalAgentId::Copilot,
            Arc::new(CopilotProvider) as Arc<dyn AgentProvider>,
        );
        built_in.insert(
            CanonicalAgentId::Codex,
            Arc::new(CodexProvider) as Arc<dyn AgentProvider>,
        );
        built_in.insert(
            CanonicalAgentId::Forge,
            Arc::new(ForgeProvider) as Arc<dyn AgentProvider>,
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
        for (index, agent_id) in Self::AGENT_ORDER.iter().enumerate() {
            if let Some(provider) = self.built_in.get(agent_id) {
                if provider.ui_visibility() == AgentUiVisibility::Hidden {
                    continue;
                }

                agents.push(AgentInfo {
                    id: provider.id().to_string(),
                    name: provider.name().to_string(),
                    icon: provider.icon().to_string(),
                    availability_kind: Self::built_in_availability_kind_for(
                        provider.as_ref(),
                        agent_id,
                        check_availability,
                    ),
                    autonomous_supported_mode_ids: provider
                        .autonomous_supported_mode_ids()
                        .iter()
                        .map(|mode_id| (*mode_id).to_string())
                        .collect(),
                    provider_metadata: provider.frontend_projection(),
                    default_selection_rank: Some(index as u16),
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
            if provider.ui_visibility() == AgentUiVisibility::Hidden {
                continue;
            }

            agents.push(AgentInfo {
                id: provider.id().to_string(),
                name: provider.name().to_string(),
                icon: provider.icon().to_string(),
                availability_kind: Self::custom_availability_kind_for(
                    provider.as_ref(),
                    check_availability,
                ),
                autonomous_supported_mode_ids: provider
                    .autonomous_supported_mode_ids()
                    .iter()
                    .map(|mode_id| (*mode_id).to_string())
                    .collect(),
                provider_metadata: provider.frontend_projection(),
                default_selection_rank: None,
            });
        }

        agents
    }

    /// Determine install/setup state for a built-in agent.
    fn built_in_availability_kind_for(
        provider: &dyn AgentProvider,
        agent_id: &CanonicalAgentId,
        check_availability: bool,
    ) -> AgentAvailabilityKind {
        let installed = if check_availability {
            provider.is_available()
        } else if crate::acp::agent_installer::can_auto_install(agent_id) {
            crate::acp::agent_installer::is_installed(agent_id)
        } else {
            false
        };

        AgentAvailabilityKind::Installable { installed }
    }

    /// Determine install/setup state for a custom agent without probing by default.
    fn custom_availability_kind_for(
        provider: &dyn AgentProvider,
        check_availability: bool,
    ) -> AgentAvailabilityKind {
        let installed = if check_availability {
            provider.is_available()
        } else {
            true
        };

        AgentAvailabilityKind::Installable { installed }
    }

    /// Get the first available agent in priority order
    /// Priority is registry-owned: ranked built-ins first, then stable custom ordering.
    pub fn get_first_available(&self) -> Option<CanonicalAgentId> {
        for agent_id in &Self::AGENT_ORDER {
            if let Some(provider) = self.built_in.get(agent_id) {
                if provider.ui_visibility() == AgentUiVisibility::Hidden {
                    continue;
                }

                if provider.is_available() {
                    return Some(agent_id.clone());
                }
            }
        }

        // Check custom agents as fallback
        match self.custom.lock() {
            Ok(custom) => {
                let mut custom_ids = custom.keys().cloned().collect::<Vec<_>>();
                custom_ids.sort_by_key(|agent_id| agent_id.to_string());

                for id in custom_ids {
                    let Some(provider) = custom.get(&id) else {
                        continue;
                    };
                    if provider.ui_visibility() == AgentUiVisibility::Hidden {
                        continue;
                    }

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
                "copilot".to_string(),
                "opencode".to_string(),
                "codex".to_string(),
            ]
        );
    }

    #[test]
    fn copilot_is_marked_installable_for_ui() {
        let registry = AgentRegistry::new();
        let agents = registry.list_all_for_ui();
        let copilot = agents
            .into_iter()
            .find(|agent| agent.id == "copilot")
            .expect("copilot should be listed");

        assert!(matches!(
            copilot.availability_kind,
            AgentAvailabilityKind::Installable { .. }
        ));
    }

    #[test]
    fn list_all_for_ui_includes_autonomous_support_metadata() {
        let registry = AgentRegistry::new();
        let agents = registry.list_all_for_ui();
        let claude = agents
            .iter()
            .find(|agent| agent.id == "claude-code")
            .expect("Claude agent should exist");
        let cursor = agents
            .iter()
            .find(|agent| agent.id == "cursor")
            .expect("Cursor agent should exist");
        let opencode = agents
            .iter()
            .find(|agent| agent.id == "opencode")
            .expect("OpenCode agent should exist");
        let codex = agents
            .iter()
            .find(|agent| agent.id == "codex")
            .expect("Codex agent should exist");

        assert_eq!(
            claude.autonomous_supported_mode_ids,
            vec!["build".to_string()]
        );
        assert_eq!(
            cursor.autonomous_supported_mode_ids,
            vec!["build".to_string()]
        );
        assert_eq!(
            opencode.autonomous_supported_mode_ids,
            vec!["build".to_string()]
        );
        assert_eq!(
            codex.autonomous_supported_mode_ids,
            vec!["build".to_string()]
        );
    }

    #[test]
    fn list_all_for_ui_exposes_default_selection_rank_for_built_ins_only() {
        let registry = AgentRegistry::new();
        registry
            .register_custom(CustomAgentConfig {
                id: "custom-agent".to_string(),
                name: "Custom Agent".to_string(),
                command: "custom-agent".to_string(),
                args: vec![],
                env: HashMap::new(),
            })
            .expect("register custom agent");

        let agents = registry.list_all_for_ui();
        let claude = agents
            .iter()
            .find(|agent| agent.id == "claude-code")
            .expect("Claude agent should exist");
        let custom = agents
            .iter()
            .find(|agent| agent.id == "custom-agent")
            .expect("custom agent should exist");

        assert_eq!(claude.default_selection_rank, Some(0));
        assert_eq!(custom.default_selection_rank, None);
    }

    #[test]
    fn list_all_for_ui_exposes_provider_metadata_projection() {
        let registry = AgentRegistry::new();
        let agents = registry.list_all_for_ui();
        let claude = agents
            .iter()
            .find(|agent| agent.id == "claude-code")
            .expect("Claude agent should exist");
        let copilot = agents
            .iter()
            .find(|agent| agent.id == "copilot")
            .expect("Copilot agent should exist");

        let claude_json = serde_json::to_value(claude).expect("serialize Claude agent");
        let copilot_json = serde_json::to_value(copilot).expect("serialize Copilot agent");

        assert_eq!(
            claude_json["provider_metadata"]["preconnectionSlashMode"],
            serde_json::Value::String("startupGlobal".to_string())
        );
        assert_eq!(
            copilot_json["provider_metadata"]["preconnectionSlashMode"],
            serde_json::Value::String("projectScoped".to_string())
        );
    }

    #[test]
    fn forge_is_registered_as_hidden_provider() {
        let registry = AgentRegistry::new();
        let forge = registry
            .get(&CanonicalAgentId::Forge)
            .expect("forge provider should be registered");

        assert_eq!(forge.id(), "forge");
        assert_eq!(forge.name(), "Forge");
        assert_eq!(forge.ui_visibility(), AgentUiVisibility::Hidden);
    }

    struct HiddenUnavailableProvider;

    impl AgentProvider for HiddenUnavailableProvider {
        fn id(&self) -> &str {
            "forge"
        }

        fn name(&self) -> &str {
            "Forge"
        }

        fn spawn_config(&self) -> crate::acp::provider::SpawnConfig {
            crate::acp::provider::SpawnConfig {
                command: "forge".to_string(),
                args: vec!["machine".to_string(), "--stdio".to_string()],
                env: HashMap::new(),
            }
        }

        fn ui_visibility(&self) -> AgentUiVisibility {
            AgentUiVisibility::Hidden
        }

        fn is_available(&self) -> bool {
            false
        }
    }

    struct VisibleUnavailableProvider;

    impl AgentProvider for VisibleUnavailableProvider {
        fn id(&self) -> &str {
            "forge"
        }

        fn name(&self) -> &str {
            "Forge"
        }

        fn spawn_config(&self) -> crate::acp::provider::SpawnConfig {
            crate::acp::provider::SpawnConfig {
                command: "forge".to_string(),
                args: vec!["machine".to_string(), "--stdio".to_string()],
                env: HashMap::new(),
            }
        }

        fn is_available(&self) -> bool {
            false
        }
    }

    #[test]
    fn list_all_for_ui_omits_hidden_built_in_provider_entries() {
        let mut built_in: HashMap<CanonicalAgentId, Arc<dyn AgentProvider>> = HashMap::new();
        built_in.insert(
            CanonicalAgentId::ClaudeCode,
            Arc::new(HiddenUnavailableProvider),
        );
        let registry = AgentRegistry {
            built_in,
            custom: Mutex::new(HashMap::new()),
        };

        let ids = registry
            .list_all_for_ui()
            .into_iter()
            .map(|agent| agent.id)
            .collect::<Vec<_>>();

        assert!(ids.is_empty());
    }

    #[test]
    fn list_all_for_ui_marks_unavailable_visible_provider_as_not_installed() {
        assert!(matches!(
            AgentRegistry::built_in_availability_kind_for(
                &VisibleUnavailableProvider,
                &CanonicalAgentId::Forge,
                false
            ),
            AgentAvailabilityKind::Installable { installed: false }
        ));
    }

    #[test]
    fn list_all_for_ui_lists_custom_agents_as_installable_without_runtime_probe() {
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

        assert_eq!(agent.id, "custom-agent");
        assert!(matches!(
            agent.availability_kind,
            AgentAvailabilityKind::Installable { installed: true }
        ));
    }

    #[test]
    fn get_first_available_uses_stable_custom_fallback_order() {
        let registry = AgentRegistry {
            built_in: HashMap::new(),
            custom: Mutex::new(HashMap::new()),
        };
        registry
            .register_custom(CustomAgentConfig {
                id: "zebra-agent".to_string(),
                name: "Zebra Agent".to_string(),
                command: "sh".to_string(),
                args: vec![],
                env: HashMap::new(),
            })
            .expect("register zebra agent");
        registry
            .register_custom(CustomAgentConfig {
                id: "alpha-agent".to_string(),
                name: "Alpha Agent".to_string(),
                command: "sh".to_string(),
                args: vec![],
                env: HashMap::new(),
            })
            .expect("register alpha agent");

        assert_eq!(
            registry.get_first_available(),
            Some(CanonicalAgentId::parse("alpha-agent"))
        );
    }

    #[test]
    fn agent_info_serialization_does_not_expose_available_flag() {
        let registry = AgentRegistry::new();
        let agent = registry
            .list_all_for_ui()
            .into_iter()
            .find(|entry| entry.id == "claude-code")
            .expect("claude-code should be listed");

        let value = serde_json::to_value(agent).expect("agent should serialize");
        let object = value
            .as_object()
            .expect("serialized agent should be an object");

        assert!(
            !object.contains_key("available"),
            "ui agent payload should not expose an available flag"
        );
    }
}
