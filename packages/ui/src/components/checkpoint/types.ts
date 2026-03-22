/**
 * Types for dumb checkpoint components.
 * These are simplified versions without backend dependencies.
 */

/**
 * A file within a checkpoint, with diff information.
 */
export interface CheckpointFile {
	/** Unique identifier for this file snapshot */
	id: string;
	/** Relative file path from project root */
	filePath: string;
	/** Lines added (null if not computed) */
	linesAdded: number | null;
	/** Lines removed (null if not computed) */
	linesRemoved: number | null;
	/** File size in bytes (optional, for display) */
	fileSize?: number;
}

/**
 * A checkpoint representing a point-in-time snapshot.
 */
export interface CheckpointData {
	/** Unique checkpoint ID */
	id: string;
	/** Ordinal checkpoint number within session (1, 2, 3...) */
	number: number;
	/** User message or context for this checkpoint */
	message: string | null;
	/** Creation timestamp (Unix ms) */
	timestamp: number;
	/** Number of files in this checkpoint */
	fileCount: number;
	/** Total lines added across all files (null if not computed) */
	totalInsertions: number | null;
	/** Total lines removed across all files (null if not computed) */
	totalDeletions: number | null;
	/** Whether this is an auto-checkpoint (vs manual) */
	isAuto: boolean;
}

/**
 * Diff content for a file.
 */
export interface FileDiff {
	/** The file path */
	filePath: string;
	/** The diff content (unified diff format or plain content) - new content */
	content: string;
	/** Language for syntax highlighting */
	language?: string;
	/** Previous checkpoint content for diff. null = new file, omitted = plain fallback */
	oldContent?: string | null;
}

/**
 * State for a single checkpoint in the timeline.
 */
export interface CheckpointState {
	/** Whether the checkpoint is expanded to show files */
	isExpanded: boolean;
	/** Whether files are loading */
	isLoadingFiles: boolean;
	/** Whether a revert is in progress */
	isReverting: boolean;
	/** Files for this checkpoint (loaded when expanded) */
	files: CheckpointFile[];
}

/**
 * State for a file row in the file list.
 */
export interface FileRowState {
	/** Whether the file diff is expanded */
	isDiffExpanded: boolean;
	/** Whether the diff is loading */
	isLoadingDiff: boolean;
	/** Whether a revert is in progress for this file */
	isReverting: boolean;
	/** The diff content (loaded when expanded) */
	diff: FileDiff | null;
}
