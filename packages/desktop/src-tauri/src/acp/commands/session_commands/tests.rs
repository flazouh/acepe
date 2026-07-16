use super::state_lookup::unresolved_tool_entry_ids;
use super::{
    load_live_session_graph_revision, load_transcript_snapshot_for_resume,
    load_transcript_snapshot_for_state_lookup, persist_session_metadata_for_cwd,
    projection_has_graph_state, resolve_fork_session_target, resolve_requested_agent_id,
    resolve_resume_session_target, resolve_state_lookup_authority, runtime_snapshot_for_refresh,
};
use crate::acp::error::SerializableAcpError;
use crate::acp::lifecycle::LifecycleCheckpoint;
use crate::acp::projections::{
    InteractionResponse, InteractionState, ProjectionRegistry, SessionProjectionSnapshot,
    SessionSnapshot,
};
use crate::acp::session_descriptor::{
    SessionCompatibilityInput, SessionDescriptorCompatibility, SessionReplayContext,
};
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::SessionGraphRuntimeRegistry;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::{
    ContentChunk, PermissionData, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus,
    ToolKind,
};
use crate::acp::transcript_projection::{TranscriptProjectionRegistry, TranscriptSnapshot};
use crate::acp::types::{CanonicalAgentId, ContentBlock};
use crate::db::migrations::Migrator;
use crate::db::repository::{
    SessionEventWriter, SessionJournalEventRepository, SessionMetadataRepository,
};
use crate::session_jsonl::types::StoredEntry;
use sea_orm::{Database, DbConn};
use sea_orm_migration::MigratorTrait;
use serde_json::json;
use tempfile::tempdir;

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

fn seed_lifecycle(registry: &SessionGraphRuntimeRegistry, session_id: &str, graph_revision: i64) {
    registry.restore_session_state(
        session_id.to_string(),
        graph_revision,
        SessionGraphLifecycle::reserved(),
        SessionGraphCapabilities::empty(),
    );
}

fn tool_snapshot_with_entry_id(entry_id: &str) -> SessionThreadSnapshot {
    SessionThreadSnapshot {
        title: "Tool session".to_string(),
        created_at: "2026-05-13T00:00:00Z".to_string(),
        current_mode_id: None,
        entries: vec![StoredEntry::ToolCall {
            id: entry_id.to_string(),
            message: ToolCallData {
                id: entry_id.to_string(),
                name: "Read".to_string(),
                title: Some("Read file".to_string()),
                status: ToolCallStatus::Completed,
                result: Some(json!({ "content": "ok" })),
                kind: Some(ToolKind::Read),
                arguments: ToolArguments::Read {
                    file_path: Some("/tmp/file.rs".to_string()),
                    source_context: None,
                },
                diagnostic_input: None,
                skill_meta: None,
                locations: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            timestamp: Some("2026-05-13T00:00:01Z".to_string()),
        }],
    }
}

#[test]
fn projection_graph_state_ignores_runtime_only_checkpoint() {
    let snapshot = SessionProjectionSnapshot {
        session: None,
        operations: Vec::new(),
        interactions: Vec::new(),
        runtime: Some(LifecycleCheckpoint::from_live_runtime(
            1,
            SessionGraphLifecycle::reserved(),
            SessionGraphCapabilities::empty(),
        )),
    };

    assert!(!projection_has_graph_state(&snapshot));
}

#[test]
fn projection_graph_state_detects_canonical_session_projection() {
    let snapshot = SessionProjectionSnapshot {
        session: Some(SessionSnapshot::new(
            "session-1".to_string(),
            Some(CanonicalAgentId::ClaudeCode),
        )),
        operations: Vec::new(),
        interactions: Vec::new(),
        runtime: None,
    };

    assert!(projection_has_graph_state(&snapshot));
}

#[test]
fn unresolved_tool_entry_ids_detects_transcript_tool_without_operation_link() {
    let snapshot = tool_snapshot_with_entry_id("tool-1");
    let transcript = TranscriptSnapshot::from_stored_entries(1, &snapshot.entries);

    assert_eq!(
        unresolved_tool_entry_ids(&transcript, &[]),
        vec!["acepe::entry::session-start::tool::tool-1".to_string()]
    );
}

#[test]
fn unresolved_tool_entry_ids_accepts_matching_provider_projection_link() {
    let snapshot = tool_snapshot_with_entry_id("tool-1");
    let transcript = TranscriptSnapshot::from_stored_entries(1, &snapshot.entries);
    let projection = ProjectionRegistry::project_thread_snapshot(
        "session-1",
        Some(CanonicalAgentId::Copilot),
        &snapshot,
    );

    assert!(unresolved_tool_entry_ids(&transcript, &projection.operations).is_empty());
}

#[tokio::test]
async fn session_update_and_interaction_transition_are_persisted_to_journal() {
    let db = setup_test_db().await;
    SessionMetadataRepository::upsert(
        &db,
        "session-priority".to_string(),
        "Priority session".to_string(),
        1704067200000,
        "/Users/test/project".to_string(),
        "claude-code".to_string(),
        "-Users-test-project/session-priority.jsonl".to_string(),
        1704067200,
        1024,
    )
    .await
    .unwrap();

    let permission_update = SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: "permission-1".to_string(),
            session_id: "session-priority".to_string(),
            json_rpc_request_id: Some(7),
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(7)),
            permission: "Execute".to_string(),
            patterns: vec![],
            metadata: json!({ "command": "bun test" }),
            always: vec![],
            auto_accepted: false,
            tool: None,
        },
        session_id: Some("session-priority".to_string()),
    };
    SessionEventWriter::commit_session_update(&db, "session-priority", &permission_update)
        .await
        .unwrap();
    SessionJournalEventRepository::append_interaction_transition(
        &db,
        "session-priority",
        "permission-1",
        InteractionState::Approved,
        InteractionResponse::Permission {
            accepted: true,
            option_id: Some("allow".to_string()),
            reply: Some("once".to_string()),
        },
    )
    .await
    .unwrap();

    let events = SessionJournalEventRepository::list_serialized(&db, "session-priority")
        .await
        .expect("list journal events");
    assert_eq!(events.len(), 2);
    assert!(events
        .iter()
        .any(|event| event.event_kind == "interaction_transition"));
}

#[tokio::test]
async fn resume_requires_canonical_transcript_snapshot() {
    let db = setup_test_db().await;

    let error = load_transcript_snapshot_for_resume(&db, "missing-session")
        .await
        .expect_err("missing canonical transcript should error");

    let SerializableAcpError::InvalidState { message } = error else {
        panic!("expected invalid state error");
    };
    assert!(message.contains("Missing canonical transcript snapshot"));
}

#[tokio::test]
async fn resume_returns_empty_transcript_without_provider_or_journal_history() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "resume-session",
        "/project",
        "claude-code",
        None,
    )
    .await
    .expect("seed metadata");

    let transcript = load_transcript_snapshot_for_resume(&db, "resume-session")
        .await
        .expect("load transcript snapshot");

    assert_eq!(transcript.revision, 0);
}

#[tokio::test]
async fn resume_rebuilds_completed_assistant_transcript_from_local_journal() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "journal-transcript-session",
        "/project",
        "claude-code",
        None,
    )
    .await
    .expect("seed metadata");

    SessionEventWriter::commit_session_update(
        &db,
        "journal-transcript-session",
        &SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Ra".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            parent_tool_use_id: None,
            session_id: Some("journal-transcript-session".to_string()),
            produced_at_monotonic_ms: None,
        },
    )
    .await
    .expect("append first assistant chunk");
    SessionEventWriter::commit_session_update(
        &db,
        "journal-transcript-session",
        &SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "incoats survive resume".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            parent_tool_use_id: None,
            session_id: Some("journal-transcript-session".to_string()),
            produced_at_monotonic_ms: None,
        },
    )
    .await
    .expect("append second assistant chunk");
    SessionEventWriter::commit_session_update(
        &db,
        "journal-transcript-session",
        &SessionUpdate::TurnComplete {
            session_id: Some("journal-transcript-session".to_string()),
            turn_id: Some("turn-1".to_string()),
        },
    )
    .await
    .expect("append turn complete");

    let transcript = load_transcript_snapshot_for_resume(&db, "journal-transcript-session")
        .await
        .expect("load transcript snapshot");
    let assistant_text = transcript
        .entries
        .iter()
        .filter(|entry| {
            entry.role == crate::acp::transcript_projection::TranscriptEntryRole::Assistant
        })
        .flat_map(|entry| entry.segments.iter())
        .map(|segment| segment.primary_text())
        .collect::<String>();

    assert_eq!(assistant_text, "Raincoats survive resume");
}

#[tokio::test]
async fn resume_does_not_trust_partial_local_transcript_without_terminal_turn() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "partial-journal-transcript-session",
        "/project",
        "claude-code",
        None,
    )
    .await
    .expect("seed metadata");

    SessionEventWriter::commit_session_update(
        &db,
        "partial-journal-transcript-session",
        &SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Ra".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            parent_tool_use_id: None,
            session_id: Some("partial-journal-transcript-session".to_string()),
            produced_at_monotonic_ms: None,
        },
    )
    .await
    .expect("append partial assistant chunk");

    let transcript = load_transcript_snapshot_for_resume(&db, "partial-journal-transcript-session")
        .await
        .expect("load transcript snapshot");

    assert!(transcript.entries.is_empty());
}

#[tokio::test]
async fn live_session_graph_revision_keeps_transcript_frontier_distinct() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(&db, "live-session", "/project", "claude-code", None)
        .await
        .expect("seed metadata");
    SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
        .await
        .expect("append barrier 1");
    SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
        .await
        .expect("append barrier 2");
    SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
        .await
        .expect("append barrier 3");
    SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
        .await
        .expect("append barrier 4");
    SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
        .await
        .expect("append barrier 5");

    let revision = load_live_session_graph_revision(
        &db,
        &crate::acp::transcript_projection::TranscriptProjectionRegistry::new(),
        None,
        "live-session",
    )
    .await
    .expect("load live graph revision");

    assert_eq!(revision.graph_revision, 5);
    assert_eq!(revision.transcript_revision, 0);
    assert_eq!(revision.last_event_seq, 5);
}

#[tokio::test]
async fn live_session_graph_revision_prefers_runtime_owned_graph_counter() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(&db, "live-session", "/project", "claude-code", None)
        .await
        .expect("seed metadata");
    SessionJournalEventRepository::append_materialization_barrier(&db, "live-session")
        .await
        .expect("append barrier");

    let runtime_registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&runtime_registry, "live-session", 8);
    runtime_registry.apply_session_update_with_graph_seed(
        "live-session",
        8,
        &SessionUpdate::ConnectionFailed {
            session_id: "live-session".to_string(),
            attempt_id: 1,
            error: "disconnected".to_string(),
            failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
        },
    );

    let revision = load_live_session_graph_revision(
        &db,
        &crate::acp::transcript_projection::TranscriptProjectionRegistry::new(),
        Some(&runtime_registry),
        "live-session",
    )
    .await
    .expect("load live graph revision");

    assert_eq!(revision.graph_revision, 9);
    assert_eq!(revision.transcript_revision, 0);
    assert_eq!(revision.last_event_seq, 1);
}

#[tokio::test]
async fn state_lookup_returns_empty_transcript_without_provider_backed_content() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(&db, "state-session", "/project", "claude-code", None)
        .await
        .expect("seed metadata");
    SessionJournalEventRepository::append_materialization_barrier(&db, "state-session")
        .await
        .expect("append state frontier barrier");

    let replay_context = replay_context_for_session(&db, "state-session").await;
    let transcript = load_transcript_snapshot_for_state_lookup(
        &db,
        &TranscriptProjectionRegistry::new(),
        "state-session",
        "state-session",
        Some(&replay_context),
        1,
    )
    .await
    .expect("load transcript snapshot");

    assert_eq!(transcript.revision, 1);
    assert!(transcript.entries.is_empty());
}

#[tokio::test]
async fn state_lookup_rebuilds_completed_transcript_from_local_journal() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "state-journal-session",
        "/project",
        "copilot",
        None,
    )
    .await
    .expect("seed metadata");

    let updates = vec![
        SessionUpdate::UserMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hi".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some("state-journal-session".to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Hello there.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some("state-journal-session".to_string()),
            produced_at_monotonic_ms: None,
        },
        SessionUpdate::TurnComplete {
            session_id: Some("state-journal-session".to_string()),
            turn_id: Some("turn-1".to_string()),
        },
        SessionUpdate::UserMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "second question".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some("state-journal-session".to_string()),
            attempt_id: Some("attempt-2".to_string()),
        },
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Second answer.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-2".to_string()),
            parent_tool_use_id: None,
            session_id: Some("state-journal-session".to_string()),
            produced_at_monotonic_ms: None,
        },
        SessionUpdate::TurnComplete {
            session_id: Some("state-journal-session".to_string()),
            turn_id: Some("turn-2".to_string()),
        },
    ];
    for update in updates {
        SessionEventWriter::commit_session_update(&db, "state-journal-session", &update)
            .await
            .expect("append journal update");
    }

    let replay_context = replay_context_for_session(&db, "state-journal-session").await;
    let transcript = load_transcript_snapshot_for_state_lookup(
        &db,
        &TranscriptProjectionRegistry::new(),
        "state-journal-session",
        "state-journal-session",
        Some(&replay_context),
        6,
    )
    .await
    .expect("load transcript snapshot");

    let transcript_text = transcript
        .entries
        .iter()
        .flat_map(|entry| entry.segments.iter())
        .map(|segment| segment.primary_text())
        .collect::<Vec<_>>();

    assert_eq!(transcript.revision, 5);
    assert_eq!(
        transcript_text,
        vec!["hi", "Hello there.", "second question", "Second answer."]
    );
}

#[test]
fn runtime_snapshot_for_refresh_prefers_runtime_registry_state() {
    let registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&registry, "session-1", 0);
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ConnectionComplete {
            session_id: "session-1".to_string(),
            attempt_id: 1,
            models: crate::acp::client_session::default_session_model_state(),
            modes: crate::acp::client_session::default_modes(),
            available_commands: Some(vec![crate::acp::session_update::AvailableCommand {
                name: "compact".to_string(),
                description: "Compact".to_string(),
                input: None,
            }]),
            config_options: Some(Vec::new()),
            autonomous_enabled: Some(false),
        },
    );

    let snapshot = runtime_snapshot_for_refresh(Some(&registry), "session-1");

    assert_eq!(
        snapshot.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Ready
    );
    assert_eq!(
        snapshot
            .capabilities
            .available_commands
            .as_ref()
            .expect("available commands")
            .len(),
        1
    );
}

#[test]
fn runtime_snapshot_for_refresh_defaults_without_live_runtime_state() {
    let snapshot = runtime_snapshot_for_refresh(None, "session-1");

    assert_eq!(snapshot.graph_revision, 0);
    assert!(snapshot.capabilities.modes.is_none());
    assert!(snapshot.capabilities.available_commands.is_none());
}

#[test]
fn state_lookup_without_live_runtime_closes_stale_running_turn() {
    let authority = resolve_state_lookup_authority(
        false,
        true,
        crate::acp::projections::SessionTurnState::Running,
        Vec::new(),
        Vec::new(),
        None,
    );

    assert_eq!(
        authority.turn_state,
        crate::acp::projections::SessionTurnState::Completed
    );
    assert!(authority.active_turn_failure.is_none());
}

#[test]
fn state_lookup_with_live_runtime_preserves_running_turn() {
    let authority = resolve_state_lookup_authority(
        true,
        true,
        crate::acp::projections::SessionTurnState::Running,
        Vec::new(),
        Vec::new(),
        None,
    );

    assert_eq!(
        authority.turn_state,
        crate::acp::projections::SessionTurnState::Running
    );
}

#[tokio::test]
async fn resume_returns_empty_transcript_for_existing_empty_session() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(&db, "empty-session", "/project", "claude-code", None)
        .await
        .expect("seed metadata");

    let transcript = load_transcript_snapshot_for_resume(&db, "empty-session")
        .await
        .expect("empty persisted session should resume");

    assert_eq!(transcript.revision, 0);
    assert!(transcript.entries.is_empty());
}

#[tokio::test]
async fn resume_returns_empty_transcript_for_barrier_only_session() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "barrier-only-session",
        "/project",
        "claude-code",
        None,
    )
    .await
    .expect("seed metadata");
    SessionJournalEventRepository::append_materialization_barrier(&db, "barrier-only-session")
        .await
        .expect("append barrier");

    let transcript = load_transcript_snapshot_for_resume(&db, "barrier-only-session")
        .await
        .expect("barrier-only session should resume");

    assert_eq!(transcript.revision, 1);
    assert!(transcript.entries.is_empty());
}

#[tokio::test]
async fn resume_returns_empty_transcript_for_known_session_without_snapshot() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "journal-only-session",
        "/project",
        "claude-code",
        None,
    )
    .await
    .expect("seed metadata");
    SessionJournalEventRepository::append_materialization_barrier(&db, "journal-only-session")
        .await
        .expect("append barrier");
    SessionJournalEventRepository::append_materialization_barrier(&db, "journal-only-session")
        .await
        .expect("append second barrier");

    let transcript = load_transcript_snapshot_for_resume(&db, "journal-only-session")
        .await
        .expect("known session without snapshot should resume");

    assert_eq!(transcript.revision, 2);
    assert!(transcript.entries.is_empty());
}

#[tokio::test]
async fn resume_resolution_prefers_persisted_agent_over_ui_agent_selection() {
    let db = setup_test_db().await;

    SessionMetadataRepository::ensure_exists(
        &db,
        "session-copilot",
        "/project",
        "copilot",
        Some("/project/.worktrees/feature-a"),
    )
    .await
    .unwrap();

    let resolved =
        resolve_resume_session_target(&db, None, "session-copilot", "/fallback-project", None)
            .await
            .expect("resume target");

    assert_eq!(resolved.descriptor.agent_id, CanonicalAgentId::Copilot);
    assert_eq!(
        resolved.descriptor.compatibility,
        SessionDescriptorCompatibility::Canonical
    );
    assert_eq!(
        resolved.descriptor.effective_cwd,
        "/project/.worktrees/feature-a"
    );
}

#[tokio::test]
async fn resume_resolution_rejects_existing_session_with_incompatible_override() {
    let db = setup_test_db().await;

    SessionMetadataRepository::ensure_exists(&db, "session-copilot", "/project", "copilot", None)
        .await
        .unwrap();

    let error = resolve_resume_session_target(
        &db,
        None,
        "session-copilot",
        "/fallback-project",
        Some("claude-code"),
    )
    .await
    .expect_err("override should fail");

    match error {
        SerializableAcpError::ProtocolError { message } => {
            assert_eq!(
                    message,
                    "session session-copilot is bound to copilot and cannot resume with override claude-code"
                );
        }
        other => panic!("expected protocol error, got {:?}", other),
    }
}

#[test]
fn requested_agent_resolution_prefers_explicit_override() {
    let resolved = resolve_requested_agent_id(Some("copilot"), Some(CanonicalAgentId::ClaudeCode));

    assert_eq!(resolved, CanonicalAgentId::Copilot);
}

#[tokio::test]
async fn fork_resolution_prefers_source_descriptor_agent_over_active_agent() {
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
    let canonical_worktree_path = worktree_path
        .canonicalize()
        .unwrap_or_else(|_| worktree_path.clone());

    persist_session_metadata_for_cwd(
        &db,
        "session-copilot",
        &CanonicalAgentId::Copilot,
        &worktree_path,
    )
    .await
    .unwrap();

    let resolved = resolve_fork_session_target(&db, "session-copilot", "/fallback-project", None)
        .await
        .expect("fork target");

    assert_eq!(resolved.launch_agent_id, CanonicalAgentId::Copilot);
    assert_eq!(resolved.fork_parent_session_id, "session-copilot");
    assert_eq!(
        resolved.launch_cwd,
        canonical_worktree_path.to_string_lossy()
    );
}

#[tokio::test]
async fn fork_resolution_uses_canonical_provider_id_for_claude_sessions() {
    let db = setup_test_db().await;

    SessionMetadataRepository::ensure_exists(
        &db,
        "provider-session-1",
        "/project",
        "claude-code",
        None,
    )
    .await
    .unwrap();

    let resolved =
        resolve_fork_session_target(&db, "provider-session-1", "/fallback-project", None)
            .await
            .expect("fork target");

    assert_eq!(resolved.launch_agent_id, CanonicalAgentId::ClaudeCode);
    assert_eq!(resolved.fork_parent_session_id, "provider-session-1");
}

#[tokio::test]
async fn fork_resolution_allows_intentional_override_without_ui_leak() {
    let db = setup_test_db().await;

    SessionMetadataRepository::ensure_exists(&db, "session-copilot", "/project", "copilot", None)
        .await
        .unwrap();

    let resolved =
        resolve_fork_session_target(&db, "session-copilot", "/fallback-project", Some("cursor"))
            .await
            .expect("fork target");

    assert_eq!(resolved.launch_agent_id, CanonicalAgentId::Cursor);
    assert_eq!(resolved.fork_parent_session_id, "session-copilot");
}
