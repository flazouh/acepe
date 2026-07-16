use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "session_transcript_row")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,

    #[sea_orm(primary_key, auto_increment = false)]
    pub scope_key: String,

    #[sea_orm(primary_key, auto_increment = false)]
    pub row_index: i64,

    pub row_id: String,
    pub source_entry_id: Option<String>,
    pub row_kind: String,
    pub row_version: String,
    pub transcript_revision: i64,
    pub graph_revision: i64,
    pub projection_version: String,
    pub row_json: String,
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
