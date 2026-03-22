use crate::db::repository::DatabaseResetRepository;
use tauri::AppHandle;

use super::shared::get_db;

/// Reset all data in the database.
/// WARNING: This operation cannot be undone. All data will be permanently deleted.
#[tauri::command]
#[specta::specta]
pub async fn reset_database(app: AppHandle) -> Result<(), String> {
    tracing::info!("Resetting database - all data will be deleted");

    let db = get_db(&app);

    DatabaseResetRepository::reset_all_data(&db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to reset database");
            format!("Failed to reset database: {}", e)
        })?;

    tracing::info!("Database reset successful");
    Ok(())
}
