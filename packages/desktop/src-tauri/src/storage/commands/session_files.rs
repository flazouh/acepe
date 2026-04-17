use crate::session_jsonl::parser::path_to_slug;
use crate::commands::observability::{unexpected_command_result, CommandResult};

fn get_session_jsonl_root() -> Result<std::path::PathBuf, String> {
    crate::session_jsonl::parser::get_session_jsonl_root().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn open_in_finder(session_id: String, project_path: String) -> CommandResult<()> {
    unexpected_command_result("open_in_finder", "Failed to open in Finder", async {
        crate::path_safety::validate_path_segment(&session_id, "session_id")
            .map_err(|e| e.to_string())?;

        tracing::info!(
            session_id = %session_id,
            project_path = %project_path,
            "Opening thread in Finder"
        );

        // Construct the path to the thread's .jsonl file
        let jsonl_root = get_session_jsonl_root()?;
        let slug = path_to_slug(&project_path);
        let project_dir = jsonl_root.join("projects").join(&slug);
        let file_path = project_dir.join(format!("{}.jsonl", session_id));

        // Check if file exists
        if !file_path.exists() {
            tracing::warn!(
                file_path = ?file_path,
                "Thread file not found, trying to open project directory instead"
            );

            // If the specific file doesn't exist, try to open the project directory
            let path_to_open = if project_dir.exists() {
                project_dir
            } else {
                return Err(format!("Thread file not found: {}", file_path.display()));
            };

            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open")
                    .arg(&path_to_open)
                    .spawn()
                    .map_err(|e| {
                        tracing::error!(error = %e, "Failed to open in Finder");
                        format!("Failed to open in Finder: {}", e)
                    })?;
            }

            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("explorer")
                    .arg(&path_to_open)
                    .spawn()
                    .map_err(|e| {
                        tracing::error!(error = %e, "Failed to open in Explorer");
                        format!("Failed to open in Explorer: {}", e)
                    })?;
            }

            #[cfg(target_os = "linux")]
            {
                std::process::Command::new("xdg-open")
                    .arg(&path_to_open)
                    .spawn()
                    .map_err(|e| {
                        tracing::error!(error = %e, "Failed to open in file manager");
                        format!("Failed to open in file manager: {}", e)
                    })?;
            }
        } else {
            // File exists - open it and select it in Finder
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open")
                    .arg("-R")
                    .arg(&file_path)
                    .spawn()
                    .map_err(|e| {
                        tracing::error!(error = %e, "Failed to open in Finder");
                        format!("Failed to open in Finder: {}", e)
                    })?;
            }

            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("explorer")
                    .arg("/select,")
                    .arg(&file_path)
                    .spawn()
                    .map_err(|e| {
                        tracing::error!(error = %e, "Failed to open in Explorer");
                        format!("Failed to open in Explorer: {}", e)
                    })?;
            }

            #[cfg(target_os = "linux")]
            {
                std::process::Command::new("xdg-open")
                    .arg(file_path.parent().unwrap_or(&project_dir))
                    .spawn()
                    .map_err(|e| {
                        tracing::error!(error = %e, "Failed to open in file manager");
                        format!("Failed to open in file manager: {}", e)
                    })?;
            }
        }

        tracing::info!(
            file_path = ?file_path,
            "Successfully opened thread in file manager"
        );
        Ok(())
    }.await)
}

/// Get the absolute path to the session JSONL file.
/// Uses the same path structure as open_in_finder (~/.claude/projects/{slug}/{session_id}.jsonl).
#[tauri::command]
#[specta::specta]
pub async fn get_session_file_path(
    session_id: String,
    project_path: String,
) -> CommandResult<String>  {
    unexpected_command_result("get_session_file_path", "Failed to get session file path", async {

        crate::path_safety::validate_path_segment(&session_id, "session_id")
            .map_err(|e| e.to_string())?;

        let jsonl_root = get_session_jsonl_root()?;
        let slug = path_to_slug(&project_path);
        let project_dir = jsonl_root.join("projects").join(&slug);
        let file_path = project_dir.join(format!("{}.jsonl", session_id));

        if !file_path.exists() {
            return Err(format!("Session file not found: {}", file_path.display()));
        }

        Ok(file_path.to_string_lossy().to_string())

    }.await)
}
/// Get the streaming log file path for a session.
/// Dev-only: Returns an error in release builds.
#[tauri::command]
#[specta::specta]
pub async fn get_streaming_log_path(session_id: String) -> CommandResult<String>  {
    unexpected_command_result("get_streaming_log_path", "Failed to get streaming log path", async {

        #[cfg(debug_assertions)]
        {
            use crate::acp::streaming_log::get_log_file_path;

            tracing::debug!(session_id = %session_id, "Getting streaming log path");

            if let Some(file_path) = get_log_file_path(&session_id) {
                Ok(file_path.to_string_lossy().to_string())
            } else {
                Err(format!(
                    "Streaming log not found for session: {}",
                    session_id
                ))
            }
        }

        #[cfg(not(debug_assertions))]
        {
            let _ = session_id;
            Err("Streaming logs are only available in debug builds".to_string())
        }

    }.await)
}

/// Open the streaming log file for a session in the file manager.
/// Dev-only: Returns an error in release builds.
#[tauri::command]
#[specta::specta]
pub async fn open_streaming_log(session_id: String) -> CommandResult<()>  {
    unexpected_command_result("open_streaming_log", "Failed to open streaming log", async {

        #[cfg(debug_assertions)]
        {
            use crate::acp::streaming_log::{get_log_directory, get_log_file_path};

            tracing::info!(session_id = %session_id, "Opening streaming log");

            // Try to get the log file path, fall back to directory
            let path_to_open = if let Some(file_path) = get_log_file_path(&session_id) {
                file_path
            } else if let Some(dir_path) = get_log_directory() {
                dir_path
            } else {
                return Err("Streaming logs directory not available".to_string());
            };

            #[cfg(target_os = "macos")]
            {
                let args = if path_to_open.is_file() {
                    vec!["-R", path_to_open.to_str().unwrap_or_default()]
                } else {
                    vec![path_to_open.to_str().unwrap_or_default()]
                };
                std::process::Command::new("open")
                    .args(&args)
                    .spawn()
                    .map_err(|e| format!("Failed to open in Finder: {}", e))?;
            }

            #[cfg(target_os = "windows")]
            {
                if path_to_open.is_file() {
                    std::process::Command::new("explorer")
                        .arg("/select,")
                        .arg(&path_to_open)
                        .spawn()
                        .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
                } else {
                    std::process::Command::new("explorer")
                        .arg(&path_to_open)
                        .spawn()
                        .map_err(|e| format!("Failed to open in Explorer: {}", e))?;
                }
            }

            #[cfg(target_os = "linux")]
            {
                let directory_to_open = if path_to_open.is_file() {
                    path_to_open.parent().unwrap_or(&path_to_open).to_path_buf()
                } else {
                    path_to_open.clone()
                };
                std::process::Command::new("xdg-open")
                    .arg(&directory_to_open)
                    .spawn()
                    .map_err(|e| format!("Failed to open in file manager: {}", e))?;
            }

            tracing::info!(path = ?path_to_open, "Successfully opened streaming log location");
            Ok(())
        }

        #[cfg(not(debug_assertions))]
        {
            let _ = session_id;
            Err("Streaming logs are only available in debug builds".to_string())
        }

    }.await)
}
