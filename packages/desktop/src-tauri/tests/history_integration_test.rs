//! Integration tests for unified history system.
//!
//! These tests verify database migrations work correctly.
//! Full session content is parsed on-demand from source files (not stored in DB).

use acepe_lib::db::migrations::Migrator;
use sea_orm::{Database, DatabaseConnection, DbErr};
use sea_orm_migration::MigratorTrait;

async fn setup_test_db() -> Result<DatabaseConnection, DbErr> {
    // Create in-memory SQLite database
    let db = Database::connect("sqlite::memory:").await?;

    // Run all migrations
    Migrator::up(&db, None).await?;

    Ok(db)
}

#[tokio::test]
async fn test_migration_creates_tables() {
    let db = setup_test_db().await.expect("Failed to setup test DB");

    // Verify we can query the session_metadata table (it exists)
    use acepe_lib::db::entities::SessionMetadata;
    use sea_orm::{EntityTrait, PaginatorTrait};

    let count = SessionMetadata::find()
        .count(&db)
        .await
        .expect("Should query session_metadata");
    assert_eq!(count, 0, "Should start with empty session_metadata table");
}
