use super::super::provider::{
    command_exists, AgentProvider, ProjectDiscoveryCompleteness, ProjectPathListing, SpawnConfig,
};
use crate::acp::client::codex_native_config::CODEX_BUILD_FULL_ACCESS_MODE_ID;
use crate::acp::client_trait::CommunicationMode;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::AvailableCommand;
use crate::acp::session_update::SessionUpdate;
use crate::acp::types::ContentBlock;
use crate::acp::{agent_installer, types::CanonicalAgentId};
use crate::history::session_context::SessionContext;
use crate::session_jsonl::types::ConvertedSession;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use tauri::AppHandle;

/// Native Codex app-server provider.
pub struct CodexProvider;

impl AgentProvider for CodexProvider {
    fn id(&self) -> &str {
        "codex"
    }

    fn name(&self) -> &str {
        "Codex Agent"
    }

    fn spawn_config(&self) -> SpawnConfig {
        self.spawn_configs()
            .into_iter()
            .next()
            .expect("Codex provider must return at least one spawn config")
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        let mut configs = Vec::new();

        if let Some(cached) = agent_installer::get_cached_binary(&CanonicalAgentId::Codex) {
            push_unique_spawn_config(
                &mut configs,
                SpawnConfig {
                    command: cached.to_string_lossy().to_string(),
                    args: vec!["app-server".to_string()],
                    env: codex_env(),
                },
            );
        }

        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command: "codex".to_string(),
                args: vec!["app-server".to_string()],
                env: codex_env(),
            },
        );

        configs
    }

    fn communication_mode(&self) -> CommunicationMode {
        CommunicationMode::CodexNative
    }

    fn list_preconnection_commands<'a>(
        &'a self,
        _app: &'a AppHandle,
        _cwd: Option<&'a Path>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<AvailableCommand>, String>> + Send + 'a>> {
        Box::pin(async move {
            match codex_skills_root() {
                Some(root) => crate::acp::preconnection_slash::load_preconnection_commands_from_root(
                    &root,
                )
                .await,
                None => Ok(Vec::new()),
            }
        })
    }

    fn icon(&self) -> &str {
        "codex"
    }

    fn is_available(&self) -> bool {
        agent_installer::get_cached_binary(&CanonicalAgentId::Codex).is_some()
            || command_exists("codex")
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
            ("build", false) => Some("build".to_string()),
            ("build", true) => Some(CODEX_BUILD_FULL_ACCESS_MODE_ID.to_string()),
            ("plan", false) => Some("plan".to_string()),
            ("plan", true) => None,
            (_, false) => Some(mode_id.to_string()),
            (_, true) => None,
        }
    }

    fn load_provider_owned_session<'a>(
        &'a self,
        _app: &'a AppHandle,
        context: &'a SessionContext,
        _replay_context: &'a SessionReplayContext,
    ) -> Pin<Box<dyn Future<Output = Result<Option<ConvertedSession>, String>> + Send + 'a>> {
        Box::pin(async move {
            let session_id = &context.local_session_id;

            match crate::codex_history::parser::load_session(
                &context.history_session_id,
                &context.effective_project_path,
                context.source_path.as_deref(),
            )
            .await
            {
                Ok(session) => Ok(session),
                Err(error) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "Codex session parse failed"
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
            let paths = crate::codex_history::scanner::list_project_paths()
                .await
                .map_err(|error| format!("Failed to list Codex projects: {error}"))?;
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
        Box::pin(async move {
            crate::codex_history::scanner::count_sessions_for_project(project_path)
                .await
                .map_err(|error| format!("Failed to count Codex sessions: {error}"))
        })
    }
}

pub(crate) fn adapt_codex_wrapper_plan_update(update: &SessionUpdate) -> Option<SessionUpdate> {
    match update {
        SessionUpdate::AgentMessageChunk {
            chunk, session_id, ..
        }
        | SessionUpdate::AgentThoughtChunk {
            chunk, session_id, ..
        } => {
            let session_id = session_id.as_deref()?;
            let text = match &chunk.content {
                ContentBlock::Text { text } => text.as_str(),
                _ => return None,
            };
            let plan =
                crate::acp::streaming_accumulator::process_codex_plan_chunk(session_id, text)?;
            Some(SessionUpdate::Plan {
                plan,
                session_id: Some(session_id.to_string()),
            })
        }
        SessionUpdate::TurnComplete { session_id }
        | SessionUpdate::TurnError { session_id, .. } => {
            let session_id = session_id.as_deref()?;
            let plan = crate::acp::streaming_accumulator::finalize_codex_plan_turn(session_id);
            plan.map(|plan| SessionUpdate::Plan {
                plan,
                session_id: Some(session_id.to_string()),
            })
        }
        _ => None,
    }
}

fn codex_env() -> std::collections::HashMap<String, String> {
    crate::shell_env::build_env(crate::shell_env::EnvStrategy::FullInherit)
}

fn codex_skills_root() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".codex").join("skills"))
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
    use std::fs;
    use std::io::Write;
    use std::sync::Once;

    fn test_codex_binary_name() -> &'static str {
        #[cfg(windows)]
        {
            return "codex.exe";
        }

        #[cfg(not(windows))]
        {
            return "codex";
        }
    }

    fn test_codex_meta_command() -> &'static str {
        #[cfg(windows)]
        {
            return "./codex.exe";
        }

        #[cfg(not(windows))]
        {
            return "./codex";
        }
    }

    fn ensure_test_codex_cache_dir() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let temp = tempfile::tempdir().expect("temp dir");
            let p = temp.path();

            let codex_dir = p.join("codex");
            fs::create_dir_all(&codex_dir).expect("create codex");
            fs::File::create(codex_dir.join(test_codex_binary_name()))
                .expect("create stub")
                .write_all(b"stub")
                .expect("write stub");
            let meta = serde_json::json!({
                "version": "0.117.0",
                "archive_url": "https://github.com/openai/codex/releases/test",
                "sha256": null,
                "downloaded_at": "2026-01-01T00:00:00Z",
                "cmd": test_codex_meta_command(),
                "args": []
            });
            fs::write(
                codex_dir.join("meta.json"),
                serde_json::to_string_pretty(&meta).expect("serialize meta"),
            )
            .expect("write meta.json");

            agent_installer::set_cache_dir(p.to_path_buf());
            Box::leak(Box::new(temp));
        });
    }

    #[test]
    fn spawn_config_never_panics() {
        let provider = CodexProvider;
        let result = std::panic::catch_unwind(|| provider.spawn_config());

        assert!(result.is_ok(), "spawn_config should never panic");
        let config = result.expect("spawn_config should return config");
        assert!(
            !config.command.trim().is_empty(),
            "spawn command should never be empty"
        );
    }

    #[test]
    fn spawn_config_uses_native_codex_app_server() {
        let provider = CodexProvider;
        let config = provider.spawn_config();

        assert_eq!(config.args, vec!["app-server".to_string()]);
        assert!(!config.command.trim().is_empty());
    }

    #[test]
    fn spawn_config_prefers_cached_codex_binary_when_available() {
        ensure_test_codex_cache_dir();
        let provider = CodexProvider;
        let config = provider.spawn_config();

        assert_ne!(config.command, "codex");
        assert!(
            config.command.ends_with("codex") || config.command.ends_with("codex.exe"),
            "expected cached Codex binary path, got {}",
            config.command
        );
        assert_eq!(config.args, vec!["app-server".to_string()]);
    }

    #[test]
    fn provider_uses_native_communication_mode() {
        let provider = CodexProvider;

        assert_eq!(
            provider.communication_mode(),
            CommunicationMode::CodexNative
        );
    }

    #[test]
    fn autonomous_execution_maps_build_to_full_access_profile() {
        let provider = CodexProvider;

        assert_eq!(provider.autonomous_supported_mode_ids(), &["build"]);
        assert_eq!(
            provider.map_execution_profile_mode_id("build", false),
            Some("build".to_string())
        );
        assert_eq!(
            provider.map_execution_profile_mode_id("build", true),
            Some("build-full-access".to_string())
        );
        assert_eq!(
            provider.map_execution_profile_mode_id("plan", false),
            Some("plan".to_string())
        );
        assert_eq!(provider.map_execution_profile_mode_id("plan", true), None);
    }
}
