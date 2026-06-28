use super::*;
use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::{InteractionState, OperationSourceLink, SessionTurnState};
use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::session_update::{
    AvailableCommand, ToolArguments, ToolCallData, ToolCallStatus, ToolKind, TurnErrorKind,
    TurnErrorSource,
};
use crate::acp::transcript_projection::{
    TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::{SessionJournalEventRepository, SessionMetadataRepository};
use crate::session_jsonl::types::{
    StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    StoredErrorMessage, StoredUserMessage,
};
use sea_orm::{Database, DbConn};
use sea_orm_migration::MigratorTrait;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

async fn setup_db() -> DbConn {
    let db = Database::connect("sqlite::memory:")
        .await
        .expect("in-memory db");
    crate::db::migrations::Migrator::up(&db, None)
        .await
        .expect("migrations");
    db
}

fn make_hub() -> Arc<AcpEventHubState> {
    Arc::new(AcpEventHubState::new())
}

fn new_session_open_input(
    session_id: &str,
    capabilities: SessionGraphCapabilities,
) -> NewSessionOpenResultInput {
    NewSessionOpenResultInput {
        session_id: session_id.to_string(),
        agent_id: CanonicalAgentId::Copilot,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        lifecycle: SessionGraphLifecycle::reserved(),
        capabilities,
    }
}

async fn seed_session_metadata(db: &DbConn, session_id: &str, agent_id: &str) {
    SessionMetadataRepository::ensure_exists(db, session_id, "/test/project", agent_id, None)
        .await
        .expect("seed metadata");
}

async fn append_frontier_barrier(db: &DbConn, session_id: &str) {
    SessionJournalEventRepository::append_materialization_barrier(db, session_id)
        .await
        .expect("append barrier event");
}

fn replay_context_for_session(
    session_id: &str,
    agent_id: CanonicalAgentId,
) -> SessionReplayContext {
    let project_path = "/test/project".to_string();
    SessionReplayContext {
        local_session_id: session_id.to_string(),
        history_session_id: session_id.to_string(),
        agent_id: agent_id.clone(),
        parser_agent_type: crate::acp::parsers::AgentType::from_canonical(&agent_id),
        project_path: project_path.clone(),
        worktree_path: None,
        effective_cwd: project_path,
        source_path: None,
        compatibility: SessionDescriptorCompatibility::Canonical,
    }
}

fn provider_owned_agents_with_history_replay() -> Vec<CanonicalAgentId> {
    vec![
        CanonicalAgentId::ClaudeCode,
        CanonicalAgentId::Copilot,
        CanonicalAgentId::Cursor,
        CanonicalAgentId::OpenCode,
        CanonicalAgentId::Codex,
    ]
}

fn make_tool_call_entry(id: &str) -> StoredEntry {
    StoredEntry::ToolCall {
        id: id.to_string(),
        message: ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/provider/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Completed,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some("Read file".to_string()),
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
        timestamp: None,
    }
}

fn make_sparse_tool_call_entry(id: &str) -> StoredEntry {
    StoredEntry::ToolCall {
        id: format!("{id}-sparse-entry"),
        message: ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/provider/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Completed,
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
        timestamp: None,
    }
}

fn make_running_tool_call_entry(id: &str) -> StoredEntry {
    StoredEntry::ToolCall {
        id: id.to_string(),
        message: ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/provider/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::InProgress,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some("Read file".to_string()),
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
        timestamp: None,
    }
}

fn make_pending_plan_approval_entry(id: &str) -> StoredEntry {
    StoredEntry::ToolCall {
        id: id.to_string(),
        message: ToolCallData {
            id: id.to_string(),
            name: "create_plan".to_string(),
            arguments: ToolArguments::Other {
                raw: json!({}),
                intent: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::CreatePlan),
            title: Some("Create plan".to_string()),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: true,
            plan_approval_request_id: Some(42),
        },
        timestamp: None,
    }
}

fn make_provider_thread_snapshot(entry_id: &str, title: &str) -> SessionThreadSnapshot {
    SessionThreadSnapshot {
        entries: vec![make_tool_call_entry(entry_id)],
        title: title.to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    }
}

fn make_text_block(text: &str) -> StoredContentBlock {
    StoredContentBlock {
        block_type: "text".to_string(),
        text: Some(text.to_string()),
    }
}

fn make_user_entry(id: &str, text: &str) -> StoredEntry {
    StoredEntry::User {
        id: id.to_string(),
        message: StoredUserMessage {
            id: Some(id.to_string()),
            content: make_text_block(text),
            chunks: vec![make_text_block(text)],
            sent_at: None,
        },
        timestamp: None,
    }
}

fn make_assistant_entry(id: &str, text: &str) -> StoredEntry {
    StoredEntry::Assistant {
        id: id.to_string(),
        message: StoredAssistantMessage {
            chunks: vec![StoredAssistantChunk {
                chunk_type: "message".to_string(),
                block: make_text_block(text),
            }],
            model: None,
            display_model: None,
            received_at: None,
        },
        timestamp: None,
    }
}

fn make_provider_pipeline_snapshot(agent_id: &CanonicalAgentId) -> SessionThreadSnapshot {
    let agent_name = agent_id.as_str();
    SessionThreadSnapshot {
        entries: vec![
            make_user_entry(
                &format!("{agent_name}-user-1"),
                &format!("restore {agent_name} session"),
            ),
            make_tool_call_entry(&format!("{agent_name}-tool-read")),
        ],
        title: format!("Restore {agent_name} session"),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    }
}

fn make_error_entry(id: &str, text: &str) -> StoredEntry {
    StoredEntry::Error {
        id: id.to_string(),
        message: StoredErrorMessage {
            content: text.to_string(),
            code: Some("401".to_string()),
            kind: TurnErrorKind::Fatal,
            source: Some(TurnErrorSource::Transport),
        },
        timestamp: None,
    }
}

// -----------------------------------------------------------------------
// Happy path: new session returns found with empty state and seq=0
// -----------------------------------------------------------------------
#[tokio::test]
async fn new_session_returns_found_with_empty_state_and_seq_zero() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "new-session-abc123";
    let capabilities = SessionGraphCapabilities {
        models: None,
        modes: None,
        available_commands: Some(vec![AvailableCommand {
            name: "list".to_string(),
            description: "List files".to_string(),
            input: None,
        }]),
        config_options: Some(Vec::new()),
        autonomous_enabled: Some(true),
    };

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, capabilities.clone()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.canonical_session_id, session_id);
    assert_eq!(found.requested_session_id, session_id);
    assert!(!found.is_alias);
    assert_eq!(found.last_event_seq, 0);
    assert_eq!(found.transcript_snapshot.revision, 0);
    assert!(found.transcript_snapshot.entries.is_empty());
    assert!(found.operations.is_empty());
    assert!(found.interactions.is_empty());
    assert_eq!(found.turn_state, SessionTurnState::Idle);
    assert_eq!(found.message_count, 0);
    assert_eq!(
        found.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Reserved
    );
    assert!(!found.lifecycle.actionability.can_send);
    assert_eq!(
        found
            .capabilities
            .available_commands
            .as_ref()
            .expect("available commands")
            .len(),
        1
    );
    assert_eq!(found.capabilities.autonomous_enabled, Some(true));
    // open_token must be a valid UUID
    assert!(Uuid::parse_str(&found.open_token).is_ok());
}

// -----------------------------------------------------------------------
// Edge case: new session with pre-existing journal event returns proven seq
// -----------------------------------------------------------------------
#[tokio::test]
async fn new_session_with_seed_journal_event_returns_proven_seq() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "new-with-seed-abc";
    seed_session_metadata(&db, session_id, "copilot").await;
    // Simulate a seed journal event already persisted before open completes
    append_frontier_barrier(&db, session_id).await;

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 1, "seed event should yield seq=1");
}

#[tokio::test]
async fn new_session_open_result_rebuilds_completed_local_journal_transcript() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "local-journal-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hi".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "Hi!".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "do you have access to the tauri mcp ?".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-2".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "No — I don't see a Tauri MCP server.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-2".to_string()),
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-2".to_string()),
        },
    ];
    for update in journal_updates {
        SessionJournalEventRepository::append_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let text = found
        .transcript_snapshot
        .entries
        .iter()
        .flat_map(|entry| entry.segments.iter())
        .map(|segment| segment.primary_text())
        .collect::<Vec<_>>();

    assert_eq!(found.last_event_seq, 6);
    assert_eq!(found.message_count, 4);
    assert_eq!(found.transcript_snapshot.revision, 5);
    assert_eq!(
        text,
        vec![
            "hi",
            "Hi!",
            "do you have access to the tauri mcp ?",
            "No — I don't see a Tauri MCP server."
        ]
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_does_not_require_local_snapshot_tables() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-translated-open";
    seed_session_metadata(&db, session_id, "copilot").await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = make_provider_thread_snapshot("provider-read", "Provider title");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);
    let expected_transcript =
        TranscriptSnapshot::from_stored_entries(1, &provider_snapshot.entries);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 1);
    assert_eq!(found.transcript_snapshot.revision, 1);
    assert_eq!(found.transcript_snapshot, expected_transcript);
    assert_eq!(
        found.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Detached
    );
    assert!(found.lifecycle.actionability.can_resume);
    assert!(found.capabilities.available_commands.is_none());
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-read");
    assert_eq!(operation.kind, Some(ToolKind::Read));
    assert_eq!(operation.provider_status, ToolCallStatus::Completed);
    assert_eq!(operation.title.as_deref(), Some("Read file"));
    assert!(matches!(
        operation.arguments,
        ToolArguments::Read {
            file_path: Some(ref file_path),
            ..
        } if file_path == "/provider/README.md"
    ));
}

#[tokio::test]
async fn provider_thread_snapshot_open_prefers_completed_local_journal_transcript() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-stale-local-journal-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hi".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "Hello there.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "second question".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-2".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "Second answer.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-2".to_string()),
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-2".to_string()),
        },
    ];
    for update in journal_updates {
        SessionJournalEventRepository::append_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }

    let stale_provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_user_entry("provider-user-1", "hi"),
            make_assistant_entry("provider-assistant-1", "Hello there."),
        ],
        title: "Stale provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &stale_provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let text = found
        .transcript_snapshot
        .entries
        .iter()
        .flat_map(|entry| entry.segments.iter())
        .map(|segment| segment.primary_text())
        .collect::<Vec<_>>();

    assert_eq!(found.last_event_seq, 6);
    assert_eq!(found.message_count, 4);
    assert_eq!(found.transcript_snapshot.revision, 5);
    assert_eq!(
        text,
        vec!["hi", "Hello there.", "second question", "Second answer."]
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_keeps_provider_tool_rows_with_local_journal_transcript() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-local-journal-with-skill-tool-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "Can you diagnose this?".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "The user is invoking the diagnose skill.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
    ];
    for update in journal_updates {
        SessionJournalEventRepository::append_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_user_entry("provider-user-1", "Can you diagnose this?"),
            make_assistant_entry(
                "provider-assistant-1",
                "The user is invoking the diagnose skill.",
            ),
            StoredEntry::ToolCall {
                id: "toolu_skill".to_string(),
                message: ToolCallData {
                    id: "toolu_skill".to_string(),
                    name: "skill".to_string(),
                    arguments: ToolArguments::Think {
                        description: None,
                        prompt: None,
                        subagent_type: None,
                        skill: Some("diagnose".to_string()),
                        skill_args: None,
                        raw: Some(json!({ "skill": "diagnose" })),
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Completed,
                    result: Some(json!({ "content": "Skill loaded" })),
                    kind: Some(ToolKind::Skill),
                    title: Some("diagnose".to_string()),
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
                timestamp: None,
            },
            make_assistant_entry("provider-assistant-2", "I will diagnose it."),
        ],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };

    let roles = found
        .transcript_snapshot
        .entries
        .iter()
        .map(|entry| entry.role.clone())
        .collect::<Vec<_>>();
    let tool_entry = found
        .transcript_snapshot
        .entries
        .iter()
        .find(|entry| entry.role == TranscriptEntryRole::Tool)
        .expect("skill tool transcript row should survive local transcript merge");

    assert_eq!(
        roles,
        vec![
            TranscriptEntryRole::User,
            TranscriptEntryRole::Assistant,
            TranscriptEntryRole::Tool,
        ]
    );
    assert_eq!(
        tool_entry.segments,
        vec![TranscriptSegment::Text {
            segment_id: "acepe::entry::assistant-boundary:1::tool::toolu_skill:tool".to_string(),
            text: "diagnose".to_string(),
        }]
    );
    assert!(found
        .operations
        .iter()
        .any(|operation| operation.tool_call_id == "toolu_skill"
            && operation.kind == Some(ToolKind::Skill)));
}

#[tokio::test]
async fn provider_thread_snapshot_open_includes_new_user_message_after_last_complete_turn() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-stale-local-journal-incomplete-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "first question".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "First answer.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "missing question".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-2".to_string()),
        },
    ];
    for update in journal_updates {
        SessionJournalEventRepository::append_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }

    let stale_provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_user_entry("provider-user-1", "first question"),
            make_assistant_entry("provider-assistant-1", "First answer."),
        ],
        title: "Stale provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &stale_provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let text = found
        .transcript_snapshot
        .entries
        .iter()
        .flat_map(|entry| entry.segments.iter())
        .map(|segment| segment.primary_text())
        .collect::<Vec<_>>();

    assert_eq!(found.last_event_seq, 4);
    assert_eq!(found.message_count, 3);
    assert_eq!(found.transcript_snapshot.revision, 4);
    assert_eq!(
        text,
        vec!["first question", "First answer.", "missing question"]
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_returns_claimable_reconnect_token() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-snapshot-only-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let provider_snapshot = make_provider_thread_snapshot("provider-read", "Provider title");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("open token must be a UUID");
    assert!(
        hub.has_reservation_for_session(token, session_id),
        "historical provider opens must reserve the reconnect token"
    );
}

#[tokio::test]
async fn provider_owned_open_pipeline_restores_each_builtin_agent_to_canonical_state() {
    for agent_id in provider_owned_agents_with_history_replay() {
        let db = setup_db().await;
        let hub = make_hub();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let session_id = format!("{}-pipeline-session", agent_id.as_str());
        seed_session_metadata(&db, &session_id, agent_id.as_str()).await;
        append_frontier_barrier(&db, &session_id).await;

        let provider_snapshot = ProviderOwnedSessionSnapshot::from_thread_snapshot(
            make_provider_pipeline_snapshot(&agent_id),
        );
        let replay_context = replay_context_for_session(&session_id, agent_id.clone());

        let result = session_open_result_from_provider_owned_snapshot(
            &db,
            &hub,
            Some(&runtime_registry),
            &replay_context,
            &session_id,
            &provider_snapshot,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found for {}, got {result:?}", agent_id.as_str());
        };
        assert_eq!(found.agent_id, agent_id);
        assert_eq!(found.canonical_session_id, session_id);
        assert_eq!(found.last_event_seq, 1);
        assert!(found.graph_revision >= found.last_event_seq);
        assert_eq!(found.transcript_snapshot.revision, 1);
        assert_eq!(found.transcript_snapshot.entries.len(), 2);
        assert_eq!(
            found.transcript_snapshot.entries[0].role,
            TranscriptEntryRole::User
        );
        assert_eq!(
            found.transcript_snapshot.entries[1].role,
            TranscriptEntryRole::Tool
        );
        assert_eq!(found.operations.len(), 1);
        assert_eq!(
            found.operations[0].source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: format!(
                    "acepe::entry::assistant-boundary:1::tool::{}-tool-read",
                    agent_id.as_str()
                )
            }
        );
        assert_eq!(
            found.lifecycle.status,
            crate::acp::lifecycle::LifecycleStatus::Detached
        );
        assert!(found.lifecycle.actionability.can_resume);
        assert!(!found.lifecycle.actionability.can_send);

        let token = Uuid::parse_str(&found.open_token).expect("open token must be a UUID");
        assert!(
            hub.has_reservation_for_session(token, &session_id),
            "open token should be reserved for {}",
            agent_id.as_str()
        );

        let runtime_snapshot = runtime_registry.snapshot_for_session(&session_id);
        assert_eq!(runtime_snapshot.graph_revision, found.graph_revision);
        assert_eq!(
            runtime_snapshot.lifecycle.status,
            crate::acp::lifecycle::LifecycleStatus::Detached
        );
    }
}

#[tokio::test]
async fn provider_thread_snapshot_open_normalizes_tool_transcript_ids_to_match_operations() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-normalized-tool-open";
    seed_session_metadata(&db, session_id, "cursor").await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot =
        make_provider_thread_snapshot("provider-tool\ncursor-call", "Provider title");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Cursor);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.transcript_snapshot.entries.len(), 1);
    assert_eq!(
        found.transcript_snapshot.entries[0].entry_id,
        "acepe::entry::session-start::tool::provider-tool%0Acursor-call"
    );
    assert_eq!(
        found.transcript_snapshot.entries[0].segments,
        vec![crate::acp::transcript_projection::TranscriptSegment::Text {
            segment_id: "acepe::entry::session-start::tool::provider-tool%0Acursor-call:tool"
                .to_string(),
            text: "Read file".to_string(),
        }]
    );
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-tool%0Acursor-call");
    assert_eq!(
        operation.source_link,
        crate::acp::projections::OperationSourceLink::TranscriptLinked {
            entry_id: "acepe::entry::session-start::tool::provider-tool%0Acursor-call".to_string()
        }
    );
    assert_ne!(
        operation.operation_state,
        crate::acp::projections::OperationState::Degraded
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_titles_placeholder_metadata_from_first_user_message() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "b859c458-ca4f-4c31-a3aa-6c606a1c065f";
    seed_session_metadata(&db, session_id, "claude-code").await;
    append_frontier_barrier(&db, session_id).await;

    let snapshot = SessionThreadSnapshot {
        entries: vec![make_user_entry(
            "user-1",
            "please enable anti alias in acepe.",
        )],
        title: "Session b859c458".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::ClaudeCode);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.session_title, "please enable anti alias in acepe.");
}

#[tokio::test]
async fn provider_thread_snapshot_open_keeps_renamed_title_over_first_user_message() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "renamed-session-title";
    seed_session_metadata(&db, session_id, "claude-code").await;
    SessionMetadataRepository::set_title_override(&db, session_id, Some("Renamed by user"))
        .await
        .expect("set title override");
    append_frontier_barrier(&db, session_id).await;

    let snapshot = SessionThreadSnapshot {
        entries: vec![make_user_entry(
            "user-1",
            "please enable anti alias in acepe.",
        )],
        title: "please enable anti alias in acepe.".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::ClaudeCode);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.session_title, "Renamed by user");
}

#[tokio::test]
async fn provider_thread_snapshot_open_restores_runtime_lifecycle_for_attach() {
    let db = setup_db().await;
    let hub = make_hub();
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let session_id = "provider-open-runtime-restore";
    seed_session_metadata(&db, session_id, "copilot").await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = make_provider_thread_snapshot("provider-read", "Provider title");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        Some(&runtime_registry),
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let runtime_snapshot = runtime_registry.snapshot_for_session(session_id);

    assert_eq!(runtime_snapshot.graph_revision, found.graph_revision);
    assert_eq!(
        runtime_snapshot.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Detached
    );
    assert_eq!(
        runtime_snapshot.lifecycle.detached_reason,
        Some(crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach)
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_merges_replayed_operation_evidence() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-duplicate-operation-open";
    seed_session_metadata(&db, session_id, "copilot").await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_tool_call_entry("provider-read"),
            make_sparse_tool_call_entry("provider-read"),
        ],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-read");
    assert_eq!(operation.title.as_deref(), Some("Read file"));
    assert_eq!(operation.kind, Some(ToolKind::Read));
    assert_eq!(operation.provider_status, ToolCallStatus::Completed);
}

#[tokio::test]
async fn provider_thread_snapshot_open_downgrades_stale_active_operations_when_journal_is_ahead() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-stale-active-operation-open";
    seed_session_metadata(&db, session_id, "copilot").await;
    append_frontier_barrier(&db, session_id).await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![make_running_tool_call_entry("provider-read")],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 2);
    assert_eq!(found.turn_state, SessionTurnState::Idle);
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(
        operation.operation_state,
        crate::acp::projections::OperationState::Degraded
    );
    assert_eq!(
        operation
            .degradation_reason
            .as_ref()
            .map(|reason| reason.code.clone()),
        Some(crate::acp::projections::OperationDegradationCode::AbsentFromHistory)
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_closes_historical_active_operation_without_journal_gap() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-historical-active-operation-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![make_running_tool_call_entry("provider-read")],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-read");
    assert_eq!(operation.provider_status, ToolCallStatus::InProgress);
    assert_eq!(
        operation.operation_state,
        crate::acp::projections::OperationState::Cancelled
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_does_not_reopen_tool_interrupted_by_later_user_message() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-user-boundary-tool-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_running_tool_call_entry("provider-write"),
            make_user_entry("user-resumed", "i ran the command myself, proceed"),
        ],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert!(!found.lifecycle.actionability.can_send);
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-write");
    assert_eq!(operation.provider_status, ToolCallStatus::InProgress);
    assert_eq!(
        operation.operation_state,
        crate::acp::projections::OperationState::Cancelled
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_marks_historical_pending_interactions_unresolved() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-historical-pending-interaction-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![make_pending_plan_approval_entry("provider-plan")],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert_eq!(found.interactions.len(), 1);
    let interaction = &found.interactions[0];
    assert_eq!(interaction.state, InteractionState::Unresolved);
    assert!(interaction.reply_handler.is_none());
    assert_eq!(found.operations.len(), 1);
    assert_eq!(
        found.operations[0].operation_state,
        crate::acp::projections::OperationState::Cancelled
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_does_not_reactivate_stale_historical_error() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-stale-error-open";
    seed_session_metadata(&db, session_id, "claude-code").await;
    append_frontier_barrier(&db, session_id).await;
    append_frontier_barrier(&db, session_id).await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_user_entry("user-1", "hi"),
            make_error_entry(
                "error-1",
                "Failed to authenticate. API Error: 401 {\"error\":{\"message\":\"User not found.\",\"code\":401}}",
            ),
        ],
        title: "hi".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::ClaudeCode);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 3);
    assert_eq!(found.graph_revision, 3);
    assert_eq!(found.turn_state, SessionTurnState::Idle);
    assert!(found.active_turn_failure.is_none());
    assert_eq!(found.transcript_snapshot.entries.len(), 1);
}

#[tokio::test]
async fn provider_thread_snapshot_open_marks_alias_request_without_rewriting_canonical_id() {
    let db = setup_db().await;
    let hub = make_hub();
    let canonical_session_id = "canonical-provider-session";
    let requested_session_id = "provider-session-alias";
    seed_session_metadata(&db, canonical_session_id, "copilot").await;
    let provider_snapshot = make_provider_thread_snapshot("provider-read", "Provider title");
    let replay_context =
        replay_context_for_session(canonical_session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        requested_session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert!(found.is_alias);
    assert_eq!(found.requested_session_id, requested_session_id);
    assert_eq!(found.canonical_session_id, canonical_session_id);
}

#[tokio::test]
async fn provider_owned_alias_open_keys_viewport_authority_to_canonical_id_only() {
    let db = setup_db().await;
    let hub = make_hub();
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let projection_registry = crate::acp::projections::ProjectionRegistry::new();
    let transcript_projection_registry =
        crate::acp::transcript_projection::TranscriptProjectionRegistry::new();
    let canonical_session_id = "canonical-provider-owned-session";
    let requested_session_id = "provider-owned-session-alias";
    seed_session_metadata(&db, canonical_session_id, "copilot").await;
    append_frontier_barrier(&db, canonical_session_id).await;

    let provider_snapshot = ProviderOwnedSessionSnapshot::from_thread_snapshot(
        make_provider_pipeline_snapshot(&CanonicalAgentId::Copilot),
    );
    let replay_context =
        replay_context_for_session(canonical_session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_provider_owned_snapshot(
        &db,
        &hub,
        Some(&runtime_registry),
        &replay_context,
        requested_session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert!(found.is_alias);

    // Mirror restore_session_open_authority: canonical-keyed transcript +
    // projection registries are the sole viewport authority.
    transcript_projection_registry.restore_session_snapshot(
        found.canonical_session_id.clone(),
        found.transcript_snapshot.clone(),
    );
    projection_registry.restore_session_projection(
        crate::acp::projections::SessionProjectionSnapshot {
            session: Some(crate::acp::projections::SessionSnapshot {
                session_id: found.canonical_session_id.clone(),
                agent_id: Some(found.agent_id.clone()),
                last_event_seq: found.last_event_seq,
                turn_state: found.turn_state.clone(),
                message_count: found.message_count,
                active_tool_call_ids: Vec::new(),
                completed_tool_call_ids: Vec::new(),
                active_turn_failure: found.active_turn_failure.clone(),
                last_terminal_turn_id: found.last_terminal_turn_id.clone(),
                assistant_boundary_entry_count:
                    crate::acp::transcript_projection::assistant_boundary_entry_count_from_transcript_entries(
                        &found.transcript_snapshot.entries,
                    ),
                transcript_entry_count: found.transcript_snapshot.entries.len(),
            }),
            operations: found.operations.clone(),
            interactions: found.interactions.clone(),
            runtime: None,
        },
    );

    let revision = crate::acp::session_state_engine::SessionGraphRevision::new(
        found.graph_revision,
        found.transcript_snapshot.revision,
        found.last_event_seq,
    );

    let envelope = runtime_registry
        .build_viewport_buffer_push_envelope_for_session(
            &found.canonical_session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
            Some(720),
            None,
            None,
            None,
            0,
        )
        .expect("canonical id should have restored viewport authority");

    match envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::ViewportBufferPush { push } => {
            assert_eq!(push.session_id, canonical_session_id);
            assert!(!push.rows.is_empty());
        }
        other => panic!("expected viewport buffer push, got {other:?}"),
    }

    // The alias id has no viewport authority and must miss as SessionNotAttached.
    let alias_miss = runtime_registry
        .build_viewport_buffer_push_envelope_for_session(
            requested_session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
            Some(720),
            None,
            None,
            None,
            0,
        )
        .expect_err("alias id must not resolve viewport authority");
    assert!(matches!(
        alias_miss,
        crate::acp::session_state_engine::runtime_registry::VisibleTranscriptWindowMiss::SessionNotAttached
    ));
}
// -----------------------------------------------------------------------
// Happy path: open token guarantees reservation is armed after assembly
// -----------------------------------------------------------------------
#[tokio::test]
async fn found_result_open_token_has_active_reservation_in_hub() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "reservation-test-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");
    assert!(
        hub.has_reservation(token),
        "reservation must be active after open"
    );
}

// -----------------------------------------------------------------------
// Edge case: abandoned open token expires reservation buffer after TTL
// -----------------------------------------------------------------------
#[tokio::test]
async fn expired_open_token_is_removed_after_gc() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "ttl-test-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");
    // Manually expire the reservation by forcing GC with a zero TTL
    hub.gc_reservations_older_than(std::time::Duration::ZERO);
    assert!(
        !hub.has_reservation(token),
        "expired reservation should be removed by gc"
    );
}

// -----------------------------------------------------------------------
// Integration: post-assembly delta captured in reservation buffer
// -----------------------------------------------------------------------
#[tokio::test]
async fn post_assembly_event_captured_in_reservation_buffer() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "buffer-test-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

    // Publish a delta to the hub AFTER the open result is returned
    hub.publish(
        "session_update",
        Some(session_id.to_string()),
        json!({"type": "turn_complete"}),
        "high",
        false,
    );

    // The delta must be in the reservation buffer
    let buffered = hub.claim_reservation(token);
    assert!(
        buffered.is_some(),
        "claim must succeed for active reservation"
    );
    let events = buffered.unwrap();
    assert_eq!(events.len(), 1, "exactly one buffered delta expected");
    assert_eq!(events[0].event_name, "session_update");
}

// -----------------------------------------------------------------------
// Integration: event for a different session is NOT buffered in reservation
// -----------------------------------------------------------------------
#[tokio::test]
async fn event_for_different_session_not_captured_in_reservation() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "target-session";
    let other_session = "other-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

    // Publish an event for a different session
    hub.publish(
        "session_update",
        Some(other_session.to_string()),
        json!({"type": "turn_complete"}),
        "high",
        false,
    );

    let buffered = hub.claim_reservation(token);
    let events = buffered.unwrap_or_default();
    assert!(
        events.is_empty(),
        "events for other sessions must not be captured"
    );
}

// -----------------------------------------------------------------------
// Edge case: claim supersedes reservation (single-use token)
// -----------------------------------------------------------------------
#[tokio::test]
async fn open_token_is_single_use_second_claim_returns_none() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "single-use-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

    let first = hub.claim_reservation(token);
    assert!(first.is_some(), "first claim must succeed");

    let second = hub.claim_reservation(token);
    assert!(second.is_none(), "second claim of same token must fail");
}

#[tokio::test]
async fn open_token_claim_rejects_wrong_session() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "claim-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

    let claimed = hub.claim_reservation_for_session(token, "other-session");
    assert!(
        claimed.is_none(),
        "claim must fail when the token is presented for a different session"
    );
    assert!(
        hub.has_reservation(token),
        "failed claim must leave the reservation intact"
    );
}

// -----------------------------------------------------------------------
// Edge case: missing session returns Missing outcome, not partial data
// -----------------------------------------------------------------------
#[tokio::test]
async fn missing_session_returns_missing_outcome() {
    // Note: assemble_session_open_result is called by the command layer only
    // when metadata IS found.  The Missing case is emitted by the command
    // layer itself.  We test here that the SessionOpenResult::Missing variant
    // serializes and round-trips correctly.
    let missing = SessionOpenResult::Missing(SessionOpenMissing {
        requested_session_id: "ghost-session-id".to_string(),
    });
    let json = serde_json::to_string(&missing).expect("serialize");
    let back: SessionOpenResult = serde_json::from_str(&json).expect("deserialize");
    let SessionOpenResult::Missing(m) = back else {
        panic!("expected Missing after round-trip");
    };
    assert_eq!(m.requested_session_id, "ghost-session-id");
}

// -----------------------------------------------------------------------
// Error path: SessionOpenResult::Error round-trips correctly
// -----------------------------------------------------------------------
#[tokio::test]
async fn error_outcome_round_trips_over_serde() {
    let err = SessionOpenResult::Error(SessionOpenError {
        requested_session_id: "bad-session".to_string(),
        message: "Something went wrong".to_string(),
        reason: SessionOpenErrorReason::ParseFailure,
        retryable: false,
    });
    let json = serde_json::to_string(&err).expect("serialize");
    let back: SessionOpenResult = serde_json::from_str(&json).expect("deserialize");
    let SessionOpenResult::Error(e) = back else {
        panic!("expected Error after round-trip");
    };
    assert_eq!(e.requested_session_id, "bad-session");
    assert_eq!(e.message, "Something went wrong");
    assert!(matches!(e.reason, SessionOpenErrorReason::ParseFailure));
    assert!(!e.retryable);
}
