use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "sql_query_history")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub connection_id: String,
    pub sql_text: String,
    pub executed_at: i64,
    pub duration_ms: i64,
    pub row_count: i64,
    pub status: String,
    pub error_summary: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::sql_connection::Entity",
        from = "Column::ConnectionId",
        to = "super::sql_connection::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Connection,
}

impl Related<super::sql_connection::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Connection.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
