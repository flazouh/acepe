//! Cursor Agent Provider
//!
//! This provider spawns Cursor CLI's native ACP server via `agent acp`.

use super::super::provider::{command_exists, AgentProvider, ModelFallbackCandidate, SpawnConfig};
use super::cursor_session_update_enrichment::enrich_cursor_session_update;
use crate::acp::cursor_extensions::{
    adapt_cursor_response, cursor_extension_kind, is_cursor_extension_pre_tool,
    normalize_cursor_extension, CursorExtensionEvent, CursorResponseAdapter,
};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::session_update::{PlanSource, SessionUpdate};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

/// Cursor ACP Agent Provider
///
/// Spawns Cursor CLI in ACP mode. Users should authenticate with `agent login`,
/// `CURSOR_API_KEY`, or `CURSOR_AUTH_TOKEN` before starting a session.
pub struct CursorProvider;

impl AgentProvider for CursorProvider {
    fn id(&self) -> &str {
        "cursor"
    }

    fn name(&self) -> &str {
        "Cursor Agent"
    }

    fn spawn_config(&self) -> SpawnConfig {
        tracing::debug!("Determining spawn config for Cursor");

        self.spawn_configs().into_iter().next().unwrap_or_else(|| {
            tracing::warn!(
                "Cursor launcher unavailable in cache and PATH; returning placeholder spawn config"
            );
            SpawnConfig {
                command: "agent".to_string(),
                args: vec!["acp".to_string()],
                env: filtered_env(),
            }
        })
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        let canonical = crate::acp::types::CanonicalAgentId::Cursor;

        resolve_cursor_spawn_configs(
            crate::acp::agent_installer::get_cached_binary(&canonical)
                .map(|path| path.to_string_lossy().to_string()),
            crate::acp::agent_installer::get_cached_args(&canonical),
            command_exists("agent"),
        )
    }

    fn icon(&self) -> &str {
        "cursor"
    }

    fn is_available(&self) -> bool {
        crate::acp::agent_installer::get_cached_binary(&crate::acp::types::CanonicalAgentId::Cursor)
            .is_some()
            || command_exists("agent")
    }

    fn model_discovery_commands(&self) -> Vec<SpawnConfig> {
        resolve_cursor_model_discovery_commands(self.spawn_configs())
    }

    fn initialize_params(&self, client_name: &str, client_version: &str) -> Value {
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": {
                    "readTextFile": true,
                    "writeTextFile": true
                },
                "terminal": true
            },
            "clientInfo": {
                "name": client_name,
                "version": client_version
            }
        })
    }

    fn authenticate_request_params(&self, auth_methods: &[Value]) -> AcpResult<Option<Value>> {
        let has_cursor_login = auth_methods.iter().any(|method| {
            method
                .get("id")
                .or_else(|| method.get("methodId"))
                .and_then(Value::as_str)
                .is_some_and(|method_id| method_id == "cursor_login")
        });

        if !has_cursor_login {
            return Err(AcpError::ProtocolError(
                "Cursor ACP did not advertise cursor_login authentication. Run `agent login`, set CURSOR_API_KEY, or set CURSOR_AUTH_TOKEN before connecting."
                    .to_string(),
            ));
        }

        Ok(Some(json!({ "methodId": "cursor_login" })))
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match id {
            "ask" | "agent" => "build".to_string(),
            other => other.to_string(),
        }
    }

    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        match mode_id {
            "build" => "agent".to_string(),
            other => other.to_string(),
        }
    }

    fn model_fallback_for_empty_list(
        &self,
        current_model_id: &str,
    ) -> Option<ModelFallbackCandidate> {
        let model_id = if current_model_id.trim().is_empty() {
            "auto".to_string()
        } else {
            current_model_id.to_string()
        };

        let name = if model_id == "auto" {
            "Auto".to_string()
        } else {
            model_id.clone()
        };

        Some(ModelFallbackCandidate {
            model_id,
            name,
            description: Some("Agent-managed model selection".to_string()),
        })
    }

    fn default_plan_source(&self) -> PlanSource {
        PlanSource::Deterministic
    }

    fn enrich_session_update<'a>(
        &'a self,
        update: SessionUpdate,
    ) -> Pin<Box<dyn Future<Output = SessionUpdate> + Send + 'a>> {
        Box::pin(async move { enrich_cursor_session_update(update).await })
    }

    fn uses_task_reconciler(&self) -> bool {
        true
    }

    fn normalize_extension_method(
        &self,
        method: &str,
        params: &Value,
        request_id: Option<u64>,
        current_session_id: Option<&str>,
    ) -> Result<Option<CursorExtensionEvent>, String> {
        if cursor_extension_kind(method).is_none() {
            return Ok(None);
        }

        normalize_cursor_extension(method, params, request_id, current_session_id).map(Some)
    }

    fn adapt_inbound_response(&self, adapter: &CursorResponseAdapter, result: &Value) -> Value {
        adapt_cursor_response(adapter, result)
    }

    fn should_suppress_notification(&self, json: &Value) -> bool {
        is_cursor_extension_pre_tool(json)
    }
}

/// Environment allowlist for downloaded agent subprocesses.
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
    "CURSOR_API_KEY",
    "CURSOR_AUTH_TOKEN",
];

fn filtered_env() -> HashMap<String, String> {
    crate::shell_env::build_env(crate::shell_env::EnvStrategy::Allowlist(ALLOWED_ENV_KEYS))
}

fn resolve_cursor_spawn_configs(
    cached_command: Option<String>,
    cached_args: Vec<String>,
    path_agent_available: bool,
) -> Vec<SpawnConfig> {
    let mut configs = Vec::new();
    let env = filtered_env();

    if let Some(command) = cached_command {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command,
                args: normalize_cursor_acp_args(cached_args),
                env: env.clone(),
            },
        );
    }

    if path_agent_available {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "agent".to_string(),
                args: vec!["acp".to_string()],
                env,
            },
        );
    }

    configs
}

fn resolve_cursor_model_discovery_commands(launchers: Vec<SpawnConfig>) -> Vec<SpawnConfig> {
    let mut attempts = Vec::new();

    for launcher in launchers {
        attempts.push(SpawnConfig {
            command: launcher.command.clone(),
            args: vec![
                "--list-models".to_string(),
                "--output-format".to_string(),
                "json".to_string(),
                "--print".to_string(),
            ],
            env: launcher.env.clone(),
        });
        attempts.push(SpawnConfig {
            command: launcher.command.clone(),
            args: vec!["--list-models".to_string()],
            env: launcher.env.clone(),
        });
        attempts.push(SpawnConfig {
            command: launcher.command,
            args: vec!["models".to_string()],
            env: launcher.env,
        });
    }

    attempts
}

fn normalize_cursor_acp_args(cached_args: Vec<String>) -> Vec<String> {
    let args = cached_args
        .into_iter()
        .filter(|arg| !arg.is_empty())
        .collect::<Vec<_>>();

    if args.is_empty() {
        vec!["acp".to_string()]
    } else {
        args
    }
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
    fn resolve_spawn_configs_prefers_cached_binary_before_path_agent() {
        let configs = resolve_cursor_spawn_configs(
            Some("/tmp/cursor-agent".to_string()),
            vec!["acp".to_string()],
            true,
        );

        assert_eq!(configs.len(), 2);
        assert_eq!(configs[0].command, "/tmp/cursor-agent");
        assert_eq!(configs[0].args, vec!["acp"]);
        assert_eq!(configs[1].command, "agent");
        assert_eq!(configs[1].args, vec!["acp"]);
    }

    #[test]
    fn resolve_spawn_configs_omits_fake_agent_fallback_when_unavailable() {
        let configs = resolve_cursor_spawn_configs(None, Vec::new(), false);

        assert!(configs.is_empty());
    }

    #[test]
    fn spawn_config_has_acp_args() {
        let provider = CursorProvider;
        let config = provider.spawn_config();

        // When no cache dir is set (test environment), falls back to bare command.
        // The installed path cannot be tested in unit tests because AGENTS_CACHE_DIR
        // is a process-global OnceLock. Integration tests should verify the installed path.
        assert!(config.args.contains(&"acp".to_string()));
    }

    #[test]
    fn model_discovery_commands_include_list_models_attempts() {
        let attempts = resolve_cursor_model_discovery_commands(resolve_cursor_spawn_configs(
            Some("/tmp/cursor-agent".to_string()),
            vec!["acp".to_string()],
            false,
        ));

        assert_eq!(attempts.len(), 3);
        assert_eq!(attempts[0].command, "/tmp/cursor-agent");
        assert_eq!(
            attempts[0].args,
            vec!["--list-models", "--output-format", "json", "--print"]
        );
        assert_eq!(attempts[1].args, vec!["--list-models"]);
        assert_eq!(attempts[2].args, vec!["models"]);
    }

    #[test]
    fn normalize_cursor_acp_args_defaults_to_acp() {
        assert_eq!(normalize_cursor_acp_args(Vec::new()), vec!["acp"]);
    }

    #[test]
    fn uses_task_reconciler_for_repeated_tool_call_normalization() {
        let provider = CursorProvider;
        assert!(provider.uses_task_reconciler());
    }

    #[test]
    fn build_mode_round_trips_to_cursor_agent_mode() {
        let provider = CursorProvider;

        assert_eq!(provider.map_outbound_mode_id("build"), "agent");
        assert_eq!(provider.normalize_mode_id("agent"), "build");
        assert_eq!(provider.normalize_mode_id("ask"), "build");
    }

    #[test]
    fn cursor_provider_owns_session_update_enrichment_hook() {
        let source = include_str!("cursor.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap_or(source);

        assert!(production_source.contains("fn enrich_session_update<'a>("));
    }
}
