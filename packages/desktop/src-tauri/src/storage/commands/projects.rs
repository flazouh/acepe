use crate::analytics::{self, AnalyticsEvent};
use crate::db::repository::ProjectRepository;
use rand::Rng;
use sea_orm::DatabaseConnection;
use tauri::{AppHandle, State};

use super::shared::{capitalize_name, get_db, validate_project_path_for_storage, Project};

#[tauri::command]
#[specta::specta]
pub async fn get_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    tracing::debug!("Getting all projects");

    let db = get_db(&app);

    let rows = ProjectRepository::get_all(&db).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to get projects");
        e.to_string()
    })?;

    let projects: Vec<Project> = rows
        .into_iter()
        .map(|row| Project {
            path: row.path,
            name: row.name,
            last_opened: Some(row.last_opened),
            created_at: row.created_at,
            color: row.color,
        })
        .collect();

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

    let projects: Vec<Project> = rows
        .into_iter()
        .map(|row| Project {
            path: row.path,
            name: row.name,
            last_opened: Some(row.last_opened),
            created_at: row.created_at,
            color: row.color,
        })
        .collect();

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

    // Extract name from path if not provided, and capitalize it
    let project_name = name.unwrap_or_else(|| {
        let raw_name = canonical_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&canonical_path_str)
            .to_string();
        capitalize_name(&raw_name)
    });

    // Create or update project (color will be randomly assigned if new)
    let project_row =
        ProjectRepository::create_or_update(&db, canonical_path_str.clone(), project_name, None)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Failed to create/update project");
                e.to_string()
            })?;

    tracing::info!(path = %canonical_path_str, "Project imported successfully");

    // Track project added via import
    analytics::track_event(
        app.clone(),
        AnalyticsEvent::ProjectAdded,
        Some(serde_json::json!({"method": "import"})),
    );

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

    Ok(Project {
        path: project_row.path,
        name: project_row.name,
        last_opened: Some(project_row.last_opened),
        created_at: project_row.created_at,
        color: project_row.color,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn add_project(app: AppHandle, path: String, name: Option<String>) -> Result<(), String> {
    tracing::info!(path = %path, name = ?name, "Adding project");

    let db = get_db(&app);
    let canonical_path = validate_project_path_for_storage(&path)?;
    let canonical_path_str = canonical_path.to_string_lossy().to_string();

    // Extract name from path if not provided, and capitalize it
    let project_name = name.unwrap_or_else(|| {
        let raw_name = canonical_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&canonical_path_str)
            .to_string();
        capitalize_name(&raw_name)
    });

    // Create or update project (color will be randomly assigned if new)
    ProjectRepository::create_or_update(&db, canonical_path_str, project_name, None)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to add project");
            e.to_string()
        })?;

    tracing::info!("Project added successfully");

    // Track project added via browse
    analytics::track_event(
        app.clone(),
        AnalyticsEvent::ProjectAdded,
        Some(serde_json::json!({"method": "browse"})),
    );

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
    Ok(Project {
        path: row.path,
        name: row.name,
        last_opened: Some(row.last_opened),
        created_at: row.created_at,
        color: row.color,
    })
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

    analytics::track_event(app.clone(), AnalyticsEvent::ProjectRemoved, None);
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
            let project_name = folder_path
                .path()
                .file_name()
                .and_then(|n| n.to_str())
                .map(capitalize_name)
                .unwrap_or_else(|| capitalize_name(&path_str));

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
            }))
        }
        None => {
            tracing::debug!("Folder selection cancelled");
            Ok(None)
        }
    }
}
