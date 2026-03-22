pub mod entities;
pub mod migrations;
pub mod repository;

#[cfg(test)]
mod repository_test;

use anyhow::Result;
use migrations::Migrator;
use sea_orm::{Database, DbConn};
use sea_orm_migration::MigratorTrait;
use std::path::PathBuf;

pub async fn init_db(identifier_hint: Option<&str>) -> Result<DbConn> {
    let db_path = get_db_path(identifier_hint)?;

    // Ensure directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let database_url = format!("sqlite://{}?mode=rwc", db_path.display());
    let db = Database::connect(&database_url).await?;

    // Run migrations
    Migrator::up(&db, None).await?;

    Ok(db)
}

fn get_db_path(identifier_hint: Option<&str>) -> Result<PathBuf> {
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
