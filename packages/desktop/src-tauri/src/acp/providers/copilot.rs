use super::super::provider::{AgentProvider, SpawnConfig};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::parsers::AgentType;
use crate::acp::{agent_installer, types::CanonicalAgentId};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

/// GitHub Copilot CLI ACP provider.
pub struct CopilotProvider;

const COPILOT_BINARY_OVERRIDE_ENV: &str = "ACEPE_COPILOT_BIN";
const ACP_STDIO_ARGS: &[&str] = &["--acp", "--stdio"];
const COPILOT_LOGIN_METHOD_ID: &str = "copilot-login";
const COPILOT_MODE_AGENT_URI: &str = "https://github.com/github/copilot-cli/mode#agent";
const COPILOT_MODE_PLAN_URI: &str = "https://github.com/github/copilot-cli/mode#plan";
const COPILOT_MODE_AUTOPILOT_URI: &str = "https://github.com/github/copilot-cli/mode#autopilot";
const ALLOWED_ENV_KEYS: &[&str] = &[
    "PATH",
    "HOME",
    "TERM",
    "TMPDIR",
    "SHELL",
    "USER",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SSH_AUTH_SOCK",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
];

impl AgentProvider for CopilotProvider {
    fn id(&self) -> &str {
        "copilot"
    }

    fn name(&self) -> &str {
        "GitHub Copilot"
    }

    fn spawn_config(&self) -> SpawnConfig {
        self.spawn_configs()
            .into_iter()
            .next()
            .unwrap_or_else(|| SpawnConfig {
                command: "__acepe_missing_copilot_binary__".to_string(),
                args: ACP_STDIO_ARGS
                    .iter()
                    .map(|arg| (*arg).to_string())
                    .collect(),
                env: filtered_env(),
            })
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        resolve_copilot_spawn_configs(
            agent_installer::get_cached_binary(&CanonicalAgentId::Copilot)
                .map(|path| path.to_string_lossy().to_string()),
            copilot_debug_binary_override(),
        )
    }

    fn icon(&self) -> &str {
        "copilot"
    }

    fn is_available(&self) -> bool {
        !self.spawn_configs().is_empty()
    }

    fn parser_agent_type(&self) -> AgentType {
        AgentType::Copilot
    }

    fn uses_task_reconciler(&self) -> bool {
        true
    }

    fn authenticate_request_params(&self, auth_methods: &[Value]) -> AcpResult<Option<Value>> {
        let has_copilot_login = auth_methods.iter().any(|method| {
            method
                .get("id")
                .or_else(|| method.get("methodId"))
                .and_then(Value::as_str)
                .is_some_and(|method_id| method_id == COPILOT_LOGIN_METHOD_ID)
        });

        if !has_copilot_login {
            return Err(AcpError::ProtocolError(
                "GitHub Copilot ACP did not advertise copilot-login authentication. Run `copilot login` in the terminal before connecting."
                    .to_string(),
            ));
        }

        Ok(Some(
            serde_json::json!({ "methodId": COPILOT_LOGIN_METHOD_ID }),
        ))
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match id {
            COPILOT_MODE_AGENT_URI | COPILOT_MODE_AUTOPILOT_URI => "build".to_string(),
            COPILOT_MODE_PLAN_URI => "plan".to_string(),
            other => other.to_string(),
        }
    }

    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        match mode_id {
            "build" => COPILOT_MODE_AGENT_URI.to_string(),
            "plan" => COPILOT_MODE_PLAN_URI.to_string(),
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
            ("build", false) => Some(COPILOT_MODE_AGENT_URI.to_string()),
            ("build", true) => Some(COPILOT_MODE_AUTOPILOT_URI.to_string()),
            ("plan", false) => Some(COPILOT_MODE_PLAN_URI.to_string()),
            ("plan", true) => None,
            (_, false) => Some(self.map_outbound_mode_id(mode_id)),
            (_, true) => None,
        }
    }
}

fn filtered_env() -> HashMap<String, String> {
    crate::shell_env::build_env(crate::shell_env::EnvStrategy::Allowlist(ALLOWED_ENV_KEYS))
}

fn copilot_debug_binary_override() -> Option<String> {
    let override_value = std::env::var(COPILOT_BINARY_OVERRIDE_ENV).ok()?;
    let trimmed = override_value.trim();

    if trimmed.is_empty() {
        return None;
    }

    if !Path::new(trimmed).is_file() {
        tracing::warn!(
            env_var = COPILOT_BINARY_OVERRIDE_ENV,
            path = %trimmed,
            "Ignoring Copilot binary override because the file does not exist"
        );
        return None;
    }

    Some(trimmed.to_string())
}

fn resolve_copilot_spawn_configs(
    cached_command: Option<String>,
    debug_override_command: Option<String>,
) -> Vec<SpawnConfig> {
    let mut configs = Vec::new();
    let env = filtered_env();
    let args: Vec<String> = ACP_STDIO_ARGS
        .iter()
        .map(|arg| (*arg).to_string())
        .collect();

    if let Some(command) = cached_command {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command,
                args: args.clone(),
                env: env.clone(),
            },
        );
    }

    if let Some(command) = debug_override_command {
        push_unique_spawn_config(&mut configs, SpawnConfig { command, args, env });
    }

    configs
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
    use serde_json::json;

    #[test]
    fn resolve_spawn_configs_prefers_cached_binary_before_debug_override() {
        let configs = resolve_copilot_spawn_configs(
            Some("/tmp/copilot".to_string()),
            Some("/tmp/copilot-debug".to_string()),
        );

        assert_eq!(configs.len(), 2);
        assert_eq!(configs[0].command, "/tmp/copilot");
        assert_eq!(configs[1].command, "/tmp/copilot-debug");
        assert_eq!(configs[0].args, vec!["--acp", "--stdio"]);
    }

    #[test]
    fn resolve_spawn_configs_returns_no_launchers_without_cache_or_override() {
        let configs = resolve_copilot_spawn_configs(None, None);

        assert!(configs.is_empty());
    }

    #[test]
    fn provider_uses_dedicated_copilot_parser_family() {
        let provider = CopilotProvider;

        assert_eq!(provider.parser_agent_type(), AgentType::Copilot);
    }

    #[test]
    fn provider_uses_task_reconciler_for_subagent_tool_graphs() {
        let provider = CopilotProvider;

        assert!(provider.uses_task_reconciler());
    }

    #[test]
    fn provider_normalizes_copilot_mode_uris_to_ui_modes() {
        let provider = CopilotProvider;

        assert_eq!(
            provider.normalize_mode_id("https://github.com/github/copilot-cli/mode#agent"),
            "build"
        );
        assert_eq!(
            provider.normalize_mode_id("https://github.com/github/copilot-cli/mode#plan"),
            "plan"
        );
        assert_eq!(
            provider.normalize_mode_id("https://github.com/github/copilot-cli/mode#autopilot"),
            "build"
        );
    }

    #[test]
    fn provider_maps_execution_profiles_to_native_mode_uris() {
        let provider = CopilotProvider;

        assert_eq!(
            provider.map_execution_profile_mode_id("build", false),
            Some("https://github.com/github/copilot-cli/mode#agent".to_string())
        );
        assert_eq!(
            provider.map_execution_profile_mode_id("build", true),
            Some("https://github.com/github/copilot-cli/mode#autopilot".to_string())
        );
        assert_eq!(
            provider.map_execution_profile_mode_id("plan", false),
            Some("https://github.com/github/copilot-cli/mode#plan".to_string())
        );
        assert_eq!(provider.map_execution_profile_mode_id("plan", true), None);
        assert_eq!(provider.autonomous_supported_mode_ids(), &["build"]);
    }

    #[test]
    fn provider_selects_copilot_login_auth_method() {
        let provider = CopilotProvider;
        let auth_methods = vec![json!({
            "id": "copilot-login",
            "description": "Run `copilot login` in the terminal"
        })];

        assert_eq!(
            provider
                .authenticate_request_params(&auth_methods)
                .expect("auth params"),
            Some(json!({ "methodId": "copilot-login" }))
        );
    }

    #[test]
    fn provider_errors_when_copilot_login_method_is_missing() {
        let provider = CopilotProvider;

        let error = provider
            .authenticate_request_params(&[])
            .expect_err("missing auth method should fail");

        assert!(error.to_string().contains("copilot login"));
    }
}
