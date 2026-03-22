use super::*;

pub(super) fn validate_session_cwd(
    cwd: &str,
    reason: ProjectAccessReason,
) -> Result<PathBuf, SerializableAcpError> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err(SerializableAcpError::InvalidState {
            message: ProjectPathSafetyError::Empty.message_for(std::path::Path::new(trimmed)),
        });
    }

    let parsed = PathBuf::from(trimmed);

    if !parsed.is_absolute() {
        return Err(SerializableAcpError::InvalidState {
            message: format!(
                "Working directory must be an absolute path, got: {}",
                trimmed
            ),
        });
    }

    validate_project_directory_brokered(&parsed, reason).map_err(|error| {
        SerializableAcpError::InvalidState {
            message: error.message_for(std::path::Path::new(trimmed)),
        }
    })
}

/// Normalize a file path by fixing duplicate cwd issues.
///
/// The ACP subprocess sometimes incorrectly concatenates the session cwd with
/// an already-absolute path, resulting in paths like:
/// `/Users/alex/project//Users/alex/project/src/file.ts`
///
/// This happens because: cwd + "/" + absolute_path creates double slashes
/// where the cwd ends and the absolute path begins (since absolute_path
/// already starts with "/").
///
/// Detection strategy:
/// 1. Find `//` in the path
/// 2. Extract what comes after `//` and prepend `/` to make it absolute
/// 3. Check if the result shares a common prefix with the original path
/// 4. If yes, this is the duplicate cwd bug - return the extracted path
///
/// This avoids incorrectly "normalizing" paths that legitimately have `//`
/// (e.g., due to path construction quirks that aren't the duplicate cwd bug).
pub(super) fn normalize_acp_path(path: &str) -> String {
    // Look for `//` - this might indicate cwd was concatenated with an absolute path
    if let Some(double_slash_idx) = path.find("//") {
        let after_double_slash = &path[double_slash_idx + 2..];

        // Skip empty segments or already-absolute paths after //
        if after_double_slash.is_empty() || after_double_slash.starts_with('/') {
            return path.to_string();
        }

        // Reconstruct what the absolute path would be
        let candidate_path = format!("/{}", after_double_slash);

        // Check if this is the duplicate cwd bug:
        // The candidate path should start with the same prefix as the original path
        // This happens when path = "/cwd//cwd/subpath" -> candidate = "/cwd/subpath"
        // Both start with "/cwd"
        let prefix = &path[..double_slash_idx];
        if candidate_path.starts_with(prefix) {
            tracing::warn!(
                original_path = %path,
                normalized_path = %candidate_path,
                "Detected duplicate cwd in path, normalizing"
            );
            return candidate_path;
        }
    }
    path.to_string()
}
