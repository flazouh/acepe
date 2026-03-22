//! Types for the file index system.

use serde::{Deserialize, Serialize};

/// Git status for a single file.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileGitStatus {
    /// Relative path from project root.
    pub path: String,
    /// Status code: M=Modified, A=Added, D=Deleted, ?=Untracked, R=Renamed.
    pub status: String,
    /// Lines added (for modified/added files).
    pub insertions: u64,
    /// Lines deleted (for modified/deleted files).
    pub deletions: u64,
}

/// Lightweight git overview for project cards and other summary UIs.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitOverview {
    /// Current branch name, if available.
    pub branch: Option<String>,
    /// Summary git status entries (may omit expensive/untracked paths in safe mode).
    pub git_status: Vec<FileGitStatus>,
}

/// Information about a single indexed file.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexedFile {
    /// Relative path from project root.
    pub path: String,
    /// File extension without dot, empty for no extension.
    pub extension: String,
    /// Number of lines in the file.
    pub line_count: u64,
    /// Git status info if file is modified/added/deleted, or None.
    pub git_status: Option<FileGitStatus>,
}

/// Complete project index result.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIndex {
    /// Project root path.
    pub project_path: String,
    /// All indexed files.
    pub files: Vec<IndexedFile>,
    /// Git-tracked modified files with status.
    pub git_status: Vec<FileGitStatus>,
    /// Total file count.
    pub total_files: u64,
    /// Total line count across all files.
    pub total_lines: u64,
}

/// Result for file diff comparison (old vs new content).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffResult {
    /// Old content from HEAD (None if new file).
    pub old_content: Option<String>,
    /// New content from working directory.
    pub new_content: String,
    /// File name (basename).
    pub file_name: String,
}
