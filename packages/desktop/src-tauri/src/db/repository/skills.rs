//! Skills repository and skill row types.
//! Extracted verbatim from the former db/repository.rs monolith.

use crate::db::entities::prelude::*;
use anyhow::Result;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbConn, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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

