/// Get the system locale from the system
#[tauri::command]
#[specta::specta]
pub async fn get_system_locale() -> Result<String, String> {
    // Use current_locale crate to get system locale
    // This matches what tauri-plugin-locale does internally
    let locale = current_locale::current_locale().unwrap_or("en".to_string());

    Ok(locale)
}
