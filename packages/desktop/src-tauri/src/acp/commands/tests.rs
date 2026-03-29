use super::inbound_commands::respond_inbound_request_with_registry;
use super::*;
use crate::acp::client::{AvailableModel, ResumeSessionResponse, SessionModelState, SessionModes};
use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::InboundRequestResponder;
use crate::acp::commands::session_commands::{
    persist_session_metadata_for_cwd, session_metadata_context_from_cwd,
};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::types::CanonicalAgentId;
use crate::acp::ui_event_dispatcher::{AcpUiEventDispatcher, DispatchPolicy};
use crate::db::repository::SessionMetadataRepository;
use async_trait::async_trait;
use sea_orm::{Database, DbConn};
use sea_orm_migration::MigratorTrait;
use serde_json::json;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tempfile::tempdir;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

fn canonicalize_or_original_for_test(path: &std::path::Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

async fn setup_test_db() -> DbConn {
    let db = Database::connect("sqlite::memory:")
        .await
        .expect("Failed to connect to in-memory SQLite");

    crate::db::migrations::Migrator::up(&db, None)
        .await
        .expect("Failed to run migrations");

    db
}

#[test]
fn test_normalize_acp_path_no_change_needed() {
    // Normal absolute path should remain unchanged
    let path = "/Users/alex/project/src/file.ts";
    assert_eq!(normalize_acp_path(path), path);
}

#[test]
fn test_normalize_acp_path_fixes_duplicate_cwd() {
    // Path with duplicate cwd (cwd + "/" + absolute_path) should be normalized
    // The pattern: /cwd//cwd/subpath -> /cwd/subpath
    let path = "/Users/alex/project//Users/alex/project/src/file.ts";
    assert_eq!(normalize_acp_path(path), "/Users/alex/project/src/file.ts");
}

#[test]
fn test_normalize_acp_path_different_prefixes_no_change() {
    // If the prefixes don't match, this is NOT the duplicate cwd bug
    // so we should NOT normalize
    let path = "/some/path//different/absolute/path.ts";
    assert_eq!(normalize_acp_path(path), path);
}

#[test]
fn test_normalize_acp_path_relative_after_double_slash_no_change() {
    // If the part after // doesn't form a path that shares the original prefix,
    // don't change it
    let path = "/some/path//relative/path.ts";
    assert_eq!(normalize_acp_path(path), path);
}

#[test]
fn test_normalize_acp_path_empty() {
    // Empty path should remain empty
    let path = "";
    assert_eq!(normalize_acp_path(path), "");
}

#[test]
fn test_normalize_acp_path_single_slash() {
    // Path with single slash should remain unchanged
    let path = "/Users/alex/project/src/file.ts";
    assert_eq!(normalize_acp_path(path), path);
}

#[test]
fn test_normalize_acp_path_nested_duplicate() {
    // More complex case with nested paths
    let path = "/home/user/projects/myapp//home/user/projects/myapp/src/main.rs";
    assert_eq!(
        normalize_acp_path(path),
        "/home/user/projects/myapp/src/main.rs"
    );
}

#[test]
fn test_normalize_acp_path_triple_slash_no_change() {
    // Triple slash case - the part after // starts with /
    // so we don't modify it
    let path = "/some/path///other/path";
    assert_eq!(normalize_acp_path(path), path);
}

#[test]
fn validate_session_cwd_rejects_empty() {
    let result = validate_session_cwd("", ProjectAccessReason::SessionResume);
    assert!(result.is_err(), "empty cwd should be rejected");
}

#[test]
fn validate_session_cwd_rejects_whitespace() {
    let result = validate_session_cwd("   ", ProjectAccessReason::SessionResume);
    assert!(result.is_err(), "whitespace cwd should be rejected");
}

#[test]
fn validate_session_cwd_rejects_non_directory() {
    let temp = tempdir().expect("temp dir");
    let file_path = temp.path().join("file.txt");
    std::fs::write(&file_path, "content").expect("write file");

    let result = validate_session_cwd(
        file_path.to_string_lossy().as_ref(),
        ProjectAccessReason::SessionResume,
    );
    assert!(result.is_err(), "non-directory cwd should be rejected");
}

#[test]
fn validate_session_cwd_accepts_directory() {
    let temp = tempdir().expect("temp dir");
    let result = validate_session_cwd(
        temp.path().to_string_lossy().as_ref(),
        ProjectAccessReason::SessionResume,
    );

    assert!(result.is_ok(), "valid directory cwd should be accepted");
}

#[test]
fn session_metadata_context_from_cwd_returns_plain_project_for_normal_directory() {
    let temp = tempdir().expect("temp dir");
    let (project_path, worktree_path) = session_metadata_context_from_cwd(temp.path());

    assert_eq!(project_path, canonicalize_or_original_for_test(temp.path()));
    assert_eq!(worktree_path, None);
}

#[test]
fn session_metadata_context_from_cwd_returns_base_project_for_git_worktree() {
    let temp = tempdir().expect("temp dir");
    let repo_path = temp.path().join("repo");
    let worktree_path = temp.path().join("worktrees").join("feature-a");
    let gitdir_path = repo_path.join(".git").join("worktrees").join("feature-a");

    std::fs::create_dir_all(&gitdir_path).expect("create gitdir");
    std::fs::create_dir_all(&worktree_path).expect("create worktree");
    std::fs::write(
        worktree_path.join(".git"),
        format!("gitdir: {}\n", gitdir_path.display()),
    )
    .expect("write .git file");

    let (project_path, resolved_worktree_path) = session_metadata_context_from_cwd(&worktree_path);

    assert_eq!(project_path, repo_path.to_string_lossy());
    assert_eq!(
        resolved_worktree_path,
        Some(canonicalize_or_original_for_test(&worktree_path))
    );
}

#[tokio::test]
async fn persist_session_metadata_for_cwd_inserts_created_worktree_session() {
    let db = setup_test_db().await;
    let temp = tempdir().expect("temp dir");
    let repo_path = temp.path().join("repo");
    let worktree_path = temp.path().join("worktrees").join("feature-a");
    let gitdir_path = repo_path.join(".git").join("worktrees").join("feature-a");

    std::fs::create_dir_all(&gitdir_path).expect("create gitdir");
    std::fs::create_dir_all(&worktree_path).expect("create worktree");
    std::fs::write(
        worktree_path.join(".git"),
        format!("gitdir: {}\n", gitdir_path.display()),
    )
    .expect("write .git file");

    persist_session_metadata_for_cwd(
        &db,
        "session-worktree",
        &CanonicalAgentId::ClaudeCode,
        &worktree_path,
    )
    .await
    .expect("persist session metadata");

    let row = SessionMetadataRepository::get_by_id(&db, "session-worktree")
        .await
        .expect("load row")
        .expect("row should exist");

    assert_eq!(row.project_path, repo_path.to_string_lossy());
    assert_eq!(
        row.worktree_path,
        Some(canonicalize_or_original_for_test(&worktree_path))
    );
    assert_eq!(row.agent_id, "claude-code");
    assert!(row.is_transcript_pending());
}

#[tokio::test]
async fn persist_session_metadata_for_cwd_inserts_created_plain_project_session() {
    let db = setup_test_db().await;
    let temp = tempdir().expect("temp dir");

    persist_session_metadata_for_cwd(
        &db,
        "session-project",
        &CanonicalAgentId::ClaudeCode,
        temp.path(),
    )
    .await
    .expect("persist session metadata");

    let row = SessionMetadataRepository::get_by_id(&db, "session-project")
        .await
        .expect("load row")
        .expect("row should exist");

    assert_eq!(
        row.project_path,
        canonicalize_or_original_for_test(temp.path())
    );
    assert_eq!(row.worktree_path, None);
    assert_eq!(row.agent_id, "claude-code");
    assert!(row.is_transcript_pending());
}

#[cfg(target_os = "macos")]
#[test]
fn validate_session_cwd_rejects_home_directory_on_macos() {
    let home = dirs::home_dir().expect("home directory should exist");
    let result = validate_session_cwd(
        home.to_string_lossy().as_ref(),
        ProjectAccessReason::SessionResume,
    );

    assert!(
        result.is_err(),
        "home directory cwd should be rejected on macOS"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn validate_session_cwd_rejects_root_directory_on_macos() {
    let result = validate_session_cwd("/", ProjectAccessReason::SessionResume);
    assert!(
        result.is_err(),
        "root directory cwd should be rejected on macOS"
    );
}

#[tokio::test]
async fn resume_or_create_reuses_existing_client() {
    let session_registry = SessionRegistry::new();
    let session_id = "existing-session".to_string();
    let cwd = "/workspace/a".to_string();
    let agent_id = CanonicalAgentId::Cursor;

    let existing_state = MockClientState::new(false);
    session_registry.store(
        session_id.clone(),
        Box::new(MockAgentClient::new(existing_state.clone())),
        agent_id.clone(),
    );

    let existing_client_arc = session_registry
        .get(&session_id)
        .expect("existing client should be present");
    let factory_calls = Arc::new(AtomicUsize::new(0));

    let result =
        resume_or_create_session_client(&session_registry, session_id.clone(), cwd, agent_id, {
            let factory_calls = Arc::clone(&factory_calls);
            move || {
                let factory_calls = Arc::clone(&factory_calls);
                async move {
                    factory_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(Box::new(MockAgentClient::new(MockClientState::new(false)))
                        as Box<dyn AgentClient + Send + Sync + 'static>)
                }
            }
        })
        .await;

    assert!(result.is_ok(), "resume should succeed");
    assert_eq!(factory_calls.load(Ordering::SeqCst), 0);
    assert_eq!(existing_state.resume_calls.load(Ordering::SeqCst), 1);

    let stored_client_arc = session_registry
        .get(&session_id)
        .expect("stored client should still exist");
    assert!(Arc::ptr_eq(&existing_client_arc, &stored_client_arc));
}

#[tokio::test]
async fn resume_or_create_builds_client_when_missing() {
    let session_registry = SessionRegistry::new();
    let session_id = "new-session".to_string();
    let cwd = "/workspace/a".to_string();
    let agent_id = CanonicalAgentId::Cursor;

    let created_state = MockClientState::new(false);
    let factory_calls = Arc::new(AtomicUsize::new(0));

    let result =
        resume_or_create_session_client(&session_registry, session_id.clone(), cwd, agent_id, {
            let created_state = created_state.clone();
            let factory_calls = Arc::clone(&factory_calls);
            move || {
                let created_state = created_state.clone();
                let factory_calls = Arc::clone(&factory_calls);
                async move {
                    factory_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(Box::new(MockAgentClient::new(created_state))
                        as Box<dyn AgentClient + Send + Sync + 'static>)
                }
            }
        })
        .await;

    assert!(result.is_ok(), "resume should succeed");
    assert_eq!(factory_calls.load(Ordering::SeqCst), 1);
    assert_eq!(created_state.resume_calls.load(Ordering::SeqCst), 1);
    assert!(session_registry.contains(&session_id));
}

#[tokio::test]
async fn resume_or_create_does_not_store_client_when_new_resume_fails() {
    let session_registry = SessionRegistry::new();
    let session_id = "missing-session".to_string();
    let cwd = "/workspace/a".to_string();
    let agent_id = CanonicalAgentId::Cursor;

    let created_state = MockClientState::new(true);
    let factory_calls = Arc::new(AtomicUsize::new(0));

    let result =
        resume_or_create_session_client(&session_registry, session_id.clone(), cwd, agent_id, {
            let created_state = created_state.clone();
            let factory_calls = Arc::clone(&factory_calls);
            move || {
                let created_state = created_state.clone();
                let factory_calls = Arc::clone(&factory_calls);
                async move {
                    factory_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(Box::new(MockAgentClient::new(created_state))
                        as Box<dyn AgentClient + Send + Sync + 'static>)
                }
            }
        })
        .await;

    assert!(result.is_err(), "resume should fail");
    assert_eq!(factory_calls.load(Ordering::SeqCst), 1);
    assert_eq!(created_state.resume_calls.load(Ordering::SeqCst), 1);
    assert_eq!(created_state.stop_calls.load(Ordering::SeqCst), 0);
    assert!(
        !session_registry.contains(&session_id),
        "failed resume should not store a client"
    );
}

#[test]
fn session_metadata_created_rows_are_detected_as_pending_transcript() {
    let row = crate::db::repository::SessionMetadataRow {
        id: "session-placeholder".to_string(),
        display: "New Thread".to_string(),
        timestamp: 0,
        project_path: "/project".to_string(),
        agent_id: "claude-code".to_string(),
        file_path: "__worktree__/session-placeholder".to_string(),
        file_mtime: 0,
        file_size: 0,
        provider_session_id: None,
        worktree_path: None,
        pr_number: None,
    };

    assert!(row.is_transcript_pending());
}

#[test]
fn session_metadata_real_rows_are_resumable() {
    let row = crate::db::repository::SessionMetadataRow {
        id: "session-real".to_string(),
        display: "Real Session".to_string(),
        timestamp: 1704067200000,
        project_path: "/project".to_string(),
        agent_id: "claude-code".to_string(),
        file_path: "/project/session-real.jsonl".to_string(),
        file_mtime: 1704067200,
        file_size: 1024,
        provider_session_id: None,
        worktree_path: None,
        pr_number: None,
    };

    assert!(!row.is_transcript_pending());
}

#[test]
fn session_metadata_created_rows_with_worktree_context_are_resumable() {
    let temp = tempdir().expect("temp dir");
    let worktree_path = temp.path().to_string_lossy().to_string();

    let row = crate::db::repository::SessionMetadataRow {
        id: "session-worktree-placeholder".to_string(),
        display: "Worktree Session".to_string(),
        timestamp: 0,
        project_path: "/project".to_string(),
        agent_id: "opencode".to_string(),
        file_path: "__session_registry__/session-worktree-placeholder".to_string(),
        file_mtime: 0,
        file_size: 0,
        provider_session_id: None,
        worktree_path: Some(worktree_path),
        pr_number: None,
    };

    assert!(row.is_transcript_pending());
}

#[tokio::test]
async fn persist_session_metadata_for_multiple_worktree_sessions_uses_unique_created_session_paths()
{
    let db = setup_test_db().await;

    SessionMetadataRepository::ensure_exists(
        &db,
        "session-worktree-a",
        "/project",
        "claude-code",
        Some("/project/.worktrees/feature-a"),
    )
    .await
    .expect("insert first created worktree session");

    SessionMetadataRepository::ensure_exists(
        &db,
        "session-worktree-b",
        "/project",
        "claude-code",
        Some("/project/.worktrees/feature-b"),
    )
    .await
    .expect("insert second created worktree session");

    let first = SessionMetadataRepository::get_by_id(&db, "session-worktree-a")
        .await
        .expect("load first")
        .expect("first exists");
    let second = SessionMetadataRepository::get_by_id(&db, "session-worktree-b")
        .await
        .expect("load second")
        .expect("second exists");

    assert_eq!(first.file_path, "__session_registry__/session-worktree-a");
    assert_eq!(second.file_path, "__session_registry__/session-worktree-b");
    assert!(first.is_transcript_pending());
    assert!(second.is_transcript_pending());
}

#[tokio::test]
async fn resume_or_create_replaces_client_when_existing_resume_fails() {
    let session_registry = SessionRegistry::new();
    let session_id = "fallback-session".to_string();
    let cwd = "/workspace/a".to_string();
    let agent_id = CanonicalAgentId::Cursor;

    let failing_state = MockClientState::new(true);
    session_registry.store(
        session_id.clone(),
        Box::new(MockAgentClient::new(failing_state.clone())),
        agent_id.clone(),
    );
    let initial_client_arc = session_registry
        .get(&session_id)
        .expect("existing client should be present");

    let replacement_state = MockClientState::new(false);
    let factory_calls = Arc::new(AtomicUsize::new(0));

    let result =
        resume_or_create_session_client(&session_registry, session_id.clone(), cwd, agent_id, {
            let replacement_state = replacement_state.clone();
            let factory_calls = Arc::clone(&factory_calls);
            move || {
                let replacement_state = replacement_state.clone();
                let factory_calls = Arc::clone(&factory_calls);
                async move {
                    factory_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(Box::new(MockAgentClient::new(replacement_state))
                        as Box<dyn AgentClient + Send + Sync + 'static>)
                }
            }
        })
        .await;

    assert!(result.is_ok(), "fallback resume should succeed");
    assert_eq!(factory_calls.load(Ordering::SeqCst), 1);
    assert_eq!(failing_state.resume_calls.load(Ordering::SeqCst), 1);
    assert_eq!(failing_state.stop_calls.load(Ordering::SeqCst), 1);
    assert_eq!(replacement_state.resume_calls.load(Ordering::SeqCst), 1);

    let current_client_arc = session_registry
        .get(&session_id)
        .expect("replacement client should be stored");
    assert!(!Arc::ptr_eq(&initial_client_arc, &current_client_arc));
}

#[tokio::test]
async fn respond_inbound_request_uses_pending_responder_during_bootstrap() {
    let session_registry = SessionRegistry::new();

    let mut child = Command::new("cat")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn cat");

    let stdin = child.stdin.take().expect("cat stdin");
    let stdout = child.stdout.take().expect("cat stdout");

    let responder = InboundRequestResponder {
        provider: None,
        stdin_writer: Arc::new(Mutex::new(Some(stdin))),
        permission_tracker: Arc::new(std::sync::Mutex::new(Default::default())),
        dispatcher: AcpUiEventDispatcher::new(None, DispatchPolicy::default()),
        inbound_response_adapters: Arc::new(std::sync::Mutex::new(HashMap::new())),
    };
    session_registry
        .store_pending_inbound_responder("bootstrap-session".to_string(), Arc::new(responder));

    let respond_result = respond_inbound_request_with_registry(
        &session_registry,
        "bootstrap-session",
        7,
        json!({
            "outcome": {
                "outcome": "selected",
                "optionId": "allow"
            }
        }),
    )
    .await;

    assert!(
        respond_result.is_ok(),
        "pending responder should handle bootstrap reply"
    );

    let mut stdout_reader = BufReader::new(stdout).lines();
    let line = stdout_reader
        .next_line()
        .await
        .expect("read stdout line")
        .expect("stdout line present");
    let json_line: serde_json::Value =
        serde_json::from_str(&line).expect("valid JSON-RPC response");

    assert_eq!(json_line["id"], 7);
    assert_eq!(json_line["result"]["outcome"]["outcome"], "selected");
    assert_eq!(json_line["result"]["outcome"]["optionId"], "allow");

    let _ = child.kill().await;
}

#[derive(Clone)]
struct MockClientState {
    resume_calls: Arc<AtomicUsize>,
    stop_calls: Arc<AtomicUsize>,
    fail_resume: Arc<AtomicBool>,
}

impl MockClientState {
    fn new(fail_resume: bool) -> Self {
        Self {
            resume_calls: Arc::new(AtomicUsize::new(0)),
            stop_calls: Arc::new(AtomicUsize::new(0)),
            fail_resume: Arc::new(AtomicBool::new(fail_resume)),
        }
    }
}

struct MockAgentClient {
    state: MockClientState,
}

impl MockAgentClient {
    fn new(state: MockClientState) -> Self {
        Self { state }
    }
}

#[async_trait]
impl AgentClient for MockAgentClient {
    async fn start(&mut self) -> AcpResult<()> {
        Ok(())
    }

    async fn initialize(&mut self) -> AcpResult<crate::acp::client::InitializeResponse> {
        Ok(crate::acp::client::InitializeResponse {
            protocol_version: 1,
            agent_capabilities: json!({}),
            agent_info: json!({}),
            auth_methods: vec![],
        })
    }

    async fn new_session(
        &mut self,
        _cwd: String,
    ) -> AcpResult<crate::acp::client::NewSessionResponse> {
        Err(AcpError::InvalidState(
            "new_session not used in this test".to_string(),
        ))
    }

    async fn resume_session(
        &mut self,
        _session_id: String,
        _cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        self.state.resume_calls.fetch_add(1, Ordering::SeqCst);
        if self.state.fail_resume.load(Ordering::SeqCst) {
            return Err(AcpError::InvalidState("resume failed".to_string()));
        }

        Ok(ResumeSessionResponse {
            models: SessionModelState {
                available_models: vec![AvailableModel {
                    model_id: "gpt-5".to_string(),
                    name: "GPT-5".to_string(),
                    description: None,
                }],
                current_model_id: "gpt-5".to_string(),
                models_display: Default::default(),
            },
            modes: SessionModes {
                current_mode_id: "build".to_string(),
                available_modes: vec![],
            },
            available_commands: vec![],
            config_options: vec![],
        })
    }

    async fn fork_session(
        &mut self,
        _session_id: String,
        _cwd: String,
    ) -> AcpResult<crate::acp::client::NewSessionResponse> {
        Err(AcpError::InvalidState(
            "fork_session not used in this test".to_string(),
        ))
    }

    async fn set_session_model(&mut self, _session_id: String, _model_id: String) -> AcpResult<()> {
        Ok(())
    }

    async fn set_session_mode(&mut self, _session_id: String, _mode_id: String) -> AcpResult<()> {
        Ok(())
    }

    async fn send_prompt(&mut self, _request: PromptRequest) -> AcpResult<Value> {
        Ok(json!({}))
    }

    async fn cancel(&mut self, _session_id: String) -> AcpResult<()> {
        Ok(())
    }

    fn stop(&mut self) {
        self.state.stop_calls.fetch_add(1, Ordering::SeqCst);
    }
}
