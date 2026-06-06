//! Settings and app-settings repositories.
//! Extracted verbatim from the former db/repository.rs monolith.

use crate::db::entities::prelude::*;
use anyhow::Result;
use chrono::Utc;
use sea_orm::{
    sea_query::OnConflict, ActiveModelTrait, ColumnTrait, DbConn, EntityTrait, QueryFilter,
    QuerySelect, Set,
};
use uuid::Uuid;

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

        let active = crate::db::entities::app_setting::ActiveModel {
            key: Set(key.to_string()),
            value: Set(value.to_string()),
        };
        AppSetting::insert(active)
            .on_conflict(
                OnConflict::column(crate::db::entities::app_setting::Column::Key)
                    .update_column(crate::db::entities::app_setting::Column::Value)
                    .to_owned(),
            )
            .exec(db)
            .await?;
        tracing::info!(key = %key, "App setting saved");

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
