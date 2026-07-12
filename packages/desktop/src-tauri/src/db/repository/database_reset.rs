//! Database reset repository.
//! Extracted verbatim from the former db/repository.rs monolith.

use crate::db::entities::prelude::*;
use anyhow::Result;
use sea_orm::{DbConn, EntityTrait};

// ============================================================================
// Database Reset Repository
// ============================================================================

pub struct DatabaseResetRepository;

impl DatabaseResetRepository {
    /// Reset all data in the database by deleting all records from all tables.
    /// This operation cannot be undone.
    pub async fn reset_all_data(db: &DbConn) -> Result<()> {
        tracing::debug!("Resetting all database data");

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

        let total_deleted = sync_history_deleted.rows_affected
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
            sync_targets = %sync_targets_deleted.rows_affected,
            sync_history = %sync_history_deleted.rows_affected,
            "Database reset complete - all data deleted"
        );

        Ok(())
    }
}
