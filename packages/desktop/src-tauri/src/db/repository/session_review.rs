//! Session review-state repository.
//! Extracted verbatim from the former db/repository.rs monolith.

use crate::db::entities::prelude::*;
use anyhow::Result;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, DbConn, EntityTrait, Set};

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
