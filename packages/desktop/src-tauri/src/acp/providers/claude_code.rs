use super::super::provider::{command_exists, AgentProvider, ModelFallbackCandidate, SpawnConfig};
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
        agent_installer::get_cached_binary(&CanonicalAgentId::ClaudeCode).is_some()
            || command_exists("claude")
            || command_exists("claude-code")
    }

    fn model_discovery_commands(&self) -> Vec<SpawnConfig> {
        let primary = resolve_claude_spawn_configs()
            .into_iter()
            .next()
            .unwrap_or(SpawnConfig {
                command: "claude".to_string(),
                args: vec![],
                env: claude_env(),
            });

        let mut args = primary.args;
        args.extend([
            "--no-session-persistence".to_string(),
            "-p".to_string(),
            "Return only the exact current model id. Output the raw model id only, with no markdown or explanation."
                .to_string(),
        ]);

        vec![SpawnConfig {
            command: primary.command,
            args,
            env: primary.env,
        }]
    }

    fn default_model_candidates(&self) -> Vec<ModelFallbackCandidate> {
        vec![
            ModelFallbackCandidate {
                model_id: cc_sdk::model_recommendation::best_model().to_string(),
                name: "Claude Opus 4.6".to_string(),
                description: Some("Most capable Claude model".to_string()),
            },
            ModelFallbackCandidate {
                model_id: cc_sdk::model_recommendation::balanced_model().to_string(),
                name: "Claude Sonnet 4.5".to_string(),
                description: Some("Balanced Claude model for most tasks".to_string()),
            },
            ModelFallbackCandidate {
                model_id: cc_sdk::model_recommendation::cheapest_model().to_string(),
                name: "Claude Haiku 4.5".to_string(),
                description: Some("Fastest and cheapest Claude model".to_string()),
            },
        ]
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

    fn autonomous_supported_mode_ids(&self) -> &'static [&'static str] {
        &["build"]
    }

    fn map_execution_profile_mode_id(
        &self,
        mode_id: &str,
        autonomous_enabled: bool,
    ) -> Option<String> {
        match (mode_id, autonomous_enabled) {
            ("build", false) => Some("default".to_string()),
            ("build", true) => Some("bypassPermissions".to_string()),
            ("plan", false) => Some("plan".to_string()),
            ("plan", true) => None,
            (_, false) => Some(self.map_outbound_mode_id(mode_id)),
            (_, true) => None,
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

    // 1. Cached Claude CLI (managed by the vendored SDK).
    if let Some(cached) = agent_installer::get_cached_binary(&CanonicalAgentId::ClaudeCode) {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: cached.to_string_lossy().to_string(),
                args: vec![],
                env: claude_env(),
            },
        );
    }

    // 2. System Claude CLI in PATH.
    if command_exists("claude") {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "claude".to_string(),
                args: vec![],
                env: claude_env(),
            },
        );
    }

    // 3. Alternate command name used by some installs.
    if command_exists("claude-code") {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "claude-code".to_string(),
                args: vec![],
                env: claude_env(),
            },
        );
    }

    if configs.is_empty() {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "claude".to_string(),
                args: vec![],
                env: claude_env(),
            },
        );
    }

    configs
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_config_never_panics() {
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
    fn spawn_configs_return_a_launcher_candidate() {
        let provider = ClaudeCodeProvider;
        let configs = provider.spawn_configs();

        assert!(!configs.is_empty());
        assert!(configs
            .iter()
            .all(|config| !config.command.trim().is_empty()));
    }

    #[test]
    fn model_discovery_uses_claude_print_mode() {
        let provider = ClaudeCodeProvider;
        let attempts = provider.model_discovery_commands();

        assert_eq!(attempts.len(), 1);
        assert!(!attempts[0].command.trim().is_empty());
        assert_eq!(attempts[0].args[0], "--no-session-persistence");
        assert_eq!(attempts[0].args[1], "-p");
    }

    #[test]
    fn provider_uses_cc_sdk_communication_mode() {
        let provider = ClaudeCodeProvider;

        assert_eq!(provider.communication_mode(), CommunicationMode::CcSdk);
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

    #[test]
    fn claude_provider_reports_autonomous_support_for_build_only() {
        let provider = ClaudeCodeProvider;

        assert_eq!(provider.autonomous_supported_mode_ids(), &["build"]);
    }

    #[test]
    fn claude_provider_maps_execution_profiles() {
        let provider = ClaudeCodeProvider;

        assert_eq!(
            provider.map_execution_profile_mode_id("build", false),
            Some("default".to_string())
        );
        assert_eq!(
            provider.map_execution_profile_mode_id("build", true),
            Some("bypassPermissions".to_string())
        );
        assert_eq!(
            provider.map_execution_profile_mode_id("plan", false),
            Some("plan".to_string())
        );
        assert_eq!(provider.map_execution_profile_mode_id("plan", true), None);
    }
}
