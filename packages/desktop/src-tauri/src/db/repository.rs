use crate::db::entities::prelude::*;
use anyhow::Result;
use chrono::Utc;
use rand::Rng;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbConn, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ============================================================================
// Project Repository
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRow {
    pub id: String,
    pub path: String,
    pub name: String,
    pub last_opened: String,
    pub created_at: String,
    pub color: String,
}

pub struct ProjectRepository;

impl ProjectRepository {
    /// Create or update a project.
    /// If project exists, updates last_opened timestamp.
    /// If project doesn't exist, creates it.
    /// If color is None and project is new, assigns a random color.
    pub async fn create_or_update(
        db: &DbConn,
        path: String,
        name: String,
        color: Option<String>,
    ) -> Result<ProjectRow> {
        tracing::debug!(
            path = %path,
            name = %name,
            "Creating or updating project"
        );

        // Check if project exists
        let existing = Project::find()
            .filter(crate::db::entities::project::Column::Path.eq(&path))
            .one(db)
            .await?;

        let now = Utc::now();

        let project_row = if let Some(existing_model) = existing {
            // Update existing project
            let mut active: crate::db::entities::project::ActiveModel = existing_model.into();
            let id = active.id.as_ref().clone();
            let created_at = *active.created_at.as_ref();
            let existing_color = active.color.as_ref().clone();
            active.name = Set(name.clone());
            active.last_opened = Set(now);
            // Update color if provided, otherwise keep existing
            let final_color = color.unwrap_or(existing_color);
            active.color = Set(final_color.clone());
            active.update(db).await?;

            tracing::info!(
                path = %path,
                "Project updated"
            );

            ProjectRow {
                id,
                path,
                name,
                last_opened: now.to_rfc3339(),
                created_at: created_at.to_rfc3339(),
                color: final_color,
            }
        } else {
            // Create new project - assign random color if not provided
            let assigned_color = color.unwrap_or_else(|| {
                let colors = ["red", "orange", "yellow", "green", "cyan", "purple", "pink"];
                let mut rng = rand::thread_rng();
                colors[rng.gen_range(0..colors.len())].to_string()
            });

            let id = Uuid::new_v4().to_string();
            let project = crate::db::entities::project::ActiveModel {
                id: Set(id.clone()),
                path: Set(path.clone()),
                name: Set(name.clone()),
                last_opened: Set(now),
                created_at: Set(now),
                color: Set(assigned_color.clone()),
            };

            Project::insert(project).exec(db).await?;

            tracing::info!(
                id = %id,
                path = %path,
                color = %assigned_color,
                "Project created"
            );

            ProjectRow {
                id,
                path,
                name,
                last_opened: now.to_rfc3339(),
                created_at: now.to_rfc3339(),
                color: assigned_color,
            }
        };

        Ok(project_row)
    }

    /// Get project by path.
    pub async fn get_by_path(db: &DbConn, path: &str) -> Result<Option<ProjectRow>> {
        tracing::debug!(
            path = %path,
            "Loading project by path"
        );

        let model = Project::find()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .one(db)
            .await?;

        match &model {
            Some(_) => tracing::debug!(
                path = %path,
                "Project found"
            ),
            None => tracing::debug!(
                path = %path,
                "Project not found"
            ),
        }

        Ok(model.map(|m| ProjectRow {
            id: m.id,
            path: m.path,
            name: m.name,
            last_opened: m.last_opened.to_rfc3339(),
            created_at: m.created_at.to_rfc3339(),
            color: m.color,
        }))
    }

    /// Get all projects, ordered by last_opened descending.
    pub async fn get_all(db: &DbConn) -> Result<Vec<ProjectRow>> {
        tracing::debug!("Loading all projects");

        let models = Project::find()
            .order_by_desc(crate::db::entities::project::Column::CreatedAt)
            .all(db)
            .await?;

        let count = models.len();
        tracing::debug!(
            count = %count,
            "Loaded projects"
        );

        Ok(models
            .into_iter()
            .map(|m| ProjectRow {
                id: m.id,
                path: m.path,
                name: m.name,
                last_opened: m.last_opened.to_rfc3339(),
                created_at: m.created_at.to_rfc3339(),
                color: m.color,
            })
            .collect())
    }

    /// Get recent projects (limit to N, ordered by last_opened).
    pub async fn get_recent(db: &DbConn, limit: u64) -> Result<Vec<ProjectRow>> {
        tracing::debug!(
            limit = %limit,
            "Loading recent projects"
        );

        let models = Project::find()
            .order_by_desc(crate::db::entities::project::Column::LastOpened)
            .limit(limit)
            .all(db)
            .await?;

        let count = models.len();
        tracing::debug!(
            count = %count,
            "Loaded recent projects"
        );

        Ok(models
            .into_iter()
            .map(|m| ProjectRow {
                id: m.id,
                path: m.path,
                name: m.name,
                last_opened: m.last_opened.to_rfc3339(),
                created_at: m.created_at.to_rfc3339(),
                color: m.color,
            })
            .collect())
    }

    /// Delete a project by path.
    pub async fn delete(db: &DbConn, path: &str) -> Result<()> {
        tracing::debug!(
            path = %path,
            "Deleting project"
        );

        Project::delete_many()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .exec(db)
            .await?;

        tracing::info!(
            path = %path,
            "Project deleted successfully"
        );
        Ok(())
    }

    /// Get the total count of projects.
    pub async fn count(db: &DbConn) -> Result<u64> {
        tracing::debug!("Counting projects");

        let count = Project::find().count(db).await?;

        tracing::debug!(count = %count, "Project count retrieved");
        Ok(count)
    }
}

// ============================================================================
// Settings Repository
// ============================================================================

pub struct SettingsRepository;

impl SettingsRepository {
    /// Get API key for a provider.
    pub async fn get_api_key(db: &DbConn, provider_id: &str) -> Result<Option<String>> {
        tracing::debug!(
            provider_id = %provider_id,
            "Loading API key for provider"
        );

        let model = ApiKey::find()
            .filter(crate::db::entities::api_key::Column::ProviderId.eq(provider_id))
            .one(db)
            .await?;

        match &model {
            Some(_) => tracing::debug!(
                provider_id = %provider_id,
                "API key found for provider"
            ),
            None => tracing::debug!(
                provider_id = %provider_id,
                "No API key found for provider"
            ),
        }

        Ok(model.map(|m| m.value))
    }

    /// Save or update API key for a provider.
    pub async fn save_api_key(
        db: &DbConn,
        provider_id: &str,
        key_name: &str,
        value: &str,
    ) -> Result<()> {
        tracing::debug!(
            provider_id = %provider_id,
            "Saving API key for provider"
        );

        let now = Utc::now();
        let existing = ApiKey::find()
            .filter(crate::db::entities::api_key::Column::ProviderId.eq(provider_id))
            .one(db)
            .await?;

        if let Some(existing_model) = existing {
            // Update existing
            let mut active: crate::db::entities::api_key::ActiveModel = existing_model.into();
            active.key_name = Set(key_name.to_string());
            active.value = Set(value.to_string());
            active.updated_at = Set(now);
            active.update(db).await?;
            tracing::info!(
                provider_id = %provider_id,
                "API key updated for provider"
            );
        } else {
            // Create new
            let id = Uuid::new_v4().to_string();
            let api_key = crate::db::entities::api_key::ActiveModel {
                id: Set(id),
                provider_id: Set(provider_id.to_string()),
                key_name: Set(key_name.to_string()),
                value: Set(value.to_string()),
                created_at: Set(now),
                updated_at: Set(now),
            };
            ApiKey::insert(api_key).exec(db).await?;
            tracing::info!(
                provider_id = %provider_id,
                "API key created for provider"
            );
        }

        Ok(())
    }

    /// Delete API key for a provider.
    pub async fn delete_api_key(db: &DbConn, provider_id: &str) -> Result<()> {
        tracing::debug!(
            provider_id = %provider_id,
            "Deleting API key for provider"
        );

        ApiKey::delete_many()
            .filter(crate::db::entities::api_key::Column::ProviderId.eq(provider_id))
            .exec(db)
            .await?;

        tracing::info!(
            provider_id = %provider_id,
            "API key deleted for provider"
        );
        Ok(())
    }

    /// Get all user keybindings.
    pub async fn get_user_keybindings(
        db: &DbConn,
    ) -> Result<Vec<crate::db::entities::user_keybinding::Model>> {
        tracing::debug!("Loading all user keybindings");

        let models = UserKeybinding::find().all(db).await?;

        let count = models.len();
        tracing::debug!(
            count = %count,
            "Loaded user keybindings"
        );

        Ok(models)
    }

    /// Save or update a user keybinding.
    pub async fn save_user_keybinding(
        db: &DbConn,
        key: &str,
        command: &str,
        when: Option<&str>,
    ) -> Result<()> {
        tracing::debug!(
            key = %key,
            command = %command,
            "Saving user keybinding"
        );

        let now = Utc::now();
        let existing = UserKeybinding::find()
            .filter(crate::db::entities::user_keybinding::Column::Key.eq(key))
            .filter(crate::db::entities::user_keybinding::Column::Command.eq(command))
            .one(db)
            .await?;

        if let Some(existing_model) = existing {
            // Update existing
            let mut active: crate::db::entities::user_keybinding::ActiveModel =
                existing_model.into();
            active.when = Set(when.map(|s| s.to_string()));
            active.updated_at = Set(now);
            active.update(db).await?;
            tracing::info!(
                key = %key,
                command = %command,
                "User keybinding updated"
            );
        } else {
            // Create new
            let id = Uuid::new_v4().to_string();
            let keybinding = crate::db::entities::user_keybinding::ActiveModel {
                id: Set(id),
                key: Set(key.to_string()),
                command: Set(command.to_string()),
                when: Set(when.map(|s| s.to_string())),
                source: Set("user".to_string()),
                created_at: Set(now),
                updated_at: Set(now),
            };
            UserKeybinding::insert(keybinding).exec(db).await?;
            tracing::info!(
                key = %key,
                command = %command,
                "User keybinding created"
            );
        }

        Ok(())
    }

    /// Delete a user keybinding.
    pub async fn delete_user_keybinding(db: &DbConn, key: &str, command: &str) -> Result<()> {
        tracing::debug!(
            key = %key,
            command = %command,
            "Deleting user keybinding"
        );

        UserKeybinding::delete_many()
            .filter(crate::db::entities::user_keybinding::Column::Key.eq(key))
            .filter(crate::db::entities::user_keybinding::Column::Command.eq(command))
            .exec(db)
            .await?;

        tracing::info!(
            key = %key,
            command = %command,
            "User keybinding deleted"
        );
        Ok(())
    }

    /// Delete all user keybindings (reset to defaults).
    pub async fn reset_keybindings(db: &DbConn) -> Result<()> {
        tracing::debug!("Resetting all user keybindings");

        UserKeybinding::delete_many().exec(db).await?;

        tracing::info!("All user keybindings deleted");
        Ok(())
    }
}

// ============================================================================
// App Settings Repository
// ============================================================================

pub struct AppSettingsRepository;

impl AppSettingsRepository {
    /// Get a setting by key.
    pub async fn get(db: &DbConn, key: &str) -> Result<Option<String>> {
        tracing::debug!(key = %key, "Loading app setting");

        let model = AppSetting::find_by_id(key).one(db).await?;

        match &model {
            Some(_) => tracing::debug!(key = %key, "App setting found"),
            None => tracing::debug!(key = %key, "App setting not found"),
        }

        Ok(model.map(|m| m.value))
    }

    /// Set a setting value (upsert).
    pub async fn set(db: &DbConn, key: &str, value: &str) -> Result<()> {
        tracing::debug!(key = %key, "Saving app setting");

        let existing = AppSetting::find_by_id(key).one(db).await?;

        if let Some(_existing_model) = existing {
            // Update existing
            let active = crate::db::entities::app_setting::ActiveModel {
                key: Set(key.to_string()),
                value: Set(value.to_string()),
            };
            active.update(db).await?;
            tracing::info!(key = %key, "App setting updated");
        } else {
            // Create new
            let active = crate::db::entities::app_setting::ActiveModel {
                key: Set(key.to_string()),
                value: Set(value.to_string()),
            };
            AppSetting::insert(active).exec(db).await?;
            tracing::info!(key = %key, "App setting created");
        }

        Ok(())
    }

    /// Delete a setting by key.
    pub async fn delete(db: &DbConn, key: &str) -> Result<()> {
        tracing::debug!(key = %key, "Deleting app setting");

        AppSetting::delete_by_id(key).exec(db).await?;

        tracing::info!(key = %key, "App setting deleted");
        Ok(())
    }
}

// ============================================================================
// Session Review State Repository
// ============================================================================

pub struct SessionReviewStateRepository;

impl SessionReviewStateRepository {
    /// Get persisted review state JSON for a session.
    pub async fn get(db: &DbConn, session_id: &str) -> Result<Option<String>> {
        tracing::debug!(session_id = %session_id, "Loading session review state");

        let model = SessionReviewState::find_by_id(session_id).one(db).await?;
        Ok(model.map(|m| m.state_json))
    }

    /// Upsert persisted review state JSON for a session.
    pub async fn set(db: &DbConn, session_id: &str, state_json: &str) -> Result<()> {
        tracing::debug!(session_id = %session_id, "Saving session review state");

        let now = Utc::now().timestamp_millis();
        let existing = SessionReviewState::find_by_id(session_id).one(db).await?;

        if let Some(existing_model) = existing {
            let mut active: crate::db::entities::session_review_state::ActiveModel =
                existing_model.into();
            active.state_json = Set(state_json.to_string());
            active.updated_at = Set(now);
            active.update(db).await?;
            tracing::info!(session_id = %session_id, "Session review state updated");
        } else {
            let active = crate::db::entities::session_review_state::ActiveModel {
                session_id: Set(session_id.to_string()),
                state_json: Set(state_json.to_string()),
                created_at: Set(now),
                updated_at: Set(now),
            };
            SessionReviewState::insert(active).exec(db).await?;
            tracing::info!(session_id = %session_id, "Session review state created");
        }

        Ok(())
    }

    /// Delete persisted review state for a session.
    pub async fn delete(db: &DbConn, session_id: &str) -> Result<()> {
        tracing::debug!(session_id = %session_id, "Deleting session review state");
        SessionReviewState::delete_by_id(session_id)
            .exec(db)
            .await?;
        tracing::info!(session_id = %session_id, "Session review state deleted");
        Ok(())
    }
}

// ============================================================================
// Session Metadata Repository
// ============================================================================

use crate::db::entities::session_metadata;

/// Row returned from session metadata queries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMetadataRow {
    pub id: String,
    pub display: String,
    pub timestamp: i64,
    pub project_path: String,
    pub agent_id: String,
    pub file_path: String,
    pub file_mtime: i64,
    pub file_size: i64,
    pub worktree_path: Option<String>,
    pub pr_number: Option<i32>,
}

/// A batch record for session metadata upsert:
/// (session_id, display, timestamp, project_path, agent_id, file_path, file_mtime, file_size)
pub type SessionMetadataRecord = (String, String, i64, String, String, String, i64, i64);

/// Repository for session metadata (pre-indexed session information).
///
/// This provides fast O(1) lookups for session history instead of
/// scanning JSONL files on every request.
pub struct SessionMetadataRepository;

impl SessionMetadataRepository {
    async fn insert_placeholder(
        db: &DbConn,
        session_id: &str,
        project_path: &str,
        agent_id: &str,
        worktree_path: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now();
        let preview_len = 8usize.min(session_id.len());
        let display = format!("Session {}", &session_id[..preview_len]);
        let placeholder_file_path = format!("__worktree__/{}", session_id);

        let model = session_metadata::ActiveModel {
            id: Set(session_id.to_string()),
            display: Set(display),
            timestamp: Set(now.timestamp_millis()),
            project_path: Set(project_path.to_string()),
            agent_id: Set(agent_id.to_string()),
            file_path: Set(placeholder_file_path),
            file_mtime: Set(0),
            file_size: Set(0),
            worktree_path: Set(worktree_path.map(|path| path.to_string())),
            pr_number: sea_orm::ActiveValue::NotSet,
            created_at: Set(now),
            updated_at: Set(now),
        };

        SessionMetadata::insert(model).exec(db).await?;
        tracing::info!(
            session_id = %session_id,
            project_path = %project_path,
            agent_id = %agent_id,
            worktree_path = ?worktree_path,
            "Session metadata placeholder inserted"
        );

        Ok(())
    }

    /// Get all sessions for given project paths, ordered by timestamp DESC.
    pub async fn get_for_projects(
        db: &DbConn,
        project_paths: &[String],
    ) -> Result<Vec<SessionMetadataRow>> {
        if project_paths.is_empty() {
            return Ok(Vec::new());
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

        let count = models.len();
        tracing::debug!(count = count, "Loaded session metadata");

        Ok(models.into_iter().map(Self::model_to_row).collect())
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

        Ok(models.into_iter().map(Self::model_to_row).collect())
    }

    /// Get session by session_id.
    pub async fn get_by_id(db: &DbConn, session_id: &str) -> Result<Option<SessionMetadataRow>> {
        tracing::debug!(session_id = %session_id, "Loading session metadata by ID");

        let model = SessionMetadata::find_by_id(session_id).one(db).await?;

        Ok(model.map(Self::model_to_row))
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

        let existing = SessionMetadata::find_by_id(&session_id).one(db).await?;

        if let Some(existing_model) = existing {
            // Check if file has changed (mtime + size comparison)
            if existing_model.file_mtime == file_mtime && existing_model.file_size == file_size {
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
            active.updated_at = Set(now);
            active.update(db).await?;
        } else {
            // Insert new record
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

        // Build a HashMap for O(1) lookup during iteration
        let existing_map: std::collections::HashMap<String, session_metadata::Model> =
            existing_records
                .into_iter()
                .map(|m| (m.id.clone(), m))
                .collect();

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
                // Check if file has changed (skip if mtime+size match).
                // Non-Claude agents use mtime=0/size=0 sentinel — always refresh those.
                if file_mtime != 0
                    && existing_model.file_mtime == file_mtime
                    && existing_model.file_size == file_size
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
                active.updated_at = Set(now);
                active.update(&txn).await?;
                updated_count += 1;
            } else {
                // Insert new
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

    /// Ensure a session metadata row exists so foreign-keyed records can be created safely.
    /// Returns true when a placeholder row was inserted, false when the row already existed.
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

        Self::insert_placeholder(db, session_id, project_path, agent_id, worktree_path).await?;
        Ok(true)
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
            let mut active: session_metadata::ActiveModel = model.into();
            active.worktree_path = Set(Some(worktree_path.to_string()));
            active.updated_at = Set(Utc::now());
            active.update(db).await?;
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
            Self::insert_placeholder(
                db,
                session_id,
                context_project_path,
                context_agent_id,
                Some(worktree_path),
            )
            .await?;
        }

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

        let mut query = SessionMetadata::delete_many()
            .filter(session_metadata::Column::AgentId.eq(agent_id))
            .filter(session_metadata::Column::ProjectPath.is_in(project_paths.to_vec()))
            .filter(session_metadata::Column::WorktreePath.is_null());

        if !live_session_ids.is_empty() {
            query = query.filter(
                session_metadata::Column::Id
                    .is_not_in(live_session_ids.iter().cloned().collect::<Vec<_>>()),
            );
        }

        let result = query.exec(db).await?;
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
        let models = SessionMetadata::find()
            .select_only()
            .column(session_metadata::Column::Id)
            .column(session_metadata::Column::FilePath)
            .column(session_metadata::Column::FileMtime)
            .column(session_metadata::Column::FileSize)
            .into_tuple::<(String, String, i64, i64)>()
            .all(db)
            .await?;

        Ok(models)
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

    fn model_to_row(m: session_metadata::Model) -> SessionMetadataRow {
        SessionMetadataRow {
            id: m.id,
            display: m.display,
            timestamp: m.timestamp,
            project_path: m.project_path,
            agent_id: m.agent_id,
            file_path: m.file_path,
            file_mtime: m.file_mtime,
            file_size: m.file_size,
            worktree_path: m.worktree_path,
            pr_number: m.pr_number,
        }
    }

    /// Set the PR number on a session metadata record.
    pub async fn set_pr_number(
        db: &DbConn,
        session_id: &str,
        pr_number: Option<i32>,
    ) -> Result<()> {
        tracing::debug!(session_id = %session_id, pr_number = ?pr_number, "Setting PR number");

        if let Some(model) = SessionMetadata::find_by_id(session_id).one(db).await? {
            let mut active: session_metadata::ActiveModel = model.into();
            active.pr_number = Set(pr_number);
            active.updated_at = Set(Utc::now());
            active.update(db).await?;
            tracing::info!(session_id = %session_id, pr_number = ?pr_number, "PR number set");
        }

        Ok(())
    }
}

// ============================================================================
// Skills Repository
// ============================================================================

use crate::db::entities::{skill, skill_sync_history, skill_sync_target};

/// Row returned from skill queries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub category: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Sync target for a skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSyncTargetRow {
    pub skill_id: String,
    pub agent_id: String,
    pub enabled: bool,
}

/// Sync history entry for a skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSyncHistoryRow {
    pub skill_id: String,
    pub agent_id: String,
    pub synced_at: i64,
    pub content_hash: String,
}

/// Skill with its sync status for each agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillWithSyncStatus {
    pub skill: SkillRow,
    pub sync_targets: Vec<SkillSyncTargetRow>,
    pub sync_history: Vec<SkillSyncHistoryRow>,
}

/// Repository for skills management.
pub struct SkillsRepository;

impl SkillsRepository {
    /// Get all skills, ordered by name.
    pub async fn get_all(db: &DbConn) -> Result<Vec<SkillRow>> {
        tracing::debug!("Loading all skills");

        let models = Skill::find()
            .order_by_asc(skill::Column::Name)
            .all(db)
            .await?;

        let count = models.len();
        tracing::debug!(count = count, "Loaded skills");

        Ok(models.into_iter().map(Self::model_to_row).collect())
    }

    /// Get skill by ID.
    pub async fn get_by_id(db: &DbConn, skill_id: &str) -> Result<Option<SkillRow>> {
        tracing::debug!(skill_id = %skill_id, "Loading skill by ID");

        let model = Skill::find_by_id(skill_id).one(db).await?;

        Ok(model.map(Self::model_to_row))
    }

    /// Get skill by name.
    pub async fn get_by_name(db: &DbConn, name: &str) -> Result<Option<SkillRow>> {
        tracing::debug!(name = %name, "Loading skill by name");

        let model = Skill::find()
            .filter(skill::Column::Name.eq(name))
            .one(db)
            .await?;

        Ok(model.map(Self::model_to_row))
    }

    /// Create a new skill.
    pub async fn create(
        db: &DbConn,
        name: String,
        description: Option<String>,
        content: String,
        category: Option<String>,
    ) -> Result<SkillRow> {
        tracing::debug!(name = %name, "Creating skill");

        let now = chrono::Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();

        let model = skill::ActiveModel {
            id: Set(id.clone()),
            name: Set(name.clone()),
            description: Set(description.clone()),
            content: Set(content.clone()),
            category: Set(category.clone()),
            created_at: Set(now),
            updated_at: Set(now),
        };

        Skill::insert(model).exec(db).await?;

        tracing::info!(id = %id, name = %name, "Skill created");

        Ok(SkillRow {
            id,
            name,
            description,
            content,
            category,
            created_at: now,
            updated_at: now,
        })
    }

    /// Update an existing skill.
    pub async fn update(
        db: &DbConn,
        skill_id: &str,
        name: Option<String>,
        description: Option<Option<String>>,
        content: Option<String>,
        category: Option<Option<String>>,
    ) -> Result<SkillRow> {
        tracing::debug!(skill_id = %skill_id, "Updating skill");

        let existing = Skill::find_by_id(skill_id)
            .one(db)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", skill_id))?;

        let now = chrono::Utc::now().timestamp_millis();
        let mut active: skill::ActiveModel = existing.into();

        if let Some(n) = name {
            active.name = Set(n);
        }
        if let Some(d) = description {
            active.description = Set(d);
        }
        if let Some(c) = content {
            active.content = Set(c);
        }
        if let Some(cat) = category {
            active.category = Set(cat);
        }
        active.updated_at = Set(now);

        let updated = active.update(db).await?;

        tracing::info!(skill_id = %skill_id, "Skill updated");

        Ok(Self::model_to_row(updated))
    }

    /// Delete a skill.
    pub async fn delete(db: &DbConn, skill_id: &str) -> Result<()> {
        tracing::debug!(skill_id = %skill_id, "Deleting skill");

        Skill::delete_by_id(skill_id).exec(db).await?;

        tracing::info!(skill_id = %skill_id, "Skill deleted");
        Ok(())
    }

    /// Get sync targets for a skill.
    pub async fn get_sync_targets(db: &DbConn, skill_id: &str) -> Result<Vec<SkillSyncTargetRow>> {
        tracing::debug!(skill_id = %skill_id, "Loading sync targets");

        let models = SkillSyncTarget::find()
            .filter(skill_sync_target::Column::SkillId.eq(skill_id))
            .all(db)
            .await?;

        Ok(models
            .into_iter()
            .map(|m| SkillSyncTargetRow {
                skill_id: m.skill_id,
                agent_id: m.agent_id,
                enabled: m.enabled != 0,
            })
            .collect())
    }

    /// Set sync target enabled/disabled for a skill.
    pub async fn set_sync_target(
        db: &DbConn,
        skill_id: &str,
        agent_id: &str,
        enabled: bool,
    ) -> Result<()> {
        tracing::debug!(
            skill_id = %skill_id,
            agent_id = %agent_id,
            enabled = %enabled,
            "Setting sync target"
        );

        let existing = SkillSyncTarget::find()
            .filter(skill_sync_target::Column::SkillId.eq(skill_id))
            .filter(skill_sync_target::Column::AgentId.eq(agent_id))
            .one(db)
            .await?;

        if let Some(existing_model) = existing {
            // Update existing
            let mut active: skill_sync_target::ActiveModel = existing_model.into();
            active.enabled = Set(if enabled { 1 } else { 0 });
            active.update(db).await?;
        } else {
            // Create new
            let model = skill_sync_target::ActiveModel {
                skill_id: Set(skill_id.to_string()),
                agent_id: Set(agent_id.to_string()),
                enabled: Set(if enabled { 1 } else { 0 }),
            };
            SkillSyncTarget::insert(model).exec(db).await?;
        }

        tracing::info!(
            skill_id = %skill_id,
            agent_id = %agent_id,
            enabled = %enabled,
            "Sync target set"
        );
        Ok(())
    }

    /// Get sync history for a skill.
    pub async fn get_sync_history(db: &DbConn, skill_id: &str) -> Result<Vec<SkillSyncHistoryRow>> {
        tracing::debug!(skill_id = %skill_id, "Loading sync history");

        let models = SkillSyncHistory::find()
            .filter(skill_sync_history::Column::SkillId.eq(skill_id))
            .all(db)
            .await?;

        Ok(models
            .into_iter()
            .map(|m| SkillSyncHistoryRow {
                skill_id: m.skill_id,
                agent_id: m.agent_id,
                synced_at: m.synced_at,
                content_hash: m.content_hash,
            })
            .collect())
    }

    /// Record a sync event.
    pub async fn record_sync(
        db: &DbConn,
        skill_id: &str,
        agent_id: &str,
        content_hash: &str,
    ) -> Result<()> {
        tracing::debug!(
            skill_id = %skill_id,
            agent_id = %agent_id,
            "Recording sync"
        );

        let now = chrono::Utc::now().timestamp_millis();

        let existing = SkillSyncHistory::find()
            .filter(skill_sync_history::Column::SkillId.eq(skill_id))
            .filter(skill_sync_history::Column::AgentId.eq(agent_id))
            .one(db)
            .await?;

        if let Some(existing_model) = existing {
            // Update existing
            let mut active: skill_sync_history::ActiveModel = existing_model.into();
            active.synced_at = Set(now);
            active.content_hash = Set(content_hash.to_string());
            active.update(db).await?;
        } else {
            // Create new
            let model = skill_sync_history::ActiveModel {
                skill_id: Set(skill_id.to_string()),
                agent_id: Set(agent_id.to_string()),
                synced_at: Set(now),
                content_hash: Set(content_hash.to_string()),
            };
            SkillSyncHistory::insert(model).exec(db).await?;
        }

        tracing::info!(
            skill_id = %skill_id,
            agent_id = %agent_id,
            "Sync recorded"
        );
        Ok(())
    }

    /// Get skill with full sync status.
    pub async fn get_with_sync_status(
        db: &DbConn,
        skill_id: &str,
    ) -> Result<Option<SkillWithSyncStatus>> {
        let skill = Self::get_by_id(db, skill_id).await?;

        match skill {
            Some(s) => {
                let sync_targets = Self::get_sync_targets(db, skill_id).await?;
                let sync_history = Self::get_sync_history(db, skill_id).await?;

                Ok(Some(SkillWithSyncStatus {
                    skill: s,
                    sync_targets,
                    sync_history,
                }))
            }
            None => Ok(None),
        }
    }

    /// Get all skills with sync status.
    pub async fn get_all_with_sync_status(db: &DbConn) -> Result<Vec<SkillWithSyncStatus>> {
        let skills = Self::get_all(db).await?;
        let mut result = Vec::with_capacity(skills.len());

        for skill in skills {
            let sync_targets = Self::get_sync_targets(db, &skill.id).await?;
            let sync_history = Self::get_sync_history(db, &skill.id).await?;

            result.push(SkillWithSyncStatus {
                skill,
                sync_targets,
                sync_history,
            });
        }

        Ok(result)
    }

    /// Check if database has any skills (for first-run detection).
    pub async fn is_empty(db: &DbConn) -> Result<bool> {
        let count = Skill::find().count(db).await?;
        Ok(count == 0)
    }

    /// Get count of skills.
    pub async fn count(db: &DbConn) -> Result<u64> {
        Skill::find().count(db).await.map_err(Into::into)
    }

    fn model_to_row(m: skill::Model) -> SkillRow {
        SkillRow {
            id: m.id,
            name: m.name,
            description: m.description,
            content: m.content,
            category: m.category,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

// ============================================================================
// Database Reset Repository
// ============================================================================

pub struct DatabaseResetRepository;

impl DatabaseResetRepository {
    /// Reset all data in the database by deleting all records from all tables.
    /// This operation cannot be undone.
    pub async fn reset_all_data(db: &DbConn) -> Result<()> {
        tracing::debug!("Resetting all database data");

        // SQL Studio tables
        let sql_history_deleted = SqlQueryHistory::delete_many().exec(db).await?;
        tracing::debug!(
            count = %sql_history_deleted.rows_affected,
            "Deleted sql_query_history records"
        );

        let sql_connections_deleted = SqlConnection::delete_many().exec(db).await?;
        tracing::debug!(
            count = %sql_connections_deleted.rows_affected,
            "Deleted sql_connections records"
        );

        // Delete from all tables in order that respects foreign key constraints
        // Skills tables first (depend on skills)
        let sync_history_deleted = SkillSyncHistory::delete_many().exec(db).await?;
        tracing::debug!(
            count = %sync_history_deleted.rows_affected,
            "Deleted skill_sync_history records"
        );

        let sync_targets_deleted = SkillSyncTarget::delete_many().exec(db).await?;
        tracing::debug!(
            count = %sync_targets_deleted.rows_affected,
            "Deleted skill_sync_targets records"
        );

        let skills_deleted = Skill::delete_many().exec(db).await?;
        tracing::debug!(count = %skills_deleted.rows_affected, "Deleted skills records");

        // Session metadata
        let sessions_deleted = SessionMetadata::delete_many().exec(db).await?;
        tracing::debug!(
            count = %sessions_deleted.rows_affected,
            "Deleted session_metadata records"
        );

        // User settings
        let keybindings_deleted = UserKeybinding::delete_many().exec(db).await?;
        tracing::debug!(
            count = %keybindings_deleted.rows_affected,
            "Deleted user_keybindings records"
        );

        let api_keys_deleted = ApiKey::delete_many().exec(db).await?;
        tracing::debug!(count = %api_keys_deleted.rows_affected, "Deleted api_keys records");

        let settings_deleted = AppSetting::delete_many().exec(db).await?;
        tracing::debug!(
            count = %settings_deleted.rows_affected,
            "Deleted app_settings records"
        );

        // Projects last (base table)
        let projects_deleted = Project::delete_many().exec(db).await?;
        tracing::debug!(count = %projects_deleted.rows_affected, "Deleted projects records");

        let total_deleted = sql_history_deleted.rows_affected
            + sql_connections_deleted.rows_affected
            + sync_history_deleted.rows_affected
            + sync_targets_deleted.rows_affected
            + skills_deleted.rows_affected
            + sessions_deleted.rows_affected
            + keybindings_deleted.rows_affected
            + api_keys_deleted.rows_affected
            + settings_deleted.rows_affected
            + projects_deleted.rows_affected;

        tracing::info!(
            total_deleted = %total_deleted,
            projects = %projects_deleted.rows_affected,
            api_keys = %api_keys_deleted.rows_affected,
            keybindings = %keybindings_deleted.rows_affected,
            settings = %settings_deleted.rows_affected,
            sessions = %sessions_deleted.rows_affected,
            skills = %skills_deleted.rows_affected,
            sql_connections = %sql_connections_deleted.rows_affected,
            sql_history = %sql_history_deleted.rows_affected,
            sync_targets = %sync_targets_deleted.rows_affected,
            sync_history = %sync_history_deleted.rows_affected,
            "Database reset complete - all data deleted"
        );

        Ok(())
    }
}

// ============================================================================
// SQL Studio Repository
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlConnectionRow {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub connection_kind: String,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub database_name: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub file_path: Option<String>,
    pub ssl_mode: Option<String>,
    pub config_json: Option<String>,
    pub secret_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlQueryHistoryRow {
    pub id: String,
    pub connection_id: String,
    pub sql_text: String,
    pub executed_at: i64,
    pub duration_ms: i64,
    pub row_count: i64,
    pub status: String,
    pub error_summary: Option<String>,
}

pub struct SqlStudioRepository;

impl SqlStudioRepository {
    pub async fn list_connections(db: &DbConn) -> Result<Vec<SqlConnectionRow>> {
        let models = SqlConnection::find()
            .order_by_asc(crate::db::entities::sql_connection::Column::Name)
            .all(db)
            .await?;

        Ok(models
            .into_iter()
            .map(Self::connection_model_to_row)
            .collect())
    }

    pub async fn get_connection(db: &DbConn, id: &str) -> Result<Option<SqlConnectionRow>> {
        let model = SqlConnection::find_by_id(id).one(db).await?;
        Ok(model.map(Self::connection_model_to_row))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn save_connection(
        db: &DbConn,
        id: Option<String>,
        name: String,
        engine: String,
        connection_kind: String,
        host: Option<String>,
        port: Option<i32>,
        database_name: Option<String>,
        username: Option<String>,
        password: Option<String>,
        file_path: Option<String>,
        ssl_mode: Option<String>,
        config_json: Option<String>,
        secret_json: Option<String>,
    ) -> Result<SqlConnectionRow> {
        let now = Utc::now().timestamp_millis();
        if let Some(existing_id) = id {
            let existing = SqlConnection::find_by_id(&existing_id).one(db).await?;
            if let Some(existing_model) = existing {
                let mut active: crate::db::entities::sql_connection::ActiveModel =
                    existing_model.into();
                active.name = Set(name);
                active.engine = Set(engine);
                active.connection_kind = Set(connection_kind);
                active.host = Set(host);
                active.port = Set(port);
                active.database_name = Set(database_name);
                active.username = Set(username);
                if password.is_some() {
                    active.password = Set(password);
                }
                active.file_path = Set(file_path);
                active.ssl_mode = Set(ssl_mode);
                active.config_json = Set(config_json);
                if secret_json.is_some() {
                    active.secret_json = Set(secret_json);
                }
                active.updated_at = Set(now);
                let updated = active.update(db).await?;
                return Ok(Self::connection_model_to_row(updated));
            }
        }

        let new_id = Uuid::new_v4().to_string();
        let active = crate::db::entities::sql_connection::ActiveModel {
            id: Set(new_id),
            name: Set(name),
            engine: Set(engine),
            connection_kind: Set(connection_kind),
            host: Set(host),
            port: Set(port),
            database_name: Set(database_name),
            username: Set(username),
            password: Set(password),
            file_path: Set(file_path),
            ssl_mode: Set(ssl_mode),
            config_json: Set(config_json),
            secret_json: Set(secret_json),
            created_at: Set(now),
            updated_at: Set(now),
        };

        let inserted = SqlConnection::insert(active)
            .exec_with_returning(db)
            .await?;
        Ok(Self::connection_model_to_row(inserted))
    }

    pub async fn delete_connection(db: &DbConn, id: &str) -> Result<()> {
        SqlConnection::delete_by_id(id).exec(db).await?;
        Ok(())
    }

    pub async fn insert_query_history(
        db: &DbConn,
        connection_id: String,
        sql_text: String,
        duration_ms: i64,
        row_count: i64,
        status: String,
        error_summary: Option<String>,
    ) -> Result<()> {
        let active = crate::db::entities::sql_query_history::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            connection_id: Set(connection_id),
            sql_text: Set(sql_text),
            executed_at: Set(Utc::now().timestamp_millis()),
            duration_ms: Set(duration_ms),
            row_count: Set(row_count),
            status: Set(status),
            error_summary: Set(error_summary),
        };
        SqlQueryHistory::insert(active).exec(db).await?;
        Ok(())
    }

    fn connection_model_to_row(m: crate::db::entities::sql_connection::Model) -> SqlConnectionRow {
        SqlConnectionRow {
            id: m.id,
            name: m.name,
            engine: m.engine,
            connection_kind: m.connection_kind,
            host: m.host,
            port: m.port,
            database_name: m.database_name,
            username: m.username,
            password: m.password,
            file_path: m.file_path,
            ssl_mode: m.ssl_mode,
            config_json: m.config_json,
            secret_json: m.secret_json,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}
