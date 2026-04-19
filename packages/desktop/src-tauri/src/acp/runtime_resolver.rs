use crate::acp::provider::SpawnConfig;
use crate::db::repository::AppSettingsRepository;
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const AGENT_ENV_OVERRIDES_KEY: &str = "agent_env_overrides";

pub type AgentEnvOverrides = HashMap<String, HashMap<String, String>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SpawnEnvStrategy {
    FullInherit,
    Allowlist(Vec<String>),
}

impl SpawnEnvStrategy {
    pub fn allowlist(keys: &[&str]) -> Self {
        Self::Allowlist(keys.iter().map(|key| (*key).to_string()).collect())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveRuntime {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: HashMap<String, String>,
}

pub async fn load_saved_agent_env_overrides(
    app_handle: &AppHandle,
) -> Result<AgentEnvOverrides, String> {
    let db = app_handle.state::<DbConn>();
    let raw = AppSettingsRepository::get(db.inner(), AGENT_ENV_OVERRIDES_KEY)
        .await
        .map_err(|error| error.to_string())?;

    match raw {
        Some(json) => {
            serde_json::from_str::<AgentEnvOverrides>(&json).map_err(|error| error.to_string())
        }
        None => Ok(HashMap::new()),
    }
}

pub fn is_protected_agent_env_override_key(key: &str) -> bool {
    ((cfg!(windows) && key.eq_ignore_ascii_case("PATH")) || key == "PATH")
        || crate::shell_env::is_denied_env_key(key)
}

pub fn apply_saved_agent_env_overrides(
    agent_id: &str,
    mut base_env: HashMap<String, String>,
    overrides: &AgentEnvOverrides,
) -> HashMap<String, String> {
    let Some(agent_overrides) = overrides.get(agent_id) else {
        return base_env;
    };

    for (key, value) in agent_overrides {
        if is_protected_agent_env_override_key(key) {
            continue;
        }
        base_env.insert(key.clone(), value.clone());
    }

    base_env
}

pub fn resolve_effective_runtime(
    provider_id: &str,
    cwd: &Path,
    spawn_config: &SpawnConfig,
    overrides: Option<&AgentEnvOverrides>,
) -> EffectiveRuntime {
    let base_env = match &spawn_config.env_strategy {
        Some(strategy) => crate::shell_env::build_env_for_strategy(strategy),
        None => HashMap::new(),
    };
    let mut env = if base_env.is_empty() {
        spawn_config.env.clone()
    } else {
        let mut merged_env = base_env;
        for (key, value) in &spawn_config.env {
            merged_env.insert(key.clone(), value.clone());
        }
        merged_env
    };

    if let Some(overrides) = overrides {
        env = apply_saved_agent_env_overrides(provider_id, env, overrides);
    }

    EffectiveRuntime {
        command: spawn_config.command.clone(),
        args: spawn_config.args.clone(),
        cwd: cwd.to_path_buf(),
        env,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_effective_runtime_uses_declared_strategy_and_overlays_explicit_env() {
        let spawn_config = SpawnConfig {
            command: "codex".to_string(),
            args: vec!["app-server".to_string()],
            env: HashMap::from([("EXTRA".to_string(), "value".to_string())]),
            env_strategy: Some(SpawnEnvStrategy::Allowlist(vec!["HOME".to_string()])),
        };
        let cwd = PathBuf::from("/tmp/project");

        let runtime = resolve_effective_runtime("codex", &cwd, &spawn_config, None);

        assert_eq!(runtime.command, "codex");
        assert_eq!(runtime.args, vec!["app-server"]);
        assert_eq!(runtime.cwd, cwd);
        assert_eq!(runtime.env.get("EXTRA"), Some(&"value".to_string()));
        assert!(runtime.env.contains_key("PATH"));
    }

    #[test]
    fn resolve_effective_runtime_applies_saved_overrides_last() {
        let spawn_config = SpawnConfig {
            command: "codex".to_string(),
            args: vec!["app-server".to_string()],
            env: HashMap::from([("AZURE_API_KEY".to_string(), "from-config".to_string())]),
            env_strategy: None,
        };
        let overrides = HashMap::from([(
            "codex".to_string(),
            HashMap::from([("AZURE_API_KEY".to_string(), "from-override".to_string())]),
        )]);

        let runtime = resolve_effective_runtime(
            "codex",
            Path::new("/tmp/project"),
            &spawn_config,
            Some(&overrides),
        );

        assert_eq!(
            runtime.env.get("AZURE_API_KEY"),
            Some(&"from-override".to_string())
        );
    }
}
