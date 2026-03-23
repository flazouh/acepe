//! Types for the checkpoint system.

use serde::{Deserialize, Serialize};

/// A checkpoint representing a point-in-time snapshot of modified files.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    /// Unique checkpoint ID
    pub id: String,
    /// Session this checkpoint belongs to
    pub session_id: String,
    /// Ordinal checkpoint number within session (1, 2, 3...)
    pub checkpoint_number: i32,
    /// Optional name (user-provided or auto-generated)
    pub name: Option<String>,
    /// Creation timestamp (Unix ms)
    pub created_at: i64,
    /// Tool call ID that triggered this checkpoint (for auto-checkpoints)
    pub tool_call_id: Option<String>,
    /// Whether this is an auto-checkpoint (vs manual)
    pub is_auto: bool,
    /// Number of files in this checkpoint
    pub file_count: i32,
    /// Total lines added across all files (None if not computed)
    pub total_lines_added: Option<i32>,
    /// Total lines removed across all files (None if not computed)
    pub total_lines_removed: Option<i32>,
}

/// A file snapshot within a checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    /// Unique snapshot ID
    pub id: String,
    /// Checkpoint this snapshot belongs to
    pub checkpoint_id: String,
    /// Relative file path from project root
    pub file_path: String,
    /// SHA-256 hash for content deduplication
    pub content_hash: String,
    /// File size in bytes
    pub file_size: i64,
    /// Lines added compared to previous checkpoint (None for old checkpoints)
    pub lines_added: Option<i32>,
    /// Lines removed compared to previous checkpoint (None for old checkpoints)
    pub lines_removed: Option<i32>,
}

/// Result of a revert operation.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RevertResult {
    /// Whether the overall operation succeeded
    pub success: bool,
    /// Files that were successfully reverted
    pub reverted_files: Vec<String>,
    /// Files that failed to revert
    pub failed_files: Vec<RevertError>,
}

impl RevertResult {
    /// Create a successful result with the given reverted files.
    pub fn success(reverted_files: Vec<String>) -> Self {
        Self {
            success: true,
            reverted_files,
            failed_files: Vec::new(),
        }
    }

    /// Create a partial success result.
    pub fn partial(reverted_files: Vec<String>, failed_files: Vec<RevertError>) -> Self {
        Self {
            success: failed_files.is_empty(),
            reverted_files,
            failed_files,
        }
    }

    /// Create a failed result.
    pub fn failed(failed_files: Vec<RevertError>) -> Self {
        Self {
            success: false,
            reverted_files: Vec::new(),
            failed_files,
        }
    }
}

/// Error information for a single file revert failure.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RevertError {
    /// The file path that failed
    pub file_path: String,
    /// The error message
    pub error: String,
}

impl RevertError {
    /// Create a new revert error.
    pub fn new(file_path: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            file_path: file_path.into(),
            error: error.into(),
        }
    }
}

/// Old and new file content for diff display.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffContent {
    /// Content from previous checkpoint. None if this is a new file in the timeline.
    pub old_content: Option<String>,
    /// Content at the current checkpoint.
    pub new_content: String,
}

/// Input for creating a checkpoint.
#[derive(Debug, Clone)]
pub struct CreateCheckpointInput {
    pub session_id: String,
    pub project_path: String,
    /// Optional worktree path for sessions operating in git worktrees.
    /// When set, absolute paths within the worktree will be converted to relative paths.
    pub worktree_path: Option<String>,
    pub modified_files: Vec<String>,
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
    pub is_auto: bool,
}
