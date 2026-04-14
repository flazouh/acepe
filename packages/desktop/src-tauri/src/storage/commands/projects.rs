use crate::db::repository::{AppSettingsRepository, ProjectRepository};
use crate::path_safety::{validate_project_directory_from_str, ProjectPathSafetyError};
use rand::Rng;
use sea_orm::DatabaseConnection;
use tauri::{AppHandle, State};

use super::icon_detection::detect_project_icon;
use super::shared::{get_db, project_name_from_path, validate_project_path_for_storage, Project};

const PROJECT_ICON_BACKFILL_KEY: &str = "project_icon_backfill_v2";

fn project_from_row(row: crate::db::repository::ProjectRow) -> Project {
    Project {
        path: row.path,
        name: row.name,
        last_opened: Some(row.last_opened),
        created_at: row.created_at,
        color: row.color,
        sort_order: row.sort_order,
        icon_path: row.icon_path,
    }
}

/// Detects and persists a project icon if the project has no icon set.
/// Returns the updated row (with icon_path populated when detection succeeds).
async fn detect_and_persist_icon(
    db: &DatabaseConnection,
    row: crate::db::repository::ProjectRow,
) -> Result<crate::db::repository::ProjectRow, String> {
    if row.icon_path.is_some() {
        return Ok(row);
    }
    let Some(detected_icon) = detect_project_icon(std::path::Path::new(&row.path)) else {
        return Ok(row);
    };
    tracing::info!(icon = %detected_icon, path = %row.path, "Auto-detected project icon");
    ProjectRepository::update_icon_path(db, &row.path, Some(detected_icon))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, path = %row.path, "Failed to persist detected icon");
            e.to_string()
        })
}

fn classify_missing_project_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter_map(|path| match validate_project_directory_from_str(path) {
            Ok(_) => None,
            Err(ProjectPathSafetyError::PathNotFound | ProjectPathSafetyError::NotDirectory) => {
                Some(path.clone())
            }
            Err(
                ProjectPathSafetyError::Empty
                | ProjectPathSafetyError::RootDirectory
                | ProjectPathSafetyError::HomeDirectory,
            ) => None,
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
pub async fn get_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    tracing::debug!("Getting all projects");

    let db = get_db(&app);

    let rows = ProjectRepository::get_all(&db).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to get projects");
        e.to_string()
    })?;

    let projects: Vec<Project> = rows.into_iter().map(project_from_row).collect();

    tracing::debug!(count = %projects.len(), "Returning projects");
    Ok(projects)
}

#[tauri::command]
#[specta::specta]
pub async fn get_recent_projects(
    app: AppHandle,
    limit: Option<u64>,
) -> Result<Vec<Project>, String> {
    let limit = limit.unwrap_or(100);
    tracing::debug!(limit = %limit, "Getting recent projects");

    let db = get_db(&app);

    let rows = ProjectRepository::get_recent(&db, limit)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to get recent projects");
            e.to_string()
        })?;

    let projects: Vec<Project> = rows.into_iter().map(project_from_row).collect();

    tracing::debug!(count = %projects.len(), "Returning recent projects");
    Ok(projects)
}

#[tauri::command]
#[specta::specta]
pub async fn get_project_count(app: AppHandle) -> Result<u64, String> {
    tracing::debug!("Getting project count");

    let db = get_db(&app);

    let count = ProjectRepository::count(&db).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to get project count");
        e.to_string()
    })?;

    tracing::debug!(count = %count, "Returning project count");
    Ok(count)
}

#[tauri::command]
#[specta::specta]
pub async fn get_missing_project_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    Ok(classify_missing_project_paths(&paths))
}

#[tauri::command]
#[specta::specta]
pub async fn import_project(
    app: AppHandle,
    db: State<'_, DatabaseConnection>,
    path: String,
    name: Option<String>,
) -> Result<Project, String> {
    tracing::info!(path = %path, name = ?name, "Importing project");

    // Validate path is absolute
    let is_absolute = path.starts_with('/')
        || (path.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
            && path.contains(':')
            && (path.contains('\\') || path.contains('/')));

    if !is_absolute {
        return Err(format!("Path must be absolute: {}", path));
    }

    let canonical_path = validate_project_path_for_storage(&path)?;
    let canonical_path_str = canonical_path.to_string_lossy().to_string();

    // Extract name from path if not provided, preserving the path's original casing.
    let project_name =
        name.unwrap_or_else(|| project_name_from_path(&canonical_path, &canonical_path_str));

    // Create or update project (color will be randomly assigned if new)
    let project_row =
        ProjectRepository::create_or_update(&db, canonical_path_str.clone(), project_name, None)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Failed to create/update project");
                e.to_string()
            })?;

    // Auto-detect icon if not already set
    let project_row = detect_and_persist_icon(&db, project_row).await?;

    tracing::info!(path = %canonical_path_str, "Project imported successfully");

    // Pre-warm the session cache by scanning ALL project paths in the background.
    // The SCAN_CACHE key is "scan:{sorted_paths.join('|')}" so we must scan with the
    // same set of paths that loadSessions() will use — otherwise it's a cache miss.
    let project_path_for_spawn = project_row.path.clone();
    let db_clone = db.inner().clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        let all_paths: Vec<String> = match ProjectRepository::get_all(&db_clone).await {
            Ok(rows) => rows.into_iter().map(|r| r.path).collect(),
            Err(e) => {
                tracing::error!(error = %e, "Failed to fetch projects for pre-scan, using imported path only");
                vec![project_path_for_spawn]
            }
        };
        match crate::history::commands::scan_project_sessions(app_clone, all_paths).await {
            Ok(_) => {
                tracing::debug!("Pre-scanned sessions for all projects after import (cached)");
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to pre-scan sessions after import");
            }
        }
    });

    Ok(project_from_row(project_row))
}

#[tauri::command]
#[specta::specta]
pub async fn add_project(app: AppHandle, path: String, name: Option<String>) -> Result<(), String> {
    tracing::info!(path = %path, name = ?name, "Adding project");

    let db = get_db(&app);
    let canonical_path = validate_project_path_for_storage(&path)?;
    let canonical_path_str = canonical_path.to_string_lossy().to_string();

    // Extract name from path if not provided, preserving the path's original casing.
    let project_name =
        name.unwrap_or_else(|| project_name_from_path(&canonical_path, &canonical_path_str));

    // Create or update project (color will be randomly assigned if new)
    let project_row =
        ProjectRepository::create_or_update(&db, canonical_path_str.clone(), project_name, None)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Failed to add project");
                e.to_string()
            })?;

    // Auto-detect icon if not already set
    detect_and_persist_icon(&db, project_row).await?;

    tracing::info!("Project added successfully");

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn update_project_color(
    app: AppHandle,
    path: String,
    color: String,
) -> Result<Project, String> {
    tracing::info!(path = %path, color = %color, "Updating project color");

    let db = get_db(&app);

    // Get existing project first
    let existing = ProjectRepository::get_by_path(&db, &path)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to get project");
            e.to_string()
        })?
        .ok_or_else(|| format!("Project not found: {}", path))?;

    // Update project with new color
    let row = ProjectRepository::create_or_update(&db, path, existing.name, Some(color))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to update project color");
            e.to_string()
        })?;

    tracing::info!("Project color updated successfully");
    Ok(project_from_row(row))
}

#[tauri::command]
#[specta::specta]
pub async fn update_project_icon(
    app: AppHandle,
    path: String,
    icon_path: Option<String>,
) -> Result<Project, String> {
    tracing::info!(path = %path, icon_path = ?icon_path, "Updating project icon");

    // Validate icon_path is a real image file when set
    if let Some(ref ip) = icon_path {
        let icon = std::path::Path::new(ip);
        if !icon.is_file() {
            return Err(format!("Icon path is not a file: {}", ip));
        }
        let valid_extensions = ["png", "svg", "ico", "jpg", "jpeg", "webp", "gif"];
        let ext_ok = icon
            .extension()
            .map(|ext| valid_extensions.contains(&ext.to_string_lossy().to_lowercase().as_str()))
            .unwrap_or(false);
        if !ext_ok {
            return Err(format!("Icon path is not a supported image format: {}", ip));
        }
    }

    let db = get_db(&app);
    let row = ProjectRepository::update_icon_path(&db, &path, icon_path)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to update project icon");
            e.to_string()
        })?;

    Ok(project_from_row(row))
}

#[tauri::command]
#[specta::specta]
pub async fn update_project_order(
    app: AppHandle,
    ordered_paths: Vec<String>,
) -> Result<Vec<Project>, String> {
    tracing::info!(count = ordered_paths.len(), "Updating project order");

    let db = get_db(&app);
    let rows = ProjectRepository::reorder(&db, &ordered_paths)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to update project order");
            e.to_string()
        })?;

    Ok(rows.into_iter().map(project_from_row).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn remove_project(app: AppHandle, path: String) -> Result<(), String> {
    tracing::info!(path = %path, "Removing project");

    let db = get_db(&app);

    ProjectRepository::delete(&db, &path).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to remove project");
        e.to_string()
    })?;

    tracing::info!(path = %path, "Project removed successfully");
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn browse_project(_app: AppHandle) -> Result<Option<Project>, String> {
    use rfd::AsyncFileDialog;

    tracing::debug!("Browsing for project folder");

    // Open folder picker dialog using rfd
    let folder = AsyncFileDialog::new()
        .set_title("Select Project Folder")
        .pick_folder()
        .await;

    match folder {
        Some(folder_path) => {
            let path_str = folder_path.path().to_string_lossy().to_string();
            let project_name = folder_path.path().to_path_buf();
            let project_name = project_name_from_path(&project_name, &path_str);

            tracing::info!(path = %path_str, name = %project_name, "Project selected");

            // Assign a random color for the project
            let colors = ["red", "orange", "yellow", "green", "cyan", "purple", "pink"];
            let mut rng = rand::thread_rng();
            let assigned_color = colors[rng.gen_range(0..colors.len())].to_string();

            Ok(Some(Project {
                path: path_str,
                name: project_name,
                last_opened: Some(chrono::Utc::now().to_rfc3339()),
                created_at: chrono::Utc::now().to_rfc3339(),
                color: assigned_color,
                sort_order: 0,
                icon_path: None,
            }))
        }
        None => {
            tracing::debug!("Folder selection cancelled");
            Ok(None)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn browse_project_icon() -> Result<Option<String>, String> {
    use rfd::AsyncFileDialog;

    tracing::debug!("Browsing for project icon image");

    let file = AsyncFileDialog::new()
        .set_title("Select Project Icon")
        .add_filter("Images", &["png", "svg", "ico", "jpg", "jpeg", "webp"])
        .pick_file()
        .await;

    match file {
        Some(file_handle) => {
            let path_str = file_handle.path().to_string_lossy().to_string();
            tracing::info!(path = %path_str, "Project icon selected");
            Ok(Some(path_str))
        }
        None => {
            tracing::debug!("Icon selection cancelled");
            Ok(None)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn list_project_images(project_path: String) -> Result<Vec<String>, String> {
    use std::path::Path;

    let dir = Path::new(&project_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", project_path));
    }

    let image_extensions = ["png", "svg", "ico", "jpg", "jpeg", "webp", "gif"];
    let skip_dirs = [
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        ".next",
        "__pycache__",
        ".venv",
        "vendor",
    ];
    let mut results = Vec::new();

    fn walk(
        dir: &Path,
        extensions: &[&str],
        skip: &[&str],
        results: &mut Vec<String>,
        depth: usize,
    ) {
        if depth > 4 {
            return;
        }

        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();

            // Skip symlinks to prevent traversal outside the project root
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }

            if path.is_dir() {
                if (!name_str.starts_with('.') || name_str == ".github")
                    && !skip.contains(&name_str.as_ref())
                {
                    walk(&path, extensions, skip, results, depth + 1);
                }
                continue;
            }

            if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if extensions.contains(&ext_lower.as_str()) {
                    results.push(path.to_string_lossy().to_string());
                }
            }
        }
    }

    walk(dir, &image_extensions, &skip_dirs, &mut results, 0);
    results.sort();
    Ok(results)
}

#[tauri::command]
#[specta::specta]
pub async fn backfill_project_icons(app: AppHandle) -> Result<u64, String> {
    tracing::info!("Running one-time project icon backfill");

    let db = get_db(&app);

    let already_ran = AppSettingsRepository::get(&db, PROJECT_ICON_BACKFILL_KEY)
        .await
        .map_err(|e| {
            tracing::error!(
                error = e.root_cause(),
                "Failed to load project icon backfill flag"
            );
            e.to_string()
        })?;

    if already_ran.is_some() {
        tracing::debug!("Project icon backfill already completed");
        return Ok(0);
    }

    let projects = ProjectRepository::get_all(&db).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to load projects for icon backfill");
        e.to_string()
    })?;

    let mut updated_count = 0_u64;

    for project in projects {
        if project.icon_path.is_some() {
            continue;
        }

        let Some(detected_icon) = detect_project_icon(std::path::Path::new(&project.path)) else {
            continue;
        };

        let current_project = ProjectRepository::get_by_path(&db, &project.path)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, path = %project.path, "Failed to reload project during icon backfill");
                e.to_string()
            })?;

        let Some(current_project) = current_project else {
            continue;
        };

        if current_project.icon_path.is_some() {
            continue;
        }

        ProjectRepository::update_icon_path(&db, &project.path, Some(detected_icon))
            .await
            .map_err(|e| {
                tracing::error!(error = %e, path = %project.path, "Failed to persist backfilled project icon");
                e.to_string()
            })?;
        updated_count += 1;
    }

    AppSettingsRepository::set(&db, PROJECT_ICON_BACKFILL_KEY, "true")
        .await
        .map_err(|e| {
            tracing::error!(
                error = e.root_cause(),
                "Failed to persist project icon backfill flag"
            );
            e.to_string()
        })?;

    tracing::info!(updated_count, "Project icon backfill completed");
    Ok(updated_count)
}

#[cfg(test)]
mod tests {
    use super::{classify_missing_project_paths, project_name_from_path};
    use tempfile::tempdir;

    #[test]
    fn reports_missing_and_non_directory_paths() {
        let temp = tempdir().expect("temp dir");
        let existing_dir = temp.path().join("existing");
        let file_path = temp.path().join("file.txt");
        let missing_path = temp.path().join("missing");

        std::fs::create_dir(&existing_dir).expect("create dir");
        std::fs::write(&file_path, "content").expect("write file");

        let missing = classify_missing_project_paths(&[
            existing_dir.to_string_lossy().to_string(),
            file_path.to_string_lossy().to_string(),
            missing_path.to_string_lossy().to_string(),
        ]);

        assert_eq!(
            missing,
            vec![
                file_path.to_string_lossy().to_string(),
                missing_path.to_string_lossy().to_string(),
            ]
        );
    }

    #[test]
    fn preserves_original_project_name_casing() {
        let project_path = std::path::PathBuf::from("/Users/test/MyAPIService");

        let name = project_name_from_path(&project_path, "/Users/test/MyAPIService");

        assert_eq!(name, "MyAPIService");
    }
}
