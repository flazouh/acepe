use super::super::provider::{
    command_exists, AgentProvider, ModelFallbackCandidate, ProjectDiscoveryCompleteness,
    ProjectPathListing, SpawnConfig,
};
use super::claude_code_settings::resolve_claude_runtime_mode_id;
use crate::acp::client_trait::CommunicationMode;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::AvailableCommand;
use crate::acp::task_reconciler::TaskReconciliationPolicy;
use crate::acp::{agent_installer, types::CanonicalAgentId};
use crate::history::session_context::SessionContext;
use crate::session_jsonl::types::ConvertedSession;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use tauri::AppHandle;

const CLAUDE_OPUS_MODEL_ID: &str = "claude-opus-4-6";
const CLAUDE_SONNET_MODEL_ID: &str = "claude-sonnet-4-6";
const CLAUDE_HAIKU_MODEL_ID: &str = "claude-haiku-4-5-20251001";

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
                model_id: CLAUDE_OPUS_MODEL_ID.to_string(),
                name: "Claude Opus 4.6".to_string(),
                description: Some("Most capable Claude model".to_string()),
            },
            ModelFallbackCandidate {
                model_id: CLAUDE_SONNET_MODEL_ID.to_string(),
                name: "Claude Sonnet 4.6".to_string(),
                description: Some("Balanced Claude model for most tasks".to_string()),
            },
            ModelFallbackCandidate {
                model_id: CLAUDE_HAIKU_MODEL_ID.to_string(),
                name: "Claude Haiku 4.5".to_string(),
                description: Some("Fastest and cheapest Claude model".to_string()),
            },
        ]
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match id {
            "default" | "acceptEdits" | "bypassPermissions" => "build".to_string(),
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
                Some(root) => crate::acp::preconnection_slash::load_preconnection_commands_from_root(
                    &root,
                )
                .await,
                None => Ok(Vec::new()),
            }
        })
    }

    fn uses_task_reconciler(&self) -> bool {
        self.task_reconciliation_policy().uses_task_reconciler()
    }

    fn task_reconciliation_policy(&self) -> TaskReconciliationPolicy {
        TaskReconciliationPolicy::ExplicitParentIds
    }

    fn load_provider_owned_session<'a>(
        &'a self,
        _app: &'a AppHandle,
        context: &'a SessionContext,
        _replay_context: &'a SessionReplayContext,
    ) -> Pin<Box<dyn Future<Output = Result<Option<ConvertedSession>, String>> + Send + 'a>> {
        Box::pin(async move {
            let session_id = &context.local_session_id;

            match crate::session_jsonl::parser::parse_full_session(
                &context.history_session_id,
                &context.effective_project_path,
            )
            .await
            {
                Ok(full_session) => Ok(Some(
                    crate::session_converter::convert_claude_full_session_to_entries(&full_session),
                )),
                Err(_) if context.effective_project_path != context.project_path => {
                    match crate::session_jsonl::parser::parse_full_session(
                        &context.history_session_id,
                        &context.project_path,
                    )
                    .await
                    {
                        Ok(full_session) => Ok(Some(
                            crate::session_converter::convert_claude_full_session_to_entries(
                                &full_session,
                            ),
                        )),
                        Err(error) => {
                            tracing::warn!(
                                session_id = %session_id,
                                error = %error,
                                "Claude session parse failed (both worktree and project paths)"
                            );
                            Ok(None)
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "Claude session parse failed"
                    );
                    Ok(None)
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
    const CLAUDE_PROVIDER_SOURCE: &str = include_str!("claude_code.rs");
    const CLAUDE_PROVIDER_SETTINGS_SOURCE: &str = include_str!("claude_code_settings.rs");
    const CC_SDK_CLIENT_SOURCE: &str = include_str!("../client/cc_sdk_client.rs");

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
            .any(|model| model.model_id == "claude-sonnet-4-6"));
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

    #[test]
    fn claude_provider_normalizes_bypass_permissions_to_build() {
        let provider = ClaudeCodeProvider;

        assert_eq!(provider.normalize_mode_id("bypassPermissions"), "build");
    }

    #[test]
    fn claude_provider_owns_permission_mode_resolution_logic() {
        assert!(
            CLAUDE_PROVIDER_SOURCE.contains("resolve_runtime_mode_id"),
            "Claude provider should own runtime mode resolution"
        );
        assert!(
            CLAUDE_PROVIDER_SETTINGS_SOURCE.contains("configured_claude_permission_mode"),
            "Claude provider helper should own settings-based permission resolution"
        );
        assert!(
            !CC_SDK_CLIENT_SOURCE.contains("configured_claude_permission_mode"),
            "cc_sdk_client should not parse Claude settings directly"
        );
    }
}
