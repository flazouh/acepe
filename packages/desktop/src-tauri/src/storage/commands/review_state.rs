use crate::db::repository::SessionReviewStateRepository;
use tauri::AppHandle;

use super::shared::get_db;

/// Save review progress state for a specific session.
#[tauri::command]
#[specta::specta]
pub async fn save_session_review_state(
    app: AppHandle,
    session_id: String,
    state_json: String,
) -> Result<(), String> {
    tracing::debug!(session_id = %session_id, "Saving session review state");

    let db = get_db(&app);

    SessionReviewStateRepository::set(&db, &session_id, &state_json)
        .await
        .map_err(|e| {
            tracing::error!(
                error = %e,
                session_id = %session_id,
                "Failed to save session review state"
            );
            e.to_string()
        })?;

    Ok(())
}

/// Load review progress state for a specific session.
#[tauri::command]
#[specta::specta]
pub async fn get_session_review_state(
    app: AppHandle,
    session_id: String,
) -> Result<Option<String>, String> {
    tracing::debug!(session_id = %session_id, "Loading session review state");

    let db = get_db(&app);

    SessionReviewStateRepository::get(&db, &session_id)
        .await
        .map_err(|e| {
            tracing::error!(
                error = %e,
                session_id = %session_id,
                "Failed to load session review state"
            );
            e.to_string()
        })
}

/// Delete review progress state for a specific session.
#[tauri::command]
#[specta::specta]
pub async fn delete_session_review_state(app: AppHandle, session_id: String) -> Result<(), String> {
    tracing::debug!(session_id = %session_id, "Deleting session review state");

    let db = get_db(&app);

    SessionReviewStateRepository::delete(&db, &session_id)
        .await
        .map_err(|e| {
            tracing::error!(
                error = %e,
                session_id = %session_id,
                "Failed to delete session review state"
            );
            e.to_string()
        })?;

    Ok(())
}
