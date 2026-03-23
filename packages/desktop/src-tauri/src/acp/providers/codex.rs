use super::super::provider::{AgentProvider, SpawnConfig};
use crate::acp::{agent_installer, types::CanonicalAgentId};

/// Codex ACP Agent Provider
///
/// Uses a binary downloaded on demand from the ACP registry CDN.
/// The binary is cached at `{app_data_dir}/agents/codex/`.
pub struct CodexProvider;

impl AgentProvider for CodexProvider {
    fn id(&self) -> &str {
        "codex"
    }

    fn name(&self) -> &str {
        "Codex Agent"
    }

    fn spawn_config(&self) -> SpawnConfig {
        let command = resolve_codex_command();
        tracing::info!(path = %command, "Using codex-acp binary");

        let env = crate::shell_env::build_env(crate::shell_env::EnvStrategy::FullInherit);

        SpawnConfig {
            command,
            args: agent_installer::get_cached_args(&CanonicalAgentId::Codex),
            env,
        }
    }

    fn icon(&self) -> &str {
        "codex"
    }

    fn is_available(&self) -> bool {
        agent_installer::is_installed(&CanonicalAgentId::Codex)
    }

    fn uses_wrapper_plan_streaming(&self) -> bool {
        true
    }

    fn clear_message_tracker_on_prompt_response(&self) -> bool {
        true
    }
}

fn resolve_codex_command() -> String {
    if let Some(cached) = agent_installer::get_cached_binary(&CanonicalAgentId::Codex) {
        return cached.to_string_lossy().to_string();
    }
    // Fallback: will fail at spawn time with a clear error
    "codex-acp".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::providers::claude_code::ensure_test_cache_dir;

    #[test]
    fn spawn_config_never_panics() {
        ensure_test_cache_dir();
        let provider = CodexProvider;
        let result = std::panic::catch_unwind(|| provider.spawn_config());

        assert!(result.is_ok(), "spawn_config should never panic");
        let config = result.expect("spawn_config should return config");
        assert!(
            !config.command.trim().is_empty(),
            "spawn command should never be empty"
        );
    }
}
