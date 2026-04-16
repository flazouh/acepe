//! Tauri commands for file indexing.

use std::path::{Component, Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tauri::State;
use tokio::fs;
use tracing::debug;

use crate::path_safety::validate_project_directory_from_str;

use super::git::get_file_content_from_head;
use super::service::FileIndexService;
use crate::commands::observability::{
    CommandResult, SerializableCommandError, expected_command_result, unexpected_command_result,
};
use super::types::{
    FileDiffResult, FileExplorerPreviewResponse, FileExplorerSearchResponse, FileGitStatus,
    ProjectGitOverview, ProjectIndex,
};

fn validate_project_path_for_indexing(project_path: &str) -> Result<String, String> {
    let validated = validate_project_root(project_path)?;

    Ok(validated.to_string_lossy().to_string())
}

fn validate_project_root(project_path: &str) -> Result<PathBuf, String> {
    validate_project_directory_from_str(project_path)
        .map_err(|error| error.message_for(Path::new(project_path.trim())))
}

fn validate_relative_project_path(relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("Invalid path: path cannot be empty".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(trimmed).components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir => {
                return Err("Invalid path: '.' is not allowed".to_string());
            }
            Component::ParentDir => {
                return Err("Invalid path: '..' is not allowed".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid path: absolute paths are not allowed".to_string());
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err("Invalid path: path cannot be empty".to_string());
    }

    Ok(normalized)
}

fn ensure_path_is_within_project(project_root: &Path, resolved_path: &Path) -> Result<(), String> {
    if !resolved_path.starts_with(project_root) {
        return Err("Path escapes project directory".to_string());
    }

    Ok(())
}

/// Validates that `relative_path` is inside `project_path` and returns the canonical full path.
/// Rejects paths containing ".." or starting with "/".
fn validate_existing_path_within_project(
    project_path: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let project_root = validate_project_root(project_path)?;
    let relative = validate_relative_project_path(relative_path)?;
    let full_path = project_root.join(relative);

    let canonical = full_path
        .canonicalize()
        .map_err(|e| format!("Cannot access path: {}", e))?;

    ensure_path_is_within_project(&project_root, &canonical)?;

    Ok(canonical)
}

fn validate_preview_path_within_project(
    project_path: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let project_root = validate_project_root(project_path)?;
    let relative = validate_relative_project_path(relative_path)?;
    let full_path = project_root.join(relative);

    if full_path.exists() {
        let canonical = full_path
            .canonicalize()
            .map_err(|e| format!("Cannot access path: {}", e))?;
        ensure_path_is_within_project(&project_root, &canonical)?;
        return Ok(canonical);
    }

    let parent = full_path
        .parent()
        .ok_or_else(|| "Invalid path: missing parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Cannot access parent directory: {}", e))?;
    ensure_path_is_within_project(&project_root, &canonical_parent)?;

    Ok(full_path)
}

/// Validates that a relative path (which may not exist yet) is under the project.
/// Returns the full path. Use for rename target, new file, etc.
fn validate_target_under_project(
    project_path: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let project_root = validate_project_root(project_path)?;
    let relative = validate_relative_project_path(relative_path)?;
    let full_path = project_root.join(relative);

    if full_path.exists() {
        let canonical = full_path
            .canonicalize()
            .map_err(|e| format!("Cannot access path: {}", e))?;
        ensure_path_is_within_project(&project_root, &canonical)?;
        return Ok(full_path);
    }

    let parent = full_path
        .parent()
        .ok_or_else(|| "Invalid path: missing parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Cannot access parent directory: {}", e))?;
    ensure_path_is_within_project(&project_root, &canonical_parent)?;

    Ok(full_path)
}

fn detect_image_mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        _ => "image/png",
    }
}

/// Get the file index for a project.
///
/// Returns cached data if available and fresh, otherwise performs indexing.
#[tauri::command]
#[specta::specta]
pub async fn get_project_files(
    service: State<'_, FileIndexService>,
    project_path: String,
) -> CommandResult<ProjectIndex>  {
    unexpected_command_result("get_project_files", "Failed to get project files", async {

        let validated_path = validate_project_path_for_indexing(&project_path)?;
        service.get_project_index(&validated_path).await

    }.await)
}

/// Get git status for a project (separate from full index for speed).
#[tauri::command]
#[specta::specta]
pub async fn get_project_git_status(
    service: State<'_, FileIndexService>,
    project_path: String,
) -> CommandResult<Vec<FileGitStatus>>  {
    unexpected_command_result("get_project_git_status", "Failed to get project git status", async {

        let validated_path = validate_project_path_for_indexing(&project_path)?;
        let statuses = service.get_git_status_only(&validated_path).await?;
        debug!(
            project_path = %validated_path,
            status_count = statuses.len(),
            "get_project_git_status command completed"
        );
        Ok(statuses)

    }.await)
}

/// Get git status summary for a project (no per-file diff stats).
///
/// Intended for side-effect-safe UI metadata (e.g. project cards).
#[tauri::command]
#[specta::specta]
pub async fn get_project_git_status_summary(
    service: State<'_, FileIndexService>,
    project_path: String,
) -> CommandResult<Vec<FileGitStatus>>  {
    unexpected_command_result("get_project_git_status_summary", "Failed to get project git status summary", async {

        let validated_path = validate_project_path_for_indexing(&project_path)?;
        service.get_git_status_summary_only(&validated_path).await

    }.await)
}

/// Get branch + TCC-safe git status summary for a project.
#[tauri::command]
#[specta::specta]
pub async fn get_project_git_overview_summary(
    service: State<'_, FileIndexService>,
    project_path: String,
) -> CommandResult<ProjectGitOverview>  {
    unexpected_command_result("get_project_git_overview_summary", "Failed to get project git overview summary", async {

        let validated_path = validate_project_path_for_indexing(&project_path)?;
        service.get_git_overview_summary(&validated_path).await

    }.await)
}

/// Invalidate the file index cache for a project.
#[tauri::command]
#[specta::specta]
pub async fn invalidate_project_files(
    service: State<'_, FileIndexService>,
    project_path: String,
) -> CommandResult<()>  {
    unexpected_command_result("invalidate_project_files", "Failed to invalidate project files", async {

        service.invalidate(&project_path);
        Ok(())

    }.await)
}

fn is_image_extension(ext: &str) -> bool {
    matches!(
        ext,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico"
    )
}

fn is_binary_extension(ext: &str) -> bool {
    matches!(ext, "pdf")
}

fn detect_binary_mime(ext: &str) -> &'static str {
    match ext {
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// Read file content from disk.
///
/// For text files: returns UTF-8 string content.
/// For image files (png, jpg, gif, webp, svg, bmp, ico): returns a data URL (data:image/xxx;base64,...).
/// For binary files (pdf): returns a data URL (data:application/xxx;base64,...).
///
/// Resolve a relative or bare file path to its absolute location within the project.
///
/// Uses the same smart search as `read_file_content`: tries the direct path first,
/// then falls back to `find_file_in_project` for bare filenames.
#[tauri::command]
#[specta::specta]
pub async fn resolve_file_path(file_path: String, project_path: String) -> CommandResult<String>  {
    unexpected_command_result("resolve_file_path", "Failed to resolve file path", async {

        let full_path = Path::new(&project_path).join(&file_path);
        if full_path.exists() {
            return Ok(full_path.to_string_lossy().to_string());
        }
        find_file_in_project(&file_path, &project_path).map(|p| p.to_string_lossy().to_string())

    }.await)
}

/// Smart path resolution: If the exact path doesn't exist, attempts to find the file
/// by matching the filename (or partial path suffix) within the project directory.
#[tauri::command]
#[specta::specta]
pub async fn read_file_content(file_path: String, project_path: String) -> CommandResult<String>  {
    unexpected_command_result("read_file_content", "Failed to read file content", async {

        let full_path = Path::new(&project_path).join(&file_path);

        // Try direct path first
        let resolved_path = if full_path.exists() {
            full_path
        } else {
            // File not found at direct path - try to find it by searching
            find_file_in_project(&file_path, &project_path)?
        };

        let ext = resolved_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if is_image_extension(&ext) {
            // Read binary and return as base64 data URL
            let bytes = fs::read(&resolved_path)
                .await
                .map_err(|e| format!("Failed to read file {}: {}", file_path, e))?;
            let mime_type = detect_image_mime(&resolved_path);
            let base64_data = BASE64.encode(&bytes);
            Ok(format!("data:{};base64,{}", mime_type, base64_data))
        } else if is_binary_extension(&ext) {
            let bytes = fs::read(&resolved_path)
                .await
                .map_err(|e| format!("Failed to read file {}: {}", file_path, e))?;
            let mime_type = detect_binary_mime(&ext);
            let base64_data = BASE64.encode(&bytes);
            Ok(format!("data:{};base64,{}", mime_type, base64_data))
        } else {
            fs::read_to_string(&resolved_path)
                .await
                .map_err(|e| format!("Failed to read file {}: {}", file_path, e))
        }

    }.await)
}

/// Find a file in the project by matching path suffix.
///
/// Tries increasingly specific matches:
/// 1. Exact filename match (e.g., "types.ts" matches "src/lib/types.ts")
/// 2. Partial path suffix match (e.g., "acp/types.ts" matches "src/lib/acp/types.ts")
///
/// Returns error if no match or multiple ambiguous matches found.
fn find_file_in_project(file_path: &str, project_path: &str) -> Result<PathBuf, String> {
    use ignore::WalkBuilder;

    let project = Path::new(project_path);

    // Normalize the search path (remove leading slashes, normalize separators)
    let search_path = file_path.trim_start_matches('/').replace('\\', "/");
    let search_segments: Vec<&str> = search_path.split('/').collect();
    let filename = search_segments
        .last()
        .ok_or_else(|| "Empty file path".to_string())?;

    // Walk project files
    let walker = WalkBuilder::new(project)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .follow_links(false)
        .max_depth(Some(50))
        .build();

    let mut matches: Vec<PathBuf> = Vec::new();

    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }

        let path = entry.path();
        let path_str = path.to_string_lossy();

        // Check if filename matches
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name == *filename {
                // Check if full suffix matches (for partial paths like "acp/types.ts")
                if path_str.ends_with(&search_path) {
                    // Exact suffix match - high confidence
                    return Ok(path.to_path_buf());
                }
                matches.push(path.to_path_buf());
            }
        }
    }

    match matches.len() {
        0 => Err(format!("File not found: {}", file_path)),
        1 => Ok(matches.into_iter().next().unwrap()),
        _ => {
            // Multiple matches - return relative paths for user to choose
            let relative_matches: Vec<String> = matches
                .iter()
                .filter_map(|p| p.strip_prefix(project).ok())
                .map(|p| p.to_string_lossy().to_string())
                .take(5) // Limit suggestions
                .collect();

            Err(format!(
                "Multiple files match '{}'. Did you mean one of: {}",
                file_path,
                relative_matches.join(", ")
            ))
        }
    }
}

/// Get file diff (old content from HEAD, new content from working directory).
///
/// Returns both versions for use with diff visualization.
#[tauri::command]
#[specta::specta]
pub async fn get_file_diff(
    file_path: String,
    project_path: String,
) -> CommandResult<FileDiffResult>  {
    unexpected_command_result("get_file_diff", "Failed to get file diff", async {

        let project = Path::new(&project_path);
        let full_path = project.join(&file_path);
        debug!(
            %project_path,
            %file_path,
            resolved_path = %full_path.display(),
            "get_file_diff command started"
        );

        // Get new content from working directory
        let new_content = fs::read_to_string(&full_path)
            .await
            .map_err(|e| format!("Failed to read file {}: {}", file_path, e))?;

        // Get old content from HEAD (blocking, but fast for single file)
        let old_content = tokio::task::spawn_blocking({
            let project_path = project_path.clone();
            let file_path = file_path.clone();
            move || get_file_content_from_head(Path::new(&project_path), &file_path)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| format!("Failed to get HEAD content: {}", e))?;

        // Extract file name from path
        let file_name = Path::new(&file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&file_path)
            .to_string();

        let result = FileDiffResult {
            old_content,
            new_content,
            file_name,
        };

        debug!(
            %project_path,
            %file_path,
            has_old_content = result.old_content.is_some(),
            old_len = result.old_content.as_ref().map(|value| value.len()).unwrap_or(0),
            new_len = result.new_content.len(),
            "get_file_diff command completed"
        );

        Ok(result)

    }.await)
}

/// Revert file content by writing new content to disk.
///
/// Used by the review panel to reject changes by writing the original content back.
#[tauri::command]
#[specta::specta]
pub async fn revert_file_content(
    file_path: String,
    project_path: String,
    content: String,
) -> CommandResult<()>  {
    unexpected_command_result("revert_file_content", "Failed to revert file content", async {

        let full_path = Path::new(&project_path).join(&file_path);

        fs::write(&full_path, content)
            .await
            .map_err(|e| format!("Failed to write file {}: {}", file_path, e))

    }.await)
}

/// Read an image file as base64 data URL.
///
/// Returns a data URL string that can be used directly as an img src.
#[tauri::command]
#[specta::specta]
pub async fn read_image_as_base64(file_path: String) -> CommandResult<String>  {
    unexpected_command_result("read_image_as_base64", "Failed to read image as base64", async {

        let path = Path::new(&file_path);

        // Read the file bytes
        let bytes = fs::read(&path)
            .await
            .map_err(|e| format!("Failed to read image {}: {}", file_path, e))?;

        // Determine MIME type from extension
        let mime_type = detect_image_mime(path);

        // Encode as base64 data URL
        let base64_data = BASE64.encode(&bytes);
        Ok(format!("data:{};base64,{}", mime_type, base64_data))

    }.await)
}

/// Delete a file or directory at the given path within a project.
/// Path must be within the project (validated). Directories are removed recursively.
#[tauri::command]
#[specta::specta]
pub async fn delete_path(project_path: String, relative_path: String) -> CommandResult<()>  {
    unexpected_command_result("delete_path", "Failed to delete path", async {

        let canonical = validate_existing_path_within_project(&project_path, &relative_path)?;

        let meta = fs::metadata(&canonical)
            .await
            .map_err(|e| format!("Cannot access path: {}", e))?;

        if meta.is_dir() {
            fs::remove_dir_all(&canonical)
                .await
                .map_err(|e| format!("Failed to delete directory: {}", e))?;
        } else {
            fs::remove_file(&canonical)
                .await
                .map_err(|e| format!("Failed to delete file: {}", e))?;
        }

        Ok(())

    }.await)
}

#[cfg(test)]
mod tests {
    use super::{
        validate_existing_path_within_project, validate_preview_path_within_project,
        validate_project_path_for_indexing, validate_target_under_project,
    };
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn validate_project_path_for_indexing_accepts_directory() {
        let dir = tempdir().expect("temp dir");
        let result = validate_project_path_for_indexing(&dir.path().to_string_lossy());
        assert!(result.is_ok());
    }

    #[test]
    fn validate_project_path_for_indexing_rejects_empty() {
        let result = validate_project_path_for_indexing("   ");
        assert!(result.is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validate_project_path_for_indexing_rejects_home_directory_on_macos() {
        let home = dirs::home_dir().expect("home directory");
        let result = validate_project_path_for_indexing(&home.to_string_lossy());
        assert!(result.is_err());
    }

    #[test]
    fn validate_existing_path_within_project_rejects_absolute_paths() {
        let dir = tempdir().expect("temp dir");

        let result =
            validate_existing_path_within_project(&dir.path().to_string_lossy(), "/etc/passwd");

        assert!(result.is_err());
    }

    #[test]
    fn validate_existing_path_within_project_rejects_parent_traversal() {
        let dir = tempdir().expect("temp dir");

        let result =
            validate_existing_path_within_project(&dir.path().to_string_lossy(), "../escape.txt");

        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[test]
    fn validate_target_under_project_rejects_symlink_parent_escape() {
        use std::os::unix::fs::symlink;

        let project = tempdir().expect("project temp dir");
        let outside = tempdir().expect("outside temp dir");
        let symlink_path = project.path().join("linked-outside");
        symlink(outside.path(), &symlink_path).expect("create symlink");

        let result = validate_target_under_project(
            &project.path().to_string_lossy(),
            "linked-outside/created.txt",
        );

        assert!(result.is_err());
    }

    #[test]
    fn validate_preview_path_within_project_allows_missing_deleted_file() {
        let project = tempdir().expect("project temp dir");
        let tracked_file = project.path().join("gone.ts");
        fs::write(&tracked_file, "hello").expect("write file");
        fs::remove_file(&tracked_file).expect("remove file");

        let result =
            validate_preview_path_within_project(&project.path().to_string_lossy(), "gone.ts");

        assert!(result.is_ok());
    }
}

/// Rename or move a file or directory within the project.
#[tauri::command]
#[specta::specta]
pub async fn rename_path(
    project_path: String,
    from_relative: String,
    to_relative: String,
) -> CommandResult<()>  {
    unexpected_command_result("rename_path", "Failed to rename path", async {

        let from_full = validate_existing_path_within_project(&project_path, &from_relative)?;
        let to_full = validate_target_under_project(&project_path, &to_relative)?;

        fs::rename(&from_full, &to_full)
            .await
            .map_err(|e| format!("Failed to rename: {}", e))?;

        Ok(())

    }.await)
}

/// Copy a file to the same directory with a "-copy" suffix before the extension.
#[tauri::command]
#[specta::specta]
pub async fn copy_file(project_path: String, relative_path: String) -> CommandResult<String>  {
    unexpected_command_result("copy_file", "Failed to copy file", async {

        let source = validate_existing_path_within_project(&project_path, &relative_path)?;

        let meta = fs::metadata(&source)
            .await
            .map_err(|e| format!("Cannot access file: {}", e))?;
        if meta.is_dir() {
            return Err("Cannot duplicate a directory".to_string());
        }

        let stem = source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("");
        let parent = source.parent().ok_or("Invalid file path")?;
        let base = if ext.is_empty() {
            format!("{}-copy", stem)
        } else {
            format!("{}-copy.{}", stem, ext)
        };
        let dest = parent.join(&base);

        let content = fs::read(&source)
            .await
            .map_err(|e| format!("Failed to read file: {}", e))?;
        fs::write(&dest, content)
            .await
            .map_err(|e| format!("Failed to write copy: {}", e))?;

        let relative = dest
            .strip_prefix(
                Path::new(&project_path)
                    .canonicalize()
                    .map_err(|e| e.to_string())?,
            )
            .map_err(|_| "Path error".to_string())?
            .to_string_lossy()
            .to_string();
        Ok(relative)

    }.await)
}

/// Create an empty file at the given path within the project.
#[tauri::command]
#[specta::specta]
pub async fn create_file(project_path: String, relative_path: String) -> CommandResult<()>  {
    let full = expected_command_result("create_file", validate_target_under_project(&project_path, &relative_path))?;

    if full.exists() {
        return Err(SerializableCommandError::expected(
            "create_file",
            "File already exists",
        ));
    }

    if let Some(parent) = full.parent() {
        if !parent.exists() {
            return Err(SerializableCommandError::expected(
                "create_file",
                "Parent directory does not exist",
            ));
        }
    }

    unexpected_command_result("create_file", "Failed to create file", async {
        fs::File::create(&full)
            .await
            .map_err(|e| format!("Failed to create file: {}", e))?;

        Ok(())
    }.await)
}

/// Create a directory at the given path within the project.
#[tauri::command]
#[specta::specta]
pub async fn create_directory(project_path: String, relative_path: String) -> CommandResult<()>  {
    let full =
        expected_command_result("create_directory", validate_target_under_project(&project_path, &relative_path))?;

    if full.exists() {
        return Err(SerializableCommandError::expected(
            "create_directory",
            "Directory already exists",
        ));
    }

    if let Some(parent) = full.parent() {
        if !parent.exists() {
            return Err(SerializableCommandError::expected(
                "create_directory",
                "Parent directory does not exist",
            ));
        }
    }

    unexpected_command_result("create_directory", "Failed to create directory", async {
        fs::create_dir(&full)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;

        Ok(())
    }.await)
}

/// Search project files for the file explorer modal.
///
/// Returns a ranked, windowed list of file rows from the cached project index.
/// All ranking and filtering happens in Rust.
#[tauri::command]
#[specta::specta]
pub async fn search_project_files_for_explorer(
    service: State<'_, FileIndexService>,
    project_path: String,
    query: String,
    limit: u32,
    offset: u32,
) -> CommandResult<FileExplorerSearchResponse>  {
    unexpected_command_result("search_project_files_for_explorer", "Failed to search project files for explorer", async {

        let validated_path = validate_project_path_for_indexing(&project_path)?;
        service
            .explorer_search(&validated_path, &query, limit, offset)
            .await

    }.await)
}

/// Get a preview payload for the selected explorer row.
///
/// Returns typed preview content (diff, text, or fallback) based on Rust-side
/// classification. The frontend should never guess preview kind.
#[tauri::command]
#[specta::specta]
pub async fn get_file_explorer_preview(
    service: State<'_, FileIndexService>,
    project_path: String,
    file_path: String,
) -> CommandResult<FileExplorerPreviewResponse>  {
    unexpected_command_result("get_file_explorer_preview", "Failed to get file explorer preview", async {

        let validated_project = validate_project_path_for_indexing(&project_path)?;
        let _validated_file = validate_preview_path_within_project(&validated_project, &file_path)?;
        service
            .explorer_preview(&validated_project, &file_path)
            .await

    }.await)
}
