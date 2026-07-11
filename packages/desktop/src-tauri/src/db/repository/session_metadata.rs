//! Session metadata repository, lifecycle, and creation-attempt types.
//! Extracted verbatim from the former db/repository.rs monolith.

use crate::db::entities::prelude::*;
use crate::{
    acp::session_descriptor::{
        resolve_existing_session_descriptor, resolve_existing_session_resume,
        ResolvedResumeSession, SessionCompatibilityInput, SessionDescriptor,
        SessionDescriptorFacts, SessionDescriptorResolutionError, SessionReplayContext,
    },
    db::entities::creation_attempt,
};
use anyhow::Result;
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseTransaction, DbConn,
    EntityTrait, JoinType, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, RelationTrait,
    Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::entities::{acepe_session_state, session_metadata};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum SessionLifecycleState {
    Created,
    Persisted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AcepeSessionRelationship {
    Discovered,
    Reserved,
    Opened,
    Created,
}

impl AcepeSessionRelationship {
    fn as_str(self) -> &'static str {
        match self {
            Self::Discovered => "discovered",
            Self::Reserved => "reserved",
            Self::Opened => "opened",
            Self::Created => "created",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "reserved" => Self::Reserved,
            "opened" => Self::Opened,
            "created" => Self::Created,
            _ => Self::Discovered,
        }
    }

    fn is_managed(self) -> bool {
        !matches!(self, Self::Discovered)
    }

    fn is_visible(self) -> bool {
        !matches!(self, Self::Reserved)
    }
}

/// Row returned from session metadata queries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionMetadataRow {
    pub id: String,
    pub display: String,
    pub title_overridden: bool,
    pub timestamp: i64,
    pub project_path: String,
    pub agent_id: String,
    pub file_path: String,
    pub file_mtime: i64,
    pub file_size: i64,
    pub worktree_path: Option<String>,
    pub pr_number: Option<i32>,
    pub pr_link_mode: Option<String>,
    pub is_acepe_managed: bool,
    pub sequence_id: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct ProjectSessionsLookup {
    pub db_row_count: usize,
    pub entries: Vec<SessionMetadataRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReservedWorktreeLaunchRow {
    pub launch_token: String,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub sequence_id: i32,
}

impl SessionMetadataRow {
    pub fn agent_id_enum(&self) -> Option<crate::acp::types::CanonicalAgentId> {
        if self.agent_id.is_empty() {
            None
        } else {
            Some(crate::acp::types::CanonicalAgentId::parse(&self.agent_id))
        }
    }

    pub fn history_session_id(&self) -> &str {
        &self.id
    }

    pub fn effective_project_path(&self) -> Option<&str> {
        self.worktree_path
            .as_deref()
            .or_else(|| (!self.project_path.is_empty()).then_some(self.project_path.as_str()))
    }

    pub fn descriptor_facts(&self) -> SessionDescriptorFacts {
        SessionDescriptorFacts {
            local_session_id: self.id.clone(),
            agent_id: self.agent_id_enum(),
            project_path: (!self.project_path.is_empty()).then_some(self.project_path.clone()),
            worktree_path: self.worktree_path.clone(),
            source_path: SessionMetadataRepository::normalized_source_path(&self.file_path),
        }
    }

    pub fn lifecycle_state(&self) -> SessionLifecycleState {
        if self.file_mtime == 0
            && self.file_size == 0
            && SessionMetadataRepository::normalized_source_path(&self.file_path).is_none()
        {
            SessionLifecycleState::Created
        } else {
            SessionLifecycleState::Persisted
        }
    }

    pub fn is_transcript_pending(&self) -> bool {
        self.lifecycle_state() == SessionLifecycleState::Created
    }
}

fn compose_session_metadata_row(
    model: session_metadata::Model,
    state: Option<&acepe_session_state::Model>,
) -> SessionMetadataRow {
    let title_overridden = state
        .and_then(|state| state.title_override.as_ref())
        .is_some();
    let display = state
        .and_then(|state| state.title_override.clone())
        .unwrap_or_else(|| model.display.clone());
    let worktree_path = state
        .and_then(|state| state.worktree_path.clone())
        .or(model.worktree_path.clone());
    let pr_number = state.and_then(|state| state.pr_number).or(model.pr_number);
    let pr_link_mode = state
        .and_then(|state| state.pr_link_mode.clone())
        .or_else(|| pr_number.map(|_| "automatic".to_string()));
    let sequence_id = state
        .and_then(|state| state.sequence_id)
        .or(model.sequence_id);
    let is_acepe_managed = state
        .map(|state| AcepeSessionRelationship::from_str(&state.relationship).is_managed())
        .unwrap_or(model.is_acepe_managed != 0);

    SessionMetadataRow {
        id: model.id,
        display,
        title_overridden,
        timestamp: model.timestamp,
        project_path: model.project_path,
        agent_id: model.agent_id,
        file_path: model.file_path,
        file_mtime: model.file_mtime,
        file_size: model.file_size,
        worktree_path,
        pr_number,
        pr_link_mode,
        is_acepe_managed,
        sequence_id,
    }
}

/// A batch record for session metadata upsert:
/// (session_id, display, timestamp, project_path, agent_id, file_path, file_mtime, file_size)
pub type SessionMetadataRecord = (String, String, i64, String, String, String, i64, i64);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreationAttemptRow {
    pub id: String,
    pub agent_id: String,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub launch_token: Option<String>,
    pub status: String,
    pub failure_reason: Option<String>,
    pub provider_session_id: Option<String>,
    pub sequence_id: Option<i32>,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CreationAttemptStatus {
    Pending,
    Failed,
    Consumed,
    Expired,
}

impl CreationAttemptStatus {
    pub const PENDING: &'static str = "pending";
    pub const FAILED: &'static str = "failed";
    pub const CONSUMED: &'static str = "consumed";
    pub const EXPIRED: &'static str = "expired";

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => Self::PENDING,
            Self::Failed => Self::FAILED,
            Self::Consumed => Self::CONSUMED,
            Self::Expired => Self::EXPIRED,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CreationAttemptRepositoryError {
    #[error(
        "creation attempt quota exceeded for project {project_path} and agent {agent_id} (cap {cap})"
    )]
    QuotaExceeded {
        project_path: String,
        agent_id: String,
        cap: u64,
    },
    #[error("creation attempt not found: {attempt_id}")]
    NotFound { attempt_id: String },
    #[error("creation attempt is not pending: {attempt_id}")]
    NotPending { attempt_id: String },
    #[error("{message}")]
    InvalidState { message: String },
    #[error(transparent)]
    Database(#[from] sea_orm::DbErr),
}

fn compose_creation_attempt_row(model: creation_attempt::Model) -> CreationAttemptRow {
    CreationAttemptRow {
        id: model.id,
        agent_id: model.agent_id,
        project_path: model.project_path,
        worktree_path: model.worktree_path,
        launch_token: model.launch_token,
        status: model.status,
        failure_reason: model.failure_reason,
        provider_session_id: model.provider_session_id,
        sequence_id: model.sequence_id,
        model_id: model.model_id,
        mode_id: model.mode_id,
        created_at: model.created_at,
        updated_at: model.updated_at,
    }
}

/// Repository for canonical session records plus transcript metadata.
///
/// A session always exists once created; transcript persistence is just a later
/// lifecycle step for that same session.
pub struct SessionMetadataRepository;

impl SessionMetadataRepository {
    pub const PENDING_CREATION_ATTEMPTS_PER_PROJECT_AGENT_CAP: u64 = 5;

    pub async fn create_creation_attempt(
        db: &DbConn,
        project_path: &str,
        agent_id: &str,
        worktree_path: Option<&str>,
        model_id: Option<&str>,
        mode_id: Option<&str>,
    ) -> std::result::Result<CreationAttemptRow, CreationAttemptRepositoryError> {
        for _attempt in 0..5 {
            let txn = db.begin().await?;
            let next_sequence_id = Self::next_sequence_id_for_project(&txn, project_path)
                .await
                .map_err(|error| CreationAttemptRepositoryError::InvalidState {
                    message: error.to_string(),
                })?;
            let inserted = Self::insert_creation_attempt_in_transaction(
                &txn,
                None,
                project_path,
                agent_id,
                worktree_path,
                None,
                Some(next_sequence_id),
                model_id,
                mode_id,
            )
            .await;

            match inserted {
                Ok(row) => {
                    txn.commit().await?;
                    return Ok(row);
                }
                Err(CreationAttemptRepositoryError::Database(error))
                    if Self::is_sequence_constraint_violation(&error) =>
                {
                    continue;
                }
                Err(error) => return Err(error),
            }
        }

        Err(CreationAttemptRepositoryError::InvalidState {
            message: "Failed to allocate a unique creation attempt sequence_id after retries"
                .to_string(),
        })
    }

    pub async fn persist_creation_attempt_initial_selection(
        db: &DbConn,
        attempt_id: &str,
        model_id: Option<&str>,
        mode_id: Option<&str>,
    ) -> std::result::Result<(), CreationAttemptRepositoryError> {
        if model_id.is_none() && mode_id.is_none() {
            return Ok(());
        }

        let attempt = CreationAttempt::find_by_id(attempt_id)
            .one(db)
            .await?
            .ok_or_else(|| CreationAttemptRepositoryError::NotFound {
                attempt_id: attempt_id.to_string(),
            })?;
        if attempt.status != CreationAttemptStatus::Pending.as_str() {
            return Err(CreationAttemptRepositoryError::NotPending {
                attempt_id: attempt_id.to_string(),
            });
        }

        let mut active: creation_attempt::ActiveModel = attempt.into();
        if let Some(model_id) = model_id {
            active.model_id = Set(Some(model_id.to_string()));
        }
        if let Some(mode_id) = mode_id {
            active.mode_id = Set(Some(mode_id.to_string()));
        }
        active.updated_at = Set(Utc::now());
        active.update(db).await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert_creation_attempt_in_transaction(
        txn: &DatabaseTransaction,
        attempt_id: Option<String>,
        project_path: &str,
        agent_id: &str,
        worktree_path: Option<&str>,
        launch_token: Option<String>,
        sequence_id: Option<i32>,
        model_id: Option<&str>,
        mode_id: Option<&str>,
    ) -> std::result::Result<CreationAttemptRow, CreationAttemptRepositoryError> {
        let pending_count = CreationAttempt::find()
            .filter(creation_attempt::Column::ProjectPath.eq(project_path))
            .filter(creation_attempt::Column::AgentId.eq(agent_id))
            .filter(creation_attempt::Column::Status.eq(CreationAttemptStatus::Pending.as_str()))
            .count(txn)
            .await?;

        if pending_count >= Self::PENDING_CREATION_ATTEMPTS_PER_PROJECT_AGENT_CAP {
            return Err(CreationAttemptRepositoryError::QuotaExceeded {
                project_path: project_path.to_string(),
                agent_id: agent_id.to_string(),
                cap: Self::PENDING_CREATION_ATTEMPTS_PER_PROJECT_AGENT_CAP,
            });
        }

        let now = Utc::now();
        let id = attempt_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let model = creation_attempt::ActiveModel {
            id: Set(id),
            agent_id: Set(agent_id.to_string()),
            project_path: Set(project_path.to_string()),
            worktree_path: Set(worktree_path.map(std::borrow::ToOwned::to_owned)),
            launch_token: Set(launch_token),
            status: Set(CreationAttemptStatus::Pending.as_str().to_string()),
            failure_reason: Set(None),
            provider_session_id: Set(None),
            sequence_id: Set(sequence_id),
            model_id: Set(model_id.map(str::to_string)),
            mode_id: Set(mode_id.map(str::to_string)),
            created_at: Set(now),
            updated_at: Set(now),
        };
        let inserted = model.insert(txn).await?;

        Ok(compose_creation_attempt_row(inserted))
    }

    pub async fn get_creation_attempt(
        db: &DbConn,
        attempt_id: &str,
    ) -> std::result::Result<Option<CreationAttemptRow>, CreationAttemptRepositoryError> {
        let model = CreationAttempt::find_by_id(attempt_id).one(db).await?;
        Ok(model.map(compose_creation_attempt_row))
    }

    pub async fn record_creation_attempt_requested_provider_session_id(
        db: &DbConn,
        attempt_id: &str,
        provider_session_id: &str,
    ) -> std::result::Result<(), CreationAttemptRepositoryError> {
        let now = Utc::now();
        let result = db
            .execute(Statement::from_sql_and_values(
                db.get_database_backend(),
                "UPDATE creation_attempts SET provider_session_id = ?, updated_at = ? WHERE id = ? AND status = ?",
                [
                    provider_session_id.into(),
                    now.into(),
                    attempt_id.into(),
                    CreationAttemptStatus::Pending.as_str().into(),
                ],
            ))
            .await?;
        if result.rows_affected() == 0 {
            return Err(CreationAttemptRepositoryError::NotPending {
                attempt_id: attempt_id.to_string(),
            });
        }
        Ok(())
    }

    pub async fn get_reserved_worktree_launch(
        db: &DbConn,
        launch_token: &str,
    ) -> Result<Option<ReservedWorktreeLaunchRow>> {
        let attempt = CreationAttempt::find_by_id(launch_token).one(db).await?;
        Ok(attempt
            .filter(|attempt| attempt.status == CreationAttemptStatus::Pending.as_str())
            .map(|attempt| ReservedWorktreeLaunchRow {
                launch_token: attempt.id,
                project_path: attempt.project_path,
                worktree_path: attempt.worktree_path,
                sequence_id: attempt.sequence_id.unwrap_or_default(),
            }))
    }

    pub async fn promote_creation_attempt(
        db: &DbConn,
        attempt_id: &str,
        provider_session_id: &str,
    ) -> std::result::Result<SessionMetadataRow, CreationAttemptRepositoryError> {
        if provider_session_id.is_empty() {
            return Err(CreationAttemptRepositoryError::InvalidState {
                message: "provider session id cannot be empty".to_string(),
            });
        }

        let txn = db.begin().await?;
        let attempt = CreationAttempt::find_by_id(attempt_id)
            .one(&txn)
            .await?
            .ok_or_else(|| CreationAttemptRepositoryError::NotFound {
                attempt_id: attempt_id.to_string(),
            })?;
        if attempt.status != CreationAttemptStatus::Pending.as_str() {
            return Err(CreationAttemptRepositoryError::NotPending {
                attempt_id: attempt_id.to_string(),
            });
        }

        let existing_metadata = SessionMetadata::find_by_id(provider_session_id)
            .one(&txn)
            .await?;
        let sequence_id = if let Some(existing_sequence_id) = existing_metadata
            .as_ref()
            .and_then(|model| model.sequence_id)
        {
            if Self::sequence_id_taken_by_other_session(
                &txn,
                &attempt.project_path,
                provider_session_id,
                existing_sequence_id,
            )
            .await
            .map_err(|error| CreationAttemptRepositoryError::InvalidState {
                message: error.to_string(),
            })? {
                Self::next_sequence_id_for_project(&txn, &attempt.project_path)
                    .await
                    .map_err(|error| CreationAttemptRepositoryError::InvalidState {
                        message: error.to_string(),
                    })?
            } else {
                existing_sequence_id
            }
        } else if let Some(sequence_id) = attempt.sequence_id {
            sequence_id
        } else {
            Self::next_sequence_id_for_project(&txn, &attempt.project_path)
                .await
                .map_err(|error| CreationAttemptRepositoryError::InvalidState {
                    message: error.to_string(),
                })?
        };
        let now = Utc::now();
        let preview_len = 8usize.min(provider_session_id.len());
        let created_file_path = Self::created_session_file_path(provider_session_id);
        let (metadata_model, state_model) = if let Some(existing_model) = existing_metadata {
            if existing_model.file_path != created_file_path {
                return Err(CreationAttemptRepositoryError::InvalidState {
                    message: format!(
                        "session {provider_session_id} already exists with source path {}",
                        existing_model.file_path
                    ),
                });
            }

            let mut metadata: session_metadata::ActiveModel = existing_model.into();
            metadata.display = Set(format!("Session {}", &provider_session_id[..preview_len]));
            metadata.timestamp = Set(now.timestamp_millis());
            metadata.project_path = Set(attempt.project_path.clone());
            metadata.agent_id = Set(attempt.agent_id.clone());
            metadata.file_path = Set(created_file_path);
            metadata.file_mtime = Set(0);
            metadata.file_size = Set(0);
            metadata.worktree_path = Set(attempt.worktree_path.clone());
            metadata.is_acepe_managed = Set(1);
            metadata.sequence_id = Set(Some(sequence_id));
            metadata.updated_at = Set(now);
            let updated_metadata = metadata.update(&txn).await?;

            let state_model = if let Some(existing_state) =
                AcepeSessionState::find_by_id(provider_session_id)
                    .one(&txn)
                    .await?
            {
                let mut state: acepe_session_state::ActiveModel = existing_state.into();
                state.relationship = Set(AcepeSessionRelationship::Created.as_str().to_string());
                state.project_path = Set(attempt.project_path.clone());
                state.worktree_path = Set(attempt.worktree_path.clone());
                state.sequence_id = Set(Some(sequence_id));
                state.updated_at = Set(now);
                state.update(&txn).await?
            } else {
                let state = acepe_session_state::ActiveModel {
                    session_id: Set(provider_session_id.to_string()),
                    relationship: Set(AcepeSessionRelationship::Created.as_str().to_string()),
                    project_path: Set(attempt.project_path.clone()),
                    title_override: Set(None),
                    worktree_path: Set(attempt.worktree_path.clone()),
                    pr_number: Set(None),
                    pr_link_mode: Set(None),
                    sequence_id: Set(Some(sequence_id)),
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                state.insert(&txn).await?
            };
            (updated_metadata, state_model)
        } else {
            let metadata = session_metadata::ActiveModel {
                id: Set(provider_session_id.to_string()),
                display: Set(format!("Session {}", &provider_session_id[..preview_len])),
                timestamp: Set(now.timestamp_millis()),
                project_path: Set(attempt.project_path.clone()),
                agent_id: Set(attempt.agent_id.clone()),
                file_path: Set(created_file_path),
                file_mtime: Set(0),
                file_size: Set(0),
                worktree_path: Set(attempt.worktree_path.clone()),
                pr_number: sea_orm::ActiveValue::NotSet,
                is_acepe_managed: Set(1),
                sequence_id: Set(Some(sequence_id)),
                created_at: Set(now),
                updated_at: Set(now),
            };
            let inserted_metadata = metadata.insert(&txn).await?;
            let state = acepe_session_state::ActiveModel {
                session_id: Set(provider_session_id.to_string()),
                relationship: Set(AcepeSessionRelationship::Created.as_str().to_string()),
                project_path: Set(attempt.project_path.clone()),
                title_override: Set(None),
                worktree_path: Set(attempt.worktree_path.clone()),
                pr_number: Set(None),
                pr_link_mode: Set(None),
                sequence_id: Set(Some(sequence_id)),
                created_at: Set(now),
                updated_at: Set(now),
            };
            let inserted_state = state.insert(&txn).await?;
            (inserted_metadata, inserted_state)
        };

        let mut attempt_active: creation_attempt::ActiveModel = attempt.into();
        attempt_active.status = Set(CreationAttemptStatus::Consumed.as_str().to_string());
        attempt_active.provider_session_id = Set(Some(provider_session_id.to_string()));
        attempt_active.updated_at = Set(now);
        attempt_active.update(&txn).await?;
        txn.commit().await?;

        Ok(compose_session_metadata_row(
            metadata_model,
            Some(&state_model),
        ))
    }

    pub async fn expire_stale_creation_attempts(
        db: &DbConn,
        older_than: chrono::DateTime<Utc>,
    ) -> std::result::Result<u64, CreationAttemptRepositoryError> {
        let now = Utc::now();
        let result = db
            .execute(Statement::from_sql_and_values(
                db.get_database_backend(),
                "UPDATE creation_attempts SET status = ?, updated_at = ? WHERE status = ? AND created_at < ?",
                [
                    CreationAttemptStatus::Expired.as_str().into(),
                    now.into(),
                    CreationAttemptStatus::Pending.as_str().into(),
                    older_than.into(),
                ],
            ))
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn fail_creation_attempt(
        db: &DbConn,
        attempt_id: &str,
        reason: &str,
    ) -> std::result::Result<(), CreationAttemptRepositoryError> {
        let now = Utc::now();
        let result = db
            .execute(Statement::from_sql_and_values(
                db.get_database_backend(),
                "UPDATE creation_attempts SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ? AND status = ?",
                [
                    CreationAttemptStatus::Failed.as_str().into(),
                    reason.into(),
                    now.into(),
                    attempt_id.into(),
                    CreationAttemptStatus::Pending.as_str().into(),
                ],
            ))
            .await?;
        if result.rows_affected() == 0 {
            return Err(CreationAttemptRepositoryError::NotPending {
                attempt_id: attempt_id.to_string(),
            });
        }
        Ok(())
    }

    pub fn resolve_existing_session_descriptor_from_metadata(
        session_id: &str,
        metadata: Option<&SessionMetadataRow>,
        compatibility: SessionCompatibilityInput,
    ) -> Result<SessionDescriptor, SessionDescriptorResolutionError> {
        let facts = metadata
            .map(SessionMetadataRow::descriptor_facts)
            .unwrap_or_else(|| SessionDescriptorFacts::for_session(session_id));
        resolve_existing_session_descriptor(facts, compatibility)
    }

    pub fn resolve_existing_session_resume_from_metadata(
        session_id: &str,
        metadata: Option<&SessionMetadataRow>,
        requested_cwd: &str,
        explicit_agent_override: Option<crate::acp::types::CanonicalAgentId>,
    ) -> Result<ResolvedResumeSession, SessionDescriptorResolutionError> {
        let facts = metadata
            .map(SessionMetadataRow::descriptor_facts)
            .unwrap_or_else(|| SessionDescriptorFacts::for_session(session_id));
        resolve_existing_session_resume(facts, requested_cwd, explicit_agent_override)
    }

    pub fn resolve_existing_session_replay_context_from_metadata(
        session_id: &str,
        metadata: Option<&SessionMetadataRow>,
        compatibility: SessionCompatibilityInput,
    ) -> Result<SessionReplayContext, SessionDescriptorResolutionError> {
        Self::resolve_existing_session_descriptor_from_metadata(session_id, metadata, compatibility)
            .map(SessionReplayContext::from)
    }

    fn dedupe_records_by_session_id(
        records: Vec<SessionMetadataRecord>,
    ) -> Vec<SessionMetadataRecord> {
        fn should_replace_record(
            current: &SessionMetadataRecord,
            candidate: &SessionMetadataRecord,
        ) -> bool {
            (candidate.6, candidate.7, candidate.2) > (current.6, current.7, current.2)
        }

        let original_count = records.len();
        let mut deduped: std::collections::HashMap<String, SessionMetadataRecord> =
            std::collections::HashMap::with_capacity(original_count);

        for record in records {
            let session_id = record.0.clone();
            match deduped.get(&session_id) {
                Some(existing) if !should_replace_record(existing, &record) => {}
                _ => {
                    deduped.insert(session_id, record);
                }
            }
        }

        if deduped.len() < original_count {
            tracing::debug!(
                original_count,
                deduped_count = deduped.len(),
                "Deduplicated session metadata batch by session ID"
            );
        }

        deduped.into_values().collect()
    }

    fn created_session_file_path(session_id: &str) -> String {
        format!("__session_registry__/{session_id}")
    }

    fn acepe_placeholder_display(session_id: &str) -> String {
        let preview_len = 8usize.min(session_id.len());
        format!("Session {}", &session_id[..preview_len])
    }

    pub(crate) fn is_acepe_placeholder_display(session_id: &str, display: &str) -> bool {
        display == Self::acepe_placeholder_display(session_id)
    }

    fn should_refresh_placeholder_title_for_unchanged_metadata(
        session_id: &str,
        existing_display: &str,
        title_overridden: bool,
        incoming_display: &str,
        incoming_agent_id: &str,
    ) -> bool {
        incoming_agent_id == "copilot"
            && !title_overridden
            && Self::is_acepe_placeholder_display(session_id, existing_display)
            && !incoming_display.trim().is_empty()
            && incoming_display != existing_display
    }

    fn is_acepe_managed_file_path(file_path: &str) -> bool {
        let is_registry = file_path.starts_with("__session_registry__/")
            && !file_path["__session_registry__/".len()..].contains('/');
        let is_worktree = file_path.starts_with("__worktree__/");
        is_registry || is_worktree
    }

    /// Detects whether a DB error is a unique constraint violation on the
    /// (project_path, sequence_id) pair. Uses string matching because sea_orm
    /// wraps SQLite errors without exposing raw error codes. We check both
    /// the index name and the column-level constraint message for resilience.
    fn is_sequence_constraint_violation(error: &sea_orm::DbErr) -> bool {
        let message = error.to_string();
        message.contains("idx_session_metadata_project_sequence_managed")
            || message.contains("idx_acepe_session_state_project_sequence")
            || message.contains("idx_creation_attempts_project_sequence")
            || message.contains("UNIQUE constraint failed") && message.contains("sequence_id")
    }

    fn merged_acepe_managed_flag(existing_managed: i32, file_path: &str) -> i32 {
        if existing_managed != 0 || Self::is_acepe_managed_file_path(file_path) {
            1
        } else {
            0
        }
    }

    async fn next_sequence_id_for_project(
        db: &impl sea_orm::ConnectionTrait,
        project_path: &str,
    ) -> Result<i32> {
        let max_state_seq: Option<i32> = AcepeSessionState::find()
            .select_only()
            .column_as(acepe_session_state::Column::SequenceId.max(), "max_seq")
            .filter(acepe_session_state::Column::ProjectPath.eq(project_path))
            .filter(acepe_session_state::Column::SequenceId.is_not_null())
            .into_tuple::<Option<i32>>()
            .one(db)
            .await?
            .flatten();

        let max_metadata_seq: Option<i32> = SessionMetadata::find()
            .select_only()
            .column_as(session_metadata::Column::SequenceId.max(), "max_seq")
            .filter(session_metadata::Column::ProjectPath.eq(project_path))
            .filter(session_metadata::Column::SequenceId.is_not_null())
            .into_tuple::<Option<i32>>()
            .one(db)
            .await?
            .flatten();

        let max_attempt_seq: Option<i32> = CreationAttempt::find()
            .select_only()
            .column_as(creation_attempt::Column::SequenceId.max(), "max_seq")
            .filter(creation_attempt::Column::ProjectPath.eq(project_path))
            .filter(creation_attempt::Column::SequenceId.is_not_null())
            .into_tuple::<Option<i32>>()
            .one(db)
            .await?
            .flatten();

        let max_seq = [max_state_seq, max_metadata_seq, max_attempt_seq]
            .into_iter()
            .flatten()
            .max();

        Ok(max_seq.map_or(1, |max| max + 1))
    }

    async fn sequence_id_taken_by_other_session(
        db: &impl sea_orm::ConnectionTrait,
        project_path: &str,
        session_id: &str,
        sequence_id: i32,
    ) -> Result<bool> {
        let state_conflict = AcepeSessionState::find()
            .filter(
                Condition::all()
                    .add(acepe_session_state::Column::ProjectPath.eq(project_path))
                    .add(acepe_session_state::Column::SequenceId.eq(sequence_id))
                    .add(acepe_session_state::Column::SessionId.ne(session_id)),
            )
            .one(db)
            .await?;

        if state_conflict.is_some() {
            return Ok(true);
        }

        let metadata_conflict = SessionMetadata::find()
            .filter(
                Condition::all()
                    .add(session_metadata::Column::ProjectPath.eq(project_path))
                    .add(session_metadata::Column::SequenceId.eq(sequence_id))
                    .add(session_metadata::Column::Id.ne(session_id)),
            )
            .one(db)
            .await?;

        Ok(metadata_conflict.is_some())
    }

    fn is_non_persisted_session_file_path(file_path: &str) -> bool {
        file_path.starts_with("__session_registry__/") || file_path.starts_with("__worktree__/")
    }

    fn is_explicit_missing_transcript_marker(file_path: &str) -> bool {
        file_path.starts_with("__session_registry__/copilot_missing/")
    }

    fn git_main_repo_from_worktree_path(
        worktree_path: &std::path::Path,
    ) -> Option<std::path::PathBuf> {
        let git_file_path = worktree_path.join(".git");
        let git_file_content = std::fs::read_to_string(&git_file_path).ok()?;
        let git_dir_path = git_file_content.strip_prefix("gitdir: ")?.trim();
        let git_dir = std::path::Path::new(git_dir_path);
        let resolved_git_dir = if git_dir.is_absolute() {
            git_dir.to_path_buf()
        } else {
            worktree_path.join(git_dir)
        };

        resolved_git_dir
            .parent()
            .and_then(|path| path.parent())
            .and_then(|path| path.parent())
            .map(std::path::Path::to_path_buf)
    }

    fn base_project_path_from_worktree_path(worktree_path: &str) -> Option<String> {
        let canonical_worktree_path = std::path::Path::new(worktree_path)
            .canonicalize()
            .ok()
            .filter(|path| path.is_dir())?;

        Self::git_main_repo_from_worktree_path(&canonical_worktree_path)
            .map(|path| path.to_string_lossy().into_owned())
    }

    fn project_path_for_update(
        existing_model: &session_metadata::Model,
        incoming_project_path: String,
    ) -> String {
        if let Some(worktree_path) = existing_model.worktree_path.as_deref() {
            let resolved_base_project_path =
                Self::base_project_path_from_worktree_path(worktree_path);

            if let Some(base_project_path) = resolved_base_project_path {
                if incoming_project_path == base_project_path {
                    return incoming_project_path;
                }

                if existing_model.project_path == base_project_path {
                    return existing_model.project_path.clone();
                }
            }

            if existing_model.project_path == worktree_path {
                return incoming_project_path;
            }

            existing_model.project_path.clone()
        } else {
            incoming_project_path
        }
    }

    pub(crate) fn normalized_source_path(file_path: &str) -> Option<String> {
        if file_path.is_empty() || Self::is_non_persisted_session_file_path(file_path) {
            None
        } else {
            Some(file_path.to_string())
        }
    }

    fn should_preserve_existing_source_path(
        existing_model: &session_metadata::Model,
        incoming_file_path: &str,
        incoming_file_mtime: i64,
        incoming_file_size: i64,
    ) -> bool {
        Self::normalized_source_path(&existing_model.file_path).is_some()
            && Self::is_non_persisted_session_file_path(incoming_file_path)
            && !Self::is_explicit_missing_transcript_marker(incoming_file_path)
            && incoming_file_mtime == 0
            && incoming_file_size == 0
    }

    fn resolved_file_metadata_for_update(
        existing_model: &session_metadata::Model,
        incoming_file_path: String,
        incoming_file_mtime: i64,
        incoming_file_size: i64,
    ) -> (String, i64, i64) {
        if Self::should_preserve_existing_source_path(
            existing_model,
            &incoming_file_path,
            incoming_file_mtime,
            incoming_file_size,
        ) {
            (
                existing_model.file_path.clone(),
                existing_model.file_mtime,
                existing_model.file_size,
            )
        } else {
            (incoming_file_path, incoming_file_mtime, incoming_file_size)
        }
    }

    async fn load_state_map(
        db: &impl sea_orm::ConnectionTrait,
        session_ids: &[String],
    ) -> Result<std::collections::HashMap<String, acepe_session_state::Model>> {
        if session_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }

        let rows = AcepeSessionState::find()
            .filter(acepe_session_state::Column::SessionId.is_in(session_ids.to_vec()))
            .all(db)
            .await?;

        Ok(rows
            .into_iter()
            .map(|row| (row.session_id.clone(), row))
            .collect())
    }

    /// Insert a new Acepe-tracked session and assign the next per-project sequence ID.
    /// Returns the assigned sequence_id.
    async fn insert_acepe_tracked_session(
        db: &DbConn,
        session_id: &str,
        project_path: &str,
        agent_id: &str,
        worktree_path: Option<&str>,
        relationship: AcepeSessionRelationship,
    ) -> Result<i32> {
        for _attempt in 0..5 {
            let txn = db.begin().await?;
            let now = Utc::now();
            let display = Self::acepe_placeholder_display(session_id);

            let next_sequence_id = Self::next_sequence_id_for_project(&txn, project_path).await?;

            let model = session_metadata::ActiveModel {
                id: Set(session_id.to_string()),
                display: Set(display),
                timestamp: Set(now.timestamp_millis()),
                project_path: Set(project_path.to_string()),
                agent_id: Set(agent_id.to_string()),
                file_path: Set(Self::created_session_file_path(session_id)),
                file_mtime: Set(0),
                file_size: Set(0),
                worktree_path: Set(worktree_path.map(|path| path.to_string())),
                pr_number: sea_orm::ActiveValue::NotSet,
                is_acepe_managed: Set(1),
                sequence_id: Set(Some(next_sequence_id)),
                created_at: Set(now),
                updated_at: Set(now),
            };

            match SessionMetadata::insert(model).exec(&txn).await {
                Ok(_) => {
                    let state = acepe_session_state::ActiveModel {
                        session_id: Set(session_id.to_string()),
                        relationship: Set(relationship.as_str().to_string()),
                        project_path: Set(project_path.to_string()),
                        title_override: Set(None),
                        worktree_path: Set(worktree_path.map(|path| path.to_string())),
                        pr_number: Set(None),
                        pr_link_mode: Set(None),
                        sequence_id: Set(Some(next_sequence_id)),
                        created_at: Set(now),
                        updated_at: Set(now),
                    };
                    state.insert(&txn).await?;
                    txn.commit().await?;
                    tracing::info!(
                        session_id = %session_id,
                        project_path = %project_path,
                        agent_id = %agent_id,
                        worktree_path = ?worktree_path,
                        sequence_id = next_sequence_id,
                        relationship = relationship.as_str(),
                        "Session metadata inserted for Acepe-tracked session without persisted transcript"
                    );
                    return Ok(next_sequence_id);
                }
                Err(error) => {
                    if Self::is_sequence_constraint_violation(&error) {
                        continue;
                    }
                    return Err(error.into());
                }
            }
        }

        anyhow::bail!("Failed to allocate a unique sequence_id after retries");
    }

    pub async fn reserve_worktree_launch(
        db: &DbConn,
        project_path: &str,
        agent_id: &str,
    ) -> Result<ReservedWorktreeLaunchRow> {
        for _attempt in 0..5 {
            let txn = db.begin().await?;
            let launch_token = Uuid::new_v4().to_string();
            let next_sequence_id = Self::next_sequence_id_for_project(&txn, project_path).await?;
            let inserted = Self::insert_creation_attempt_in_transaction(
                &txn,
                Some(launch_token.clone()),
                project_path,
                agent_id,
                None,
                Some(launch_token.clone()),
                Some(next_sequence_id),
                None,
                None,
            )
            .await;

            match inserted {
                Ok(_) => {
                    txn.commit().await?;
                    return Ok(ReservedWorktreeLaunchRow {
                        launch_token,
                        project_path: project_path.to_string(),
                        worktree_path: None,
                        sequence_id: next_sequence_id,
                    });
                }
                Err(CreationAttemptRepositoryError::Database(error))
                    if Self::is_sequence_constraint_violation(&error) =>
                {
                    continue;
                }
                Err(error) => return Err(error.into()),
            }
        }

        anyhow::bail!("Failed to reserve a unique creation attempt sequence_id after retries");
    }

    pub async fn attach_reserved_worktree_launch(
        db: &DbConn,
        launch_token: &str,
        worktree_path: &str,
    ) -> Result<ReservedWorktreeLaunchRow> {
        let attempt = CreationAttempt::find_by_id(launch_token)
            .one(db)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Prepared worktree launch not found"))?;
        if attempt.status != CreationAttemptStatus::Pending.as_str() {
            anyhow::bail!("Prepared worktree launch has already been consumed");
        }

        let project_path = attempt.project_path.clone();
        let sequence_id = attempt.sequence_id.unwrap_or_default();
        let mut active: creation_attempt::ActiveModel = attempt.into();
        active.worktree_path = Set(Some(worktree_path.to_string()));
        active.updated_at = Set(Utc::now());
        active.update(db).await?;

        Ok(ReservedWorktreeLaunchRow {
            launch_token: launch_token.to_string(),
            project_path,
            worktree_path: Some(worktree_path.to_string()),
            sequence_id,
        })
    }

    pub async fn discard_reserved_worktree_launch(db: &DbConn, launch_token: &str) -> Result<()> {
        if let Some(attempt) = CreationAttempt::find_by_id(launch_token).one(db).await? {
            if attempt.status == CreationAttemptStatus::Pending.as_str() {
                CreationAttempt::delete_by_id(launch_token).exec(db).await?;
            }
        }
        Ok(())
    }

    pub async fn consume_reserved_worktree_launch(
        db: &DbConn,
        launch_token: &str,
        session_id: &str,
        agent_id: &str,
    ) -> Result<Option<i32>> {
        let attempt = CreationAttempt::find_by_id(launch_token)
            .one(db)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Prepared worktree launch not found"))?;
        if attempt.status != CreationAttemptStatus::Pending.as_str() {
            anyhow::bail!("Prepared worktree launch has already been consumed");
        }
        if attempt.agent_id != agent_id {
            anyhow::bail!("Prepared worktree launch belongs to a different agent");
        }

        let row = Self::promote_creation_attempt(db, launch_token, session_id).await?;
        Ok(row.sequence_id)
    }

    async fn mark_session_as_acepe_tracked(
        db: &DbConn,
        existing_model: session_metadata::Model,
    ) -> Result<Option<i32>> {
        let existing_state = AcepeSessionState::find_by_id(&existing_model.id)
            .one(db)
            .await?;
        if let Some(state) = existing_state.as_ref() {
            let relationship = AcepeSessionRelationship::from_str(&state.relationship);
            if relationship.is_managed() && state.sequence_id.is_some() {
                return Ok(state.sequence_id);
            }
        }

        for _attempt in 0..5 {
            let txn = db.begin().await?;
            let latest_model = SessionMetadata::find_by_id(&existing_model.id)
                .one(&txn)
                .await?
                .ok_or_else(|| anyhow::anyhow!("Session metadata disappeared during promotion"))?;

            let latest_state = AcepeSessionState::find_by_id(&existing_model.id)
                .one(&txn)
                .await?;
            if let Some(state) = latest_state.as_ref() {
                let relationship = AcepeSessionRelationship::from_str(&state.relationship);
                if relationship.is_managed() && state.sequence_id.is_some() {
                    txn.rollback().await?;
                    return Ok(state.sequence_id);
                }
            }

            let assigned_sequence_id = if let Some(existing_sequence_id) = latest_model.sequence_id
            {
                if Self::sequence_id_taken_by_other_session(
                    &txn,
                    &latest_model.project_path,
                    &latest_model.id,
                    existing_sequence_id,
                )
                .await?
                {
                    Self::next_sequence_id_for_project(&txn, &latest_model.project_path).await?
                } else {
                    existing_sequence_id
                }
            } else {
                Self::next_sequence_id_for_project(&txn, &latest_model.project_path).await?
            };
            let mut active: session_metadata::ActiveModel = latest_model.into();
            active.is_acepe_managed = Set(1);
            active.sequence_id = Set(Some(assigned_sequence_id));
            active.updated_at = Set(Utc::now());
            let state_project_path = active.project_path.as_ref().clone();
            let state_worktree_path = active.worktree_path.as_ref().clone();
            let state_pr_number = active.pr_number.as_ref().to_owned();

            match active.update(&txn).await {
                Ok(_) => {
                    let now = Utc::now();
                    if let Some(state) = latest_state {
                        let mut state_active: acepe_session_state::ActiveModel = state.into();
                        state_active.relationship =
                            Set(AcepeSessionRelationship::Opened.as_str().to_string());
                        state_active.project_path = Set(state_project_path.clone());
                        state_active.worktree_path = Set(state_worktree_path.clone());
                        state_active.sequence_id = Set(Some(assigned_sequence_id));
                        state_active.updated_at = Set(now);
                        if let Err(error) = state_active.update(&txn).await {
                            if Self::is_sequence_constraint_violation(&error) {
                                txn.rollback().await?;
                                continue;
                            }
                            return Err(error.into());
                        }
                    } else {
                        let state = acepe_session_state::ActiveModel {
                            session_id: Set(existing_model.id.clone()),
                            relationship: Set(AcepeSessionRelationship::Opened
                                .as_str()
                                .to_string()),
                            project_path: Set(state_project_path),
                            title_override: Set(None),
                            worktree_path: Set(state_worktree_path),
                            pr_number: Set(state_pr_number),
                            pr_link_mode: Set(None),
                            sequence_id: Set(Some(assigned_sequence_id)),
                            created_at: Set(now),
                            updated_at: Set(now),
                        };
                        if let Err(error) = state.insert(&txn).await {
                            if Self::is_sequence_constraint_violation(&error) {
                                txn.rollback().await?;
                                continue;
                            }
                            return Err(error.into());
                        }
                    }
                    txn.commit().await?;
                    return Ok(Some(assigned_sequence_id));
                }
                Err(error) => {
                    if Self::is_sequence_constraint_violation(&error) {
                        continue;
                    }
                    return Err(error.into());
                }
            }
        }

        anyhow::bail!("Failed to allocate a unique sequence_id after retries")
    }

    pub async fn mark_as_acepe_managed(db: &DbConn, session_id: &str) -> Result<Option<i32>> {
        let model = SessionMetadata::find_by_id(session_id).one(db).await?;
        let Some(existing_model) = model else {
            return Ok(None);
        };

        Self::mark_session_as_acepe_tracked(db, existing_model).await
    }

    /// Get all sessions for given project paths, ordered by timestamp DESC.
    pub async fn get_for_projects(
        db: &DbConn,
        project_paths: &[String],
        external_hidden_paths: &std::collections::HashSet<String>,
    ) -> Result<ProjectSessionsLookup> {
        if project_paths.is_empty() {
            return Ok(ProjectSessionsLookup {
                db_row_count: 0,
                entries: Vec::new(),
            });
        }

        tracing::debug!(
            project_count = project_paths.len(),
            "Loading session metadata for projects"
        );

        let models = SessionMetadata::find()
            .filter(session_metadata::Column::ProjectPath.is_in(project_paths.to_vec()))
            .order_by_desc(session_metadata::Column::Timestamp)
            .all(db)
            .await?;

        let db_row_count = models.len();
        tracing::debug!(count = db_row_count, "Loaded session metadata");

        let session_ids: Vec<String> = models.iter().map(|model| model.id.clone()).collect();
        let state_map = Self::load_state_map(db, &session_ids).await?;

        let entries = models
            .into_iter()
            .filter(|model| {
                let hidden_external_session = external_hidden_paths.contains(&model.project_path)
                    && model.is_acepe_managed == 0;
                if hidden_external_session {
                    return false;
                }

                state_map
                    .get(&model.id)
                    .map(|state| {
                        AcepeSessionRelationship::from_str(&state.relationship).is_visible()
                    })
                    .unwrap_or(true)
            })
            .map(|model| compose_session_metadata_row(model.clone(), state_map.get(&model.id)))
            .collect();

        Ok(ProjectSessionsLookup {
            db_row_count,
            entries,
        })
    }

    /// Bounded first-display lookup. Reads at most 50 projects, 100 rows per
    /// project, and 500 rows overall so IPC work cannot scale with full history.
    pub async fn get_recent_for_projects_bounded(
        db: &DbConn,
        project_paths: &[String],
        external_hidden_paths: &std::collections::HashSet<String>,
    ) -> Result<ProjectSessionsLookup> {
        const MAX_PROJECTS: usize = 50;
        const MAX_PER_PROJECT: u64 = 100;
        const MAX_TOTAL: usize = 500;

        let mut models = Vec::new();
        let bounded_project_count = project_paths.len().min(MAX_PROJECTS).max(1);
        let fair_project_limit = (MAX_TOTAL / bounded_project_count).max(1);
        let fair_remainder = MAX_TOTAL % bounded_project_count;
        for (project_index, project_path) in project_paths.iter().take(MAX_PROJECTS).enumerate() {
            if models.len() >= MAX_TOTAL {
                break;
            }
            let remaining = MAX_TOTAL.saturating_sub(models.len()) as u64;
            let fair_limit = fair_project_limit + usize::from(project_index < fair_remainder);
            let project_limit = MAX_PER_PROJECT.min(remaining).min(fair_limit as u64);
            let mut query = SessionMetadata::find()
                .join_rev(
                    JoinType::LeftJoin,
                    acepe_session_state::Relation::Session.def(),
                )
                .filter(session_metadata::Column::ProjectPath.eq(project_path.clone()))
                .filter(
                    Condition::any()
                        .add(acepe_session_state::Column::SessionId.is_null())
                        .add(acepe_session_state::Column::Relationship.ne("reserved")),
                )
                .order_by_desc(session_metadata::Column::Timestamp);
            if external_hidden_paths.contains(project_path) {
                query = query.filter(session_metadata::Column::IsAcepeManaged.eq(1));
            }
            let project_models = query.limit(project_limit).all(db).await?;
            for model in project_models {
                models.push(model);
            }
        }

        let db_row_count = models.len();
        let session_ids = models
            .iter()
            .map(|model| model.id.clone())
            .collect::<Vec<_>>();
        let state_map = Self::load_state_map(db, &session_ids).await?;
        let entries = models
            .into_iter()
            .filter(|model| {
                let hidden_external_session = external_hidden_paths.contains(&model.project_path)
                    && model.is_acepe_managed == 0;
                !hidden_external_session
                    && state_map
                        .get(&model.id)
                        .map(|state| {
                            AcepeSessionRelationship::from_str(&state.relationship).is_visible()
                        })
                        .unwrap_or(true)
            })
            .map(|model| compose_session_metadata_row(model.clone(), state_map.get(&model.id)))
            .collect();

        Ok(ProjectSessionsLookup {
            db_row_count,
            entries,
        })
    }

    /// Get startup sessions for specific session IDs.
    ///
    /// Matches only canonical app session IDs. Completed sessions are keyed by provider-owned
    /// canonical IDs before they reach this table.
    pub async fn get_for_session_ids(
        db: &DbConn,
        session_ids: &[String],
    ) -> Result<Vec<SessionMetadataRow>> {
        if session_ids.is_empty() {
            return Ok(Vec::new());
        }

        tracing::debug!(
            session_count = session_ids.len(),
            "Loading session metadata for startup sessions"
        );

        let models = SessionMetadata::find()
            .filter(session_metadata::Column::Id.is_in(session_ids.to_vec()))
            .all(db)
            .await?;

        let count = models.len();
        tracing::debug!(count = count, "Loaded startup session metadata");

        let canonical_ids: Vec<String> = models.iter().map(|model| model.id.clone()).collect();
        let state_map = Self::load_state_map(db, &canonical_ids).await?;

        Ok(models
            .into_iter()
            .filter(|model| {
                state_map
                    .get(&model.id)
                    .map(|state| {
                        AcepeSessionRelationship::from_str(&state.relationship).is_visible()
                    })
                    .unwrap_or(true)
            })
            .map(|model| compose_session_metadata_row(model.clone(), state_map.get(&model.id)))
            .collect())
    }

    /// Get a bounded set of recent sessions that have a persisted transcript source.
    ///
    /// This is used by idle performance work. It must stay bounded so startup never
    /// turns into an unbounded history scan.
    pub async fn get_recent_persisted_sessions(
        db: &DbConn,
        limit: u64,
    ) -> Result<Vec<SessionMetadataRow>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let models = SessionMetadata::find()
            .filter(session_metadata::Column::FileMtime.gt(0))
            .filter(session_metadata::Column::FileSize.gt(0))
            .order_by_desc(session_metadata::Column::Timestamp)
            .limit(limit)
            .all(db)
            .await?;

        let session_ids: Vec<String> = models.iter().map(|model| model.id.clone()).collect();
        let state_map = Self::load_state_map(db, &session_ids).await?;

        Ok(models
            .into_iter()
            .filter(|model| {
                state_map
                    .get(&model.id)
                    .map(|state| {
                        AcepeSessionRelationship::from_str(&state.relationship).is_visible()
                    })
                    .unwrap_or(true)
            })
            .map(|model| compose_session_metadata_row(model.clone(), state_map.get(&model.id)))
            .collect())
    }

    /// Get all sessions ordered by timestamp DESC.
    pub async fn get_all(db: &DbConn) -> Result<Vec<SessionMetadataRow>> {
        tracing::debug!("Loading all session metadata");

        let models = SessionMetadata::find()
            .order_by_desc(session_metadata::Column::Timestamp)
            .all(db)
            .await?;

        let count = models.len();
        tracing::debug!(count = count, "Loaded all session metadata");

        let session_ids: Vec<String> = models.iter().map(|model| model.id.clone()).collect();
        let state_map = Self::load_state_map(db, &session_ids).await?;

        Ok(models
            .into_iter()
            .filter(|model| {
                state_map
                    .get(&model.id)
                    .map(|state| {
                        AcepeSessionRelationship::from_str(&state.relationship).is_visible()
                    })
                    .unwrap_or(true)
            })
            .map(|model| compose_session_metadata_row(model.clone(), state_map.get(&model.id)))
            .collect())
    }

    /// Get session by session_id.
    pub async fn get_by_id(db: &DbConn, session_id: &str) -> Result<Option<SessionMetadataRow>> {
        tracing::debug!(session_id = %session_id, "Loading session metadata by ID");

        let model = SessionMetadata::find_by_id(session_id).one(db).await?;

        let Some(model) = model else {
            return Ok(None);
        };
        let state = AcepeSessionState::find_by_id(session_id).one(db).await?;
        Ok(Some(compose_session_metadata_row(model, state.as_ref())))
    }

    /// Upsert a session metadata record.
    /// Returns true if inserted/updated, false if unchanged.
    #[allow(clippy::too_many_arguments)]
    pub async fn upsert(
        db: &DbConn,
        session_id: String,
        display: String,
        timestamp: i64,
        project_path: String,
        agent_id: String,
        file_path: String,
        file_mtime: i64,
        file_size: i64,
    ) -> Result<bool> {
        let now = Utc::now();

        let existing = SessionMetadata::find()
            .filter(session_metadata::Column::Id.eq(&session_id))
            .one(db)
            .await?;

        if let Some(existing_model) = existing {
            let existing_state = AcepeSessionState::find_by_id(&existing_model.id)
                .one(db)
                .await?;
            let title_overridden = existing_state
                .as_ref()
                .and_then(|state| state.title_override.as_ref())
                .is_some();
            let project_path = Self::project_path_for_update(&existing_model, project_path);
            let (file_path, file_mtime, file_size) = Self::resolved_file_metadata_for_update(
                &existing_model,
                file_path,
                file_mtime,
                file_size,
            );
            let existing_is_acepe_managed = existing_model.is_acepe_managed;
            let next_is_acepe_managed =
                Self::merged_acepe_managed_flag(existing_is_acepe_managed, &file_path);
            let should_refresh_display =
                Self::should_refresh_placeholder_title_for_unchanged_metadata(
                    &existing_model.id,
                    &existing_model.display,
                    title_overridden,
                    &display,
                    &agent_id,
                );
            // Check if file has changed (mtime + size comparison)
            if existing_model.file_mtime == file_mtime
                && existing_model.file_size == file_size
                && existing_model.project_path == project_path
                && existing_model.file_path == file_path
                && !should_refresh_display
            {
                return Ok(false); // No change
            }

            // Update existing record
            let mut active: session_metadata::ActiveModel = existing_model.into();
            active.display = Set(display);
            active.timestamp = Set(timestamp);
            active.project_path = Set(project_path);
            active.agent_id = Set(agent_id);
            active.file_path = Set(file_path);
            active.file_mtime = Set(file_mtime);
            active.file_size = Set(file_size);
            active.is_acepe_managed = Set(next_is_acepe_managed);
            active.updated_at = Set(now);
            let state_project_path = active.project_path.as_ref().clone();
            active.update(db).await?;
            if let Some(existing_state) = existing_state {
                let mut state_active: acepe_session_state::ActiveModel = existing_state.into();
                state_active.project_path = Set(state_project_path);
                state_active.updated_at = Set(now);
                state_active.update(db).await?;
            }
        } else {
            let is_acepe_managed = if Self::is_acepe_managed_file_path(&file_path) {
                1
            } else {
                0
            };

            let model = session_metadata::ActiveModel {
                id: Set(session_id.clone()),
                display: Set(display),
                timestamp: Set(timestamp),
                project_path: Set(project_path),
                agent_id: Set(agent_id),
                file_path: Set(file_path),
                file_mtime: Set(file_mtime),
                file_size: Set(file_size),
                worktree_path: sea_orm::ActiveValue::NotSet,
                pr_number: sea_orm::ActiveValue::NotSet,
                is_acepe_managed: Set(is_acepe_managed),
                sequence_id: sea_orm::ActiveValue::NotSet,
                created_at: Set(now),
                updated_at: Set(now),
            };
            SessionMetadata::insert(model).exec(db).await?;

            tracing::debug!(session_id = %session_id, "Session metadata inserted");
        }

        Ok(true)
    }

    /// Batch upsert multiple session metadata records in a transaction.
    /// Returns the count of records that were actually inserted/updated.
    pub async fn batch_upsert(db: &DbConn, records: Vec<SessionMetadataRecord>) -> Result<usize> {
        if records.is_empty() {
            return Ok(0);
        }

        let records = Self::dedupe_records_by_session_id(records);

        let count = records.len();
        tracing::debug!(count = count, "Batch upserting session metadata");

        let mut updated_count = 0usize;

        // Use a transaction for atomicity
        let txn = db.begin().await?;

        let now = Utc::now();

        // Collect all session IDs for bulk lookup
        let session_ids: Vec<&str> = records.iter().map(|(id, ..)| id.as_str()).collect();

        // Single bulk SELECT to get all existing records at once (O(n) instead of N queries)
        let existing_records: Vec<session_metadata::Model> = SessionMetadata::find()
            .filter(session_metadata::Column::Id.is_in(session_ids.clone()))
            .all(&txn)
            .await?;
        let existing_ids = existing_records
            .iter()
            .map(|model| model.id.clone())
            .collect::<Vec<_>>();
        let state_map = Self::load_state_map(&txn, &existing_ids).await?;

        // Build a HashMap for O(1) lookup during iteration
        let mut existing_map: std::collections::HashMap<String, session_metadata::Model> =
            std::collections::HashMap::new();
        for model in existing_records {
            existing_map.insert(model.id.clone(), model);
        }

        // Now iterate through records, using the HashMap for existence check
        for (
            session_id,
            display,
            timestamp,
            project_path,
            agent_id,
            file_path,
            file_mtime,
            file_size,
        ) in records
        {
            if let Some(existing_model) = existing_map.get(&session_id) {
                let project_path = Self::project_path_for_update(existing_model, project_path);
                let (file_path, file_mtime, file_size) = Self::resolved_file_metadata_for_update(
                    existing_model,
                    file_path,
                    file_mtime,
                    file_size,
                );
                let next_is_acepe_managed =
                    Self::merged_acepe_managed_flag(existing_model.is_acepe_managed, &file_path);
                let title_overridden = state_map
                    .get(&existing_model.id)
                    .and_then(|state| state.title_override.as_ref())
                    .is_some();
                let should_refresh_display =
                    Self::should_refresh_placeholder_title_for_unchanged_metadata(
                        &existing_model.id,
                        &existing_model.display,
                        title_overridden,
                        &display,
                        &agent_id,
                    );
                // Check if file has changed (skip if mtime+size match).
                // Non-Claude agents use mtime=0/size=0 sentinel — always refresh those.
                if file_mtime != 0
                    && existing_model.file_mtime == file_mtime
                    && existing_model.file_size == file_size
                    && existing_model.project_path == project_path
                    && !should_refresh_display
                {
                    continue; // No change
                }

                // Update existing
                let mut active: session_metadata::ActiveModel = existing_model.clone().into();
                active.display = Set(display);
                active.timestamp = Set(timestamp);
                active.project_path = Set(project_path);
                active.agent_id = Set(agent_id);
                active.file_path = Set(file_path);
                active.file_mtime = Set(file_mtime);
                active.file_size = Set(file_size);
                active.is_acepe_managed = Set(next_is_acepe_managed);
                active.updated_at = Set(now);
                let state_project_path = active.project_path.as_ref().clone();
                active.update(&txn).await?;
                if let Some(existing_state) =
                    AcepeSessionState::find_by_id(&session_id).one(&txn).await?
                {
                    let mut state_active: acepe_session_state::ActiveModel = existing_state.into();
                    state_active.project_path = Set(state_project_path);
                    state_active.updated_at = Set(now);
                    state_active.update(&txn).await?;
                }
                updated_count += 1;
            } else {
                let is_acepe_managed = if Self::is_acepe_managed_file_path(&file_path) {
                    1
                } else {
                    0
                };

                let model = session_metadata::ActiveModel {
                    id: Set(session_id),
                    display: Set(display),
                    timestamp: Set(timestamp),
                    project_path: Set(project_path),
                    agent_id: Set(agent_id),
                    file_path: Set(file_path),
                    file_mtime: Set(file_mtime),
                    file_size: Set(file_size),
                    worktree_path: sea_orm::ActiveValue::NotSet,
                    pr_number: sea_orm::ActiveValue::NotSet,
                    is_acepe_managed: Set(is_acepe_managed),
                    sequence_id: sea_orm::ActiveValue::NotSet,
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                SessionMetadata::insert(model).exec(&txn).await?;
                updated_count += 1;
            }
        }

        txn.commit().await?;

        tracing::info!(count = updated_count, "Batch upsert complete");
        Ok(updated_count)
    }

    /// Ensure a canonical session row exists so foreign-keyed records can be created safely.
    /// Does NOT promote existing sessions to Acepe-managed state.
    /// Returns true when a new row was inserted, false when the row already existed.
    pub async fn ensure_exists(
        db: &DbConn,
        session_id: &str,
        project_path: &str,
        agent_id: &str,
        worktree_path: Option<&str>,
    ) -> Result<bool> {
        tracing::debug!(session_id = %session_id, "Ensuring session metadata exists");

        let model = SessionMetadata::find_by_id(session_id).one(db).await?;
        if model.is_some() {
            return Ok(false);
        }

        Self::insert_acepe_tracked_session(
            db,
            session_id,
            project_path,
            agent_id,
            worktree_path,
            AcepeSessionRelationship::Opened,
        )
        .await?;
        Ok(true)
    }

    /// Ensure a session row exists AND promote it to Acepe-managed with a sequence ID.
    /// Returns the assigned sequence_id (Some for new or newly-promoted sessions,
    /// or the existing sequence_id for already-managed sessions).
    pub async fn ensure_exists_and_promote(
        db: &DbConn,
        session_id: &str,
        project_path: &str,
        agent_id: &str,
        worktree_path: Option<&str>,
    ) -> Result<Option<i32>> {
        tracing::debug!(session_id = %session_id, "Ensuring session metadata exists and is Acepe-managed");

        let model = SessionMetadata::find_by_id(session_id).one(db).await?;
        if let Some(existing_model) = model {
            return Self::mark_session_as_acepe_tracked(db, existing_model).await;
        }

        let seq = Self::insert_acepe_tracked_session(
            db,
            session_id,
            project_path,
            agent_id,
            worktree_path,
            AcepeSessionRelationship::Created,
        )
        .await?;
        Ok(Some(seq))
    }

    /// Set the worktree path on a session metadata record.
    pub async fn set_worktree_path(
        db: &DbConn,
        session_id: &str,
        worktree_path: &str,
        project_path: Option<&str>,
        agent_id: Option<&str>,
    ) -> Result<()> {
        tracing::debug!(session_id = %session_id, worktree_path = %worktree_path, "Setting worktree path");

        let model = SessionMetadata::find_by_id(session_id).one(db).await?;

        if let Some(model) = model {
            let now = Utc::now();
            let mut active: session_metadata::ActiveModel = model.into();
            active.worktree_path = Set(Some(worktree_path.to_string()));
            active.updated_at = Set(now);
            active.update(db).await?;
            if let Some(existing_state) = AcepeSessionState::find_by_id(session_id).one(db).await? {
                let mut state_active: acepe_session_state::ActiveModel = existing_state.into();
                state_active.worktree_path = Set(Some(worktree_path.to_string()));
                state_active.updated_at = Set(now);
                state_active.update(db).await?;
            }
            tracing::info!(session_id = %session_id, "Worktree path set");
        } else {
            let context_project_path = project_path.ok_or_else(|| {
                anyhow::anyhow!(
                    "Session not found in metadata index and project_path was not provided"
                )
            })?;
            let context_agent_id = agent_id.ok_or_else(|| {
                anyhow::anyhow!("Session not found in metadata index and agent_id was not provided")
            })?;
            let now = Utc::now();
            let display = Self::acepe_placeholder_display(session_id);
            let model = session_metadata::ActiveModel {
                id: Set(session_id.to_string()),
                display: Set(display),
                timestamp: Set(now.timestamp_millis()),
                project_path: Set(context_project_path.to_string()),
                agent_id: Set(context_agent_id.to_string()),
                file_path: Set(Self::created_session_file_path(session_id)),
                file_mtime: Set(0),
                file_size: Set(0),
                worktree_path: Set(Some(worktree_path.to_string())),
                pr_number: sea_orm::ActiveValue::NotSet,
                is_acepe_managed: Set(0),
                sequence_id: sea_orm::ActiveValue::NotSet,
                created_at: Set(now),
                updated_at: Set(now),
            };
            SessionMetadata::insert(model).exec(db).await?;
            let state = acepe_session_state::ActiveModel {
                session_id: Set(session_id.to_string()),
                relationship: Set(AcepeSessionRelationship::Discovered.as_str().to_string()),
                project_path: Set(context_project_path.to_string()),
                title_override: Set(None),
                worktree_path: Set(Some(worktree_path.to_string())),
                pr_number: Set(None),
                pr_link_mode: Set(None),
                sequence_id: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            };
            state.insert(db).await?;
        }

        Ok(())
    }

    pub async fn set_title_override(
        db: &DbConn,
        session_id: &str,
        title_override: Option<&str>,
    ) -> Result<()> {
        tracing::debug!(
            session_id = %session_id,
            has_override = title_override.is_some(),
            "Setting title override"
        );

        let metadata = SessionMetadata::find_by_id(session_id).one(db).await?;
        let Some(metadata) = metadata else {
            anyhow::bail!("Session metadata not found: {}", session_id);
        };

        let now = Utc::now();
        if let Some(existing_state) = AcepeSessionState::find_by_id(session_id).one(db).await? {
            let mut state_active: acepe_session_state::ActiveModel = existing_state.into();
            state_active.project_path = Set(metadata.project_path.clone());
            state_active.title_override = Set(title_override.map(str::to_string));
            state_active.updated_at = Set(now);
            state_active.update(db).await?;
        } else {
            let state = acepe_session_state::ActiveModel {
                session_id: Set(session_id.to_string()),
                relationship: Set(AcepeSessionRelationship::Discovered.as_str().to_string()),
                project_path: Set(metadata.project_path),
                title_override: Set(title_override.map(str::to_string)),
                worktree_path: Set(metadata.worktree_path),
                pr_number: Set(metadata.pr_number),
                pr_link_mode: Set(metadata.pr_number.map(|_| "automatic".to_string())),
                sequence_id: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            };
            state.insert(db).await?;
        }

        tracing::info!(session_id = %session_id, "Title override set");
        Ok(())
    }

    pub async fn set_provider_session_id(
        db: &DbConn,
        session_id: &str,
        provider_session_id: &str,
    ) -> Result<()> {
        tracing::debug!(
            session_id = %session_id,
            provider_session_id = %provider_session_id,
            "Setting provider session ID"
        );

        let model = SessionMetadata::find_by_id(session_id).one(db).await?;
        if model.is_none() {
            anyhow::bail!("Session metadata not found: {}", session_id);
        }

        if session_id != provider_session_id {
            anyhow::bail!(
                "Provider session id mismatch for canonical session {}: {}",
                session_id,
                provider_session_id
            );
        }

        tracing::info!(
            session_id = %session_id,
            provider_session_id = %provider_session_id,
            "Provider session ID verified as canonical"
        );

        Ok(())
    }

    /// Delete session by session_id.
    pub async fn delete(db: &DbConn, session_id: &str) -> Result<()> {
        tracing::debug!(session_id = %session_id, "Deleting session metadata");

        SessionMetadata::delete_by_id(session_id).exec(db).await?;

        tracing::info!(session_id = %session_id, "Session metadata deleted");
        Ok(())
    }

    /// Delete sessions by file_path (for when files are deleted).
    pub async fn delete_by_file_path(db: &DbConn, file_path: &str) -> Result<()> {
        tracing::debug!(file_path = %file_path, "Deleting session metadata by file path");

        SessionMetadata::delete_many()
            .filter(session_metadata::Column::FilePath.eq(file_path))
            .exec(db)
            .await?;

        tracing::info!(file_path = %file_path, "Session metadata deleted by file path");
        Ok(())
    }

    /// Delete sessions for an agent within projects that are missing from the latest source snapshot.
    /// Sessions with a worktree_path are excluded — they are managed by the app, not by the indexer.
    pub async fn delete_by_agent_for_projects_excluding_ids(
        db: &DbConn,
        agent_id: &str,
        project_paths: &[String],
        live_session_ids: &std::collections::HashSet<String>,
    ) -> Result<u64> {
        if project_paths.is_empty() {
            return Ok(0);
        }

        let candidates = SessionMetadata::find()
            .filter(session_metadata::Column::AgentId.eq(agent_id))
            .filter(session_metadata::Column::ProjectPath.is_in(project_paths.to_vec()))
            .filter(session_metadata::Column::WorktreePath.is_null())
            .filter(session_metadata::Column::IsAcepeManaged.eq(0))
            .all(db)
            .await?;

        let ids_to_delete: Vec<String> = candidates
            .into_iter()
            .filter(|model| !live_session_ids.contains(&model.id))
            .map(|model| model.id)
            .collect();

        if ids_to_delete.is_empty() {
            tracing::info!(agent_id = %agent_id, deleted = 0, "Deleted stale provider sessions");
            return Ok(0);
        }

        let result = SessionMetadata::delete_many()
            .filter(session_metadata::Column::Id.is_in(ids_to_delete))
            .exec(db)
            .await?;
        tracing::info!(
            agent_id = %agent_id,
            deleted = result.rows_affected,
            "Deleted stale provider sessions"
        );
        Ok(result.rows_affected)
    }

    /// Get all file paths with their mtime and size.
    /// Used for batched change detection (1 query instead of N per-file queries).
    pub async fn get_all_file_paths_with_mtime(db: &DbConn) -> Result<Vec<(String, i64, i64)>> {
        let models = SessionMetadata::find()
            .select_only()
            .column(session_metadata::Column::FilePath)
            .column(session_metadata::Column::FileMtime)
            .column(session_metadata::Column::FileSize)
            .into_tuple::<(String, i64, i64)>()
            .all(db)
            .await?;

        Ok(models)
    }

    /// Get all indexed file-tracked entries with session ID and mtime/size.
    ///
    /// Used by provider adapters that do file-diff incremental sync while still
    /// tracking live session IDs for tombstoning.
    pub async fn get_all_file_index_entries(
        db: &DbConn,
    ) -> Result<Vec<(String, String, i64, i64)>> {
        let models = SessionMetadata::find().all(db).await?;

        Ok(models
            .into_iter()
            .map(|model| (model.id, model.file_path, model.file_mtime, model.file_size))
            .collect())
    }

    /// Check if index is empty (first run detection).
    pub async fn is_empty(db: &DbConn) -> Result<bool> {
        let count = SessionMetadata::find().count(db).await?;
        Ok(count == 0)
    }

    /// Get count of indexed sessions.
    pub async fn count(db: &DbConn) -> Result<u64> {
        SessionMetadata::find().count(db).await.map_err(Into::into)
    }

    /// Set the PR number on a session metadata record.
    pub async fn set_pr_number(
        db: &DbConn,
        session_id: &str,
        pr_number: Option<i32>,
        pr_link_mode: Option<&str>,
    ) -> Result<()> {
        tracing::debug!(
            session_id = %session_id,
            pr_number = ?pr_number,
            pr_link_mode = ?pr_link_mode,
            "Setting PR number"
        );

        if let Some(model) = SessionMetadata::find_by_id(session_id).one(db).await? {
            let now = Utc::now();
            let mut active: session_metadata::ActiveModel = model.into();
            let state_project_path = active.project_path.as_ref().clone();
            let state_worktree_path = active.worktree_path.as_ref().clone();
            active.pr_number = Set(pr_number);
            active.updated_at = Set(now);
            active.update(db).await?;
            if let Some(existing_state) = AcepeSessionState::find_by_id(session_id).one(db).await? {
                let mut state_active: acepe_session_state::ActiveModel = existing_state.into();
                state_active.pr_number = Set(pr_number);
                state_active.pr_link_mode = Set(pr_link_mode.map(str::to_string));
                state_active.updated_at = Set(now);
                state_active.update(db).await?;
            } else if pr_number.is_some() || pr_link_mode.is_some() {
                let state = acepe_session_state::ActiveModel {
                    session_id: Set(session_id.to_string()),
                    relationship: Set(AcepeSessionRelationship::Discovered.as_str().to_string()),
                    project_path: Set(state_project_path),
                    title_override: Set(None),
                    worktree_path: Set(state_worktree_path),
                    pr_number: Set(pr_number),
                    pr_link_mode: Set(pr_link_mode.map(str::to_string)),
                    sequence_id: Set(None),
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                state.insert(db).await?;
            }
            tracing::info!(
                session_id = %session_id,
                pr_number = ?pr_number,
                pr_link_mode = ?pr_link_mode,
                "PR number set"
            );
        }

        Ok(())
    }
}

// ============================================================================
// Skills Repository
// ============================================================================
