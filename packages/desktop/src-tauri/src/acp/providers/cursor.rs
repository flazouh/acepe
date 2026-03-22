//! Cursor Agent Provider
//!
//! This provider spawns Cursor CLI's native ACP server via `agent acp`.

use super::super::provider::{AgentProvider, ModelFallbackCandidate, SpawnConfig};
use crate::acp::cursor_extensions::{
    adapt_cursor_response, cursor_extension_kind, normalize_cursor_extension, CursorExtensionEvent,
    CursorResponseAdapter,
};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::session_update::PlanSource;
use serde_json::{json, Value};
use std::collections::HashMap;

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

        let canonical = crate::acp::types::CanonicalAgentId::Cursor;

        // Resolve from cache — no PATH fallback by design.
        // If not installed, is_available() returns false and this should not be called.
        let command = crate::acp::agent_installer::get_cached_binary(&canonical)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                tracing::warn!("Cursor binary not found in cache; spawn will likely fail");
                "agent".to_string()
            });

        let args = crate::acp::agent_installer::get_cached_args(&canonical)
            .into_iter()
            .filter(|a| !a.is_empty())
            .collect::<Vec<_>>();
        let args = if args.is_empty() {
            vec!["acp".to_string()]
        } else {
            args
        };

        // Filtered env — only pass safe variables to downloaded binaries
        let env = filtered_env();

        SpawnConfig { command, args, env }
    }

    fn icon(&self) -> &str {
        "cursor"
    }

    fn is_available(&self) -> bool {
        crate::acp::agent_installer::is_installed(&crate::acp::types::CanonicalAgentId::Cursor)
    }

    fn model_discovery_commands(&self) -> Vec<SpawnConfig> {
        let canonical = crate::acp::types::CanonicalAgentId::Cursor;
        let command = crate::acp::agent_installer::get_cached_binary(&canonical)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                tracing::warn!("Cursor binary not found in cache for model discovery");
                "agent".to_string()
            });

        let env = filtered_env();

        vec![
            SpawnConfig {
                command: command.clone(),
                args: vec![
                    "--list-models".to_string(),
                    "--output-format".to_string(),
                    "json".to_string(),
                    "--print".to_string(),
                ],
                env: env.clone(),
            },
            SpawnConfig {
                command: command.clone(),
                args: vec!["--list-models".to_string()],
                env: env.clone(),
            },
            SpawnConfig {
                command,
                args: vec!["models".to_string()],
                env,
            },
        ]
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let provider = CursorProvider;
        let attempts = provider.model_discovery_commands();

        assert_eq!(attempts.len(), 3);
        // Falls back to bare "agent" command when cache is not set (test environment)
        assert_eq!(attempts[0].command, "agent");
        assert_eq!(
            attempts[0].args,
            vec!["--list-models", "--output-format", "json", "--print"]
        );
        assert_eq!(attempts[1].args, vec!["--list-models"]);
        assert_eq!(attempts[2].args, vec!["models"]);
    }

    #[test]
    fn is_not_available_when_cache_not_set() {
        // Without a cache dir, is_installed returns false, so is_available returns false
        let provider = CursorProvider;
        assert!(!provider.is_available());
    }

    #[test]
    fn uses_task_reconciler_for_repeated_tool_call_normalization() {
        let provider = CursorProvider;
        assert!(provider.uses_task_reconciler());
    }
}
