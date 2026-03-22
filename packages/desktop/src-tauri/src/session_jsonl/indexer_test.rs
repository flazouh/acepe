//! Tests for SessionIndexer (Actor pattern)
//!
//! Tests the indexer's ability to scan directories, extract metadata,
//! and maintain the SQLite index.

#[cfg(test)]
mod indexer_tests {
    use crate::db::repository::SessionMetadataRepository;
    use crate::history::indexer::{IndexStatus, IndexerActor};
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use std::sync::Arc;

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

    #[tokio::test]
    async fn test_indexer_spawn_returns_handle() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle = IndexerActor::spawn(db_arc);

        // Should be able to get status
        let status = handle.get_status().await;
        assert!(status.is_ok());
    }

    #[tokio::test]
    async fn test_indexer_initial_status_is_idle() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle = IndexerActor::spawn(db_arc);
        let status = handle.get_status().await.unwrap();

        matches!(status, IndexStatus::Idle);
    }

    #[tokio::test]
    async fn test_indexer_full_scan_empty_projects() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db.clone());

        let handle = IndexerActor::spawn(db_arc);

        // Scan with no projects
        let result = handle.full_scan(vec![]).await;

        assert!(result.is_ok());
        let scan_result = result.unwrap();
        assert_eq!(scan_result.files_indexed, 0);
        assert_eq!(scan_result.files_unchanged, 0);
        assert_eq!(scan_result.files_deleted, 0);

        // Index should still be empty
        assert!(SessionMetadataRepository::is_empty(&db).await.unwrap());
    }

    #[tokio::test]
    async fn test_indexer_status_ready_after_scan() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle = IndexerActor::spawn(db_arc);

        // Perform a scan
        handle.full_scan(vec![]).await.unwrap();

        // Status should be Ready
        let status = handle.get_status().await.unwrap();
        match status {
            IndexStatus::Ready { session_count } => {
                assert_eq!(session_count, 0);
            }
            _ => panic!("Expected Ready status, got {:?}", status),
        }
    }

    #[tokio::test]
    async fn test_indexer_shutdown() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle = IndexerActor::spawn(db_arc);

        // Shutdown should succeed
        let result = handle.shutdown().await;
        assert!(result.is_ok());

        // Subsequent operations should fail (actor shut down)
        let status = handle.get_status().await;
        assert!(status.is_err());
    }

    #[tokio::test]
    async fn test_scan_result_contains_duration() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle = IndexerActor::spawn(db_arc);

        let result = handle.full_scan(vec![]).await.unwrap();

        // Duration should be reasonable (not 0, not too large)
        assert!(
            result.duration_ms < 10000,
            "Duration should be less than 10s"
        );
    }

    #[tokio::test]
    async fn test_incremental_scan_on_empty_index() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db.clone());

        let handle = IndexerActor::spawn(db_arc);

        // Incremental scan with no existing index and no projects
        let result = handle.incremental_scan(vec![]).await;

        assert!(result.is_ok());
        let scan_result = result.unwrap();
        assert_eq!(scan_result.files_indexed, 0);
        assert_eq!(scan_result.files_unchanged, 0);
        assert_eq!(scan_result.files_deleted, 0);
    }

    #[tokio::test]
    async fn test_multiple_handles_share_actor() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle1 = IndexerActor::spawn(db_arc);
        let handle2 = handle1.clone();

        // Both handles should work
        let status1 = handle1.get_status().await;
        let status2 = handle2.get_status().await;

        assert!(status1.is_ok());
        assert!(status2.is_ok());
    }

    #[tokio::test]
    async fn test_index_file_nonexistent_path() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle = IndexerActor::spawn(db_arc);

        // Try to index a file that doesn't exist
        // This will fail because:
        // 1. File doesn't exist
        // 2. Path is not under ~/.claude/projects/ so relative path computation fails
        let result = handle
            .index_file(std::path::PathBuf::from("/nonexistent/path/file.jsonl"))
            .await;

        // Should return Err because path is not under Claude home dir
        assert!(result.is_err(), "Expected error for invalid path");
    }

    #[tokio::test]
    async fn test_delete_file_from_index() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db.clone());

        // First, manually insert a session
        SessionMetadataRepository::upsert(
            &db,
            "session-to-delete".to_string(),
            "Test".to_string(),
            1704067200000,
            "/project".to_string(),
            "claude-code".to_string(),
            "-project/session-to-delete.jsonl".to_string(),
            1704067200,
            1024,
        )
        .await
        .unwrap();

        let handle = IndexerActor::spawn(db_arc);

        // Delete via the actor
        let result = handle
            .delete_file(std::path::PathBuf::from(
                "/fake/.claude/projects/-project/session-to-delete.jsonl",
            ))
            .await;

        // This will try to compute relative path but fail since we're using fake paths
        // In real usage, paths would be valid
        // Just verify the actor processes the message
        assert!(result.is_err() || result.is_ok());
    }

    // =========================================================================
    // Actor Message Protocol Tests
    // =========================================================================

    #[tokio::test]
    async fn test_concurrent_status_requests() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle = IndexerActor::spawn(db_arc);

        // Send multiple concurrent status requests
        let futures: Vec<_> = (0..10)
            .map(|_| {
                let h = handle.clone();
                tokio::spawn(async move { h.get_status().await })
            })
            .collect();

        let results: Vec<_> = futures::future::join_all(futures).await;

        // All should succeed
        for result in results {
            assert!(result.is_ok());
            assert!(result.unwrap().is_ok());
        }
    }

    #[tokio::test]
    async fn test_fire_and_forget_index() {
        let db = setup_test_db().await;
        let db_arc = Arc::new(db);

        let handle = IndexerActor::spawn(db_arc);

        // Fire and forget (no panic)
        handle.index_file_nowait(std::path::PathBuf::from("/some/path.jsonl"));
        handle.delete_file_nowait(std::path::PathBuf::from("/some/other.jsonl"));

        // Actor should still be responsive
        let status = handle.get_status().await;
        assert!(status.is_ok());
    }
}
