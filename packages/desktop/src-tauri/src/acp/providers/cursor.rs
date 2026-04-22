//! Cursor Agent Provider
//!
//! This provider spawns Cursor CLI's native ACP server via `agent acp`.

use super::super::provider::{
    command_exists, AgentProvider, ModelFallbackCandidate, ProjectDiscoveryCompleteness,
    ProjectPathListing, SpawnConfig,
};
use super::cursor_session_update_enrichment::enrich_cursor_session_update;
use crate::acp::cursor_extensions::{
    adapt_cursor_response, cursor_extension_kind, is_cursor_extension_pre_tool,
    normalize_cursor_extension,
};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::provider_extensions::{InboundResponseAdapter, ProviderExtensionEvent};
use crate::acp::runtime_resolver::SpawnEnvStrategy;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::AvailableCommand;
use crate::acp::session_update::SessionUpdate;
use crate::acp::task_reconciler::TaskReconciliationPolicy;
use crate::history::session_context::SessionContext;
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
                "Cursor launcher unavailable in cache and PATH; returning placeholder spawn config"
            );
            SpawnConfig {
                command: "agent".to_string(),
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

    fn records_web_search_notification_dedup(&self) -> bool {
        true
    }

    fn is_web_search_tool_call_id(&self, id: &str) -> bool {
        id.starts_with("web_search_") || id.starts_with("ws_")
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

    fn load_provider_owned_session<'a>(
        &'a self,
        _app: &'a AppHandle,
        context: &'a SessionContext,
        _replay_context: &'a SessionReplayContext,
    ) -> Pin<Box<dyn Future<Output = Result<Option<SessionThreadSnapshot>, String>> + Send + 'a>>
    {
        Box::pin(async move {
            let session_id = &context.local_session_id;
            let lookup_session_id = &context.history_session_id;

            if let Some(source_path) = context.source_path.as_deref() {
                match crate::cursor_history::parser::load_session_from_source(
                    lookup_session_id,
                    source_path,
                )
                .await
                {
                    Ok(Some(full_session)) => Ok(Some(
                        crate::session_converter::convert_cursor_full_session_to_thread_snapshot(
                            &full_session,
                        ),
                    )),
                    Ok(None) => {
                        match crate::cursor_history::parser::find_session_by_id(lookup_session_id)
                            .await
                        {
                            Ok(Some(full_session)) => Ok(Some(
                                crate::session_converter::convert_cursor_full_session_to_thread_snapshot(
                                    &full_session,
                                ),
                            )),
                            Ok(None) => Ok(None),
                            Err(error) => {
                                tracing::warn!(
                                    session_id = %session_id,
                                    error = %error,
                                    "Cursor session lookup failed"
                                );
                                Ok(None)
                            }
                        }
                    }
                    Err(error) => {
                        tracing::warn!(
                            session_id = %session_id,
                            source_path = %source_path,
                            error = %error,
                            "Cursor source_path load failed, falling back to find_session_by_id"
                        );
                        match crate::cursor_history::parser::find_session_by_id(lookup_session_id)
                            .await
                        {
                            Ok(Some(full_session)) => Ok(Some(
                                crate::session_converter::convert_cursor_full_session_to_thread_snapshot(
                                    &full_session,
                                ),
                            )),
                            Ok(None) => Ok(None),
                            Err(error) => {
                                tracing::warn!(
                                    session_id = %session_id,
                                    error = %error,
                                    "Cursor session lookup failed"
                                );
                                Ok(None)
                            }
                        }
                    }
                }
            } else {
                match crate::cursor_history::parser::find_session_by_id(lookup_session_id).await {
                    Ok(Some(full_session)) => Ok(Some(
                        crate::session_converter::convert_cursor_full_session_to_thread_snapshot(
                            &full_session,
                        ),
                    )),
                    Ok(None) => Ok(None),
                    Err(error) => {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %error,
                            "Cursor session lookup failed"
                        );
                        Ok(None)
                    }
                }
            }
        })
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

fn resolve_cursor_spawn_configs(
    cached_command: Option<String>,
    cached_args: Vec<String>,
    path_agent_available: bool,
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

    if path_agent_available {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "agent".to_string(),
                args: vec!["acp".to_string()],
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
        assert_eq!(
            provider.task_reconciliation_policy(),
            TaskReconciliationPolicy::ExplicitParentIds
        );
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
    fn build_mode_round_trips_to_cursor_agent_mode() {
        let provider = CursorProvider;

        assert_eq!(provider.map_outbound_mode_id("build"), "agent");
        assert_eq!(provider.normalize_mode_id("agent"), "build");
        assert_eq!(provider.normalize_mode_id("ask"), "build");
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
        let source = include_str!("cursor.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap_or(source);

        assert!(production_source.contains("fn enrich_session_update<'a>("));
    }
}
