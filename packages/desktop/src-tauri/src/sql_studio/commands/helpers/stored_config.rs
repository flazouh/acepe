use crate::db::repository::SqlConnectionRow;

use super::super::super::types::{DbEngine, SqlConnectionSummary};
use super::crypto::reveal_password;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlConnectionStoredConfig {
    pub(crate) host: Option<String>,
    pub(crate) port: Option<i32>,
    pub(crate) database_name: Option<String>,
    pub(crate) username: Option<String>,
    pub(crate) file_path: Option<String>,
    pub(crate) ssl_mode: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqlConnectionStoredSecrets {
    pub(crate) password: Option<String>,
}

pub(crate) fn parse_sql_stored_config(
    row: &SqlConnectionRow,
) -> Result<SqlConnectionStoredConfig, String> {
    if let Some(config_json) = &row.config_json {
        return serde_json::from_str::<SqlConnectionStoredConfig>(config_json)
            .map_err(|e| format!("Failed to parse SQL connection config: {}", e));
    }

    Ok(SqlConnectionStoredConfig {
        host: row.host.clone(),
        port: row.port,
        database_name: row.database_name.clone(),
        username: row.username.clone(),
        file_path: row.file_path.clone(),
        ssl_mode: row.ssl_mode.clone(),
    })
}

pub(crate) fn parse_sql_stored_secrets(
    row: &SqlConnectionRow,
) -> Result<SqlConnectionStoredSecrets, String> {
    if let Some(secret_json) = &row.secret_json {
        let decrypted = reveal_password(secret_json)?;
        if let Ok(parsed) = serde_json::from_str::<SqlConnectionStoredSecrets>(&decrypted) {
            return Ok(parsed);
        }

        return Ok(SqlConnectionStoredSecrets {
            password: Some(decrypted),
        });
    }

    let password = row
        .password
        .as_ref()
        .map(|token| reveal_password(token))
        .transpose()?;
    Ok(SqlConnectionStoredSecrets { password })
}

pub(crate) fn build_connection_subtitle(row: &SqlConnectionRow) -> String {
    match row.engine.as_str() {
        "sqlite" => {
            if let Some(ref path) = row.file_path {
                path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
            } else {
                String::new()
            }
        }
        _ => {
            let host = row.host.as_deref().unwrap_or("localhost");
            let port_str = row.port.map(|p| format!(":{}", p)).unwrap_or_default();
            let db_str = row
                .database_name
                .as_deref()
                .map(|d| format!("/{}", d))
                .unwrap_or_default();
            format!("{}{}{}", host, port_str, db_str)
        }
    }
}

pub(crate) fn connection_summary_from_row(row: SqlConnectionRow) -> Option<SqlConnectionSummary> {
    DbEngine::from_db_value(&row.engine).map(|engine| {
        let subtitle = build_connection_subtitle(&row);
        SqlConnectionSummary {
            id: row.id,
            name: row.name,
            engine,
            subtitle,
        }
    })
}
