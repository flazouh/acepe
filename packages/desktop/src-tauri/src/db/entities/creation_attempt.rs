//! Pre-session creation attempts.
//!
//! Tracks user intent before a provider-owned canonical session id is known.

use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "creation_attempts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
