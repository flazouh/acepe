use super::super::provider::{
    AgentProvider, ProjectDiscoveryCompleteness, ProjectPathListing, SpawnConfig,
};
use super::copilot_settings::apply_copilot_session_defaults;
use crate::acp::capability_resolution::resolve_generic_preconnection_capabilities;
use crate::acp::client_session::{SessionModelState, SessionModes};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::parsers::AgentType;
use crate::acp::runtime_resolver::SpawnEnvStrategy;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::AvailableCommand;
use crate::acp::task_reconciler::TaskReconciliationPolicy;
use crate::acp::{agent_installer, types::CanonicalAgentId};
use crate::db::repository::SessionMetadataRepository;
use crate::history::session_context::SessionContext;
use sea_orm::DbConn;
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use tauri::{AppHandle, Manager};

/// GitHub Copilot CLI ACP provider.
pub struct CopilotProvider;

const COPILOT_BINARY_OVERRIDE_ENV: &str = "ACEPE_COPILOT_BIN";
const ACP_STDIO_ARGS: &[&str] = &["--acp", "--stdio"];
const COPILOT_LOGIN_METHOD_ID: &str = "copilot-login";
const COPILOT_MODE_AGENT_URI: &str = "https://agentclientprotocol.com/protocol/session-modes#agent";
const COPILOT_MODE_PLAN_URI: &str = "https://agentclientprotocol.com/protocol/session-modes#plan";
const COPILOT_MODE_AUTOPILOT_URI: &str =
    "https://agentclientprotocol.com/protocol/session-modes#autopilot";
const LEGACY_COPILOT_MODE_AGENT_URI: &str = "https://github.com/github/copilot-cli/mode#agent";
const LEGACY_COPILOT_MODE_PLAN_URI: &str = "https://github.com/github/copilot-cli/mode#plan";
const LEGACY_COPILOT_MODE_AUTOPILOT_URI: &str =
    "https://github.com/github/copilot-cli/mode#autopilot";
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
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
];

impl AgentProvider for CopilotProvider {
    fn id(&self) -> &str {
        "copilot"
    }

    fn name(&self) -> &str {
        "GitHub Copilot"
    }

    fn spawn_config(&self) -> SpawnConfig {
        self.spawn_configs()
            .into_iter()
            .next()
            .unwrap_or_else(|| SpawnConfig {
                command: "__acepe_missing_copilot_binary__".to_string(),
                args: ACP_STDIO_ARGS
                    .iter()
                    .map(|arg| (*arg).to_string())
                    .collect(),
                env: HashMap::new(),
                env_strategy: Some(filtered_env_strategy()),
            })
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        resolve_copilot_spawn_configs(
            agent_installer::get_cached_binary(&CanonicalAgentId::Copilot)
                .map(|path| path.to_string_lossy().to_string()),
            copilot_debug_binary_override(),
        )
    }

    fn icon(&self) -> &str {
        "copilot"
    }

    fn is_available(&self) -> bool {
        !self.spawn_configs().is_empty()
    }

    fn parser_agent_type(&self) -> AgentType {
        AgentType::Copilot
    }

    fn task_reconciliation_policy(&self) -> TaskReconciliationPolicy {
        TaskReconciliationPolicy::ImplicitSingleActiveParent
    }

    fn list_preconnection_commands<'a>(
        &'a self,
        _app: &'a AppHandle,
        cwd: Option<&'a Path>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<AvailableCommand>, String>> + Send + 'a>> {
        Box::pin(async move {
            let Some(cwd) = cwd else {
                return Ok(Vec::new());
            };

            load_copilot_preconnection_commands(cwd, dirs::home_dir().as_deref()).await
        })
    }

    fn list_preconnection_capabilities<'a>(
        &'a self,
        _app: &'a AppHandle,
        cwd: Option<&'a Path>,
    ) -> Pin<Box<dyn Future<Output = crate::acp::capability_resolution::ResolvedCapabilities> + Send + 'a>>
    {
        Box::pin(async move {
            let effective_cwd = cwd
                .map(PathBuf::from)
                .or_else(|| std::env::current_dir().ok())
                .unwrap_or_else(|| PathBuf::from("."));
            resolve_generic_preconnection_capabilities(self, effective_cwd.as_path()).await
        })
    }

    fn authenticate_request_params(&self, auth_methods: &[Value]) -> AcpResult<Option<Value>> {
        let has_copilot_login = auth_methods.iter().any(|method| {
            method
                .get("id")
                .or_else(|| method.get("methodId"))
                .and_then(Value::as_str)
                .is_some_and(|method_id| method_id == COPILOT_LOGIN_METHOD_ID)
        });

        if !has_copilot_login {
            return Err(AcpError::ProtocolError(
                "GitHub Copilot ACP did not advertise copilot-login authentication. Run `copilot login` in the terminal before connecting."
                    .to_string(),
            ));
        }

        Ok(Some(
            serde_json::json!({ "methodId": COPILOT_LOGIN_METHOD_ID }),
        ))
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match id {
            COPILOT_MODE_AGENT_URI
            | COPILOT_MODE_AUTOPILOT_URI
            | LEGACY_COPILOT_MODE_AGENT_URI
            | LEGACY_COPILOT_MODE_AUTOPILOT_URI => "build".to_string(),
            COPILOT_MODE_PLAN_URI | LEGACY_COPILOT_MODE_PLAN_URI => "plan".to_string(),
            other => other.to_string(),
        }
    }

    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        match mode_id {
            "build" => COPILOT_MODE_AGENT_URI.to_string(),
            "plan" => COPILOT_MODE_PLAN_URI.to_string(),
            other => other.to_string(),
        }
    }

    fn reconnect_policy(
        &self,
        requested_launch_mode_id: Option<&str>,
    ) -> crate::acp::provider::ProviderReconnectPolicy {
        crate::acp::provider::ProviderReconnectPolicy {
            use_load_semantics: true,
            outbound_launch_mode_id: requested_launch_mode_id
                .map(|mode_id| self.map_outbound_mode_id(mode_id)),
        }
    }

    fn apply_session_defaults(
        &self,
        cwd: &Path,
        models: &mut SessionModelState,
        modes: &mut SessionModes,
    ) -> AcpResult<()> {
        apply_copilot_session_defaults(cwd, models, modes)
    }

    fn load_provider_owned_session<'a>(
        &'a self,
        app: &'a AppHandle,
        context: &'a SessionContext,
        replay_context: &'a SessionReplayContext,
    ) -> Pin<Box<dyn Future<Output = Result<Option<SessionThreadSnapshot>, String>> + Send + 'a>>
    {
        Box::pin(async move {
            let session_id = &context.local_session_id;
            let db = app.try_state::<DbConn>().map(|state| state.inner().clone());
            let session_title = match db.as_ref() {
                Some(db) => SessionMetadataRepository::get_by_id(db, session_id)
                    .await
                    .ok()
                    .flatten()
                    .map(|row| row.display)
                    .unwrap_or_else(|| {
                        format!("Session {}", &session_id[..8.min(session_id.len())])
                    }),
                None => format!("Session {}", &session_id[..8.min(session_id.len())]),
            };

            match crate::copilot_history::load_thread_snapshot(
                app,
                replay_context,
                &context.effective_project_path,
                &session_title,
            )
            .await
            {
                Ok(session) => Ok(session),
                Err(error) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "Copilot session replay load failed"
                    );
                    Err(format!("Copilot provider history load failed: {error}"))
                }
            }
        })
    }

    fn list_project_paths<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<ProjectPathListing, String>> + Send + 'a>> {
        Box::pin(async move {
            let paths = crate::copilot_history::list_workspace_project_paths().await?;
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
            crate::copilot_history::count_workspace_sessions_for_project(project_path).await
        })
    }

    fn supports_project_discovery(&self) -> bool {
        true
    }
}

fn filtered_env_strategy() -> SpawnEnvStrategy {
    SpawnEnvStrategy::allowlist(ALLOWED_ENV_KEYS)
}

async fn load_copilot_preconnection_commands(
    cwd: &Path,
    home_dir: Option<&Path>,
) -> Result<Vec<AvailableCommand>, String> {
    let agent_roots = copilot_agent_roots(cwd, home_dir);
    let skill_roots = agent_roots
        .iter()
        .map(|root: &PathBuf| root.join("skills"))
        .collect::<Vec<_>>();

    let nested_skill_commands =
        crate::acp::preconnection_slash::load_preconnection_commands_from_roots(&skill_roots)
            .await?;
    let nested_agent_commands =
        crate::acp::preconnection_slash::load_preconnection_commands_from_roots(&agent_roots)
            .await?;

    let mut flat_agent_commands = Vec::new();
    for root in &agent_roots {
        let commands =
            crate::acp::preconnection_slash::load_preconnection_commands_from_flat_markdown_root(
                root,
            )
            .await?;
        flat_agent_commands.extend(commands);
    }

    Ok(
        crate::acp::preconnection_slash::dedupe_preconnection_commands(
            nested_skill_commands
                .into_iter()
                .chain(nested_agent_commands)
                .chain(flat_agent_commands),
        ),
    )
}

fn copilot_agent_roots(cwd: &Path, home_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = vec![cwd.join(".agents")];

    if let Some(home_dir) = home_dir {
        roots.push(home_dir.join(".agents"));
    }

    roots
}

fn copilot_debug_binary_override() -> Option<String> {
    let override_value = std::env::var(COPILOT_BINARY_OVERRIDE_ENV).ok()?;
    let trimmed = override_value.trim();

    if trimmed.is_empty() {
        return None;
    }

    if !Path::new(trimmed).is_file() {
        tracing::warn!(
            env_var = COPILOT_BINARY_OVERRIDE_ENV,
            path = %trimmed,
            "Ignoring Copilot binary override because the file does not exist"
        );
        return None;
    }

    Some(trimmed.to_string())
}

fn resolve_copilot_spawn_configs(
    cached_command: Option<String>,
    debug_override_command: Option<String>,
) -> Vec<SpawnConfig> {
    let mut configs = Vec::new();
    let args: Vec<String> = ACP_STDIO_ARGS
        .iter()
        .map(|arg| (*arg).to_string())
        .collect();

    if let Some(command) = cached_command {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command,
                args: args.clone(),
                env: HashMap::new(),
                env_strategy: Some(filtered_env_strategy()),
            },
        );
    }

    if let Some(command) = debug_override_command {
        push_unique_spawn_config(
            &mut configs,
            SpawnConfig {
                command,
                args,
                env: HashMap::new(),
                env_strategy: Some(filtered_env_strategy()),
            },
        );
    }

    configs
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
    use crate::acp::client::{AvailableModel, SessionModelState, SessionModes};
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    fn skill_file_content(name: &str, description: &str) -> String {
        format!(
            "---\nname: \"{}\"\ndescription: \"{}\"\n---\n\n# {}\n",
            name, description, name
        )
    }

    #[test]
    fn resolve_spawn_configs_prefers_cached_binary_before_debug_override() {
        let configs = resolve_copilot_spawn_configs(
            Some("/tmp/copilot".to_string()),
            Some("/tmp/copilot-debug".to_string()),
        );

        assert_eq!(configs.len(), 2);
        assert_eq!(configs[0].command, "/tmp/copilot");
        assert_eq!(configs[1].command, "/tmp/copilot-debug");
        assert_eq!(configs[0].args, vec!["--acp", "--stdio"]);
    }

    #[test]
    fn resolve_spawn_configs_returns_no_launchers_without_cache_or_override() {
        let configs = resolve_copilot_spawn_configs(None, None);

        assert!(configs.is_empty());
    }

    #[test]
    fn provider_uses_dedicated_copilot_parser_family() {
        let provider = CopilotProvider;

        assert_eq!(provider.parser_agent_type(), AgentType::Copilot);
    }

    #[test]
    fn provider_uses_task_reconciler_for_subagent_tool_graphs() {
        let provider = CopilotProvider;

        assert_eq!(
            provider.task_reconciliation_policy(),
            TaskReconciliationPolicy::ImplicitSingleActiveParent
        );
    }

    #[test]
    fn provider_normalizes_copilot_mode_uris_to_ui_modes() {
        let provider = CopilotProvider;

        assert_eq!(
            provider
                .normalize_mode_id("https://agentclientprotocol.com/protocol/session-modes#agent"),
            "build"
        );
        assert_eq!(
            provider
                .normalize_mode_id("https://agentclientprotocol.com/protocol/session-modes#plan"),
            "plan"
        );
        assert_eq!(
            provider.normalize_mode_id(
                "https://agentclientprotocol.com/protocol/session-modes#autopilot"
            ),
            "build"
        );
        assert_eq!(
            provider.normalize_mode_id("https://github.com/github/copilot-cli/mode#agent"),
            "build"
        );
        assert_eq!(
            provider.normalize_mode_id("https://github.com/github/copilot-cli/mode#plan"),
            "plan"
        );
    }

    #[test]
    fn provider_maps_execution_profiles_to_native_mode_uris() {
        let provider = CopilotProvider;

        assert_eq!(
            provider.map_outbound_mode_id("build"),
            "https://agentclientprotocol.com/protocol/session-modes#agent"
        );
        assert_eq!(
            provider.map_outbound_mode_id("plan"),
            "https://agentclientprotocol.com/protocol/session-modes#plan"
        );
        assert_eq!(provider.autonomous_supported_mode_ids(), &["build"]);
    }

    #[test]
    fn reconnect_policy_maps_launch_mode_through_provider_contract() {
        let provider = CopilotProvider;
        let reconnect_policy = provider.reconnect_policy(Some("build"));

        assert!(reconnect_policy.use_load_semantics);
        assert_eq!(
            reconnect_policy.outbound_launch_mode_id.as_deref(),
            Some("https://agentclientprotocol.com/protocol/session-modes#agent")
        );
    }

    #[test]
    fn provider_selects_copilot_login_auth_method() {
        let provider = CopilotProvider;
        let auth_methods = vec![json!({
            "id": "copilot-login",
            "description": "Run `copilot login` in the terminal"
        })];

        assert_eq!(
            provider
                .authenticate_request_params(&auth_methods)
                .expect("auth params"),
            Some(json!({ "methodId": "copilot-login" }))
        );
    }

    #[test]
    fn provider_errors_when_copilot_login_method_is_missing() {
        let provider = CopilotProvider;

        let error = provider
            .authenticate_request_params(&[])
            .expect_err("missing auth method should fail");

        assert!(error.to_string().contains("copilot login"));
    }

    #[test]
    fn copilot_agent_roots_prioritize_project_before_home() {
        let roots = copilot_agent_roots(Path::new("/repo"), Some(Path::new("/Users/tester")));

        assert_eq!(
            roots,
            vec![
                PathBuf::from("/repo/.agents"),
                PathBuf::from("/Users/tester/.agents"),
            ]
        );
    }

    #[tokio::test]
    async fn copilot_preconnection_commands_merge_home_and_project_agents() {
        let temp = tempdir().expect("temp dir");
        let project = temp.path().join("project");
        let home = temp.path().join("home");

        tokio::fs::create_dir_all(project.join(".agents/skills/systematic-debugging"))
            .await
            .expect("create project skill dir");
        tokio::fs::create_dir_all(home.join(".agents/skills/ce-review"))
            .await
            .expect("create home skill dir");
        tokio::fs::write(
            project.join(".agents/skills/systematic-debugging/SKILL.md"),
            skill_file_content(
                "systematic-debugging",
                "Project-specific systematic debugging flow",
            ),
        )
        .await
        .expect("write project skill");
        tokio::fs::write(
            home.join(".agents/skills/ce-review/SKILL.md"),
            skill_file_content("ce-review", "Review code changes"),
        )
        .await
        .expect("write home skill");

        let commands = load_copilot_preconnection_commands(&project, Some(&home))
            .await
            .expect("load commands");

        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0].name, "systematic-debugging");
        assert_eq!(
            commands[0].description,
            "Project-specific systematic debugging flow"
        );
        assert_eq!(commands[1].name, "ce-review");
        assert_eq!(commands[1].description, "Review code changes");
    }

    #[test]
    fn configured_copilot_model_prefers_project_config_over_user_config() {
        let temp = tempdir().expect("tempdir");
        let home = temp.path().join("home");
        let project = temp.path().join("project");
        fs::create_dir_all(home.join(".copilot")).expect("create user copilot dir");
        fs::create_dir_all(project.join(".copilot")).expect("create project copilot dir");

        fs::write(
            home.join(".copilot/config.json"),
            r#"{
  "model": "gpt-5.4",
  "effortLevel": "high"
}"#,
        )
        .expect("write user config");
        fs::write(
            project.join(".copilot/config.json"),
            r#"{
  "model": "gpt-4.1"
}"#,
        )
        .expect("write project config");

        let mut models = SessionModelState {
            available_models: vec![
                AvailableModel {
                    model_id: "gpt-5.4".to_string(),
                    name: "GPT-5.4".to_string(),
                    description: None,
                },
                AvailableModel {
                    model_id: "gpt-4.1".to_string(),
                    name: "GPT-4.1".to_string(),
                    description: None,
                },
            ],
            current_model_id: "auto".to_string(),
            models_display: Default::default(),
            provider_metadata: None,
        };
        let mut modes = SessionModes {
            current_mode_id: "build".to_string(),
            available_modes: vec![],
        };

        super::super::copilot_settings::apply_copilot_session_defaults_from_paths(
            Some(home.as_path()),
            project.as_path(),
            &mut models,
            &mut modes,
        )
        .expect("copilot session defaults should apply");

        assert_eq!(models.current_model_id, "gpt-4.1");
    }

    #[test]
    fn configured_copilot_model_is_inserted_when_provider_returns_no_catalog() {
        let temp = tempfile::tempdir().expect("tempdir");
        let home = temp.path().join("home");
        let project = temp.path().join("project");
        fs::create_dir_all(home.join(".copilot")).expect("create user copilot dir");
        fs::create_dir_all(&project).expect("create project dir");

        fs::write(
            home.join(".copilot/config.json"),
            r#"{
  "model": "gpt-5.4"
}"#,
        )
        .expect("write user config");

        let mut models = SessionModelState {
            available_models: vec![],
            current_model_id: "auto".to_string(),
            models_display: Default::default(),
            provider_metadata: None,
        };
        let mut modes = SessionModes {
            current_mode_id: "build".to_string(),
            available_modes: vec![],
        };

        super::super::copilot_settings::apply_copilot_session_defaults_from_paths(
            Some(home.as_path()),
            project.as_path(),
            &mut models,
            &mut modes,
        )
        .expect("copilot session defaults should apply");

        assert_eq!(models.current_model_id, "gpt-5.4");
        assert_eq!(models.available_models.len(), 1);
        assert_eq!(models.available_models[0].model_id, "gpt-5.4");
    }

    #[test]
    fn configured_copilot_model_does_not_override_explicit_current_model() {
        let temp = tempfile::tempdir().expect("tempdir");
        let home = temp.path().join("home");
        let project = temp.path().join("project");
        fs::create_dir_all(home.join(".copilot")).expect("create user copilot dir");
        fs::create_dir_all(&project).expect("create project dir");

        fs::write(
            home.join(".copilot/config.json"),
            r#"{
  "model": "gpt-5.4"
}"#,
        )
        .expect("write user config");

        let mut models = SessionModelState {
            available_models: vec![AvailableModel {
                model_id: "gpt-4.1".to_string(),
                name: "GPT-4.1".to_string(),
                description: None,
            }],
            current_model_id: "gpt-4.1".to_string(),
            models_display: Default::default(),
            provider_metadata: None,
        };
        let mut modes = SessionModes {
            current_mode_id: "build".to_string(),
            available_modes: vec![],
        };

        super::super::copilot_settings::apply_copilot_session_defaults_from_paths(
            Some(home.as_path()),
            project.as_path(),
            &mut models,
            &mut modes,
        )
        .expect("copilot session defaults should apply");

        assert_eq!(models.current_model_id, "gpt-4.1");
        assert_eq!(models.available_models.len(), 1);
        assert_eq!(models.available_models[0].model_id, "gpt-4.1");
    }
}
