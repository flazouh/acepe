use crate::path_safety::validate_project_directory_from_str;
use sea_orm::DbConn;
use tauri::{AppHandle, Manager, State};

/// Capitalize the first letter of each word in a string.
/// Handles spaces, underscores, and hyphens as word separators.
pub(super) fn capitalize_name(name: &str) -> String {
    name.split(&[' ', '_', '-'][..])
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    first.to_uppercase().collect::<String>()
                        + chars.as_str().to_lowercase().as_str()
                }
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
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
}
