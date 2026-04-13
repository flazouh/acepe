use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::OnceLock;
use tauri::AppHandle;

use crate::acp::client_session::{SessionModelState, SessionModes};
use crate::acp::client_trait::CommunicationMode;
use crate::acp::error::AcpResult;
use crate::acp::parsers::provider_capabilities::{
    all_provider_capabilities, find_provider_capabilities_by_id, provider_capabilities,
};
use crate::acp::parsers::AgentType;
use crate::acp::provider_extensions::{InboundResponseAdapter, ProviderExtensionEvent};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::{AvailableCommand, PlanConfidence, PlanSource, SessionUpdate};
use crate::acp::task_reconciler::TaskReconciliationPolicy;
use crate::acp::types::CanonicalAgentId;
use crate::history::session_context::SessionContext;
use crate::session_jsonl::types::ConvertedSession;

#[derive(Debug, Clone)]
pub struct ModelFallbackCandidate {
    pub model_id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BackendIdentityPolicy {
    pub requires_persisted_provider_session_id: bool,
    pub prefers_incoming_provider_session_id_alias: bool,
}

impl BackendIdentityPolicy {
    pub fn missing_provider_session_id(self, provider_session_id: Option<&str>) -> bool {
        self.requires_persisted_provider_session_id && provider_session_id.is_none()
    }

    pub fn normalize_provider_session_id(
        self,
        local_session_id: &str,
        provider_session_id: &str,
    ) -> Option<String> {
        if provider_session_id == local_session_id {
            None
        } else {
            Some(provider_session_id.to_string())
        }
    }

    pub fn provider_session_id_for_existing_session(
        self,
        local_session_id: &str,
        incoming_session_id: &str,
        persisted_provider_session_id: Option<&str>,
    ) -> Option<String> {
        if self.prefers_incoming_provider_session_id_alias {
            return self.normalize_provider_session_id(local_session_id, incoming_session_id);
        }

        persisted_provider_session_id
            .filter(|provider_session_id| *provider_session_id != local_session_id)
            .map(ToOwned::to_owned)
    }

    pub fn history_session_id<'a>(
        self,
        local_session_id: &'a str,
        provider_session_id: Option<&'a str>,
    ) -> &'a str {
        let _ = self;
        provider_session_id.unwrap_or(local_session_id)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PlanAdapterPolicy {
    pub parses_wrapper_plan_from_text_stream: bool,
    pub finalizes_wrapper_plan_on_turn_end: bool,
    pub clears_message_tracker_on_prompt_response: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryReplayFamily {
    SharedCanonical,
    ProviderOwned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryReplayPolicy {
    pub family: HistoryReplayFamily,
}

impl Default for HistoryReplayPolicy {
    fn default() -> Self {
        Self {
            family: HistoryReplayFamily::SharedCanonical,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectDiscoveryCompleteness {
    Complete,
    Partial,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectPathListing {
    pub paths: Vec<String>,
    pub completeness: ProjectDiscoveryCompleteness,
}

impl Default for ProjectPathListing {
    fn default() -> Self {
        Self {
            paths: Vec::new(),
            completeness: ProjectDiscoveryCompleteness::Complete,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FrontendVariantGroup {
    Plain,
    ReasoningEffort,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PreconnectionSlashMode {
    Unsupported,
    StartupGlobal,
    ProjectScoped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FrontendProviderProjection {
    pub provider_brand: &'static str,
    pub display_name: &'static str,
    pub display_order: u16,
    pub supports_model_defaults: bool,
    pub variant_group: FrontendVariantGroup,
    pub default_alias: Option<&'static str>,
    pub reasoning_effort_support: bool,
    pub preconnection_slash_mode: PreconnectionSlashMode,
}

impl Default for FrontendProviderProjection {
    fn default() -> Self {
        Self {
            provider_brand: "custom",
            display_name: "Custom",
            display_order: u16::MAX,
            supports_model_defaults: false,
            variant_group: FrontendVariantGroup::Plain,
            default_alias: None,
            reasoning_effort_support: false,
            preconnection_slash_mode: PreconnectionSlashMode::Unsupported,
        }
    }
}

fn builtin_capabilities_for_provider_id(
    provider_id: &str,
) -> Option<&'static crate::acp::parsers::provider_capabilities::ProviderCapabilities> {
    find_provider_capabilities_by_id(all_provider_capabilities(), provider_id)
}

/// Configuration for spawning an agent subprocess
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnConfig {
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

/// Whether a provider should appear in user-visible built-in lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentUiVisibility {
    Visible,
    Hidden,
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

    /// Whether the provider should be listed in user-visible built-in surfaces.
    fn ui_visibility(&self) -> AgentUiVisibility {
        AgentUiVisibility::Visible
    }

    /// Check if the agent is ready to launch without additional setup.
    /// Default returns true; providers should override with actual detection.
    fn is_available(&self) -> bool {
        true
    }

    /// Optional commands used to discover account-available models outside ACP responses.
    /// Providers that return incomplete models in session/new|resume can override this.
    fn model_discovery_commands(&self) -> Vec<SpawnConfig> {
        Vec::new()
    }

    /// Provider-owned model catalog for agents that do not expose a list-models API.
    fn default_model_candidates(&self) -> Vec<ModelFallbackCandidate> {
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

    /// Visible UI mode IDs that support Acepe-managed Autonomous execution.
    fn autonomous_supported_mode_ids(&self) -> &'static [&'static str] {
        &["build"]
    }

    /// Resolve the provider-native runtime mode to apply for the current working directory.
    ///
    /// This lets providers own settings-aware mode inheritance instead of pushing
    /// provider-specific policy down into runtime clients.
    fn resolve_runtime_mode_id(&self, requested_mode_id: Option<&str>, _cwd: &Path) -> String {
        requested_mode_id.unwrap_or("default").to_string()
    }

    /// Apply provider-owned defaults from local config to session state.
    ///
    /// This keeps provider-specific settings inheritance in the provider layer
    /// instead of spreading config parsing across transport clients.
    fn apply_session_defaults(
        &self,
        _cwd: &Path,
        _models: &mut SessionModelState,
        _modes: &mut SessionModes,
    ) -> AcpResult<()> {
        Ok(())
    }

    /// Optional fallback model candidate if provider returns empty models list.
    fn model_fallback_for_empty_list(
        &self,
        _current_model_id: &str,
    ) -> Option<ModelFallbackCandidate> {
        None
    }

    /// Provider-owned backend identity policy for descriptor and metadata semantics.
    fn backend_identity_policy(&self) -> BackendIdentityPolicy {
        builtin_capabilities_for_provider_id(self.id())
            .map(|capabilities| capabilities.backend_identity_policy)
            .unwrap_or_default()
    }

    /// Default source classification for plan updates emitted by this provider.
    fn default_plan_source(&self) -> PlanSource {
        provider_capabilities(self.parser_agent_type()).default_plan_source
    }

    /// Default confidence classification for plan updates emitted by this provider.
    fn default_plan_confidence(&self, source: PlanSource) -> PlanConfidence {
        match source {
            PlanSource::Deterministic => PlanConfidence::High,
            PlanSource::Heuristic => PlanConfidence::Medium,
        }
    }

    /// Provider-owned plan adapter policy for wrapper buffering and turn-end finalization.
    fn plan_adapter_policy(&self) -> PlanAdapterPolicy {
        builtin_capabilities_for_provider_id(self.id())
            .map(|capabilities| capabilities.plan_adapter_policy)
            .unwrap_or_default()
    }

    /// Provider-owned history and replay loading contract.
    fn history_replay_policy(&self) -> HistoryReplayPolicy {
        builtin_capabilities_for_provider_id(self.id())
            .map(|capabilities| capabilities.history_replay_policy)
            .unwrap_or_default()
    }

    /// Provider-owned history loading for replay families that cannot use the shared canonical path.
    fn load_provider_owned_session<'a>(
        &'a self,
        _app: &'a AppHandle,
        _context: &'a SessionContext,
        _replay_context: &'a SessionReplayContext,
    ) -> Pin<Box<dyn Future<Output = Result<Option<ConvertedSession>, String>> + Send + 'a>> {
        Box::pin(async { Ok(None) })
    }

    /// Provider-owned project discovery for history-backed project listing.
    fn list_project_paths<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<ProjectPathListing, String>> + Send + 'a>> {
        Box::pin(async { Ok(ProjectPathListing::default()) })
    }

    /// Provider-owned per-project session counting for history-backed project listings.
    fn count_sessions_for_project<'a>(
        &'a self,
        _project_path: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<u32, String>> + Send + 'a>> {
        Box::pin(async { Ok(0) })
    }

    /// Presentation-only provider metadata for shared frontend surfaces.
    fn frontend_projection(&self) -> FrontendProviderProjection {
        builtin_capabilities_for_provider_id(self.id())
            .map(|capabilities| capabilities.frontend_projection)
            .unwrap_or_default()
    }

    /// Provider-owned preconnection slash entry loading before a session exists.
    fn list_preconnection_commands<'a>(
        &'a self,
        _app: &'a AppHandle,
        _cwd: Option<&'a Path>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<AvailableCommand>, String>> + Send + 'a>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    /// Provider-owned hook for enriching parsed session updates before shared processing.
    fn enrich_session_update<'a>(
        &'a self,
        update: SessionUpdate,
    ) -> Pin<Box<dyn Future<Output = SessionUpdate> + Send + 'a>> {
        Box::pin(async move { update })
    }

    /// Provider extension normalizer hook (for custom notification/request methods).
    fn normalize_extension_method(
        &self,
        _method: &str,
        _params: &Value,
        _request_id: Option<u64>,
        _current_session_id: Option<&str>,
    ) -> Result<Option<ProviderExtensionEvent>, String> {
        Ok(None)
    }

    /// Provider extension response adapter hook.
    fn adapt_inbound_response(&self, _adapter: &InboundResponseAdapter, result: &Value) -> Value {
        result.clone()
    }

    /// Provider-owned query recovery for synthetic permission requests.
    fn extract_synthetic_permission_query(
        &self,
        _parsed_arguments: &Option<Value>,
        _forwarded: &Value,
    ) -> Option<String> {
        None
    }

    /// Whether a raw ACP notification should be suppressed before generic handling.
    fn should_suppress_notification(&self, _json: &Value) -> bool {
        false
    }

    /// Whether this provider requires TaskReconciler pass for tool call graph assembly.
    fn task_reconciliation_policy(&self) -> TaskReconciliationPolicy {
        TaskReconciliationPolicy::Disabled
    }

    /// Whether this provider requires TaskReconciler pass for tool call graph assembly.
    fn uses_task_reconciler(&self) -> bool {
        self.task_reconciliation_policy().uses_task_reconciler()
    }

    /// Whether wrapper-based plan extraction from text chunks is enabled.
    fn uses_wrapper_plan_streaming(&self) -> bool {
        self.plan_adapter_policy()
            .parses_wrapper_plan_from_text_stream
    }

    /// Whether per-session message-id tracker should be cleared on prompt response.
    fn clear_message_tracker_on_prompt_response(&self) -> bool {
        self.plan_adapter_policy()
            .clears_message_tracker_on_prompt_response
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
