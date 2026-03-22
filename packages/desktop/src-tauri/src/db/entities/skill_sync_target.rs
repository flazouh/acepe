//! Skill sync target entity.
//!
//! Tracks which agents each skill should sync to.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "skill_sync_targets")]
pub struct Model {
    /// Skill ID (foreign key to skills table)
    #[sea_orm(primary_key, auto_increment = false)]
    pub skill_id: String,

    /// Agent ID (e.g., "claude-code", "cursor", "codex")
    #[sea_orm(primary_key, auto_increment = false)]
    pub agent_id: String,

    /// Whether sync is enabled (1 = enabled, 0 = disabled)
    pub enabled: i32,
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
