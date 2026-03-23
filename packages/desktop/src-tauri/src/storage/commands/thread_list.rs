use crate::db::repository::AppSettingsRepository;
use tauri::AppHandle;

use super::shared::get_db;

const THREAD_LIST_SETTINGS_KEY: &str = "thread_list_settings";

/// Thread list display settings
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedSessionRef {
    pub session_id: String,
    pub project_path: String,
    pub agent_id: String,
}

/// Thread list display settings
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListSettings {
    /// Project paths that are hidden in the thread list
    pub hidden_projects: Vec<String>,
    /// Sessions hidden from the main sidebar session list
    #[serde(default)]
    pub archived_sessions: Vec<ArchivedSessionRef>,
}

/// Save thread list settings to persistent storage.
#[tauri::command]
#[specta::specta]
pub async fn save_thread_list_settings(
    app: AppHandle,
    settings: ThreadListSettings,
) -> Result<(), String> {
    tracing::info!(
        hidden_project_count = %settings.hidden_projects.len(),
        archived_session_count = %settings.archived_sessions.len(),
        "Saving thread list settings"
    );

    let db = get_db(&app);

    // Serialize settings to JSON
    let json_value = serde_json::to_string(&settings).map_err(|e| {
        tracing::error!(error = %e, "Failed to serialize thread list settings");
        format!("Failed to serialize thread list settings: {}", e)
    })?;

    // Save to app_settings
    AppSettingsRepository::set(&db, THREAD_LIST_SETTINGS_KEY, &json_value)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to save thread list settings to database");
            e.to_string()
        })?;

    tracing::info!("Thread list settings saved successfully");
    Ok(())
}

/// Load thread list settings from persistent storage.
/// Returns default settings if none have been saved.
#[tauri::command]
#[specta::specta]
pub async fn get_thread_list_settings(app: AppHandle) -> Result<ThreadListSettings, String> {
    tracing::debug!("Loading thread list settings");

    let db = get_db(&app);

    let json_value = AppSettingsRepository::get(&db, THREAD_LIST_SETTINGS_KEY)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to load thread list settings from database");
            e.to_string()
        })?;

    match json_value {
        Some(json_str) => {
            let settings: ThreadListSettings = serde_json::from_str(&json_str).map_err(|e| {
                tracing::error!(error = %e, "Failed to deserialize thread list settings");
                format!("Failed to deserialize thread list settings: {}", e)
            })?;

            tracing::debug!(
                hidden_project_count = %settings.hidden_projects.len(),
                archived_session_count = %settings.archived_sessions.len(),
                "Thread list settings loaded"
            );
            Ok(settings)
        }
        None => {
            tracing::debug!("No saved thread list settings found, returning defaults");
            Ok(ThreadListSettings {
                hidden_projects: Vec::new(),
                archived_sessions: Vec::new(),
            })
        }
    }
}
