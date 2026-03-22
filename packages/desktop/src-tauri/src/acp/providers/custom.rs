use super::super::provider::{command_exists, AgentProvider, SpawnConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for user-defined custom agents
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CustomAgentConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

impl AgentProvider for CustomAgentConfig {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn spawn_config(&self) -> SpawnConfig {
        SpawnConfig {
            command: self.command.clone(),
            args: self.args.clone(),
            env: self.env.clone(),
        }
    }

    fn icon(&self) -> &str {
        "terminal"
    }

    fn is_available(&self) -> bool {
        command_exists(&self.command)
    }
}
