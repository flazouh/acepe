//! Business logic for checkpoint operations.

use anyhow::{Context, Result};
use futures::future::join_all;
use sea_orm::DbConn;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use thiserror::Error;

use super::repository::CheckpointRepository;
use super::types::{Checkpoint, CreateCheckpointInput, RevertError, RevertResult};

/// Errors that can occur during path conversion.
#[derive(Debug, Error)]
pub enum PathConversionError {
    #[error("Empty path provided")]
    EmptyPath,
    #[error("Path '{0}' is outside project and worktree boundaries")]
    OutsideBoundaries(String),
    #[error("UNC paths not supported: {0}")]
    UncNotSupported(String),
    #[error("Cannot access path '{path}': {source}")]
    Inaccessible {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

/// Convert an absolute path to a relative path, checking worktree first then project.
/// Returns paths with forward slashes for cross-platform storage.
pub fn convert_to_relative_path(
    absolute_path: &Path,
    project_path: &Path,
    worktree_path: Option<&Path>,
) -> std::result::Result<String, PathConversionError> {
    // Pre-canonicalize base paths for single file conversion
    let proj_canon =
        project_path
            .canonicalize()
            .map_err(|e| PathConversionError::Inaccessible {
                path: project_path.to_string_lossy().to_string(),
                source: e,
            })?;
    let wt_canon = worktree_path.and_then(|wt| wt.canonicalize().ok());

    convert_to_relative_path_with_cached_bases(absolute_path, &proj_canon, wt_canon.as_deref())
}

/// Convert an absolute path to a relative path using pre-canonicalized base paths.
/// This is more efficient when converting multiple files - canonicalize bases once, reuse.
/// Returns paths with forward slashes for cross-platform storage.
pub fn convert_to_relative_path_with_cached_bases(
    absolute_path: &Path,
    project_path_canon: &Path,
    worktree_path_canon: Option<&Path>,
) -> std::result::Result<String, PathConversionError> {
    if absolute_path.as_os_str().is_empty() {
        return Err(PathConversionError::EmptyPath);
    }

    #[cfg(target_os = "windows")]
    if absolute_path.to_string_lossy().starts_with(r"\\") {
        return Err(PathConversionError::UncNotSupported(
            absolute_path.to_string_lossy().to_string(),
        ));
    }

    let abs = absolute_path
        .canonicalize()
        .map_err(|e| PathConversionError::Inaccessible {
            path: absolute_path.to_string_lossy().to_string(),
            source: e,
        })?;

    // Check worktree first (more specific)
    if let Some(wt_canon) = worktree_path_canon {
        if abs.starts_with(wt_canon) {
            let relative = abs.strip_prefix(wt_canon).unwrap();
            return Ok(normalize_separators(&relative.to_string_lossy()));
        }
    }

    // Check project path
    if abs.starts_with(project_path_canon) {
        let relative = abs.strip_prefix(project_path_canon).unwrap();
        return Ok(normalize_separators(&relative.to_string_lossy()));
    }

    Err(PathConversionError::OutsideBoundaries(
        absolute_path.to_string_lossy().to_string(),
    ))
}

/// Normalize path separators to forward slashes for cross-platform storage.
fn normalize_separators(path: &str) -> String {
    path.replace('\\', "/")
}

/// Maximum file size for checkpoint storage (10 MB).
/// Files larger than this are skipped to prevent memory/database bloat.
const MAX_CHECKPOINT_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// Compute diff stats between two strings (old and new content).
/// Returns (lines_added, lines_removed).
fn compute_diff_stats(old_content: Option<&str>, new_content: &str) -> (i32, i32) {
    match old_content {
        None => {
            // New file - all lines are additions
            let lines_added = new_content.lines().count() as i32;
            (lines_added, 0)
        }
        Some(old) => {
            // Compute line-based diff
            let old_lines: std::collections::HashSet<&str> = old.lines().collect();
            let new_lines: std::collections::HashSet<&str> = new_content.lines().collect();

            let added = new_lines.difference(&old_lines).count() as i32;
            let removed = old_lines.difference(&new_lines).count() as i32;

            (added, removed)
        }
    }
}

/// Manager for checkpoint operations.
///
/// Handles the business logic for creating checkpoints, reverting files,
/// and rewinding sessions.
pub struct CheckpointManager;

impl CheckpointManager {
    /// Validate that a relative path doesn't escape the project directory.
    ///
    /// This prevents path traversal attacks where a malicious path like
    /// "../../../etc/passwd" could read or write files outside the project.
    fn validate_relative_path(project_path: &str, relative_path: &str) -> Result<PathBuf> {
        // Reject paths with obvious traversal patterns
        if relative_path.contains("..") {
            return Err(anyhow::anyhow!(
                "Path contains invalid traversal pattern: {}",
                relative_path
            ));
        }

        // Reject absolute paths
        if relative_path.starts_with('/') || relative_path.starts_with('\\') {
            return Err(anyhow::anyhow!(
                "Relative path cannot be absolute: {}",
                relative_path
            ));
        }

        let project = Path::new(project_path);
        let full_path = project.join(relative_path);

        // Canonicalize both paths to resolve symlinks and get absolute paths
        // Note: For reading, the file must exist for canonicalize to work
        // For writing, we check the parent directory
        let project_canonical = project
            .canonicalize()
            .with_context(|| "Cannot access project directory")?;

        // For the full path, try to canonicalize. If the file doesn't exist yet,
        // canonicalize the parent and append the filename
        let full_canonical = if full_path.exists() {
            full_path
                .canonicalize()
                .with_context(|| format!("Cannot access file: {}", relative_path))?
        } else {
            // File doesn't exist - canonicalize parent and append filename
            if let Some(parent) = full_path.parent() {
                if parent.exists() {
                    let parent_canonical = parent.canonicalize().with_context(|| {
                        format!("Cannot access directory for: {}", relative_path)
                    })?;
                    if let Some(filename) = full_path.file_name() {
                        parent_canonical.join(filename)
                    } else {
                        return Err(anyhow::anyhow!("Invalid path: {}", relative_path));
                    }
                } else {
                    // Parent doesn't exist - construct path from project root
                    // and verify it would be within project
                    project_canonical.join(relative_path)
                }
            } else {
                project_canonical.join(relative_path)
            }
        };

        // Verify the resolved path is within the project directory
        if !full_canonical.starts_with(&project_canonical) {
            return Err(anyhow::anyhow!(
                "Path is outside project directory: {}",
                relative_path
            ));
        }

        Ok(full_canonical)
    }

    /// Create a checkpoint capturing the current state of modified files.
    ///
    /// This reads the content of each modified file from disk and stores
    /// it in the database. Computes diff stats by comparing with the
    /// previous checkpoint's version of each file.
    pub async fn create_checkpoint(
        db: &DbConn,
        input: CreateCheckpointInput,
    ) -> Result<Checkpoint> {
        tracing::debug!(
            session_id = %input.session_id,
            file_count = input.modified_files.len(),
            is_auto = input.is_auto,
            "Creating checkpoint"
        );

        // Get the next checkpoint number
        let checkpoint_number =
            CheckpointRepository::get_next_checkpoint_number(db, &input.session_id).await?;

        // Read file contents and compute hashes in parallel for performance
        let project_path = input.project_path.clone();
        let file_reads: Vec<_> = input
            .modified_files
            .iter()
            .map(|relative_path| {
                let rel_path = relative_path.clone();
                let proj_path = project_path.clone();
                async move {
                    // Validate path to prevent traversal attacks
                    let full_path = match Self::validate_relative_path(&proj_path, &rel_path) {
                        Ok(p) => p,
                        Err(e) => {
                            tracing::warn!(
                                path = %rel_path,
                                error = %e,
                                "Invalid file path, skipping"
                            );
                            return None;
                        }
                    };

                    // Check file size before reading to prevent memory/database bloat
                    match tokio::fs::metadata(&full_path).await {
                        Ok(meta) if meta.len() > MAX_CHECKPOINT_FILE_SIZE => {
                            tracing::warn!(
                                path = %rel_path,
                                size = meta.len(),
                                max_size = MAX_CHECKPOINT_FILE_SIZE,
                                "File too large for checkpoint, skipping"
                            );
                            return None;
                        }
                        Err(e) => {
                            tracing::warn!(
                                path = %rel_path,
                                error = %e,
                                "Failed to get file metadata, skipping"
                            );
                            return None;
                        }
                        Ok(_) => {} // File size is within limits, proceed
                    }

                    match tokio::fs::read_to_string(&full_path).await {
                        Ok(content) => {
                            let content_hash = Self::compute_hash(&content);
                            let file_size = content.len() as i64;
                            Some((rel_path, content_hash, content, file_size))
                        }
                        Err(e) => {
                            tracing::warn!(
                                path = %full_path.display(),
                                error = %e,
                                "Failed to read file for checkpoint, skipping"
                            );
                            None
                        }
                    }
                }
            })
            .collect();

        let results = join_all(file_reads).await;
        let file_data: Vec<_> = results.into_iter().flatten().collect();

        if file_data.is_empty() {
            return Err(anyhow::anyhow!("No files could be read for checkpoint"));
        }

        // Get previous content for all files in a single batch query
        let file_paths: Vec<String> = file_data
            .iter()
            .map(|(path, _, _, _)| path.clone())
            .collect();
        let previous_contents = CheckpointRepository::get_previous_file_contents_batch(
            db,
            &input.session_id,
            &file_paths,
            checkpoint_number,
        )
        .await
        .unwrap_or_default();

        // Compute diff stats for each file
        let mut file_snapshots = Vec::with_capacity(file_data.len());
        for (rel_path, content_hash, content, file_size) in file_data {
            let previous_content = previous_contents.get(&rel_path);
            let (lines_added, lines_removed) =
                compute_diff_stats(previous_content.map(|s| s.as_str()), &content);

            file_snapshots.push((
                rel_path,
                content_hash,
                content,
                file_size,
                Some(lines_added),
                Some(lines_removed),
            ));
        }

        let now = chrono::Utc::now().timestamp_millis();

        CheckpointRepository::create(
            db,
            &input.session_id,
            checkpoint_number,
            input.name.as_deref(),
            now,
            input.tool_call_id.as_deref(),
            input.is_auto,
            file_snapshots,
        )
        .await
    }

    /// Revert all files to their state at a specific checkpoint.
    ///
    /// Uses a two-phase approach for atomicity:
    /// 1. Create a safety checkpoint of current state (for recovery)
    /// 2. Write all files to a temporary directory first
    /// 3. Only if all writes succeed, move files to final locations
    ///
    /// This ensures reverts are all-or-nothing - no partial states.
    pub async fn revert_to_checkpoint(
        db: &DbConn,
        checkpoint_id: &str,
        project_path: &str,
    ) -> Result<RevertResult> {
        tracing::debug!(
            checkpoint_id = %checkpoint_id,
            project_path = %project_path,
            "Reverting to checkpoint"
        );

        // Verify checkpoint exists
        let checkpoint = CheckpointRepository::get_by_id(db, checkpoint_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Checkpoint not found: {}", checkpoint_id))?;

        // Get all file snapshots
        let snapshots = CheckpointRepository::get_file_snapshots(db, checkpoint_id).await?;

        // Create a pre-revert safety checkpoint of current file states
        // This allows users to recover if they accidentally revert to the wrong checkpoint
        if !snapshots.is_empty() {
            let modified_files: Vec<String> =
                snapshots.iter().map(|s| s.file_path.clone()).collect();

            match Self::create_checkpoint(
                db,
                CreateCheckpointInput {
                    session_id: checkpoint.session_id.clone(),
                    project_path: project_path.to_string(),
                    worktree_path: None, // Safety checkpoint uses project_path only
                    modified_files,
                    tool_call_id: Some("pre-revert-safety".to_string()),
                    name: Some(format!(
                        "Before revert to checkpoint #{}",
                        checkpoint.checkpoint_number
                    )),
                    is_auto: true,
                },
            )
            .await
            {
                Ok(safety_checkpoint) => {
                    tracing::info!(
                        safety_checkpoint_id = %safety_checkpoint.id,
                        "Created pre-revert safety checkpoint"
                    );
                }
                Err(e) => {
                    // Log but don't fail - the safety checkpoint is best-effort
                    tracing::warn!(
                        error = %e,
                        "Failed to create pre-revert safety checkpoint, continuing with revert"
                    );
                }
            }
        }

        if snapshots.is_empty() {
            return Ok(RevertResult::success(vec![]));
        }

        // Phase 1: Validate all paths and write to temp directory
        let temp_dir = TempDir::new()
            .with_context(|| "Failed to create temporary directory for atomic revert")?;

        let mut prepared_files: Vec<(PathBuf, PathBuf, String)> = Vec::new(); // (temp_path, final_path, file_path_name)
        let mut failed_files = Vec::new();

        for snapshot in &snapshots {
            // Validate path to prevent traversal attacks
            let final_path = match Self::validate_relative_path(project_path, &snapshot.file_path) {
                Ok(p) => p,
                Err(e) => {
                    failed_files.push(RevertError::new(
                        snapshot.file_path.clone(),
                        format!("Invalid path: {}", e),
                    ));
                    continue;
                }
            };

            let content = match CheckpointRepository::get_file_content(
                db,
                checkpoint_id,
                &snapshot.file_path,
            )
            .await
            {
                Ok(Some(c)) => c,
                Ok(None) => {
                    failed_files.push(RevertError::new(
                        snapshot.file_path.clone(),
                        "File content not found in checkpoint".to_string(),
                    ));
                    continue;
                }
                Err(e) => {
                    failed_files.push(RevertError::new(
                        snapshot.file_path.clone(),
                        format!("Failed to get content: {}", e),
                    ));
                    continue;
                }
            };

            // Write to temp directory
            let temp_path = temp_dir.path().join(&snapshot.file_path);
            if let Some(parent) = temp_path.parent() {
                if let Err(e) = tokio::fs::create_dir_all(parent).await {
                    failed_files.push(RevertError::new(
                        snapshot.file_path.clone(),
                        format!("Failed to create temp directory: {}", e),
                    ));
                    continue;
                }
            }

            if let Err(e) = tokio::fs::write(&temp_path, &content).await {
                failed_files.push(RevertError::new(
                    snapshot.file_path.clone(),
                    format!("Failed to write to temp: {}", e),
                ));
                continue;
            }

            prepared_files.push((temp_path, final_path, snapshot.file_path.clone()));
        }

        // If any files failed in phase 1, abort - don't do partial revert
        if !failed_files.is_empty() {
            tracing::warn!(
                checkpoint_id = %checkpoint_id,
                failed_count = failed_files.len(),
                "Revert aborted due to failures in preparation phase"
            );
            return Ok(RevertResult::failed(failed_files));
        }

        // Phase 2: Move all temp files to final locations atomically
        let mut reverted_files = Vec::new();

        for (temp_path, final_path, file_name) in prepared_files {
            // Ensure parent directory exists
            if let Some(parent) = final_path.parent() {
                if let Err(e) = tokio::fs::create_dir_all(parent).await {
                    // This shouldn't happen since we validated paths, but handle it
                    failed_files.push(RevertError::new(
                        file_name,
                        format!("Failed to create directory: {}", e),
                    ));
                    continue;
                }
            }

            // Copy from temp to final (rename may fail across filesystems)
            match tokio::fs::copy(&temp_path, &final_path).await {
                Ok(_) => {
                    reverted_files.push(file_name);
                }
                Err(e) => {
                    failed_files.push(RevertError::new(
                        file_name,
                        format!("Failed to copy file: {}", e),
                    ));
                }
            }
        }

        // Temp directory is automatically cleaned up when dropped

        let result = RevertResult::partial(reverted_files, failed_files);

        tracing::info!(
            checkpoint_id = %checkpoint_id,
            checkpoint_number = checkpoint.checkpoint_number,
            reverted = result.reverted_files.len(),
            failed = result.failed_files.len(),
            "Reverted to checkpoint"
        );

        Ok(result)
    }

    /// Revert a single file to its state at a specific checkpoint.
    pub async fn revert_file(
        db: &DbConn,
        checkpoint_id: &str,
        file_path: &str,
        project_path: &str,
    ) -> Result<()> {
        tracing::debug!(
            checkpoint_id = %checkpoint_id,
            file_path = %file_path,
            "Reverting single file"
        );

        // Validate path to prevent traversal attacks
        let validated_path = Self::validate_relative_path(project_path, file_path)?;

        // Get the file content from the checkpoint
        let content = CheckpointRepository::get_file_content(db, checkpoint_id, file_path)
            .await?
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "File '{}' not found in checkpoint '{}'",
                    file_path,
                    checkpoint_id
                )
            })?;

        Self::write_file_to_path(&validated_path, &content).await?;

        tracing::info!(
            checkpoint_id = %checkpoint_id,
            file_path = %file_path,
            "File reverted"
        );

        Ok(())
    }

    /// Get all checkpoints for a session.
    pub async fn list_checkpoints(db: &DbConn, session_id: &str) -> Result<Vec<Checkpoint>> {
        CheckpointRepository::list_for_session(db, session_id).await
    }

    /// Get file content at a specific checkpoint.
    pub async fn get_file_content_at_checkpoint(
        db: &DbConn,
        checkpoint_id: &str,
        file_path: &str,
    ) -> Result<String> {
        CheckpointRepository::get_file_content(db, checkpoint_id, file_path)
            .await?
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "File '{}' not found in checkpoint '{}'",
                    file_path,
                    checkpoint_id
                )
            })
    }

    /// Compute SHA-256 hash of content.
    fn compute_hash(content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Write file content to disk at an already-validated path.
    async fn write_file_to_path(full_path: &Path, content: &str) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = full_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("Failed to create directory: {}", parent.display()))?;
        }

        tokio::fs::write(full_path, content)
            .await
            .with_context(|| format!("Failed to write file: {}", full_path.display()))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_compute_hash() {
        let hash = CheckpointManager::compute_hash("hello world");
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64); // SHA-256 produces 64 hex characters

        // Same content should produce same hash
        let hash2 = CheckpointManager::compute_hash("hello world");
        assert_eq!(hash, hash2);

        // Different content should produce different hash
        let hash3 = CheckpointManager::compute_hash("hello world!");
        assert_ne!(hash, hash3);
    }

    #[test]
    fn test_validate_relative_path_rejects_traversal() {
        let temp_dir = tempfile::tempdir().unwrap();
        let project_path = temp_dir.path().to_str().unwrap();

        // Should reject paths with ..
        let result = CheckpointManager::validate_relative_path(project_path, "../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("traversal"));

        // Should reject paths with .. in the middle
        let result =
            CheckpointManager::validate_relative_path(project_path, "src/../../../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("traversal"));

        // Should reject absolute paths
        let result = CheckpointManager::validate_relative_path(project_path, "/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("absolute"));
    }

    #[test]
    fn test_validate_relative_path_accepts_valid_paths() {
        let temp_dir = tempfile::tempdir().unwrap();
        let project_path = temp_dir.path().to_str().unwrap();

        // Create a test file
        let test_file = temp_dir.path().join("src/test.ts");
        fs::create_dir_all(test_file.parent().unwrap()).unwrap();
        fs::write(&test_file, "test").unwrap();

        // Should accept valid relative paths
        let result = CheckpointManager::validate_relative_path(project_path, "src/test.ts");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), test_file.canonicalize().unwrap());
    }

    #[test]
    fn test_validate_relative_path_accepts_new_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let project_path = temp_dir.path().to_str().unwrap();

        // Create parent directory
        let src_dir = temp_dir.path().join("src");
        fs::create_dir_all(&src_dir).unwrap();

        // Should accept paths to non-existent files in existing directories
        let result = CheckpointManager::validate_relative_path(project_path, "src/new-file.ts");
        assert!(result.is_ok());
    }

    // ========== Path Conversion Tests ==========

    #[test]
    fn test_convert_project_path_to_relative() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("src/file.ts");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "").unwrap();

        let result = convert_to_relative_path(&file, dir.path(), None);
        assert_eq!(result.unwrap(), "src/file.ts");
    }

    #[test]
    fn test_convert_worktree_path_to_relative() {
        let project = tempfile::tempdir().unwrap();
        let worktree = tempfile::tempdir().unwrap();
        let file = worktree.path().join("src/file.ts");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "").unwrap();

        let result = convert_to_relative_path(&file, project.path(), Some(worktree.path()));
        assert_eq!(result.unwrap(), "src/file.ts");
    }

    #[test]
    fn test_convert_path_outside_boundaries_rejected() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let file = outside.path().join("file.ts");
        fs::write(&file, "").unwrap();

        let result = convert_to_relative_path(&file, project.path(), None);
        assert!(matches!(
            result,
            Err(PathConversionError::OutsideBoundaries(_))
        ));
    }

    #[test]
    fn test_convert_empty_path_rejected() {
        let project = tempfile::tempdir().unwrap();
        let empty = Path::new("");

        let result = convert_to_relative_path(empty, project.path(), None);
        assert!(matches!(result, Err(PathConversionError::EmptyPath)));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_windows_backslashes_normalized() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(r"src\lib\file.ts");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "").unwrap();

        let result = convert_to_relative_path(&file, dir.path(), None);
        assert_eq!(result.unwrap(), "src/lib/file.ts"); // Forward slashes
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_unc_path_rejected() {
        let project = tempfile::tempdir().unwrap();
        let unc = Path::new(r"\\server\share\file.ts");

        let result = convert_to_relative_path(unc, project.path(), None);
        assert!(matches!(
            result,
            Err(PathConversionError::UncNotSupported(_))
        ));
    }
}
