//! Skill sync history entity.
//!
//! Tracks what has been deployed to each agent.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "skill_sync_history")]
pub struct Model {
    /// Skill ID (foreign key to skills table)
    #[sea_orm(primary_key, auto_increment = false)]
    pub skill_id: String,

    /// Agent ID (e.g., "claude-code", "cursor", "codex")
    #[sea_orm(primary_key, auto_increment = false)]
    pub agent_id: String,

    /// Unix timestamp when last synced (milliseconds)
    pub synced_at: i64,

    /// Hash of content at time of sync (for change detection)
    pub content_hash: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::skill::Entity",
        from = "Column::SkillId",
        to = "super::skill::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Skill,
}

impl Related<super::skill::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Skill.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
