use crate::db::entities::prelude::*;
use crate::{
    acp::parsers::provider_capabilities::{
        all_provider_capabilities, find_provider_capabilities_by_id,
    },
    acp::session_descriptor::{
        resolve_existing_session_descriptor, resolve_existing_session_resume,
        ResolvedResumeSession, SessionCompatibilityInput, SessionDescriptor,
        SessionDescriptorFacts, SessionDescriptorResolutionError, SessionReplayContext,
    },
    acp::session_journal::{
        ProjectionJournalUpdate, SessionJournalEvent as SessionJournalRecord,
        SessionJournalEventPayload,
    },
    db::entities::session_journal_event,
};
use anyhow::Result;
use chrono::Utc;
use rand::Rng;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DbBackend, DbConn, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement, TransactionTrait,
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
    pub sort_order: i32,
    pub icon_path: Option<String>,
}

pub struct ProjectRepository;

impl ProjectRepository {
    fn display_name(path: &str, stored_name: &str) -> String {
        std::path::Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .map(std::borrow::ToOwned::to_owned)
            .unwrap_or_else(|| stored_name.to_string())
    }

    fn row_from_model(model: crate::db::entities::project::Model) -> ProjectRow {
        let name = Self::display_name(&model.path, &model.name);

        ProjectRow {
            id: model.id,
            path: model.path,
            name,
            last_opened: model.last_opened.to_rfc3339(),
            created_at: model.created_at.to_rfc3339(),
            color: model.color,
            sort_order: model.sort_order,
            icon_path: model.icon_path,
        }
    }

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
            let sort_order = *active.sort_order.as_ref();
            let icon_path = active.icon_path.as_ref().clone();
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
                sort_order,
                icon_path,
            }
        } else {
            // Create new project - assign random color if not provided
            let assigned_color = color.unwrap_or_else(|| {
                let colors = ["red", "orange", "yellow", "green", "cyan", "purple", "pink"];
                let mut rng = rand::thread_rng();
                colors[rng.gen_range(0..colors.len())].to_string()
            });

            let txn = db.begin().await?;
            txn.execute_unprepared("UPDATE projects SET sort_order = sort_order + 1")
                .await?;

            let id = Uuid::new_v4().to_string();
            let project = crate::db::entities::project::ActiveModel {
                id: Set(id.clone()),
                path: Set(path.clone()),
                name: Set(name.clone()),
                last_opened: Set(now),
                created_at: Set(now),
                color: Set(assigned_color.clone()),
                sort_order: Set(0),
                icon_path: Set(None),
            };

            Project::insert(project).exec(&txn).await?;
            txn.commit().await?;

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
                sort_order: 0,
                icon_path: None,
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

        Ok(model.map(Self::row_from_model))
    }

    /// Get all projects, ordered by persisted sidebar order.
    pub async fn get_all(db: &DbConn) -> Result<Vec<ProjectRow>> {
        tracing::debug!("Loading all projects");

        let models = Project::find()
            .order_by_asc(crate::db::entities::project::Column::SortOrder)
            .order_by_desc(crate::db::entities::project::Column::CreatedAt)
            .all(db)
            .await?;

        let count = models.len();
        tracing::debug!(
            count = %count,
            "Loaded projects"
        );

        Ok(models.into_iter().map(Self::row_from_model).collect())
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

        Ok(models.into_iter().map(Self::row_from_model).collect())
    }

    pub async fn update_icon_path(
        db: &DbConn,
        path: &str,
        icon_path: Option<String>,
    ) -> Result<ProjectRow> {
        let existing = Project::find()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .one(db)
            .await?;

        let Some(existing_model) = existing else {
            anyhow::bail!("Project not found: {}", path);
        };

        let mut active: crate::db::entities::project::ActiveModel = existing_model.into();
        active.icon_path = Set(icon_path);

        let updated = active.update(db).await?;
        Ok(Self::row_from_model(updated))
    }

    pub async fn reorder(db: &DbConn, ordered_paths: &[String]) -> Result<Vec<ProjectRow>> {
        let txn = db.begin().await?;
        let existing = Project::find().all(&txn).await?;
        if existing.len() != ordered_paths.len() {
            anyhow::bail!("Project order update requires all projects");
        }

        let existing_paths = existing
            .iter()
            .map(|project| project.path.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let requested_paths = ordered_paths
            .iter()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();

        if existing_paths != requested_paths {
            anyhow::bail!("Project order update paths do not match stored projects");
        }

        for (index, path) in ordered_paths.iter().enumerate() {
            let project = Project::find()
                .filter(crate::db::entities::project::Column::Path.eq(path))
                .one(&txn)
                .await?;

            let Some(project_model) = project else {
                anyhow::bail!("Project not found during reorder: {}", path);
            };

            let mut active: crate::db::entities::project::ActiveModel = project_model.into();
            active.sort_order = Set(index as i32);
            active.update(&txn).await?;
        }
        txn.commit().await?;

        Self::get_all(db).await
    }

    /// Delete a project by path.
    pub async fn delete(db: &DbConn, path: &str) -> Result<()> {
        tracing::debug!(
            path = %path,
            "Deleting project"
        );

        let txn = db.begin().await?;
        let existing = Project::find()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .one(&txn)
            .await?;

        let Some(existing_model) = existing else {
            return Ok(());
        };

        let deleted_sort_order = existing_model.sort_order;

        Project::delete_many()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .exec(&txn)
            .await?;

        let shift_statement = format!(
            "UPDATE projects SET sort_order = sort_order - 1 WHERE sort_order > {}",
            deleted_sort_order
        );
        txn.execute_unprepared(&shift_statement).await?;
        txn.commit().await?;

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
// Session Projection Snapshot Repository
// ============================================================================

pub struct SessionProjectionSnapshotRepository;

impl SessionProjectionSnapshotRepository {
    pub async fn get(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Option<crate::acp::projections::SessionProjectionSnapshot>> {
        tracing::debug!(session_id = %session_id, "Loading session projection snapshot");

        let model =
            crate::db::entities::session_projection_snapshot::Entity::find_by_id(session_id)
                .one(db)
                .await?;
        model
            .map(|row| {
                serde_json::from_str::<crate::acp::projections::SessionProjectionSnapshot>(
                    &row.snapshot_json,
                )
                .map_err(anyhow::Error::from)
            })
            .transpose()
    }

    pub async fn set(
        db: &DbConn,
        session_id: &str,
        snapshot: &crate::acp::projections::SessionProjectionSnapshot,
    ) -> Result<()> {
        tracing::debug!(session_id = %session_id, "Saving session projection snapshot");

        let snapshot_json = serde_json::to_string(snapshot)?;
        let now = Utc::now();
        let existing =
            crate::db::entities::session_projection_snapshot::Entity::find_by_id(session_id)
                .one(db)
                .await?;

        if let Some(existing_model) = existing {
            let mut active: crate::db::entities::session_projection_snapshot::ActiveModel =
                existing_model.into();
            active.snapshot_json = Set(snapshot_json);
            active.updated_at = Set(now);
            active.update(db).await?;
        } else {
            let active = crate::db::entities::session_projection_snapshot::ActiveModel {
                session_id: Set(session_id.to_string()),
                snapshot_json: Set(snapshot_json),
                updated_at: Set(now),
            };
            crate::db::entities::session_projection_snapshot::Entity::insert(active)
                .exec(db)
                .await?;
        }

        Ok(())
    }
}

// ============================================================================
// Session Journal Event Repository
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SerializedSessionJournalEventRow {
    pub event_id: String,
    pub session_id: String,
    pub event_seq: i64,
    pub event_kind: String,
    pub event_json: String,
    pub created_at_ms: i64,
}

pub struct SessionJournalEventRepository;

impl SessionJournalEventRepository {
    pub async fn list_serialized(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Vec<SerializedSessionJournalEventRow>> {
        tracing::debug!(session_id = %session_id, "Loading serialized session journal events");

        let rows = crate::db::entities::session_journal_event::Entity::find()
            .filter(session_journal_event::Column::SessionId.eq(session_id))
            .order_by_asc(session_journal_event::Column::EventSeq)
            .all(db)
            .await?
            .into_iter()
            .map(|row| SerializedSessionJournalEventRow {
                event_id: row.event_id,
                session_id: row.session_id,
                event_seq: row.event_seq,
                event_kind: row.event_kind,
                event_json: row.event_json,
                created_at_ms: row.created_at.timestamp_millis().max(0),
            })
            .collect::<Vec<_>>();

        Ok(rows)
    }

    pub async fn append_session_update(
        db: &DbConn,
        session_id: &str,
        update: &crate::acp::session_update::SessionUpdate,
    ) -> Result<Option<SessionJournalRecord>> {
        let Some(update) = ProjectionJournalUpdate::from_session_update(update) else {
            return Ok(None);
        };

        Self::append(
            db,
            session_id,
            SessionJournalEventPayload::ProjectionUpdate {
                update: Box::new(update),
            },
        )
        .await
        .map(Some)
    }

    pub async fn append_interaction_transition(
        db: &DbConn,
        session_id: &str,
        interaction_id: &str,
        state: crate::acp::projections::InteractionState,
        response: crate::acp::projections::InteractionResponse,
    ) -> Result<SessionJournalRecord> {
        Self::append(
            db,
            session_id,
            SessionJournalEventPayload::InteractionTransition {
                interaction_id: interaction_id.to_string(),
                state,
                response,
            },
        )
        .await
    }

    async fn append(
        db: &DbConn,
        session_id: &str,
        payload: SessionJournalEventPayload,
    ) -> Result<SessionJournalRecord> {
        tracing::debug!(session_id = %session_id, "Appending session journal event");

        let tx = db.begin().await?;
        let max_seq: Option<i64> = crate::db::entities::session_journal_event::Entity::find()
            .select_only()
            .column_as(session_journal_event::Column::EventSeq.max(), "max_seq")
            .filter(session_journal_event::Column::SessionId.eq(session_id))
            .into_tuple::<Option<i64>>()
            .one(&tx)
            .await?
            .flatten();
        let event =
            SessionJournalRecord::new(session_id, max_seq.map_or(1, |seq| seq + 1), payload);
        let active = crate::db::entities::session_journal_event::ActiveModel {
            event_id: Set(event.event_id.clone()),
            session_id: Set(event.session_id.clone()),
            event_seq: Set(event.event_seq),
            event_kind: Set(event.event_kind().to_string()),
            event_json: Set(serde_json::to_string(&event.payload)?),
            created_at: Set(Utc::now()),
        };
        crate::db::entities::session_journal_event::Entity::insert(active)
            .exec(&tx)
            .await?;
        tx.commit().await?;

        Ok(event)
    }

    /// Return the maximum `event_seq` persisted for `session_id`, or `None`
    /// when no events exist yet (i.e. `last_event_seq = 0` for a fresh
    /// session).
    pub async fn max_event_seq(db: &DbConn, session_id: &str) -> Result<Option<i64>> {
        let max_seq: Option<i64> = crate::db::entities::session_journal_event::Entity::find()
            .select_only()
            .column_as(session_journal_event::Column::EventSeq.max(), "max_seq")
            .filter(session_journal_event::Column::SessionId.eq(session_id))
            .into_tuple::<Option<i64>>()
            .one(db)
            .await?
            .flatten();
        Ok(max_seq)
    }
}

// ============================================================================
// Session Metadata Repository
// ============================================================================

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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub provider_session_id: Option<String>,
    pub worktree_path: Option<String>,
    pub pr_number: Option<i32>,
    pub is_acepe_managed: bool,
    pub sequence_id: Option<i32>,
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
        backend_identity_policy_for_provider_id(&self.agent_id)
            .history_session_id(&self.id, self.provider_session_id.as_deref())
    }

    pub fn effective_project_path(&self) -> Option<&str> {
        self.worktree_path
            .as_deref()
            .or_else(|| (!self.project_path.is_empty()).then_some(self.project_path.as_str()))
    }

    pub fn descriptor_facts(&self) -> SessionDescriptorFacts {
        SessionDescriptorFacts {
            local_session_id: self.id.clone(),
            provider_session_id: self.provider_session_id.clone(),
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
        provider_session_id: model.provider_session_id,
        worktree_path,
        pr_number,
        is_acepe_managed,
        sequence_id,
    }
}

fn backend_identity_policy_for_provider_id(
    provider_id: &str,
) -> crate::acp::provider::BackendIdentityPolicy {
    find_provider_capabilities_by_id(all_provider_capabilities(), provider_id)
        .map(|capabilities| capabilities.backend_identity_policy)
        .unwrap_or_default()
}

/// A batch record for session metadata upsert:
/// (session_id, display, timestamp, project_path, agent_id, file_path, file_mtime, file_size)
pub type SessionMetadataRecord = (String, String, i64, String, String, String, i64, i64);

/// Repository for canonical session records plus transcript metadata.
///
/// A session always exists once created; transcript persistence is just a later
/// lifecycle step for that same session.
pub struct SessionMetadataRepository;

impl SessionMetadataRepository {
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

    fn reserved_worktree_launch_file_path(launch_token: &str) -> String {
        format!("__worktree__/prepared/{launch_token}")
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

        let max_seq = match (max_state_seq, max_metadata_seq) {
            (Some(state), Some(metadata)) => Some(state.max(metadata)),
            (Some(state), None) => Some(state),
            (None, Some(metadata)) => Some(metadata),
            (None, None) => None,
        };

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

    fn provider_session_id_for_existing_model(
        existing_model: &session_metadata::Model,
        incoming_agent_id: &str,
        incoming_session_id: &str,
    ) -> Option<String> {
        backend_identity_policy_for_provider_id(incoming_agent_id)
            .provider_session_id_for_existing_session(
                &existing_model.id,
                incoming_session_id,
                existing_model.provider_session_id.as_deref(),
            )
    }

    fn query_existing_session_by_id_or_provider_session_id(session_id: &str) -> Condition {
        Condition::any()
            .add(session_metadata::Column::Id.eq(session_id))
            .add(session_metadata::Column::ProviderSessionId.eq(session_id))
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
                provider_session_id: Set(None),
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
            let now = Utc::now();
            let launch_token = Uuid::new_v4().to_string();
            let next_sequence_id = Self::next_sequence_id_for_project(&txn, project_path).await?;

            let metadata = session_metadata::ActiveModel {
                id: Set(launch_token.clone()),
                display: Set(format!("Prepared worktree launch s{next_sequence_id}")),
                timestamp: Set(now.timestamp_millis()),
                project_path: Set(project_path.to_string()),
                agent_id: Set(agent_id.to_string()),
                file_path: Set(Self::reserved_worktree_launch_file_path(&launch_token)),
                file_mtime: Set(0),
                file_size: Set(0),
                provider_session_id: Set(None),
                worktree_path: Set(None),
                pr_number: sea_orm::ActiveValue::NotSet,
                is_acepe_managed: Set(1),
                sequence_id: Set(Some(next_sequence_id)),
                created_at: Set(now),
                updated_at: Set(now),
            };

            match SessionMetadata::insert(metadata).exec(&txn).await {
                Ok(_) => {
                    let state = acepe_session_state::ActiveModel {
                        session_id: Set(launch_token.clone()),
                        relationship: Set(AcepeSessionRelationship::Reserved.as_str().to_string()),
                        project_path: Set(project_path.to_string()),
                        title_override: Set(None),
                        worktree_path: Set(None),
                        pr_number: Set(None),
                        sequence_id: Set(Some(next_sequence_id)),
                        created_at: Set(now),
                        updated_at: Set(now),
                    };
                    state.insert(&txn).await?;
                    txn.commit().await?;
                    return Ok(ReservedWorktreeLaunchRow {
                        launch_token,
                        project_path: project_path.to_string(),
                        worktree_path: None,
                        sequence_id: next_sequence_id,
                    });
                }
                Err(error) => {
                    if Self::is_sequence_constraint_violation(&error) {
                        continue;
                    }
                    return Err(error.into());
                }
            }
        }

        anyhow::bail!("Failed to reserve a unique sequence_id after retries");
    }

    pub async fn attach_reserved_worktree_launch(
        db: &DbConn,
        launch_token: &str,
        worktree_path: &str,
    ) -> Result<ReservedWorktreeLaunchRow> {
        let txn = db.begin().await?;
        let metadata = SessionMetadata::find_by_id(launch_token)
            .one(&txn)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Prepared worktree launch not found"))?;
        let project_path = metadata.project_path.clone();
        let sequence_id = metadata.sequence_id.unwrap_or_default();
        let state = AcepeSessionState::find_by_id(launch_token)
            .one(&txn)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Prepared worktree launch state not found"))?;

        if AcepeSessionRelationship::from_str(&state.relationship)
            != AcepeSessionRelationship::Reserved
        {
            anyhow::bail!("Prepared worktree launch has already been consumed");
        }

        let mut metadata_active: session_metadata::ActiveModel = metadata.into();
        metadata_active.worktree_path = Set(Some(worktree_path.to_string()));
        metadata_active.updated_at = Set(Utc::now());
        metadata_active.update(&txn).await?;

        let mut state_active: acepe_session_state::ActiveModel = state.into();
        state_active.worktree_path = Set(Some(worktree_path.to_string()));
        state_active.updated_at = Set(Utc::now());
        state_active.update(&txn).await?;

        txn.commit().await?;

        Ok(ReservedWorktreeLaunchRow {
            launch_token: launch_token.to_string(),
            project_path,
            worktree_path: Some(worktree_path.to_string()),
            sequence_id,
        })
    }

    pub async fn discard_reserved_worktree_launch(db: &DbConn, launch_token: &str) -> Result<()> {
        let txn = db.begin().await?;
        if let Some(state) = AcepeSessionState::find_by_id(launch_token)
            .one(&txn)
            .await?
        {
            if AcepeSessionRelationship::from_str(&state.relationship)
                == AcepeSessionRelationship::Reserved
            {
                AcepeSessionState::delete_by_id(launch_token)
                    .exec(&txn)
                    .await?;
                SessionMetadata::delete_by_id(launch_token)
                    .exec(&txn)
                    .await?;
            }
        }
        txn.commit().await?;
        Ok(())
    }

    pub async fn consume_reserved_worktree_launch(
        db: &DbConn,
        launch_token: &str,
        session_id: &str,
        agent_id: &str,
    ) -> Result<Option<i32>> {
        let txn = db.begin().await?;
        let _metadata = SessionMetadata::find_by_id(launch_token)
            .one(&txn)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Prepared worktree launch not found"))?;
        let state = AcepeSessionState::find_by_id(launch_token)
            .one(&txn)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Prepared worktree launch state not found"))?;

        if AcepeSessionRelationship::from_str(&state.relationship)
            != AcepeSessionRelationship::Reserved
        {
            anyhow::bail!("Prepared worktree launch has already been consumed");
        }

        let backend = DbBackend::Sqlite;
        let now = Utc::now();
        let preview_len = 8usize.min(session_id.len());
        let display = format!("Session {}", &session_id[..preview_len]);

        let metadata_result = txn
            .execute(Statement::from_sql_and_values(
            backend,
            "UPDATE session_metadata SET id = ?, display = ?, agent_id = ?, file_path = ?, updated_at = ? WHERE id = ?",
            [
                session_id.into(),
                display.into(),
                agent_id.into(),
                Self::created_session_file_path(session_id).into(),
                now.into(),
                launch_token.into(),
            ],
        ))
            .await?;
        if metadata_result.rows_affected() != 1 {
            anyhow::bail!("Prepared worktree launch was already consumed");
        }

        let state_result = txn
            .execute(Statement::from_sql_and_values(
            backend,
            "UPDATE acepe_session_state SET session_id = ?, relationship = ?, updated_at = ? WHERE session_id = ?",
            [
                session_id.into(),
                AcepeSessionRelationship::Created.as_str().into(),
                now.into(),
                launch_token.into(),
            ],
        ))
            .await?;
        if state_result.rows_affected() != 1 {
            anyhow::bail!("Prepared worktree launch state was already consumed");
        }
        txn.commit().await?;
        Ok(state.sequence_id)
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

            let assigned_sequence_id = if let Some(existing_sequence_id) = latest_model.sequence_id {
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

    /// Get startup sessions for specific session IDs.
    ///
    /// Matches against both canonical app session IDs and provider session IDs so restored
    /// panels can hydrate without a broad project scan.
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
            .filter(
                Condition::any()
                    .add(session_metadata::Column::Id.is_in(session_ids.to_vec()))
                    .add(session_metadata::Column::ProviderSessionId.is_in(session_ids.to_vec())),
            )
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
            .filter(Self::query_existing_session_by_id_or_provider_session_id(
                &session_id,
            ))
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
            let provider_session_id = Self::provider_session_id_for_existing_model(
                &existing_model,
                &agent_id,
                &session_id,
            );
            let mut active: session_metadata::ActiveModel = existing_model.into();
            active.display = Set(display);
            active.timestamp = Set(timestamp);
            active.project_path = Set(project_path);
            active.agent_id = Set(agent_id);
            active.file_path = Set(file_path);
            active.file_mtime = Set(file_mtime);
            active.file_size = Set(file_size);
            active.provider_session_id = Set(provider_session_id);
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
                provider_session_id: Set(None),
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
            .filter(
                Condition::any()
                    .add(session_metadata::Column::Id.is_in(session_ids.clone()))
                    .add(session_metadata::Column::ProviderSessionId.is_in(session_ids.clone())),
            )
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
            if let Some(provider_session_id) = model.provider_session_id.clone() {
                existing_map.insert(provider_session_id, model.clone());
            }
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
                active.provider_session_id = Set(Self::provider_session_id_for_existing_model(
                    existing_model,
                    active.agent_id.as_ref(),
                    &session_id,
                ));
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
                    provider_session_id: Set(None),
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
                provider_session_id: Set(None),
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
        let Some(model) = model else {
            return Ok(());
        };

        let normalized_provider_session_id =
            backend_identity_policy_for_provider_id(&model.agent_id)
                .normalize_provider_session_id(session_id, provider_session_id);

        if model.provider_session_id == normalized_provider_session_id {
            return Ok(());
        }

        let mut active: session_metadata::ActiveModel = model.into();
        active.provider_session_id = Set(normalized_provider_session_id);
        active.updated_at = Set(Utc::now());
        active.update(db).await?;

        tracing::info!(
            session_id = %session_id,
            provider_session_id = %provider_session_id,
            "Provider session ID set"
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
            .all(db)
            .await?;

        let ids_to_delete: Vec<String> = candidates
            .into_iter()
            .filter(|model| {
                !live_session_ids.contains(&model.id)
                    && model
                        .provider_session_id
                        .as_ref()
                        .is_none_or(|provider_session_id| {
                            !live_session_ids.contains(provider_session_id)
                        })
            })
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
            .map(|model| {
                (
                    model
                        .provider_session_id
                        .unwrap_or_else(|| model.id.clone()),
                    model.file_path,
                    model.file_mtime,
                    model.file_size,
                )
            })
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
    ) -> Result<()> {
        tracing::debug!(session_id = %session_id, pr_number = ?pr_number, "Setting PR number");

        if let Some(model) = SessionMetadata::find_by_id(session_id).one(db).await? {
            let now = Utc::now();
            let mut active: session_metadata::ActiveModel = model.into();
            active.pr_number = Set(pr_number);
            active.updated_at = Set(now);
            active.update(db).await?;
            if let Some(existing_state) = AcepeSessionState::find_by_id(session_id).one(db).await? {
                let mut state_active: acepe_session_state::ActiveModel = existing_state.into();
                state_active.pr_number = Set(pr_number);
                state_active.updated_at = Set(now);
                state_active.update(db).await?;
            }
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
