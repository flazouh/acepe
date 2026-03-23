use super::inbound_commands::respond_inbound_request_with_registry;
use super::*;
use crate::acp::client::{AvailableModel, ResumeSessionResponse, SessionModelState, SessionModes};
use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::InboundRequestResponder;
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::types::CanonicalAgentId;
use crate::acp::ui_event_dispatcher::{AcpUiEventDispatcher, DispatchPolicy};
use async_trait::async_trait;
use serde_json::json;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tempfile::tempdir;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

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
