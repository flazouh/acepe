use sea_orm::DbConn;
use tauri::State;

use crate::db::repository::SqlStudioRepository;

use super::super::types::{ConnectionKind, DbEngine, SqlConnectionConfig, SqlConnectionSummary};
use super::helpers::*;

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_list_connections(
    db: State<'_, DbConn>,
) -> Result<Vec<SqlConnectionSummary>, String> {
    SqlStudioRepository::list_connections(&db)
        .await
        .map(|connections| {
            connections
                .into_iter()
                .filter_map(connection_summary_from_row)
                .collect()
        })
        .map_err(|e| format!("Failed to list SQL connections: {}", e))
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_get_connection(
    db: State<'_, DbConn>,
    id: String,
) -> Result<SqlConnectionConfig, String> {
    SqlStudioRepository::get_connection(&db, &id)
        .await
        .map_err(|e| format!("Failed to load SQL connection: {}", e))?
        .ok_or_else(|| format!("Connection not found: {}", id))
        .and_then(|row| {
            let engine = DbEngine::from_db_value(&row.engine)
                .ok_or_else(|| format!("Unsupported engine stored in database: {}", row.engine))?;
            let connection_kind = match row.connection_kind.as_str() {
                "s3" => ConnectionKind::S3,
                _ => ConnectionKind::Sql,
            };

            if matches!(connection_kind, ConnectionKind::S3) {
                let s3_config = parse_s3_stored_config(&row)?;
                let s3_secrets = parse_s3_stored_secrets(&row)?;
                return Ok(SqlConnectionConfig {
                    kind: ConnectionKind::S3,
                    id: Some(row.id),
                    name: row.name,
                    engine,
                    host: None,
                    port: None,
                    database_name: None,
                    username: None,
                    password: None,
                    file_path: None,
                    ssl_mode: None,
                    s3_region: Some(s3_config.region),
                    s3_endpoint_url: s3_config.endpoint_url,
                    s3_force_path_style: Some(s3_config.force_path_style),
                    s3_default_prefix: s3_config.default_prefix,
                    s3_access_key_id: Some(s3_secrets.access_key_id),
                    s3_secret_access_key: Some(s3_secrets.secret_access_key),
                    s3_session_token: s3_secrets.session_token,
                });
            }

            let sql_config = parse_sql_stored_config(&row)?;
            Ok(SqlConnectionConfig {
                kind: ConnectionKind::Sql,
                id: Some(row.id),
                name: row.name,
                engine,
                host: sql_config.host,
                port: sql_config.port,
                database_name: sql_config.database_name,
                username: sql_config.username,
                password: None,
                file_path: sql_config.file_path,
                ssl_mode: sql_config.ssl_mode,
                s3_region: None,
                s3_endpoint_url: None,
                s3_force_path_style: None,
                s3_default_prefix: None,
                s3_access_key_id: None,
                s3_secret_access_key: None,
                s3_session_token: None,
            })
        })
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_save_connection(
    db: State<'_, DbConn>,
    input: SqlConnectionConfig,
) -> Result<SqlConnectionSummary, String> {
    let (
        host,
        port,
        database_name,
        username,
        password,
        file_path,
        ssl_mode,
        config_json,
        secret_json,
    ) = match input.kind {
        ConnectionKind::S3 => {
            if input.engine.as_str() != "s3" {
                return Err("S3 connections must use engine 's3'".to_string());
            }
            let s3_config = S3ConnectionStoredConfig {
                region: require_field(&input.s3_region, "s3Region")?,
                endpoint_url: input
                    .s3_endpoint_url
                    .clone()
                    .filter(|value| !value.trim().is_empty()),
                force_path_style: input.s3_force_path_style.unwrap_or(false),
                default_prefix: input
                    .s3_default_prefix
                    .clone()
                    .filter(|value| !value.trim().is_empty()),
            };
            let s3_secret = S3ConnectionStoredSecrets {
                access_key_id: require_field(&input.s3_access_key_id, "s3AccessKeyId")?,
                secret_access_key: require_field(&input.s3_secret_access_key, "s3SecretAccessKey")?,
                session_token: input
                    .s3_session_token
                    .clone()
                    .filter(|value| !value.trim().is_empty()),
            };
            let serialized_config = serde_json::to_string(&s3_config)
                .map_err(|e| format!("Failed to encode S3 connection config: {}", e))?;
            let serialized_secret = serde_json::to_string(&s3_secret)
                .map_err(|e| format!("Failed to encode S3 connection secret: {}", e))?;
            (
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(serialized_config),
                Some(obfuscate_password(&serialized_secret)),
            )
        }
        ConnectionKind::Sql => {
            if input.engine.as_str() == "s3" {
                return Err("SQL connections cannot use engine 's3'".to_string());
            }
            let sql_config = SqlConnectionStoredConfig {
                host: input.host.clone(),
                port: input.port,
                database_name: input.database_name.clone(),
                username: input.username.clone(),
                file_path: input.file_path.clone(),
                ssl_mode: input.ssl_mode.clone(),
            };
            let normalized_password = input
                .password
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let sql_secret = SqlConnectionStoredSecrets {
                password: normalized_password.clone(),
            };
            let serialized_config = serde_json::to_string(&sql_config)
                .map_err(|e| format!("Failed to encode SQL connection config: {}", e))?;
            let serialized_secret = serde_json::to_string(&sql_secret)
                .map_err(|e| format!("Failed to encode SQL connection secret: {}", e))?;
            (
                input.host.clone(),
                input.port,
                input.database_name.clone(),
                input.username.clone(),
                normalized_password.map(|value| obfuscate_password(&value)),
                input.file_path.clone(),
                input.ssl_mode.clone(),
                Some(serialized_config),
                Some(obfuscate_password(&serialized_secret)),
            )
        }
    };

    let normalized_connection_kind = match input.kind {
        ConnectionKind::S3 => "s3".to_string(),
        ConnectionKind::Sql => "sql".to_string(),
    };

    SqlStudioRepository::save_connection(
        &db,
        input.id,
        input.name,
        input.engine.as_str().to_string(),
        normalized_connection_kind,
        host,
        port,
        database_name,
        username,
        password,
        file_path,
        ssl_mode,
        config_json,
        secret_json,
    )
    .await
    .map(|row| {
        connection_summary_from_row(row).unwrap_or_else(|| SqlConnectionSummary {
            id: String::new(),
            name: String::new(),
            engine: DbEngine::Sqlite,
            subtitle: String::new(),
        })
    })
    .map_err(|e| format!("Failed to save SQL connection: {}", e))
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_delete_connection(db: State<'_, DbConn>, id: String) -> Result<(), String> {
    SqlStudioRepository::delete_connection(&db, &id)
        .await
        .map_err(|e| format!("Failed to delete SQL connection: {}", e))
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_pick_sqlite_file() -> Result<Option<String>, String> {
    use rfd::AsyncFileDialog;

    let file = AsyncFileDialog::new()
        .set_title("Select SQLite Database")
        .add_filter("SQLite", &["db", "db3", "sqlite", "sqlite3"])
        .pick_file()
        .await;

    match file {
        Some(file_path) => Ok(Some(file_path.path().to_string_lossy().to_string())),
        None => Ok(None),
    }
}
