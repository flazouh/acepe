use super::super::provider::{command_exists, AgentProvider, SpawnConfig};
use crate::acp::client_trait::CommunicationMode;
use crate::acp::{agent_installer, types::CanonicalAgentId};

/// Native Codex app-server provider.
pub struct CodexProvider;

impl AgentProvider for CodexProvider {
    fn id(&self) -> &str {
        "codex"
    }

    fn name(&self) -> &str {
        "Codex Agent"
    }

    fn spawn_config(&self) -> SpawnConfig {
        self.spawn_configs()
            .into_iter()
            .next()
            .expect("Codex provider must return at least one spawn config")
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        let mut configs = Vec::new();

        if let Some(cached) = agent_installer::get_cached_binary(&CanonicalAgentId::Codex) {
            push_unique_spawn_config(
                &mut configs,
                SpawnConfig {
                    command: cached.to_string_lossy().to_string(),
                    args: vec!["app-server".to_string()],
                    env: codex_env(),
                },
            );
        }

        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "codex".to_string(),
                args: vec!["app-server".to_string()],
                env: codex_env(),
            },
        );

        configs
    }

    fn communication_mode(&self) -> CommunicationMode {
        CommunicationMode::CodexNative
    }

    fn icon(&self) -> &str {
        "codex"
    }

    fn is_available(&self) -> bool {
        agent_installer::get_cached_binary(&CanonicalAgentId::Codex).is_some()
            || command_exists("codex")
    }

    fn uses_wrapper_plan_streaming(&self) -> bool {
        true
    }

    fn clear_message_tracker_on_prompt_response(&self) -> bool {
        true
    }
}

fn codex_env() -> std::collections::HashMap<String, String> {
    crate::shell_env::build_env(crate::shell_env::EnvStrategy::FullInherit)
}

fn push_unique_spawn_config(configs: &mut Vec<SpawnConfig>, candidate: SpawnConfig) {
    let exists = configs
        .iter()
        .any(|config| config.command == candidate.command && config.args == candidate.args);
    if !exists {
        configs.push(candidate);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::sync::Once;

    fn test_codex_binary_name() -> &'static str {
        #[cfg(windows)]
        {
            return "codex.exe";
        }

        #[cfg(not(windows))]
        {
            return "codex";
        }
    }

    fn test_codex_meta_command() -> &'static str {
        #[cfg(windows)]
        {
            return "./codex.exe";
        }

        #[cfg(not(windows))]
        {
            return "./codex";
        }
    }

    fn ensure_test_codex_cache_dir() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let temp = tempfile::tempdir().expect("temp dir");
            let p = temp.path();

            let codex_dir = p.join("codex");
            fs::create_dir_all(&codex_dir).expect("create codex");
            fs::File::create(codex_dir.join(test_codex_binary_name()))
                .expect("create stub")
                .write_all(b"stub")
                .expect("write stub");
            let meta = serde_json::json!({
                "version": "0.117.0",
                "archive_url": "https://github.com/openai/codex/releases/test",
                "sha256": null,
                "downloaded_at": "2026-01-01T00:00:00Z",
                "cmd": test_codex_meta_command(),
                "args": []
            });
            fs::write(
                codex_dir.join("meta.json"),
                serde_json::to_string_pretty(&meta).expect("serialize meta"),
            )
            .expect("write meta.json");

            agent_installer::set_cache_dir(p.to_path_buf());
            Box::leak(Box::new(temp));
        });
    }

    #[test]
    fn spawn_config_never_panics() {
        let provider = CodexProvider;
        let result = std::panic::catch_unwind(|| provider.spawn_config());

        assert!(result.is_ok(), "spawn_config should never panic");
        let config = result.expect("spawn_config should return config");
        assert!(
            !config.command.trim().is_empty(),
            "spawn command should never be empty"
        );
    }

    #[test]
    fn spawn_config_uses_native_codex_app_server() {
        let provider = CodexProvider;
        let config = provider.spawn_config();

        assert_eq!(config.args, vec!["app-server".to_string()]);
        assert!(!config.command.trim().is_empty());
    }

    #[test]
    fn spawn_config_prefers_cached_codex_binary_when_available() {
        ensure_test_codex_cache_dir();
        let provider = CodexProvider;
        let config = provider.spawn_config();

        assert_ne!(config.command, "codex");
        assert!(
            config.command.ends_with("codex") || config.command.ends_with("codex.exe"),
            "expected cached Codex binary path, got {}",
            config.command
        );
        assert_eq!(config.args, vec!["app-server".to_string()]);
    }

    #[test]
    fn provider_uses_native_communication_mode() {
        let provider = CodexProvider;

        assert_eq!(
            provider.communication_mode(),
            CommunicationMode::CodexNative
        );
    }
}
