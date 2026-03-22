use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::acp::client_trait::CommunicationMode;
use crate::acp::cursor_extensions::{CursorExtensionEvent, CursorResponseAdapter};
use crate::acp::error::AcpResult;
use crate::acp::parsers::AgentType;
use crate::acp::session_update::{PlanConfidence, PlanSource};
use crate::acp::types::CanonicalAgentId;

#[derive(Debug, Clone)]
pub struct ModelFallbackCandidate {
    pub model_id: String,
    pub name: String,
    pub description: Option<String>,
}

/// Configuration for spawning an agent subprocess
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnConfig {
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

/// Trait for agent provider implementations
/// Defines how to spawn and configure different ACP agents
pub trait AgentProvider: Send + Sync {
    /// Unique identifier for this agent (e.g., "claude-code", "cursor")
    fn id(&self) -> &str;

    /// Human-readable name for display in UI
    fn name(&self) -> &str;

    /// Configuration for spawning the subprocess
    fn spawn_config(&self) -> SpawnConfig;

    /// Ordered spawn configurations for providers that support fallback launchers.
    ///
    /// Default behavior preserves the single-launcher model.
    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        vec![self.spawn_config()]
    }

    /// Communication mode (default: Subprocess for backward compatibility)
    fn communication_mode(&self) -> CommunicationMode {
        CommunicationMode::Subprocess
    }

    /// Display icon name (for UI)
    fn icon(&self) -> &str {
        "terminal"
    }

    /// Check if the agent is available (command exists in PATH)
    /// Default returns true; providers should override with actual detection
    fn is_available(&self) -> bool {
        true
    }

    /// Optional commands used to discover account-available models outside ACP responses.
    /// Providers that return incomplete models in session/new|resume can override this.
    fn model_discovery_commands(&self) -> Vec<SpawnConfig> {
        Vec::new()
    }

    /// Parser agent type used for ACP session update parsing and model display grouping.
    fn parser_agent_type(&self) -> AgentType {
        let canonical = CanonicalAgentId::parse(self.id());
        AgentType::from_canonical(&canonical)
    }

    /// Initialize params for ACP `initialize`.
    fn initialize_params(&self, client_name: &str, client_version: &str) -> Value {
        let _ = (client_name, client_version);
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": {
                    "readTextFile": true,
                    "writeTextFile": true
                },
                "terminal": true,
                "_meta": {
                    "askUserQuestion": true
                }
            }
        })
    }

    /// Optional ACP authenticate request params (if provider requires auth handshake).
    fn authenticate_request_params(&self, _auth_methods: &[Value]) -> AcpResult<Option<Value>> {
        Ok(None)
    }

    /// Normalize provider-native mode IDs to UI mode IDs.
    fn normalize_mode_id(&self, id: &str) -> String {
        id.to_string()
    }

    /// Outbound UI mode ID mapping to provider-native mode IDs.
    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        mode_id.to_string()
    }

    /// Mode IDs visible to the UI for this provider.
    fn visible_mode_ids(&self) -> &'static [&'static str] {
        &["build", "plan"]
    }

    /// Optional fallback model candidate if provider returns empty models list.
    fn model_fallback_for_empty_list(
        &self,
        _current_model_id: &str,
    ) -> Option<ModelFallbackCandidate> {
        None
    }

    /// Default source classification for plan updates emitted by this provider.
    fn default_plan_source(&self) -> PlanSource {
        PlanSource::Heuristic
    }

    /// Default confidence classification for plan updates emitted by this provider.
    fn default_plan_confidence(&self, source: PlanSource) -> PlanConfidence {
        match source {
            PlanSource::Deterministic => PlanConfidence::High,
            PlanSource::Heuristic => PlanConfidence::Medium,
        }
    }

    /// Provider extension normalizer hook (for custom notification/request methods).
    fn normalize_extension_method(
        &self,
        _method: &str,
        _params: &Value,
        _request_id: Option<u64>,
        _current_session_id: Option<&str>,
    ) -> Result<Option<CursorExtensionEvent>, String> {
        Ok(None)
    }

    /// Provider extension response adapter hook.
    fn adapt_inbound_response(&self, _adapter: &CursorResponseAdapter, result: &Value) -> Value {
        result.clone()
    }

    /// Whether this provider requires TaskReconciler pass for tool call graph assembly.
    fn uses_task_reconciler(&self) -> bool {
        false
    }

    /// Whether wrapper-based plan extraction from text chunks is enabled.
    fn uses_wrapper_plan_streaming(&self) -> bool {
        false
    }

    /// Whether per-session message-id tracker should be cleared on prompt response.
    fn clear_message_tracker_on_prompt_response(&self) -> bool {
        false
    }
}

/// Centralized cache for command availability checks.
///
/// All commands that need to be checked are stored here once,
/// avoiding duplicate checks across providers.
#[derive(Debug, Default)]
pub struct CommandAvailabilityCache {
    pub bunx: bool,
    pub npx: bool,
}

/// Global singleton for the command availability cache.
static COMMAND_CACHE: OnceLock<CommandAvailabilityCache> = OnceLock::new();

impl CommandAvailabilityCache {
    /// Get the cached command availability.
    ///
    /// Returns the pre-warmed cache if available, otherwise initializes
    /// synchronously (fallback for cases where pre-warming didn't happen).
    pub fn get() -> &'static Self {
        COMMAND_CACHE.get_or_init(|| {
            tracing::warn!(
                "Command cache not pre-warmed, initializing synchronously (this may block)"
            );
            Self::check_all_sync()
        })
    }

    /// Pre-warm the cache asynchronously during app startup.
    ///
    /// This should be called from a background task during initialization
    /// to avoid blocking the main thread.
    pub async fn prewarm() {
        if COMMAND_CACHE.get().is_some() {
            tracing::debug!("Command cache already initialized, skipping prewarm");
            return;
        }

        tracing::info!("Pre-warming command availability cache");

        // Run all checks concurrently
        let (bunx, npx) = tokio::join!(command_exists_async("bunx"), command_exists_async("npx"),);

        let cache = CommandAvailabilityCache { bunx, npx };

        tracing::info!(
            bunx = cache.bunx,
            npx = cache.npx,
            "Command availability cache pre-warmed"
        );

        // Try to set the cache; if another thread beat us, that's fine
        let _ = COMMAND_CACHE.set(cache);
    }

    /// Synchronous initialization (fallback).
    fn check_all_sync() -> Self {
        tracing::debug!("Checking all command availability synchronously");
        CommandAvailabilityCache {
            bunx: command_exists_sync("bunx"),
            npx: command_exists_sync("npx"),
        }
    }
}

/// Async helper function to check if a command exists in PATH.
/// Uses tokio::process::Command to avoid blocking the async runtime.
pub async fn command_exists_async(cmd: &str) -> bool {
    let cmd = cmd.to_string();
    tokio::task::spawn_blocking(move || command_exists_sync(&cmd))
        .await
        .unwrap_or_default()
}

/// Synchronous helper function to check if a command exists in PATH.
/// WARNING: This blocks the current thread. Prefer `command_exists_async` in async contexts.
fn command_exists_sync(cmd: &str) -> bool {
    find_command_in_path(cmd).is_some()
}

/// Public helper for command availability checks.
/// Used by providers that need runtime availability status.
pub fn command_exists(cmd: &str) -> bool {
    command_exists_sync(cmd)
}

fn find_command_in_path(cmd: &str) -> Option<PathBuf> {
    if is_path_like(cmd) {
        let path = Path::new(cmd);
        return if is_executable(path) {
            Some(path.to_path_buf())
        } else {
            None
        };
    }

    let path_dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    find_command_in_path_with_env(cmd, &path_dirs)
}

/// Find a command in a given list of path directories.
/// This variant allows passing an explicit path list, useful for testing
/// without mutating global environment variables.
fn find_command_in_path_with_env(cmd: &str, path_dirs: &[PathBuf]) -> Option<PathBuf> {
    for dir in path_dirs {
        for candidate in command_candidates(cmd) {
            let path = dir.join(candidate);
            if is_executable(&path) {
                return Some(path);
            }
        }
    }

    None
}

#[cfg(windows)]
fn command_candidates(cmd: &str) -> Vec<std::ffi::OsString> {
    let path = Path::new(cmd);
    if path.extension().is_some() {
        return vec![cmd.into()];
    }

    let mut candidates = Vec::new();
    let pathext = std::env::var_os("PATHEXT").unwrap_or_else(|| ".EXE;.CMD;.BAT;.COM".into());

    for ext in pathext.to_string_lossy().split(';') {
        if ext.is_empty() {
            continue;
        }
        candidates.push(format!("{}{}", cmd, ext).into());
    }

    candidates
}

#[cfg(not(windows))]
fn command_candidates(cmd: &str) -> Vec<std::ffi::OsString> {
    vec![cmd.into()]
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && (meta.permissions().mode() & 0o111 != 0))
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn is_path_like(cmd: &str) -> bool {
    if cmd.contains(std::path::MAIN_SEPARATOR) {
        return true;
    }
    #[cfg(windows)]
    {
        if cmd.contains('/') {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[cfg(unix)]
    #[test]
    fn command_exists_sync_works_without_which_in_path() {
        let temp = tempdir().expect("temp dir");
        let cmd_path = temp.path().join("fakecmd");
        std::fs::write(&cmd_path, "").expect("write fake command");

        let mut perms = std::fs::metadata(&cmd_path)
            .expect("metadata")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&cmd_path, perms).expect("set permissions");

        let path_dirs = vec![temp.path().to_path_buf()];
        let result = find_command_in_path_with_env("fakecmd", &path_dirs);

        assert!(result.is_some());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn command_exists_async_works_without_which_in_path() {
        let temp = tempdir().expect("temp dir");
        let cmd_path = temp.path().join("fakecmd");
        std::fs::write(&cmd_path, "").expect("write fake command");

        let mut perms = std::fs::metadata(&cmd_path)
            .expect("metadata")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&cmd_path, perms).expect("set permissions");

        let path_dirs = vec![temp.path().to_path_buf()];
        let result = find_command_in_path_with_env("fakecmd", &path_dirs);

        assert!(result.is_some());
    }
}
