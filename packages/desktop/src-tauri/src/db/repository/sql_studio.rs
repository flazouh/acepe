//! SQL Studio repository.
//! Extracted verbatim from the former db/repository.rs monolith.

use crate::db::entities::prelude::*;
use anyhow::Result;
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, DbConn, EntityTrait, QueryOrder,
    Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ============================================================================
// SQL Studio Repository
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlConnectionRow {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub connection_kind: String,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub database_name: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub file_path: Option<String>,
    pub ssl_mode: Option<String>,
    pub config_json: Option<String>,
    pub secret_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlQueryHistoryRow {
    pub id: String,
    pub connection_id: String,
    pub sql_text: String,
    pub executed_at: i64,
    pub duration_ms: i64,
    pub row_count: i64,
    pub status: String,
    pub error_summary: Option<String>,
}

pub struct SqlStudioRepository;

impl SqlStudioRepository {
    pub async fn list_connections(db: &DbConn) -> Result<Vec<SqlConnectionRow>> {
        let models = SqlConnection::find()
            .order_by_asc(crate::db::entities::sql_connection::Column::Name)
            .all(db)
            .await?;

        Ok(models
            .into_iter()
            .map(Self::connection_model_to_row)
            .collect())
    }

    pub async fn get_connection(db: &DbConn, id: &str) -> Result<Option<SqlConnectionRow>> {
        let model = SqlConnection::find_by_id(id).one(db).await?;
        Ok(model.map(Self::connection_model_to_row))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn save_connection(
        db: &DbConn,
        id: Option<String>,
        name: String,
        engine: String,
        connection_kind: String,
        host: Option<String>,
        port: Option<i32>,
        database_name: Option<String>,
        username: Option<String>,
        password: Option<String>,
        file_path: Option<String>,
        ssl_mode: Option<String>,
        config_json: Option<String>,
        secret_json: Option<String>,
    ) -> Result<SqlConnectionRow> {
        let now = Utc::now().timestamp_millis();
        if let Some(existing_id) = id {
            let existing = SqlConnection::find_by_id(&existing_id).one(db).await?;
            if let Some(existing_model) = existing {
                let mut active: crate::db::entities::sql_connection::ActiveModel =
                    existing_model.into();
                active.name = Set(name);
                active.engine = Set(engine);
                active.connection_kind = Set(connection_kind);
                active.host = Set(host);
                active.port = Set(port);
                active.database_name = Set(database_name);
                active.username = Set(username);
                if password.is_some() {
                    active.password = Set(password);
                }
                active.file_path = Set(file_path);
                active.ssl_mode = Set(ssl_mode);
                active.config_json = Set(config_json);
                if secret_json.is_some() {
                    active.secret_json = Set(secret_json);
                }
                active.updated_at = Set(now);
                let updated = active.update(db).await?;
                return Ok(Self::connection_model_to_row(updated));
            }
        }

        let new_id = Uuid::new_v4().to_string();
        let active = crate::db::entities::sql_connection::ActiveModel {
            id: Set(new_id),
            name: Set(name),
            engine: Set(engine),
            connection_kind: Set(connection_kind),
            host: Set(host),
            port: Set(port),
            database_name: Set(database_name),
            username: Set(username),
            password: Set(password),
            file_path: Set(file_path),
            ssl_mode: Set(ssl_mode),
            config_json: Set(config_json),
            secret_json: Set(secret_json),
            created_at: Set(now),
            updated_at: Set(now),
        };

        let inserted = SqlConnection::insert(active)
            .exec_with_returning(db)
            .await?;
        Ok(Self::connection_model_to_row(inserted))
    }

    pub async fn delete_connection(db: &DbConn, id: &str) -> Result<()> {
        SqlConnection::delete_by_id(id).exec(db).await?;
        Ok(())
    }

    pub async fn insert_query_history(
        db: &DbConn,
        connection_id: String,
        sql_text: String,
        duration_ms: i64,
        row_count: i64,
        status: String,
        error_summary: Option<String>,
    ) -> Result<()> {
        let active = crate::db::entities::sql_query_history::ActiveModel {
            id: Set(Uuid::new_v4().to_string()),
            connection_id: Set(connection_id),
            sql_text: Set(sql_text),
            executed_at: Set(Utc::now().timestamp_millis()),
            duration_ms: Set(duration_ms),
            row_count: Set(row_count),
            status: Set(status),
            error_summary: Set(error_summary),
        };
        SqlQueryHistory::insert(active).exec(db).await?;
        Ok(())
    }

    fn connection_model_to_row(m: crate::db::entities::sql_connection::Model) -> SqlConnectionRow {
        SqlConnectionRow {
            id: m.id,
            name: m.name,
            engine: m.engine,
            connection_kind: m.connection_kind,
            host: m.host,
            port: m.port,
            database_name: m.database_name,
            username: m.username,
            password: m.password,
            file_path: m.file_path,
            ssl_mode: m.ssl_mode,
            config_json: m.config_json,
            secret_json: m.secret_json,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}
