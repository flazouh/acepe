//! Tests for SessionMetadataRepository
//!
//! Uses an in-memory SQLite database for fast, isolated tests.

#[cfg(test)]
mod session_metadata_tests {
    use crate::db::repository::SessionMetadataRepository;
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
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

        let base_project = "/Users/alex/Documents/acepe";
        let worktree = "/Users/alex/.acepe/worktrees/6d4131f5197e/witty-ocean";

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

        let base_project = "/Users/alex/Documents/acepe";
        let worktree = "/Users/alex/.acepe/worktrees/6d4131f5197e/witty-ocean";

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

        let base_project = "/Users/alex/Documents/acepe";
        let worktree = "/Users/alex/.acepe/worktrees/6d4131f5197e/witty-ocean";

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

        let base_project = "/Users/alex/Documents/acepe";
        let worktree = "/Users/alex/.acepe/worktrees/6d4131f5197e/witty-ocean";

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

        let base_project = "/Users/alex/Documents/acepe";
        let worktree = "/Users/alex/.acepe/worktrees/6d4131f5197e/witty-ocean";

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
}
