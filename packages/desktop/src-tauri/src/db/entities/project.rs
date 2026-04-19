use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "projects")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[sea_orm(unique)]
    pub path: String,
    pub name: String,
    pub last_opened: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub color: String,
    pub sort_order: i32,
    pub icon_path: Option<String>,
    pub show_external_cli_sessions: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
