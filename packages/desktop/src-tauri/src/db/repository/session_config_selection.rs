//! Per-session config-option selection repository.
//!
//! Persists a user's chosen value for a session config option keyed by
//! `(session_id, config_id)` so it can be restored when the session reopens.
//! Agent-agnostic: any provider's config option id can be stored here.

use crate::db::entities::prelude::*;
use crate::db::entities::session_config_selection;
use anyhow::Result;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, DbConn, EntityTrait, QueryFilter, Set};

pub struct SessionConfigSelectionRepository;

impl SessionConfigSelectionRepository {
    /// Load all persisted `(config_id, value)` selections for a session.
    pub async fn get_all(db: &DbConn, session_id: &str) -> Result<Vec<(String, String)>> {
        let rows = SessionConfigSelection::find()
            .filter(SessionConfigSelectionColumn::SessionId.eq(session_id))
            .all(db)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.config_id, row.value))
            .collect())
    }

    /// Upsert the selected value for `(session_id, config_id)`.
    pub async fn set(db: &DbConn, session_id: &str, config_id: &str, value: &str) -> Result<()> {
        let now = Utc::now();
        let existing =
            SessionConfigSelection::find_by_id((session_id.to_string(), config_id.to_string()))
                .one(db)
                .await?;

        if let Some(existing_model) = existing {
            let mut active: session_config_selection::ActiveModel = existing_model.into();
            active.value = Set(value.to_string());
            active.updated_at = Set(now);
            active.update(db).await?;
        } else {
            let active = session_config_selection::ActiveModel {
                session_id: Set(session_id.to_string()),
                config_id: Set(config_id.to_string()),
                value: Set(value.to_string()),
                created_at: Set(now),
                updated_at: Set(now),
            };
            SessionConfigSelection::insert(active).exec(db).await?;
        }

        Ok(())
    }

    /// Remove the persisted selection for `(session_id, config_id)`.
    ///
    /// Used when a selection is reset to a provider's default/auto value, so the
    /// provider default re-applies on the next session open.
    pub async fn clear(db: &DbConn, session_id: &str, config_id: &str) -> Result<()> {
        SessionConfigSelection::delete_by_id((session_id.to_string(), config_id.to_string()))
            .exec(db)
            .await?;
        Ok(())
    }
}
