//! File snapshot entity for storing file content at checkpoints.
//!
//! Each snapshot stores the full content of a file at a specific checkpoint,
//! enabling precise file restoration.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "file_snapshots")]
pub struct Model {
    /// Snapshot ID (UUID format)
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,

    /// Checkpoint this snapshot belongs to
    pub checkpoint_id: String,

    /// Relative file path from project root
    pub file_path: String,

    /// SHA-256 hash for content deduplication
    pub content_hash: String,

    /// Full file content
    #[sea_orm(column_type = "Text")]
    pub content: String,

    /// File size in bytes
    pub file_size: i64,

    /// Lines added compared to previous checkpoint (nullable for old data)
    pub lines_added: Option<i32>,

    /// Lines removed compared to previous checkpoint (nullable for old data)
    pub lines_removed: Option<i32>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::checkpoint::Entity",
        from = "Column::CheckpointId",
        to = "super::checkpoint::Column::Id"
    )]
    Checkpoint,
}

impl Related<super::checkpoint::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Checkpoint.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
