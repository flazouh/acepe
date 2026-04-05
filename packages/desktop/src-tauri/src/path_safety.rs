use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectPathSafetyError {
    Empty,
    /// Path does not exist on disk (deleted or moved).
    PathNotFound,
    /// Path exists but is not a directory (it's a file).
    NotDirectory,
    RootDirectory,
    HomeDirectory,
}

impl ProjectPathSafetyError {
    pub fn message_for(self, path: &Path) -> String {
        match self {
            Self::Empty => "Project path cannot be empty".to_string(),
            Self::PathNotFound => format!("Project folder not found: {}", path.display()),
            Self::NotDirectory => format!("Project path is not a directory: {}", path.display()),
            Self::RootDirectory => {
                format!(
                    "Project path must be a project folder, not '{}'",
                    path.display()
                )
            }
            Self::HomeDirectory => {
                format!(
                    "Project path must be a project folder, not '{}'",
                    path.display()
                )
            }
        }
    }
}

/// Process-global cache for validated project paths.
///
/// This avoids repeated `is_dir()` and `canonicalize()` calls that trigger
/// macOS TCC "allow access" prompts for protected folders like ~/Documents.
/// Without caching, 12+ callsites fire simultaneously when the UI renders,
/// each probing the filesystem and producing a separate TCC prompt.
static VALIDATED_PATHS: OnceLock<Mutex<HashMap<PathBuf, Result<PathBuf, ProjectPathSafetyError>>>> =
    OnceLock::new();

fn validation_cache() -> &'static Mutex<HashMap<PathBuf, Result<PathBuf, ProjectPathSafetyError>>> {
    VALIDATED_PATHS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn canonicalize_or_original(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Lightweight lexical-only check for legacy unsafe project roots.
///
/// This intentionally avoids any filesystem access (`is_dir`, `canonicalize`, `metadata`)
/// so it can be used during startup without triggering macOS TCC prompts.
pub fn classify_legacy_unsafe_project_root_lexical(_path: &Path) -> Option<ProjectPathSafetyError> {
    #[cfg(target_os = "macos")]
    {
        let path = _path;
        let normalized = trim_trailing_separators(path);

        if normalized == Path::new("/") {
            return Some(ProjectPathSafetyError::RootDirectory);
        }

        if let Some(home_dir) = dirs::home_dir() {
            let normalized_home = trim_trailing_separators(&home_dir);
            if normalized == normalized_home {
                return Some(ProjectPathSafetyError::HomeDirectory);
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn trim_trailing_separators(path: &Path) -> PathBuf {
    let raw = path.as_os_str().to_string_lossy();

    #[cfg(windows)]
    let trimmed = raw.trim_end_matches(['/', '\\']);

    #[cfg(not(windows))]
    let trimmed = raw.trim_end_matches('/');

    if trimmed.is_empty() {
        PathBuf::from("/")
    } else {
        PathBuf::from(trimmed)
    }
}

pub fn validate_project_directory(path: &Path) -> Result<PathBuf, ProjectPathSafetyError> {
    // Fast path: return cached result without touching the filesystem.
    if let Ok(cache) = validation_cache().lock() {
        if let Some(result) = cache.get(path) {
            return result.clone();
        }
    }

    // Slow path: filesystem check (triggers TCC once per unique path).
    let result = validate_project_directory_uncached(path);

    // Cache the result (both Ok and Err) to prevent repeat TCC prompts.
    if let Ok(mut cache) = validation_cache().lock() {
        cache.insert(path.to_path_buf(), result.clone());
    }

    result
}

fn validate_project_directory_uncached(path: &Path) -> Result<PathBuf, ProjectPathSafetyError> {
    if !path.exists() {
        return Err(ProjectPathSafetyError::PathNotFound);
    }
    if !path.is_dir() {
        return Err(ProjectPathSafetyError::NotDirectory);
    }

    let canonical_path = canonicalize_or_original(path);

    #[cfg(target_os = "macos")]
    {
        if canonical_path.parent().is_none() {
            return Err(ProjectPathSafetyError::RootDirectory);
        }

        if let Some(home_dir) = dirs::home_dir() {
            let canonical_home = canonicalize_or_original(&home_dir);
            if canonical_path == canonical_home {
                return Err(ProjectPathSafetyError::HomeDirectory);
            }
        }
    }

    Ok(canonical_path)
}

/// Pre-warm macOS TCC grants by probing protected parent directories.
///
/// macOS TCC grants access per parent directory (~/Documents, ~/Desktop,
/// ~/Downloads). A single `metadata()` call triggers the "Allow" dialog;
/// once accepted, all paths under that directory are authorized.
#[cfg(target_os = "macos")]
pub fn pre_warm_tcc_grants(project_paths: &[PathBuf]) {
    for dir in tcc_protected_dirs() {
        if project_paths.iter().any(|p| p.starts_with(&dir)) {
            let _ = std::fs::metadata(&dir);
        }
    }
}

#[cfg(target_os = "macos")]
fn tcc_protected_dirs() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return vec![];
    };
    vec![
        home.join("Documents"),
        home.join("Desktop"),
        home.join("Downloads"),
    ]
}

pub fn validate_project_directory_from_str(path: &str) -> Result<PathBuf, ProjectPathSafetyError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(ProjectPathSafetyError::Empty);
    }

    let parsed = PathBuf::from(trimmed);
    validate_project_directory(&parsed)
}

/// Validates that a string is safe to use as a single path segment (no traversal).
/// Reject empty, `.`, `..`, or any segment containing `/` or `\`.
pub fn validate_path_segment(segment: &str, label: &str) -> Result<(), String> {
    if segment.is_empty() {
        return Err(format!("Invalid {}: empty", label));
    }
    if segment == "." {
        return Err(format!("Invalid {}: '.'", label));
    }
    if segment == ".." || segment.contains("..") {
        return Err(format!("Invalid {}: contains '..': {}", label, segment));
    }
    if segment.contains('/') {
        return Err(format!("Invalid {}: contains '/': {}", label, segment));
    }
    if segment.contains('\\') {
        return Err(format!("Invalid {}: contains '\\': {}", label, segment));
    }
    Ok(())
}

pub fn resolve_write_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("Path must be absolute: {}", path.display()));
    }

    let mut resolved = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => resolved.push(prefix.as_os_str()),
            Component::RootDir => resolved.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                let _ = resolved.pop();
            }
            Component::Normal(segment) => {
                resolved.push(segment);
                if resolved.exists() {
                    resolved = std::fs::canonicalize(&resolved)
                        .map_err(|error| format!("Cannot access path: {}", error))?;
                }
            }
        }
    }

    Ok(resolved)
}

pub fn resolve_write_path_within_project(
    project_root: &Path,
    path: &Path,
) -> Result<PathBuf, String> {
    let canonical_project_root = validate_project_directory(project_root)
        .map_err(|error| error.message_for(project_root))?;
    let resolved_path = resolve_write_path(path)?;

    if !resolved_path.starts_with(&canonical_project_root) {
        return Err(format!(
            "Path is outside project directory: {}",
            path.display()
        ));
    }

    Ok(resolved_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn rejects_empty_path_string() {
        let result = validate_project_directory_from_str("   ");
        assert!(matches!(result, Err(ProjectPathSafetyError::Empty)));
    }

    #[test]
    fn rejects_non_directory() {
        let temp = tempdir().expect("temp dir");
        let file_path = temp.path().join("file.txt");
        std::fs::write(&file_path, "content").expect("write file");

        let result = validate_project_directory(&file_path);
        assert!(matches!(result, Err(ProjectPathSafetyError::NotDirectory)));
    }

    #[test]
    fn accepts_valid_directory() {
        let temp = tempdir().expect("temp dir");
        let result = validate_project_directory(temp.path());
        assert!(result.is_ok(), "expected temp directory to be valid");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn rejects_home_directory_on_macos() {
        let home = dirs::home_dir().expect("home directory should exist");
        let result = validate_project_directory(&home);
        assert!(matches!(result, Err(ProjectPathSafetyError::HomeDirectory)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn rejects_root_directory_on_macos() {
        let result = validate_project_directory(Path::new("/"));
        assert!(matches!(result, Err(ProjectPathSafetyError::RootDirectory)));
    }

    #[test]
    fn cache_returns_same_result_on_repeated_calls() {
        let temp = tempdir().expect("temp dir");
        let path = temp.path();

        let first = validate_project_directory(path);
        let second = validate_project_directory(path);

        assert_eq!(first, second);
        // Both should succeed
        assert!(first.is_ok());
    }

    #[test]
    fn cache_stores_error_results() {
        let temp = tempdir().expect("temp dir");
        let file_path = temp.path().join("not_a_dir.txt");
        std::fs::write(&file_path, "content").expect("write file");

        let first = validate_project_directory(&file_path);
        let second = validate_project_directory(&file_path);

        assert_eq!(first, second);
        assert!(matches!(first, Err(ProjectPathSafetyError::NotDirectory)));
    }

    #[test]
    fn missing_path_returns_path_not_found() {
        let path = std::path::Path::new("/tmp/acepe-test-nonexistent-path-xyz123");
        let result = validate_project_directory(path);
        assert!(matches!(result, Err(ProjectPathSafetyError::PathNotFound)));
    }

    #[test]
    fn from_str_benefits_from_cache() {
        let temp = tempdir().expect("temp dir");
        let path_str = temp.path().to_string_lossy().to_string();

        let first = validate_project_directory_from_str(&path_str);
        let second = validate_project_directory_from_str(&path_str);

        assert_eq!(first, second);
        assert!(first.is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn lexical_classifier_flags_root_and_home_without_fs_access() {
        let home = dirs::home_dir().expect("home directory should exist");

        assert_eq!(
            classify_legacy_unsafe_project_root_lexical(Path::new("/")),
            Some(ProjectPathSafetyError::RootDirectory)
        );
        assert_eq!(
            classify_legacy_unsafe_project_root_lexical(&home),
            Some(ProjectPathSafetyError::HomeDirectory)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn lexical_classifier_ignores_regular_project_paths() {
        let project = Path::new("/Users/example/Documents/acepe");
        assert_eq!(classify_legacy_unsafe_project_root_lexical(project), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn lexical_classifier_handles_trailing_slashes() {
        let home = dirs::home_dir().expect("home directory should exist");
        let with_trailing = format!("{}/", home.display());

        assert_eq!(
            classify_legacy_unsafe_project_root_lexical(Path::new(&with_trailing)),
            Some(ProjectPathSafetyError::HomeDirectory)
        );
    }

    #[test]
    fn validate_path_segment_accepts_safe_segments() {
        assert!(validate_path_segment("ses_abc123", "session_id").is_ok());
        assert!(validate_path_segment("msg-456-def", "message_id").is_ok());
        assert!(
            validate_path_segment("7377ad20-98c4-47bb-9540-f44156420c63", "session_id").is_ok()
        );
    }

    #[test]
    fn validate_path_segment_rejects_traversal() {
        assert!(validate_path_segment("../etc", "id").is_err());
        assert!(validate_path_segment("foo/bar", "id").is_err());
        assert!(validate_path_segment("foo\\bar", "id").is_err());
        assert!(validate_path_segment("..", "id").is_err());
        assert!(validate_path_segment(".", "id").is_err());
        assert!(validate_path_segment("", "id").is_err());
    }

    #[test]
    fn resolve_write_path_within_project_allows_nested_write_inside_project() {
        let temp = tempdir().expect("temp dir");
        let project_root = temp.path().join("project");
        std::fs::create_dir_all(&project_root).expect("create project root");

        let target_path = project_root.join("src").join("nested").join("file.txt");

        let resolved =
            resolve_write_path_within_project(&project_root, &target_path).expect("resolve path");

        assert_eq!(resolved, target_path);
    }

    #[test]
    fn resolve_write_path_within_project_rejects_parent_dir_traversal() {
        let temp = tempdir().expect("temp dir");
        let project_root = temp.path().join("project");
        std::fs::create_dir_all(&project_root).expect("create project root");

        let target_path = project_root
            .join("src")
            .join("..")
            .join("..")
            .join("outside.txt");

        let error = resolve_write_path_within_project(&project_root, &target_path)
            .expect_err("path traversal should be rejected");

        assert!(error.contains("outside project directory"));
    }

    #[test]
    fn resolve_write_path_within_project_rejects_absolute_path_outside_project() {
        let temp = tempdir().expect("temp dir");
        let project_root = temp.path().join("project");
        let outside_root = temp.path().join("outside");
        std::fs::create_dir_all(&project_root).expect("create project root");
        std::fs::create_dir_all(&outside_root).expect("create outside root");

        let target_path = outside_root.join("file.txt");

        let error = resolve_write_path_within_project(&project_root, &target_path)
            .expect_err("outside path should be rejected");

        assert!(error.contains("outside project directory"));
    }

    #[cfg(unix)]
    #[test]
    fn resolve_write_path_within_project_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().expect("temp dir");
        let project_root = temp.path().join("project");
        let outside_root = temp.path().join("outside");
        std::fs::create_dir_all(&project_root).expect("create project root");
        std::fs::create_dir_all(&outside_root).expect("create outside root");

        let link_path = project_root.join("escape-link");
        symlink(&outside_root, &link_path).expect("create symlink");

        let target_path = link_path.join("file.txt");

        let error = resolve_write_path_within_project(&project_root, &target_path)
            .expect_err("symlink escape should be rejected");

        assert!(error.contains("outside project directory"));
    }
}
