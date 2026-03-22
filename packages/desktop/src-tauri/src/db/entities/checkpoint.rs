//! Checkpoint entity for point-in-time file snapshots.
//!
//! Checkpoints capture the state of modified files at specific points
//! during a session, enabling revert and rewind functionality.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "checkpoints")]
pub struct Model {
    /// Checkpoint ID (UUID format)
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,

    /// Session this checkpoint belongs to
    pub session_id: String,

    /// Ordinal checkpoint number within session (1, 2, 3...)
    pub checkpoint_number: i32,

    /// Optional user-provided or auto-generated name
    pub name: Option<String>,

    /// Unix timestamp (milliseconds)
    pub created_at: i64,

    /// Tool call ID that triggered this checkpoint (for auto-checkpoints)
    pub tool_call_id: Option<String>,

    /// 1 = auto-checkpoint, 0 = manual checkpoint
    pub is_auto: i32,
}

impl Model {
    /// Returns whether this is an auto-generated checkpoint
    pub fn is_auto_checkpoint(&self) -> bool {
        self.is_auto != 0
    }
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::file_snapshot::Entity")]
    FileSnapshots,

    #[sea_orm(
        belongs_to = "super::session_metadata::Entity",
        from = "Column::SessionId",
        to = "super::session_metadata::Column::Id"
    )]
    Session,
}

impl Related<super::file_snapshot::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::FileSnapshots.def()
    }
}

impl Related<super::session_metadata::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Session.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
