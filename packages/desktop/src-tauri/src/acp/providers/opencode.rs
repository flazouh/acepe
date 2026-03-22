use super::super::provider::{AgentProvider, SpawnConfig};
use crate::acp::client_trait::CommunicationMode;
use std::collections::HashMap;

/// OpenCode HTTP Agent Provider
/// Uses HTTP REST API + SSE instead of ACP JSON-RPC
pub struct OpenCodeProvider;

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
];

fn filtered_env() -> HashMap<String, String> {
    crate::shell_env::build_env(crate::shell_env::EnvStrategy::Allowlist(ALLOWED_ENV_KEYS))
}

impl AgentProvider for OpenCodeProvider {
    fn id(&self) -> &str {
        "opencode"
    }

    fn name(&self) -> &str {
        "OpenCode"
    }

    fn spawn_config(&self) -> SpawnConfig {
        tracing::debug!("Determining spawn config for OpenCode");

        let canonical = crate::acp::types::CanonicalAgentId::OpenCode;

        // Resolve from cache — no PATH fallback by design.
        // If not installed, is_available() returns false and this should not be called.
        let command = crate::acp::agent_installer::get_cached_binary(&canonical)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                tracing::warn!("OpenCode binary not found in cache; spawn will likely fail");
                "opencode".to_string()
            });

        // Registry says args: ["acp"], but OpenCode HTTP mode uses "serve"
        let args = crate::acp::agent_installer::get_cached_args(&canonical)
            .into_iter()
            .filter(|a| !a.is_empty())
            .collect::<Vec<_>>();
        let args = if args.is_empty() {
            vec!["serve".to_string()]
        } else {
            args
        };

        let env = filtered_env();

        tracing::debug!(command = %command, args = ?args, "SpawnConfig created");
        SpawnConfig { command, args, env }
    }

    fn communication_mode(&self) -> CommunicationMode {
        // OpenCode uses HTTP mode for full permission/question support
        CommunicationMode::Http
    }

    fn icon(&self) -> &str {
        "opencode"
    }

    fn is_available(&self) -> bool {
        crate::acp::agent_installer::is_installed(&crate::acp::types::CanonicalAgentId::OpenCode)
    }
}
