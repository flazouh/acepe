use super::inbound_commands::respond_inbound_request_with_registry;
use super::*;
use crate::acp::client::{AvailableModel, ResumeSessionResponse, SessionModelState, SessionModes};
use crate::acp::client_session::default_session_model_state;
use crate::acp::client_trait::AgentClient;
use crate::acp::client_transport::InboundRequestResponder;
use crate::acp::commands::session_commands::{
    persist_session_metadata_for_cwd, resolve_requested_agent_id, session_metadata_context_from_cwd,
};
use crate::acp::error::{AcpError, AcpResult};
use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::runtime_registry::{
    LiveSessionStateEnvelopeRequest, SessionGraphRuntimeRegistry,
};
use crate::acp::session_state_engine::{
    CapabilityPreviewState, SessionGraphCapabilities, SessionGraphLifecycle, SessionGraphLifecycleStatus,
    SessionGraphRevision, SessionStateEnvelope, SessionStateGraph, SessionStatePayload,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::acp::transcript_projection::TranscriptSnapshot;
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
use tauri::test::{mock_builder, mock_context, noop_assets};
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MockReconnectBehavior {
    Resume,
    Load,
}

#[test]
fn test_normalize_acp_path_no_change_needed() {
    // Normal absolute path should remain unchanged
    let path = "/Users/example/project/src/file.ts";
    assert_eq!(normalize_acp_path(path), path);
}

#[test]
fn test_normalize_acp_path_fixes_duplicate_cwd() {
    // Path with duplicate cwd (cwd + "/" + absolute_path) should be normalized
    // The pattern: /cwd//cwd/subpath -> /cwd/subpath
    let path = "/Users/example/project//Users/example/project/src/file.ts";
    assert_eq!(
        normalize_acp_path(path),
        "/Users/example/project/src/file.ts"
    );
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
    let path = "/Users/example/project/src/file.ts";
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
fn resolve_requested_agent_id_prefers_explicit_over_active_agent() {
    let resolved = resolve_requested_agent_id(Some("copilot"), Some(CanonicalAgentId::ClaudeCode));

    assert_eq!(resolved, CanonicalAgentId::Copilot);
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

    assert_eq!(project_path, canonicalize_or_original_for_test(&repo_path));
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

    assert_eq!(
        row.project_path,
        canonicalize_or_original_for_test(&repo_path)
    );
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

    let result = resume_or_create_session_client(
        &session_registry,
        session_id.clone(),
        cwd,
        agent_id,
        None,
        {
            let factory_calls = Arc::clone(&factory_calls);
            move || {
                let factory_calls = Arc::clone(&factory_calls);
                async move {
                    factory_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(Box::new(MockAgentClient::new(MockClientState::new(false)))
                        as Box<dyn AgentClient + Send + Sync + 'static>)
                }
            }
        },
    )
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

    let result = resume_or_create_session_client(
        &session_registry,
        session_id.clone(),
        cwd,
        agent_id,
        None,
        {
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
        },
    )
    .await;

    assert!(result.is_ok(), "resume should succeed");
    assert_eq!(factory_calls.load(Ordering::SeqCst), 1);
    assert_eq!(created_state.resume_calls.load(Ordering::SeqCst), 1);
    assert_eq!(created_state.load_calls.load(Ordering::SeqCst), 0);
    assert!(session_registry.contains(&session_id));
}

#[test]
fn session_state_snapshot_envelope_carries_one_graph_revision_authority() {
    let graph = SessionStateGraph {
        requested_session_id: "requested-1".to_string(),
        canonical_session_id: "canonical-1".to_string(),
        is_alias: false,
        agent_id: CanonicalAgentId::Cursor,
        project_path: "/workspace/a".to_string(),
        worktree_path: None,
        source_path: None,
        revision: SessionGraphRevision::new(11, 3, 11),
        transcript_snapshot: TranscriptSnapshot {
            revision: 3,
            entries: Vec::new(),
        },
        operations: Vec::new(),
        interactions: Vec::new(),
        turn_state: crate::acp::projections::SessionTurnState::Idle,
        message_count: 0,
        active_turn_failure: None,
        last_terminal_turn_id: None,
        lifecycle: SessionGraphLifecycle {
            status: SessionGraphLifecycleStatus::Ready,
            error_message: None,
            can_reconnect: true,
        },
        capabilities: SessionGraphCapabilities::empty(),
    };

    let envelope = SessionStateEnvelope {
        session_id: "canonical-1".to_string(),
        graph_revision: graph.revision.graph_revision,
        last_event_seq: graph.revision.last_event_seq,
        payload: SessionStatePayload::Snapshot {
            graph: Box::new(graph.clone()),
        },
    };

    assert_eq!(envelope.session_id, "canonical-1");
    assert_eq!(envelope.graph_revision, 11);
    assert_eq!(envelope.last_event_seq, 11);
    match envelope.payload {
        SessionStatePayload::Snapshot {
            graph: payload_graph,
        } => {
            assert_eq!(
                payload_graph.canonical_session_id,
                graph.canonical_session_id
            );
            assert_eq!(
                payload_graph.revision.graph_revision,
                graph.revision.graph_revision
            );
        }
        _ => panic!("expected snapshot payload"),
    }
}

#[tokio::test]
async fn connection_complete_builds_graph_native_snapshot_envelope() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-1".to_string(),
        "Session 1".to_string(),
        0,
        "/workspace/a".to_string(),
        CanonicalAgentId::Cursor.as_str().to_string(),
        "/workspace/a/src/main.ts".to_string(),
        0,
        0,
    )
    .await
    .expect("insert metadata");
    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let update = crate::acp::session_update::SessionUpdate::ConnectionComplete {
        session_id: "session-1".to_string(),
        attempt_id: 42,
        models: SessionModelState {
            available_models: vec![AvailableModel {
                model_id: "gpt-5".to_string(),
                name: "GPT-5".to_string(),
                description: None,
            }],
            current_model_id: "gpt-5".to_string(),
            ..default_session_model_state()
        },
        modes: SessionModes {
            current_mode_id: "plan".to_string(),
            available_modes: vec![crate::acp::client::AvailableMode {
                id: "plan".to_string(),
                name: "Plan".to_string(),
                description: None,
            }],
        },
        available_commands: vec![crate::acp::session_update::AvailableCommand {
            name: "edit".to_string(),
            description: "Edit files".to_string(),
            input: None,
        }],
        config_options: vec![crate::acp::session_update::ConfigOptionData {
            id: "sandbox".to_string(),
            name: "sandbox".to_string(),
            category: "runtime".to_string(),
            option_type: "string".to_string(),
            description: None,
            current_value: Some(json!("workspace-write")),
            options: Vec::new(),
        }],
        autonomous_enabled: false,
    };

    runtime_registry.apply_session_update_with_graph_seed("session-1", 6, &update);

    let envelope = runtime_registry
        .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
            db: &db,
            session_id: "session-1",
            update: &update,
            previous_revision: SessionGraphRevision::new(6, 5, 6),
            revision: SessionGraphRevision::new(7, 5, 7),
            projection_registry: &projection_registry,
            transcript_projection_registry: &transcript_projection_registry,
            transcript_delta: None,
        })
        .await
        .expect("snapshot envelope");

    match envelope.payload {
        SessionStatePayload::Snapshot { graph } => {
            assert_eq!(graph.revision, SessionGraphRevision::new(7, 5, 7));
            assert_eq!(graph.lifecycle.status, SessionGraphLifecycleStatus::Ready);
            assert_eq!(graph.lifecycle.error_message, None);
            assert_eq!(
                graph
                    .capabilities
                    .models
                    .as_ref()
                    .expect("models")
                    .current_model_id,
                "gpt-5"
            );
            assert_eq!(graph.capabilities.available_commands.len(), 1);
            assert_eq!(graph.capabilities.config_options.len(), 1);
        }
        payload => panic!("expected snapshot payload, got {payload:?}"),
    }
}

#[tokio::test]
async fn connection_failed_builds_graph_native_error_snapshot_envelope() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-1".to_string(),
        "Session 1".to_string(),
        0,
        "/workspace/a".to_string(),
        CanonicalAgentId::Cursor.as_str().to_string(),
        "/workspace/a/src/main.ts".to_string(),
        0,
        0,
    )
    .await
    .expect("insert metadata");
    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
        session_id: "session-1".to_string(),
        attempt_id: 42,
        error: "connection dropped".to_string(),
    };

    runtime_registry.apply_session_update_with_graph_seed("session-1", 8, &update);

    let envelope = runtime_registry
        .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
            db: &db,
            session_id: "session-1",
            update: &update,
            previous_revision: SessionGraphRevision::new(8, 4, 8),
            revision: SessionGraphRevision::new(9, 4, 9),
            projection_registry: &projection_registry,
            transcript_projection_registry: &transcript_projection_registry,
            transcript_delta: None,
        })
        .await
        .expect("snapshot envelope");

    match envelope.payload {
        SessionStatePayload::Snapshot { graph } => {
            assert_eq!(graph.revision, SessionGraphRevision::new(9, 4, 9));
            assert_eq!(graph.lifecycle.status, SessionGraphLifecycleStatus::Error);
            assert_eq!(
                graph.lifecycle.error_message.as_deref(),
                Some("connection dropped")
            );
            assert!(graph.lifecycle.can_reconnect);
        }
        payload => panic!("expected snapshot payload, got {payload:?}"),
    }
}

#[tokio::test]
async fn resume_or_create_uses_provider_owned_load_reconnect_behavior() {
    let session_registry = SessionRegistry::new();
    let session_id = "copilot-session".to_string();
    let cwd = "/workspace/a".to_string();
    let agent_id = CanonicalAgentId::Copilot;

    let created_state =
        MockClientState::new(false).with_reconnect_behavior(MockReconnectBehavior::Load);

    let result = resume_or_create_session_client(
        &session_registry,
        session_id.clone(),
        cwd,
        agent_id,
        None,
        {
            let created_state = created_state.clone();
            move || {
                let created_state = created_state.clone();
                async move {
                    Ok(Box::new(MockAgentClient::new(created_state))
                        as Box<dyn AgentClient + Send + Sync + 'static>)
                }
            }
        },
    )
    .await;

    assert!(result.is_ok(), "load reconnect should succeed");
    assert_eq!(created_state.resume_calls.load(Ordering::SeqCst), 0);
    assert_eq!(created_state.load_calls.load(Ordering::SeqCst), 1);
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

    let result = resume_or_create_session_client(
        &session_registry,
        session_id.clone(),
        cwd,
        agent_id,
        None,
        {
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
        },
    )
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
        title_overridden: false,
        timestamp: 0,
        project_path: "/project".to_string(),
        agent_id: "claude-code".to_string(),
        file_path: "__worktree__/session-placeholder".to_string(),
        file_mtime: 0,
        file_size: 0,
        provider_session_id: None,
        worktree_path: None,
        pr_number: None,
        is_acepe_managed: false,
        sequence_id: None,
    };

    assert!(row.is_transcript_pending());
}

#[test]
fn session_metadata_real_rows_are_resumable() {
    let row = crate::db::repository::SessionMetadataRow {
        id: "session-real".to_string(),
        display: "Real Session".to_string(),
        title_overridden: false,
        timestamp: 1704067200000,
        project_path: "/project".to_string(),
        agent_id: "claude-code".to_string(),
        file_path: "/project/session-real.jsonl".to_string(),
        file_mtime: 1704067200,
        file_size: 1024,
        provider_session_id: None,
        worktree_path: None,
        pr_number: None,
        is_acepe_managed: false,
        sequence_id: None,
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
        title_overridden: false,
        timestamp: 0,
        project_path: "/project".to_string(),
        agent_id: "opencode".to_string(),
        file_path: "__session_registry__/session-worktree-placeholder".to_string(),
        file_mtime: 0,
        file_size: 0,
        provider_session_id: None,
        worktree_path: Some(worktree_path),
        pr_number: None,
        is_acepe_managed: true,
        sequence_id: Some(1),
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
async fn persist_session_metadata_for_cwd_assigns_sequence_id_immediately_for_worktree_sessions() {
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

    let sequence_id = persist_session_metadata_for_cwd(
        &db,
        "session-worktree-seq",
        &CanonicalAgentId::ClaudeCode,
        &worktree_path,
    )
    .await
    .expect("persist startup metadata");

    assert_eq!(sequence_id, Some(1));
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

    let result = resume_or_create_session_client(
        &session_registry,
        session_id.clone(),
        cwd,
        agent_id,
        None,
        {
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
        },
    )
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
async fn reserved_send_prompt_emits_connection_complete_before_prompt_echo() {
    crate::acp::pending_prompt_registry::clear_pending_prompt_echoes();

    let db = setup_test_db().await;
    let temp = tempdir().expect("temp dir");
    let session_id = "reserved-send-session";

    SessionMetadataRepository::ensure_exists(
        &db,
        session_id,
        &temp.path().to_string_lossy(),
        "copilot",
        None,
    )
    .await
    .expect("persist session metadata");
    SessionMetadataRepository::set_provider_session_id(&db, session_id, "provider-session-1")
        .await
        .expect("set provider session id");

    let event_hub = Arc::new(crate::acp::event_hub::AcpEventHubState::new());
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let transcript_projection_registry = Arc::new(TranscriptProjectionRegistry::new());
    let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
    supervisor
        .reserve(&db, projection_registry.as_ref(), session_id)
        .await
        .expect("reserve session");
    let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::with_supervisor(Arc::clone(
        &supervisor,
    )));
    let session_policy = Arc::new(crate::acp::session_policy::SessionPolicyRegistry::new());

    let session_registry = SessionRegistry::new();
    session_registry.store(
        session_id.to_string(),
        Box::new(MockAgentClient::new(MockClientState::new(false))),
        CanonicalAgentId::Copilot,
    );

    let app = mock_builder()
        .manage(db.clone())
        .manage(session_registry)
        .manage(Arc::clone(&event_hub))
        .manage(Arc::clone(&projection_registry))
        .manage(Arc::clone(&runtime_registry))
        .manage(Arc::clone(&transcript_projection_registry))
        .manage(Arc::clone(&session_policy))
        .manage(Arc::clone(&supervisor))
        .build(mock_context(noop_assets()))
        .expect("build mock app");

    let mut receiver = event_hub.subscribe();
    let request = serde_json::to_value(vec![crate::acp::types::ContentBlock::Text {
        text: "hello from reserved".to_string(),
    }])
    .expect("serialize prompt request");

    let result = super::interaction_commands::send_prompt_with_app_handle(
        &app.handle().clone(),
        session_id.to_string(),
        request,
    )
    .await;

    assert!(result.is_ok(), "reserved send_prompt should succeed");

    let first = tokio::time::timeout(std::time::Duration::from_millis(200), receiver.recv())
        .await
        .expect("expected session update to be published")
        .expect("event should be delivered");

    assert_eq!(first.event_name, "acp-session-update");
    assert_eq!(first.session_id.as_deref(), Some(session_id));
    assert_eq!(
        first.payload.get("type").and_then(serde_json::Value::as_str),
        Some("connectionComplete"),
        "reserved first-send must publish canonical ready state before prompt echo",
    );
}

#[tokio::test]
async fn send_prompt_rejects_activating_session_before_transport_dispatch() {
    let session_id = "activating-send-session";
    let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
    assert!(
        supervisor.seed_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                1,
                crate::acp::lifecycle::LifecycleState::activating(),
                SessionGraphCapabilities::empty(),
            ),
        ),
        "seed activating checkpoint",
    );

    let session_registry = SessionRegistry::new();
    let client_state = MockClientState::new(false);
    session_registry.store(
        session_id.to_string(),
        Box::new(MockAgentClient::new(client_state.clone())),
        CanonicalAgentId::Copilot,
    );

    let app = mock_builder()
        .manage(session_registry)
        .manage(Arc::clone(&supervisor))
        .build(mock_context(noop_assets()))
        .expect("build mock app");

    let request = serde_json::to_value(vec![crate::acp::types::ContentBlock::Text {
        text: "hello while activating".to_string(),
    }])
    .expect("serialize prompt request");

    let error = super::interaction_commands::send_prompt_with_app_handle(
        &app.handle().clone(),
        session_id.to_string(),
        request,
    )
    .await
    .expect_err("activating session should reject ready-only dispatch");

    match error {
        SerializableAcpError::ProtocolError { message } => {
            assert!(
                message.contains("not ready for ready-only dispatch")
                    && message.contains("Activating"),
                "unexpected protocol message: {message}"
            );
        }
        other => panic!("expected protocol error, got {:?}", other),
    }

    assert_eq!(
        client_state.send_prompt_calls.load(Ordering::SeqCst),
        0,
        "send_prompt should be rejected before transport dispatch"
    );
}

#[tokio::test]
async fn fork_session_rejects_detached_source_before_client_creation() {
    let db = setup_test_db().await;
    let temp = tempdir().expect("temp dir");
    let session_id = "detached-fork-session";

    SessionMetadataRepository::ensure_exists(
        &db,
        session_id,
        &temp.path().to_string_lossy(),
        "copilot",
        None,
    )
    .await
    .expect("persist session metadata");

    let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
    assert!(
        supervisor.seed_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                1,
                crate::acp::lifecycle::LifecycleState::detached(
                    crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
                ),
                SessionGraphCapabilities::empty(),
            ),
        ),
        "seed detached checkpoint",
    );

    let app = mock_builder()
        .manage(db.clone())
        .manage(Arc::clone(&supervisor))
        .build(mock_context(noop_assets()))
        .expect("build mock app");

    let error = super::session_commands::fork_preflight_with_app_handle(
        &app.handle().clone(),
        session_id,
        &temp.path().to_string_lossy(),
        None,
    )
    .await
    .expect_err("detached session should reject ready-only fork");

    match error {
        SerializableAcpError::ProtocolError { message } => {
            assert!(
                message.contains("not ready for ready-only dispatch")
                    && message.contains("Detached"),
                "unexpected protocol message: {message}"
            );
        }
        other => panic!("expected protocol error, got {:?}", other),
    }
}

#[tokio::test]
async fn fork_preflight_ready_permit_detects_epoch_drift_before_dispatch() {
    let db = setup_test_db().await;
    let temp = tempdir().expect("temp dir");
    let session_id = "ready-fork-session";

    SessionMetadataRepository::ensure_exists(
        &db,
        session_id,
        &temp.path().to_string_lossy(),
        "copilot",
        None,
    )
    .await
    .expect("persist session metadata");

    let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
    let projection_registry = Arc::new(ProjectionRegistry::new());
    assert!(
        supervisor.seed_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                1,
                crate::acp::lifecycle::LifecycleState::ready(),
                SessionGraphCapabilities::empty(),
            ),
        ),
        "seed ready checkpoint",
    );

    let app = mock_builder()
        .manage(db.clone())
        .manage(Arc::clone(&supervisor))
        .build(mock_context(noop_assets()))
        .expect("build mock app");

    let (_, _, ready_dispatch_permit) = super::session_commands::fork_preflight_with_app_handle(
        &app.handle().clone(),
        session_id,
        &temp.path().to_string_lossy(),
        None,
    )
    .await
    .expect("ready session should produce a dispatch permit");
    let ready_dispatch_permit = ready_dispatch_permit.expect("fork preflight should return permit");

    supervisor
        .transition_lifecycle_state(
            &db,
            &projection_registry,
            session_id,
            crate::acp::lifecycle::LifecycleState::ready(),
        )
        .await
        .expect("advance runtime epoch");

    let error = supervisor
        .validate_ready_dispatch_permit(&ready_dispatch_permit)
        .expect_err("fork permit should reject epoch drift");

    match error {
        crate::acp::lifecycle::ReadyDispatchError::RuntimeEpochChanged { .. } => {}
        other => panic!("expected runtime epoch changed error, got {:?}", other),
    }
}

#[tokio::test]
async fn ready_dispatch_permit_survives_non_lifecycle_session_updates() {
    let db = setup_test_db().await;
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let session_id = "ready-session-non-lifecycle-update";
    let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
    let temp = tempdir().expect("temp dir");

    SessionMetadataRepository::ensure_exists(
        &db,
        session_id,
        &temp.path().to_string_lossy(),
        "copilot",
        None,
    )
    .await
    .expect("persist session metadata");

    assert!(
        supervisor.seed_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                1,
                crate::acp::lifecycle::LifecycleState::ready(),
                SessionGraphCapabilities::empty(),
            ),
        ),
        "seed ready checkpoint",
    );

    let permit = supervisor
        .issue_ready_dispatch_permit(session_id)
        .expect("ready session should get dispatch permit");

    let checkpoint = supervisor
        .record_session_update(
            &db,
            &projection_registry,
            session_id,
            2,
            &crate::acp::session_update::SessionUpdate::TurnComplete {
                session_id: Some(session_id.to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        )
        .await
        .expect("non-lifecycle session update should persist");

    assert_eq!(
        checkpoint.graph_revision, 2,
        "non-lifecycle updates should still advance graph revision"
    );
    supervisor
        .validate_ready_dispatch_permit(&permit)
        .expect("non-lifecycle updates should not invalidate ready dispatch permits");
}

#[tokio::test]
async fn resume_session_emits_connecting_session_state_before_completion_events() {
    let db = setup_test_db().await;
    let temp = tempdir().expect("temp dir");
    let session_id = "resume-activating-session";

    persist_session_metadata_for_cwd(
        &db,
        session_id,
        &CanonicalAgentId::ClaudeCode,
        temp.path(),
    )
    .await
    .expect("persist session metadata");
    SessionMetadataRepository::set_provider_session_id(&db, session_id, "provider-session-1")
        .await
        .expect("set provider session id");

    let event_hub = Arc::new(crate::acp::event_hub::AcpEventHubState::new());
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let transcript_projection_registry = Arc::new(TranscriptProjectionRegistry::new());
    let supervisor = Arc::new(crate::acp::lifecycle::SessionSupervisor::new());
    let session_policy = Arc::new(crate::acp::session_policy::SessionPolicyRegistry::new());
    assert!(
        supervisor.seed_checkpoint(
            session_id.to_string(),
            crate::acp::lifecycle::LifecycleCheckpoint::new(
                1,
                crate::acp::lifecycle::LifecycleState::detached(
                    crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
                ),
                SessionGraphCapabilities::empty(),
            ),
        ),
        "seed detached checkpoint",
    );
    let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::with_supervisor(Arc::clone(
        &supervisor,
    )));

    let session_registry = SessionRegistry::new();
    session_registry.store(
        session_id.to_string(),
        Box::new(MockAgentClient::new(MockClientState::new(false))),
        CanonicalAgentId::ClaudeCode,
    );

    let app = mock_builder()
        .manage(db.clone())
        .manage(session_registry)
        .manage(Arc::clone(&event_hub))
        .manage(Arc::clone(&projection_registry))
        .manage(Arc::clone(&runtime_registry))
        .manage(Arc::clone(&transcript_projection_registry))
        .manage(Arc::clone(&session_policy))
        .manage(Arc::clone(&supervisor))
        .build(mock_context(noop_assets()))
        .expect("build mock app");

    let mut receiver = event_hub.subscribe();

    let result = super::session_commands::resume_session_with_app_handle_and_worker(
        &app.handle().clone(),
        session_id.to_string(),
        temp.path().to_string_lossy().into_owned(),
        None,
        None,
        1,
        None,
        |_app, _session_id, _cwd, _agent_id_enum, _launch_mode_id, _resume_descriptor, _open_token| async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            Ok(ResumeSessionResponse {
                models: SessionModelState {
                    available_models: vec![AvailableModel {
                        model_id: "gpt-5".to_string(),
                        name: "GPT-5".to_string(),
                        description: None,
                    }],
                    current_model_id: "gpt-5".to_string(),
                    models_display: Default::default(),
                    provider_metadata: None,
                },
                modes: SessionModes {
                    current_mode_id: "build".to_string(),
                    available_modes: vec![],
                },
                available_commands: vec![],
                config_options: vec![],
            })
        },
    )
    .await;

    assert!(
        result.is_ok(),
        "resume invoke should validate and return immediately: {:?}",
        result
    );

    let first = tokio::time::timeout(std::time::Duration::from_millis(200), receiver.recv())
        .await
        .expect("expected activating event to be published")
        .expect("event should be delivered");

    assert_eq!(
        first.event_name, "acp-session-state",
        "resume should publish canonical connecting state before completion events",
    );

    let envelope: SessionStateEnvelope =
        serde_json::from_value(first.payload.clone()).expect("session-state envelope");
    match envelope.payload {
        SessionStatePayload::Snapshot { graph } => {
            assert_eq!(graph.lifecycle.status, SessionGraphLifecycleStatus::Connecting);
        }
        payload => panic!("expected snapshot payload, got {:?}", payload),
    }
}

#[tokio::test]
async fn resume_or_create_passes_launch_mode_through_provider_owned_reconnect() {
    let session_registry = SessionRegistry::new();
    let session_id = "launch-profile-session".to_string();
    let cwd = "/workspace/a".to_string();
    let agent_id = CanonicalAgentId::ClaudeCode;

    let existing_state = MockClientState::new(false);
    session_registry.store(
        session_id.clone(),
        Box::new(MockAgentClient::new(existing_state.clone())),
        agent_id.clone(),
    );

    let replacement_state = MockClientState::new(false);
    let result = resume_or_create_session_client(
        &session_registry,
        session_id.clone(),
        cwd,
        agent_id,
        Some("bypassPermissions".to_string()),
        {
            let replacement_state = replacement_state.clone();
            move || {
                let replacement_state = replacement_state.clone();
                async move {
                    Ok(Box::new(MockAgentClient::new(replacement_state))
                        as Box<dyn AgentClient + Send + Sync + 'static>)
                }
            }
        },
    )
    .await;

    assert!(result.is_ok(), "provider-owned reconnect should succeed");
    assert_eq!(existing_state.resume_calls.load(Ordering::SeqCst), 0);
    assert_eq!(existing_state.stop_calls.load(Ordering::SeqCst), 1);
    assert_eq!(replacement_state.resume_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        replacement_state
            .reconnect_launch_mode_ids
            .lock()
            .expect("reconnect launch mode ids lock")
            .as_slice(),
        ["bypassPermissions"]
    );
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
        session_id: "bootstrap-session".to_string(),
        provider: None,
        db: None,
        stdin_writer: Arc::new(Mutex::new(Some(stdin))),
        permission_tracker: Arc::new(std::sync::Mutex::new(Default::default())),
        projection_registry: Arc::new(crate::acp::projections::ProjectionRegistry::new()),
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
    load_calls: Arc<AtomicUsize>,
    send_prompt_calls: Arc<AtomicUsize>,
    stop_calls: Arc<AtomicUsize>,
    fail_resume: Arc<AtomicBool>,
    fail_load: Arc<AtomicBool>,
    fail_set_model: Arc<AtomicBool>,
    fail_set_mode: Arc<AtomicBool>,
    reconnect_behavior: Arc<std::sync::Mutex<MockReconnectBehavior>>,
    reconnect_launch_mode_ids: Arc<std::sync::Mutex<Vec<String>>>,
}

impl MockClientState {
    fn new(fail_resume: bool) -> Self {
        Self {
            resume_calls: Arc::new(AtomicUsize::new(0)),
            load_calls: Arc::new(AtomicUsize::new(0)),
            send_prompt_calls: Arc::new(AtomicUsize::new(0)),
            stop_calls: Arc::new(AtomicUsize::new(0)),
            fail_resume: Arc::new(AtomicBool::new(fail_resume)),
            fail_load: Arc::new(AtomicBool::new(false)),
            fail_set_model: Arc::new(AtomicBool::new(false)),
            fail_set_mode: Arc::new(AtomicBool::new(false)),
            reconnect_behavior: Arc::new(std::sync::Mutex::new(MockReconnectBehavior::Resume)),
            reconnect_launch_mode_ids: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    fn with_reconnect_behavior(self, reconnect_behavior: MockReconnectBehavior) -> Self {
        *self
            .reconnect_behavior
            .lock()
            .expect("reconnect behavior lock") = reconnect_behavior;
        self
    }

    fn with_failed_set_mode(self) -> Self {
        self.fail_set_mode.store(true, Ordering::SeqCst);
        self
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
                provider_metadata: None,
            },
            modes: SessionModes {
                current_mode_id: "build".to_string(),
                available_modes: vec![],
            },
            available_commands: vec![],
            config_options: vec![],
        })
    }

    async fn load_session(
        &mut self,
        _session_id: String,
        _cwd: String,
    ) -> AcpResult<ResumeSessionResponse> {
        self.state.load_calls.fetch_add(1, Ordering::SeqCst);
        if self.state.fail_load.load(Ordering::SeqCst) {
            return Err(AcpError::InvalidState("load failed".to_string()));
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
                provider_metadata: None,
            },
            modes: SessionModes {
                current_mode_id: "build".to_string(),
                available_modes: vec![],
            },
            available_commands: vec![],
            config_options: vec![],
        })
    }

    async fn reconnect_session(
        &mut self,
        session_id: String,
        cwd: String,
        launch_mode_id: Option<String>,
    ) -> AcpResult<ResumeSessionResponse> {
        if let Some(mode_id) = launch_mode_id {
            self.state
                .reconnect_launch_mode_ids
                .lock()
                .expect("reconnect launch mode ids lock")
                .push(mode_id);
        }

        let reconnect_behavior = *self
            .state
            .reconnect_behavior
            .lock()
            .expect("reconnect behavior lock");

        match reconnect_behavior {
            MockReconnectBehavior::Resume => self.resume_session(session_id, cwd).await,
            MockReconnectBehavior::Load => self.load_session(session_id, cwd).await,
        }
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
        if self.state.fail_set_model.load(Ordering::SeqCst) {
            return Err(AcpError::InvalidState("set model failed".to_string()));
        }
        Ok(())
    }

    async fn set_session_mode(&mut self, _session_id: String, _mode_id: String) -> AcpResult<()> {
        if self.state.fail_set_mode.load(Ordering::SeqCst) {
            return Err(AcpError::InvalidState("set mode failed".to_string()));
        }
        Ok(())
    }

    async fn set_session_config_option(
        &mut self,
        _session_id: String,
        _config_id: String,
        value: String,
    ) -> AcpResult<Value> {
        Ok(json!({
            "configOptions": [
                {
                    "id": "approval-policy",
                    "name": "Approval policy",
                    "description": null,
                    "valueType": "string",
                    "currentValue": value,
                    "required": false,
                }
            ]
        }))
    }

    async fn send_prompt(&mut self, _request: PromptRequest) -> AcpResult<Value> {
        self.state.send_prompt_calls.fetch_add(1, Ordering::SeqCst);
        Ok(json!({}))
    }

    async fn cancel(&mut self, _session_id: String) -> AcpResult<()> {
        Ok(())
    }

    fn stop(&mut self) {
        self.state.stop_calls.fetch_add(1, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn set_model_emits_pending_then_confirmed_capabilities_envelopes() {
    let session_id = "set-model-session";
    let event_hub = Arc::new(crate::acp::event_hub::AcpEventHubState::new());
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let transcript_projection_registry = Arc::new(TranscriptProjectionRegistry::new());
    let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::new());
    runtime_registry.restore_session_state(
        session_id.to_string(),
        4,
        SessionGraphLifecycle {
            status: SessionGraphLifecycleStatus::Ready,
            error_message: None,
            can_reconnect: true,
        },
        SessionGraphCapabilities {
            models: Some(SessionModelState {
                available_models: vec![AvailableModel {
                    model_id: "gpt-5".to_string(),
                    name: "GPT-5".to_string(),
                    description: None,
                }],
                current_model_id: "gpt-4".to_string(),
                ..default_session_model_state()
            }),
            modes: Some(SessionModes {
                current_mode_id: "build".to_string(),
                available_modes: vec![],
            }),
            available_commands: vec![],
            config_options: vec![],
            autonomous_enabled: false,
        },
    );

    let session_registry = SessionRegistry::new();
    session_registry.store(
        session_id.to_string(),
        Box::new(MockAgentClient::new(MockClientState::new(false))),
        CanonicalAgentId::Copilot,
    );

    let app = mock_builder()
        .manage(session_registry)
        .manage(Arc::clone(&event_hub))
        .manage(Arc::clone(&projection_registry))
        .manage(Arc::clone(&transcript_projection_registry))
        .manage(Arc::clone(&runtime_registry))
        .build(mock_context(noop_assets()))
        .expect("build mock app");

    let mut receiver = event_hub.subscribe();
    let result = super::interaction_commands::acp_set_model_for_handle(
        app.handle().clone(),
        session_id.to_string(),
        "gpt-5".to_string(),
    )
    .await;

    assert!(result.is_ok(), "set model should succeed");

    let pending = tokio::time::timeout(std::time::Duration::from_millis(200), receiver.recv())
        .await
        .expect("expected pending capability envelope")
        .expect("pending event should be delivered");
    let confirmed = tokio::time::timeout(std::time::Duration::from_millis(200), receiver.recv())
        .await
        .expect("expected confirmed capability envelope")
        .expect("confirmed event should be delivered");

    let pending_envelope: SessionStateEnvelope =
        serde_json::from_value(pending.payload).expect("deserialize pending envelope");
    let confirmed_envelope: SessionStateEnvelope =
        serde_json::from_value(confirmed.payload).expect("deserialize confirmed envelope");

    match pending_envelope.payload {
        SessionStatePayload::Capabilities {
            capabilities,
            revision,
            pending_mutation_id,
            preview_state,
        } => {
            assert_eq!(preview_state, CapabilityPreviewState::Pending);
            assert_eq!(revision.graph_revision, 5);
            assert!(pending_mutation_id.is_some(), "pending envelope should carry mutation id");
            assert_eq!(
                capabilities.models.expect("models").current_model_id,
                "gpt-5".to_string()
            );
        }
        _ => panic!("expected pending capabilities payload"),
    }

    match confirmed_envelope.payload {
        SessionStatePayload::Capabilities {
            capabilities,
            revision,
            pending_mutation_id,
            preview_state,
        } => {
            assert_eq!(preview_state, CapabilityPreviewState::Canonical);
            assert_eq!(revision.graph_revision, 6);
            assert_eq!(pending_mutation_id, None);
            assert_eq!(
                capabilities.models.expect("models").current_model_id,
                "gpt-5".to_string()
            );
        }
        _ => panic!("expected confirmed capabilities payload"),
    }
}

#[tokio::test]
async fn set_mode_failure_emits_corrective_failed_capabilities_envelope() {
    let session_id = "set-mode-session";
    let event_hub = Arc::new(crate::acp::event_hub::AcpEventHubState::new());
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let transcript_projection_registry = Arc::new(TranscriptProjectionRegistry::new());
    let runtime_registry = Arc::new(SessionGraphRuntimeRegistry::new());
    runtime_registry.restore_session_state(
        session_id.to_string(),
        2,
        SessionGraphLifecycle {
            status: SessionGraphLifecycleStatus::Ready,
            error_message: None,
            can_reconnect: true,
        },
        SessionGraphCapabilities {
            models: None,
            modes: Some(SessionModes {
                current_mode_id: "build".to_string(),
                available_modes: vec![],
            }),
            available_commands: vec![],
            config_options: vec![],
            autonomous_enabled: false,
        },
    );

    let session_registry = SessionRegistry::new();
    session_registry.store(
        session_id.to_string(),
        Box::new(MockAgentClient::new(
            MockClientState::new(false).with_failed_set_mode(),
        )),
        CanonicalAgentId::Copilot,
    );

    let app = mock_builder()
        .manage(session_registry)
        .manage(Arc::clone(&event_hub))
        .manage(Arc::clone(&projection_registry))
        .manage(Arc::clone(&transcript_projection_registry))
        .manage(Arc::clone(&runtime_registry))
        .build(mock_context(noop_assets()))
        .expect("build mock app");

    let mut receiver = event_hub.subscribe();
    let result = super::interaction_commands::acp_set_mode_for_handle(
        app.handle().clone(),
        session_id.to_string(),
        "plan".to_string(),
    )
    .await;

    assert!(result.is_err(), "set mode should fail");

    let pending = tokio::time::timeout(std::time::Duration::from_millis(200), receiver.recv())
        .await
        .expect("expected pending capability envelope")
        .expect("pending event should be delivered");
    let failed = tokio::time::timeout(std::time::Duration::from_millis(200), receiver.recv())
        .await
        .expect("expected failed capability envelope")
        .expect("failed event should be delivered");

    let pending_envelope: SessionStateEnvelope =
        serde_json::from_value(pending.payload).expect("deserialize pending envelope");
    let failed_envelope: SessionStateEnvelope =
        serde_json::from_value(failed.payload).expect("deserialize failed envelope");

    match pending_envelope.payload {
        SessionStatePayload::Capabilities {
            capabilities,
            revision,
            preview_state,
            ..
        } => {
            assert_eq!(preview_state, CapabilityPreviewState::Pending);
            assert_eq!(revision.graph_revision, 3);
            assert_eq!(
                capabilities.modes.expect("modes").current_mode_id,
                "plan".to_string()
            );
        }
        _ => panic!("expected pending capabilities payload"),
    }

    match failed_envelope.payload {
        SessionStatePayload::Capabilities {
            capabilities,
            revision,
            pending_mutation_id,
            preview_state,
        } => {
            assert_eq!(preview_state, CapabilityPreviewState::Failed);
            assert_eq!(revision.graph_revision, 4);
            assert_eq!(pending_mutation_id, None);
            assert_eq!(
                capabilities.modes.expect("modes").current_mode_id,
                "build".to_string()
            );
        }
        _ => panic!("expected failed capabilities payload"),
    }
}
