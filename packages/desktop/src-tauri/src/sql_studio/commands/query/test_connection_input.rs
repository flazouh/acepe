use crate::db::repository::SqlConnectionRow;

use super::super::super::types::{ConnectionKind, SqlConnectionConfig, TestConnectionResponse};
use super::super::helpers::{
    obfuscate_password, require_field, test_connection_row, S3ConnectionStoredConfig,
    S3ConnectionStoredSecrets, SqlConnectionStoredConfig, SqlConnectionStoredSecrets,
};

#[tauri::command]
#[specta::specta]
pub async fn sql_studio_test_connection_input(
    config: SqlConnectionConfig,
) -> Result<TestConnectionResponse, String> {
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
        ConnectionKind::S3 => {
            if config.engine.as_str() != "s3" {
                return Err("S3 connections must use engine 's3'".to_string());
            }
            let s3_config = S3ConnectionStoredConfig {
                region: require_field(&config.s3_region, "s3Region")?,
                endpoint_url: config
                    .s3_endpoint_url
                    .clone()
                    .filter(|value| !value.trim().is_empty()),
                force_path_style: config.s3_force_path_style.unwrap_or(false),
                default_prefix: config
                    .s3_default_prefix
                    .clone()
                    .filter(|value| !value.trim().is_empty()),
            };
            let s3_secret = S3ConnectionStoredSecrets {
                access_key_id: require_field(&config.s3_access_key_id, "s3AccessKeyId")?,
                secret_access_key: require_field(
                    &config.s3_secret_access_key,
                    "s3SecretAccessKey",
                )?,
                session_token: config
                    .s3_session_token
                    .clone()
                    .filter(|value| !value.trim().is_empty()),
            };
            (
                "s3".to_string(),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(
                    serde_json::to_string(&s3_config)
                        .map_err(|e| format!("Failed to encode S3 test config: {}", e))?,
                ),
                Some(obfuscate_password(
                    &serde_json::to_string(&s3_secret)
                        .map_err(|e| format!("Failed to encode S3 test secret: {}", e))?,
                )),
            )
        }
        ConnectionKind::Sql => {
            if config.engine.as_str() == "s3" {
                return Err("SQL connections cannot use engine 's3'".to_string());
            }
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

    test_connection_row(&row).await
}
