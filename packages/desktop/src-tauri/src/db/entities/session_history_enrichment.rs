use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "session_history_enrichment")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,
    pub total_messages: i64,
    pub user_messages: i64,
    pub assistant_messages: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub source_mtime: i64,
    pub source_size: i64,
    pub schema_version: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::session_metadata::Entity",
        from = "Column::SessionId",
        to = "super::session_metadata::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    SessionMetadata,
}

impl Related<super::session_metadata::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::SessionMetadata.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
