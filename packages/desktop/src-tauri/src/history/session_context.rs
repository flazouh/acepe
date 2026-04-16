use crate::acp::session_descriptor::{
    SessionCompatibilityInput, SessionDescriptorCompatibility, SessionReplayContext,
};
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::SessionMetadataRepository;
use sea_orm::DbConn;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionContext {
    pub local_session_id: String,
    pub history_session_id: String,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub effective_project_path: String,
    pub source_path: Option<String>,
    pub agent_id: CanonicalAgentId,
    pub compatibility: SessionDescriptorCompatibility,
    pub session_metadata: Option<crate::db::repository::SessionMetadataRow>,
}

impl SessionContext {
    #[must_use]
    pub fn replay_context(&self) -> SessionReplayContext {
        SessionReplayContext {
            local_session_id: self.local_session_id.clone(),
            history_session_id: self.history_session_id.clone(),
            agent_id: self.agent_id.clone(),
            parser_agent_type: crate::acp::parsers::AgentType::from_canonical(&self.agent_id),
            project_path: self.project_path.clone(),
            worktree_path: self.worktree_path.clone(),
            effective_cwd: self.effective_project_path.clone(),
            source_path: self.source_path.clone(),
            compatibility: self.compatibility.clone(),
        }
    }
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

    let descriptor = SessionMetadataRepository::resolve_existing_session_descriptor_from_metadata(
        session_id,
        metadata.as_ref(),
        SessionCompatibilityInput {
            project_path: Some(fallback_project_path.to_string()),
            agent_id: Some(CanonicalAgentId::parse(fallback_agent_id)),
            source_path: fallback_source_path.map(|path| path.to_string()),
        },
    )
    .unwrap_or_else(|error| {
        tracing::warn!(
            session_id = %session_id,
            error = %error,
            "Falling back to compatibility session context after descriptor resolution failure"
        );
        crate::acp::session_descriptor::resolve_existing_session_descriptor(
            crate::acp::session_descriptor::SessionDescriptorFacts::for_session(session_id),
            SessionCompatibilityInput {
                project_path: Some(fallback_project_path.to_string()),
                agent_id: Some(CanonicalAgentId::parse(fallback_agent_id)),
                source_path: fallback_source_path.map(|path| path.to_string()),
            },
        )
        .expect("compatibility inputs should resolve session context")
    });

    SessionContext {
        local_session_id: descriptor.local_session_id,
        history_session_id: descriptor.history_session_id,
        project_path: descriptor.project_path,
        worktree_path: descriptor.worktree_path,
        effective_project_path: descriptor.effective_cwd,
        source_path: descriptor.source_path,
        agent_id: descriptor.agent_id,
        compatibility: descriptor.compatibility,
        session_metadata: metadata,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::commands::persist_session_metadata_for_cwd;
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

        assert_eq!(context.local_session_id, "session-worktree");
        assert_eq!(context.history_session_id, "session-worktree");
        assert_eq!(context.project_path, "/repo");
        assert_eq!(
            context.worktree_path.as_deref(),
            Some("/repo/.worktrees/feature-a")
        );
        assert_eq!(context.effective_project_path, "/repo/.worktrees/feature-a");
        assert_eq!(context.source_path, None);
        assert_eq!(context.agent_id, CanonicalAgentId::ClaudeCode);
        assert_eq!(
            context.compatibility,
            SessionDescriptorCompatibility::ReadOnly {
                missing_facts: vec![
                    crate::acp::session_descriptor::SessionDescriptorMissingFact::ProviderSessionId
                ]
            }
        );
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
            format!(
                "gitdir: {}
",
                gitdir_path.display()
            ),
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

        let canonical_repo_path = repo_path.canonicalize().expect("canonical repo path");

        assert_eq!(context.local_session_id, "session-worktree");
        assert_eq!(context.history_session_id, "session-worktree");
        assert_eq!(context.project_path, canonical_repo_path.to_string_lossy());
        assert_eq!(
            context.worktree_path.as_deref(),
            Some(canonical_worktree_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            context.effective_project_path,
            canonical_worktree_path.to_string_lossy()
        );
        assert_eq!(context.source_path, None);
        assert_eq!(context.agent_id, CanonicalAgentId::ClaudeCode);
        assert_eq!(
            context.compatibility,
            SessionDescriptorCompatibility::ReadOnly {
                missing_facts: vec![
                    crate::acp::session_descriptor::SessionDescriptorMissingFact::ProviderSessionId
                ]
            }
        );
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

        assert_eq!(context.local_session_id, "session-id");
        assert_eq!(context.history_session_id, "session-id");
        assert_eq!(context.project_path, "/repo");
        assert_eq!(context.worktree_path, None);
        assert_eq!(context.effective_project_path, "/repo");
        assert_eq!(context.source_path.as_deref(), Some("/tmp/source.json"));
        assert_eq!(context.agent_id, CanonicalAgentId::OpenCode);
        assert_eq!(
            context.compatibility,
            SessionDescriptorCompatibility::ReadOnly {
                missing_facts: vec![
                    crate::acp::session_descriptor::SessionDescriptorMissingFact::CanonicalAgentId,
                    crate::acp::session_descriptor::SessionDescriptorMissingFact::ProjectPath,
                ]
            }
        );
    }

    #[tokio::test]
    async fn resolve_session_context_prefers_provider_session_id_for_history_loading() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-app-id",
            "/repo",
            "claude-code",
            Some("/repo/.worktrees/feature-a"),
        )
        .await
        .expect("ensure exists");
        SessionMetadataRepository::set_provider_session_id(
            &db,
            "session-app-id",
            "session-provider-id",
        )
        .await
        .expect("set provider session id");

        let context = resolve_session_context(
            Some(&db),
            "session-app-id",
            "/fallback-repo",
            "claude-code",
            None,
        )
        .await;

        assert_eq!(context.local_session_id, "session-app-id");
        assert_eq!(context.history_session_id, "session-provider-id");
        assert_eq!(
            context.compatibility,
            SessionDescriptorCompatibility::Canonical
        );
    }

    #[tokio::test]
    async fn resolve_session_context_keeps_local_history_id_when_provider_alias_missing() {
        let db = setup_test_db().await;

        SessionMetadataRepository::ensure_exists(
            &db,
            "session-missing-provider-id",
            "/repo",
            "claude-code",
            None,
        )
        .await
        .expect("ensure exists");

        let context = resolve_session_context(
            Some(&db),
            "session-missing-provider-id",
            "/fallback-repo",
            "claude-code",
            None,
        )
        .await;

        assert_eq!(context.local_session_id, "session-missing-provider-id");
        assert_eq!(context.history_session_id, "session-missing-provider-id");
        assert_eq!(context.agent_id, CanonicalAgentId::ClaudeCode);
        assert_eq!(
            context.compatibility,
            SessionDescriptorCompatibility::ReadOnly {
                missing_facts: vec![
                    crate::acp::session_descriptor::SessionDescriptorMissingFact::ProviderSessionId,
                ],
            }
        );
    }
}
