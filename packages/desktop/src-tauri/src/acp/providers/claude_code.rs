use super::super::provider::{
    command_exists, AgentProvider, CommandAvailabilityCache, SpawnConfig,
};
use crate::acp::client_trait::CommunicationMode;
use crate::acp::session_update::PlanSource;
use crate::acp::{agent_installer, types::CanonicalAgentId};

/// Claude Code Agent Provider — uses cc-sdk for direct Rust ↔ Claude CLI communication
pub struct ClaudeCodeProvider;

impl AgentProvider for ClaudeCodeProvider {
    fn id(&self) -> &str {
        "claude-code"
    }

    fn name(&self) -> &str {
        "Claude Code"
    }

    fn spawn_config(&self) -> SpawnConfig {
        // Not used for CcSdk mode, but trait requires it.
        // Fallback to ACP spawn configs for compatibility.
        self.spawn_configs()
            .into_iter()
            .next()
            .expect("Claude provider must always return at least one spawn config")
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        resolve_claude_spawn_configs()
    }

    fn communication_mode(&self) -> CommunicationMode {
        CommunicationMode::CcSdk
    }

    fn icon(&self) -> &str {
        "claude"
    }

    fn is_available(&self) -> bool {
        // cc-sdk handles CLI resolution internally; check if `claude` is in PATH
        command_exists("claude")
            || agent_installer::is_installed(&CanonicalAgentId::ClaudeCode)
            || std::env::var("CLAUDE_CODE_ACP_PATH")
                .ok()
                .filter(|p| !p.trim().is_empty())
                .is_some()
            || command_exists("claude-code-acp")
    }

    fn model_discovery_commands(&self) -> Vec<SpawnConfig> {
        vec![SpawnConfig {
            command: "claude".to_string(),
            args: vec![
                "--no-session-persistence".to_string(),
                "-p".to_string(),
                "Return only the exact current model id. Output the raw model id only, with no markdown or explanation."
                    .to_string(),
            ],
            env: claude_env(),
        }]
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match id {
            "default" | "acceptEdits" => "build".to_string(),
            other => other.to_string(),
        }
    }

    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        match mode_id {
            "build" => "default".to_string(),
            other => other.to_string(),
        }
    }

    fn default_plan_source(&self) -> PlanSource {
        PlanSource::Deterministic
    }

    fn uses_task_reconciler(&self) -> bool {
        true
    }
}

fn resolve_claude_spawn_configs() -> Vec<SpawnConfig> {
    let mut configs = Vec::new();

    // 1. Env var override (dev use)
    if let Some(override_path) = std::env::var("CLAUDE_CODE_ACP_PATH")
        .ok()
        .filter(|path| !path.trim().is_empty())
    {
        push_unique_spawn_config(&mut configs, spawn_config_from_path(override_path));
    }

    // 2. Cached binary (downloaded on demand)
    if let Some(cached) = agent_installer::get_cached_binary(&CanonicalAgentId::ClaudeCode) {
        let args = agent_installer::get_cached_args(&CanonicalAgentId::ClaudeCode);
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: cached.to_string_lossy().to_string(),
                args,
                env: claude_env(),
            },
        );
    }

    // 3. System binary in PATH
    if command_exists("claude-code-acp") {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "claude-code-acp".to_string(),
                args: vec![],
                env: claude_env(),
            },
        );
    }

    // 4. bunx fallback
    let command_cache = CommandAvailabilityCache::get();
    if command_cache.bunx {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "bunx".to_string(),
                args: vec!["@zed-industries/claude-code-acp".to_string()],
                env: claude_env(),
            },
        );
    }

    // 5. npx fallback
    if command_cache.npx {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@zed-industries/claude-code-acp@latest".to_string(),
                ],
                env: claude_env(),
            },
        );
    }

    assert!(
        !configs.is_empty(),
        "Claude provider must have at least one launcher"
    );

    configs
}

fn spawn_config_from_path(path: String) -> SpawnConfig {
    if path.ends_with(".mjs") || path.ends_with(".js") {
        return SpawnConfig {
            command: "node".to_string(),
            args: vec![path],
            env: claude_env(),
        };
    }

    SpawnConfig {
        command: path,
        args: vec![],
        env: claude_env(),
    }
}

fn claude_env() -> std::collections::HashMap<String, String> {
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

/// Sets up a test agent cache directory with stub binaries for Claude and Codex.
/// Idempotent; safe to call from both Claude and Codex tests.
#[cfg(test)]
pub(crate) fn ensure_test_cache_dir() {
    use std::fs;
    use std::io::Write;
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let temp = tempfile::tempdir().expect("temp dir");
        let p = temp.path();

        // Create claude-code cached agent with meta.json
        let claude_dir = p.join("claude-code");
        fs::create_dir_all(&claude_dir).expect("create claude-code");
        fs::File::create(claude_dir.join("claude-agent-acp"))
            .expect("create stub")
            .write_all(b"stub")
            .expect("write stub");
        let meta = serde_json::json!({
            "version": "0.1.0",
            "archive_url": "https://github.com/flazouh/acepe/releases/test",
            "sha256": null,
            "downloaded_at": "2026-01-01T00:00:00Z",
            "cmd": "./claude-agent-acp",
            "args": []
        });
        fs::write(
            claude_dir.join("meta.json"),
            serde_json::to_string_pretty(&meta).unwrap(),
        )
        .expect("write meta.json");

        // Create codex cached agent with meta.json
        let codex_dir = p.join("codex");
        fs::create_dir_all(&codex_dir).expect("create codex");
        fs::File::create(codex_dir.join("codex-acp"))
            .expect("create stub")
            .write_all(b"stub")
            .expect("write stub");
        let meta = serde_json::json!({
            "version": "0.9.5",
            "archive_url": "https://cdn.agentclientprotocol.com/test",
            "sha256": null,
            "downloaded_at": "2026-01-01T00:00:00Z",
            "cmd": "./codex-acp",
            "args": []
        });
        fs::write(
            codex_dir.join("meta.json"),
            serde_json::to_string_pretty(&meta).unwrap(),
        )
        .expect("write meta.json");

        agent_installer::set_cache_dir(p.to_path_buf());
        Box::leak(Box::new(temp));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_config_never_panics() {
        ensure_test_cache_dir();
        let provider = ClaudeCodeProvider;
        let result = std::panic::catch_unwind(|| provider.spawn_config());

        assert!(result.is_ok(), "spawn_config should never panic");
        let config = result.expect("spawn_config should return config");
        assert!(
            !config.command.trim().is_empty(),
            "spawn command should never be empty"
        );
    }

    #[test]
    fn spawn_configs_prefer_explicit_override_path() {
        ensure_test_cache_dir();
        let provider = ClaudeCodeProvider;
        let override_path = "/tmp/custom-claude-agent-acp";

        std::env::set_var("CLAUDE_CODE_ACP_PATH", override_path);
        let configs = provider.spawn_configs();
        std::env::remove_var("CLAUDE_CODE_ACP_PATH");

        assert_eq!(configs[0].command, override_path);
        assert!(configs[0].args.is_empty());
    }

    #[test]
    fn spawn_configs_use_cached_binary_when_no_override_is_set() {
        ensure_test_cache_dir();
        let provider = ClaudeCodeProvider;

        std::env::remove_var("CLAUDE_CODE_ACP_PATH");
        let configs = provider.spawn_configs();

        assert!(
            configs[0].command.contains("claude-agent-acp"),
            "expected cached Claude ACP binary, got {}",
            configs[0].command
        );
    }

    #[test]
    fn model_discovery_uses_claude_print_mode() {
        let provider = ClaudeCodeProvider;
        let attempts = provider.model_discovery_commands();

        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].command, "claude");
        assert_eq!(attempts[0].args[0], "--no-session-persistence");
        assert_eq!(attempts[0].args[1], "-p");
    }

    #[test]
    fn claude_provider_exposes_multiple_model_candidates() {
        let provider = ClaudeCodeProvider;
        let models = provider.default_model_candidates();

        assert!(models.len() >= 3);
        assert!(models
            .iter()
            .any(|model| model.model_id == "claude-opus-4-6"));
        assert!(models
            .iter()
            .any(|model| model.model_id == "claude-sonnet-4-5-20250929"));
        assert!(models
            .iter()
            .any(|model| model.model_id == "claude-haiku-4-5-20251001"));
    }
}
