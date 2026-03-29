use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionContext {
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub effective_project_path: String,
    pub source_path: Option<String>,
    pub agent_id: String,
}

pub async fn resolve_session_context(
    db: Option<&DbConn>,
    session_id: &str,
    fallback_project_path: &str,
    fallback_agent_id: &str,
    fallback_source_path: Option<&str>,
) -> SessionContext {
    let metadata = match db {
        Some(db) => SessionMetadataRepository::get_by_id(db, session_id)
            .await
            .ok()
            .flatten(),
        None => None,
    };

    let project_path = metadata
        .as_ref()
        .map(|row| row.project_path.clone())
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| fallback_project_path.to_string());

    let worktree_path = metadata.as_ref().and_then(|row| row.worktree_path.clone());

    let effective_project_path = worktree_path
        .clone()
        .unwrap_or_else(|| project_path.clone());

    let source_path = metadata
        .as_ref()
        .and_then(|row| SessionMetadataRepository::normalized_source_path(&row.file_path))
        .or_else(|| fallback_source_path.map(|path| path.to_string()));

    let agent_id = metadata
        .as_ref()
        .map(|row| row.agent_id.clone())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| fallback_agent_id.to_string());

    SessionContext {
        project_path,
        worktree_path,
        effective_project_path,
        source_path,
        agent_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::commands::persist_session_metadata_for_cwd;
    use crate::acp::types::CanonicalAgentId;
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use tempfile::tempdir;

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
    async fn resolve_session_context_prefers_db_worktree_path() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-worktree",
            "/repo",
            "claude-code",
            Some("/repo/.worktrees/feature-a"),
        )
        .await
        .expect("ensure exists");

        let context = resolve_session_context(
            Some(&db),
            "session-worktree",
            "/fallback-repo",
            "cursor",
            None,
        )
        .await;

        assert_eq!(context.project_path, "/repo");
        assert_eq!(
            context.worktree_path.as_deref(),
            Some("/repo/.worktrees/feature-a")
        );
        assert_eq!(context.effective_project_path, "/repo/.worktrees/feature-a");
        assert_eq!(context.source_path, None);
        assert_eq!(context.agent_id, "claude-code");
    }

    #[tokio::test]
    async fn resolve_session_context_uses_worktree_metadata_persisted_at_session_start() {
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
        .expect("persist startup metadata");

        let canonical_worktree_path = worktree_path
            .canonicalize()
            .expect("canonical worktree path");

        let context = resolve_session_context(
            Some(&db),
            "session-worktree",
            "/fallback-project",
            "cursor",
            None,
        )
        .await;

        assert_eq!(context.project_path, repo_path.to_string_lossy());
        assert_eq!(
            context.worktree_path.as_deref(),
            Some(canonical_worktree_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            context.effective_project_path,
            canonical_worktree_path.to_string_lossy()
        );
        assert_eq!(context.source_path, None);
        assert_eq!(context.agent_id, "claude-code");
    }

    #[tokio::test]
    async fn resolve_session_context_uses_fallbacks_when_metadata_missing() {
        let context = resolve_session_context(
            None,
            "session-id",
            "/repo",
            "opencode",
            Some("/tmp/source.json"),
        )
        .await;

        assert_eq!(context.project_path, "/repo");
        assert_eq!(context.worktree_path, None);
        assert_eq!(context.effective_project_path, "/repo");
        assert_eq!(context.source_path.as_deref(), Some("/tmp/source.json"));
        assert_eq!(context.agent_id, "opencode");
    }
}
