use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;
use std::path::{Path, PathBuf};

use crate::db::repository::SqlConnectionRow;

use super::super::super::types::TestConnectionResponse;
use super::stored_config::{parse_sql_stored_config, parse_sql_stored_secrets};

pub(crate) fn require_field(value: &Option<String>, field_name: &str) -> Result<String, String> {
    value
        .clone()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("Connection is missing required field '{}'", field_name))
}

pub(crate) fn get_sqlite_file_path(config: &SqlConnectionRow) -> Result<String, String> {
    if config.engine != "sqlite" {
        return Err(format!("Database engine '{}' is not SQLite", config.engine));
    }

    let file_path = parse_sql_stored_config(config)?
        .file_path
        .ok_or_else(|| "SQLite connection is missing file path".to_string())?;
    reject_acepe_app_database_path(&file_path)?;
    Ok(file_path)
}

fn sidecar_base_name(file_name: &str) -> Option<&str> {
    file_name
        .strip_suffix("-wal")
        .or_else(|| file_name.strip_suffix("-journal"))
        .or_else(|| file_name.strip_suffix("-shm"))
}

fn normalize_existing_or_parent(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|error| format!("Failed to resolve SQLite path: {}", error));
    }

    let parent = path
        .parent()
        .ok_or_else(|| "SQLite path does not have a parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Failed to resolve SQLite parent path: {}", error))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "SQLite path does not have a file name".to_string())?;
    Ok(canonical_parent.join(file_name))
}

#[cfg(unix)]
fn same_file_identity(left: &Path, right: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    let Ok(left_metadata) = left.metadata() else {
        return false;
    };
    let Ok(right_metadata) = right.metadata() else {
        return false;
    };
    left_metadata.dev() == right_metadata.dev() && left_metadata.ino() == right_metadata.ino()
}

#[cfg(not(unix))]
fn same_file_identity(_left: &Path, _right: &Path) -> bool {
    false
}

pub(crate) fn sqlite_path_targets_app_database(
    candidate_path: &Path,
    app_db_path: &Path,
) -> Result<bool, String> {
    let candidate = normalize_existing_or_parent(candidate_path)?;
    let app_db = normalize_existing_or_parent(app_db_path)?;

    if candidate == app_db || same_file_identity(&candidate, &app_db) {
        return Ok(true);
    }

    let Some(candidate_name) = candidate.file_name().and_then(|name| name.to_str()) else {
        return Ok(false);
    };
    let Some(app_db_name) = app_db.file_name().and_then(|name| name.to_str()) else {
        return Ok(false);
    };

    let candidate_base = sidecar_base_name(candidate_name);
    if candidate_base == Some(app_db_name) {
        let candidate_parent = candidate.parent();
        let app_parent = app_db.parent();
        return Ok(candidate_parent.is_some() && candidate_parent == app_parent);
    }

    Ok(false)
}

pub(crate) fn reject_acepe_app_database_path(file_path: &str) -> Result<(), String> {
    let app_db_path = crate::db::get_db_path(None)
        .map_err(|error| format!("Failed to resolve Acepe app database path: {}", error))?;
    if sqlite_path_targets_app_database(Path::new(file_path), &app_db_path)? {
        return Err("SQL Studio cannot open Acepe's own application database".to_string());
    }

    Ok(())
}

pub(crate) fn build_postgres_url(config: &SqlConnectionRow) -> Result<String, String> {
    if config.engine != "postgres" {
        return Err(format!(
            "Database engine '{}' is not Postgres",
            config.engine
        ));
    }

    let stored = parse_sql_stored_config(config)?;
    let secrets = parse_sql_stored_secrets(config)?;

    let host = require_field(&stored.host, "host")?;
    let database = stored
        .database_name
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "postgres".to_string());
    let username = stored
        .username
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "postgres".to_string());
    let port = stored.port.unwrap_or(5432);

    let encoded_user = urlencoding::encode(&username);
    let encoded_password = secrets
        .password
        .filter(|v| !v.trim().is_empty())
        .map(|password| urlencoding::encode(&password).to_string());

    let auth_segment = if let Some(password) = encoded_password {
        format!("{}:{}", encoded_user, password)
    } else {
        encoded_user.to_string()
    };

    let mut url = format!(
        "postgres://{}@{}:{}/{}",
        auth_segment,
        host,
        port,
        urlencoding::encode(&database)
    );
    if let Some(ssl_mode) = stored
        .ssl_mode
        .as_ref()
        .filter(|mode| !mode.trim().is_empty())
    {
        let encoded_mode = urlencoding::encode(ssl_mode);
        url.push_str(&format!("?sslmode={}", encoded_mode));
    }
    Ok(url)
}

pub(crate) fn build_mysql_url(config: &SqlConnectionRow) -> Result<String, String> {
    if config.engine != "mysql" {
        return Err(format!("Database engine '{}' is not MySQL", config.engine));
    }

    let stored = parse_sql_stored_config(config)?;
    let secrets = parse_sql_stored_secrets(config)?;

    let host = require_field(&stored.host, "host")?;
    let database = stored
        .database_name
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "mysql".to_string());
    let username = stored
        .username
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "root".to_string());
    let port = stored.port.unwrap_or(3306);

    let encoded_user = urlencoding::encode(&username);
    let encoded_password = secrets
        .password
        .filter(|v| !v.trim().is_empty())
        .map(|password| urlencoding::encode(&password).to_string());

    let auth_segment = if let Some(password) = encoded_password {
        format!("{}:{}", encoded_user, password)
    } else {
        encoded_user.to_string()
    };

    let mut url = format!(
        "mysql://{}@{}:{}/{}",
        auth_segment,
        host,
        port,
        urlencoding::encode(&database)
    );
    if let Some(ssl_mode) = stored
        .ssl_mode
        .as_ref()
        .filter(|mode| !mode.trim().is_empty())
    {
        let encoded_mode = urlencoding::encode(ssl_mode);
        url.push_str(&format!("?ssl-mode={}", encoded_mode));
    }
    Ok(url)
}

pub(crate) async fn list_postgres_columns(
    pool: &PgPool,
    schema_name: &str,
    table_name: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position",
    )
    .bind(schema_name)
    .bind(table_name)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        format!(
            "Failed to load Postgres columns for {}.{}: {}",
            schema_name, table_name, e
        )
    })?;

    rows.into_iter()
        .map(|row| {
            row.try_get::<String, _>("column_name")
                .map_err(|e| format!("Failed reading Postgres column name: {}", e))
        })
        .collect()
}

pub(crate) async fn list_mysql_columns(
    pool: &MySqlPool,
    schema_name: &str,
    table_name: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position",
    )
    .bind(schema_name)
    .bind(table_name)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        format!(
            "Failed to load MySQL columns for {}.{}: {}",
            schema_name, table_name, e
        )
    })?;

    rows.into_iter()
        .map(|row| {
            row.try_get::<String, _>("column_name")
                .map_err(|e| format!("Failed reading MySQL column name: {}", e))
        })
        .collect()
}

pub(crate) async fn connect_postgres(config: &SqlConnectionRow) -> Result<PgPool, String> {
    let url = build_postgres_url(config)?;
    PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| format!("Failed to connect to Postgres: {}", e))
}

pub(crate) async fn connect_mysql(config: &SqlConnectionRow) -> Result<MySqlPool, String> {
    let url = build_mysql_url(config)?;
    MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|e| format!("Failed to connect to MySQL: {}", e))
}

pub(crate) async fn test_connection_row(
    connection: &SqlConnectionRow,
) -> Result<TestConnectionResponse, String> {
    match connection.engine.as_str() {
        "sqlite" => {
            let file_path = get_sqlite_file_path(connection)?;
            let conn = rusqlite::Connection::open(file_path)
                .map_err(|e| format!("Failed to open SQLite connection: {}", e))?;
            conn.prepare("SELECT 1")
                .map_err(|e| format!("Failed to run SQLite test query: {}", e))?;
            Ok(TestConnectionResponse {
                ok: true,
                message: "SQLite connection successful".to_string(),
            })
        }
        "postgres" => {
            let pool = connect_postgres(connection).await?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|e| format!("Failed to run Postgres test query: {}", e))?;
            pool.close().await;
            Ok(TestConnectionResponse {
                ok: true,
                message: "Postgres connection successful".to_string(),
            })
        }
        "mysql" => {
            let pool = connect_mysql(connection).await?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|e| format!("Failed to run MySQL test query: {}", e))?;
            pool.close().await;
            Ok(TestConnectionResponse {
                ok: true,
                message: "MySQL connection successful".to_string(),
            })
        }
        engine => Err(format!("Unsupported database engine: {}", engine)),
    }
}

#[cfg(test)]
mod tests {
    use super::sqlite_path_targets_app_database;

    #[test]
    fn rejects_direct_app_db_and_sidecar_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app_db = dir.path().join("acepe_dev.db");
        std::fs::write(&app_db, "").expect("write app db");

        assert!(sqlite_path_targets_app_database(&app_db, &app_db).expect("direct db path check"));
        assert!(
            sqlite_path_targets_app_database(&dir.path().join("acepe_dev.db-wal"), &app_db)
                .expect("wal sidecar path check")
        );
        assert!(sqlite_path_targets_app_database(
            &dir.path().join("acepe_dev.db-journal"),
            &app_db
        )
        .expect("journal sidecar path check"));
        assert!(
            sqlite_path_targets_app_database(&dir.path().join("acepe_dev.db-shm"), &app_db)
                .expect("shm sidecar path check")
        );
    }

    #[test]
    fn allows_unrelated_sqlite_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app_db = dir.path().join("acepe_dev.db");
        std::fs::write(&app_db, "").expect("write app db");

        assert!(
            !sqlite_path_targets_app_database(&dir.path().join("scratch.db"), &app_db)
                .expect("unrelated path check")
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_alias_to_app_database() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let app_db = dir.path().join("acepe_dev.db");
        let alias = dir.path().join("alias.db");
        std::fs::write(&app_db, "").expect("write app db");
        symlink(&app_db, &alias).expect("create symlink");

        assert!(sqlite_path_targets_app_database(&alias, &app_db).expect("symlink path check"));
    }
}
