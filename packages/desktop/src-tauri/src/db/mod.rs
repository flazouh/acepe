pub mod entities;
pub mod migrations;
pub mod repository;

#[cfg(test)]
mod repository_test;

use anyhow::Result;
use migrations::Migrator;
use sea_orm::{DbConn, SqlxSqliteConnector};
use sea_orm_migration::MigratorTrait;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use std::path::PathBuf;
use std::time::Duration;

const APP_DB_MAX_CONNECTIONS: u32 = 8;
const APP_DB_MIN_CONNECTIONS: u32 = 1;
const APP_DB_ACQUIRE_TIMEOUT_SECS: u64 = 5;
const APP_DB_IDLE_TIMEOUT_SECS: u64 = 60;

pub async fn init_db(identifier_hint: Option<&str>) -> Result<DbConn> {
    let db_path = get_db_path(identifier_hint)?;
    init_db_at_path(db_path).await
}

async fn init_db_at_path(db_path: PathBuf) -> Result<DbConn> {
    // Ensure directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(APP_DB_MAX_CONNECTIONS)
        .min_connections(APP_DB_MIN_CONNECTIONS)
        .acquire_timeout(Duration::from_secs(APP_DB_ACQUIRE_TIMEOUT_SECS))
        .idle_timeout(Some(Duration::from_secs(APP_DB_IDLE_TIMEOUT_SECS)))
        .connect_with(sqlite_connect_options(db_path))
        .await?;
    let db = SqlxSqliteConnector::from_sqlx_sqlite_pool(pool);

    // Run migrations
    Migrator::up(&db, None).await?;

    Ok(db)
}

fn sqlite_connect_options(db_path: PathBuf) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .busy_timeout(Duration::from_secs(2))
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
}

pub(crate) fn get_db_path(identifier_hint: Option<&str>) -> Result<PathBuf> {
    let data_dir =
        dirs::data_local_dir().ok_or_else(|| anyhow::anyhow!("Cannot determine data directory"))?;

    let acepe_dir = data_dir.join("Acepe");

    // Check environment variable first
    let db_name = match std::env::var("ACEPE_ENV").as_deref() {
        Ok("staging") => "acepe_staging.db",
        Ok("dev") | Ok("development") => "acepe_dev.db",
        Ok("production") | Ok("prod") => "acepe.db",
        _ => {
            // If bundle identifier ends with .staging, use staging DB (for staging builds)
            if let Some(id) = identifier_hint {
                if id.ends_with(".staging") {
                    return Ok(acepe_dir.join("acepe_staging.db"));
                }
            }
            // Fallback to debug/release detection
            #[cfg(debug_assertions)]
            {
                "acepe_dev.db"
            }
            #[cfg(not(debug_assertions))]
            {
                "acepe.db"
            }
        }
    };

    Ok(acepe_dir.join(db_name))
}

#[allow(dead_code)]
pub fn get_db_path_string() -> Result<String> {
    get_db_path(None).map(|p| p.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
    use tempfile::tempdir;

    async fn read_pragma_string(db: &DbConn, sql: &str) -> String {
        let row = db
            .query_one(Statement::from_string(
                DatabaseBackend::Sqlite,
                sql.to_string(),
            ))
            .await
            .expect("pragma query should succeed")
            .expect("pragma query should return one row");
        row.try_get_by_index::<String>(0)
            .expect("pragma result should be a string")
    }

    async fn read_pragma_i64(db: &DbConn, sql: &str) -> i64 {
        let row = db
            .query_one(Statement::from_string(
                DatabaseBackend::Sqlite,
                sql.to_string(),
            ))
            .await
            .expect("pragma query should succeed")
            .expect("pragma query should return one row");
        row.try_get_by_index::<i64>(0)
            .expect("pragma result should be an integer")
    }

    #[tokio::test]
    async fn init_db_at_path_enables_foreground_friendly_sqlite_runtime() {
        let dir = tempdir().expect("temp dir");
        let db = init_db_at_path(dir.path().join("acepe-test.db"))
            .await
            .expect("database should initialize");

        assert_eq!(
            read_pragma_string(&db, "PRAGMA journal_mode")
                .await
                .to_lowercase(),
            "wal"
        );
        assert_eq!(read_pragma_i64(&db, "PRAGMA busy_timeout").await, 2000);
    }
}
