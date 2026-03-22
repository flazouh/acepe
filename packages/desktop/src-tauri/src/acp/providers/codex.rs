use super::super::provider::{AgentProvider, SpawnConfig};
use crate::acp::providers::claude_code::get_resource_dir;

/// Codex ACP Agent Provider
///
/// Uses a bundled native binary from `packages/acps/codex/`.
/// The binary is extracted from `@zed-industries/codex-acp-{platform}-{arch}` at build time
/// and bundled into the app resources at `acps/codex/codex-acp`.
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
            args: vec![],
            env,
        }
    }

    fn icon(&self) -> &str {
        "codex"
    }

    fn is_available(&self) -> bool {
        true
    }

    fn uses_wrapper_plan_streaming(&self) -> bool {
        true
    }

    fn clear_message_tracker_on_prompt_response(&self) -> bool {
        true
    }
}

fn resolve_codex_command() -> String {
    let resource_dir = get_resource_dir().expect("RESOURCE_DIR must be set for Codex ACP");
    let path = resource_dir.join("acps/codex/codex-acp");
    assert!(
        path.exists(),
        "Bundled codex-acp binary must exist at {}",
        path.display()
    );
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::providers::claude_code::ensure_test_resource_dir;

    #[test]
    fn spawn_config_never_panics() {
        ensure_test_resource_dir();
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
