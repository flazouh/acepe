//! Skill entity for unified skills library.
//!
//! This table is the source of truth for all skill content.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "skills")]
pub struct Model {
    /// Skill ID (UUID format)
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,

    /// Skill name (from frontmatter)
    pub name: String,

    /// Skill description (from frontmatter)
    pub description: Option<String>,

    /// Full SKILL.md content
    #[sea_orm(column_type = "Text")]
    pub content: String,

    /// Optional category for organization
    pub category: Option<String>,

    /// Unix timestamp (milliseconds)
    pub created_at: i64,

    /// Unix timestamp (milliseconds)
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::skill_sync_target::Entity")]
    SyncTargets,

    #[sea_orm(has_many = "super::skill_sync_history::Entity")]
    SyncHistory,
}

impl Related<super::skill_sync_target::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::SyncTargets.def()
    }
}

impl Related<super::skill_sync_history::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::SyncHistory.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
