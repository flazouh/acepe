use crate::commands::observability::{
    expected_command_result, unexpected_command_result, CommandResult,
};
use crate::db::repository::SqlConnectionRow;

use super::super::super::types::{ConnectionKind, SqlConnectionConfig, TestConnectionResponse};
use super::super::helpers::{
    obfuscate_password, test_connection_row, SqlConnectionStoredConfig, SqlConnectionStoredSecrets,
};

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_test_connection_input(
    config: SqlConnectionConfig,
) -> CommandResult<TestConnectionResponse> {
    let row = unexpected_command_result(
        "sql_studio_test_connection_input",
        "Failed to test SQL connection",
        async {
            let (
                connection_kind,
                host,
                port,
                database_name,
                username,
                password,
                file_path,
                ssl_mode,
                config_json,
                secret_json,
            ) = match config.kind {
                ConnectionKind::Sql => {
                    let sql_config = SqlConnectionStoredConfig {
                        host: config.host.clone(),
                        port: config.port,
                        database_name: config.database_name.clone(),
                        username: config.username.clone(),
                        file_path: config.file_path.clone(),
                        ssl_mode: config.ssl_mode.clone(),
                    };
                    let normalized_password = config
                        .password
                        .as_ref()
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty());
                    let sql_secret = SqlConnectionStoredSecrets {
                        password: normalized_password.clone(),
                    };
                    (
                        "sql".to_string(),
                        config.host.clone(),
                        config.port,
                        config.database_name.clone(),
                        config.username.clone(),
                        normalized_password.map(|value| obfuscate_password(&value)),
                        config.file_path.clone(),
                        config.ssl_mode.clone(),
                        Some(
                            serde_json::to_string(&sql_config)
                                .map_err(|e| format!("Failed to encode SQL test config: {}", e))?,
                        ),
                        Some(obfuscate_password(
                            &serde_json::to_string(&sql_secret)
                                .map_err(|e| format!("Failed to encode SQL test secret: {}", e))?,
                        )),
                    )
                }
            };

            let row = SqlConnectionRow {
                id: String::new(),
                name: config.name,
                engine: config.engine.as_str().to_string(),
                connection_kind,
                host,
                port,
                database_name,
                username,
                password,
                file_path,
                ssl_mode,
                config_json,
                secret_json,
                created_at: 0,
                updated_at: 0,
            };

            Ok(row)
        }
        .await,
    )?;

    expected_command_result(
        "sql_studio_test_connection_input",
        test_connection_row(&row).await,
    )
}
