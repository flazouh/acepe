use sea_orm::DbConn;
use tauri::State;

use crate::commands::observability::{
    expected_command_result, unexpected_command_result, CommandResult, SerializableCommandError,
};
use crate::db::repository::SqlStudioRepository;

use super::super::types::{
    ConnectionKind, DbEngine, SqlConnectionConfig, SqlConnectionSummary, TestConnectionResponse,
};
use super::helpers::*;

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_list_connections(
    db: State<'_, DbConn>,
) -> CommandResult<Vec<SqlConnectionSummary>> {
    unexpected_command_result(
        "sql_studio_list_connections",
        "Failed to list SQL connections",
        SqlStudioRepository::list_connections(&db)
            .await
            .map(|connections| {
                connections
                    .into_iter()
                    .filter_map(connection_summary_from_row)
                    .collect()
            })
            .map_err(|e| format!("Failed to list SQL connections: {}", e)),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_get_connection(
    db: State<'_, DbConn>,
    id: String,
) -> CommandResult<SqlConnectionConfig> {
    let row = unexpected_command_result(
        "sql_studio_get_connection",
        "Failed to get SQL connection",
        SqlStudioRepository::get_connection(&db, &id)
            .await
            .map_err(|e| format!("Failed to load SQL connection: {}", e)),
    )?
    .ok_or_else(|| {
        SerializableCommandError::expected(
            "sql_studio_get_connection",
            format!("Connection not found: {}", id),
        )
    })?;

    unexpected_command_result(
        "sql_studio_get_connection",
        "Failed to get SQL connection",
        (|| {
            let engine = DbEngine::from_db_value(&row.engine)
                .ok_or_else(|| format!("Unsupported engine stored in database: {}", row.engine))?;
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
            })
        })(),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_save_connection(
    db: State<'_, DbConn>,
    input: SqlConnectionConfig,
) -> CommandResult<SqlConnectionSummary> {
    unexpected_command_result(
        "sql_studio_save_connection",
        "Failed to save SQL connection",
        async {
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
                ConnectionKind::Sql => {
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

            SqlStudioRepository::save_connection(
                &db,
                input.id,
                input.name,
                input.engine.as_str().to_string(),
                "sql".to_string(),
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
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_delete_connection(db: State<'_, DbConn>, id: String) -> CommandResult<()> {
    unexpected_command_result(
        "sql_studio_delete_connection",
        "Failed to delete SQL connection",
        SqlStudioRepository::delete_connection(&db, &id)
            .await
            .map_err(|e| format!("Failed to delete SQL connection: {}", e)),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_test_connection(
    db: State<'_, DbConn>,
    id: String,
) -> CommandResult<TestConnectionResponse> {
    let connection = unexpected_command_result(
        "sql_studio_test_connection",
        "Failed to load SQL connection",
        SqlStudioRepository::get_connection(&db, &id)
            .await
            .map_err(|e| format!("Failed to load SQL connection: {}", e)),
    )?
    .ok_or_else(|| {
        SerializableCommandError::expected(
            "sql_studio_test_connection",
            format!("Connection not found: {}", id),
        )
    })?;

    expected_command_result(
        "sql_studio_test_connection",
        test_connection_row(&connection).await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_pick_sqlite_file() -> CommandResult<Option<String>> {
    unexpected_command_result(
        "sql_studio_pick_sqlite_file",
        "Failed to pick SQLite file",
        async {
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
        .await,
    )
}
