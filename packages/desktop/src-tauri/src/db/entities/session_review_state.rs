//! Session review state entity.
//!
//! Stores persisted per-session review progress JSON for modified-files review UI.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "session_review_state")]
pub struct Model {
    /// Session ID (primary key, matches session_metadata.id)
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,

    /// JSON payload containing per-file review progress keyed by revision
    pub state_json: String,

    /// Unix timestamp in milliseconds
    pub created_at: i64,

    /// Unix timestamp in milliseconds
    pub updated_at: i64,
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
