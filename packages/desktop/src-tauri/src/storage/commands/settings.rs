use crate::analytics;
use crate::commands::observability::{
    capture_unexpected_command_error, unexpected_command_result, CommandResult,
};
use crate::db::repository::{AppSettingsRepository, SettingsRepository};
use crate::storage::types::{CustomKeybindings, UserSettingKey};
use tauri::AppHandle;

use super::shared::get_db;

#[tauri::command]
#[specta::specta]
pub async fn save_api_key(
    app: AppHandle,
    provider_id: String,
    key_name: String,
    api_key: String,
) -> CommandResult<()> {
    unexpected_command_result(
        "save_api_key",
        "Failed to save API key",
        async {
            tracing::info!(provider_id = %provider_id, key_name = %key_name, "Saving API key");

            let db = get_db(&app);

            SettingsRepository::save_api_key(&db, &provider_id, &key_name, &api_key)
                .await
                .map_err(|e| {
                    tracing::error!(error = e.root_cause(), "Failed to save API key");
                    e.to_string()
                })?;

            tracing::info!(provider_id = %provider_id, "API key saved successfully");
            Ok(())
        }
        .await,
    )
}

#[tauri::command]
#[specta::specta]
pub async fn delete_api_key(app: AppHandle, provider_id: String) -> CommandResult<()> {
    unexpected_command_result(
        "delete_api_key",
        "Failed to delete API key",
        async {
            tracing::info!(provider_id = %provider_id, "Deleting API key");

            let db = get_db(&app);

            SettingsRepository::delete_api_key(&db, &provider_id)
                .await
                .map_err(|e| {
                    tracing::error!(error = e.root_cause(), "Failed to delete API key");
                    e.to_string()
                })?;

            tracing::info!(provider_id = %provider_id, "API key deleted successfully");
            Ok(())
        }
        .await,
    )
}

/// Get custom keybindings as a map of command -> key
#[tauri::command]
#[specta::specta]
pub async fn get_custom_keybindings(app: AppHandle) -> CommandResult<CustomKeybindings> {
    unexpected_command_result(
        "get_custom_keybindings",
        "Failed to get custom keybindings",
        async {
            tracing::debug!("Getting custom keybindings");

            let db = get_db(&app);

            let json = AppSettingsRepository::get(&db, UserSettingKey::CustomKeybindings.as_str())
                .await
                .map_err(|e| {
                    tracing::error!(error = e.root_cause(), "Failed to get custom keybindings");
                    e.to_string()
                })?;

            let keybindings: CustomKeybindings = match json {
                Some(json_str) => serde_json::from_str(&json_str).unwrap_or_default(),
                None => CustomKeybindings::new(),
            };

            tracing::debug!(count = %keybindings.len(), "Returning custom keybindings");
            Ok(keybindings)
        }
        .await,
    )
}

/// Save custom keybindings (replaces all custom keybindings)
#[tauri::command]
#[specta::specta]
pub async fn save_custom_keybindings(
    app: AppHandle,
    keybindings: CustomKeybindings,
) -> CommandResult<()> {
    unexpected_command_result(
        "save_custom_keybindings",
        "Failed to save custom keybindings",
        async {
            tracing::info!(count = %keybindings.len(), "Saving custom keybindings");

            let db = get_db(&app);

            let json = serde_json::to_string(&keybindings).map_err(|e| {
                tracing::error!(
                    error = &e as &dyn std::error::Error,
                    "Failed to serialize keybindings"
                );
                e.to_string()
            })?;

            AppSettingsRepository::set(&db, UserSettingKey::CustomKeybindings.as_str(), &json)
                .await
                .map_err(|e| {
                    tracing::error!(error = e.root_cause(), "Failed to save custom keybindings");
                    e.to_string()
                })?;

            tracing::info!("Custom keybindings saved successfully");
            Ok(())
        }
        .await,
    )
}

/// Save a user setting to persistent storage.
/// Uses the app_settings table for key-value storage.
#[tauri::command]
#[specta::specta]
pub async fn save_user_setting(
    app: AppHandle,
    key: UserSettingKey,
    value: String,
) -> CommandResult<()> {
    tracing::debug!(key = %key, "Saving user setting");

    let db = get_db(&app);

    AppSettingsRepository::set(&db, key.as_str(), &value)
        .await
        .map_err(|e| {
            tracing::error!(error = e.root_cause(), key = %key, "Failed to save user setting");
            capture_unexpected_command_error(
                "save_user_setting",
                "Failed to save user setting",
                e.to_string(),
            )
        })?;

    if matches!(key, UserSettingKey::AnalyticsOptOut) {
        match serde_json::from_str::<bool>(&value) {
            Ok(opted_out) => analytics::set_analytics_opted_out(opted_out),
            Err(error) => tracing::warn!(
                key = %key,
                error = %error,
                "Failed to parse analytics opt-out value for Rust telemetry state"
            ),
        }
    }

    tracing::debug!(key = %key, "User setting saved successfully");
    Ok(())
}

/// Load a user setting from persistent storage.
/// Returns None if the setting has not been saved yet.
#[tauri::command]
#[specta::specta]
pub async fn get_user_setting(
    app: AppHandle,
    key: UserSettingKey,
) -> CommandResult<Option<String>> {
    tracing::debug!(key = %key, "Loading user setting");

    let db = get_db(&app);

    let value = AppSettingsRepository::get(&db, key.as_str())
        .await
        .map_err(|e| {
            tracing::error!(error = e.root_cause(), key = %key, "Failed to load user setting");
            capture_unexpected_command_error(
                "get_user_setting",
                "Failed to load user setting",
                e.to_string(),
            )
        })?;

    match &value {
        Some(_) => tracing::debug!(key = %key, "User setting found"),
        None => tracing::debug!(key = %key, "User setting not found"),
    }

    Ok(value)
}
