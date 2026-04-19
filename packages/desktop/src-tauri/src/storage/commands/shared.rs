use crate::path_safety::validate_project_directory_from_str;
use sea_orm::DbConn;
use tauri::{AppHandle, Manager, State};

pub(super) fn project_name_from_path(path: &std::path::Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(std::borrow::ToOwned::to_owned)
        .unwrap_or_else(|| fallback.to_string())
}

/// Get database connection from app state
pub(super) fn get_db(app: &AppHandle) -> State<'_, DbConn> {
    app.state::<DbConn>()
}

pub(super) fn validate_project_path_for_storage(path: &str) -> Result<std::path::PathBuf, String> {
    let validated = validate_project_directory_from_str(path)
        .map_err(|error| error.message_for(std::path::Path::new(path.trim())))?;

    if !validated.is_absolute() {
        return Err(format!("Path must be absolute: {}", validated.display()));
    }

    Ok(validated)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct Project {
    pub path: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened: Option<String>,
    pub created_at: String,
    pub color: String,
    pub sort_order: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
    pub show_external_cli_sessions: bool,
}
