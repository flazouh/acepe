use super::super::provider::{command_exists, AgentProvider, AgentUiVisibility, SpawnConfig};
use crate::acp::runtime_resolver::SpawnEnvStrategy;

/// Hidden Forge provider backed by the user's PATH.
pub struct ForgeProvider;

impl AgentProvider for ForgeProvider {
    fn id(&self) -> &str {
        "forge"
    }

    fn name(&self) -> &str {
        "Forge"
    }

    fn spawn_config(&self) -> SpawnConfig {
        SpawnConfig {
            command: "forge".to_string(),
            args: vec!["machine".to_string(), "--stdio".to_string()],
            env: std::collections::HashMap::new(),
            env_strategy: Some(forge_env_strategy()),
        }
    }

    fn ui_visibility(&self) -> AgentUiVisibility {
        AgentUiVisibility::Hidden
    }

    fn is_available(&self) -> bool {
        command_exists("forge")
    }
}

fn forge_env_strategy() -> SpawnEnvStrategy {
    SpawnEnvStrategy::FullInherit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forge_provider_uses_machine_stdio() {
        let provider = ForgeProvider;
        let spawn = provider.spawn_config();

        assert_eq!(spawn.command, "forge");
        assert_eq!(spawn.args, vec!["machine", "--stdio"]);
    }

    #[test]
    fn forge_provider_is_hidden() {
        let provider = ForgeProvider;

        assert_eq!(provider.ui_visibility(), AgentUiVisibility::Hidden);
    }
}
