/**
 * Checkpoint types for file versioning and revert functionality.
 *
 * These types mirror the Rust types in src-tauri/src/checkpoint/types.rs.
 */

/**
 * A checkpoint representing a point-in-time snapshot of modified files.
 */
export interface Checkpoint {
	/** Unique checkpoint ID */
	id: string;
	/** Session this checkpoint belongs to */
	sessionId: string;
	/** Ordinal checkpoint number within session (1, 2, 3...) */
	checkpointNumber: number;
	/** Optional name (user-provided or auto-generated) */
	name: string | null;
	/** Creation timestamp (Unix ms) */
	createdAt: number;
	/** Tool call ID that triggered this checkpoint (for auto-checkpoints) */
	toolCallId: string | null;
	/** Whether this is an auto-checkpoint (vs manual) */
	isAuto: boolean;
	/** Number of files in this checkpoint */
	fileCount: number;
	/** Total lines added across all files (null if not computed) */
	totalLinesAdded: number | null;
	/** Total lines removed across all files (null if not computed) */
	totalLinesRemoved: number | null;
}

/**
 * A file snapshot within a checkpoint.
 */
export interface FileSnapshot {
	/** Unique snapshot ID */
	id: string;
	/** Checkpoint this snapshot belongs to */
	checkpointId: string;
	/** Relative file path from project root */
	filePath: string;
	/** SHA-256 hash for content deduplication */
	contentHash: string;
	/** File size in bytes */
	fileSize: number;
	/** Lines added compared to previous checkpoint (null for old checkpoints) */
	linesAdded: number | null;
	/** Lines removed compared to previous checkpoint (null for old checkpoints) */
	linesRemoved: number | null;
}

/**
 * Result of a revert operation.
 */
export interface RevertResult {
	/** Whether the overall operation succeeded */
	success: boolean;
	/** Files that were successfully reverted */
	revertedFiles: string[];
	/** Files that failed to revert */
	failedFiles: RevertError[];
}

/**
 * Error information for a single file revert failure.
 */
export interface RevertError {
	/** The file path that failed */
	filePath: string;
	/** The error message */
	error: string;
}

/**
 * Input for creating a checkpoint.
 */
export interface CreateCheckpointInput {
	sessionId: string;
	projectPath: string;
	/**
	 * Optional worktree path for sessions operating in git worktrees.
	 * When set, absolute paths within the worktree will be converted to relative paths.
	 */
	worktreePath?: string;
	modifiedFiles: string[];
	toolCallId?: string;
	name?: string;
	isAuto: boolean;
}
