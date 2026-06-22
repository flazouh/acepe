//! Acepe-owned per-session config-option selections.
//!
//! Stores a user's chosen value for a session config option (e.g. reasoning
//! effort) keyed by `(session_id, config_id)`, so the selection can be restored
//! when the session is reopened. Agent-agnostic: any provider that emits config
//! options and implements the setter participates.

use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "session_config_selection")]
pub struct Model {
    /// Session ID (part of composite PK, matches session_metadata.id).
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,

    /// Canonical config option id (part of composite PK).
    #[sea_orm(primary_key, auto_increment = false)]
    pub config_id: String,

    /// Selected value for the option.
    pub value: String,

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
