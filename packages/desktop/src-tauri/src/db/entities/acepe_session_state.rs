//! Acepe-owned per-session state.
//!
//! Separates local relationship/overlay data from transcript-derived session metadata.

use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "acepe_session_state")]
pub struct Model {
    /// Session ID (primary key, matches session_metadata.id)
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,

    /// Acepe's relationship to the session: discovered, opened, or created.
    pub relationship: String,

    /// Project scope used for Acepe-local numbering.
    pub project_path: String,

    /// Optional user-specified title override.
    pub title_override: Option<String>,

    /// Optional worktree path known by Acepe.
    pub worktree_path: Option<String>,

    /// Optional PR number tracked by Acepe.
    pub pr_number: Option<i32>,

    /// Ownership mode for the linked PR.
    pub pr_link_mode: Option<String>,

    /// Per-project sequence ID for Acepe-tracked sessions.
    pub sequence_id: Option<i32>,

    /// Record creation timestamp.
    pub created_at: DateTime<Utc>,

    /// Record update timestamp.
    pub updated_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::session_metadata::Entity",
        from = "Column::SessionId",
        to = "super::session_metadata::Column::Id"
    )]
    Session,
}

impl Related<super::session_metadata::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Session.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
