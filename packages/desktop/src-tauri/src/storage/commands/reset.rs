use crate::db::repository::DatabaseResetRepository;
use tauri::AppHandle;

use super::destructive_confirmation::{consume_confirmation_token, DestructiveOperationScope};
use super::shared::get_db;
use crate::commands::observability::{unexpected_command_result, CommandResult};

/// Reset all data in the database.
/// WARNING: This operation cannot be undone. All data will be permanently deleted.
#[tauri::command]
#[specta::specta]
pub async fn reset_database(app: AppHandle, confirmation_token: String) -> CommandResult<()> {
    consume_confirmation_token(
        &confirmation_token,
        DestructiveOperationScope::ResetDatabase,
        "all-data",
        "reset_database",
    )?;

    unexpected_command_result(
        "reset_database",
        "Failed to reset database",
        async {
            tracing::info!("Resetting database - all data will be deleted");

            let db = get_db(&app);

            DatabaseResetRepository::reset_all_data(&db)
                .await
                .map_err(|e| format!("Failed to reset database: {}", e))?;

            tracing::info!("Database reset successful");
            Ok(())
        }
        .await,
    )
}
