//! Integration tests for Cursor SQLite parser and session discovery.
//!
//! These tests verify the cursor history parsing works correctly.
//! Note: Full session content is parsed on-demand from source files,
//! not cached in the database.

use acepe_lib::db::migrations::Migrator;
use acepe_lib::db::repository::SessionMetadataRepository;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use sea_orm_migration::MigratorTrait;

async fn setup_test_db() -> DatabaseConnection {
    let db = Database::connect("sqlite::memory:")
        .await
        .expect("Failed to create test database");

    // Run migrations
    Migrator::up(&db, None)
        .await
        .expect("Failed to run migrations");

    db
}

#[tokio::test]
async fn test_migrations_run_successfully() {
    // Just verify migrations don't fail
    let _db = setup_test_db().await;
}

#[tokio::test]
async fn test_legacy_snapshot_tables_are_removed_after_migrations() {
    let db = setup_test_db().await;

    for table_name in [
        "session_projection_snapshot",
        "session_transcript_snapshot",
        "session_thread_snapshot",
    ] {
        let row = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                format!(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '{table_name}'"
                ),
            ))
            .await
            .expect("query snapshot table existence");

        assert!(
            row.is_none(),
            "expected legacy snapshot table {table_name} to be removed after migrations"
        );
    }
}

#[tokio::test]
async fn session_event_sequence_upgrade_backfills_the_greatest_persisted_frontier() {
    let db = setup_test_db().await;
    Migrator::down(&db, Some(1))
        .await
        .expect("roll back sequence migration");

    for session_id in ["journal-frontier", "ledger-frontier", "empty-frontier"] {
        SessionMetadataRepository::ensure_exists(
            &db,
            session_id,
            "/test/project",
            "claude-code",
            None,
        )
        .await
        .expect("seed migration session metadata");
    }

    for (event_id, session_id, event_seq) in [
        ("journal-1", "journal-frontier", 7),
        ("ledger-1", "ledger-frontier", 2),
    ] {
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO session_journal_event \
                 (event_id, session_id, event_seq, event_kind, event_json, created_at) \
                 VALUES ('{event_id}', '{session_id}', {event_seq}, \
                 'materialization_barrier', '\"materialization_barrier\"', CURRENT_TIMESTAMP)"
            ),
        ))
        .await
        .expect("seed migration journal frontier");
    }

    for (session_id, last_event_seq) in [("journal-frontier", 5), ("ledger-frontier", 9)] {
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO session_transcript_row_ledger \
                 (session_id, transcript_revision, graph_revision, last_event_seq, \
                  projection_version, open_header_json, rebuild_status, updated_at) \
                 VALUES ('{session_id}', 1, 1, {last_event_seq}, \
                 'v1', NULL, 'current', CURRENT_TIMESTAMP)"
            ),
        ))
        .await
        .expect("seed migration ledger frontier");
    }

    Migrator::up(&db, None)
        .await
        .expect("apply sequence migration");

    for (session_id, expected) in [("journal-frontier", 7), ("ledger-frontier", 9)] {
        let row = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                format!(
                    "SELECT last_assigned_seq FROM session_event_sequence \
                     WHERE session_id = '{session_id}'"
                ),
            ))
            .await
            .expect("query backfilled sequence")
            .expect("backfilled sequence row");
        assert_eq!(
            row.try_get_by_index::<i64>(0).expect("sequence value"),
            expected
        );
    }

    let empty = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT last_assigned_seq FROM session_event_sequence \
             WHERE session_id = 'empty-frontier'"
                .to_string(),
        ))
        .await
        .expect("query empty sequence frontier");
    assert!(empty.is_none(), "zero-only sessions need no sequence row");
}

#[tokio::test]
async fn populated_v16_transcript_row_ledger_upgrade_discards_rows_and_requests_rebuild() {
    let db = setup_test_db().await;
    Migrator::down(&db, Some(2))
        .await
        .expect("roll back sequence and scoped-ledger migrations");
    let session_id = "populated-v16-ledger";
    SessionMetadataRepository::ensure_exists(&db, session_id, "/test/project", "claude-code", None)
        .await
        .expect("seed v16 migration session metadata");
    db.execute(Statement::from_string(
        DbBackend::Sqlite,
        format!(
            "INSERT INTO session_transcript_row_ledger \
             (session_id, row_count, transcript_revision, graph_revision, last_event_seq, \
              projection_version, open_header_json, rebuild_status, updated_at) \
             VALUES ('{session_id}', 1, 7, 11, 13, \
              'transcript_viewport_row:v16', NULL, 'current', CURRENT_TIMESTAMP)"
        ),
    ))
    .await
    .expect("seed populated v16 ledger header");
    db.execute(Statement::from_string(
        DbBackend::Sqlite,
        format!(
            "INSERT INTO session_transcript_row \
             (session_id, row_index, row_id, source_entry_id, row_kind, row_version, \
              transcript_revision, graph_revision, projection_version, row_json, updated_at) \
             VALUES ('{session_id}', 0, 'transcript:entry-1', 'entry-1', 'assistant', \
              'row-v1', 7, 11, 'transcript_viewport_row:v16', '{{}}', CURRENT_TIMESTAMP)"
        ),
    ))
    .await
    .expect("seed populated v16 ledger row");

    Migrator::up(&db, None)
        .await
        .expect("upgrade populated v16 ledger to scoped schema");

    let header = db
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT projection_version, rebuild_status \
                 FROM session_transcript_row_ledger WHERE session_id = '{session_id}'"
            ),
        ))
        .await
        .expect("query upgraded ledger header")
        .expect("upgraded ledger header");
    assert_eq!(
        header
            .try_get_by_index::<String>(0)
            .expect("projection version"),
        "transcript_viewport_row:v16"
    );
    assert_eq!(
        header
            .try_get_by_index::<String>(1)
            .expect("rebuild status"),
        "rebuild_needed",
        "discarded v16 rows must never remain marked current"
    );

    for table_name in ["session_transcript_row", "session_transcript_row_scope"] {
        let count = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT COUNT(*) FROM {table_name} WHERE session_id = '{session_id}'"),
            ))
            .await
            .expect("query upgraded scoped ledger table")
            .expect("scoped ledger count row")
            .try_get_by_index::<i64>(0)
            .expect("scoped ledger count");
        assert_eq!(count, 0, "v16 cache rows must be discarded for rebuild");
    }
}

#[tokio::test]
async fn test_cursor_sqlite_parser_directly() {
    use acepe_lib::history::cursor_sqlite_parser;
    use std::path::PathBuf;

    let db_path = match std::env::var("ACEPE_CURSOR_STORE_DB_PATH") {
        Ok(path) => PathBuf::from(path),
        Err(_) => {
            println!("⚠️  Skipping test: set ACEPE_CURSOR_STORE_DB_PATH to a Cursor store.db path");
            return;
        }
    };

    if !db_path.exists() {
        println!("⚠️  Skipping test: store.db not found at {:?}", db_path);
        return;
    }

    println!("\n📖 Testing direct SQLite parser on real store.db...");
    println!("   Path: {:?}", db_path);

    let session_id = db_path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("unknown-session");

    let result = cursor_sqlite_parser::parse_cursor_store_db(&db_path, session_id, None).await;

    match result {
        Ok(session) => {
            println!("✅ SQLite parsing succeeded!");
            println!("   Session ID: {}", session.session_id);
            println!("   Title: {}", session.title);
            println!("   Messages: {}", session.messages.len());
            println!(
                "   Stats: total={}, users={}, assistants={}, tools={}",
                session.stats.total_messages,
                session.stats.user_messages,
                session.stats.assistant_messages,
                session.stats.tool_uses
            );

            // Print first few messages
            for (i, msg) in session.messages.iter().take(5).enumerate() {
                println!(
                    "   Message {}: role={}, blocks={}",
                    i,
                    msg.role,
                    msg.content_blocks.len()
                );
                for (j, block) in msg.content_blocks.iter().take(2).enumerate() {
                    match block {
                        acepe_lib::session_jsonl::types::ContentBlock::Text { text } => {
                            let preview = if text.len() > 60 {
                                format!("{}...", &text[..60])
                            } else {
                                text.clone()
                            };
                            println!("      Block {}: Text({})", j, preview);
                        }
                        acepe_lib::session_jsonl::types::ContentBlock::PastedContent { text } => {
                            let preview = if text.len() > 60 {
                                format!("{}...", &text[..60])
                            } else {
                                text.clone()
                            };
                            println!("      Block {}: PastedContent({})", j, preview);
                        }
                        acepe_lib::session_jsonl::types::ContentBlock::Thinking {
                            thinking,
                            ..
                        } => {
                            let preview = if thinking.len() > 60 {
                                format!("{}...", &thinking[..60])
                            } else {
                                thinking.clone()
                            };
                            println!("      Block {}: Thinking({})", j, preview);
                        }
                        acepe_lib::session_jsonl::types::ContentBlock::ToolUse { name, .. } => {
                            println!("      Block {}: ToolUse({})", j, name);
                        }
                        acepe_lib::session_jsonl::types::ContentBlock::ToolResult { .. } => {
                            println!("      Block {}: ToolResult", j);
                        }
                        acepe_lib::session_jsonl::types::ContentBlock::CodeAttachment {
                            path,
                            ..
                        } => {
                            println!("      Block {}: CodeAttachment({})", j, path);
                        }
                    }
                }
            }

            assert!(
                !session.messages.is_empty(),
                "Session should have at least one message"
            );
        }
        Err(e) => {
            panic!("❌ SQLite parsing failed: {}", e);
        }
    }
}
