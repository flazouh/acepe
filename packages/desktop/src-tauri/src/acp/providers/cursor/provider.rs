//! Cursor Agent Provider
//!
//! This provider spawns Cursor's native ACP server from the Acepe-managed
//! `cursor-agent` binary (auto-installed via the agent installer). Availability
//! and launch resolution key on the managed cache only — never on whatever
//! happens to be named `agent` on the user's PATH.

use super::enrichment::enrich_cursor_session_update;
use crate::acp::capability_resolution::resolve_generic_preconnection_capabilities;
use crate::acp::client_session::{AvailableMode, ModeIconKind, SessionModes};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::parsers::arguments::parse_tool_kind_arguments;
use crate::acp::provider::{
    AgentProvider, ModelFallbackCandidate, ProjectDiscoveryCompleteness, ProjectPathListing,
    ProviderAuthenticationAction, SpawnConfig, WebSearchNotificationDedupRecord,
};
use crate::acp::provider_extensions::{InboundResponseAdapter, ProviderExtensionEvent};
use crate::acp::providers::cursor::{
    adapt_cursor_response, cursor_extension_kind, is_cursor_extension_pre_tool,
    normalize_cursor_extension,
};
use crate::acp::runtime_resolver::SpawnEnvStrategy;
use crate::acp::session_update::AvailableCommand;
use crate::acp::session_update::{SessionUpdate, ToolArguments, ToolKind};
use crate::acp::task_reconciler::TaskReconciliationPolicy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use tauri::AppHandle;

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
                "Cursor managed binary not installed; returning placeholder spawn config. \
                 Connect should auto-install before spawn, so this path is unexpected."
            );
            SpawnConfig {
                command: "cursor-agent".to_string(),
                args: vec!["acp".to_string()],
                env: HashMap::new(),
                env_strategy: Some(filtered_env_strategy()),
            }
        })
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        let canonical = crate::acp::types::CanonicalAgentId::Cursor;

        resolve_cursor_spawn_configs(
            crate::acp::agent_installer::get_cached_binary(&canonical)
                .map(|path| path.to_string_lossy().to_string()),
            crate::acp::agent_installer::get_cached_args(&canonical),
        )
    }

    fn icon(&self) -> &str {
        "cursor"
    }

    fn is_available(&self) -> bool {
        // Managed cache only. A bare `agent` on PATH is not Cursor — trusting it
        // both mis-launches a foreign binary and suppresses auto-install-on-connect.
        crate::acp::agent_installer::is_installed(&crate::acp::types::CanonicalAgentId::Cursor)
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

    fn authentication_action(&self) -> Option<ProviderAuthenticationAction> {
        resolve_cursor_authentication_action(
            crate::acp::agent_installer::get_cached_binary(
                &crate::acp::types::CanonicalAgentId::Cursor,
            )
            .map(|path| path.to_string_lossy().to_string()),
        )
    }

    fn list_preconnection_commands<'a>(
        &'a self,
        _app: &'a AppHandle,
        _cwd: Option<&'a Path>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<AvailableCommand>, String>> + Send + 'a>> {
        Box::pin(async move {
            match cursor_skills_root() {
                Some(root) => {
                    crate::acp::preconnection_slash::load_preconnection_commands_from_root(&root)
                        .await
                }
                None => Ok(Vec::new()),
            }
        })
    }

    fn list_preconnection_capabilities<'a>(
        &'a self,
        _app: &'a AppHandle,
        cwd: Option<&'a Path>,
    ) -> Pin<
        Box<
            dyn Future<Output = crate::acp::capability_resolution::ResolvedCapabilities>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            let effective_cwd = cwd
                .map(PathBuf::from)
                .or_else(|| std::env::current_dir().ok())
                .unwrap_or_else(|| PathBuf::from("."));
            resolve_generic_preconnection_capabilities(self, effective_cwd.as_path()).await
        })
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match id {
            "build" | "agent" => "agent".to_string(),
            "ask" => "ask".to_string(),
            other => other.to_string(),
        }
    }

    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        match mode_id {
            "build" | "agent" => "agent".to_string(),
            other => other.to_string(),
        }
    }

    fn visible_mode_ids(&self) -> &'static [&'static str] {
        &["agent", "ask"]
    }

    fn default_session_modes(&self) -> SessionModes {
        SessionModes {
            current_mode_id: "agent".to_string(),
            available_modes: vec![
                AvailableMode::new("agent", "Agent", Some("Cursor agent mode".to_string()))
                    .with_icon_kind(ModeIconKind::Agent),
                AvailableMode::new("ask", "Ask", Some("Cursor ask mode".to_string()))
                    .with_icon_kind(ModeIconKind::Ask),
            ],
        }
    }

    fn reconnect_policy(
        &self,
        _requested_launch_mode_id: Option<&str>,
    ) -> crate::acp::provider::ProviderReconnectPolicy {
        crate::acp::provider::ProviderReconnectPolicy {
            use_load_semantics: true,
            outbound_launch_mode_id: None,
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

    fn enrich_session_update<'a>(
        &'a self,
        update: SessionUpdate,
    ) -> Pin<Box<dyn Future<Output = SessionUpdate> + Send + 'a>> {
        Box::pin(async move { enrich_cursor_session_update(update).await })
    }

    fn should_filter_session_update_notification(&self, json: &Value) -> bool {
        is_cursor_extension_pre_tool(json)
    }

    fn is_web_search_tool_call_id(&self, id: &str) -> bool {
        id.starts_with("web_search_") || id.starts_with("ws_")
    }

    fn extract_web_search_notification_dedup_record(
        &self,
        _method: &str,
        params: &Value,
    ) -> Option<WebSearchNotificationDedupRecord> {
        if params.get("event").and_then(Value::as_str) != Some("toolCall") {
            return None;
        }

        let tool_call_id = params
            .pointer("/data/toolCallId")
            .and_then(Value::as_str)
            .filter(|id| self.is_web_search_tool_call_id(id))?;

        let raw_input = params.pointer("/data/rawInput")?;
        let arguments = parse_tool_kind_arguments(ToolKind::WebSearch, raw_input);
        let query = match arguments {
            ToolArguments::WebSearch { query: Some(query) } => query,
            _ => return None,
        };

        Some(WebSearchNotificationDedupRecord {
            tool_call_id: tool_call_id.to_string(),
            query,
        })
    }

    fn task_reconciliation_policy(&self) -> TaskReconciliationPolicy {
        TaskReconciliationPolicy::ExplicitParentIds
    }

    fn normalize_extension_method(
        &self,
        method: &str,
        params: &Value,
        request_id: Option<u64>,
        current_session_id: Option<&str>,
    ) -> Result<Option<ProviderExtensionEvent>, String> {
        if cursor_extension_kind(method).is_none() {
            return Ok(None);
        }

        normalize_cursor_extension(method, params, request_id, current_session_id).map(Some)
    }

    fn adapt_inbound_response(&self, adapter: &InboundResponseAdapter, result: &Value) -> Value {
        adapt_cursor_response(adapter, result)
    }

    fn extract_synthetic_permission_query(
        &self,
        parsed_arguments: &Option<Value>,
        forwarded: &Value,
    ) -> Option<String> {
        extract_cursor_query_from_synthetic_permission(parsed_arguments, forwarded)
    }

    fn list_project_paths<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<ProjectPathListing, String>> + Send + 'a>> {
        Box::pin(async move {
            let paths = list_cursor_project_paths().await?;
            Ok(ProjectPathListing {
                paths,
                completeness: ProjectDiscoveryCompleteness::Complete,
            })
        })
    }

    fn count_sessions_for_project<'a>(
        &'a self,
        project_path: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<u32, String>> + Send + 'a>> {
        Box::pin(async move { count_cursor_sessions_for_project(project_path).await })
    }

    fn supports_project_discovery(&self) -> bool {
        true
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

fn filtered_env_strategy() -> SpawnEnvStrategy {
    SpawnEnvStrategy::allowlist(ALLOWED_ENV_KEYS)
}

fn cursor_skills_root() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".cursor").join("skills"))
}

async fn list_cursor_project_paths() -> Result<Vec<String>, String> {
    use crate::cursor_history::parser::get_cursor_projects_dir;

    let projects_dir = get_cursor_projects_dir()
        .map_err(|error| format!("Failed to get Cursor projects directory: {error}"))?;

    if !projects_dir.exists() {
        return Ok(Vec::new());
    }

    let mut project_paths = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&projects_dir)
        .await
        .map_err(|error| format!("Failed to read projects directory: {error}"))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|error| format!("Failed to read directory entry: {error}"))?
    {
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        if file_name_str.starts_with('.') {
            continue;
        }

        if !entry
            .file_type()
            .await
            .map_err(|error| format!("Failed to get file type: {error}"))?
            .is_dir()
        {
            continue;
        }

        project_paths.push(format!("/{}", file_name_str.replace('-', "/")));
    }

    Ok(project_paths)
}

async fn count_cursor_sessions_for_project(project_path: &str) -> Result<u32, String> {
    use crate::cursor_history::parser::get_cursor_projects_dir;

    let projects_dir = get_cursor_projects_dir()
        .map_err(|error| format!("Failed to get Cursor projects directory: {error}"))?;

    if !projects_dir.exists() {
        return Ok(0);
    }

    let project_dir = projects_dir.join(project_path.trim_start_matches('/').replace('/', "-"));
    if !project_dir.exists() || !project_dir.is_dir() {
        return Ok(0);
    }

    let transcripts_dir = project_dir.join("agent-transcripts");
    if !transcripts_dir.exists() {
        return Ok(0);
    }

    let mut count = 0u32;
    let mut read_dir = tokio::fs::read_dir(&transcripts_dir)
        .await
        .map_err(|error| format!("Failed to read transcripts directory {project_path}: {error}"))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|error| format!("Failed to read directory entry: {error}"))?
    {
        if !entry
            .file_type()
            .await
            .map_err(|error| format!("Failed to get file type: {error}"))?
            .is_file()
        {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.ends_with(".json") || file_name.ends_with(".txt") {
            count += 1;
        }
    }

    Ok(count)
}

fn extract_cursor_query_from_synthetic_permission(
    parsed_arguments: &Option<Value>,
    forwarded: &Value,
) -> Option<String> {
    if let Some(query) = parsed_arguments
        .as_ref()
        .and_then(|args| args.pointer("/WebSearch/query"))
        .and_then(Value::as_str)
        .filter(|query| !query.is_empty())
    {
        return Some(query.to_string());
    }

    let title = forwarded
        .pointer("/params/toolCall/title")
        .and_then(Value::as_str)?;

    extract_query_from_cursor_permission_title(title)
}

fn extract_query_from_cursor_permission_title(title: &str) -> Option<String> {
    const PREFIX: &str = "web search: ";
    if title.len() < PREFIX.len() {
        return None;
    }
    if !title[..PREFIX.len()].eq_ignore_ascii_case(PREFIX) {
        return None;
    }
    let query = title[PREFIX.len()..].trim();
    if query.is_empty() {
        tracing::warn!(title = %title, "Web search permission title has empty query after prefix strip");
        return None;
    }
    Some(query.to_string())
}

/// Resolve Cursor launchers from the Acepe-managed install only.
///
/// Returns the cached managed binary as the sole launcher, or empty when Cursor
/// is not installed. It deliberately does not fall back to a PATH-resolved
/// `agent` command: that name is generic enough to collide with unrelated CLIs
/// (e.g. grok's `~/.grok/bin/agent`), which would both spawn a foreign binary
/// and trick `is_available()` into suppressing auto-install-on-connect.
fn resolve_cursor_spawn_configs(
    cached_command: Option<String>,
    cached_args: Vec<String>,
) -> Vec<SpawnConfig> {
    let mut configs = Vec::new();

    if let Some(command) = cached_command {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command,
                args: normalize_cursor_acp_args(cached_args),
                env: HashMap::new(),
                env_strategy: Some(filtered_env_strategy()),
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
            env_strategy: launcher.env_strategy.clone(),
        });
        attempts.push(SpawnConfig {
            command: launcher.command.clone(),
            args: vec!["--list-models".to_string()],
            env: launcher.env.clone(),
            env_strategy: launcher.env_strategy.clone(),
        });
        attempts.push(SpawnConfig {
            command: launcher.command,
            args: vec!["models".to_string()],
            env: launcher.env,
            env_strategy: launcher.env_strategy,
        });
    }

    attempts
}

fn resolve_cursor_authentication_action(
    cached_command: Option<String>,
) -> Option<ProviderAuthenticationAction> {
    let command = cached_command?;
    let build_config = |args: Vec<String>| SpawnConfig {
        command: command.clone(),
        args,
        env: HashMap::new(),
        env_strategy: Some(filtered_env_strategy()),
    };

    Some(ProviderAuthenticationAction {
        status: build_config(vec!["status".to_string()]),
        login: build_config(vec!["login".to_string()]),
        verify: build_config(vec!["status".to_string()]),
    })
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
    fn resolve_spawn_configs_uses_managed_binary_only() {
        let configs = resolve_cursor_spawn_configs(
            Some("/tmp/cursor-agent".to_string()),
            vec!["acp".to_string()],
        );

        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].command, "/tmp/cursor-agent");
        assert_eq!(configs[0].args, vec!["acp"]);
    }

    #[test]
    fn resolve_spawn_configs_is_empty_when_not_installed() {
        // No managed binary cached ⇒ no launcher. Acepe must auto-install the
        // managed `cursor-agent` before it can spawn Cursor; there is no PATH
        // fallback that could mask a missing install.
        let configs = resolve_cursor_spawn_configs(None, Vec::new());

        assert!(
            configs.is_empty(),
            "uninstalled Cursor must not resolve any launcher (no foreign PATH `agent` fallback)"
        );
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
    fn authentication_commands_use_managed_cursor_binary() {
        let action = resolve_cursor_authentication_action(Some("/tmp/cursor-agent".to_string()))
            .expect("installed Cursor should expose authentication recovery");

        assert_eq!(action.status.command, "/tmp/cursor-agent");
        assert_eq!(action.status.args, vec!["status"]);
        assert_eq!(action.login.command, "/tmp/cursor-agent");
        assert_eq!(action.login.args, vec!["login"]);
        assert_eq!(action.verify.args, vec!["status"]);
    }

    #[test]
    fn normalize_cursor_acp_args_defaults_to_acp() {
        assert_eq!(normalize_cursor_acp_args(Vec::new()), vec!["acp"]);
    }

    #[test]
    fn uses_task_reconciler_for_repeated_tool_call_normalization() {
        let provider = CursorProvider;
        assert_eq!(
            provider.task_reconciliation_policy(),
            TaskReconciliationPolicy::ExplicitParentIds
        );
    }

    #[test]
    fn provider_extracts_web_search_notification_dedup_record() {
        let provider = CursorProvider;
        let params = json!({
            "event": "toolCall",
            "data": {
                "toolCallId": "web_search_0",
                "rawInput": {
                    "query": "svelte 5 snippets"
                }
            }
        });

        let record = provider
            .extract_web_search_notification_dedup_record("session/notification", &params)
            .expect("cursor web search notification should produce dedup record");

        assert_eq!(record.tool_call_id, "web_search_0");
        assert_eq!(record.query, "svelte 5 snippets");
    }

    #[test]
    fn extracts_query_from_synthetic_permission_arguments_before_title_fallback() {
        let parsed = Some(json!({"WebSearch": {"query": "tokio async runtime"}}));
        let forwarded = json!({
            "params": {
                "toolCall": {
                    "title": "Web search: ignored fallback"
                }
            }
        });

        assert_eq!(
            extract_cursor_query_from_synthetic_permission(&parsed, &forwarded),
            Some("tokio async runtime".to_string())
        );
    }

    #[test]
    fn extracts_query_from_synthetic_permission_title_fallback() {
        let parsed: Option<Value> = None;
        let forwarded = json!({
            "params": {
                "toolCall": {
                    "title": "Web search: serde json"
                }
            }
        });

        assert_eq!(
            extract_cursor_query_from_synthetic_permission(&parsed, &forwarded),
            Some("serde json".to_string())
        );
    }

    #[test]
    fn query_extraction_preserves_title_casing() {
        assert_eq!(
            extract_query_from_cursor_permission_title("Web search: Rust Language Guide"),
            Some("Rust Language Guide".to_string())
        );
    }

    #[test]
    fn query_extraction_is_case_insensitive_on_prefix() {
        assert_eq!(
            extract_query_from_cursor_permission_title("web search: lowercase prefix"),
            Some("lowercase prefix".to_string())
        );
        assert_eq!(
            extract_query_from_cursor_permission_title("WEB SEARCH: UPPER PREFIX"),
            Some("UPPER PREFIX".to_string())
        );
    }

    #[test]
    fn query_extraction_rejects_empty_or_non_search_titles() {
        assert_eq!(
            extract_query_from_cursor_permission_title("Web search:   "),
            None
        );
        assert_eq!(
            extract_query_from_cursor_permission_title("Edit file: main.rs"),
            None
        );
        assert_eq!(extract_query_from_cursor_permission_title("Web"), None);
    }

    #[test]
    fn agent_mode_round_trips_through_cursor_protocol() {
        let provider = CursorProvider;

        // Acepe's canonical mode name is now "agent" (not "build").
        // "build" is a legacy alias the provider accepts for backward compat.
        assert_eq!(provider.map_outbound_mode_id("agent"), "agent");
        assert_eq!(provider.normalize_mode_id("agent"), "agent");
        assert_eq!(provider.normalize_mode_id("build"), "agent");
        assert_eq!(provider.normalize_mode_id("ask"), "ask");
    }

    #[test]
    fn reconnect_policy_uses_provider_owned_load_semantics() {
        let provider = CursorProvider;
        let reconnect_policy = provider.reconnect_policy(Some("build"));

        assert!(reconnect_policy.use_load_semantics);
        assert_eq!(reconnect_policy.outbound_launch_mode_id, None);
    }

    #[test]
    fn cursor_provider_owns_session_update_enrichment_hook() {
        let source = include_str!("provider.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap_or(source);

        assert!(production_source.contains("fn enrich_session_update<'a>("));
    }
}
