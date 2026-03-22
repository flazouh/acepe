use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "sql_connections")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub engine: String,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub database_name: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub file_path: Option<String>,
    pub ssl_mode: Option<String>,
    pub connection_kind: String,
    pub config_json: Option<String>,
    pub secret_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::sql_query_history::Entity")]
    QueryHistory,
}

impl Related<super::sql_query_history::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::QueryHistory.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
