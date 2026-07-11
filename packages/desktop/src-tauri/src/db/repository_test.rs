//! Tests for SessionMetadataRepository
//!
//! Uses an in-memory SQLite database for fast, isolated tests.

#[cfg(test)]
mod session_metadata_tests {
    use crate::acp::projections::{InteractionResponse, InteractionState, ProjectionRegistry};
    use crate::acp::session_descriptor::{
        SessionCompatibilityInput, SessionDescriptorCompatibility, SessionDescriptorMissingFact,
        SessionDescriptorResolutionError, SessionReplayContext,
    };
    use crate::acp::session_journal::{decode_serialized_events, rebuild_session_projection};
    use crate::acp::session_update::{PermissionData, QuestionData, SessionUpdate};
    use crate::acp::transcript_viewport::ledger::{
        SerializedTranscriptRowLedgerRow, SessionTranscriptRowLedgerRead,
        SessionTranscriptRowLedgerStatus,
    };
    use crate::db::entities::prelude::AcepeSessionState;
    use crate::db::repository::{
        AppSettingsRepository, CreationAttemptRepositoryError, CreationAttemptStatus,
        ProjectRepository, SessionHistoryEnrichmentRecord, SessionHistoryEnrichmentRepository,
        SessionJournalEventRepository, SessionMetadataRepository,
        SessionTranscriptRowLedgerRepository,
    };
    use sea_orm::{ConnectionTrait, Database, DbConn, EntityTrait, Statement};
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

    async fn ensure_test_session(db: &DbConn, session_id: &str) {
        SessionMetadataRepository::ensure_exists(db, session_id, "/test/repo", "claude-code", None)
            .await
            .expect("ensure test session");
    }

    #[tokio::test]
    async fn first_display_project_sessions_are_bounded_per_project_and_overall() {
        let db = setup_test_db().await;
        for project_ordinal in 0..6 {
            let project_path = format!("/repo-{project_ordinal}");
            for session_ordinal in 0..120 {
                let session_id = format!("session-{project_ordinal}-{session_ordinal}");
                SessionMetadataRepository::upsert(
                    &db,
                    session_id.clone(),
                    session_id.clone(),
                    session_ordinal,
                    project_path.clone(),
                    "codex".to_string(),
                    format!("/{session_id}.jsonl"),
                    1,
                    1,
                )
                .await
                .expect("insert bounded lookup fixture");
            }
        }
        let project_paths = (0..6)
            .map(|ordinal| format!("/repo-{ordinal}"))
            .collect::<Vec<_>>();

        let lookup = SessionMetadataRepository::get_recent_for_projects_bounded(
            &db,
            &project_paths,
            &std::collections::HashSet::new(),
        )
        .await
        .expect("load bounded first-display sessions");

        assert_eq!(lookup.entries.len(), 500);
        let mut per_project = std::collections::HashMap::new();
        for entry in lookup.entries {
            let count = per_project.entry(entry.project_path).or_insert(0usize);
            *count += 1;
        }
        assert!(per_project.values().all(|count| *count <= 100));
    }

    #[tokio::test]
    async fn history_enrichment_is_visible_only_for_the_current_source_fingerprint() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "enriched".to_string(),
            "Enriched".to_string(),
            1,
            "/repo".to_string(),
            "claude-code".to_string(),
            "/repo/enriched.jsonl".to_string(),
            10,
            20,
        )
        .await
        .expect("insert metadata");
        SessionHistoryEnrichmentRepository::upsert(
            &db,
            SessionHistoryEnrichmentRecord {
                session_id: "enriched".to_string(),
                usage_stats: crate::session_jsonl::types::HistoryUsageStats {
                    total_messages: 3,
                    user_messages: 1,
                    assistant_messages: 2,
                    total_input_tokens: 100,
                    total_output_tokens: 20,
                },
                source_mtime: 10,
                source_size: 20,
            },
        )
        .await
        .expect("insert enrichment");
        let ids = vec!["enriched".to_string()];
        assert_eq!(
            SessionHistoryEnrichmentRepository::get_usage_for_session_ids(&db, &ids)
                .await
                .expect("load current enrichment")
                .len(),
            1
        );

        SessionMetadataRepository::upsert(
            &db,
            "enriched".to_string(),
            "Enriched".to_string(),
            1,
            "/repo".to_string(),
            "claude-code".to_string(),
            "/repo/enriched.jsonl".to_string(),
            11,
            21,
        )
        .await
        .expect("change source fingerprint");
        assert!(
            SessionHistoryEnrichmentRepository::get_usage_for_session_ids(&db, &ids)
                .await
                .expect("load stale enrichment")
                .is_empty()
        );
    }

    fn serialized_ledger_row(
        session_id: &str,
        row_index: i64,
        row_id: &str,
        row_kind: &str,
    ) -> SerializedTranscriptRowLedgerRow {
        SerializedTranscriptRowLedgerRow {
            session_id: session_id.to_string(),
            row_index,
            row_id: row_id.to_string(),
            source_entry_id: Some(format!("entry-{row_index}")),
            row_kind: row_kind.to_string(),
            row_version: format!("v-{row_index}"),
            transcript_revision: 7,
            graph_revision: 11,
            projection_version: "projection-v1".to_string(),
            row_json: json!({
                "id": row_id,
                "kind": row_kind,
                "operationDisplayFacts": row_kind == "operation"
            })
            .to_string(),
        }
    }

    #[tokio::test]
    async fn app_settings_set_is_atomic_for_concurrent_new_key_saves() {
        let db = setup_test_db().await;
        let values = ["first", "second", "third", "fourth"];
        let results = futures::future::join_all(
            values
                .iter()
                .map(|value| AppSettingsRepository::set(&db, "race_key", value)),
        )
        .await;

        for result in results {
            result.expect("concurrent app setting save should upsert");
        }

        let saved = AppSettingsRepository::get(&db, "race_key")
            .await
            .expect("load race key");
        assert!(
            values.contains(&saved.as_deref().expect("race key exists")),
            "saved value should be one of the concurrent writes"
        );
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
    async fn project_repository_get_all_paths_returns_sidebar_order() {
        let db = setup_test_db().await;

        ProjectRepository::create_or_update(
            &db,
            "/Users/test/Alpha".to_string(),
            "Alpha".to_string(),
            Some("cyan".to_string()),
        )
        .await
        .expect("create alpha project");
        ProjectRepository::create_or_update(
            &db,
            "/Users/test/Beta".to_string(),
            "Beta".to_string(),
            Some("purple".to_string()),
        )
        .await
        .expect("create beta project");

        let paths = ProjectRepository::get_all_paths(&db)
            .await
            .expect("load project paths");

        assert_eq!(
            paths,
            vec![
                "/Users/test/Beta".to_string(),
                "/Users/test/Alpha".to_string()
            ]
        );
    }

    #[tokio::test]
    async fn project_repository_get_all_skips_project_config_file_reads() {
        let db = setup_test_db().await;
        let temp = tempdir().expect("temp dir");
        let project_dir = temp.path().join("ConfigProject");
        std::fs::create_dir(&project_dir).expect("create project dir");
        std::fs::write(
            project_dir.join(".acepe.json"),
            r#"{"version":1,"externalCliSessions":{"show":false}}"#,
        )
        .expect("write project config");
        let project_path = project_dir.to_string_lossy().to_string();

        ProjectRepository::create_or_update(
            &db,
            project_path.clone(),
            "ConfigProject".to_string(),
            Some("cyan".to_string()),
        )
        .await
        .expect("create project");

        let explicit_project = ProjectRepository::get_by_path(&db, &project_path)
            .await
            .expect("load explicit project")
            .expect("project exists");
        assert!(
            !explicit_project.show_external_cli_sessions,
            "explicit project lookup should still read .acepe.json"
        );

        let listed_projects = ProjectRepository::get_all(&db)
            .await
            .expect("load listed projects");
        assert_eq!(listed_projects.len(), 1);
        assert_eq!(listed_projects[0].path, project_path);
        assert!(
            listed_projects[0].show_external_cli_sessions,
            "hot project listing should use the default without reading .acepe.json"
        );
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
        let projection_registry = ProjectionRegistry::new();
        projection_registry.apply_session_update("session-journal", &question_update);
        let answered_question = projection_registry
            .resolve_interaction(
                "session-journal",
                "question-1",
                InteractionState::Answered,
                InteractionResponse::Question {
                    answers: json!({ "Question": ["Yes"] }),
                },
            )
            .expect("answered question snapshot");
        SessionJournalEventRepository::append_interaction_snapshot(
            &db,
            "session-journal",
            answered_question,
        )
        .await
        .unwrap();

        let replay_context = replay_context_for_session(&db, "session-journal").await;
        let serialized = SessionJournalEventRepository::list_serialized(&db, "session-journal")
            .await
            .unwrap();
        let journal = decode_serialized_events(&replay_context, serialized).unwrap();
        assert_eq!(journal.len(), 2);
        assert_eq!(journal[0].event_seq, 1);
        assert_eq!(journal[1].event_seq, 2);

        let replayed = rebuild_session_projection(&replay_context, &journal);

        let session = replayed
            .session
            .expect("expected replayed session snapshot");
        assert_eq!(
            session.agent_id,
            Some(crate::acp::types::CanonicalAgentId::ClaudeCode)
        );
        assert_eq!(session.last_event_seq, 2);
        assert_eq!(replayed.interactions.len(), 2);
        assert!(replayed
            .interactions
            .iter()
            .any(|interaction| interaction.id == "permission-1"));
        let answered_question = replayed
            .interactions
            .iter()
            .find(|interaction| interaction.id == "question-1")
            .expect("expected replayed answered question interaction");
        assert_eq!(answered_question.state, InteractionState::Answered);
        match answered_question.response.clone() {
            Some(InteractionResponse::Question { answers }) => {
                assert_eq!(answers, json!({ "Question": ["Yes"] }));
            }
            other => panic!("expected answered question response, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_session_journal_skips_tool_call_payload_persistence() {
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
                    intent: None,
                },
                diagnostic_input: None,
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
        let appended = SessionJournalEventRepository::append_session_update(
            &db,
            "session-tool-call",
            &tool_call,
        )
        .await
        .expect("tool call append should succeed");

        assert!(
            appended.is_none(),
            "tool call payloads should no longer be journaled"
        );
        let serialized = SessionJournalEventRepository::list_serialized(&db, "session-tool-call")
            .await
            .expect("journal rows should load without replay parsing");
        assert!(serialized.is_empty());
    }

    #[tokio::test]
    async fn test_session_journal_skips_question_request_persistence() {
        let db = setup_test_db().await;
        SessionMetadataRepository::upsert(
            &db,
            "session-question".to_string(),
            "Question session".to_string(),
            1704067200000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            "-Users-test-project/session-question.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let question_update = SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: "question-1".to_string(),
                session_id: "session-question".to_string(),
                json_rpc_request_id: Some(8),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(8),
                ),
                questions: vec![],
                tool: None,
            },
            session_id: Some("session-question".to_string()),
        };
        let appended = SessionJournalEventRepository::append_session_update(
            &db,
            "session-question",
            &question_update,
        )
        .await
        .expect("question request append should succeed");

        assert!(
            appended.is_none(),
            "agent questions should enter the canonical graph, not the raw session-update journal"
        );
        let serialized_before_answer =
            SessionJournalEventRepository::list_serialized(&db, "session-question")
                .await
                .expect("journal rows should load");
        assert!(serialized_before_answer.is_empty());

        let projection_registry = ProjectionRegistry::new();
        projection_registry.apply_session_update("session-question", &question_update);
        let answered_question = projection_registry
            .resolve_interaction(
                "session-question",
                "question-1",
                InteractionState::Answered,
                InteractionResponse::Question {
                    answers: json!({ "Archive": ["Top toolbar"] }),
                },
            )
            .expect("answered question snapshot");
        SessionJournalEventRepository::append_interaction_snapshot(
            &db,
            "session-question",
            answered_question,
        )
        .await
        .expect("answered question snapshot should persist");

        let serialized_after_answer =
            SessionJournalEventRepository::list_serialized(&db, "session-question")
                .await
                .expect("journal rows should load");
        assert_eq!(serialized_after_answer.len(), 1);
        assert_eq!(
            serialized_after_answer[0].event_kind,
            "interaction_snapshot"
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

        SessionJournalEventRepository::append_materialization_barrier(&db, session_id)
            .await
            .expect("append first");
        SessionJournalEventRepository::append_materialization_barrier(&db, session_id)
            .await
            .expect("append second");
        SessionJournalEventRepository::append_materialization_barrier(&db, session_id)
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
    async fn max_row_affecting_event_seq_skips_trailing_materialization_barriers() {
        let db = setup_test_db().await;
        let session_id = "row-affecting-cutoff-session";
        ensure_test_session(&db, session_id).await;
        let update = crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        };

        SessionJournalEventRepository::append_session_update(&db, session_id, &update)
            .await
            .expect("append row-affecting update");
        for _ in 0..3 {
            SessionJournalEventRepository::append_materialization_barrier(&db, session_id)
                .await
                .expect("append trailing barrier");
        }

        let max_seq = SessionJournalEventRepository::max_row_affecting_event_seq(&db, session_id)
            .await
            .expect("query should succeed");

        assert_eq!(
            max_seq,
            Some(1),
            "trailing materialization barriers should not make the row ledger look stale"
        );
    }

    #[tokio::test]
    async fn max_row_affecting_event_seq_returns_none_for_barrier_only_session() {
        let db = setup_test_db().await;
        let session_id = "barrier-only-cutoff-session";
        ensure_test_session(&db, session_id).await;

        SessionJournalEventRepository::append_materialization_barrier(&db, session_id)
            .await
            .expect("append first barrier");
        SessionJournalEventRepository::append_materialization_barrier(&db, session_id)
            .await
            .expect("append second barrier");

        let max_seq = SessionJournalEventRepository::max_row_affecting_event_seq(&db, session_id)
            .await
            .expect("query should succeed");

        assert_eq!(max_seq, None);
    }

    #[tokio::test]
    async fn transcript_row_ledger_writes_and_reads_tail_page() {
        let db = setup_test_db().await;
        let session_id = "ledger-tail-session";
        ensure_test_session(&db, session_id).await;

        SessionTranscriptRowLedgerRepository::replace_current(
            &db,
            session_id,
            "projection-v1",
            7,
            11,
            13,
            None,
            vec![
                serialized_ledger_row(session_id, 0, "row-0", "user"),
                serialized_ledger_row(session_id, 1, "row-1", "assistant"),
                serialized_ledger_row(session_id, 2, "row-2", "operation"),
            ],
        )
        .await
        .expect("ledger write should succeed");

        let page = SessionTranscriptRowLedgerRepository::read_tail_page(
            &db,
            session_id,
            "projection-v1",
            2,
        )
        .await
        .expect("tail page read should succeed");

        let SessionTranscriptRowLedgerRead::Current { metadata, rows } = page else {
            panic!("expected current ledger page");
        };
        assert_eq!(metadata.session_id, session_id);
        assert_eq!(metadata.row_count, 3);
        assert_eq!(metadata.transcript_revision, 7);
        assert_eq!(metadata.graph_revision, 11);
        assert_eq!(metadata.last_event_seq, 13);
        assert_eq!(metadata.open_header_json, None);
        assert_eq!(metadata.projection_version, "projection-v1");
        assert_eq!(
            rows.iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["row-1", "row-2"]
        );
        assert_eq!(
            rows.iter().map(|row| row.row_index).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[tokio::test]
    async fn transcript_row_ledger_missing_session_is_not_empty_truth() {
        let db = setup_test_db().await;

        let page = SessionTranscriptRowLedgerRepository::read_tail_page(
            &db,
            "missing-ledger-session",
            "projection-v1",
            128,
        )
        .await
        .expect("missing ledger lookup should not fail");

        assert_eq!(page, SessionTranscriptRowLedgerRead::Missing);
    }

    #[tokio::test]
    async fn transcript_row_ledger_reads_middle_range_in_row_order() {
        let db = setup_test_db().await;
        let session_id = "ledger-range-session";
        ensure_test_session(&db, session_id).await;

        SessionTranscriptRowLedgerRepository::replace_current(
            &db,
            session_id,
            "projection-v1",
            7,
            11,
            13,
            None,
            vec![
                serialized_ledger_row(session_id, 0, "row-0", "user"),
                serialized_ledger_row(session_id, 1, "row-1", "assistant"),
                serialized_ledger_row(session_id, 2, "row-2", "assistant"),
                serialized_ledger_row(session_id, 3, "row-3", "operation"),
            ],
        )
        .await
        .expect("ledger write should succeed");

        let page = SessionTranscriptRowLedgerRepository::read_range_page(
            &db,
            session_id,
            "projection-v1",
            1,
            2,
        )
        .await
        .expect("range page read should succeed");

        let SessionTranscriptRowLedgerRead::Current { rows, .. } = page else {
            panic!("expected current ledger page");
        };
        assert_eq!(
            rows.iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["row-1", "row-2"]
        );
        assert_eq!(
            rows.iter().map(|row| row.row_index).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[tokio::test]
    async fn transcript_row_ledger_stale_projection_does_not_return_rows() {
        let db = setup_test_db().await;
        let session_id = "ledger-stale-session";
        ensure_test_session(&db, session_id).await;

        SessionTranscriptRowLedgerRepository::replace_current(
            &db,
            session_id,
            "projection-v1",
            7,
            11,
            13,
            None,
            vec![serialized_ledger_row(session_id, 0, "row-0", "assistant")],
        )
        .await
        .expect("ledger write should succeed");

        let page = SessionTranscriptRowLedgerRepository::read_tail_page(
            &db,
            session_id,
            "projection-v2",
            128,
        )
        .await
        .expect("stale ledger lookup should not fail");

        let SessionTranscriptRowLedgerRead::Stale { metadata } = page else {
            panic!("expected stale ledger metadata");
        };
        assert_eq!(metadata.session_id, session_id);
        assert_eq!(metadata.projection_version, "projection-v1");
        assert_eq!(metadata.row_count, 1);
    }

    #[tokio::test]
    async fn transcript_row_ledger_rejects_rows_from_another_session() {
        let db = setup_test_db().await;
        let session_id = "ledger-validation-session";
        ensure_test_session(&db, session_id).await;

        let result = SessionTranscriptRowLedgerRepository::replace_current(
            &db,
            session_id,
            "projection-v1",
            7,
            11,
            13,
            None,
            vec![serialized_ledger_row(
                "other-session",
                0,
                "row-0",
                "assistant",
            )],
        )
        .await;

        assert!(
            result.is_err(),
            "ledger write should reject rows from another session"
        );
        let page = SessionTranscriptRowLedgerRepository::read_tail_page(
            &db,
            session_id,
            "projection-v1",
            128,
        )
        .await
        .expect("failed write must not leave partial metadata");
        assert_eq!(page, SessionTranscriptRowLedgerRead::Missing);
    }

    #[tokio::test]
    async fn transcript_row_ledger_rebuild_needed_is_not_current_truth() {
        let db = setup_test_db().await;
        let session_id = "ledger-rebuild-needed-session";
        ensure_test_session(&db, session_id).await;

        SessionTranscriptRowLedgerRepository::replace_current(
            &db,
            session_id,
            "projection-v1",
            7,
            11,
            13,
            None,
            vec![serialized_ledger_row(session_id, 0, "row-0", "assistant")],
        )
        .await
        .expect("ledger write should succeed");

        SessionTranscriptRowLedgerRepository::mark_rebuild_needed(
            &db,
            session_id,
            "projection-v1",
            8,
            12,
            14,
        )
        .await
        .expect("mark rebuild needed should succeed");

        let page = SessionTranscriptRowLedgerRepository::read_tail_page(
            &db,
            session_id,
            "projection-v1",
            128,
        )
        .await
        .expect("rebuild-needed lookup should not fail");

        let SessionTranscriptRowLedgerRead::Stale { metadata } = page else {
            panic!("expected rebuild-needed metadata to read as stale");
        };
        assert_eq!(metadata.session_id, session_id);
        assert_eq!(
            metadata.rebuild_status,
            SessionTranscriptRowLedgerStatus::RebuildNeeded
        );
        assert_eq!(metadata.transcript_revision, 8);
        assert_eq!(metadata.graph_revision, 12);
        assert_eq!(metadata.last_event_seq, 14);
    }

    #[tokio::test]
    async fn transcript_row_ledger_replaces_only_changed_suffix() {
        let db = setup_test_db().await;
        let session_id = "ledger-suffix-session";
        ensure_test_session(&db, session_id).await;

        SessionTranscriptRowLedgerRepository::replace_current(
            &db,
            session_id,
            "projection-v1",
            7,
            11,
            13,
            None,
            vec![
                serialized_ledger_row(session_id, 0, "row-0", "user"),
                serialized_ledger_row(session_id, 1, "row-1", "assistant"),
                serialized_ledger_row(session_id, 2, "row-2", "assistant"),
            ],
        )
        .await
        .expect("initial ledger write should succeed");

        let mut changed_row = serialized_ledger_row(session_id, 1, "row-1", "assistant");
        changed_row.row_version = "v-1-updated".to_string();
        changed_row.transcript_revision = 8;
        changed_row.graph_revision = 12;
        changed_row.row_json = json!({
            "id": "row-1",
            "kind": "assistant",
            "updated": true
        })
        .to_string();
        let mut unchanged_suffix_row = serialized_ledger_row(session_id, 2, "row-2", "assistant");
        unchanged_suffix_row.transcript_revision = 8;
        unchanged_suffix_row.graph_revision = 12;

        let suffix_applied = SessionTranscriptRowLedgerRepository::replace_current_suffix(
            &db,
            session_id,
            "projection-v1",
            8,
            12,
            14,
            None,
            3,
            1,
            vec![changed_row, unchanged_suffix_row],
        )
        .await
        .expect("suffix ledger write should succeed");

        assert!(
            suffix_applied,
            "current ledger should accept suffix replace"
        );
        let page = SessionTranscriptRowLedgerRepository::read_range_page(
            &db,
            session_id,
            "projection-v1",
            0,
            3,
        )
        .await
        .expect("range page should read");
        let SessionTranscriptRowLedgerRead::Current { metadata, rows } = page else {
            panic!("expected current ledger page");
        };
        assert_eq!(metadata.row_count, 3);
        assert_eq!(metadata.transcript_revision, 8);
        assert_eq!(metadata.graph_revision, 12);
        assert_eq!(metadata.last_event_seq, 14);
        assert_eq!(
            rows.iter()
                .map(|row| (row.row_index, row.row_id.as_str(), row.row_version.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (0, "row-0", "v-0"),
                (1, "row-1", "v-1-updated"),
                (2, "row-2", "v-2")
            ]
        );
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
        let result = SessionMetadataRepository::get_for_projects(
            &db,
            &["/project-a".to_string()],
            &std::collections::HashSet::new(),
        )
        .await;

        assert!(result.is_ok());
        let sessions = result.unwrap().entries;
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

        let result = SessionMetadataRepository::get_for_projects(
            &db,
            &["/nonexistent".to_string()],
            &std::collections::HashSet::new(),
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().entries.is_empty());
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

        let sessions = SessionMetadataRepository::get_for_projects(
            &db,
            &[base_project.to_string()],
            &std::collections::HashSet::new(),
        )
        .await
        .unwrap()
        .entries;

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
    async fn test_set_provider_session_id_rejects_noncanonical_provider_alias() {
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
        let error = SessionMetadataRepository::set_provider_session_id(
            &db,
            "acepe-session",
            "claude-session",
        )
        .await
        .expect_err("completed sessions must not persist provider aliases");

        assert!(
            error.to_string().contains("Provider session id mismatch"),
            "unexpected error: {error}"
        );

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

        let local = SessionMetadataRepository::get_by_id(&db, "acepe-session")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(local.history_session_id(), "acepe-session");

        assert!(SessionMetadataRepository::get_by_id(&db, "claude-session")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn batch_upsert_keeps_canonical_session_id_as_history_id() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "claude-session",
            "/project",
            "claude-code",
            None,
        )
        .await
        .unwrap();

        let updated = SessionMetadataRepository::batch_upsert(
            &db,
            vec![(
                "claude-session".to_string(),
                "Real transcript title".to_string(),
                1704067300000,
                "/project".to_string(),
                "claude-code".to_string(),
                "-project/claude-session.jsonl".to_string(),
                1704067300,
                2048,
            )],
        )
        .await
        .unwrap();

        assert_eq!(updated, 1);

        let row = SessionMetadataRepository::get_by_id(&db, "claude-session")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(row.history_session_id(), "claude-session");
    }

    #[tokio::test]
    async fn set_provider_session_id_errors_when_metadata_row_is_missing() {
        let db = setup_test_db().await;

        let error = SessionMetadataRepository::set_provider_session_id(
            &db,
            "missing-session",
            "provider-session",
        )
        .await
        .expect_err("missing metadata must not look like a successful identity write");

        assert!(
            error.to_string().contains("Session metadata not found"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn set_provider_session_id_accepts_only_canonical_identity() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "provider-owned-id",
            "/project",
            "copilot",
            None,
        )
        .await
        .unwrap();
        SessionMetadataRepository::set_provider_session_id(
            &db,
            "provider-owned-id",
            "provider-owned-id",
        )
        .await
        .unwrap();

        let row = SessionMetadataRepository::get_by_id(&db, "provider-owned-id")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.history_session_id(), "provider-owned-id");
    }

    #[tokio::test]
    async fn creation_attempt_persists_initial_model_and_mode() {
        let db = setup_test_db().await;

        let attempt = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            Some("claude-sonnet-4-6"),
            Some("plan"),
        )
        .await
        .unwrap();

        assert_eq!(attempt.model_id.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(attempt.mode_id.as_deref(), Some("plan"));

        let loaded = SessionMetadataRepository::get_creation_attempt(&db, &attempt.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.model_id.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(loaded.mode_id.as_deref(), Some("plan"));
    }

    #[tokio::test]
    async fn creation_attempt_leaves_model_and_mode_null_when_unset() {
        let db = setup_test_db().await;

        let attempt = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(attempt.model_id, None);
        assert_eq!(attempt.mode_id, None);
    }

    #[tokio::test]
    async fn creation_attempt_assigns_sequence_id_without_session_metadata() {
        let db = setup_test_db().await;

        let attempt = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            Some("/project/.worktrees/feature-a"),
            None,
            None,
        )
        .await
        .unwrap();

        assert!(uuid::Uuid::parse_str(&attempt.id).is_ok());
        assert_eq!(attempt.status, CreationAttemptStatus::Pending.as_str());
        assert_eq!(attempt.agent_id, "claude-code");
        assert_eq!(attempt.project_path, "/project");
        assert_eq!(
            attempt.worktree_path.as_deref(),
            Some("/project/.worktrees/feature-a")
        );
        assert_eq!(attempt.sequence_id, Some(1));

        let metadata = SessionMetadataRepository::get_by_id(&db, &attempt.id)
            .await
            .unwrap();
        assert!(metadata.is_none());
        assert!(AcepeSessionState::find_by_id(&attempt.id)
            .one(&db)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn creation_attempt_assigns_distinct_increasing_sequence_ids_per_project() {
        let db = setup_test_db().await;

        let first = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();
        let second = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(first.sequence_id, Some(1));
        assert_eq!(second.sequence_id, Some(2));
    }

    #[tokio::test]
    async fn creation_attempt_does_not_recycle_sequence_id_from_abandoned_attempt() {
        let db = setup_test_db().await;

        let abandoned = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(abandoned.sequence_id, Some(1));

        SessionMetadataRepository::fail_creation_attempt(&db, &abandoned.id, "abandoned")
            .await
            .unwrap();

        let next = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(next.sequence_id, Some(2));
    }

    #[tokio::test]
    async fn promoting_creation_attempt_reuses_existing_attempt_sequence_id() {
        let db = setup_test_db().await;
        let attempt = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(attempt.sequence_id, Some(1));

        let promoted = SessionMetadataRepository::promote_creation_attempt(
            &db,
            &attempt.id,
            "provider-canonical-id",
        )
        .await
        .unwrap();

        assert_eq!(promoted.sequence_id, Some(1));
    }

    #[tokio::test]
    async fn promoting_creation_attempt_allocates_sequence_for_legacy_null_attempt_sequence() {
        use crate::db::entities::creation_attempt;
        use crate::db::entities::prelude::CreationAttempt;
        use sea_orm::{ActiveModelTrait, EntityTrait, Set};

        let db = setup_test_db().await;
        let attempt = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let mut active: creation_attempt::ActiveModel = CreationAttempt::find_by_id(&attempt.id)
            .one(&db)
            .await
            .unwrap()
            .expect("attempt row should exist")
            .into();
        active.sequence_id = Set(None);
        active.update(&db).await.unwrap();

        let promoted = SessionMetadataRepository::promote_creation_attempt(
            &db,
            &attempt.id,
            "provider-canonical-id",
        )
        .await
        .unwrap();

        assert_eq!(promoted.sequence_id, Some(1));
    }

    #[tokio::test]
    async fn promoting_creation_attempt_allocates_sequence_inside_canonical_session_transaction() {
        let db = setup_test_db().await;
        let attempt = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let promoted = SessionMetadataRepository::promote_creation_attempt(
            &db,
            &attempt.id,
            "provider-canonical-id",
        )
        .await
        .unwrap();

        assert_eq!(promoted.id, "provider-canonical-id");
        assert_eq!(promoted.agent_id, "claude-code");
        assert_eq!(promoted.sequence_id, Some(1));
        assert_eq!(promoted.history_session_id(), "provider-canonical-id");

        let attempt_after = SessionMetadataRepository::get_creation_attempt(&db, &attempt.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            attempt_after.status,
            CreationAttemptStatus::Consumed.as_str()
        );
        assert_eq!(
            attempt_after.provider_session_id.as_deref(),
            Some("provider-canonical-id")
        );
    }

    #[tokio::test]
    async fn stale_pending_creation_attempt_gc_expires_old_rows_only() {
        let db = setup_test_db().await;
        let stale = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .unwrap();
        let recent = SessionMetadataRepository::create_creation_attempt(
            &db, "/project", "copilot", None, None, None,
        )
        .await
        .unwrap();

        db.execute(Statement::from_sql_and_values(
            db.get_database_backend(),
            "UPDATE creation_attempts SET created_at = ? WHERE id = ?",
            [
                chrono::Utc::now()
                    .checked_sub_signed(chrono::Duration::hours(2))
                    .unwrap()
                    .into(),
                stale.id.clone().into(),
            ],
        ))
        .await
        .unwrap();

        let expired = SessionMetadataRepository::expire_stale_creation_attempts(
            &db,
            chrono::Utc::now()
                .checked_sub_signed(chrono::Duration::hours(1))
                .unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(expired, 1);
        assert_eq!(
            SessionMetadataRepository::get_creation_attempt(&db, &stale.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            CreationAttemptStatus::Expired.as_str()
        );
        assert_eq!(
            SessionMetadataRepository::get_creation_attempt(&db, &recent.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            CreationAttemptStatus::Pending.as_str()
        );
    }

    #[tokio::test]
    async fn pending_creation_attempt_quota_rejects_excess_rows() {
        let db = setup_test_db().await;
        for _ in 0..SessionMetadataRepository::PENDING_CREATION_ATTEMPTS_PER_PROJECT_AGENT_CAP {
            SessionMetadataRepository::create_creation_attempt(
                &db,
                "/project",
                "claude-code",
                None,
                None,
                None,
            )
            .await
            .unwrap();
        }

        let error = SessionMetadataRepository::create_creation_attempt(
            &db,
            "/project",
            "claude-code",
            None,
            None,
            None,
        )
        .await
        .expect_err("quota must reject the extra pending attempt");

        assert!(matches!(
            error,
            CreationAttemptRepositoryError::QuotaExceeded { .. }
        ));
    }

    #[tokio::test]
    async fn worktree_launch_reservation_uses_creation_attempt_not_fake_session_metadata() {
        let db = setup_test_db().await;

        let reserved =
            SessionMetadataRepository::reserve_worktree_launch(&db, "/project", "claude-code")
                .await
                .unwrap();

        assert_eq!(reserved.sequence_id, 1);
        assert!(uuid::Uuid::parse_str(&reserved.launch_token).is_ok());
        assert!(
            SessionMetadataRepository::get_by_id(&db, &reserved.launch_token)
                .await
                .unwrap()
                .is_none()
        );

        let attempt = SessionMetadataRepository::get_creation_attempt(&db, &reserved.launch_token)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(attempt.status, CreationAttemptStatus::Pending.as_str());
        assert_eq!(attempt.sequence_id, Some(1));
        assert_eq!(
            attempt.launch_token.as_deref(),
            Some(reserved.launch_token.as_str())
        );

        SessionMetadataRepository::attach_reserved_worktree_launch(
            &db,
            &reserved.launch_token,
            "/project/.worktrees/feature-a",
        )
        .await
        .unwrap();
        let attached =
            SessionMetadataRepository::get_reserved_worktree_launch(&db, &reserved.launch_token)
                .await
                .unwrap()
                .unwrap();
        assert_eq!(
            attached.worktree_path.as_deref(),
            Some("/project/.worktrees/feature-a")
        );
    }

    #[test]
    fn test_session_metadata_row_history_session_id_is_always_canonical() {
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
            worktree_path: None,
            pr_number: None,
            pr_link_mode: None,
            is_acepe_managed: false,
            sequence_id: None,
        };

        assert_eq!(row.history_session_id(), "session-generic");
    }

    #[tokio::test]
    async fn test_delete_by_agent_for_projects_excluding_ids_preserves_acepe_managed_rows() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "acepe-managed-session",
            "/project",
            "copilot",
            None,
        )
        .await
        .unwrap();

        let deleted = SessionMetadataRepository::delete_by_agent_for_projects_excluding_ids(
            &db,
            "copilot",
            &["/project".to_string()],
            &std::collections::HashSet::new(),
        )
        .await
        .unwrap();

        assert_eq!(
            deleted, 0,
            "provider tombstones must not delete active Acepe-managed sessions"
        );
        assert!(
            SessionMetadataRepository::get_by_id(&db, "acepe-managed-session")
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn test_delete_by_agent_for_projects_excluding_ids_uses_canonical_ids_only() {
        let db = setup_test_db().await;

        SessionMetadataRepository::upsert(
            &db,
            "acepe-session".to_string(),
            "Scanned".to_string(),
            1704067200000,
            "/project".to_string(),
            "claude-code".to_string(),
            "-project/acepe-session.jsonl".to_string(),
            1704067200,
            1024,
        )
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

        assert_eq!(deleted, 1);
        assert!(SessionMetadataRepository::get_by_id(&db, "acepe-session")
            .await
            .unwrap()
            .is_none());
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
            SessionDescriptorCompatibility::Canonical
        );
        assert!(descriptor.is_resumable());
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
}

#[cfg(test)]
mod session_config_selection_tests {
    use crate::db::repository::{SessionConfigSelectionRepository, SessionMetadataRepository};
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;

    /// Create an in-memory SQLite database with migrations applied.
    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("Failed to connect to in-memory SQLite");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("Failed to run migrations");
        db
    }

    /// Insert a parent session row so the config-selection foreign key resolves.
    async fn seed_session(db: &DbConn, session_id: &str) {
        SessionMetadataRepository::upsert(
            db,
            session_id.to_string(),
            "Test".to_string(),
            1_704_067_200_000,
            "/Users/test/project".to_string(),
            "claude-code".to_string(),
            format!("-Users-test-project/{session_id}.jsonl"),
            1_704_067_200,
            1024,
        )
        .await
        .expect("seed session metadata");
    }

    #[tokio::test]
    async fn set_then_get_all_round_trips_selection() {
        let db = setup_test_db().await;
        seed_session(&db, "session-1").await;

        SessionConfigSelectionRepository::set(&db, "session-1", "reasoning_effort", "high")
            .await
            .expect("set selection");

        let selections = SessionConfigSelectionRepository::get_all(&db, "session-1")
            .await
            .expect("get selections");
        assert_eq!(
            selections,
            vec![("reasoning_effort".to_string(), "high".to_string())]
        );
    }

    #[tokio::test]
    async fn get_all_is_empty_for_unknown_session() {
        let db = setup_test_db().await;

        let selections = SessionConfigSelectionRepository::get_all(&db, "missing")
            .await
            .expect("get selections");
        assert!(selections.is_empty());
    }

    #[tokio::test]
    async fn set_twice_keeps_latest_value() {
        let db = setup_test_db().await;
        seed_session(&db, "session-1").await;

        SessionConfigSelectionRepository::set(&db, "session-1", "reasoning_effort", "high")
            .await
            .expect("first set");
        SessionConfigSelectionRepository::set(&db, "session-1", "reasoning_effort", "low")
            .await
            .expect("second set");

        let selections = SessionConfigSelectionRepository::get_all(&db, "session-1")
            .await
            .expect("get selections");
        assert_eq!(
            selections,
            vec![("reasoning_effort".to_string(), "low".to_string())]
        );
    }

    #[tokio::test]
    async fn clear_removes_only_target_selection() {
        let db = setup_test_db().await;
        seed_session(&db, "session-1").await;

        SessionConfigSelectionRepository::set(&db, "session-1", "reasoning_effort", "high")
            .await
            .expect("set effort");
        SessionConfigSelectionRepository::set(&db, "session-1", "fast_mode", "true")
            .await
            .expect("set fast mode");

        SessionConfigSelectionRepository::clear(&db, "session-1", "reasoning_effort")
            .await
            .expect("clear effort");

        let selections = SessionConfigSelectionRepository::get_all(&db, "session-1")
            .await
            .expect("get selections");
        assert_eq!(
            selections,
            vec![("fast_mode".to_string(), "true".to_string())]
        );
    }

    #[tokio::test]
    async fn selections_are_scoped_per_session() {
        let db = setup_test_db().await;
        seed_session(&db, "session-1").await;
        seed_session(&db, "session-2").await;

        SessionConfigSelectionRepository::set(&db, "session-1", "reasoning_effort", "high")
            .await
            .expect("set s1");
        SessionConfigSelectionRepository::set(&db, "session-2", "reasoning_effort", "xhigh")
            .await
            .expect("set s2");

        let s1 = SessionConfigSelectionRepository::get_all(&db, "session-1")
            .await
            .expect("get s1");
        assert_eq!(
            s1,
            vec![("reasoning_effort".to_string(), "high".to_string())]
        );
    }
}
