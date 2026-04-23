use super::*;
use crate::acp::client::session_lifecycle::reconnect_policy_for_provider;
use crate::acp::client_session::default_modes;
use crate::acp::model_display::ModelsForDisplay;
use crate::acp::parsers::AgentType;
use crate::acp::projections::{InteractionState, ProjectionRegistry};
use crate::acp::provider::SpawnConfig;
use crate::acp::session_descriptor::{SessionCompatibilityInput, SessionReplayContext};
use crate::acp::session_journal::load_stored_projection;
use crate::acp::session_update::PlanSource;
use crate::acp::session_update::{PermissionData, SessionUpdate};
use crate::db::migrations::Migrator;
use crate::db::repository::{
    SessionJournalEventRepository, SessionMetadataRepository, SessionProjectionSnapshotRepository,
};
use sea_orm::{Database, DbConn};
use sea_orm_migration::MigratorTrait;
use std::collections::HashMap;
use std::sync::Arc as StdArc;

const CLIENT_MOD_SOURCE: &str = include_str!("mod.rs");
const CLIENT_STATE_SOURCE: &str = include_str!("state.rs");
const CLIENT_LOOP_SOURCE: &str = include_str!("../client_loop.rs");
const CLIENT_TRANSPORT_SOURCE: &str = include_str!("../client_transport.rs");
const PROVIDER_SOURCE: &str = include_str!("../provider.rs");
const TASK_RECONCILER_SOURCE: &str = include_str!("../task_reconciler.rs");
const CLIENT_UPDATES_MOD_SOURCE: &str = include_str!("../client_updates/mod.rs");
const INBOUND_ROUTER_HELPERS_SOURCE: &str = include_str!("../inbound_request_router/helpers.rs");
const CLIENT_UPDATES_PLAN_SOURCE: &str = include_str!("../client_updates/plan.rs");
const MODEL_DISPLAY_SOURCE: &str = include_str!("../model_display.rs");

fn production_source(source: &str) -> &str {
    source.split("#[cfg(test)]").next().unwrap_or(source)
}

struct TestProvider {
    id: &'static str,
}

struct RetryingProvider;

struct NoLauncherProvider;

fn failing_spawn_config() -> SpawnConfig {
    SpawnConfig {
        command: "/bin/sh".to_string(),
        args: vec![
            "-c".to_string(),
            "echo 'error: An unknown error occurred (Unexpected)' >&2; exit 1".to_string(),
        ],
        env: HashMap::new(),
        env_strategy: None,
    }
}

fn successful_spawn_config() -> SpawnConfig {
    SpawnConfig {
        command: "python3".to_string(),
        args: vec![
            "-u".to_string(),
            "-c".to_string(),
            "import json, sys; req = json.loads(sys.stdin.readline()); print(json.dumps({'jsonrpc': '2.0', 'id': req['id'], 'result': {'protocolVersion': 1, 'agentCapabilities': {}, 'agentInfo': {}, 'authMethods': []}}), flush=True)".to_string(),
        ],
        env: HashMap::new(),
        env_strategy: None,
    }
}

impl AgentProvider for TestProvider {
    fn id(&self) -> &str {
        self.id
    }

    fn name(&self) -> &str {
        "Test Provider"
    }

    fn spawn_config(&self) -> SpawnConfig {
        SpawnConfig {
            command: "true".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            env_strategy: None,
        }
    }

    fn initialize_params(&self, client_name: &str, client_version: &str) -> Value {
        if self.id == "cursor" {
            return json!({
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
            });
        }

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

    fn authenticate_request_params(&self, auth_methods: &[Value]) -> AcpResult<Option<Value>> {
        if self.id != "cursor" {
            return Ok(None);
        }

        let has_cursor_login = auth_methods.iter().any(|method| {
            method
                .get("id")
                .or_else(|| method.get("methodId"))
                .and_then(Value::as_str)
                .is_some_and(|method_id| method_id == "cursor_login")
        });

        if has_cursor_login {
            Ok(Some(json!({ "methodId": "cursor_login" })))
        } else {
            Err(AcpError::ProtocolError("missing cursor_login".to_string()))
        }
    }

    fn normalize_mode_id(&self, id: &str) -> String {
        match (self.id, id) {
            ("claude-code", "default" | "acceptEdits") => "build".to_string(),
            ("cursor", "ask" | "agent") => "build".to_string(),
            _ => id.to_string(),
        }
    }

    fn map_outbound_mode_id(&self, mode_id: &str) -> String {
        match (self.id, mode_id) {
            ("claude-code", "build") => "default".to_string(),
            _ => mode_id.to_string(),
        }
    }

    fn reconnect_policy(
        &self,
        requested_launch_mode_id: Option<&str>,
    ) -> crate::acp::provider::ProviderReconnectPolicy {
        match self.id {
            "cursor" => crate::acp::provider::ProviderReconnectPolicy {
                use_load_semantics: true,
                outbound_launch_mode_id: None,
            },
            "copilot" => crate::acp::provider::ProviderReconnectPolicy {
                use_load_semantics: true,
                outbound_launch_mode_id: requested_launch_mode_id
                    .map(|mode_id| self.map_outbound_mode_id(mode_id)),
            },
            _ => crate::acp::provider::ProviderReconnectPolicy::default(),
        }
    }

    fn model_fallback_for_empty_list(
        &self,
        current_model_id: &str,
    ) -> Option<crate::acp::provider::ModelFallbackCandidate> {
        if self.id != "cursor" {
            return None;
        }

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
        Some(crate::acp::provider::ModelFallbackCandidate {
            model_id,
            name,
            description: Some("Agent-managed model selection".to_string()),
        })
    }

    fn default_plan_source(&self) -> PlanSource {
        match self.id {
            "claude-code" | "cursor" => PlanSource::Deterministic,
            _ => PlanSource::Heuristic,
        }
    }
}

impl AgentProvider for RetryingProvider {
    fn id(&self) -> &str {
        "claude-code"
    }

    fn name(&self) -> &str {
        "Retrying Provider"
    }

    fn spawn_config(&self) -> SpawnConfig {
        failing_spawn_config()
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        vec![failing_spawn_config(), successful_spawn_config()]
    }
}

impl AgentProvider for NoLauncherProvider {
    fn id(&self) -> &str {
        "cursor"
    }

    fn name(&self) -> &str {
        "No Launcher Provider"
    }

    fn spawn_config(&self) -> SpawnConfig {
        SpawnConfig {
            command: "agent".to_string(),
            args: vec!["acp".to_string()],
            env: HashMap::new(),
            env_strategy: None,
        }
    }

    fn spawn_configs(&self) -> Vec<SpawnConfig> {
        Vec::new()
    }
}

fn create_test_client() -> AcpClient {
    let provider: StdArc<dyn AgentProvider> = StdArc::new(TestProvider { id: "codex" });
    let cwd = std::env::current_dir().expect("current dir should be available");
    AcpClient::new_with_provider(provider, None, cwd).expect("client should be created")
}

fn create_cursor_test_client() -> AcpClient {
    let provider: StdArc<dyn AgentProvider> = StdArc::new(TestProvider { id: "cursor" });
    let cwd = std::env::current_dir().expect("current dir should be available");
    AcpClient::new_with_provider(provider, None, cwd).expect("client should be created")
}

fn create_retry_test_client() -> AcpClient {
    let provider: StdArc<dyn AgentProvider> = StdArc::new(RetryingProvider);
    let cwd = std::env::current_dir().expect("current dir should be available");
    AcpClient::new_with_provider(provider, None, cwd).expect("client should be created")
}

fn create_no_launcher_test_client() -> AcpClient {
    let provider: StdArc<dyn AgentProvider> = StdArc::new(NoLauncherProvider);
    let cwd = std::env::current_dir().expect("current dir should be available");
    AcpClient::new_with_provider(provider, None, cwd).expect("client should be created")
}

#[test]
fn reconnect_policy_for_provider_uses_provider_owned_load_semantics() {
    let provider: StdArc<dyn AgentProvider> = StdArc::new(TestProvider { id: "cursor" });
    let reconnect_policy = reconnect_policy_for_provider(Some(provider.as_ref()), Some("build"));

    assert!(reconnect_policy.use_load_semantics);
    assert_eq!(reconnect_policy.outbound_launch_mode_id, None);
}

#[test]
fn reconnect_policy_for_provider_maps_launch_mode_without_client_branching() {
    let provider: StdArc<dyn AgentProvider> = StdArc::new(TestProvider { id: "copilot" });
    let reconnect_policy = reconnect_policy_for_provider(Some(provider.as_ref()), Some("build"));

    assert!(reconnect_policy.use_load_semantics);
    assert_eq!(
        reconnect_policy.outbound_launch_mode_id.as_deref(),
        Some("build")
    );
}

#[test]
fn provider_owned_model_presentation_metadata_matches_provider_contract() {
    let provider = TestProvider { id: "codex" };
    let presentation = provider.model_presentation_metadata();

    assert_eq!(
        presentation.display_family,
        crate::acp::model_display::ModelDisplayFamily::CodexReasoningEffort
    );
    assert_eq!(
        presentation.usage_metrics,
        crate::acp::model_display::UsageMetricsPresentation::SpendAndContext
    );
}

#[test]
fn session_lifecycle_uses_provider_owned_model_presentation_contract() {
    let source = include_str!("session_lifecycle.rs");
    let production_source = source.split("#[cfg(test)]").next().unwrap_or(source);

    assert!(
        production_source.contains("provider.model_presentation_metadata()"),
        "session lifecycle should use provider-owned model presentation metadata"
    );
    assert!(
        !production_source.contains("provider_capabilities(agent_type)"),
        "session lifecycle should not reconstruct model presentation from parser agent type"
    );
}

async fn setup_test_db() -> DbConn {
    let db = Database::connect("sqlite::memory:")
        .await
        .expect("Failed to connect to in-memory SQLite");
    Migrator::up(&db, None)
        .await
        .expect("Failed to run migrations");
    db
}

async fn replay_context_for_session(db: &DbConn, session_id: &str) -> SessionReplayContext {
    let metadata = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .expect("load metadata");
    SessionMetadataRepository::resolve_existing_session_replay_context_from_metadata(
        session_id,
        metadata.as_ref(),
        SessionCompatibilityInput::default(),
    )
    .expect("replay context")
}

#[test]
fn merge_saved_agent_env_overrides_prefers_saved_values() {
    let base = HashMap::from([
        ("AZURE_API_KEY".to_string(), "from-shell".to_string()),
        ("PATH".to_string(), "/usr/bin".to_string()),
    ]);
    let overrides = HashMap::from([(
        "codex".to_string(),
        HashMap::from([("AZURE_API_KEY".to_string(), "from-acepe".to_string())]),
    )]);

    let merged =
        crate::acp::runtime_resolver::apply_saved_agent_env_overrides("codex", base, &overrides);

    assert_eq!(merged.get("AZURE_API_KEY"), Some(&"from-acepe".to_string()));
}

#[test]
fn merge_saved_agent_env_overrides_ignores_missing_agent_entry() {
    let base = HashMap::from([("HOME".to_string(), "/Users/test".to_string())]);
    let overrides = HashMap::from([(
        "claude-code".to_string(),
        HashMap::from([(
            "ANTHROPIC_BASE_URL".to_string(),
            "https://example.com".to_string(),
        )]),
    )]);

    let merged = crate::acp::runtime_resolver::apply_saved_agent_env_overrides(
        "codex",
        base.clone(),
        &overrides,
    );

    assert_eq!(merged, base);
}

#[test]
fn merge_saved_agent_env_overrides_blocks_protected_keys() {
    let base = HashMap::from([("PATH".to_string(), "/usr/bin".to_string())]);
    let overrides = HashMap::from([(
        "codex".to_string(),
        HashMap::from([
            ("PATH".to_string(), "/tmp/bin".to_string()),
            (
                "NODE_OPTIONS".to_string(),
                "--require=/tmp/pwn.js".to_string(),
            ),
            ("AZURE_API_KEY".to_string(), "secret".to_string()),
        ]),
    )]);

    let merged =
        crate::acp::runtime_resolver::apply_saved_agent_env_overrides("codex", base, &overrides);

    assert_eq!(merged.get("PATH"), Some(&"/usr/bin".to_string()));
    assert!(!merged.contains_key("NODE_OPTIONS"));
    assert_eq!(merged.get("AZURE_API_KEY"), Some(&"secret".to_string()));
}

#[cfg(windows)]
#[test]
fn merge_saved_agent_env_overrides_blocks_case_variants_of_path() {
    let base = HashMap::from([("PATH".to_string(), "C:\\Windows\\System32".to_string())]);
    let overrides = HashMap::from([(
        "codex".to_string(),
        HashMap::from([("Path".to_string(), "C:\\Temp\\bin".to_string())]),
    )]);

    let merged =
        crate::acp::runtime_resolver::apply_saved_agent_env_overrides("codex", base, &overrides);

    assert_eq!(
        merged.get("PATH"),
        Some(&"C:\\Windows\\System32".to_string())
    );
    assert!(!merged.contains_key("Path"));
}

#[test]
fn provider_id_maps_to_agent_type() {
    let provider = TestProvider { id: "codex" };
    let agent = provider.parser_agent_type();
    assert_eq!(agent, AgentType::Codex);
}

#[test]
fn shared_runtime_uses_generic_inbound_response_contract_names() {
    let shared_sources = [
        production_source(CLIENT_MOD_SOURCE),
        production_source(CLIENT_STATE_SOURCE),
        production_source(CLIENT_LOOP_SOURCE),
        production_source(CLIENT_TRANSPORT_SOURCE),
        production_source(PROVIDER_SOURCE),
    ];

    for source in shared_sources {
        assert!(
            !source.contains("CursorResponseAdapter"),
            "shared runtime should not depend on CursorResponseAdapter"
        );
    }

    let provider_source = production_source(PROVIDER_SOURCE);
    assert!(
        !provider_source.contains("CursorExtensionEvent"),
        "provider boundary should not expose CursorExtensionEvent"
    );
}

#[test]
fn task_reconciler_policy_is_not_hardcoded_to_copilot_agent_type() {
    let source = production_source(TASK_RECONCILER_SOURCE);

    assert!(
        !source.contains("AgentType::Copilot"),
        "task reconciler should not hardcode Copilot-specific branching"
    );
}

#[test]
fn inbound_router_helpers_do_not_parse_cursor_web_search_titles() {
    let source = production_source(INBOUND_ROUTER_HELPERS_SOURCE);

    assert!(
        !source.contains("extract_query_from_permission_title"),
        "shared inbound router helpers should not own Cursor title parsing"
    );
    assert!(
        !source.contains("Web search: "),
        "shared inbound router helpers should not depend on Cursor title prefixes"
    );
}

#[test]
fn plan_enrichment_uses_registry_and_provider_defaults_instead_of_agent_matches() {
    let source = production_source(CLIENT_UPDATES_PLAN_SOURCE);

    assert!(
        !source.contains("match agent_type"),
        "plan enrichment should not hardcode built-in agent matches"
    );
    assert!(
        !source.contains("agent_id_for_agent"),
        "plan enrichment should not maintain a built-in agent id table"
    );
    assert!(
        source.contains("provider_capabilities(agent_type).default_plan_source"),
        "plan enrichment should use provider capabilities for built-in defaults"
    );
}

#[test]
fn shared_client_updates_no_longer_own_codex_wrapper_parsing() {
    let mod_source = production_source(CLIENT_UPDATES_MOD_SOURCE);
    let plan_source = production_source(CLIENT_UPDATES_PLAN_SOURCE);

    assert!(
        !mod_source.contains("extract_codex_wrapper_plan"),
        "shared update flow should not call Codex-specific wrapper extraction"
    );
    assert!(
        !mod_source.contains("finalize_codex_wrapper_on_turn_end"),
        "shared update flow should not own Codex turn-end wrapper finalization"
    );
    assert!(
        !plan_source.contains("process_codex_plan_chunk"),
        "shared plan helpers should not parse Codex wrapper chunks"
    );
    assert!(
        !plan_source.contains("finalize_codex_plan_streaming"),
        "shared plan helpers should not finalize Codex wrapper streams"
    );
}

#[test]
fn model_display_uses_presentation_metadata_not_agent_type_branching() {
    let source = production_source(MODEL_DISPLAY_SOURCE);

    assert!(
        !source.contains("AgentType::"),
        "model display should not branch on built-in agent types"
    );
    assert!(
        source.contains("ModelPresentationMetadata"),
        "model display should expose presentation metadata for frontend consumers"
    );
}

#[test]
fn session_modes_normalize_returns_defaults_when_empty() {
    let provider = TestProvider { id: "codex" };
    let empty_modes = SessionModes {
        current_mode_id: "".to_string(),
        available_modes: vec![],
    };

    let normalized = empty_modes.normalize_with_provider(&provider);

    assert_eq!(normalized.current_mode_id, "build");
    assert_eq!(normalized.available_modes.len(), 2);
    assert_eq!(normalized.available_modes[0].id, "build");
    assert_eq!(normalized.available_modes[1].id, "plan");
}

#[test]
fn session_modes_normalize_preserves_standard_modes() {
    let provider = TestProvider { id: "codex" };
    let existing_modes = SessionModes {
        current_mode_id: "build".to_string(),
        available_modes: vec![
            AvailableMode {
                id: "build".to_string(),
                name: "Build".to_string(),
                description: None,
            },
            AvailableMode {
                id: "plan".to_string(),
                name: "Plan".to_string(),
                description: None,
            },
        ],
    };

    let normalized = existing_modes.normalize_with_provider(&provider);

    assert_eq!(normalized.current_mode_id, "build");
    assert_eq!(normalized.available_modes.len(), 2);
    assert_eq!(normalized.available_modes[0].id, "build");
    assert_eq!(normalized.available_modes[1].id, "plan");
}

#[test]
fn default_modes_returns_build_and_plan() {
    let modes = default_modes();

    assert_eq!(modes.current_mode_id, "build");
    assert_eq!(modes.available_modes.len(), 2);

    let build_mode = &modes.available_modes[0];
    assert_eq!(build_mode.id, "build");
    assert_eq!(build_mode.name, "Build");

    let plan_mode = &modes.available_modes[1];
    assert_eq!(plan_mode.id, "plan");
    assert_eq!(plan_mode.name, "Plan");
}

#[test]
fn session_modes_normalize_converts_accept_edits_to_build() {
    let provider = TestProvider { id: "claude-code" };
    // Claude Code returns "acceptEdits" - should be normalized to "build"
    let claude_modes = SessionModes {
        current_mode_id: "acceptEdits".to_string(),
        available_modes: vec![
            AvailableMode {
                id: "acceptEdits".to_string(),
                name: "Accept Edits".to_string(),
                description: None,
            },
            AvailableMode {
                id: "plan".to_string(),
                name: "Plan".to_string(),
                description: None,
            },
        ],
    };

    let normalized = claude_modes.normalize_with_provider(&provider);

    // "acceptEdits" should be normalized to "build"
    assert_eq!(normalized.current_mode_id, "build");
    assert_eq!(normalized.available_modes.len(), 2);
    assert_eq!(normalized.available_modes[0].id, "build");
    assert_eq!(normalized.available_modes[1].id, "plan");
}

#[test]
fn session_modes_normalize_fixes_mismatched_current_mode() {
    let provider = TestProvider { id: "codex" };
    // Edge case: current_mode_id doesn't match any available mode
    let mismatched_modes = SessionModes {
        current_mode_id: "unknown".to_string(),
        available_modes: vec![AvailableMode {
            id: "build".to_string(),
            name: "Build".to_string(),
            description: None,
        }],
    };

    let normalized = mismatched_modes.normalize_with_provider(&provider);

    // Should fallback to first available mode
    assert_eq!(normalized.current_mode_id, "build");
}

#[test]
fn session_modes_normalize_converts_default_to_build_and_filters() {
    let provider = TestProvider { id: "claude-code" };
    // Claude Code returns "default" as current mode and multiple modes
    // Should normalize, filter to visible modes only, and deduplicate
    let claude_modes = SessionModes {
        current_mode_id: "default".to_string(),
        available_modes: vec![
            AvailableMode {
                id: "default".to_string(),
                name: "Default".to_string(),
                description: None,
            },
            AvailableMode {
                id: "acceptEdits".to_string(),
                name: "Accept Edits".to_string(),
                description: None,
            },
            AvailableMode {
                id: "plan".to_string(),
                name: "Plan".to_string(),
                description: None,
            },
            AvailableMode {
                id: "dontAsk".to_string(),
                name: "Don't Ask".to_string(),
                description: None,
            },
            AvailableMode {
                id: "bypassPermissions".to_string(),
                name: "Bypass Permissions".to_string(),
                description: None,
            },
        ],
    };

    let normalized = claude_modes.normalize_with_provider(&provider);

    // "default" should be normalized to "build"
    assert_eq!(normalized.current_mode_id, "build");
    // Should have only 2 modes (build and plan) - filtered and deduplicated
    assert_eq!(normalized.available_modes.len(), 2);
    assert_eq!(normalized.available_modes[0].id, "build");
    assert_eq!(normalized.available_modes[1].id, "plan");
}

#[test]
fn session_modes_normalize_converts_cursor_modes_to_build_and_plan() {
    let provider = TestProvider { id: "cursor" };
    // Cursor returns ask/plan/agent. UI should still show build/plan.
    let cursor_modes = SessionModes {
        current_mode_id: "ask".to_string(),
        available_modes: vec![
            AvailableMode {
                id: "ask".to_string(),
                name: "Ask".to_string(),
                description: None,
            },
            AvailableMode {
                id: "plan".to_string(),
                name: "Plan".to_string(),
                description: None,
            },
            AvailableMode {
                id: "agent".to_string(),
                name: "Agent".to_string(),
                description: None,
            },
        ],
    };

    let normalized = cursor_modes.normalize_with_provider(&provider);

    assert_eq!(normalized.current_mode_id, "build");
    assert_eq!(normalized.available_modes.len(), 2);
    assert_eq!(normalized.available_modes[0].id, "build");
    assert_eq!(normalized.available_modes[1].id, "plan");
}

#[test]
fn session_modes_normalize_injects_build_when_provider_returns_plan_only() {
    let provider = TestProvider { id: "codex" };
    let plan_only_modes = SessionModes {
        current_mode_id: "plan".to_string(),
        available_modes: vec![AvailableMode {
            id: "plan".to_string(),
            name: "Plan".to_string(),
            description: None,
        }],
    };

    let normalized = plan_only_modes.normalize_with_provider(&provider);

    assert_eq!(normalized.current_mode_id, "plan");
    assert_eq!(normalized.available_modes.len(), 2);
    assert_eq!(normalized.available_modes[0].id, "build");
    assert_eq!(normalized.available_modes[1].id, "plan");
}

#[test]
fn new_session_response_handles_null_modes() {
    let json = serde_json::json!({
        "sessionId": "test-123",
        "modes": null,
        "models": { "availableModels": [], "currentModelId": "auto" }
    });
    let response: NewSessionResponse = serde_json::from_value(json).unwrap();
    // null modes should deserialize to defaults (build + plan)
    assert_eq!(response.modes.available_modes.len(), 2);
    assert_eq!(response.modes.current_mode_id, "build");
    assert_eq!(response.modes.available_modes[0].id, "build");
    assert_eq!(response.modes.available_modes[1].id, "plan");
}

#[test]
fn new_session_response_handles_missing_modes() {
    let json = serde_json::json!({
        "sessionId": "test-123",
        "models": { "availableModels": [], "currentModelId": "auto" }
    });
    let response: NewSessionResponse = serde_json::from_value(json).unwrap();
    // missing modes should also use defaults
    assert_eq!(response.modes.available_modes.len(), 2);
    assert_eq!(response.modes.current_mode_id, "build");
}

#[test]
fn new_session_response_handles_missing_models() {
    let json = serde_json::json!({
        "sessionId": "test-123",
        "modes": null
    });
    let response: NewSessionResponse = serde_json::from_value(json).unwrap();
    assert!(response.models.available_models.is_empty());
    assert_eq!(response.models.current_model_id, "auto");
}

#[test]
fn new_session_response_handles_partial_models() {
    let json = serde_json::json!({
        "sessionId": "test-123",
        "models": {}
    });
    let response: NewSessionResponse = serde_json::from_value(json).unwrap();
    assert!(response.models.available_models.is_empty());
    assert_eq!(response.models.current_model_id, "auto");
}

#[test]
fn resume_session_response_handles_null_modes() {
    let json = serde_json::json!({
        "modes": null,
        "models": { "availableModels": [], "currentModelId": "auto" }
    });
    let response: ResumeSessionResponse = serde_json::from_value(json).unwrap();
    assert_eq!(response.modes.available_modes.len(), 2);
    assert_eq!(response.modes.current_mode_id, "build");
}

#[test]
fn resume_session_response_handles_missing_models() {
    let json = serde_json::json!({
        "modes": null
    });
    let response: ResumeSessionResponse = serde_json::from_value(json).unwrap();
    assert!(response.models.available_models.is_empty());
    assert_eq!(response.models.current_model_id, "auto");
}

#[test]
fn apply_provider_model_fallback_adds_auto_for_cursor_when_models_missing() {
    let provider = TestProvider { id: "cursor" };
    let mut state = SessionModelState {
        available_models: vec![],
        current_model_id: "auto".to_string(),
        models_display: ModelsForDisplay::default(),
        provider_metadata: None,
    };

    apply_provider_model_fallback(&provider, &mut state);

    assert_eq!(state.available_models.len(), 1);
    assert_eq!(state.available_models[0].model_id, "auto");
    assert_eq!(state.available_models[0].name, "Auto");
}

#[test]
fn apply_provider_model_fallback_keeps_existing_models() {
    let provider = TestProvider { id: "cursor" };
    let mut state = SessionModelState {
        available_models: vec![AvailableModel {
            model_id: "claude-sonnet-4".to_string(),
            name: "Claude Sonnet".to_string(),
            description: None,
        }],
        current_model_id: "claude-sonnet-4".to_string(),
        models_display: ModelsForDisplay::default(),
        provider_metadata: None,
    };

    apply_provider_model_fallback(&provider, &mut state);

    assert_eq!(state.available_models.len(), 1);
    assert_eq!(state.available_models[0].model_id, "claude-sonnet-4");
}

#[test]
fn apply_provider_model_fallback_does_not_apply_to_other_providers() {
    let provider = TestProvider { id: "claude-code" };
    let mut state = SessionModelState {
        available_models: vec![],
        current_model_id: "auto".to_string(),
        models_display: ModelsForDisplay::default(),
        provider_metadata: None,
    };

    apply_provider_model_fallback(&provider, &mut state);

    assert!(state.available_models.is_empty());
}

#[test]
fn parse_cursor_models_output_supports_json_array() {
    let output = r#"["gpt-5","claude-sonnet-4"]"#;
    let models = parse_model_discovery_output(output);

    assert_eq!(models.len(), 2);
    assert_eq!(models[0].model_id, "gpt-5");
    assert_eq!(models[1].model_id, "claude-sonnet-4");
}

#[test]
fn parse_cursor_models_output_supports_json_object_models_key() {
    let output = r#"{"models":[{"modelId":"gpt-5","name":"GPT-5"}]}"#;
    let models = parse_model_discovery_output(output);

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].model_id, "gpt-5");
    assert_eq!(models[0].name, "GPT-5");
}

#[test]
fn parse_cursor_models_output_supports_plaintext_bullets() {
    let output = "Available models:\n- gpt-5\n- claude-sonnet-4";
    let models = parse_model_discovery_output(output);

    assert_eq!(models.len(), 2);
    assert_eq!(models[0].model_id, "gpt-5");
    assert_eq!(models[1].model_id, "claude-sonnet-4");
}

#[test]
fn parse_model_discovery_output_strips_claude_formatting_suffix() {
    let output = "claude-opus-4-6[1m]";
    let models = parse_model_discovery_output(output);

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].model_id, "claude-opus-4-6");
    assert_eq!(models[0].name, "claude-opus-4-6");
}

#[test]
fn parse_model_discovery_output_ignores_claude_login_prompt() {
    let output = "Not logged in · Please run /login";
    let models = parse_model_discovery_output(output);

    assert!(models.is_empty());
}

#[test]
fn map_outbound_mode_id_maps_claude_build_to_default() {
    let provider = TestProvider { id: "claude-code" };
    let mapped = provider.map_outbound_mode_id("build");
    assert_eq!(mapped, "default");
}

#[test]
fn map_outbound_mode_id_keeps_plan_for_claude() {
    let provider = TestProvider { id: "claude-code" };
    let mapped = provider.map_outbound_mode_id("plan");
    assert_eq!(mapped, "plan");
}

#[test]
fn map_outbound_mode_id_keeps_build_for_other_providers() {
    let provider = TestProvider { id: "codex" };
    let mapped = provider.map_outbound_mode_id("build");
    assert_eq!(mapped, "build");
}

#[test]
fn initialize_response_handles_missing_agent_info_fields() {
    let json = serde_json::json!({
        "protocolVersion": 1,
        "authMethods": []
    });

    let parsed: InitializeResponse = serde_json::from_value(json).unwrap();

    assert_eq!(parsed.protocol_version, 1);
    assert!(parsed.agent_capabilities.is_object());
    assert!(parsed.agent_info.is_object());
    assert!(parsed.auth_methods.is_empty());
}

#[test]
fn initialize_params_for_cursor_include_client_info_without_meta() {
    let provider = TestProvider { id: "cursor" };
    let params = provider.initialize_params("acepe-desktop", "1.0.0");

    assert!(params.get("clientInfo").is_some());
    assert!(
        params.pointer("/clientCapabilities/_meta").is_none(),
        "cursor initialize payload should not include _meta"
    );
}

#[test]
fn initialize_params_for_non_cursor_include_ask_user_question_meta() {
    let provider = TestProvider { id: "claude-code" };
    let params = provider.initialize_params("acepe-desktop", "1.0.0");

    assert_eq!(
        params
            .pointer("/clientCapabilities/_meta/askUserQuestion")
            .and_then(|value| value.as_bool()),
        Some(true)
    );
}

#[tokio::test]
async fn send_request_cleans_pending_on_write_failure() {
    let mut client = create_test_client();
    assert_eq!(client.pending_requests.lock().await.len(), 0);

    let result = client.send_request("initialize", json!({})).await;

    assert!(matches!(result, Err(AcpError::ClientNotStarted)));
    assert_eq!(client.pending_requests.lock().await.len(), 0);
}

#[tokio::test]
async fn send_prompt_fire_and_forget_cleans_tracking_on_write_failure() {
    let mut client = create_test_client();
    assert_eq!(client.prompt_request_sessions.lock().await.len(), 0);

    let result = client
        .send_prompt_fire_and_forget(PromptRequest {
            session_id: "session-1".to_string(),
            prompt: vec![crate::acp::types::ContentBlock::Text {
                text: "hello".to_string(),
            }],
            stream: Some(true),
        })
        .await;

    assert!(matches!(result, Err(AcpError::ClientNotStarted)));
    assert_eq!(client.prompt_request_sessions.lock().await.len(), 0);
}

#[tokio::test]
async fn cursor_auth_requires_cursor_login_method() {
    let mut client = create_cursor_test_client();
    let result = client
        .authenticate_if_required(&InitializeResponse {
            protocol_version: 1,
            agent_capabilities: json!({}),
            agent_info: json!({}),
            auth_methods: vec![],
        })
        .await;

    assert!(matches!(result, Err(AcpError::ProtocolError(_))));
}

#[tokio::test]
async fn initialize_retries_with_next_spawn_config_after_subprocess_exit() {
    let mut client = create_retry_test_client();

    client.start().await.expect("initial launcher should spawn");
    let response = client
        .initialize()
        .await
        .expect("initialize should retry with fallback launcher");

    assert_eq!(response.protocol_version, 1);
    assert_eq!(client.spawn_config_index, 1);

    client.stop();
}

#[tokio::test]
async fn start_returns_clear_error_when_provider_has_no_launchers() {
    let mut client = create_no_launcher_test_client();

    let error = client
        .start()
        .await
        .expect_err("start should fail without launchers");

    assert!(
        matches!(error, AcpError::InvalidState(message) if message.contains("No launchers available for provider cursor"))
    );
}

#[tokio::test]
async fn active_client_interaction_projection_persists_selected_permission_reply() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-1".to_string(),
        "Active client session".to_string(),
        1704067200000,
        "/Users/alex/Documents/acepe".to_string(),
        "codex".to_string(),
        "-Users-alex-Documents-acepe/session-1.jsonl".to_string(),
        1704067200,
        1024,
    )
    .await
    .expect("persist session metadata");

    let path =
        "/Users/alex/Documents/acepe/packages/desktop/src/lib/components/ui/tooltip/tooltip-content.svelte";
    let mut client = create_test_client();
    client.db = Some(db.clone());
    client.projection_registry = StdArc::new(ProjectionRegistry::new());
    client.set_active_session_id(Some("session-1".to_string()));

    let permission_update = SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: "permission-1".to_string(),
            session_id: "session-1".to_string(),
            json_rpc_request_id: Some(7),
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(7)),
            permission: "Read".to_string(),
            patterns: vec![path.to_string()],
            metadata: json!({}),
            always: vec![],
            auto_accepted: false,
            tool: None,
        },
        session_id: Some("session-1".to_string()),
    };
    client
        .projection_registry
        .apply_session_update("session-1", &permission_update);
    SessionJournalEventRepository::append_session_update(&db, "session-1", &permission_update)
        .await
        .expect("append permission request update");

    client
        .update_interaction_projection(
            7,
            &json!({ "outcome": { "outcome": "selected", "optionId": "allow" } }),
        )
        .await;

    let interaction = client
        .projection_registry
        .interaction_for_request_id("session-1", 7)
        .expect("interaction should exist");
    assert_eq!(interaction.state, InteractionState::Approved);

    let replay_context = replay_context_for_session(&db, "session-1").await;
    let stored_projection = load_stored_projection(&db, &replay_context)
        .await
        .expect("load stored projection")
        .expect("stored projection should exist");
    assert!(stored_projection
        .interactions
        .into_iter()
        .any(|interaction| interaction.id == "permission-1"
            && interaction.state == InteractionState::Approved));
}

#[tokio::test]
async fn load_stored_projection_ignores_legacy_projection_snapshot_without_journal() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-legacy".to_string(),
        "Legacy projection session".to_string(),
        1704067200000,
        "/Users/alex/Documents/acepe".to_string(),
        "codex".to_string(),
        "-Users-alex-Documents-acepe/session-legacy.jsonl".to_string(),
        1704067200,
        1024,
    )
    .await
    .expect("persist session metadata");

    let registry = ProjectionRegistry::new();
    registry.register_session(
        "session-legacy".to_string(),
        crate::acp::types::CanonicalAgentId::Codex,
    );
    let snapshot = registry.session_projection("session-legacy");
    SessionProjectionSnapshotRepository::set(&db, "session-legacy", &snapshot)
        .await
        .expect("persist legacy projection snapshot");

    let replay_context = replay_context_for_session(&db, "session-legacy").await;
    let stored_projection = load_stored_projection(&db, &replay_context)
        .await
        .expect("load stored projection");

    assert!(stored_projection.is_none());
}
