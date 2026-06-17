use super::permissions::PendingPermissionKind;
use super::*;
use crate::acp::session_update::ContentChunk;
use crate::acp::session_update::{
    AvailableCommand, PermissionData, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
};
use crate::db::migrations::Migrator;
use crate::db::repository::{
    CreationAttemptStatus, SessionJournalEventRepository, SessionMetadataRepository,
};
use cc_sdk::{CanUseTool, HookCallback};
use sea_orm::Database;
use sea_orm_migration::MigratorTrait;
use std::path::Path;
use std::sync::{LazyLock, Mutex as StdMutex};

static HOME_ENV_LOCK: LazyLock<StdMutex<()>> = LazyLock::new(|| StdMutex::new(()));

#[test]
fn claude_history_tool_result_backfill_preserves_stdout_stderr_payload() {
    let session = crate::session_jsonl::types::FullSession {
        session_id: "provider-session".to_string(),
        project_path: "/repo".to_string(),
        title: "Test".to_string(),
        created_at: "2026-05-16T00:00:00Z".to_string(),
        messages: vec![crate::session_jsonl::types::OrderedMessage {
            uuid: "user-tool-result".to_string(),
            parent_uuid: Some("assistant-tool-use".to_string()),
            role: "user".to_string(),
            provider_message_id: None,
            timestamp: "2026-05-16T00:00:01Z".to_string(),
            content_blocks: vec![crate::session_jsonl::types::ContentBlock::ToolResult {
                tool_use_id: "toolu_exec".to_string(),
                content: "./README.md".to_string(),
            }],
            model: None,
            usage: None,
            error: None,
            request_id: None,
            is_meta: false,
            source_tool_use_id: None,
            tool_use_result: Some(serde_json::json!({
                "stdout": "./README.md",
                "stderr": "",
                "interrupted": false,
                "isImage": false,
                "noOutputExpected": false
            })),
            source_tool_assistant_uuid: Some("assistant-tool-use".to_string()),
        }],
        stats: crate::session_jsonl::types::SessionStats {
            total_messages: 1,
            user_messages: 1,
            assistant_messages: 0,
            tool_uses: 0,
            tool_results: 1,
            thinking_blocks: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
        },
    };

    let update = claude_history_tool_result_update("ui-session", &session, "toolu_exec")
        .expect("tool result update");

    match update {
        SessionUpdate::ToolCallUpdate { update, session_id } => {
            assert_eq!(session_id.as_deref(), Some("ui-session"));
            assert_eq!(update.tool_call_id, "toolu_exec");
            assert_eq!(update.status, Some(ToolCallStatus::Completed));
            assert_eq!(
                update
                    .result
                    .as_ref()
                    .and_then(|result| result.get("stdout"))
                    .and_then(serde_json::Value::as_str),
                Some("./README.md")
            );
            assert_eq!(
                update
                    .result
                    .as_ref()
                    .and_then(|result| result.get("stderr"))
                    .and_then(serde_json::Value::as_str),
                Some("")
            );
            assert!(matches!(
                update.content.as_deref(),
                Some([crate::acp::types::ContentBlock::Text { text }])
                    if text == "./README.md"
            ));
        }
        other => panic!("expected tool call update, got {:?}", other),
    }
}

#[test]
fn missing_tool_result_backfill_request_is_claude_only_and_uses_provider_session_id() {
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let project_path = PathBuf::from("/repo");
    let update = SessionUpdate::ToolCallUpdate {
        update: ToolCallUpdateData {
            tool_call_id: "toolu_exec".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({
                "stderr": crate::acp::parsers::cc_sdk_bridge::MISSING_TOOL_RESULT_MESSAGE
            })),
            ..Default::default()
        },
        session_id: Some("ui-session".to_string()),
    };

    let request = claude_missing_tool_result_backfill_request(
        &provider,
        "ui-session",
        Some("provider-session"),
        Some(&project_path),
        &update,
    )
    .expect("missing result should request Claude history backfill");

    assert_eq!(request.ui_session_id, "ui-session");
    assert_eq!(request.provider_session_id, "provider-session");
    assert_eq!(request.project_path, project_path);
    assert_eq!(request.tool_call_id, "toolu_exec");

    let non_claude_provider = crate::acp::providers::codex::CodexProvider;
    assert!(claude_missing_tool_result_backfill_request(
        &non_claude_provider,
        "ui-session",
        Some("provider-session"),
        Some(&PathBuf::from("/repo")),
        &update,
    )
    .is_none());
}

fn make_task_tool_call(id: &str) -> SessionUpdate {
    SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: id.to_string(),
            name: "Agent".to_string(),
            arguments: ToolArguments::Other {
                raw: serde_json::Value::Null,
                intent: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::InProgress,
            result: None,
            kind: Some(ToolKind::Task),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        session_id: Some("session-1".to_string()),
    }
}

fn make_enriched_task_tool_call(id: &str) -> SessionUpdate {
    SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: id.to_string(),
            name: "Agent".to_string(),
            arguments: ToolArguments::Think {
                description: Some("Find all tool call components".to_string()),
                prompt: Some("Inventory tool call cards in the codebase".to_string()),
                subagent_type: Some("Explore".to_string()),
                skill: None,
                skill_args: None,
                raw: Some(serde_json::json!({
                    "description": "Find all tool call components",
                    "prompt": "Inventory tool call cards in the codebase",
                    "subagent_type": "Explore"
                })),
            },
            diagnostic_input: Some(serde_json::json!({
                "description": "Find all tool call components",
                "prompt": "Inventory tool call cards in the codebase",
                "subagent_type": "Explore"
            })),
            status: ToolCallStatus::InProgress,
            result: None,
            kind: Some(ToolKind::Task),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        session_id: Some("session-1".to_string()),
    }
}

fn make_permission_handler_fixture(
    session_id: &str,
    dispatcher: AcpUiEventDispatcher,
    bridge: Arc<PermissionBridge>,
    tracker: Arc<ToolCallIdTracker>,
) -> (
    AcepePermissionHandler,
    Arc<SessionPolicyRegistry>,
    Arc<std::sync::Mutex<TaskReconciler>>,
) {
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let session_policy = Arc::new(SessionPolicyRegistry::new());
    let task_reconciler = Arc::new(std::sync::Mutex::new(TaskReconciler::new()));
    let handler = AcepePermissionHandler {
        session_id: session_id.to_string(),
        agent_type: provider.parser_agent_type(),
        bridge,
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::clone(&session_policy),
        tool_call_tracker: tracker,
        task_reconciler: Arc::clone(&task_reconciler),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
    };

    (handler, session_policy, task_reconciler)
}

fn make_child_read_tool_call(id: &str, parent_id: &str, file_path: &str) -> ToolCallData {
    ToolCallData {
        id: id.to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some(file_path.to_string()),
            source_context: None,
        },
        diagnostic_input: Some(serde_json::json!({ "file_path": file_path })),
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Read),
        title: None,
        locations: None,
        skill_meta: None,
        normalized_questions: None,
        normalized_todos: None,
        normalized_todo_update: None,
        parent_tool_use_id: Some(parent_id.to_string()),
        task_children: None,
        question_answer: None,
        awaiting_plan_approval: false,
        plan_approval_request_id: None,
    }
}

fn make_child_tool_call(id: &str, name: &str, kind: ToolKind) -> SessionUpdate {
    let arguments = match kind {
        ToolKind::Execute => ToolArguments::Execute {
            command: Some("ls -1".to_string()),
        },
        ToolKind::Glob => ToolArguments::Glob {
            pattern: Some("**/*.svelte".to_string()),
            path: Some("/tmp/project".to_string()),
        },
        ToolKind::Read => ToolArguments::Read {
            file_path: Some("/tmp/project/file.svelte".to_string()),
            source_context: None,
        },
        _ => panic!("unsupported child kind in test"),
    };

    SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: id.to_string(),
            name: name.to_string(),
            arguments,
            diagnostic_input: None,
            status: ToolCallStatus::InProgress,
            result: None,
            kind: Some(kind),
            title: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: Some("toolu_task_parent".to_string()),
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        session_id: Some("session-1".to_string()),
    }
}

fn make_test_client_with_provider(provider: Arc<dyn AgentProvider>) -> ClaudeCcSdkClient {
    ClaudeCcSdkClient {
        provider,
        sdk_client: None,
        session_id: None,
        permission_bridge: Arc::new(PermissionBridge::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(
            crate::acp::task_reconciler::TaskReconciler::new(),
        )),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        bridge_task: None,
        dispatcher: AcpUiEventDispatcher::new(None, DispatchPolicy::default()),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        app_handle: None,
        pending_mode_id: None,
        pending_model_id: None,
        current_cwd: Some(PathBuf::from("/tmp")),
        pending_creation_attempt_id: None,
    }
}

#[derive(Debug)]
struct SlashCommandProvider;

impl AgentProvider for SlashCommandProvider {
    fn id(&self) -> &str {
        "claude-code"
    }

    fn name(&self) -> &str {
        "Claude Code"
    }

    fn spawn_config(&self) -> crate::acp::provider::SpawnConfig {
        crate::acp::provider::SpawnConfig {
            command: "claude".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            env_strategy: None,
        }
    }

    fn list_session_commands<'a>(
        &'a self,
        _app: Option<&'a AppHandle>,
        _cwd: Option<&'a Path>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Vec<AvailableCommand>, String>> + Send + 'a>,
    > {
        Box::pin(async {
            Ok(vec![AvailableCommand {
                name: "ce-debug".to_string(),
                description: "Debug the current issue".to_string(),
                input: None,
            }])
        })
    }
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

fn make_test_client() -> ClaudeCcSdkClient {
    make_test_client_with_provider(Arc::new(
        crate::acp::providers::claude_code::ClaudeCodeProvider,
    ))
}

#[tokio::test]
async fn new_session_hydrates_available_commands_from_provider() {
    let mut client = make_test_client_with_provider(Arc::new(SlashCommandProvider));

    let response = client
        .new_session("/tmp/acepe-project".to_string())
        .await
        .expect("new session");

    assert_eq!(response.available_commands.len(), 1);
    assert_eq!(response.available_commands[0].name, "ce-debug");
}

#[test]
fn cc_sdk_sessions_request_partial_messages() {
    let options = cc_sdk::ClaudeCodeOptions::builder()
        .cwd(PathBuf::from("/tmp"))
        .include_partial_messages(true)
        .build();

    assert!(options.include_partial_messages);
}

#[test]
fn bind_pending_creation_attempt_seeds_model_and_mode() {
    let mut client = make_test_client();
    client.bind_pending_creation_attempt(
        Some("attempt-1".to_string()),
        Some("claude-sonnet-4-6".to_string()),
        Some("plan".to_string()),
    );

    assert_eq!(
        client.pending_creation_attempt_id.as_deref(),
        Some("attempt-1")
    );
    assert_eq!(
        client.pending_model_id.as_deref(),
        Some("claude-sonnet-4-6")
    );
    assert_eq!(client.pending_mode_id.as_deref(), Some("plan"));
}

#[test]
fn sanitize_pending_model_for_connect_clears_invalid_model() {
    let mut client = make_test_client();
    client.pending_model_id = Some("stale-model".to_string());

    client.sanitize_pending_model_for_connect(&[
        "claude-opus-4-6".to_string(),
        "claude-sonnet-4-6".to_string(),
    ]);

    assert!(client.pending_model_id.is_none());
}

#[test]
fn sanitize_pending_model_for_connect_keeps_valid_model() {
    let mut client = make_test_client();
    client.pending_model_id = Some("claude-sonnet-4-6".to_string());

    client.sanitize_pending_model_for_connect(&[
        "claude-opus-4-6".to_string(),
        "claude-sonnet-4-6".to_string(),
    ]);

    assert_eq!(
        client.pending_model_id.as_deref(),
        Some("claude-sonnet-4-6")
    );
}

#[test]
fn build_options_applies_pending_mode_and_model() {
    let mut client = make_test_client();
    client.pending_mode_id = Some("plan".to_string());
    client.pending_model_id = Some("claude-opus-4-6".to_string());

    let options = client.build_options("/tmp", "session-1", None, false);

    assert!(options.include_partial_messages);
    assert_eq!(options.model.as_deref(), Some("claude-opus-4-6"));
    assert_eq!(options.permission_mode, cc_sdk::PermissionMode::Plan);
    assert_eq!(options.session_id.as_deref(), Some("session-1"));
    assert!(options
        .hooks
        .as_ref()
        .and_then(|hooks| hooks.get("PermissionRequest"))
        .is_some());
    assert_eq!(
        options.setting_sources,
        Some(vec![
            cc_sdk::SettingSource::User,
            cc_sdk::SettingSource::Project,
            cc_sdk::SettingSource::Local,
        ])
    );
}

#[test]
fn build_options_respects_bypass_permissions_from_claude_user_settings_when_mode_unset() {
    let _guard = HOME_ENV_LOCK.lock().expect("lock HOME env");
    let previous_home = std::env::var_os("HOME");
    let temp = tempfile::tempdir().expect("temp dir");
    let home = temp.path().join("home");
    let project = temp.path().join("project");
    std::fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    std::fs::create_dir_all(&project).expect("create project dir");
    std::fs::write(
        home.join(".claude").join("settings.json"),
        r#"{
  "skipDangerousModePermissionPrompt": true,
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}"#,
    )
    .expect("write settings");
    std::env::set_var("HOME", &home);

    let client = make_test_client();
    let options = client.build_options(&project.to_string_lossy(), "session-1", None, false);

    match previous_home {
        Some(previous_home) => std::env::set_var("HOME", previous_home),
        None => std::env::remove_var("HOME"),
    }

    assert_eq!(
        options.permission_mode,
        cc_sdk::PermissionMode::BypassPermissions
    );
}

#[test]
fn permission_mode_mapping_supports_autonomous_and_accept_edits_profiles() {
    assert_eq!(
        map_to_claude_permission_mode("acceptEdits"),
        cc_sdk::PermissionMode::AcceptEdits
    );
    assert_eq!(
        map_to_claude_permission_mode("bypassPermissions"),
        cc_sdk::PermissionMode::BypassPermissions
    );
}

#[test]
fn build_options_applies_resume_and_fork_flags() {
    let client = make_test_client();

    let options = client.build_options("/tmp", "session-1", Some("resume-1".to_string()), true);

    assert_eq!(options.resume.as_deref(), Some("resume-1"));
    assert_eq!(options.session_id.as_deref(), Some("session-1"));
    assert!(options.fork_session);
}

#[test]
fn build_options_keeps_session_id_for_resumed_stdin_messages() {
    let client = make_test_client();

    let options = client.build_options("/tmp", "session-1", Some("session-1".to_string()), false);

    assert_eq!(options.resume.as_deref(), Some("session-1"));
    assert_eq!(options.session_id.as_deref(), Some("session-1"));
}

#[tokio::test]
async fn resume_session_preserves_seeded_launch_mode_on_fresh_client() {
    // A fresh client whose `pending_mode_id` was seeded by
    // `seed_client_launch_mode` (carrying an autonomous execution profile)
    // must not have that seed wiped by the safe-resume reset — otherwise
    // enabling autonomous mid-session would silently launch the CLI in
    // Default mode and every tool call would still require approval.
    let temp = tempfile::tempdir().expect("temp dir");
    let mut client = make_test_client();
    client.pending_mode_id = Some("bypassPermissions".to_string());

    let response = client
        .resume_session(
            "session-1".to_string(),
            temp.path().to_string_lossy().into_owned(),
        )
        .await
        .expect("resume session should succeed without persisted history");

    assert_eq!(response.modes.current_mode_id, "default");
    assert_eq!(client.pending_mode_id.as_deref(), Some("bypassPermissions"));
    assert_eq!(
        client
            .build_options(&temp.path().to_string_lossy(), "session-1", None, false)
            .permission_mode,
        cc_sdk::PermissionMode::BypassPermissions
    );
}

#[tokio::test]
async fn set_session_mode_updates_first_activation_options_without_cached_connect_state() {
    // When the frontend enables autonomous before sending the first prompt,
    // first-send activation must derive the launch permission mode from the
    // current session state rather than from cached connect options.
    let temp = tempfile::tempdir().expect("temp dir");
    let mut client = make_test_client();

    let new_response = client
        .new_session(temp.path().to_string_lossy().into_owned())
        .await
        .expect("new_session should succeed");

    client
        .set_session_mode(new_response.session_id, "bypassPermissions".to_string())
        .await
        .expect("set_session_mode should succeed on deferred client");

    assert_eq!(client.pending_mode_id.as_deref(), Some("bypassPermissions"));
    assert_eq!(
        client
            .build_options(
                &temp.path().to_string_lossy(),
                client
                    .session_id
                    .as_deref()
                    .expect("new_session should preserve session id for first activation"),
                None,
                false
            )
            .permission_mode,
        cc_sdk::PermissionMode::BypassPermissions
    );
}

#[tokio::test]
async fn restore_session_permission_approvals_does_not_rehydrate_from_journal() {
    let db = setup_test_db().await;
    let path = "/Users/alex/Documents/acepe/packages/desktop/src/lib/components/ui/tooltip/tooltip-content.svelte";
    SessionMetadataRepository::upsert(
        &db,
        "session-1".to_string(),
        "Restart permission session".to_string(),
        1704067200000,
        "/Users/alex/Documents/acepe".to_string(),
        "claude-code".to_string(),
        "-Users-alex-Documents-acepe/session-1.jsonl".to_string(),
        1704067200,
        1024,
    )
    .await
    .expect("persist session metadata");
    let permission_update = SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: "permission-1".to_string(),
            session_id: "session-1".to_string(),
            json_rpc_request_id: Some(7),
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(7)),
            permission: "Read".to_string(),
            patterns: vec![path.to_string()],
            metadata: serde_json::json!({}),
            always: vec![],
            auto_accepted: false,
            tool: None,
        },
        session_id: Some("session-1".to_string()),
    };
    SessionJournalEventRepository::append_session_update(&db, "session-1", &permission_update)
        .await
        .expect("persist permission request");
    SessionJournalEventRepository::append_interaction_transition(
        &db,
        "session-1",
        "permission-1",
        InteractionState::Approved,
        InteractionResponse::Permission {
            accepted: true,
            option_id: Some("allow".to_string()),
            reply: None,
        },
    )
    .await
    .expect("persist permission approval");

    let mut client = make_test_client();
    client.db = Some(db.clone());
    client
        .restore_session_permission_approvals("session-1")
        .await;

    let registration = client
        .permission_bridge
        .register_tool(
            client.permission_bridge.next_id(),
            ToolPermissionRequest {
                tool_call_id: "toolu_restart".to_string(),
                tool_name: "Read".to_string(),
                reusable_approval_key: build_reusable_permission_key(
                    "Read",
                    &serde_json::json!({ "file_path": path }),
                ),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(registration.ui_dispatch, PermissionUiDispatch::Emit);
}

#[tokio::test]
async fn reset_stream_runtime_state_does_not_deny_pending_permissions() {
    let mut client = make_test_client();
    let previous_bridge = client.permission_bridge.clone();
    let registration = previous_bridge
        .register_tool(
            previous_bridge.next_id(),
            ToolPermissionRequest {
                tool_call_id: "toolu_resume".to_string(),
                tool_name: "Read".to_string(),
                reusable_approval_key: Some("Read::/tmp/file.txt".to_string()),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    client.reset_stream_runtime_state();
    client
        .restore_session_permission_approvals("session-resume")
        .await;

    assert!(
        timeout(Duration::from_millis(50), registration.receiver)
            .await
            .is_err(),
        "resume should leave in-flight permissions pending until the new stream replays them"
    );
}

#[tokio::test]
async fn discover_models_from_provider_cli_returns_empty_without_app_handle() {
    // cc-sdk is Claude-only and now reads from the authoritative model catalog
    // via AppHandle. When no AppHandle is present (e.g. in pure unit tests),
    // it must return an empty vec rather than shelling out to the old CLI probe
    // that cost a real API bill per call. Catalog-backed discovery is exercised
    // end-to-end in `claude_code_model_catalog::tests`.
    let client = make_test_client();
    assert!(client.app_handle.is_none());

    let models = client.discover_models_from_provider_cli().await;
    assert!(models.is_empty());
}

#[test]
fn provider_session_id_from_stream_event_uses_provider_owned_id() {
    let message = cc_sdk::Message::StreamEvent {
        uuid: "msg-1".to_string(),
        session_id: "provider-session".to_string(),
        event: serde_json::json!({ "type": "message_stop" }),
        parent_tool_use_id: None,
    };

    assert_eq!(
        provider_session_id_from_message(&message),
        Some("provider-session")
    );
}

#[test]
fn provider_session_id_from_system_message_reads_nested_session_id() {
    let message = cc_sdk::Message::System {
        subtype: "usage_update".to_string(),
        data: serde_json::json!({ "sessionId": "provider-session" }),
    };

    assert_eq!(
        provider_session_id_from_message(&message),
        Some("provider-session")
    );
}

#[tokio::test]
async fn provider_session_id_alias_persistence_errors_when_metadata_row_is_missing() {
    let db = setup_test_db().await;

    let error = persist_provider_session_id_alias(
        None,
        Some(&db),
        "missing-claude-session",
        "provider-session",
    )
    .await
    .expect_err("missing metadata must fail provider identity binding");

    assert!(
        error
            .to_string()
            .contains("session metadata missing before provider identity binding"),
        "unexpected error: {error}"
    );
}

#[tokio::test]
async fn provider_session_id_alias_persistence_rejects_new_session_identity_mismatch() {
    let db = setup_test_db().await;

    SessionMetadataRepository::ensure_exists(
        &db,
        "requested-claude-session",
        "/project",
        "claude-code",
        None,
    )
    .await
    .expect("metadata row");

    let error = persist_provider_session_id_alias(
        None,
        Some(&db),
        "requested-claude-session",
        "different-provider-session",
    )
    .await
    .expect_err("new Claude sessions must not accept a mismatched provider id");

    assert!(
        error
            .to_string()
            .contains("instead of requested session id"),
        "unexpected error: {error}"
    );
}

#[tokio::test]
async fn provider_session_id_alias_persistence_rejects_canonical_session_identity_mismatch() {
    let db = setup_test_db().await;
    let attempt =
        SessionMetadataRepository::create_creation_attempt(&db, "/project", "claude-code", None, None, None)
            .await
            .expect("attempt");
    SessionMetadataRepository::promote_creation_attempt(
        &db,
        &attempt.id,
        "requested-claude-session",
    )
    .await
    .expect("promoted canonical session");

    let error = persist_provider_session_id_alias(
        None,
        Some(&db),
        "requested-claude-session",
        "different-provider-session",
    )
    .await
    .expect_err("canonical Claude sessions must not accept a mismatched provider id");

    assert!(
        error
            .to_string()
            .contains("instead of requested session id"),
        "unexpected error: {error}"
    );
    let row = SessionMetadataRepository::get_by_id(&db, "requested-claude-session")
        .await
        .expect("load row")
        .expect("row");
    assert_eq!(row.history_session_id(), "requested-claude-session");
}

#[tokio::test]
async fn provider_session_id_alias_persistence_rejects_legacy_transcript_alias_repair() {
    let db = setup_test_db().await;

    SessionMetadataRepository::upsert(
        &db,
        "legacy-local-session".to_string(),
        "Legacy".to_string(),
        1704067300000,
        "/project".to_string(),
        "claude-code".to_string(),
        "-project/legacy-local-session.jsonl".to_string(),
        1704067300,
        2048,
    )
    .await
    .expect("legacy row");

    let error = persist_provider_session_id_alias(
        None,
        Some(&db),
        "legacy-local-session",
        "legacy-provider-session",
    )
    .await
    .expect_err("legacy alias repair is not a runtime identity path");

    assert!(
        error.to_string().contains("Provider session id mismatch"),
        "unexpected error: {error}"
    );

    let row = SessionMetadataRepository::get_by_id(&db, "legacy-local-session")
        .await
        .expect("load row")
        .expect("row");

    assert_eq!(row.history_session_id(), "legacy-local-session");
}

// --- PermissionBridge tests ---

#[test]
fn permission_metadata_marks_original_payload_as_diagnostic() {
    let raw_input = serde_json::json!({
        "command": "echo ok"
    });

    let metadata = build_permission_metadata("Bash", &raw_input, AgentType::ClaudeCode);

    assert_eq!(metadata["diagnosticRawInput"], raw_input);
    assert!(metadata.get("rawInput").is_none());
    assert_eq!(metadata["parsedArguments"]["kind"], "execute");
    assert_eq!(metadata["options"], serde_json::json!([]));
}

#[test]
fn permission_bridge_next_id_is_sequential() {
    let bridge = PermissionBridge::new();
    let id1 = bridge.next_id();
    let id2 = bridge.next_id();
    let id3 = bridge.next_id();
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
}

#[test]
fn permission_bridge_ids_stay_in_js_safe_range() {
    let bridge = PermissionBridge::new();
    // JS safe integer max is 2^53 - 1.  Sequential IDs starting at 1 will
    // never overflow in practice, but verify the first few are in range.
    for _ in 0..100 {
        let id = bridge.next_id();
        assert!(id < (1u64 << 53), "ID {id} exceeds JS safe integer range");
    }
}

#[tokio::test]
async fn permission_bridge_marks_grouped_hook_registrations_as_joined() {
    let bridge = super::permissions::PermissionBridge::new();
    let first = bridge
        .register_tool(
            bridge.next_id(),
            super::permissions::ToolPermissionRequest {
                tool_call_id: "toolu_shared_permission".to_string(),
                tool_name: "Write".to_string(),
                reusable_approval_key: Some("Write::color.txt".to_string()),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(
        first.ui_dispatch,
        super::permissions::PermissionUiDispatch::Emit
    );

    let joined = bridge
        .register_hook(
            bridge.next_id(),
            super::permissions::HookPermissionRequest {
                tool_call_id: "toolu_shared_permission".to_string(),
                tool_name: "Write".to_string(),
                reusable_approval_key: Some("Write::color.txt".to_string()),
                original_input: serde_json::json!({
                    "file_path": "color.txt",
                    "content": "blue"
                }),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(
        joined.ui_dispatch,
        super::permissions::PermissionUiDispatch::JoinExisting
    );
}

#[tokio::test]
async fn permission_bridge_marks_late_hook_registrations_as_resolved_from_cache() {
    let bridge = super::permissions::PermissionBridge::new();
    let initial_request_id = bridge.next_id();
    let initial = bridge
        .register_tool(
            initial_request_id,
            super::permissions::ToolPermissionRequest {
                tool_call_id: "toolu_shared_permission".to_string(),
                tool_name: "Write".to_string(),
                reusable_approval_key: Some("Write::color.txt".to_string()),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(
        initial.ui_dispatch,
        super::permissions::PermissionUiDispatch::Emit
    );

    bridge
        .resolve_from_ui_result(
            initial_request_id,
            &serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await;

    let late = bridge
        .register_hook(
            bridge.next_id(),
            super::permissions::HookPermissionRequest {
                tool_call_id: "toolu_shared_permission".to_string(),
                tool_name: "Write".to_string(),
                reusable_approval_key: Some("Write::color.txt".to_string()),
                original_input: serde_json::json!({
                    "file_path": "color.txt",
                    "content": "blue"
                }),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(
        late.ui_dispatch,
        super::permissions::PermissionUiDispatch::ResolvedFromCache
    );
    let resolved_hook = timeout(Duration::from_millis(50), late.receiver)
        .await
        .expect("late hook should resolve without another UI prompt")
        .expect("late hook channel closed");
    let cc_sdk::HookJSONOutput::Sync(output) = resolved_hook else {
        panic!("expected sync hook output");
    };
    let serialized = serde_json::to_value(output).expect("serialize hook output");

    assert_eq!(
        serialized["hookSpecificOutput"]["decision"]["behavior"],
        "allow"
    );
}

#[tokio::test]
async fn permission_bridge_reuses_approved_permissions_across_equivalent_tool_calls() {
    let bridge = super::permissions::PermissionBridge::new();
    let initial_request_id = bridge.next_id();
    let initial = bridge
        .register_hook(
            initial_request_id,
            super::permissions::HookPermissionRequest {
                tool_call_id: "toolu_first_permission".to_string(),
                tool_name: "Edit".to_string(),
                reusable_approval_key: Some("Edit::tooltip-content.svelte".to_string()),
                original_input: serde_json::json!({
                    "file_path": "tooltip-content.svelte",
                    "new_string": "next value"
                }),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(
        initial.ui_dispatch,
        super::permissions::PermissionUiDispatch::Emit
    );

    bridge
        .resolve_from_ui_result(
            initial_request_id,
            &serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await;

    let repeated = bridge
        .register_hook(
            bridge.next_id(),
            super::permissions::HookPermissionRequest {
                tool_call_id: "toolu_second_permission".to_string(),
                tool_name: "Edit".to_string(),
                reusable_approval_key: Some("Edit::tooltip-content.svelte".to_string()),
                original_input: serde_json::json!({
                    "file_path": "tooltip-content.svelte",
                    "new_string": "later value"
                }),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(
        repeated.ui_dispatch,
        super::permissions::PermissionUiDispatch::ResolvedFromCache
    );
}

#[tokio::test]
async fn permission_bridge_reuses_approved_tool_permissions_across_equivalent_tool_calls() {
    let bridge = super::permissions::PermissionBridge::new();
    let initial_request_id = bridge.next_id();
    let initial = bridge
            .register_tool(
                initial_request_id,
                super::permissions::ToolPermissionRequest {
                    tool_call_id: "toolu_first_tool_permission".to_string(),
                    tool_name: "Read".to_string(),
                    reusable_approval_key: Some(
                        "Read::/Users/alex/Documents/acepe/packages/desktop/src/lib/components/ui/tooltip/tooltip-content.svelte"
                            .to_string(),
                    ),
                    permission_suggestions: Vec::new(),
                },
            )
            .await;

    assert_eq!(
        initial.ui_dispatch,
        super::permissions::PermissionUiDispatch::Emit
    );

    bridge
        .resolve_from_ui_result(
            initial_request_id,
            &serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await;

    let repeated = bridge
            .register_tool(
                bridge.next_id(),
                super::permissions::ToolPermissionRequest {
                    tool_call_id: "toolu_second_tool_permission".to_string(),
                    tool_name: "Read".to_string(),
                    reusable_approval_key: Some(
                        "Read::/Users/alex/Documents/acepe/packages/desktop/src/lib/components/ui/tooltip/tooltip-content.svelte"
                            .to_string(),
                    ),
                    permission_suggestions: Vec::new(),
                },
            )
            .await;

    assert_eq!(
        repeated.ui_dispatch,
        super::permissions::PermissionUiDispatch::ResolvedFromCache
    );
}

#[tokio::test]
async fn permission_bridge_questions_never_join_permission_groups() {
    let bridge = super::permissions::PermissionBridge::new();

    let first = bridge
        .register_question(
            bridge.next_id(),
            super::permissions::QuestionPermissionRequest {
                tool_call_id: "toolu_question".to_string(),
                original_input: serde_json::json!({
                    "questions": [{
                        "question": "Pick one",
                        "header": "Pick one",
                        "options": [],
                        "multiSelect": false
                    }]
                }),
            },
        )
        .await;
    let second = bridge
        .register_question(
            bridge.next_id(),
            super::permissions::QuestionPermissionRequest {
                tool_call_id: "toolu_question".to_string(),
                original_input: serde_json::json!({
                    "questions": [{
                        "question": "Pick one",
                        "header": "Pick one",
                        "options": [],
                        "multiSelect": false
                    }]
                }),
            },
        )
        .await;

    assert_eq!(
        first.ui_dispatch,
        super::permissions::PermissionUiDispatch::Emit
    );
    assert_eq!(
        second.ui_dispatch,
        super::permissions::PermissionUiDispatch::Emit
    );
}

// --- respond() outcome-shape parsing tests ---

#[tokio::test]
async fn respond_selected_resolves_allow_for_regular_permissions() {
    let client = make_test_client();
    let id = client.permission_bridge.next_id();
    let registration = client
        .permission_bridge
        .register(
            id,
            PendingPermissionKind::Tool {
                tool_call_id: "toolu_permission".to_string(),
                tool_name: "Bash".to_string(),
                reusable_approval_key: None,
                permission_suggestions: Vec::new(),
            },
        )
        .await;
    let rx = registration.receiver;

    let result = serde_json::json!({
        "outcome": { "outcome": "selected", "optionId": "allow" }
    });
    client.respond(id, result).await.expect("respond failed");

    let resolved = rx.await.expect("channel closed");
    assert!(matches!(resolved, cc_sdk::PermissionResult::Allow(_)));
}

#[tokio::test]
async fn respond_persists_permission_approval_into_projection_and_journal() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-1".to_string(),
        "Persistent permission session".to_string(),
        1704067200000,
        "/Users/alex/Documents/acepe".to_string(),
        "claude-code".to_string(),
        "-Users-alex-Documents-acepe/session-1.jsonl".to_string(),
        1704067200,
        1024,
    )
    .await
    .expect("persist session metadata");

    let path = "/Users/alex/Documents/acepe/packages/desktop/src/lib/components/ui/tooltip/tooltip-content.svelte";
    let mut client = make_test_client();
    client.db = Some(db.clone());
    client.session_id = Some("session-1".to_string());
    let projection_registry = client.projection_registry.clone();
    let permission_update = SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: "permission-1".to_string(),
            session_id: "session-1".to_string(),
            json_rpc_request_id: Some(7),
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(7)),
            permission: "Read".to_string(),
            patterns: vec![path.to_string()],
            metadata: serde_json::json!({}),
            always: vec![],
            auto_accepted: false,
            tool: None,
        },
        session_id: Some("session-1".to_string()),
    };
    projection_registry.apply_session_update("session-1", &permission_update);
    SessionJournalEventRepository::append_session_update(&db, "session-1", &permission_update)
        .await
        .expect("append permission request update");

    let registration = client
        .permission_bridge
        .register(
            7,
            PendingPermissionKind::Tool {
                tool_call_id: "toolu_permission".to_string(),
                tool_name: "Read".to_string(),
                reusable_approval_key: build_reusable_permission_key(
                    "Read",
                    &serde_json::json!({ "file_path": path }),
                ),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    client
        .respond(
            7,
            serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await
        .expect("respond failed");

    assert!(matches!(
        registration.receiver.await.expect("channel closed"),
        cc_sdk::PermissionResult::Allow(_)
    ));

    let interaction = projection_registry
        .interaction_for_request_id("session-1", 7)
        .expect("interaction should remain addressable");
    assert_eq!(interaction.state, InteractionState::Approved);
    assert!(matches!(
        interaction.response,
        Some(InteractionResponse::Permission { accepted: true, .. })
    ));

    let stored_events = SessionJournalEventRepository::list_serialized(&db, "session-1")
        .await
        .expect("list persisted interaction events");
    assert!(stored_events
        .iter()
        .any(|event| event.event_kind == "interaction_transition"));
}

#[tokio::test]
async fn restore_session_permission_approvals_does_not_replay_journal_as_product_authority() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-restore".to_string(),
        "Restored permission session".to_string(),
        1704067200000,
        "/Users/alex/Documents/acepe".to_string(),
        "claude-code".to_string(),
        "-Users-alex-Documents-acepe/session-restore.jsonl".to_string(),
        1704067200,
        1024,
    )
    .await
    .expect("persist session metadata");

    let path =
            "/Users/alex/Documents/acepe/packages/desktop/src/lib/components/ui/tooltip/tooltip-content.svelte";
    let permission_update = SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: "permission-restore".to_string(),
            session_id: "session-restore".to_string(),
            json_rpc_request_id: Some(11),
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(11)),
            permission: "Read".to_string(),
            patterns: vec![path.to_string()],
            metadata: serde_json::json!({}),
            always: vec![],
            auto_accepted: false,
            tool: None,
        },
        session_id: Some("session-restore".to_string()),
    };
    SessionJournalEventRepository::append_session_update(
        &db,
        "session-restore",
        &permission_update,
    )
    .await
    .expect("append permission request update");
    SessionJournalEventRepository::append_interaction_transition(
        &db,
        "session-restore",
        "permission-restore",
        InteractionState::Approved,
        InteractionResponse::Permission {
            accepted: true,
            option_id: Some("allow".to_string()),
            reply: Some("once".to_string()),
        },
    )
    .await
    .expect("append permission transition");

    let mut client = make_test_client();
    client.db = Some(db);
    client
        .restore_session_permission_approvals("session-restore")
        .await;

    let registration = client
        .permission_bridge
        .register(
            client.permission_bridge.next_id(),
            PendingPermissionKind::Tool {
                tool_call_id: "toolu_permission".to_string(),
                tool_name: "Read".to_string(),
                reusable_approval_key: build_reusable_permission_key(
                    "Read",
                    &serde_json::json!({ "file_path": path }),
                ),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(
        registration.ui_dispatch,
        super::permissions::PermissionUiDispatch::Emit
    );
}

#[tokio::test]
async fn reject_interaction_for_request_persists_rejected_permission() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-1".to_string(),
        "Rejected permission session".to_string(),
        1704067200000,
        "/Users/alex/Documents/acepe".to_string(),
        "claude-code".to_string(),
        "-Users-alex-Documents-acepe/session-1.jsonl".to_string(),
        1704067200,
        1024,
    )
    .await
    .expect("persist session metadata");

    let path = "/Users/alex/Documents/acepe/packages/desktop/src/lib/components/ui/tooltip/tooltip-content.svelte";
    let mut client = make_test_client();
    client.db = Some(db.clone());
    client.session_id = Some("session-1".to_string());

    let permission_update = SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: "permission-1".to_string(),
            session_id: "session-1".to_string(),
            json_rpc_request_id: Some(7),
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(7)),
            permission: "Read".to_string(),
            patterns: vec![path.to_string()],
            metadata: serde_json::json!({}),
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
        .reject_interaction_for_request(7, "Permission request was cancelled")
        .await;

    let interaction = client
        .projection_registry
        .interaction_for_request_id("session-1", 7)
        .expect("interaction should remain addressable");
    assert_eq!(interaction.state, InteractionState::Rejected);

    let stored_events = SessionJournalEventRepository::list_serialized(&db, "session-1")
        .await
        .expect("list persisted interaction events");
    assert!(stored_events
        .iter()
        .any(|event| event.event_kind == "interaction_transition"));
}

#[tokio::test]
async fn resolve_stream_only_question_interaction_persists_answered_state() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-stream".to_string(),
        "Stream only question session".to_string(),
        1704067200000,
        "/Users/alex/Documents/acepe".to_string(),
        "claude-code".to_string(),
        "-Users-alex-Documents-acepe/session-stream.jsonl".to_string(),
        1704067200,
        1024,
    )
    .await
    .expect("persist session metadata");

    let questions = vec![QuestionItem {
        question: "Pick one".to_string(),
        header: "Pick one".to_string(),
        options: vec![],
        multi_select: false,
    }];

    let mut client = make_test_client();
    client.db = Some(db.clone());
    client.session_id = Some("session-stream".to_string());

    let question_update = SessionUpdate::QuestionRequest {
        question: QuestionData {
            id: "toolu_stream_only".to_string(),
            session_id: "session-stream".to_string(),
            json_rpc_request_id: None,
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::http(
                "toolu_stream_only",
            )),
            questions: questions.clone(),
            tool: Some(ToolReference {
                message_id: None,
                call_id: "toolu_stream_only".to_string(),
            }),
        },
        session_id: Some("session-stream".to_string()),
    };
    client
        .projection_registry
        .apply_session_update("session-stream", &question_update);
    SessionJournalEventRepository::append_session_update(&db, "session-stream", &question_update)
        .await
        .expect("append question request update");

    client
        .resolve_stream_only_question_interaction(
            "toolu_stream_only",
            "session-stream",
            &questions,
            &[vec!["Option A".to_string()]],
        )
        .await;

    let interaction = client
        .projection_registry
        .interaction("toolu_stream_only")
        .expect("interaction should exist");
    assert_eq!(interaction.state, InteractionState::Answered);

    let stored_events = SessionJournalEventRepository::list_serialized(&db, "session-stream")
        .await
        .expect("list persisted interaction events");
    assert!(stored_events
        .iter()
        .any(|event| event.event_kind == "interaction_snapshot"));
    assert!(stored_events
        .iter()
        .all(|event| event.event_kind != "projection_update"));
}

#[tokio::test]
async fn respond_cancelled_resolves_deny_for_regular_permissions() {
    let client = make_test_client();
    let id = client.permission_bridge.next_id();
    let registration = client
        .permission_bridge
        .register(
            id,
            PendingPermissionKind::Tool {
                tool_call_id: "toolu_permission".to_string(),
                tool_name: "Bash".to_string(),
                reusable_approval_key: None,
                permission_suggestions: Vec::new(),
            },
        )
        .await;
    let rx = registration.receiver;
    let result = serde_json::json!({
        "outcome": { "outcome": "cancelled", "optionId": "reject" }
    });
    client.respond(id, result).await.expect("respond failed");

    let resolved = rx.await.expect("channel closed");
    assert!(matches!(resolved, cc_sdk::PermissionResult::Deny(_)));
}

#[tokio::test]
async fn cancel_resolves_pending_question_for_matching_session() {
    let mut client = make_test_client();
    let id = client.permission_bridge.next_id();
    let registration = client
        .permission_bridge
        .register(
            id,
            PendingPermissionKind::Question {
                tool_call_id: "toolu_question".to_string(),
                original_input: serde_json::json!({
                    "questions": [{
                        "question": "Pick one",
                        "header": "Pick one",
                        "options": [],
                        "multiSelect": false
                    }]
                }),
            },
        )
        .await;
    let rx = registration.receiver;

    client.pending_questions.lock().await.insert(
        "toolu_question".to_string(),
        PendingQuestionState {
            request_id: id,
            session_id: "session-stop".to_string(),
            questions: Some(vec![QuestionItem {
                question: "Pick one".to_string(),
                header: "Pick one".to_string(),
                options: vec![],
                multi_select: false,
            }]),
            ui_emitted: true,
        },
    );

    client
        .cancel("session-stop".to_string())
        .await
        .expect("cancel failed");

    let resolved = rx.await.expect("channel closed");
    assert!(matches!(resolved, cc_sdk::PermissionResult::Deny(_)));
    assert!(client.pending_questions.lock().await.is_empty());
}

#[tokio::test]
async fn respond_selected_allow_always_resolves_updated_permissions_for_regular_tools() {
    let client = make_test_client();
    let id = client.permission_bridge.next_id();
    let registration = client
        .permission_bridge
        .register(
            id,
            PendingPermissionKind::Tool {
                tool_call_id: "toolu_permission".to_string(),
                tool_name: "Bash".to_string(),
                reusable_approval_key: None,
                permission_suggestions: vec![cc_sdk::PermissionUpdate {
                    update_type: cc_sdk::PermissionUpdateType::AddRules,
                    rules: Some(vec![cc_sdk::PermissionRuleValue {
                        tool_name: "Bash".to_string(),
                        rule_content: None,
                    }]),
                    behavior: Some(cc_sdk::PermissionBehavior::Allow),
                    mode: None,
                    directories: None,
                    destination: Some(cc_sdk::PermissionUpdateDestination::Session),
                }],
            },
        )
        .await;
    let rx = registration.receiver;

    let result = serde_json::json!({
        "outcome": { "outcome": "selected", "optionId": "allow_always" }
    });
    client.respond(id, result).await.expect("respond failed");

    let resolved = rx.await.expect("channel closed");
    let allow = match resolved {
        cc_sdk::PermissionResult::Allow(allow) => allow,
        other => panic!("expected allow result, got {:?}", other),
    };

    assert_eq!(allow.updated_permissions.as_ref().map(Vec::len), Some(1));
    assert_eq!(
        allow
            .updated_permissions
            .as_ref()
            .and_then(|updates| updates.first())
            .map(|update| update.update_type),
        Some(cc_sdk::PermissionUpdateType::AddRules)
    );
}

#[tokio::test]
async fn reply_permission_resolves_hook_allow_once() {
    let mut client = make_test_client();
    let id = client.permission_bridge.next_id();
    let registration = client
        .permission_bridge
        .register_hook(
            id,
            PendingPermissionKind::Hook {
                tool_call_id: "toolu_hook".to_string(),
                tool_name: "Bash".to_string(),
                reusable_approval_key: None,
                original_input: serde_json::json!({ "command": "git status" }),
                permission_suggestions: Vec::new(),
            },
        )
        .await;
    let rx = registration.receiver;

    assert!(client
        .reply_permission(id.to_string(), "once".to_string())
        .await
        .expect("reply_permission failed"));

    let resolved = rx.await.expect("channel closed");
    let cc_sdk::HookJSONOutput::Sync(output) = resolved else {
        panic!("expected sync hook output");
    };
    let serialized = serde_json::to_value(output).expect("serialize hook output");
    let decision = serialized["hookSpecificOutput"]["decision"].clone();

    assert_eq!(decision["behavior"], "allow");
    assert_eq!(decision["updatedInput"]["command"], "git status");
    assert!(decision.get("updatedPermissions").is_none());
}

#[tokio::test]
async fn reply_permission_resolves_hook_allow_always_with_suggestion() {
    let mut client = make_test_client();
    let id = client.permission_bridge.next_id();
    let registration = client
        .permission_bridge
        .register_hook(
            id,
            PendingPermissionKind::Hook {
                tool_call_id: "toolu_hook".to_string(),
                tool_name: "Bash".to_string(),
                reusable_approval_key: None,
                original_input: serde_json::json!({ "command": "git status" }),
                permission_suggestions: vec![cc_sdk::PermissionUpdate {
                    update_type: cc_sdk::PermissionUpdateType::AddRules,
                    rules: Some(vec![cc_sdk::PermissionRuleValue {
                        tool_name: "Bash".to_string(),
                        rule_content: None,
                    }]),
                    behavior: Some(cc_sdk::PermissionBehavior::Allow),
                    mode: None,
                    directories: None,
                    destination: Some(cc_sdk::PermissionUpdateDestination::Session),
                }],
            },
        )
        .await;
    let rx = registration.receiver;

    assert!(client
        .reply_permission(id.to_string(), "always".to_string())
        .await
        .expect("reply_permission failed"));

    let resolved = rx.await.expect("channel closed");
    let cc_sdk::HookJSONOutput::Sync(output) = resolved else {
        panic!("expected sync hook output");
    };
    let serialized = serde_json::to_value(output).expect("serialize hook output");
    let decision = serialized["hookSpecificOutput"]["decision"].clone();

    assert_eq!(decision["behavior"], "allow");
    assert_eq!(decision["updatedPermissions"][0]["type"], "addRules");
    assert_eq!(decision["updatedPermissions"][0]["destination"], "session");
}

#[tokio::test]
async fn permission_bridge_reuses_resolved_group_for_late_hook_registration() {
    let bridge = PermissionBridge::new();
    let initial_id = bridge.next_id();
    let initial_registration = bridge
        .register(
            initial_id,
            PendingPermissionKind::Tool {
                tool_call_id: "toolu_shared_permission".to_string(),
                tool_name: "Write".to_string(),
                reusable_approval_key: Some("Write::/tmp/color.txt".to_string()),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(initial_registration.ui_dispatch, PermissionUiDispatch::Emit);

    let resolved_kind = bridge
        .resolve_from_ui_result(
            initial_id,
            &serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await;

    assert!(matches!(
        resolved_kind,
        Some(PendingPermissionKind::Tool { .. })
    ));
    assert!(matches!(
        initial_registration
            .receiver
            .await
            .expect("initial permission resolution"),
        cc_sdk::PermissionResult::Allow(_)
    ));

    let late_hook_id = bridge.next_id();
    let late_hook_registration = bridge
        .register_hook(
            late_hook_id,
            PendingPermissionKind::Hook {
                tool_call_id: "toolu_shared_permission".to_string(),
                tool_name: "Write".to_string(),
                reusable_approval_key: Some("Write::/tmp/color.txt".to_string()),
                original_input: serde_json::json!({
                    "file_path": "/tmp/color.txt",
                    "content": "blue"
                }),
                permission_suggestions: Vec::new(),
            },
        )
        .await;

    assert_eq!(
        late_hook_registration.ui_dispatch,
        PermissionUiDispatch::ResolvedFromCache
    );

    let resolved_hook = timeout(Duration::from_millis(50), late_hook_registration.receiver)
        .await
        .expect("late hook should resolve without another UI prompt")
        .expect("late hook channel closed");
    let cc_sdk::HookJSONOutput::Sync(output) = resolved_hook else {
        panic!("expected sync hook output");
    };
    let serialized = serde_json::to_value(output).expect("serialize hook output");

    assert_eq!(
        serialized["hookSpecificOutput"]["decision"]["behavior"],
        "allow"
    );
    assert_eq!(
        serialized["hookSpecificOutput"]["decision"]["updatedInput"]["file_path"],
        "/tmp/color.txt"
    );
}

#[tokio::test]
async fn permission_request_hook_ignores_ask_user_question() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;

    let hook = AcepePermissionRequestHook {
        session_id: "session-hook".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
    };

    let resolver_bridge = bridge.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(5)).await;
        let _ = resolver_bridge
            .resolve_from_ui_result(
                1,
                &serde_json::json!({
                    "outcome": { "outcome": "selected", "optionId": "allow" }
                }),
            )
            .await;
    });

    let result = hook
        .execute(
            &cc_sdk::HookInput::PermissionRequest(cc_sdk::PermissionRequestHookInput {
                session_id: "session-hook".to_string(),
                transcript_path: "/tmp/transcript.jsonl".to_string(),
                cwd: "/tmp".to_string(),
                permission_mode: Some("default".to_string()),
                tool_name: "AskUserQuestion".to_string(),
                tool_input: serde_json::json!({
                    "questions": [{
                        "question": "Pick one",
                        "header": "Pick one",
                        "options": [{ "label": "A", "description": "" }],
                        "multiSelect": false
                    }]
                }),
                permission_suggestions: None,
                agent_id: None,
                agent_type: None,
            }),
            Some("toolu_question_hook"),
            &cc_sdk::HookContext { signal: None },
        )
        .await
        .expect("hook execute failed");

    let cc_sdk::HookJSONOutput::Sync(output) = result else {
        panic!("expected sync hook output");
    };

    assert_eq!(output.continue_, Some(true));
    assert!(output.hook_specific_output.is_none());
    assert!(sink.lock().expect("sink lock").is_empty());
}

#[tokio::test]
async fn can_use_tool_and_permission_request_hook_share_one_visible_permission_request() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;

    tracker
        .record("Bash".to_string(), "toolu_shared_permission".to_string())
        .await;

    let handler = AcepePermissionHandler {
        session_id: "session-shared".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher: dispatcher.clone(),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        tool_call_tracker: tracker,
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
    };

    let hook = AcepePermissionRequestHook {
        session_id: "session-shared".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
    };

    let handler_task = tokio::spawn(async move {
        handler
            .can_use_tool(
                "Bash",
                &serde_json::json!({ "command": "git status" }),
                &cc_sdk::ToolPermissionContext {
                    signal: None,
                    suggestions: Vec::new(),
                },
            )
            .await
    });

    tokio::time::sleep(Duration::from_millis(5)).await;

    let hook_task = tokio::spawn(async move {
        hook.execute(
            &cc_sdk::HookInput::PermissionRequest(cc_sdk::PermissionRequestHookInput {
                session_id: "session-shared".to_string(),
                transcript_path: "/tmp/transcript.jsonl".to_string(),
                cwd: "/tmp".to_string(),
                permission_mode: Some("default".to_string()),
                tool_name: "Bash".to_string(),
                tool_input: serde_json::json!({ "command": "git status" }),
                permission_suggestions: None,
                agent_id: None,
                agent_type: None,
            }),
            Some("toolu_shared_permission"),
            &cc_sdk::HookContext { signal: None },
        )
        .await
    });

    tokio::time::sleep(Duration::from_millis(5)).await;

    {
        let captured = sink.lock().expect("sink lock");
        assert_eq!(
            captured
                .iter()
                .filter(|event| event.event_name == "acp-session-update")
                .count(),
            1
        );
        assert!(captured
            .iter()
            .any(|event| event.event_name == "acp-session-domain-event"));
    }

    let resolved_kind = bridge
        .resolve_from_ui_result(
            1,
            &serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await;

    assert!(matches!(
        resolved_kind,
        Some(PendingPermissionKind::Tool { .. })
    ));
    assert!(matches!(
        handler_task.await.expect("handler task failed"),
        cc_sdk::PermissionResult::Allow(_)
    ));

    let hook_result = hook_task
        .await
        .expect("hook task failed")
        .expect("hook execute failed");
    let cc_sdk::HookJSONOutput::Sync(output) = hook_result else {
        panic!("expected sync hook output");
    };
    let serialized = serde_json::to_value(output).expect("serialize hook output");

    assert_eq!(
        serialized["hookSpecificOutput"]["decision"]["behavior"],
        "allow"
    );
    let captured = sink.lock().expect("sink lock");
    assert_eq!(
        captured
            .iter()
            .filter(|event| event.event_name == "acp-session-update")
            .count(),
        1
    );
}

#[tokio::test]
async fn autonomous_permission_request_hook_does_not_emit_a_second_visible_request() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let session_policy = Arc::new(SessionPolicyRegistry::new());
    let task_reconciler = Arc::new(std::sync::Mutex::new(TaskReconciler::new()));
    session_policy.set_autonomous("session-auto-hook", true);

    tracker
        .record("Bash".to_string(), "toolu_auto_hook".to_string())
        .await;

    let handler = AcepePermissionHandler {
        session_id: "session-auto-hook".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher: dispatcher.clone(),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: session_policy.clone(),
        tool_call_tracker: tracker,
        task_reconciler: task_reconciler.clone(),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
    };

    let hook = AcepePermissionRequestHook {
        session_id: "session-auto-hook".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge,
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy,
        task_reconciler,
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
    };

    let handler_result = handler
        .can_use_tool(
            "Bash",
            &serde_json::json!({ "command": "git status" }),
            &cc_sdk::ToolPermissionContext {
                signal: None,
                suggestions: Vec::new(),
            },
        )
        .await;
    assert!(matches!(handler_result, cc_sdk::PermissionResult::Allow(_)));

    let hook_result = hook
        .execute(
            &cc_sdk::HookInput::PermissionRequest(cc_sdk::PermissionRequestHookInput {
                session_id: "session-auto-hook".to_string(),
                transcript_path: "/tmp/transcript.jsonl".to_string(),
                cwd: "/tmp".to_string(),
                permission_mode: Some("default".to_string()),
                tool_name: "Bash".to_string(),
                tool_input: serde_json::json!({ "command": "git status" }),
                permission_suggestions: None,
                agent_id: None,
                agent_type: None,
            }),
            Some("toolu_auto_hook"),
            &cc_sdk::HookContext { signal: None },
        )
        .await
        .expect("hook execute failed");

    let cc_sdk::HookJSONOutput::Sync(output) = hook_result else {
        panic!("expected sync hook output");
    };
    let serialized = serde_json::to_value(output).expect("serialize hook output");
    assert_eq!(
        serialized["hookSpecificOutput"]["decision"]["behavior"],
        "allow"
    );

    let captured = sink.lock().expect("sink lock");
    assert_eq!(
        captured
            .iter()
            .filter(|event| event.event_name == "acp-session-update")
            .count(),
        1
    );
}

#[tokio::test]
async fn respond_selected_question_resolves_updated_input() {
    let client = make_test_client();
    let id = client.permission_bridge.next_id();
    let registration = client
        .permission_bridge
        .register(
            id,
            PendingPermissionKind::Question {
                tool_call_id: "toolu_question".to_string(),
                original_input: serde_json::json!({
                    "questions": [{
                        "question": "Pick one",
                        "header": "Pick one",
                        "options": [],
                        "multiSelect": false
                    }]
                }),
            },
        )
        .await;
    let rx = registration.receiver;

    client.pending_questions.lock().await.insert(
        "toolu_question".to_string(),
        PendingQuestionState {
            request_id: id,
            session_id: "session-1".to_string(),
            questions: Some(vec![QuestionItem {
                question: "Pick one".to_string(),
                header: "Pick one".to_string(),
                options: vec![],
                multi_select: false,
            }]),
            ui_emitted: true,
        },
    );

    let result = serde_json::json!({
        "outcome": { "outcome": "selected", "optionId": "allow" },
        "_meta": {
            "answers": {
                "Pick one": "Option A"
            }
        }
    });
    client.respond(id, result).await.expect("respond failed");

    let resolved = rx.await.expect("channel closed");
    let allow = match resolved {
        cc_sdk::PermissionResult::Allow(allow) => allow,
        other => panic!("expected allow result, got {:?}", other),
    };

    assert_eq!(
        allow.updated_input,
        Some(serde_json::json!({
            "questions": [{
                "question": "Pick one",
                "header": "Pick one",
                "options": [],
                "multiSelect": false
            }],
            "answers": {
                "Pick one": "Option A"
            }
        }))
    );
    assert!(client.pending_questions.lock().await.is_empty());
}

#[test]
fn permission_request_update_includes_json_rpc_request_id() {
    let update = build_permission_request_update(
        "test-session",
        "tool-42",
        42,
        "Bash",
        &serde_json::json!({ "command": "ls" }),
        false,
        AgentType::ClaudeCode,
        false,
    );

    match update {
        SessionUpdate::PermissionRequest {
            permission,
            session_id,
        } => {
            assert_eq!(session_id.as_deref(), Some("test-session"));
            assert_eq!(permission.id, "42");
            assert_eq!(permission.session_id, "test-session");
            assert_eq!(permission.json_rpc_request_id, Some(42));
            assert_eq!(permission.permission, "Bash");
            assert!(!permission.auto_accepted);
            assert_eq!(
                permission.tool.as_ref().map(|tool| tool.call_id.as_str()),
                Some("tool-42")
            );
        }
        _ => panic!("expected permission request update"),
    }
}

#[tokio::test]
async fn can_use_tool_auto_accepts_when_session_is_autonomous() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    tracker
        .record("Bash".to_string(), "toolu_auto_permission".to_string())
        .await;

    let (handler, session_policy, _) =
        make_permission_handler_fixture("session-auto", dispatcher, bridge.clone(), tracker);
    session_policy.set_autonomous("session-auto", true);

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: Vec::new(),
    };
    let result = timeout(
        Duration::from_millis(50),
        handler.can_use_tool(
            "Bash",
            &serde_json::json!({ "command": "git status" }),
            &context,
        ),
    )
    .await
    .expect("autonomous permission should resolve immediately");

    assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));
    assert!(bridge
        .resolve_from_ui_result(
            1,
            &serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await
        .is_none());

    let captured = sink.lock().expect("sink lock");
    let event = captured
        .iter()
        .find(|event| event.event_name == "acp-session-update")
        .expect("expected session update event");
    let update = match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
        other => panic!("expected session update payload, got {:?}", other),
    };

    match update.as_ref() {
        SessionUpdate::PermissionRequest { permission, .. } => {
            assert!(permission.auto_accepted);
            assert_eq!(permission.permission, "Bash");
            assert_eq!(
                permission.tool.as_ref().map(|tool| tool.call_id.as_str()),
                Some("toolu_auto_permission")
            );
        }
        other => panic!("expected permission request update, got {:?}", other),
    }
}

#[tokio::test]
async fn can_use_tool_auto_accepts_child_tool_calls_when_policy_is_off() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    tracker
        .record("Read".to_string(), "toolu_child_permission".to_string())
        .await;

    let (handler, _session_policy, task_reconciler) =
        make_permission_handler_fixture("session-child", dispatcher, bridge.clone(), tracker);
    task_reconciler
        .lock()
        .expect("task reconciler lock should not be poisoned")
        .handle_tool_call(make_child_read_tool_call(
            "toolu_child_permission",
            "toolu_parent_task",
            "/tmp/example.txt",
        ));

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: Vec::new(),
    };
    let result = timeout(
        Duration::from_millis(50),
        handler.can_use_tool(
            "Read",
            &serde_json::json!({ "file_path": "/tmp/example.txt" }),
            &context,
        ),
    )
    .await
    .expect("child permission should resolve immediately");

    assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));
    assert!(bridge
        .resolve_from_ui_result(
            1,
            &serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await
        .is_none());

    let captured = sink.lock().expect("sink lock");
    let event = captured
        .iter()
        .find(|event| event.event_name == "acp-session-update")
        .expect("expected session update event");
    let update = match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
        other => panic!("expected session update payload, got {:?}", other),
    };

    match update.as_ref() {
        SessionUpdate::PermissionRequest { permission, .. } => {
            assert!(permission.auto_accepted);
            assert_eq!(permission.permission, "Read");
            assert_eq!(
                permission.tool.as_ref().map(|tool| tool.call_id.as_str()),
                Some("toolu_child_permission")
            );
        }
        other => panic!("expected permission request update, got {:?}", other),
    }
}

#[tokio::test]
async fn can_use_tool_does_not_auto_accept_exit_plan_permissions() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    tracker
        .record(
            "ExitPlanMode".to_string(),
            "toolu_exit_plan_permission".to_string(),
        )
        .await;

    let (handler, session_policy, _) =
        make_permission_handler_fixture("session-exit-plan", dispatcher, bridge.clone(), tracker);
    session_policy.set_autonomous("session-exit-plan", true);

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: Vec::new(),
    };
    let handler_task = tokio::spawn(async move {
        handler
            .can_use_tool("ExitPlanMode", &serde_json::json!({}), &context)
            .await
    });

    tokio::time::sleep(Duration::from_millis(5)).await;

    let resolved_kind = bridge
        .resolve_from_ui_result(
            1,
            &serde_json::json!({
                "outcome": { "outcome": "selected", "optionId": "allow" }
            }),
        )
        .await;
    assert!(matches!(
        resolved_kind,
        Some(PendingPermissionKind::Tool { .. })
    ));
    assert!(matches!(
        handler_task.await.expect("handler task failed"),
        cc_sdk::PermissionResult::Allow(_)
    ));

    let captured = sink.lock().expect("sink lock");
    let event = captured
        .iter()
        .find(|event| event.event_name == "acp-session-update")
        .expect("expected session update event");
    let update = match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
        other => panic!("expected session update payload, got {:?}", other),
    };

    match update.as_ref() {
        SessionUpdate::PermissionRequest { permission, .. } => {
            assert!(!permission.auto_accepted);
            assert_eq!(permission.permission, "ExitPlanMode");
        }
        other => panic!("expected permission request update, got {:?}", other),
    }
}

#[tokio::test]
async fn tool_call_tracker_returns_stream_tool_use_id_in_fifo_order() {
    let tracker = ToolCallIdTracker::new();

    tracker
        .record("Bash".to_string(), "toolu_first".to_string())
        .await;
    tracker
        .record("Bash".to_string(), "toolu_second".to_string())
        .await;

    assert_eq!(tracker.take("Bash").await.as_deref(), Some("toolu_first"));
    assert_eq!(tracker.take("Bash").await.as_deref(), Some("toolu_second"));
    assert_eq!(tracker.take("Bash").await, None);
}

#[tokio::test]
async fn tool_call_tracker_prefers_matching_input_over_fifo_for_same_name_tools() {
    let tracker = ToolCallIdTracker::new();

    tracker
        .record_with_input(
            "Bash".to_string(),
            "toolu_first".to_string(),
            Some(&serde_json::json!({
                "command": "git diff --stat",
                "description": "Show diff summary"
            })),
        )
        .await;
    tracker
        .record_with_input(
            "Bash".to_string(),
            "toolu_second".to_string(),
            Some(&serde_json::json!({
                "description": "Show working tree status with explicit paths",
                "command": "git status --short"
            })),
        )
        .await;

    assert_eq!(
        tracker
            .take_for_input(
                "Bash",
                &serde_json::json!({
                    "command": "git status --short",
                    "description": "Show working tree status with explicit paths"
                }),
            )
            .await
            .as_deref(),
        Some("toolu_second")
    );
    assert_eq!(tracker.take("Bash").await.as_deref(), Some("toolu_first"));
    assert_eq!(tracker.take("Bash").await, None);
}

#[tokio::test]
async fn tool_call_tracker_prefers_newest_unannotated_same_name_tool() {
    let tracker = ToolCallIdTracker::new();

    tracker
        .record_with_input(
            "Bash".to_string(),
            "toolu_old".to_string(),
            Some(&serde_json::json!({
                "command": "git diff --cached"
            })),
        )
        .await;
    tracker
        .record("Bash".to_string(), "toolu_current".to_string())
        .await;

    assert_eq!(
        tracker
            .take_for_input(
                "Bash",
                &serde_json::json!({
                    "command": "git status --short"
                }),
            )
            .await
            .as_deref(),
        Some("toolu_current")
    );
    assert_eq!(tracker.take("Bash").await.as_deref(), Some("toolu_old"));
    assert_eq!(tracker.take("Bash").await, None);
}

#[tokio::test]
async fn can_use_tool_emits_inbound_request_with_tracked_tool_use_id() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    tracker
        .record("Bash".to_string(), "toolu_tracked_123".to_string())
        .await;

    let handler = AcepePermissionHandler {
        session_id: "session-1".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        tool_call_tracker: tracker,
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
    };

    let resolver_bridge = bridge.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(5)).await;
        resolver_bridge
            .resolve_from_ui_result(
                1,
                &serde_json::json!({
                    "outcome": { "outcome": "selected", "optionId": "allow" }
                }),
            )
            .await;
    });

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: Vec::new(),
    };

    let result = handler
        .can_use_tool(
            "Bash",
            &serde_json::json!({ "command": "echo ok" }),
            &context,
        )
        .await;

    assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));

    let captured = sink.lock().expect("sink lock");
    let event = captured
        .iter()
        .find(|event| event.event_name == "acp-session-update")
        .expect("expected session update event");
    assert_eq!(event.event_name, "acp-session-update");
    let update = match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
        other => panic!("expected session update payload, got {:?}", other),
    };
    match update.as_ref() {
        SessionUpdate::PermissionRequest {
            permission,
            session_id,
        } => {
            assert_eq!(session_id.as_deref(), Some("session-1"));
            assert_eq!(permission.id, "1");
            assert_eq!(permission.session_id, "session-1");
            assert_eq!(permission.permission, "Bash");
            let tool = permission.tool.as_ref().expect("expected tool reference");
            assert_eq!(tool.call_id, "toolu_tracked_123");
            assert!(permission.always.is_empty());
        }
        other => panic!("expected permission request update, got {:?}", other),
    }
}

#[tokio::test]
async fn can_use_tool_emits_allow_always_option_when_sdk_suggests_persistent_allow() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    tracker
        .record("Bash".to_string(), "toolu_tracked_456".to_string())
        .await;

    let handler = AcepePermissionHandler {
        session_id: "session-allow-always".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        tool_call_tracker: tracker,
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
    };

    let resolver_bridge = bridge.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(5)).await;
        resolver_bridge
            .resolve(
                1,
                cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                    updated_input: None,
                    updated_permissions: Some(vec![cc_sdk::PermissionUpdate {
                        update_type: cc_sdk::PermissionUpdateType::AddRules,
                        rules: Some(vec![cc_sdk::PermissionRuleValue {
                            tool_name: "Bash".to_string(),
                            rule_content: None,
                        }]),
                        behavior: Some(cc_sdk::PermissionBehavior::Allow),
                        mode: None,
                        directories: None,
                        destination: Some(cc_sdk::PermissionUpdateDestination::Session),
                    }]),
                }),
            )
            .await;
    });

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: vec![cc_sdk::PermissionUpdate {
            update_type: cc_sdk::PermissionUpdateType::AddRules,
            rules: Some(vec![cc_sdk::PermissionRuleValue {
                tool_name: "Bash".to_string(),
                rule_content: None,
            }]),
            behavior: Some(cc_sdk::PermissionBehavior::Allow),
            mode: None,
            directories: None,
            destination: Some(cc_sdk::PermissionUpdateDestination::Session),
        }],
    };

    let result = handler
        .can_use_tool(
            "Bash",
            &serde_json::json!({ "command": "echo ok" }),
            &context,
        )
        .await;

    assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));

    let captured = sink.lock().expect("sink lock");
    let event = captured
        .iter()
        .find(|event| event.event_name == "acp-session-update")
        .expect("expected session update event");
    let update = match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
        other => panic!("expected session update payload, got {:?}", other),
    };
    match update.as_ref() {
        SessionUpdate::PermissionRequest { permission, .. } => {
            assert_eq!(permission.permission, "Bash");
            assert_eq!(permission.always, vec!["allow_always".to_string()]);
        }
        other => panic!("expected permission request update, got {:?}", other),
    }
}

#[tokio::test]
async fn can_use_tool_reuses_exact_session_permission_without_emitting_again() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    tracker
        .record("Read".to_string(), "toolu_read_first".to_string())
        .await;
    tracker
        .record("Read".to_string(), "toolu_read_second".to_string())
        .await;

    let handler = AcepePermissionHandler {
        session_id: "session-reuse".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        tool_call_tracker: tracker,
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
    };

    let resolver_bridge = bridge.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(5)).await;
        resolver_bridge
            .resolve_from_ui_result(
                1,
                &serde_json::json!({
                    "outcome": { "outcome": "selected", "optionId": "allow" }
                }),
            )
            .await;
    });

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: Vec::new(),
    };
    let input = serde_json::json!({
        "file_path": "/Users/alex/Documents/acepe/packages/desktop/src/lib/components/ui/tooltip/tooltip-content.svelte"
    });
    let reusable_key = build_reusable_permission_key("Read", &input);

    let first = handler.can_use_tool("Read", &input, &context).await;
    assert!(matches!(first, cc_sdk::PermissionResult::Allow(_)));
    assert_eq!(
        bridge.cached_reusable_approval_keys().await,
        vec![reusable_key.clone().expect("expected reusable key")]
    );

    let cache_probe = bridge
        .register_tool(
            bridge.next_id(),
            ToolPermissionRequest {
                tool_call_id: "toolu_probe".to_string(),
                tool_name: "Read".to_string(),
                reusable_approval_key: reusable_key.clone(),
                permission_suggestions: Vec::new(),
            },
        )
        .await;
    assert_eq!(
        cache_probe.ui_dispatch,
        PermissionUiDispatch::ResolvedFromCache
    );

    let second = timeout(
        Duration::from_millis(50),
        handler.can_use_tool("Read", &input, &context),
    )
    .await
    .expect("second permission should reuse cached approval immediately");
    assert!(matches!(second, cc_sdk::PermissionResult::Allow(_)));

    let captured = sink.lock().expect("sink lock");
    let permission_request_updates = captured
        .iter()
        .filter(|event| {
            matches!(
                event.payload,
                crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(
                    ref update
                ) if matches!(update.as_ref(), SessionUpdate::PermissionRequest { .. })
            )
        })
        .count();
    assert_eq!(permission_request_updates, 1);
}

#[tokio::test]
async fn can_use_tool_falls_back_to_synthetic_id_when_tracker_is_empty() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;

    let handler = AcepePermissionHandler {
        session_id: "session-2".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
    };

    let resolver_bridge = bridge.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(5)).await;
        resolver_bridge
            .resolve(
                1,
                cc_sdk::PermissionResult::Deny(cc_sdk::PermissionResultDeny {
                    message: "Denied".to_string(),
                    interrupt: false,
                }),
            )
            .await;
    });

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: Vec::new(),
    };

    let result = handler
        .can_use_tool(
            "Bash",
            &serde_json::json!({ "command": "echo ok" }),
            &context,
        )
        .await;

    assert!(matches!(result, cc_sdk::PermissionResult::Deny(_)));

    let captured = sink.lock().expect("sink lock");
    let event = captured
        .iter()
        .find(|event| event.event_name == "acp-session-update")
        .expect("expected session update event");
    let update = match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
        other => panic!("expected session update payload, got {:?}", other),
    };
    match update.as_ref() {
        SessionUpdate::PermissionRequest { permission, .. } => {
            let tool = permission.tool.as_ref().expect("expected tool reference");
            assert_eq!(tool.call_id, "cc-sdk-1");
        }
        other => panic!("expected permission request update, got {:?}", other),
    }
}

#[tokio::test]
async fn can_use_tool_emits_question_request_for_ask_user_question() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    let pending_questions = Arc::new(Mutex::new(HashMap::new()));
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    tracker
        .record(
            "AskUserQuestion".to_string(),
            "toolu_question_123".to_string(),
        )
        .await;

    let handler = AcepePermissionHandler {
        session_id: "session-ask".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        tool_call_tracker: tracker,
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions,
    };

    let resolver_bridge = bridge.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(5)).await;
        resolver_bridge
            .resolve(
                1,
                cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                    updated_input: Some(serde_json::json!({
                        "questions": [{
                            "question": "Which branch should I use?",
                            "header": "Branch",
                            "options": [
                                { "label": "main", "description": "" },
                                { "label": "dev", "description": "" }
                            ],
                            "multiSelect": false
                        }],
                        "answers": { "Which branch should I use?": "main" }
                    })),
                    updated_permissions: None,
                }),
            )
            .await;
    });

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: Vec::new(),
    };

    let result = handler
        .can_use_tool(
            "AskUserQuestion",
            &serde_json::json!({
                "questions": [{
                    "question": "Which branch should I use?",
                    "header": "Branch",
                    "options": [
                        { "label": "main", "description": "" },
                        { "label": "dev", "description": "" }
                    ],
                    "multiSelect": false
                }]
            }),
            &context,
        )
        .await;

    assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));
    let captured = sink.lock().expect("sink lock");
    let event = captured
        .iter()
        .find(|event| event.event_name == "acp-session-update")
        .expect("expected session update event");
    let update = match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
        other => panic!("expected session update payload, got {:?}", other),
    };

    match update.as_ref() {
        SessionUpdate::QuestionRequest { question, .. } => {
            assert_eq!(question.id, "toolu_question_123");
            assert_eq!(question.session_id, "session-ask");
            assert_eq!(question.json_rpc_request_id, Some(1));
        }
        other => panic!("expected question request, got {:?}", other),
    }
}

#[tokio::test]
async fn annotate_pending_question_request_creates_stream_only_state() {
    let bridge = PermissionBridge::new();
    let pending_questions = Arc::new(Mutex::new(HashMap::new()));
    let mut update = SessionUpdate::QuestionRequest {
        question: QuestionData {
            id: "toolu_stream_only".to_string(),
            session_id: "session-stream".to_string(),
            json_rpc_request_id: None,
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::http(
                "toolu_stream_only",
            )),
            questions: vec![QuestionItem {
                question: "Pick one".to_string(),
                header: "Pick one".to_string(),
                options: vec![],
                multi_select: false,
            }],
            tool: Some(ToolReference {
                message_id: None,
                call_id: "toolu_stream_only".to_string(),
            }),
        },
        session_id: Some("session-stream".to_string()),
    };

    let should_emit =
        annotate_pending_question_request(&bridge, &pending_questions, &mut update).await;

    assert!(should_emit);

    let state = pending_questions
        .lock()
        .await
        .get("toolu_stream_only")
        .cloned()
        .expect("stream-only question state should exist");
    assert_eq!(state.request_id, 0);
    assert!(state.ui_emitted);

    match update {
        SessionUpdate::QuestionRequest { question, .. } => {
            assert_eq!(question.json_rpc_request_id, None);
        }
        other => panic!("expected question request, got {:?}", other),
    }
}

#[tokio::test]
async fn can_use_tool_does_not_duplicate_stream_emitted_question_request() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let tracker = Arc::new(ToolCallIdTracker::new());
    let pending_questions = Arc::new(Mutex::new(HashMap::new()));
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    tracker
        .record(
            "AskUserQuestion".to_string(),
            "toolu_question_existing".to_string(),
        )
        .await;

    pending_questions.lock().await.insert(
        "toolu_question_existing".to_string(),
        PendingQuestionState {
            request_id: 0,
            session_id: "session-ask".to_string(),
            questions: Some(vec![QuestionItem {
                question: "Which branch should I use?".to_string(),
                header: "Branch".to_string(),
                options: vec![],
                multi_select: false,
            }]),
            ui_emitted: true,
        },
    );

    let handler = AcepePermissionHandler {
        session_id: "session-ask".to_string(),
        agent_type: provider.parser_agent_type(),
        bridge: bridge.clone(),
        dispatcher,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        db: None,
        session_policy: Arc::new(SessionPolicyRegistry::new()),
        tool_call_tracker: tracker,
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        pending_questions: pending_questions.clone(),
    };

    let resolver_bridge = bridge.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(5)).await;
        resolver_bridge
            .resolve(
                1,
                cc_sdk::PermissionResult::Allow(cc_sdk::PermissionResultAllow {
                    updated_input: Some(serde_json::json!({
                        "questions": [{
                            "question": "Which branch should I use?",
                            "header": "Branch",
                            "options": [],
                            "multiSelect": false
                        }],
                        "answers": { "Which branch should I use?": "main" }
                    })),
                    updated_permissions: None,
                }),
            )
            .await;
    });

    let context = cc_sdk::ToolPermissionContext {
        signal: None,
        suggestions: Vec::new(),
    };

    let result = handler
        .can_use_tool(
            "AskUserQuestion",
            &serde_json::json!({
                "questions": [{
                    "question": "Which branch should I use?",
                    "header": "Branch",
                    "options": [],
                    "multiSelect": false
                }]
            }),
            &context,
        )
        .await;

    assert!(matches!(result, cc_sdk::PermissionResult::Allow(_)));
    assert!(sink.lock().expect("sink lock").is_empty());

    let state = pending_questions
        .lock()
        .await
        .get("toolu_question_existing")
        .cloned()
        .expect("question state should still exist until respond removes it");
    assert_eq!(state.request_id, 1);
}

#[tokio::test]
async fn suppresses_stale_agent_chunks_while_stream_only_question_is_pending() {
    let pending_questions = Arc::new(Mutex::new(HashMap::from([(
        "toolu_question_existing".to_string(),
        PendingQuestionState {
            request_id: 0,
            session_id: "session-ask".to_string(),
            questions: Some(vec![QuestionItem {
                question: "Which branch should I use?".to_string(),
                header: "Branch".to_string(),
                options: vec![],
                multi_select: false,
            }]),
            ui_emitted: true,
        },
    )])));

    let should_suppress = should_suppress_update_while_awaiting_stream_only_question(
        &pending_questions,
        "session-ask",
        &SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "There you go!".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some("session-ask".to_string()),
            produced_at_monotonic_ms: None,
        },
    )
    .await;

    assert!(should_suppress);
}

#[tokio::test]
async fn reply_question_waits_for_late_request_binding() {
    let mut client = make_test_client();
    let pending_questions = client.pending_questions.clone();
    let bridge = client.permission_bridge.clone();
    let questions = vec![QuestionItem {
        question: "Which branch should I use?".to_string(),
        header: "Branch".to_string(),
        options: vec![],
        multi_select: false,
    }];

    pending_questions.lock().await.insert(
        "toolu_question_existing".to_string(),
        PendingQuestionState {
            request_id: 0,
            session_id: "session-ask".to_string(),
            questions: Some(questions.clone()),
            ui_emitted: true,
        },
    );

    let binding_task = tokio::spawn({
        let pending_questions = pending_questions.clone();
        let bridge = bridge.clone();
        let questions = questions.clone();

        async move {
            tokio::time::sleep(Duration::from_millis(5)).await;

            let request_id = bridge.next_id();
            let registration = bridge
                .register(
                    request_id,
                    PendingPermissionKind::Question {
                        tool_call_id: "toolu_question_existing".to_string(),
                        original_input: serde_json::json!({
                            "questions": [{
                                "question": "Which branch should I use?",
                                "header": "Branch",
                                "options": [],
                                "multiSelect": false
                            }]
                        }),
                    },
                )
                .await;

            pending_questions.lock().await.insert(
                "toolu_question_existing".to_string(),
                PendingQuestionState {
                    request_id,
                    session_id: "session-ask".to_string(),
                    questions: Some(questions),
                    ui_emitted: true,
                },
            );

            let resolved = timeout(Duration::from_millis(50), registration.receiver)
                .await
                .expect("late question binding should resolve")
                .expect("question resolution channel closed");

            match resolved {
                cc_sdk::PermissionResult::Allow(allow) => allow.updated_input,
                other => panic!("expected allow result, got {:?}", other),
            }
        }
    });

    assert!(client
        .reply_question(
            "toolu_question_existing".to_string(),
            vec![vec!["main".to_string()]],
        )
        .await
        .expect("reply_question should bind to the late request"));

    let updated_input = binding_task.await.expect("binding task should complete");

    assert_eq!(
        updated_input,
        Some(serde_json::json!({
            "questions": [{
                "question": "Which branch should I use?",
                "header": "Branch",
                "options": [],
                "multiSelect": false
            }],
            "answers": {
                "Which branch should I use?": "main"
            }
        }))
    );
    assert!(pending_questions.lock().await.is_empty());
}

#[tokio::test]
async fn keeps_question_tool_updates_visible_while_stream_only_question_is_pending() {
    let pending_questions = Arc::new(Mutex::new(HashMap::from([(
        "toolu_question_existing".to_string(),
        PendingQuestionState {
            request_id: 0,
            session_id: "session-ask".to_string(),
            questions: Some(vec![QuestionItem {
                question: "Which branch should I use?".to_string(),
                header: "Branch".to_string(),
                options: vec![],
                multi_select: false,
            }]),
            ui_emitted: true,
        },
    )])));

    let should_suppress = should_suppress_update_while_awaiting_stream_only_question(
        &pending_questions,
        "session-ask",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "toolu_question_existing".to_string(),
                status: Some(ToolCallStatus::InProgress),
                ..Default::default()
            },
            session_id: Some("session-ask".to_string()),
        },
    )
    .await;

    assert!(!should_suppress);
}

#[test]
fn build_question_reply_text_formats_stream_only_follow_up_message() {
    let questions = vec![
        QuestionItem {
            question: "Area?".to_string(),
            header: "Area".to_string(),
            options: vec![],
            multi_select: false,
        },
        QuestionItem {
            question: "Priority?".to_string(),
            header: "Priority".to_string(),
            options: vec![],
            multi_select: true,
        },
    ];

    let reply_text = build_question_reply_text(
        &questions,
        &[
            vec!["Performance".to_string()],
            vec!["Caching".to_string(), "Rendering".to_string()],
        ],
    );

    assert_eq!(
            reply_text,
            "The user answered the questions:\n- \"Area?\": \"Performance\"\n- \"Priority?\": \"Caching, Rendering\""
        );
}

#[test]
fn reconciles_cc_sdk_subagent_children_under_parent_task() {
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let task_reconciler = Arc::new(std::sync::Mutex::new(
        crate::acp::task_reconciler::TaskReconciler::new(),
    ));

    let parent_outputs = collect_cc_sdk_updates_for_dispatch(
        &make_task_tool_call("toolu_task_parent"),
        &task_reconciler,
        &provider,
    );
    let enriched_outputs = collect_cc_sdk_updates_for_dispatch(
        &make_enriched_task_tool_call("toolu_task_parent"),
        &task_reconciler,
        &provider,
    );
    let bash_outputs = collect_cc_sdk_updates_for_dispatch(
        &make_child_tool_call("toolu_child_bash", "Bash", ToolKind::Execute),
        &task_reconciler,
        &provider,
    );
    let glob_outputs = collect_cc_sdk_updates_for_dispatch(
        &make_child_tool_call("toolu_child_glob", "Glob", ToolKind::Glob),
        &task_reconciler,
        &provider,
    );
    let read_outputs = collect_cc_sdk_updates_for_dispatch(
        &make_child_tool_call("toolu_child_read", "Read", ToolKind::Read),
        &task_reconciler,
        &provider,
    );

    assert_eq!(parent_outputs.len(), 1);
    assert_eq!(enriched_outputs.len(), 1);
    assert_eq!(bash_outputs.len(), 1);
    assert_eq!(glob_outputs.len(), 1);
    assert_eq!(read_outputs.len(), 1);

    let final_parent = read_outputs
        .iter()
        .find_map(|update| match update {
            SessionUpdate::ToolCall { tool_call, .. } => Some(tool_call),
            _ => None,
        })
        .expect("expected reconciled parent tool call");

    let task_children = final_parent
        .task_children
        .as_ref()
        .expect("expected task children on parent task");
    assert_eq!(task_children.len(), 3);
    assert_eq!(task_children[0].id, "toolu_child_bash");
    assert_eq!(task_children[1].id, "toolu_child_glob");
    assert_eq!(task_children[2].id, "toolu_child_read");

    match &final_parent.arguments {
        ToolArguments::Think {
            description,
            prompt,
            subagent_type,
            ..
        } => {
            assert_eq!(
                description.as_deref(),
                Some("Find all tool call components")
            );
            assert_eq!(
                prompt.as_deref(),
                Some("Inventory tool call cards in the codebase")
            );
            assert_eq!(subagent_type.as_deref(), Some("Explore"));
        }
        other => panic!("expected think arguments, got {:?}", other),
    }
}

#[test]
fn passes_through_non_task_cc_sdk_tool_calls_without_task_children() {
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let task_reconciler = Arc::new(std::sync::Mutex::new(
        crate::acp::task_reconciler::TaskReconciler::new(),
    ));

    let outputs = collect_cc_sdk_updates_for_dispatch(
        &SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "toolu_standalone_read".to_string(),
                name: "Read".to_string(),
                arguments: ToolArguments::Read {
                    file_path: Some("/tmp/file.rs".to_string()),
                    source_context: None,
                },
                diagnostic_input: None,
                status: ToolCallStatus::InProgress,
                result: None,
                kind: Some(ToolKind::Read),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-1".to_string()),
        },
        &task_reconciler,
        &provider,
    );

    assert_eq!(outputs.len(), 1);
    let tool_call = match &outputs[0] {
        SessionUpdate::ToolCall { tool_call, .. } => tool_call,
        other => panic!("expected tool call output, got {:?}", other),
    };
    assert!(tool_call.task_children.is_none());
    assert_eq!(tool_call.kind, Some(ToolKind::Read));
}

#[test]
fn dispatch_cc_sdk_update_emits_single_passthrough_event_for_non_task_tools() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let task_reconciler = Arc::new(std::sync::Mutex::new(
        crate::acp::task_reconciler::TaskReconciler::new(),
    ));

    dispatch_cc_sdk_update(
        &dispatcher,
        &task_reconciler,
        &provider,
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "toolu_single_emit".to_string(),
                name: "Read".to_string(),
                arguments: ToolArguments::Read {
                    file_path: Some("/tmp/file.rs".to_string()),
                    source_context: None,
                },
                diagnostic_input: None,
                status: ToolCallStatus::InProgress,
                result: None,
                kind: Some(ToolKind::Read),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let captured = sink.lock().expect("sink lock");
    let session_updates: Vec<_> = captured
        .iter()
        .filter(|e| {
            matches!(
                e.payload,
                crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(_)
            )
        })
        .collect();
    assert_eq!(session_updates.len(), 1);
    let event = session_updates[0];
    let update = match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => update,
        other => panic!("expected session update payload, got {:?}", other),
    };
    match update.as_ref() {
        SessionUpdate::ToolCall { tool_call, .. } => {
            assert_eq!(tool_call.id, "toolu_single_emit");
            assert!(tool_call.task_children.is_none());
        }
        other => panic!("expected tool call update, got {:?}", other),
    }
}

#[test]
fn dispatch_cc_sdk_update_drops_update_without_session_identity() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let task_reconciler = Arc::new(std::sync::Mutex::new(
        crate::acp::task_reconciler::TaskReconciler::new(),
    ));

    dispatch_cc_sdk_update(
        &dispatcher,
        &task_reconciler,
        &provider,
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "toolu_missing_session".to_string(),
                name: "Read".to_string(),
                arguments: ToolArguments::Read {
                    file_path: Some("/tmp/file.rs".to_string()),
                    source_context: None,
                },
                diagnostic_input: None,
                status: ToolCallStatus::InProgress,
                result: None,
                kind: Some(ToolKind::Read),
                title: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: None,
        },
    );

    let captured = sink.lock().expect("sink lock");
    assert!(captured.is_empty());
}

#[tokio::test]
async fn reset_stream_runtime_state_clears_tracker_and_reconciler() {
    let mut client = make_test_client();

    client
        .tool_call_tracker
        .record("Bash".to_string(), "toolu_old".to_string())
        .await;
    client
        .approval_callback_tracker
        .note_tool_use_started("session-1", "Bash", "toolu_old")
        .await;

    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let _ = collect_cc_sdk_updates_for_dispatch(
        &make_task_tool_call("toolu_task_parent"),
        &client.task_reconciler,
        &provider,
    );
    let child_outputs = collect_cc_sdk_updates_for_dispatch(
        &make_child_tool_call("toolu_child_orphan", "Bash", ToolKind::Execute),
        &client.task_reconciler,
        &provider,
    );

    assert!(matches!(
        &child_outputs[0],
        SessionUpdate::ToolCall { tool_call, .. } if tool_call.id == "toolu_task_parent"
    ));

    client.reset_stream_runtime_state();

    assert!(client.tool_call_tracker.take("Bash").await.is_none());
    assert!(client
        .approval_callback_tracker
        .pending
        .lock()
        .await
        .is_empty());

    let outputs_after_reset = collect_cc_sdk_updates_for_dispatch(
        &SessionUpdate::ToolCallUpdate {
            update: crate::acp::session_update::ToolCallUpdateData {
                tool_call_id: "toolu_child_orphan".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: Some(serde_json::json!({"ok": true})),
                title: None,
                content: None,
                streaming_input_delta: None,
                streaming_arguments: None,
                streaming_plan: None,
                raw_output: None,
                locations: None,
                arguments: None,
                failure_reason: None,
                normalized_questions: None,
                normalized_todos: None,
            },
            session_id: Some("session-1".to_string()),
        },
        &client.task_reconciler,
        &provider,
    );

    assert_eq!(outputs_after_reset.len(), 1);
    match &outputs_after_reset[0] {
        SessionUpdate::ToolCallUpdate { update, .. } => {
            assert_eq!(update.tool_call_id, "toolu_child_orphan");
        }
        other => panic!("expected passthrough tool call update, got {:?}", other),
    }
}

#[test]
fn translated_cc_sdk_stream_sequence_emits_parent_with_task_children() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = crate::acp::providers::claude_code::ClaudeCodeProvider;
    let task_reconciler = Arc::new(std::sync::Mutex::new(
        crate::acp::task_reconciler::TaskReconciler::new(),
    ));
    let mut turn_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();

    let messages = vec![
        cc_sdk::Message::StreamEvent {
            uuid: "msg-parent-start".to_string(),
            session_id: "session-1".to_string(),
            event: serde_json::json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": {
                    "type": "tool_use",
                    "id": "toolu_task_parent",
                    "name": "Agent",
                    "input": {}
                }
            }),
            parent_tool_use_id: None,
        },
        cc_sdk::Message::Assistant {
            message: cc_sdk::AssistantMessage {
                content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                    id: "toolu_task_parent".to_string(),
                    name: "Agent".to_string(),
                    input: serde_json::json!({
                        "description": "Find all tool call components",
                        "prompt": "Inventory tool call cards in the codebase",
                        "subagent_type": "Explore"
                    }),
                })],
                model: Some("claude-opus-4-6".to_string()),
                usage: None,
                error: None,
                parent_tool_use_id: None,
            },
        },
        cc_sdk::Message::Assistant {
            message: cc_sdk::AssistantMessage {
                content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                    id: "toolu_child_bash".to_string(),
                    name: "Bash".to_string(),
                    input: serde_json::json!({"command": "ls -1"}),
                })],
                model: Some("claude-haiku-4-5-20251001".to_string()),
                usage: None,
                error: None,
                parent_tool_use_id: Some("toolu_task_parent".to_string()),
            },
        },
        cc_sdk::Message::Assistant {
            message: cc_sdk::AssistantMessage {
                content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                    id: "toolu_child_read".to_string(),
                    name: "Read".to_string(),
                    input: serde_json::json!({"file_path": "/tmp/project/file.svelte"}),
                })],
                model: Some("claude-haiku-4-5-20251001".to_string()),
                usage: None,
                error: None,
                parent_tool_use_id: Some("toolu_task_parent".to_string()),
            },
        },
    ];

    for message in messages {
        let updates = crate::acp::parsers::cc_sdk_bridge::translate_cc_sdk_message_with_turn_state(
            crate::acp::parsers::AgentType::ClaudeCode,
            message,
            Some("session-1".to_string()),
            turn_state.clone(),
        );

        for update in updates {
            if matches!(
                update,
                SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }
            ) {
                let preserved_model = turn_state.model_id.clone();
                turn_state = crate::acp::parsers::cc_sdk_bridge::CcSdkTurnStreamState::default();
                turn_state.model_id = preserved_model;
            }
            dispatch_cc_sdk_update(&dispatcher, &task_reconciler, &provider, update);
        }
    }

    let captured = sink.lock().expect("sink lock");
    let final_parent = captured
        .iter()
        .rev()
        .find_map(|event| match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
                match update.as_ref() {
                    SessionUpdate::ToolCall { tool_call, .. }
                        if tool_call.id == "toolu_task_parent" =>
                    {
                        Some(tool_call)
                    }
                    _ => None,
                }
            }
            _ => None,
        })
        .expect("expected parent task in captured session updates");

    let task_children = final_parent
        .task_children
        .as_ref()
        .expect("expected task children on final parent task");
    assert_eq!(task_children.len(), 2);
    assert_eq!(task_children[0].id, "toolu_child_bash");
    assert_eq!(task_children[1].id, "toolu_child_read");

    match &final_parent.arguments {
        ToolArguments::Think {
            description,
            prompt,
            subagent_type,
            ..
        } => {
            assert_eq!(
                description.as_deref(),
                Some("Find all tool call components")
            );
            assert_eq!(
                prompt.as_deref(),
                Some("Inventory tool call cards in the codebase")
            );
            assert_eq!(subagent_type.as_deref(), Some("Explore"));
        }
        other => panic!("expected think arguments, got {:?}", other),
    }
}

#[test]
fn production_client_source_does_not_translate_input_json_delta_inline() {
    let source = [include_str!("mod.rs"), include_str!("streaming_bridge.rs")].join("\n");
    let production_source = source.split("#[cfg(test)]").next().unwrap_or(&source);

    assert!(
            !production_source.contains("if delta_type == \"input_json_delta\""),
            "cc_sdk_client should not own Claude input_json_delta translation once the provider edge is canonical"
        );
}

#[test]
fn production_client_source_does_not_read_tool_input_from_raw_content_block_start() {
    let source = [include_str!("mod.rs"), include_str!("streaming_bridge.rs")].join("\n");
    let production_source = source.split("#[cfg(test)]").next().unwrap_or(&source);

    assert!(
            !production_source.contains("block.get(\"input\")"),
            "cc_sdk_client should consume canonical tool raw_input from ToolCall events instead of reading raw content_block_start payloads"
        );
}

#[test]
fn production_client_source_does_not_own_tool_turn_resume_state() {
    let source = [include_str!("mod.rs"), include_str!("streaming_bridge.rs")].join("\n");
    let production_source = source.split("#[cfg(test)]").next().unwrap_or(&source);

    assert!(
        !production_source.contains("awaiting_tool_turn_resume"),
        "cc_sdk_client should not own Claude message_delta/message_start tool-turn resume state"
    );
}

#[tokio::test]
async fn run_streaming_bridge_completes_unresolved_tool_use_when_next_message_starts() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);
    let context = StreamingBridgeContext {
        dispatcher,
        bridge: Arc::new(PermissionBridge::new()),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        provider,
        db: None,
        app_handle: None,
        pending_creation_attempt_id: None,
        project_path: None,
    };

    let stream = futures::stream::iter(vec![
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "msg-start-1".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({
                "type": "message_start",
                "message": {
                    "content": [],
                    "model": "claude-sonnet-4-6"
                }
            }),
            parent_tool_use_id: None,
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "tool-start".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": {
                    "type": "tool_use",
                    "id": "toolu_search_stuck",
                    "name": "ToolSearch",
                    "input": {}
                }
            }),
            parent_tool_use_id: None,
        }),
        Ok(cc_sdk::Message::Assistant {
            message: cc_sdk::AssistantMessage {
                content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                    id: "toolu_search_stuck".to_string(),
                    name: "ToolSearch".to_string(),
                    input: serde_json::json!({
                        "query": "select:AskUserQuestion",
                        "max_results": 1
                    }),
                })],
                model: Some("claude-sonnet-4-6".to_string()),
                usage: None,
                error: None,
                parent_tool_use_id: None,
            },
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "message-delta-tool-use".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({
                "type": "message_delta",
                "delta": {
                    "stop_reason": "tool_use",
                    "stop_sequence": null
                }
            }),
            parent_tool_use_id: None,
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "message-stop-tool-use".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({ "type": "message_stop" }),
            parent_tool_use_id: None,
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "msg-start-2".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({
                "type": "message_start",
                "message": {
                    "content": [],
                    "model": "claude-sonnet-4-6"
                }
            }),
            parent_tool_use_id: None,
        }),
    ]);

    run_streaming_bridge(stream, "session-bridge".to_string(), context).await;

    let captured = sink.lock().expect("sink lock");
    let has_completion = captured.iter().any(|event| match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
            matches!(
                update.as_ref(),
                SessionUpdate::ToolCallUpdate { update, .. }
                    if update.tool_call_id == "toolu_search_stuck"
                        && update.status == Some(ToolCallStatus::Completed)
            )
        }
        _ => false,
    });

    assert!(
        has_completion,
        "expected the next assistant message_start to settle the prior ToolSearch call"
    );
}

#[tokio::test]
async fn run_streaming_bridge_promotes_pending_creation_attempt_before_buffered_dispatch() {
    let db = setup_test_db().await;
    let attempt =
        SessionMetadataRepository::create_creation_attempt(&db, "/project", "claude-code", None, None, None)
            .await
            .expect("attempt");
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);
    let context = StreamingBridgeContext {
        dispatcher,
        bridge: Arc::new(PermissionBridge::new()),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        provider,
        db: Some(db.clone()),
        app_handle: None,
        pending_creation_attempt_id: Some(attempt.id.clone()),
        project_path: None,
    };

    let stream = futures::stream::iter(vec![
        Ok(cc_sdk::Message::Assistant {
            message: cc_sdk::AssistantMessage {
                content: vec![cc_sdk::ContentBlock::Text(cc_sdk::TextContent {
                    text: "Buffered before provider id".to_string(),
                })],
                model: None,
                usage: None,
                error: None,
                parent_tool_use_id: None,
            },
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "identity".to_string(),
            session_id: "provider-canonical".to_string(),
            event: serde_json::json!({ "type": "message_start", "message": { "content": [] } }),
            parent_tool_use_id: None,
        }),
    ]);

    run_streaming_bridge(stream, "provider-canonical".to_string(), context).await;

    let row = SessionMetadataRepository::get_by_id(&db, "provider-canonical")
        .await
        .expect("load metadata")
        .expect("promoted metadata");
    assert_eq!(row.history_session_id(), "provider-canonical");

    let captured = sink.lock().expect("sink lock");
    let session_updates = captured
        .iter()
        .filter_map(|event| match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
                Some(update.as_ref())
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert!(
            matches!(
                session_updates.first(),
                Some(SessionUpdate::ConnectionComplete { session_id, .. })
                    if session_id == "provider-canonical"
            ),
            "deferred Claude creation must publish connectionComplete before buffered transcript updates"
        );
    assert!(session_updates
        .iter()
        .any(|update| matches!(update, SessionUpdate::AgentMessageChunk { .. })));
}

#[tokio::test]
async fn promote_verified_pending_creation_attempt_reuses_reserved_lifecycle_checkpoint() {
    let db = setup_test_db().await;
    let session_id = "provider-canonical";
    let attempt =
        SessionMetadataRepository::create_creation_attempt(&db, "/project", "claude-code", None, None, None)
            .await
            .expect("attempt");
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
    let seeded = supervisor.seed_checkpoint(
        session_id.to_string(),
        crate::acp::lifecycle::LifecycleCheckpoint::new(
            1,
            crate::acp::lifecycle::LifecycleState::reserved(),
            crate::acp::session_state_engine::SessionGraphCapabilities::empty(),
        ),
    );
    assert!(seeded, "reserved first-send checkpoint should be seeded");

    SessionMetadataRepository::promote_creation_attempt(&db, &attempt.id, session_id)
        .await
        .expect("promote metadata");
    reserve_promoted_claude_session(
        supervisor.as_ref(),
        &db,
        projection_registry.as_ref(),
        session_id,
        crate::acp::session_state_engine::SessionGraphCapabilities::empty(),
    )
    .await
    .expect("reserved checkpoint should satisfy promotion");

    let row = SessionMetadataRepository::get_by_id(&db, session_id)
        .await
        .expect("load metadata")
        .expect("promoted metadata");
    assert_eq!(row.history_session_id(), session_id);
    assert_eq!(
        supervisor
            .snapshot_for_session(session_id)
            .expect("checkpoint remains")
            .lifecycle
            .status,
        LifecycleStatus::Reserved
    );
}

#[tokio::test]
async fn reserve_promoted_claude_session_preserves_capabilities() {
    let db = setup_test_db().await;
    let session_id = "provider-canonical";
    let attempt =
        SessionMetadataRepository::create_creation_attempt(&db, "/project", "claude-code", None, None, None)
            .await
            .expect("attempt");
    SessionMetadataRepository::promote_creation_attempt(&db, &attempt.id, session_id)
        .await
        .expect("promote metadata");
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
    let mut models = default_session_model_state();
    models.current_model_id = Some("claude-opus-4-7".to_string());
    let mut modes = default_modes();
    modes.current_mode_id = "plan".to_string();
    let capabilities = SessionGraphCapabilities {
        models: Some(models),
        modes: Some(modes),
        available_commands: Some(Vec::new()),
        config_options: Some(Vec::new()),
        autonomous_enabled: Some(true),
    };

    reserve_promoted_claude_session(
        supervisor.as_ref(),
        &db,
        projection_registry.as_ref(),
        session_id,
        capabilities,
    )
    .await
    .expect("promoted session should reserve");

    let checkpoint = supervisor
        .snapshot_for_session(session_id)
        .expect("checkpoint exists");
    assert_eq!(checkpoint.lifecycle.status, LifecycleStatus::Reserved);
    assert_eq!(
        checkpoint
            .capabilities
            .models
            .expect("models preserved")
            .current_model_id,
        Some("claude-opus-4-7".to_string())
    );
    assert_eq!(
        checkpoint
            .capabilities
            .modes
            .expect("modes preserved")
            .current_mode_id,
        "plan"
    );
    assert_eq!(checkpoint.capabilities.autonomous_enabled, Some(true));
}

#[tokio::test]
async fn run_streaming_bridge_promotes_pending_creation_before_buffered_auth_error() {
    let db = setup_test_db().await;
    let attempt =
        SessionMetadataRepository::create_creation_attempt(&db, "/project", "claude-code", None, None, None)
            .await
            .expect("attempt");
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);
    let context = StreamingBridgeContext {
        dispatcher,
        bridge: Arc::new(PermissionBridge::new()),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        provider,
        db: Some(db.clone()),
        app_handle: None,
        pending_creation_attempt_id: Some(attempt.id.clone()),
        project_path: None,
    };

    let stream = futures::stream::iter(vec![
            Ok(cc_sdk::Message::Assistant {
                message: cc_sdk::AssistantMessage {
                    content: vec![cc_sdk::ContentBlock::Text(cc_sdk::TextContent {
                        text: "Failed to authenticate. API Error: 401 {\"error\":{\"message\":\"User not found.\",\"code\":401}}".to_string(),
                    })],
                    model: None,
                    usage: None,
                    error: Some(cc_sdk::AssistantMessageError::AuthenticationFailed),
                    parent_tool_use_id: None,
                },
            }),
            Ok(cc_sdk::Message::Result {
                subtype: "success".to_string(),
                duration_ms: 100,
                duration_api_ms: 100,
                is_error: false,
                num_turns: 1,
                session_id: "provider-canonical".to_string(),
                total_cost_usd: None,
                usage: None,
                model_usage: None,
                result: None,
                structured_output: None,
                stop_reason: None,
            }),
        ]);

    run_streaming_bridge(stream, "provider-canonical".to_string(), context).await;

    let row = SessionMetadataRepository::get_by_id(&db, "provider-canonical")
        .await
        .expect("load metadata")
        .expect("promoted metadata");
    assert_eq!(row.history_session_id(), "provider-canonical");

    let captured = sink.lock().expect("sink lock");
    assert!(captured.iter().any(|event| match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
            matches!(
                update.as_ref(),
                SessionUpdate::TurnError {
                    error: TurnErrorData::Structured(payload),
                    ..
                } if payload.message.contains("Failed to authenticate")
                    && payload.message.contains("User not found")
                    && payload.kind == TurnErrorKind::Fatal
                    && payload.source == Some(TurnErrorSource::Transport)
            )
        }
        _ => false,
    }));
    assert!(!captured.iter().any(|event| match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
            matches!(update.as_ref(), SessionUpdate::TurnComplete { .. })
        }
        _ => false,
    }));
}

#[tokio::test]
async fn run_streaming_bridge_fails_pending_creation_attempt_on_provider_id_mismatch() {
    let db = setup_test_db().await;
    let attempt =
        SessionMetadataRepository::create_creation_attempt(&db, "/project", "claude-code", None, None, None)
            .await
            .expect("attempt");
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);
    let context = StreamingBridgeContext {
        dispatcher,
        bridge: Arc::new(PermissionBridge::new()),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        provider,
        db: Some(db.clone()),
        app_handle: None,
        pending_creation_attempt_id: Some(attempt.id.clone()),
        project_path: None,
    };

    let stream = futures::stream::iter(vec![Ok(cc_sdk::Message::StreamEvent {
        uuid: "identity".to_string(),
        session_id: "different-provider-id".to_string(),
        event: serde_json::json!({ "type": "message_start", "message": { "content": [] } }),
        parent_tool_use_id: None,
    })]);

    run_streaming_bridge(stream, "requested-provider-id".to_string(), context).await;

    assert!(
        SessionMetadataRepository::get_by_id(&db, "requested-provider-id")
            .await
            .expect("load metadata")
            .is_none()
    );
    let failed_attempt = SessionMetadataRepository::get_creation_attempt(&db, &attempt.id)
        .await
        .expect("load attempt")
        .expect("attempt");
    assert_eq!(
        failed_attempt.status,
        CreationAttemptStatus::Failed.as_str()
    );

    let captured = sink.lock().expect("sink lock");
    assert!(captured.iter().any(|event| match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
            matches!(update.as_ref(), SessionUpdate::TurnError { .. })
        }
        _ => false,
    }));
}

#[tokio::test]
async fn run_streaming_bridge_completes_unresolved_assistant_tool_use_without_raw_start() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);
    let context = StreamingBridgeContext {
        dispatcher,
        bridge: Arc::new(PermissionBridge::new()),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        provider,
        db: None,
        app_handle: None,
        pending_creation_attempt_id: None,
        project_path: None,
    };

    let stream = futures::stream::iter(vec![
        Ok(cc_sdk::Message::Assistant {
            message: cc_sdk::AssistantMessage {
                content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                    id: "toolu_search_assistant_only".to_string(),
                    name: "ToolSearch".to_string(),
                    input: serde_json::json!({
                        "query": "select:AskUserQuestion",
                        "max_results": 1
                    }),
                })],
                model: Some("claude-sonnet-4-6".to_string()),
                usage: None,
                error: None,
                parent_tool_use_id: None,
            },
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "message-delta-tool-use".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({
                "type": "message_delta",
                "delta": {
                    "stop_reason": "tool_use",
                    "stop_sequence": null
                }
            }),
            parent_tool_use_id: None,
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "message-stop-tool-use".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({ "type": "message_stop" }),
            parent_tool_use_id: None,
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "msg-start-2".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({
                "type": "message_start",
                "message": {
                    "content": [],
                    "model": "claude-sonnet-4-6"
                }
            }),
            parent_tool_use_id: None,
        }),
    ]);

    run_streaming_bridge(stream, "session-bridge".to_string(), context).await;

    let captured = sink.lock().expect("sink lock");
    let has_completion = captured.iter().any(|event| match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
            matches!(
                update.as_ref(),
                SessionUpdate::ToolCallUpdate { update, .. }
                    if update.tool_call_id == "toolu_search_assistant_only"
                        && update.status == Some(ToolCallStatus::Completed)
            )
        }
        _ => false,
    });

    assert!(
            has_completion,
            "expected assistant-only tool calls to be tracked for synthetic completion on the next message_start"
        );
}

#[tokio::test]
async fn run_streaming_bridge_completes_empty_bash_when_callback_never_arrives() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);
    let context = StreamingBridgeContext {
        dispatcher,
        bridge: Arc::new(PermissionBridge::new()),
        projection_registry: Arc::new(ProjectionRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        provider,
        db: None,
        app_handle: None,
        pending_creation_attempt_id: None,
        project_path: None,
    };

    let stream = futures::stream::iter(vec![
        Ok(cc_sdk::Message::Assistant {
            message: cc_sdk::AssistantMessage {
                content: vec![cc_sdk::ContentBlock::ToolUse(cc_sdk::ToolUseContent {
                    id: "toolu_bash_stuck".to_string(),
                    name: "Bash".to_string(),
                    input: serde_json::json!({
                        "command": "pwd"
                    }),
                })],
                model: Some("claude-sonnet-4-6".to_string()),
                usage: None,
                error: None,
                parent_tool_use_id: None,
            },
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "message-delta-tool-use".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({
                "type": "message_delta",
                "delta": {
                    "stop_reason": "tool_use",
                    "stop_sequence": null
                }
            }),
            parent_tool_use_id: None,
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "message-stop-tool-use".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({ "type": "message_stop" }),
            parent_tool_use_id: None,
        }),
        Ok(cc_sdk::Message::StreamEvent {
            uuid: "msg-start-2".to_string(),
            session_id: "provider-session".to_string(),
            event: serde_json::json!({
                "type": "message_start",
                "message": {
                    "content": [],
                    "model": "claude-sonnet-4-6"
                }
            }),
            parent_tool_use_id: None,
        }),
    ]);

    run_streaming_bridge(stream, "session-bridge".to_string(), context).await;

    let captured = sink.lock().expect("sink lock");
    let terminal_update = captured.iter().find_map(|event| match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
            match update.as_ref() {
                SessionUpdate::ToolCallUpdate { update, .. }
                    if update.tool_call_id == "toolu_bash_stuck" =>
                {
                    Some(update.clone())
                }
                _ => None,
            }
        }
        _ => None,
    });

    let completion = terminal_update.expect("expected a terminal bash tool update");
    assert_eq!(completion.status, Some(ToolCallStatus::Completed));
    assert_eq!(completion.failure_reason, None);
    assert_eq!(
            completion
                .result
                .as_ref()
                .and_then(|result| result.get("stderr"))
                .and_then(|value| value.as_str()),
            Some(
                "Result unavailable: the agent resumed after this tool call but did not provide stdout/stderr to Acepe."
            )
        );
}

#[tokio::test]
async fn terminal_updates_clear_pending_callback_diagnostics() {
    let tracker = ApprovalCallbackTracker::new();
    tracker
        .note_tool_use_started("session-bridge", "Bash", "toolu_bash_with_output")
        .await;

    let update = SessionUpdate::ToolCallUpdate {
        session_id: None,
        update: ToolCallUpdateData {
            tool_call_id: "toolu_bash_with_output".to_string(),
            status: Some(ToolCallStatus::Completed),
            result: Some(serde_json::json!({
                "stdout": "/tmp\n",
                "exitCode": 0
            })),
            ..Default::default()
        },
    };

    clear_pending_approval_callback_diagnostic_for_terminal_update(&tracker, &update).await;
    assert!(
        !tracker.clear_if_pending("toolu_bash_with_output").await,
        "real terminal payloads should clear pending callback diagnostics"
    );
}

#[tokio::test]
async fn run_streaming_bridge_rewrites_generic_turn_failed_after_permission_deny() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);
    let request_id = bridge.next_id();
    let registration = bridge
        .register_tool(
            request_id,
            ToolPermissionRequest {
                tool_call_id: "toolu_denied".to_string(),
                tool_name: "Bash".to_string(),
                reusable_approval_key: None,
                permission_suggestions: Vec::new(),
            },
        )
        .await;
    bridge
        .clear_request(request_id, "Permission denied by user")
        .await;
    let resolved = registration
        .receiver
        .await
        .expect("permission request should resolve");
    assert!(matches!(resolved, cc_sdk::PermissionResult::Deny(_)));

    let context = StreamingBridgeContext {
        dispatcher,
        bridge,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        provider,
        db: None,
        app_handle: None,
        pending_creation_attempt_id: None,
        project_path: None,
    };

    let stream = futures::stream::iter(vec![Ok(cc_sdk::Message::Result {
        subtype: "error_during_execution".to_string(),
        duration_ms: 1000,
        duration_api_ms: 500,
        is_error: true,
        num_turns: 1,
        session_id: "provider-session".to_string(),
        total_cost_usd: None,
        usage: None,
        model_usage: None,
        result: None,
        structured_output: None,
        stop_reason: Some("tool_use".to_string()),
    })]);

    run_streaming_bridge(stream, "session-bridge".to_string(), context).await;

    let captured = sink.lock().expect("sink lock");
    let turn_error = captured
        .iter()
        .find_map(|event| match &event.payload {
            crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
                match update.as_ref() {
                    SessionUpdate::TurnError { error, .. } => Some(error.clone()),
                    _ => None,
                }
            }
            _ => None,
        })
        .expect("expected turn error update");

    match turn_error {
        TurnErrorData::Structured(payload) => {
            assert_eq!(payload.message, "Permission denied by user");
            assert_eq!(payload.kind, TurnErrorKind::Recoverable);
        }
        TurnErrorData::Legacy(message) => {
            panic!("expected structured deny message, got legacy {message}");
        }
    }
}

#[tokio::test]
async fn run_streaming_bridge_rewrites_generic_turn_failed_into_cancelled_after_interrupt() {
    let (dispatcher, sink) = AcpUiEventDispatcher::test_sink();
    let bridge = Arc::new(PermissionBridge::new());
    let provider = Arc::new(crate::acp::providers::claude_code::ClaudeCodeProvider);

    // A user pressed stop: cancel() marks the interrupt before the SDK emits its
    // terminal result. The SDK reacts to interrupt() by emitting a generic
    // is_error result, which must be normalized into a cancellation, not a failure.
    bridge.mark_cancel_requested().await;

    let context = StreamingBridgeContext {
        dispatcher,
        bridge,
        projection_registry: Arc::new(ProjectionRegistry::new()),
        tool_call_tracker: Arc::new(ToolCallIdTracker::new()),
        approval_callback_tracker: Arc::new(ApprovalCallbackTracker::new()),
        task_reconciler: Arc::new(std::sync::Mutex::new(TaskReconciler::new())),
        pending_questions: Arc::new(Mutex::new(HashMap::new())),
        provider,
        db: None,
        app_handle: None,
        pending_creation_attempt_id: None,
        project_path: None,
    };

    let stream = futures::stream::iter(vec![Ok(cc_sdk::Message::Result {
        subtype: "error_during_execution".to_string(),
        duration_ms: 1000,
        duration_api_ms: 500,
        is_error: true,
        num_turns: 1,
        session_id: "provider-session".to_string(),
        total_cost_usd: None,
        usage: None,
        model_usage: None,
        result: None,
        structured_output: None,
        stop_reason: Some("tool_use".to_string()),
    })]);

    run_streaming_bridge(stream, "session-bridge".to_string(), context).await;

    let captured = sink.lock().expect("sink lock");
    let saw_turn_error = captured.iter().any(|event| match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
            matches!(update.as_ref(), SessionUpdate::TurnError { .. })
        }
        _ => false,
    });
    assert!(
        !saw_turn_error,
        "a user-initiated interrupt must not surface as a turn failure"
    );

    let saw_turn_cancelled = captured.iter().any(|event| match &event.payload {
        crate::acp::ui_event_dispatcher::AcpUiEventPayload::SessionUpdate(update) => {
            matches!(update.as_ref(), SessionUpdate::TurnCancelled { .. })
        }
        _ => false,
    });
    assert!(
        saw_turn_cancelled,
        "an interrupt-induced generic failure must be normalized into a cancellation"
    );
}
