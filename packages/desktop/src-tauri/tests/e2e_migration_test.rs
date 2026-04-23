//! Integration tests for Cursor SQLite parser and session discovery.
//!
//! These tests verify the cursor history parsing works correctly.
//! Note: Full session content is parsed on-demand from source files,
//! not cached in the database.

use acepe_lib::db::migrations::Migrator;
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
