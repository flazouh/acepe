//! Tests for SessionMetadataRepository
//!
//! Uses an in-memory SQLite database for fast, isolated tests.

#[cfg(test)]
mod session_metadata_tests {
    use crate::acp::projections::{
        InteractionResponse, InteractionSnapshot, InteractionState, SessionProjectionSnapshot,
        SessionSnapshot, SessionTurnState,
    };
    use crate::acp::session_descriptor::{
        SessionCompatibilityInput, SessionDescriptorCompatibility, SessionDescriptorMissingFact,
        SessionDescriptorResolutionError, SessionReplayContext,
    };
    use crate::acp::session_journal::{decode_serialized_events, rebuild_session_projection};
    use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
    use crate::acp::session_update::{PermissionData, QuestionData, SessionUpdate};
    use crate::acp::transcript_projection::{
        TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
    };
    use crate::acp::types::CanonicalAgentId;
    use crate::db::entities::prelude::AcepeSessionState;
    use crate::db::repository::{
        ProjectRepository, SessionJournalEventRepository, SessionMetadataRepository,
        SessionProjectionSnapshotRepository, SessionThreadSnapshotRepository,
        SessionTranscriptSnapshotRepository,
    };
    use chrono::Utc;
    use sea_orm::{ConnectionTrait, Database, DbConn, EntityTrait, Set, Statement};
    use sea_orm_migration::MigratorTrait;
    use serde_json::json;
    use tempfile::tempdir;

    /// Create an in-memory SQLite database with migrations applied.
    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory SQLite");

        // Run migrations
        crate::db::migrations::Migrator::up(&db, None)
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

    #[tokio::test]
    async fn test_is_empty_on_fresh_database() {
        let db = setup_test_db().await;

        let result = SessionMetadataRepository::is_empty(&db).await;

        assert!(result.is_ok());
        assert!(result.unwrap(), "Fresh database should be empty");
    }

    #[tokio::test]
    async fn test_upsert_inserts_new_record() {
        let db = setup_test_db().await;

        let result = SessionMetadataRepository::upsert(
            &db,
            "session-123".to_string(),
            "Test conversation".to_string(),
            1704067200000, // 2024-01-01 00:00:00 UTC
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-123.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap(), "Should return true for new insert");

        // Verify insertion
        let is_empty = SessionMetadataRepository::is_empty(&db).await.unwrap();
        assert!(!is_empty, "Database should not be empty after insert");
    }

    #[tokio::test]
    async fn project_repository_preserves_path_casing_in_display_name() {
        let db = setup_test_db().await;

        ProjectRepository::create_or_update(
            &db,
            "/Users/test/MyAPIService".to_string(),
            "myapiservice".to_string(),
            Some("cyan".to_string()),
        )
        .await
        .expect("create project");

        let projects = ProjectRepository::get_all(&db)
            .await
            .expect("load projects");

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "MyAPIService");
        assert_eq!(projects[0].sort_order, 0);
    }

    #[tokio::test]
    async fn project_repository_reorders_projects_and_persists_icon_path() {
        let db = setup_test_db().await;

        let first = ProjectRepository::create_or_update(
            &db,
            "/Users/test/Alpha".to_string(),
            "Alpha".to_string(),
            Some("cyan".to_string()),
        )
        .await
        .expect("create first project");
        let second = ProjectRepository::create_or_update(
            &db,
            "/Users/test/Beta".to_string(),
            "Beta".to_string(),
            Some("purple".to_string()),
        )
        .await
        .expect("create second project");

        let updated_second = ProjectRepository::update_icon_path(
            &db,
            &second.path,
            Some("/tmp/beta-icon.png".to_string()),
        )
        .await
        .expect("update icon");
        assert_eq!(
            updated_second.icon_path.as_deref(),
            Some("/tmp/beta-icon.png")
        );

        let reordered = ProjectRepository::reorder(&db, &[second.path.clone(), first.path.clone()])
            .await
            .expect("reorder projects");

        assert_eq!(reordered.len(), 2);
        assert_eq!(reordered[0].path, second.path);
        assert_eq!(reordered[0].sort_order, 0);
        assert_eq!(reordered[1].path, first.path);
        assert_eq!(reordered[1].sort_order, 1);
    }

    #[tokio::test]
    async fn test_session_projection_snapshot_round_trips() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-projection".to_string(),
            "Projection session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-projection.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let snapshot = SessionProjectionSnapshot {
            session: Some(SessionSnapshot {
                session_id: "session-projection".to_string(),
                agent_id: Some(crate::acp::types::CanonicalAgentId::ClaudeCode),
                last_event_seq: 3,
                turn_state: SessionTurnState::Completed,
                message_count: 1,
                last_agent_message_id: Some("msg-1".to_string()),
                active_tool_call_ids: vec![],
                completed_tool_call_ids: vec!["tool-1".to_string()],
                active_turn_failure: None,
                last_terminal_turn_id: None,
            }),
            operations: vec![],
            interactions: vec![InteractionSnapshot {
                id: "interaction-1".to_string(),
                session_id: "session-projection".to_string(),
                operation_id: None,
                kind: crate::acp::projections::InteractionKind::Question,
                state: crate::acp::projections::InteractionState::Answered,
                json_rpc_request_id: Some(7),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                ),
                tool_reference: None,
                responded_at_event_seq: Some(3),
                response: Some(crate::acp::projections::InteractionResponse::Question {
                    answers: json!({ "Proceed?": ["Yes"] }),
                }),
                payload: crate::acp::projections::InteractionPayload::Question(
                    crate::acp::session_update::QuestionData {
                        id: "interaction-1".to_string(),
                        session_id: "session-projection".to_string(),
                        json_rpc_request_id: Some(7),
                        reply_handler: Some(
                            crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                        ),
                        questions: vec![],
                        tool: None,
                    },
                ),
            }],
            runtime: None,
        };

        SessionProjectionSnapshotRepository::set(&db, "session-projection", &snapshot)
            .await
            .unwrap();
        let loaded = SessionProjectionSnapshotRepository::get(&db, "session-projection")
            .await
            .unwrap()
            .expect("expected persisted projection snapshot");

        assert_eq!(loaded.session.expect("session").last_event_seq, 3);
        assert_eq!(loaded.interactions.len(), 1);
        assert_eq!(loaded.interactions[0].id, "interaction-1");
    }

    #[tokio::test]
    async fn test_session_projection_snapshot_defaults_missing_operation_lifecycle() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-legacy".to_string(),
            "Legacy projection session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "codex".to_string(),
            "-Users-test-project/session-legacy.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .expect("persist session metadata");
        let snapshot = SessionProjectionSnapshot {
            session: Some(SessionSnapshot {
                session_id: "session-legacy".to_string(),
                agent_id: Some(CanonicalAgentId::Codex),
                last_event_seq: 1,
                turn_state: SessionTurnState::Idle,
                message_count: 0,
                last_agent_message_id: None,
                active_tool_call_ids: vec!["tool-legacy".to_string()],
                completed_tool_call_ids: Vec::new(),
                active_turn_failure: None,
                last_terminal_turn_id: None,
            }),
            operations: vec![crate::acp::projections::OperationSnapshot {
                id: "op-legacy".to_string(),
                session_id: "session-legacy".to_string(),
                tool_call_id: "tool-legacy".to_string(),
                name: "bash".to_string(),
                kind: Some(crate::acp::session_update::ToolKind::Execute),
                status: crate::acp::session_update::ToolCallStatus::Pending,
                lifecycle: crate::acp::projections::OperationLifecycle::Pending,
                blocked_reason: None,
                title: Some("Run command".to_string()),
                arguments: crate::acp::session_update::ToolArguments::Execute {
                    command: Some("pwd".to_string()),
                },
                progressive_arguments: None,
                result: None,
                command: Some("pwd".to_string()),
                locations: None,
                skill_meta: None,
                normalized_todos: None,
                started_at_ms: Some(1),
                completed_at_ms: None,
                parent_tool_call_id: None,
                parent_operation_id: None,
                child_tool_call_ids: Vec::new(),
                child_operation_ids: Vec::new(),
            }],
            interactions: Vec::new(),
            runtime: None,
        };
        let mut snapshot_json = serde_json::to_value(&snapshot).expect("serialize legacy snapshot");
        snapshot_json["operations"][0]
            .as_object_mut()
            .expect("operation should be an object")
            .remove("lifecycle");

        crate::db::entities::session_projection_snapshot::Entity::insert(
            crate::db::entities::session_projection_snapshot::ActiveModel {
                session_id: Set("session-legacy".to_string()),
                snapshot_json: Set(snapshot_json.to_string()),
                updated_at: Set(Utc::now()),
            },
        )
        .exec(&db)
        .await
        .expect("insert legacy projection snapshot");

        let loaded = SessionProjectionSnapshotRepository::get(&db, "session-legacy")
            .await
            .expect("load legacy snapshot")
            .expect("legacy snapshot should exist");

        assert_eq!(loaded.operations.len(), 1);
        assert_eq!(
            loaded.operations[0].lifecycle,
            crate::acp::projections::OperationLifecycle::Pending
        );
    }

    #[tokio::test]
    async fn test_session_thread_snapshot_round_trips() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-thread".to_string(),
            "Thread session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-thread.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let snapshot = SessionThreadSnapshot {
            entries: vec![],
            title: "Thread session".to_string(),
            created_at: "2026-04-16T00:00:00Z".to_string(),
            current_mode_id: Some("plan".to_string()),
        };

        SessionThreadSnapshotRepository::set(&db, "session-thread", &snapshot)
            .await
            .unwrap();
        let loaded = SessionThreadSnapshotRepository::get(
            &db,
            "session-thread",
            &CanonicalAgentId::ClaudeCode,
        )
        .await
        .unwrap()
        .expect("expected persisted thread snapshot");

        assert_eq!(loaded.title, "Thread session");
        assert_eq!(loaded.current_mode_id.as_deref(), Some("plan"));
        assert!(loaded.entries.is_empty());
    }

    #[tokio::test]
    async fn test_session_thread_snapshot_round_trips_tool_calls() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-thread-tool-call".to_string(),
            "Thread tool call session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "codex".to_string(),
            "-Users-test-project/session-thread-tool-call.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let snapshot = SessionThreadSnapshot {
            entries: vec![crate::session_jsonl::types::StoredEntry::ToolCall {
                id: "tool-call-1".to_string(),
                message: crate::acp::session_update::ToolCallData {
                    id: "tool-call-1".to_string(),
                    name: "read_file".to_string(),
                    arguments: crate::acp::session_update::ToolArguments::Read {
                        file_path: Some("/Users/test/project/src/main.rs".to_string()),
                        source_context: None,
                    },
                    raw_input: None,
                    status: crate::acp::session_update::ToolCallStatus::Completed,
                    kind: Some(crate::acp::session_update::ToolKind::Read),
                    result: None,
                    title: Some("Read src/main.rs".to_string()),
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
            }],
            title: "Thread tool call session".to_string(),
            created_at: "2026-04-16T00:00:00Z".to_string(),
            current_mode_id: Some("build".to_string()),
        };

        SessionThreadSnapshotRepository::set(&db, "session-thread-tool-call", &snapshot)
            .await
            .unwrap();
        let loaded = SessionThreadSnapshotRepository::get(
            &db,
            "session-thread-tool-call",
            &CanonicalAgentId::Codex,
        )
        .await
        .unwrap()
        .expect("expected persisted thread snapshot");

        assert_eq!(loaded.entries.len(), 1);
        let crate::session_jsonl::types::StoredEntry::ToolCall { message, .. } = &loaded.entries[0]
        else {
            panic!("expected tool call entry");
        };
        assert_eq!(
            message.kind,
            Some(crate::acp::session_update::ToolKind::Read)
        );
        assert_eq!(message.name, "read_file");
    }

    #[tokio::test]
    async fn test_session_transcript_snapshot_round_trips() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-transcript".to_string(),
            "Transcript session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-transcript.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let snapshot = TranscriptSnapshot {
            revision: 5,
            entries: vec![TranscriptEntry {
                entry_id: "assistant-1".to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "assistant-1:chunk:0".to_string(),
                    text: "hello".to_string(),
                }],
            }],
        };

        SessionTranscriptSnapshotRepository::set(&db, "session-transcript", &snapshot)
            .await
            .unwrap();
        let loaded = SessionTranscriptSnapshotRepository::get(&db, "session-transcript")
            .await
            .unwrap()
            .expect("expected persisted transcript snapshot");

        assert_eq!(loaded.revision, 5);
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.entries[0].entry_id, "assistant-1");
    }

    #[tokio::test]
    async fn test_session_journal_replays_projection_state() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-journal".to_string(),
            "Journal session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-journal.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let permission_update = SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-1".to_string(),
                session_id: "session-journal".to_string(),
                json_rpc_request_id: Some(7),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                ),
                permission: "Execute".to_string(),
                patterns: vec![],
                metadata: json!({ "command": "bun test" }),
                always: vec![],
                auto_accepted: false,
                tool: None,
            },
            session_id: Some("session-journal".to_string()),
        };
        let question_update = SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: "question-1".to_string(),
                session_id: "session-journal".to_string(),
                json_rpc_request_id: Some(8),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(8),
                ),
                questions: vec![],
                tool: None,
            },
            session_id: Some("session-journal".to_string()),
        };

        SessionJournalEventRepository::append_session_update(
            &db,
            "session-journal",
            &permission_update,
        )
        .await
        .unwrap();
        SessionJournalEventRepository::append_session_update(
            &db,
            "session-journal",
            &question_update,
        )
        .await
        .unwrap();
        SessionJournalEventRepository::append_interaction_transition(
            &db,
            "session-journal",
            "question-1",
            InteractionState::Answered,
            InteractionResponse::Question {
                answers: json!({ "Question": ["Yes"] }),
            },
        )
        .await
        .unwrap();

        let replay_context = replay_context_for_session(&db, "session-journal").await;
        let serialized = SessionJournalEventRepository::list_serialized(&db, "session-journal")
            .await
            .unwrap();
        let journal = decode_serialized_events(&replay_context, serialized).unwrap();
        assert_eq!(journal.len(), 3);
        assert_eq!(journal[0].event_seq, 1);
        assert_eq!(journal[1].event_seq, 2);
        assert_eq!(journal[2].event_seq, 3);

        let replayed = rebuild_session_projection(&replay_context, &journal);

        let session = replayed
            .session
            .expect("expected replayed session snapshot");
        assert_eq!(
            session.agent_id,
            Some(crate::acp::types::CanonicalAgentId::ClaudeCode)
        );
        assert_eq!(session.last_event_seq, 3);
        assert_eq!(replayed.interactions.len(), 2);
        let answered_question = replayed
            .interactions
            .iter()
            .find(|interaction| interaction.id == "question-1")
            .expect("expected replayed question interaction");
        assert_eq!(answered_question.state, InteractionState::Answered);
        match answered_question.response.clone() {
            Some(InteractionResponse::Question { answers }) => {
                assert_eq!(answers, json!({ "Question": ["Yes"] }));
            }
            other => panic!("expected answered question response, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_session_journal_list_with_replay_context_deserializes_serialized_tool_calls() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-tool-call".to_string(),
            "Tool call session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-tool-call.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let tool_call = SessionUpdate::ToolCall {
            tool_call: crate::acp::session_update::ToolCallData {
                id: "tooluse_read_1".to_string(),
                name: "unknown".to_string(),
                arguments: crate::acp::session_update::ToolArguments::Other {
                    raw: json!({ "path": "/Users/test/project/README.md" }),
                },
                raw_input: None,
                status: crate::acp::session_update::ToolCallStatus::Pending,
                kind: Some(crate::acp::session_update::ToolKind::Other),
                result: None,
                title: Some("Viewing /Users/test/project/README.md".to_string()),
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
            session_id: Some("session-tool-call".to_string()),
        };
        SessionJournalEventRepository::append_session_update(&db, "session-tool-call", &tool_call)
            .await
            .unwrap();

        let replay_context = replay_context_for_session(&db, "session-tool-call").await;
        let serialized = SessionJournalEventRepository::list_serialized(&db, "session-tool-call")
            .await
            .expect("journal rows should load without replay parsing");
        assert_eq!(serialized.len(), 1);
        assert!(serialized[0].event_json.contains("tooluse_read_1"));
        let journal = decode_serialized_events(&replay_context, serialized)
            .expect("journal should deserialize with explicit replay context");
        let replayed = rebuild_session_projection(&replay_context, &journal);

        assert_eq!(journal.len(), 1);
        let session = replayed
            .session
            .expect("expected replayed session snapshot");
        assert_eq!(
            session.agent_id,
            Some(crate::acp::types::CanonicalAgentId::ClaudeCode)
        );
        assert_eq!(replayed.operations.len(), 1);
        assert_eq!(
            replayed.operations[0].kind,
            Some(crate::acp::session_update::ToolKind::Read)
        );
    }

    // -----------------------------------------------------------------------
    // max_event_seq
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn max_event_seq_returns_none_for_session_with_no_events() {
        let db = setup_test_db().await;

        let result = SessionJournalEventRepository::max_event_seq(&db, "no-events-session")
            .await
            .expect("query should succeed");

        assert_eq!(result, None, "no events → max_event_seq should be None");
    }

    #[tokio::test]
    async fn max_event_seq_returns_highest_seq_after_appends() {
        let db = setup_test_db().await;
        let session_id = "max-seq-session";

        // Seed metadata so the session is known
        SessionMetadataRepository::ensure_exists(
            &db,
            session_id,
            "/test/repo",
            "claude-code",
            None,
        )
        .await
        .expect("ensure exists");

        let tool_call = crate::acp::session_update::SessionUpdate::ToolCall {
            tool_call: crate::acp::session_update::ToolCallData {
                id: "tc-1".to_string(),
                name: "Read".to_string(),
                arguments: crate::acp::session_update::ToolArguments::Read {
                    file_path: Some("/repo/README.md".to_string()),
                    source_context: None,
                },
                raw_input: None,
                status: crate::acp::session_update::ToolCallStatus::Completed,
                result: None,
                kind: Some(crate::acp::session_update::ToolKind::Read),
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
            session_id: Some(session_id.to_string()),
        };

        SessionJournalEventRepository::append_session_update(&db, session_id, &tool_call)
            .await
            .expect("append first");
        SessionJournalEventRepository::append_session_update(&db, session_id, &tool_call)
            .await
            .expect("append second");
        SessionJournalEventRepository::append_session_update(&db, session_id, &tool_call)
            .await
            .expect("append third");

        let max_seq = SessionJournalEventRepository::max_event_seq(&db, session_id)
            .await
            .expect("query should succeed");

        assert_eq!(max_seq, Some(3), "three events → max_event_seq should be 3");
    }

    #[tokio::test]
    async fn max_event_seq_is_isolated_per_session() {
        let db = setup_test_db().await;

        for session_id in ["seq-iso-a", "seq-iso-b"] {
            SessionMetadataRepository::ensure_exists(
                &db,
                session_id,
                "/test/repo",
                "claude-code",
                None,
            )
            .await
            .expect("ensure exists");
        }

        let update = crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some("seq-iso-a".to_string()),
            turn_id: None,
        };
        // Append 2 events for session A
        SessionJournalEventRepository::append_session_update(&db, "seq-iso-a", &update)
            .await
            .expect("append a1");
        SessionJournalEventRepository::append_session_update(&db, "seq-iso-a", &update)
            .await
            .expect("append a2");
        // Append 5 events for session B
        let update_b = crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some("seq-iso-b".to_string()),
            turn_id: None,
        };
        for _ in 0..5 {
            SessionJournalEventRepository::append_session_update(&db, "seq-iso-b", &update_b)
                .await
                .expect("append b");
        }

        let max_a = SessionJournalEventRepository::max_event_seq(&db, "seq-iso-a")
            .await
            .expect("query a");
        let max_b = SessionJournalEventRepository::max_event_seq(&db, "seq-iso-b")
            .await
            .expect("query b");

        assert_eq!(max_a, Some(2), "session A should have max_seq=2");
        assert_eq!(max_b, Some(5), "session B should have max_seq=5");
    }

    #[tokio::test]
    async fn test_upsert_returns_false_when_unchanged() {
        let db = setup_test_db().await;

        // Insert initial record
        SessionMetadataRepository::upsert(
            &db,
            "session-123".to_string(),
            "Test conversation".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-123.jsonl".to_string(),
            1704067200, // mtime
            1024,       // size
        )
        .await
        .unwrap();

        // Try to upsert with same mtime and size
        let result = SessionMetadataRepository::upsert(
            &db,
            "session-123".to_string(),
            "Updated conversation".to_string(), // Different display
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-123.jsonl".to_string(),
            1704067200, // Same mtime
            1024,       // Same size
        )
        .await;

        assert!(result.is_ok());
        assert!(!result.unwrap(), "Should return false when file unchanged");

        // Verify display was NOT updated
        let session = SessionMetadataRepository::get_by_id(&db, "session-123")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            session.display, "Test conversation",
            "Display should not change"
        );
    }

    #[tokio::test]
    async fn test_upsert_updates_when_mtime_changes() {
        let db = setup_test_db().await;

        // Insert initial record
        SessionMetadataRepository::upsert(
            &db,
            "session-123".to_string(),
            "Original title".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-123.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        // Upsert with different mtime
        let result = SessionMetadataRepository::upsert(
            &db,
            "session-123".to_string(),
            "Updated title".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-123.jsonl".to_string(),
            1704153600, // Different mtime (1 day later)
            1024,
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap(), "Should return true when file changed");

        // Verify display was updated
        let session = SessionMetadataRepository::get_by_id(&db, "session-123")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.display, "Updated title");
    }

    #[tokio::test]
    async fn test_title_override_survives_transcript_refresh() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "session-override".to_string(),
            "Derived title".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-override.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_title_override(
            &db,
            "session-override",
            Some("My custom title"),
        )
        .await
        .unwrap();

        SessionMetadataRepository::upsert(
            &db,
            "session-override".to_string(),
            "Fresh derived title".to_string(),
            1704067205000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-override.jsonl".to_string(),
            1704067205,
            2048,
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-override")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.display, "My custom title");
    }

    #[tokio::test]
    async fn test_clearing_title_override_reveals_latest_transcript_title() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "session-override".to_string(),
            "Derived title".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-override.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_title_override(
            &db,
            "session-override",
            Some("My custom title"),
        )
        .await
        .unwrap();

        SessionMetadataRepository::upsert(
            &db,
            "session-override".to_string(),
            "Fresh derived title".to_string(),
            1704067205000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-override.jsonl".to_string(),
            1704067205,
            2048,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_title_override(&db, "session-override", None)
            .await
            .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-override")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.display, "Fresh derived title");
    }

    #[tokio::test]
    async fn test_get_by_id_returns_none_for_missing() {
        let db = setup_test_db().await;

        let result = SessionMetadataRepository::get_by_id(&db, "nonexistent").await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_get_for_projects_filters_by_project() {
        let db = setup_test_db().await;

        // Insert sessions for different projects
        for (id, project) in [
            ("session-1", "/project-a"),
            ("session-2", "/project-a"),
            ("session-3", "/project-b"),
        ] {
            SessionMetadataRepository::upsert(
                &db,
                id.to_string(),
                format!("Session {}", id),
                1704067200000,
                project.to_string(),
                "claude-code".to_string(),
                format!("{}/{}.jsonl", project, id),
                1704067200,
                1024,
            )
            .await
            .unwrap();
        }

        // Query for project-a only
        let result =
            SessionMetadataRepository::get_for_projects(&db, &["/project-a".to_string()]).await;

        assert!(result.is_ok());
        let sessions = result.unwrap();
        assert_eq!(sessions.len(), 2, "Should return 2 sessions for project-a");

        for session in &sessions {
            assert_eq!(session.project_path, "/project-a");
        }
    }

    #[tokio::test]
    async fn test_get_for_projects_returns_empty_for_no_match() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Test".to_string(),
            1704067200000,
            "/project-a".to_string(),
            "claude-code".to_string(),
            "/project-a/session-1.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let result =
            SessionMetadataRepository::get_for_projects(&db, &["/nonexistent".to_string()]).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_upsert_preserves_base_project_for_existing_worktree_session() {
        let db = setup_test_db().await;

        let base_project = "/Users/example/Documents/acepe";
        let worktree = "/Users/example/.acepe/worktrees/worktree-123456/feature-branch";

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Original title".to_string(),
            1704067200000,
            base_project.to_string(),
            "claude-code".to_string(),
            format!("{}/session-1.jsonl", base_project),
            1704067200,
            100,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_worktree_path(
            &db,
            "session-1",
            worktree,
            Some(base_project),
            Some("claude-code"),
        )
        .await
        .unwrap();

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Updated title".to_string(),
            1704067300000,
            worktree.to_string(),
            "claude-code".to_string(),
            format!("{}/session-1.jsonl", worktree),
            1704067300,
            200,
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-1")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(session.project_path, base_project);
        assert_eq!(session.worktree_path.as_deref(), Some(worktree));
        assert_eq!(session.display, "Updated title");
        assert_eq!(session.file_path, format!("{}/session-1.jsonl", worktree));
    }

    #[tokio::test]
    async fn test_get_for_projects_includes_worktree_session_via_base_project() {
        let db = setup_test_db().await;

        let base_project = "/Users/example/Documents/acepe";
        let worktree = "/Users/example/.acepe/worktrees/worktree-123456/feature-branch";

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Feature thread".to_string(),
            1704067200000,
            base_project.to_string(),
            "claude-code".to_string(),
            format!("{}/session-1.jsonl", base_project),
            1704067200,
            100,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_worktree_path(
            &db,
            "session-1",
            worktree,
            Some(base_project),
            Some("claude-code"),
        )
        .await
        .unwrap();

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Feature thread".to_string(),
            1704067300000,
            worktree.to_string(),
            "claude-code".to_string(),
            format!("{}/session-1.jsonl", worktree),
            1704067300,
            200,
        )
        .await
        .unwrap();

        let sessions =
            SessionMetadataRepository::get_for_projects(&db, &[base_project.to_string()])
                .await
                .unwrap();

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "session-1");
        assert_eq!(sessions[0].project_path, base_project);
        assert_eq!(sessions[0].worktree_path.as_deref(), Some(worktree));
    }

    #[tokio::test]
    async fn test_upsert_repairs_worktree_session_when_project_path_was_overwritten() {
        let db = setup_test_db().await;

        let base_project = "/Users/example/Documents/acepe";
        let worktree = "/Users/example/.acepe/worktrees/worktree-123456/feature-branch";

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Broken worktree session".to_string(),
            1704067200000,
            worktree.to_string(),
            "claude-code".to_string(),
            format!("{}/session-1.jsonl", worktree),
            1704067200,
            100,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_worktree_path(
            &db,
            "session-1",
            worktree,
            Some(base_project),
            Some("claude-code"),
        )
        .await
        .unwrap();

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Repaired worktree session".to_string(),
            1704067300000,
            base_project.to_string(),
            "claude-code".to_string(),
            format!("{}/session-1.jsonl", worktree),
            1704067200,
            100,
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-1")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(session.project_path, base_project);
        assert_eq!(session.worktree_path.as_deref(), Some(worktree));
        assert_eq!(session.display, "Repaired worktree session");
    }

    #[tokio::test]
    async fn test_batch_upsert_preserves_base_project_for_existing_worktree_session() {
        let db = setup_test_db().await;

        let base_project = "/Users/example/Documents/acepe";
        let worktree = "/Users/example/.acepe/worktrees/worktree-123456/feature-branch";

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Feature thread".to_string(),
            1704067200000,
            base_project.to_string(),
            "claude-code".to_string(),
            format!("{}/session-1.jsonl", base_project),
            1704067200,
            100,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_worktree_path(
            &db,
            "session-1",
            worktree,
            Some(base_project),
            Some("claude-code"),
        )
        .await
        .unwrap();

        SessionMetadataRepository::batch_upsert(
            &db,
            vec![(
                "session-1".to_string(),
                "Batch updated title".to_string(),
                1704067300000,
                worktree.to_string(),
                "claude-code".to_string(),
                format!("{}/session-1.jsonl", worktree),
                1704067300,
                200,
            )],
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-1")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(session.project_path, base_project);
        assert_eq!(session.worktree_path.as_deref(), Some(worktree));
        assert_eq!(session.display, "Batch updated title");
    }

    #[tokio::test]
    async fn test_batch_upsert_repairs_worktree_session_when_project_path_was_overwritten() {
        let db = setup_test_db().await;

        let base_project = "/Users/example/Documents/acepe";
        let worktree = "/Users/example/.acepe/worktrees/worktree-123456/feature-branch";

        SessionMetadataRepository::upsert(
            &db,
            "session-1".to_string(),
            "Broken worktree session".to_string(),
            1704067200000,
            worktree.to_string(),
            "claude-code".to_string(),
            format!("{}/session-1.jsonl", worktree),
            1704067200,
            100,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_worktree_path(
            &db,
            "session-1",
            worktree,
            Some(base_project),
            Some("claude-code"),
        )
        .await
        .unwrap();

        SessionMetadataRepository::batch_upsert(
            &db,
            vec![(
                "session-1".to_string(),
                "Repaired by batch".to_string(),
                1704067300000,
                base_project.to_string(),
                "claude-code".to_string(),
                format!("{}/session-1.jsonl", worktree),
                1704067200,
                100,
            )],
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-1")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(session.project_path, base_project);
        assert_eq!(session.worktree_path.as_deref(), Some(worktree));
        assert_eq!(session.display, "Repaired by batch");
    }

    #[tokio::test]
    async fn test_get_all_returns_sorted_by_timestamp_desc() {
        let db = setup_test_db().await;

        // Insert sessions with different timestamps
        for (id, ts) in [
            ("oldest", 1704067200000i64), // Jan 1
            ("newest", 1704240000000i64), // Jan 3
            ("middle", 1704153600000i64), // Jan 2
        ] {
            SessionMetadataRepository::upsert(
                &db,
                id.to_string(),
                format!("Session {}", id),
                ts,
                "/project".to_string(),
                "claude-code".to_string(),
                format!("/project/{}.jsonl", id),
                1704067200,
                1024,
            )
            .await
            .unwrap();
        }

        let sessions = SessionMetadataRepository::get_all(&db).await.unwrap();

        assert_eq!(sessions.len(), 3);
        assert_eq!(sessions[0].id, "newest", "First should be newest");
        assert_eq!(sessions[1].id, "middle", "Second should be middle");
        assert_eq!(sessions[2].id, "oldest", "Last should be oldest");
    }

    #[tokio::test]
    async fn test_delete_removes_session() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "session-to-delete".to_string(),
            "Test".to_string(),
            1704067200000,
            "/project".to_string(),
            "claude-code".to_string(),
            "/project/session.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        // Verify it exists
        assert!(
            SessionMetadataRepository::get_by_id(&db, "session-to-delete")
                .await
                .unwrap()
                .is_some()
        );

        SessionMetadataRepository::delete(&db, "session-to-delete")
            .await
            .unwrap();

        assert!(
            SessionMetadataRepository::get_by_id(&db, "session-to-delete")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn test_delete_by_file_path() {
        let db = setup_test_db().await;

        let file_path = "/project/session-123.jsonl";

        SessionMetadataRepository::upsert(
            &db,
            "session-123".to_string(),
            "Test".to_string(),
            1704067200000,
            "/project".to_string(),
            "claude-code".to_string(),
            file_path.to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        // Delete by file path
        let result = SessionMetadataRepository::delete_by_file_path(&db, file_path).await;
        assert!(result.is_ok());

        // Verify it's gone
        assert!(SessionMetadataRepository::get_by_id(&db, "session-123")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn test_count() {
        let db = setup_test_db().await;

        assert_eq!(SessionMetadataRepository::count(&db).await.unwrap(), 0);

        for i in 0..5 {
            SessionMetadataRepository::upsert(
                &db,
                format!("session-{}", i),
                "Test".to_string(),
                1704067200000,
                "/project".to_string(),
                "claude-code".to_string(),
                format!("/project/session-{}.jsonl", i),
                1704067200,
                1024,
            )
            .await
            .unwrap();
        }

        assert_eq!(SessionMetadataRepository::count(&db).await.unwrap(), 5);
    }

    #[tokio::test]
    async fn test_batch_upsert_inserts_multiple() {
        let db = setup_test_db().await;

        let records = vec![
            (
                "s1".to_string(),
                "Session 1".to_string(),
                1704067200000i64,
                "/p".to_string(),
                "claude-code".to_string(),
                "/p/s1.jsonl".to_string(),
                1704067200i64,
                1024i64,
            ),
            (
                "s2".to_string(),
                "Session 2".to_string(),
                1704067200000,
                "/p".to_string(),
                "claude-code".to_string(),
                "/p/s2.jsonl".to_string(),
                1704067200,
                1024,
            ),
            (
                "s3".to_string(),
                "Session 3".to_string(),
                1704067200000,
                "/p".to_string(),
                "claude-code".to_string(),
                "/p/s3.jsonl".to_string(),
                1704067200,
                1024,
            ),
        ];

        let result = SessionMetadataRepository::batch_upsert(&db, records).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 3, "Should insert 3 records");

        assert_eq!(SessionMetadataRepository::count(&db).await.unwrap(), 3);
    }

    #[tokio::test]
    async fn test_batch_upsert_skips_unchanged() {
        let db = setup_test_db().await;

        // Insert initial record
        SessionMetadataRepository::upsert(
            &db,
            "existing".to_string(),
            "Original".to_string(),
            1704067200000,
            "/p".to_string(),
            "claude-code".to_string(),
            "/p/existing.jsonl".to_string(),
            1704067200, // mtime
            1024,       // size
        )
        .await
        .unwrap();

        // Batch upsert with same file (unchanged) and one new
        let records = vec![
            // Unchanged (same mtime + size)
            (
                "existing".to_string(),
                "Modified".to_string(),
                1704067200000,
                "/p".to_string(),
                "claude-code".to_string(),
                "/p/existing.jsonl".to_string(),
                1704067200,
                1024,
            ),
            // New
            (
                "new".to_string(),
                "New Session".to_string(),
                1704067200000,
                "/p".to_string(),
                "claude-code".to_string(),
                "/p/new.jsonl".to_string(),
                1704067200,
                1024,
            ),
        ];

        let result = SessionMetadataRepository::batch_upsert(&db, records).await;

        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            1,
            "Should only insert/update 1 record (the new one)"
        );

        let existing = SessionMetadataRepository::get_by_id(&db, "existing")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            existing.display, "Original",
            "Existing record should not be modified"
        );
    }

    #[tokio::test]
    async fn test_batch_upsert_refreshes_placeholder_title_when_file_metadata_is_unchanged() {
        let db = setup_test_db().await;
        let session_id = "12345678-copilot-session";
        let transcript_path = "/tmp/copilot/12345678-copilot-session/events.jsonl";

        SessionMetadataRepository::ensure_exists(&db, session_id, "/project", "copilot", None)
            .await
            .unwrap();

        let placeholder = SessionMetadataRepository::get_by_id(&db, session_id)
            .await
            .unwrap()
            .unwrap()
            .display;
        assert_eq!(placeholder, "Session 12345678");

        SessionMetadataRepository::upsert(
            &db,
            session_id.to_string(),
            placeholder.clone(),
            1704067200000,
            "/project".to_string(),
            "copilot".to_string(),
            transcript_path.to_string(),
            1704067200,
            2048,
        )
        .await
        .unwrap();

        let updated = SessionMetadataRepository::batch_upsert(
            &db,
            vec![(
                session_id.to_string(),
                "Real Copilot title".to_string(),
                1704067300000,
                "/project".to_string(),
                "copilot".to_string(),
                transcript_path.to_string(),
                1704067200,
                2048,
            )],
        )
        .await
        .unwrap();

        assert_eq!(
            updated, 1,
            "placeholder title should refresh even when transcript metadata is unchanged"
        );

        let session = SessionMetadataRepository::get_by_id(&db, session_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.display, "Real Copilot title");
        assert_eq!(session.file_path, transcript_path);
    }

    #[tokio::test]
    async fn test_set_provider_session_id_allows_batch_upsert_to_update_alias_row() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "acepe-session",
            "/project",
            "claude-code",
            Some("/project/.worktrees/feature-a"),
        )
        .await
        .unwrap();
        SessionMetadataRepository::set_provider_session_id(&db, "acepe-session", "claude-session")
            .await
            .unwrap();

        let updated = SessionMetadataRepository::batch_upsert(
            &db,
            vec![(
                "claude-session".to_string(),
                "Real transcript title".to_string(),
                1704067300000,
                "/project/.worktrees/feature-a".to_string(),
                "claude-code".to_string(),
                "-project-worktrees-feature-a/claude-session.jsonl".to_string(),
                1704067300,
                2048,
            )],
        )
        .await
        .unwrap();

        assert_eq!(updated, 1);

        let aliased = SessionMetadataRepository::get_by_id(&db, "acepe-session")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(aliased.history_session_id(), "claude-session");
        assert_eq!(aliased.display, "Real transcript title");
        assert_eq!(
            aliased.file_path,
            "-project-worktrees-feature-a/claude-session.jsonl"
        );

        assert!(SessionMetadataRepository::get_by_id(&db, "claude-session")
            .await
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_session_metadata_row_history_session_id_preserves_generic_provider_alias() {
        let row = crate::db::repository::SessionMetadataRow {
            id: "session-generic".to_string(),
            display: "Generic".to_string(),
            title_overridden: false,
            timestamp: 0,
            project_path: "/project".to_string(),
            agent_id: "cursor".to_string(),
            file_path: "/project/session-generic.jsonl".to_string(),
            file_mtime: 0,
            file_size: 0,
            provider_session_id: Some("cursor-provider".to_string()),
            worktree_path: None,
            pr_number: None,
            is_acepe_managed: false,
            sequence_id: None,
        };

        assert_eq!(row.history_session_id(), "cursor-provider");
    }

    #[tokio::test]
    async fn test_delete_by_agent_for_projects_excluding_ids_respects_provider_session_id() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "acepe-session",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();
        SessionMetadataRepository::set_provider_session_id(&db, "acepe-session", "claude-session")
            .await
            .unwrap();

        let deleted = SessionMetadataRepository::delete_by_agent_for_projects_excluding_ids(
            &db,
            "claude-code",
            &["/project".to_string()],
            &std::collections::HashSet::from(["claude-session".to_string()]),
        )
        .await
        .unwrap();

        assert_eq!(deleted, 0);
        assert!(SessionMetadataRepository::get_by_id(&db, "acepe-session")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn test_upsert_preserves_base_project_for_generic_git_worktree_session() {
        let db = setup_test_db().await;

        let temp = tempdir().expect("temp dir");
        let base_project = temp.path().join("repo");
        let worktree = temp.path().join("feature-a");
        std::fs::create_dir_all(base_project.join(".git/worktrees/feature-a")).unwrap();
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::write(
            worktree.join(".git"),
            format!(
                "gitdir: {}\n",
                base_project.join(".git/worktrees/feature-a").display()
            ),
        )
        .unwrap();

        let base_project_str = base_project.to_string_lossy().to_string();
        let worktree_str = worktree.to_string_lossy().to_string();

        SessionMetadataRepository::upsert(
            &db,
            "session-generic".to_string(),
            "Original title".to_string(),
            1704067200000,
            base_project_str.clone(),
            "claude-code".to_string(),
            format!("{}/session-generic.jsonl", base_project_str),
            1704067200,
            100,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_worktree_path(
            &db,
            "session-generic",
            &worktree_str,
            Some(&base_project_str),
            Some("claude-code"),
        )
        .await
        .unwrap();

        SessionMetadataRepository::upsert(
            &db,
            "session-generic".to_string(),
            "Updated title".to_string(),
            1704067300000,
            worktree_str.clone(),
            "claude-code".to_string(),
            format!("{}/session-generic.jsonl", worktree_str),
            1704067300,
            200,
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-generic")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(session.project_path, base_project_str);
        assert_eq!(
            session.worktree_path.as_deref(),
            Some(worktree_str.as_str())
        );
    }

    #[tokio::test]
    async fn test_set_worktree_path_updates_existing_session() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "session-existing".to_string(),
            "Existing Session".to_string(),
            1704067200000,
            "/project".to_string(),
            "claude-code".to_string(),
            "/project/session-existing.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_worktree_path(
            &db,
            "session-existing",
            "/project/.worktrees/feature-a",
            Some("/project"),
            Some("claude-code"),
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-existing")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            session.worktree_path.as_deref(),
            Some("/project/.worktrees/feature-a")
        );
    }

    #[tokio::test]
    async fn test_set_worktree_path_inserts_placeholder_when_session_missing() {
        let db = setup_test_db().await;

        SessionMetadataRepository::set_worktree_path(
            &db,
            "session-missing",
            "/project/.worktrees/feature-b",
            Some("/project"),
            Some("opencode"),
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-missing")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.project_path, "/project");
        assert_eq!(session.agent_id, "opencode");
        assert_eq!(
            session.worktree_path.as_deref(),
            Some("/project/.worktrees/feature-b")
        );
    }

    #[tokio::test]
    async fn test_normalized_source_path_hides_worktree_sentinel() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "ses_legacy".to_string(),
            "Legacy Session".to_string(),
            1704067200000,
            "/project".to_string(),
            "opencode".to_string(),
            "__worktree__/ses_legacy".to_string(),
            0,
            0,
        )
        .await
        .unwrap();

        SessionMetadataRepository::set_worktree_path(
            &db,
            "ses_legacy",
            "/tmp/real-worktree",
            Some("/project"),
            Some("opencode"),
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "ses_legacy")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(
            SessionMetadataRepository::normalized_source_path(session.file_path.as_str()),
            None
        );
    }

    #[tokio::test]
    async fn test_upsert_preserves_persisted_source_path_when_incoming_path_is_registry_sentinel() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "copilot-session".to_string(),
            "Cached Copilot Session".to_string(),
            1704067200000,
            "/project".to_string(),
            "copilot".to_string(),
            "/tmp/copilot-session.json".to_string(),
            1704067200000,
            2048,
        )
        .await
        .unwrap();

        SessionMetadataRepository::upsert(
            &db,
            "copilot-session".to_string(),
            "Cached Copilot Session".to_string(),
            1704067300000,
            "/project".to_string(),
            "copilot".to_string(),
            "__session_registry__/copilot/copilot-session".to_string(),
            0,
            0,
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "copilot-session")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(session.file_path, "/tmp/copilot-session.json");
        assert_eq!(session.file_mtime, 1704067200000);
        assert_eq!(session.file_size, 2048);
        assert_eq!(
            SessionMetadataRepository::normalized_source_path(session.file_path.as_str()),
            Some("/tmp/copilot-session.json".to_string())
        );
    }

    #[tokio::test]
    async fn test_ensure_exists_inserts_placeholder_when_session_missing() {
        let db = setup_test_db().await;

        let created = SessionMetadataRepository::ensure_exists(
            &db,
            "session-placeholder",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();

        assert!(created);

        let session = SessionMetadataRepository::get_by_id(&db, "session-placeholder")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.project_path, "/project");
        assert_eq!(session.agent_id, "claude-code");
        assert_eq!(session.worktree_path, None);
    }

    #[tokio::test]
    async fn test_ensure_exists_for_worktree_session_writes_unique_registry_placeholder_path() {
        let db = setup_test_db().await;

        let created = SessionMetadataRepository::ensure_exists(
            &db,
            "session-worktree-placeholder",
            "/project",
            "opencode",
            Some("/tmp/real-worktree"),
        )
        .await
        .unwrap();

        assert!(created);

        let session = SessionMetadataRepository::get_by_id(&db, "session-worktree-placeholder")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(session.worktree_path.as_deref(), Some("/tmp/real-worktree"));
        assert_eq!(
            session.file_path,
            "__session_registry__/session-worktree-placeholder"
        );
        assert_eq!(session.file_mtime, 0);
        assert_eq!(session.file_size, 0);
    }

    #[tokio::test]
    async fn test_ensure_exists_assigns_sequence_id_for_new_acepe_created_session() {
        let db = setup_test_db().await;

        let created = SessionMetadataRepository::ensure_exists(
            &db,
            "session-seq-1",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();

        assert!(created);

        let session = SessionMetadataRepository::get_by_id(&db, "session-seq-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.sequence_id, Some(1));
    }

    #[tokio::test]
    async fn test_ensure_exists_assigns_incrementing_sequence_ids_per_project() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-seq-1",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();
        SessionMetadataRepository::ensure_exists(
            &db,
            "session-seq-2",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();

        let first = SessionMetadataRepository::get_by_id(&db, "session-seq-1")
            .await
            .unwrap()
            .unwrap();
        let second = SessionMetadataRepository::get_by_id(&db, "session-seq-2")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(first.sequence_id, Some(1));
        assert_eq!(second.sequence_id, Some(2));
    }

    #[tokio::test]
    async fn test_scanned_session_does_not_receive_sequence_id_until_acepe_adopts_it() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "scanned-session".to_string(),
            "Scanned Session".to_string(),
            1704067200000,
            "/project".to_string(),
            "claude-code".to_string(),
            "/project/scanned-session.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let scanned = SessionMetadataRepository::get_by_id(&db, "scanned-session")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(scanned.sequence_id, None);

        SessionMetadataRepository::set_worktree_path(
            &db,
            "scanned-session",
            "/project/.worktrees/feature-a",
            Some("/project"),
            Some("claude-code"),
        )
        .await
        .unwrap();
        SessionMetadataRepository::mark_as_acepe_managed(&db, "scanned-session")
            .await
            .unwrap();

        let adopted = SessionMetadataRepository::get_by_id(&db, "scanned-session")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(adopted.sequence_id, Some(1));
    }

    #[tokio::test]
    async fn test_ensure_exists_records_opened_relationship_in_acepe_state() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-opened",
            "/project",
            "claude-code",
            Some("/project/.worktrees/feature-a"),
        )
        .await
        .unwrap();

        let state = AcepeSessionState::find_by_id("session-opened")
            .one(&db)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(state.relationship, "opened");
        assert_eq!(state.sequence_id, Some(1));
        assert_eq!(state.project_path, "/project");
    }

    #[tokio::test]
    async fn test_ensure_exists_and_promote_records_created_relationship_in_acepe_state() {
        let db = setup_test_db().await;

        let sequence_id = SessionMetadataRepository::ensure_exists_and_promote(
            &db,
            "session-created",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();

        let state = AcepeSessionState::find_by_id("session-created")
            .one(&db)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(sequence_id, Some(1));
        assert_eq!(state.relationship, "created");
        assert_eq!(state.sequence_id, Some(1));
        assert_eq!(state.project_path, "/project");
    }

    #[tokio::test]
    async fn test_legacy_worktree_placeholder_can_be_promoted_without_losing_sequence_id() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-placeholder",
            "/project",
            "claude-code",
            Some("/project/.worktrees/feature-a"),
        )
        .await
        .unwrap();

        db.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "UPDATE session_metadata SET file_path = '__worktree__/legacy-session', sequence_id = 1 WHERE id = 'session-placeholder'".to_string(),
        ))
        .await
        .unwrap();

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-placeholder",
            "/project",
            "claude-code",
            Some("/project/.worktrees/feature-a"),
        )
        .await
        .unwrap();

        let session = SessionMetadataRepository::get_by_id(&db, "session-placeholder")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.sequence_id, Some(1));
        assert!(session.is_acepe_managed);
    }

    #[tokio::test]
    async fn test_ensure_exists_preserves_existing_session_metadata() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "session-existing".to_string(),
            "Original title".to_string(),
            1704067200000,
            "/project".to_string(),
            "opencode".to_string(),
            "/project/session-existing.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let created = SessionMetadataRepository::ensure_exists(
            &db,
            "session-existing",
            "/other-project",
            "claude-code",
            Some("/other-project/.worktrees/feature-a"),
        )
        .await
        .unwrap();

        // Session already existed via upsert, so ensure_exists should NOT create a new row
        assert!(!created);

        let session = SessionMetadataRepository::get_by_id(&db, "session-existing")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.display, "Original title");
        assert_eq!(session.project_path, "/project");
        assert_eq!(session.agent_id, "opencode");
        assert_eq!(session.worktree_path, None);
    }

    #[tokio::test]
    async fn test_resolve_existing_session_descriptor_uses_persisted_facts_over_compatibility_inputs(
    ) {
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

        let metadata = SessionMetadataRepository::get_by_id(&db, "session-copilot")
            .await
            .unwrap();
        let descriptor =
            SessionMetadataRepository::resolve_existing_session_descriptor_from_metadata(
                "session-copilot",
                metadata.as_ref(),
                SessionCompatibilityInput {
                    project_path: Some("/fallback".to_string()),
                    agent_id: Some(crate::acp::types::CanonicalAgentId::ClaudeCode),
                    source_path: Some("/fallback/session.json".to_string()),
                },
            )
            .expect("descriptor");

        assert_eq!(
            descriptor.agent_id,
            crate::acp::types::CanonicalAgentId::Copilot
        );
        assert_eq!(descriptor.project_path, "/project");
        assert_eq!(descriptor.effective_cwd, "/project/.worktrees/feature-a");
        assert_eq!(
            descriptor.compatibility,
            SessionDescriptorCompatibility::Canonical
        );
    }

    #[tokio::test]
    async fn test_resolve_existing_session_descriptor_marks_unresolved_claude_as_read_only() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-claude",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();

        let metadata = SessionMetadataRepository::get_by_id(&db, "session-claude")
            .await
            .unwrap();
        let descriptor =
            SessionMetadataRepository::resolve_existing_session_descriptor_from_metadata(
                "session-claude",
                metadata.as_ref(),
                SessionCompatibilityInput::default(),
            )
            .expect("descriptor");

        assert_eq!(descriptor.history_session_id, "session-claude");
        assert_eq!(
            descriptor.compatibility,
            SessionDescriptorCompatibility::ReadOnly {
                missing_facts: vec![SessionDescriptorMissingFact::ProviderSessionId]
            }
        );
        assert!(!descriptor.is_resumable());
    }

    #[tokio::test]
    async fn test_resolve_existing_session_resume_requires_descriptor_facts() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "session-thin".to_string(),
            "Thin session".to_string(),
            1704067200000,
            "".to_string(),
            "".to_string(),
            "".to_string(),
            0,
            0,
        )
        .await
        .unwrap();

        let metadata = SessionMetadataRepository::get_by_id(&db, "session-thin")
            .await
            .unwrap();
        let error = SessionMetadataRepository::resolve_existing_session_resume_from_metadata(
            "session-thin",
            metadata.as_ref(),
            "/fallback",
            None,
        )
        .expect_err("descriptor facts should be required");

        assert_eq!(
            error,
            SessionDescriptorResolutionError::MissingResolvedFacts {
                session_id: "session-thin".to_string(),
                missing_facts: vec![SessionDescriptorMissingFact::CanonicalAgentId]
            }
        );
    }

    #[test]
    fn repository_provider_identity_rules_are_capability_driven() {
        let source = include_str!("repository.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap_or_default();

        assert!(
            !source.contains("incoming_agent_id == \"claude-code\""),
            "repository should not hardcode Claude provider alias rules"
        );
        assert!(
            source.contains("backend_identity_policy_for_provider_id"),
            "repository should resolve backend identity policy through shared capability helpers"
        );
    }
}
