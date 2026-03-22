use crate::db::repository::{AppSettingsRepository, SettingsRepository};
use crate::storage::types::{CustomKeybindings, UserSettingKey};
use tauri::AppHandle;

use super::shared::get_db;

#[tauri::command]
#[specta::specta]
pub async fn get_api_key(app: AppHandle, provider_id: String) -> Result<Option<String>, String> {
    tracing::debug!(provider_id = %provider_id, "Getting API key");

    let db = get_db(&app);

    SettingsRepository::get_api_key(&db, &provider_id)
        .await
        .map_err(|e| {
            tracing::error!(error = e.root_cause(), "Failed to get API key");
            e.to_string()
        })
}

#[tauri::command]
#[specta::specta]
pub async fn save_api_key(
    app: AppHandle,
    provider_id: String,
    key_name: String,
    api_key: String,
) -> Result<(), String> {
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

#[tauri::command]
#[specta::specta]
pub async fn delete_api_key(app: AppHandle, provider_id: String) -> Result<(), String> {
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

/// Get custom keybindings as a map of command -> key
#[tauri::command]
#[specta::specta]
pub async fn get_custom_keybindings(app: AppHandle) -> Result<CustomKeybindings, String> {
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

/// Save custom keybindings (replaces all custom keybindings)
#[tauri::command]
#[specta::specta]
pub async fn save_custom_keybindings(
    app: AppHandle,
    keybindings: CustomKeybindings,
) -> Result<(), String> {
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

/// Save a user setting to persistent storage.
/// Uses the app_settings table for key-value storage.
#[tauri::command]
#[specta::specta]
pub async fn save_user_setting(
    app: AppHandle,
    key: UserSettingKey,
    value: String,
) -> Result<(), String> {
    tracing::debug!(key = %key, "Saving user setting");

    let db = get_db(&app);

    AppSettingsRepository::set(&db, key.as_str(), &value)
        .await
        .map_err(|e| {
            tracing::error!(error = e.root_cause(), key = %key, "Failed to save user setting");
            e.to_string()
        })?;

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
) -> Result<Option<String>, String> {
    tracing::debug!(key = %key, "Loading user setting");

    let db = get_db(&app);

    let value = AppSettingsRepository::get(&db, key.as_str())
        .await
        .map_err(|e| {
            tracing::error!(error = e.root_cause(), key = %key, "Failed to load user setting");
            e.to_string()
        })?;

    match &value {
        Some(_) => tracing::debug!(key = %key, "User setting found"),
        None => tracing::debug!(key = %key, "User setting not found"),
    }

    Ok(value)
}
