use super::settings::{
    apply_claude_session_defaults, compare_claude_model_ids, is_claude_model_id,
    resolve_claude_runtime_mode_id,
};
use crate::acp::capability_resolution::{
    failed_capabilities, resolve_static_capabilities, ResolvedCapabilities,
    ResolvedCapabilityStatus,
};
use crate::acp::client::AvailableModel;
use crate::acp::client_session::{
    default_session_model_state, AvailableMode, ModeIconKind, SessionModes,
};
use crate::acp::client_trait::CommunicationMode;
use crate::acp::error::AcpResult;
use crate::acp::provider::{
    AgentProvider, ProjectDiscoveryCompleteness, ProjectPathListing, SpawnConfig,
};
use crate::acp::runtime_resolver::SpawnEnvStrategy;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_thread_snapshot::ProviderOwnedSessionSnapshot;
use crate::acp::session_update::AvailableCommand;
use crate::acp::task_reconciler::TaskReconciliationPolicy;
use crate::history::session_context::SessionContext;
use crate::session_jsonl::display_names::format_model_display_name;
use serde_json::Value;
use std::collections::BTreeSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::time::Duration;
use tauri::AppHandle;

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
        // Return the managed-cache command path so accidental callers stay on the
        // deterministic Claude runtime rather than falling back to PATH.
        self.spawn_configs()
            .into_iter()
            .next()
            .unwrap_or(SpawnConfig {
                command: crate::cc_sdk::transport::subprocess::find_claude_cli()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_else(|_| "acepe-managed-claude-missing".to_string()),
                args: vec![],
                env: std::collections::HashMap::new(),
                env_strategy: Some(claude_env_strategy()),
            })
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        resolve_claude_spawn_configs()
    }

    fn communication_mode(&self) -> CommunicationMode {
        CommunicationMode::CcSdk
    }

    fn preconnection_config_options(&self) -> Vec<crate::acp::session_update::ConfigOptionData> {
        // Claude uses deferred (cc_sdk) creation, so `new_session` does not run
        // before the first prompt. Advertise the reasoning option here so the
        // compact reasoning widget appears in the new-thread setup bar, matching
        // providers whose synchronous new_session already returns it.
        crate::acp::client::cc_sdk_client::reasoning_config::build_claude_reasoning_config_options(
            &crate::acp::client::cc_sdk_client::reasoning_config::ClaudeReasoningConfigState::default(),
        )
    }

    fn icon(&self) -> &str {
        "claude"
    }

    fn is_available(&self) -> bool {
        crate::cc_sdk::transport::subprocess::find_claude_cli().is_ok()
    }

    fn model_discovery_commands(&self) -> Vec<SpawnConfig> {
        // Catalog resolution now owns model discovery; the `-p` probe is no longer used
        // because it costs a real API call per preconnection and returns only one model.
        Vec::new()
    }

    fn model_discovery_timeout(&self) -> Duration {
        Duration::from_secs(15)
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match id {
            "build" => "default".to_string(),
            other => other.to_string(),
        }
    }

    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        match mode_id {
            "build" | "default" => "default".to_string(),
            other => other.to_string(),
        }
    }

    fn visible_mode_ids(&self) -> &'static [&'static str] {
        &["default", "acceptEdits", "plan", "bypassPermissions"]
    }

    fn default_session_modes(&self) -> SessionModes {
        SessionModes {
            current_mode_id: "default".to_string(),
            available_modes: vec![
                AvailableMode::new(
                    "default",
                    "Default",
                    Some("Claude Code default permission mode".to_string()),
                )
                .with_icon_kind(ModeIconKind::Agent),
                AvailableMode::new(
                    "acceptEdits",
                    "Accept Edits",
                    Some(
                        "Claude Code accepts file edits but still asks for other permissions"
                            .to_string(),
                    ),
                )
                .with_icon_kind(ModeIconKind::Edit),
                AvailableMode::new(
                    "plan",
                    "Plan",
                    Some("Claude Code planning mode".to_string()),
                )
                .with_icon_kind(ModeIconKind::Plan),
                AvailableMode::new(
                    "bypassPermissions",
                    "Bypass Permissions",
                    Some("Claude Code skips permission prompts".to_string()),
                )
                .with_icon_kind(ModeIconKind::Bypass),
            ],
        }
    }

    fn resolve_runtime_mode_id(&self, requested_mode_id: Option<&str>, cwd: &Path) -> String {
        resolve_claude_runtime_mode_id(requested_mode_id, cwd)
    }

    fn list_preconnection_commands<'a>(
        &'a self,
        _app: &'a AppHandle,
        _cwd: Option<&'a Path>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<AvailableCommand>, String>> + Send + 'a>> {
        Box::pin(async move {
            match claude_skills_root() {
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
        app: &'a AppHandle,
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
            resolve_claude_preconnection_capabilities(app, self, effective_cwd.as_path()).await
        })
    }

    fn apply_session_defaults(
        &self,
        cwd: &Path,
        models: &mut crate::acp::client::SessionModelState,
        modes: &mut crate::acp::client::SessionModes,
    ) -> AcpResult<()> {
        apply_claude_session_defaults(cwd, models, modes)
    }

    fn task_reconciliation_policy(&self) -> TaskReconciliationPolicy {
        TaskReconciliationPolicy::ExplicitParentIds
    }

    fn load_provider_owned_session<'a>(
        &'a self,
        _app: &'a AppHandle,
        context: &'a SessionContext,
        _replay_context: &'a SessionReplayContext,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        Option<ProviderOwnedSessionSnapshot>,
                        crate::acp::provider::ProviderHistoryLoadError,
                    >,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            use crate::acp::session::delivery::{
                history_error_to_provider_error, load_fold_graph_from_history,
            };
            use crate::acp::session::fold_export::{
                default_session_title, provider_owned_snapshot_from_folded_graph,
            };
            use crate::acp::types::CanonicalAgentId;

            let session_id = &context.local_session_id;
            let title = default_session_title(&context.history_session_id);

            let try_load = |project_path: &str| {
                load_fold_graph_from_history(
                    &CanonicalAgentId::ClaudeCode,
                    &context.history_session_id,
                    project_path,
                    context.source_path.as_deref(),
                )
                .map(|graph| {
                    graph.map(|graph| {
                        provider_owned_snapshot_from_folded_graph(graph, title.clone())
                    })
                })
            };

            match try_load(&context.effective_project_path) {
                Ok(snapshot) => Ok(snapshot),
                Err(_error) if context.effective_project_path != context.project_path => {
                    match try_load(&context.project_path) {
                        Ok(snapshot) => Ok(snapshot),
                        Err(fallback_error) => {
                            tracing::warn!(
                                session_id = %session_id,
                                error = %fallback_error,
                                "Claude session parse failed (both worktree and project paths)"
                            );
                            Err(history_error_to_provider_error(fallback_error))
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "Claude session parse failed"
                    );
                    Err(history_error_to_provider_error(error))
                }
            }
        })
    }

    fn list_project_paths<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<ProjectPathListing, String>> + Send + 'a>> {
        Box::pin(async move {
            let paths = list_claude_project_paths().await?;
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
        Box::pin(async move { count_claude_sessions_for_project(project_path).await })
    }

    fn supports_project_discovery(&self) -> bool {
        true
    }
}

fn resolve_claude_preconnection_capabilities<'a>(
    app: &'a AppHandle,
    provider: &'a dyn AgentProvider,
    cwd: &'a Path,
) -> impl std::future::Future<Output = ResolvedCapabilities> + Send + 'a {
    use super::model_catalog::{self, ClaudeCatalogSnapshotKind};
    async move {
        let mut models = default_session_model_state();

        let catalog = model_catalog::read_catalog_snapshot_for_app(app).await;
        tracing::debug!(
            source = ?catalog.source,
            freshness = ?catalog.freshness,
            refresh_reason = ?catalog.refresh_reason,
            cwd = %cwd.display(),
            "Resolved Claude catalog snapshot state"
        );

        let mut status = ResolvedCapabilityStatus::Partial;
        if let Some(snapshot) = catalog.snapshot {
            status = match snapshot.catalog_kind {
                ClaudeCatalogSnapshotKind::Authoritative => ResolvedCapabilityStatus::Resolved,
                ClaudeCatalogSnapshotKind::HistorySalvage
                | ClaudeCatalogSnapshotKind::Placeholder => ResolvedCapabilityStatus::Partial,
            };
            // Match Claude Code's own `/model` picker: show the latest model per family
            // (opus / sonnet / haiku) only. Older-generation models remain available via
            // --model <id> and are re-injected by apply_claude_session_defaults for any
            // configured model that falls outside this curated set.
            models.available_models = model_catalog::filter_to_picker_defaults(&snapshot.models);
        }

        if let Some(reason) = catalog.refresh_reason {
            model_catalog::spawn_catalog_refresh(app.clone(), reason);
        }

        match resolve_static_capabilities(
            provider,
            cwd,
            status,
            models,
            provider.default_session_modes(),
        ) {
            Ok(capabilities) => capabilities,
            Err(error) => failed_capabilities(provider, error.to_string()),
        }
    }
}

pub(crate) fn discover_claude_history_models(
    home_dir: Option<&Path>,
    data_local_dir: Option<&Path>,
) -> Vec<AvailableModel> {
    let mut model_ids = BTreeSet::new();

    if let Some(home_dir) = home_dir {
        collect_claude_model_ids_from_stats_cache(
            &home_dir.join(".claude").join("stats-cache.json"),
            &mut model_ids,
        );
    }

    if let Some(data_local_dir) = data_local_dir {
        collect_claude_model_ids_from_session_dir(
            &data_local_dir.join("Claude").join("claude-code-sessions"),
            &mut model_ids,
        );
    }

    let mut models: Vec<AvailableModel> = model_ids
        .into_iter()
        .map(|model_id| AvailableModel {
            provider: None,
            name: format_model_display_name(&model_id),
            model_id,
            description: None,
        })
        .collect();
    models.sort_by(|left, right| {
        compare_claude_model_ids(&right.model_id, &left.model_id)
            .then_with(|| left.name.cmp(&right.name))
    });
    models
}

fn collect_claude_model_ids_from_stats_cache(path: &Path, model_ids: &mut BTreeSet<String>) {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&contents) else {
        return;
    };
    let Some(model_usage) = parsed.get("modelUsage").and_then(Value::as_object) else {
        return;
    };

    for model_id in model_usage.keys() {
        maybe_insert_claude_model_id(model_ids, model_id);
    }
}

fn collect_claude_model_ids_from_session_dir(path: &Path, model_ids: &mut BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let entry_path = entry.path();

        if file_type.is_dir() {
            collect_claude_model_ids_from_session_dir(&entry_path, model_ids);
            continue;
        }

        if !file_type.is_file()
            || entry_path.extension().and_then(|ext| ext.to_str()) != Some("json")
        {
            continue;
        }

        let Ok(contents) = std::fs::read_to_string(&entry_path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<Value>(&contents) else {
            continue;
        };
        let Some(model_id) = parsed.get("model").and_then(Value::as_str) else {
            continue;
        };
        maybe_insert_claude_model_id(model_ids, model_id);
    }
}

fn maybe_insert_claude_model_id(model_ids: &mut BTreeSet<String>, raw: &str) {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !is_claude_model_id(trimmed) {
        return;
    }

    model_ids.insert(trimmed.to_string());
}

fn resolve_claude_spawn_configs() -> Vec<SpawnConfig> {
    let mut configs = Vec::new();

    if let Ok(cached) = crate::cc_sdk::transport::subprocess::find_claude_cli() {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: cached.to_string_lossy().to_string(),
                args: vec![],
                env: std::collections::HashMap::new(),
                env_strategy: Some(claude_env_strategy()),
            },
        );
    }

    configs
}

fn claude_env_strategy() -> SpawnEnvStrategy {
    SpawnEnvStrategy::FullInherit
}

fn claude_skills_root() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("skills"))
}

async fn read_cwd_from_project_dir(project_dir: &std::path::Path) -> Option<String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut read_dir = tokio::fs::read_dir(project_dir).await.ok()?;

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.ends_with(".jsonl") {
            continue;
        }

        let file = match tokio::fs::File::open(entry.path()).await {
            Ok(file) => file,
            Err(_) => continue,
        };

        let mut lines = BufReader::new(file).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(cwd) = json.get("cwd").and_then(|value| value.as_str()) {
                    if !cwd.is_empty() {
                        return Some(cwd.to_string());
                    }
                }
            }
        }
    }

    None
}

async fn list_claude_project_paths() -> Result<Vec<String>, String> {
    use crate::session_jsonl::parser::get_session_jsonl_root;

    let jsonl_root = get_session_jsonl_root()
        .map_err(|error| format!("Failed to get session jsonl root: {error}"))?;
    let projects_dir = jsonl_root.join("projects");

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

        if file_name_str.starts_with('.') || file_name_str == "global" {
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

        if let Some(cwd) = read_cwd_from_project_dir(&entry.path()).await {
            project_paths.push(cwd);
        }
    }

    Ok(project_paths)
}

async fn count_claude_sessions_for_project(project_path: &str) -> Result<u32, String> {
    use crate::session_jsonl::parser::{get_session_jsonl_root, path_to_slug};

    let jsonl_root = get_session_jsonl_root()
        .map_err(|error| format!("Failed to get session jsonl root: {error}"))?;
    let project_dir = jsonl_root.join("projects").join(path_to_slug(project_path));

    if !project_dir.exists() || !project_dir.is_dir() {
        return Ok(0);
    }

    let mut count = 0u32;
    let mut read_dir = tokio::fs::read_dir(&project_dir)
        .await
        .map_err(|error| format!("Failed to read project directory {project_path}: {error}"))?;

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

        if entry.file_name().to_string_lossy().ends_with(".jsonl") {
            count += 1;
        }
    }

    Ok(count)
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
    use std::ffi::OsString;

    struct TempHomeEnvGuard {
        previous_home: Option<OsString>,
        previous_xdg_cache_home: Option<OsString>,
        #[cfg(windows)]
        previous_local_app_data: Option<OsString>,
    }

    impl TempHomeEnvGuard {
        fn install(temp_root: &Path) -> Self {
            let previous_home = std::env::var_os("HOME");
            let previous_xdg_cache_home = std::env::var_os("XDG_CACHE_HOME");
            #[cfg(windows)]
            let previous_local_app_data = std::env::var_os("LOCALAPPDATA");

            std::env::set_var("HOME", temp_root);
            std::env::set_var("XDG_CACHE_HOME", temp_root.join(".cache"));
            #[cfg(windows)]
            std::env::set_var("LOCALAPPDATA", temp_root.join("AppData").join("Local"));

            Self {
                previous_home,
                previous_xdg_cache_home,
                #[cfg(windows)]
                previous_local_app_data,
            }
        }
    }

    impl Drop for TempHomeEnvGuard {
        fn drop(&mut self) {
            match self.previous_home.as_ref() {
                Some(home) => std::env::set_var("HOME", home),
                None => std::env::remove_var("HOME"),
            }

            match self.previous_xdg_cache_home.as_ref() {
                Some(path) => std::env::set_var("XDG_CACHE_HOME", path),
                None => std::env::remove_var("XDG_CACHE_HOME"),
            }

            #[cfg(windows)]
            match self.previous_local_app_data.as_ref() {
                Some(path) => std::env::set_var("LOCALAPPDATA", path),
                None => std::env::remove_var("LOCALAPPDATA"),
            }
        }
    }

    fn with_temp_home<T>(test: impl FnOnce() -> T) -> T {
        let _guard = crate::acp::lock_home_env_for_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let _home_guard = TempHomeEnvGuard::install(temp.path());
        test()
    }

    #[cfg(unix)]
    fn write_managed_claude(version: &str) -> PathBuf {
        let path = crate::cc_sdk::cli_download::get_cached_cli_path().expect("managed cache path");
        let parent = path.parent().expect("parent");
        std::fs::create_dir_all(parent).expect("create cache dir");
        std::fs::write(
            &path,
            format!(
                "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo {}\nelse\n  exit 0\nfi\n",
                version
            ),
        )
        .expect("write cli");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&path).expect("metadata").permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms).expect("chmod");
        }
        path
    }

    #[cfg(unix)]
    #[test]
    fn spawn_config_uses_managed_cache_path() {
        with_temp_home(|| {
            let cached_path = write_managed_claude("2.1.104");
            let provider = ClaudeCodeProvider;
            let config = provider.spawn_config();

            assert_eq!(config.command, cached_path.to_string_lossy());
        });
    }

    #[cfg(unix)]
    #[test]
    fn spawn_configs_do_not_fall_back_to_path() {
        with_temp_home(|| {
            let cached_path = write_managed_claude("2.1.104");
            let provider = ClaudeCodeProvider;
            let configs = provider.spawn_configs();

            assert_eq!(configs.len(), 1);
            assert_eq!(configs[0].command, cached_path.to_string_lossy());
        });
    }

    #[cfg(unix)]
    #[test]
    fn model_discovery_commands_are_empty_catalog_owns_discovery() {
        with_temp_home(|| {
            let _cached_path = write_managed_claude("2.1.104");
            let provider = ClaudeCodeProvider;
            let attempts = provider.model_discovery_commands();

            // Catalog resolution now owns model discovery; the `-p` CLI probe is removed.
            assert_eq!(attempts.len(), 0);
        });
    }

    #[test]
    fn provider_reports_unavailable_when_managed_claude_is_missing() {
        with_temp_home(|| {
            let provider = ClaudeCodeProvider;
            assert!(!provider.is_available());
        });
    }

    #[cfg(unix)]
    #[test]
    fn provider_reports_unavailable_when_managed_claude_is_below_floor() {
        with_temp_home(|| {
            write_managed_claude("2.0.9");
            let provider = ClaudeCodeProvider;
            assert!(!provider.is_available());
        });
    }

    #[cfg(unix)]
    #[test]
    fn spawn_config_does_not_bypass_managed_version_gate() {
        with_temp_home(|| {
            write_managed_claude("2.0.9");
            let provider = ClaudeCodeProvider;

            assert_eq!(
                provider.spawn_config().command,
                "acepe-managed-claude-missing"
            );
        });
    }

    #[test]
    fn provider_uses_cc_sdk_communication_mode() {
        let provider = ClaudeCodeProvider;

        assert_eq!(provider.communication_mode(), CommunicationMode::CcSdk);
    }

    #[test]
    fn preconnection_config_options_advertise_reasoning_for_deferred_setup_bar() {
        let provider = ClaudeCodeProvider;

        let options = provider.preconnection_config_options();

        // Claude is deferred-creation (cc_sdk), so the new-thread setup bar relies
        // on this preconnection path to surface the reasoning widget pre-start.
        let reasoning = options
            .iter()
            .find(|option| option.id == "reasoning_effort")
            .expect("reasoning option advertised pre-connection");
        assert_eq!(
            reasoning.presentation,
            crate::acp::session_update::ConfigOptionPresentation::CompactReasoning
        );
    }

    #[test]
    fn claude_provider_has_no_seeded_model_candidates() {
        let provider = ClaudeCodeProvider;

        let attempts = provider.model_discovery_commands();

        // Catalog resolution now owns model discovery; no CLI probe is seeded.
        assert_eq!(attempts.len(), 0);
    }

    #[test]
    fn claude_provider_uses_extended_model_discovery_timeout() {
        let provider = ClaudeCodeProvider;

        assert_eq!(provider.model_discovery_timeout(), Duration::from_secs(15));
    }

    #[test]
    fn claude_provider_preserves_permission_modes_as_canonical_capabilities() {
        let provider = ClaudeCodeProvider;

        let modes = provider.default_session_modes();
        let mode_ids: Vec<&str> = modes
            .available_modes
            .iter()
            .map(|mode| mode.id.as_str())
            .collect();

        assert_eq!(
            mode_ids,
            vec!["default", "acceptEdits", "plan", "bypassPermissions"]
        );
        assert_eq!(provider.visible_mode_ids(), mode_ids.as_slice());
        assert_eq!(provider.normalize_mode_id("acceptEdits"), "acceptEdits");
        assert_eq!(
            provider.normalize_mode_id("bypassPermissions"),
            "bypassPermissions"
        );
    }

    #[test]
    fn claude_provider_owns_permission_mode_resolution_logic() {
        let provider = ClaudeCodeProvider;
        assert_eq!(
            provider.resolve_runtime_mode_id(Some("build"), Path::new(".")),
            "build"
        );
    }

    #[test]
    fn discover_claude_history_models_merges_stats_cache_and_session_history() {
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let data_local_dir = temp.path().join("data");
        let session_dir = data_local_dir
            .join("Claude")
            .join("claude-code-sessions")
            .join("org-1")
            .join("project-1");
        std::fs::create_dir_all(home.join(".claude")).expect("create home claude dir");
        std::fs::create_dir_all(&session_dir).expect("create session dir");
        std::fs::write(
            home.join(".claude").join("stats-cache.json"),
            r#"{
  "modelUsage": {
    "claude-opus-4-6": {},
    "claude-sonnet-4-6": {},
    "minimax-m2.5:cloud": {}
  }
}"#,
        )
        .expect("write stats cache");
        std::fs::write(
            session_dir.join("session.json"),
            r#"{
  "model": "claude-sonnet-4-5-20250929"
}"#,
        )
        .expect("write session file");

        let models = discover_claude_history_models(Some(&home), Some(&data_local_dir));
        let model_ids: Vec<&str> = models.iter().map(|model| model.model_id.as_str()).collect();

        assert_eq!(
            model_ids,
            vec![
                "claude-sonnet-4-6",
                "claude-opus-4-6",
                "claude-sonnet-4-5-20250929"
            ]
        );
    }
}
