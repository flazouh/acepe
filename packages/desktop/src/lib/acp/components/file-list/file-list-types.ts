import type { FileGitStatus } from "$lib/services/converted-session-types.js";

/**
 * Node in a file tree structure.
 */
export interface FileTreeNode {
	/**
	 * File or folder name.
	 */
	name: string;

	/**
	 * Relative path from project root.
	 */
	path: string;

	/**
	 * Whether this is a directory.
	 */
	isDirectory: boolean;

	/**
	 * Child nodes (only for directories).
	 */
	children: FileTreeNode[];

	/**
	 * File extension (only for files).
	 */
	extension: string;

	/**
	 * Depth in the tree (0 = root level).
	 */
	depth: number;

	/**
	 * Git status for this file (null if unmodified).
	 */
	gitStatus?: Omit<FileGitStatus, "path"> | null;

	/**
	 * Whether any descendant file has git modifications (directories only).
	 */
	hasModifiedDescendants?: boolean;
}

/**
 * Group of files by project.
 */
export interface FileGroup {
	/**
	 * Absolute path to the project root.
	 */
	projectPath: string;

	/**
	 * Project display name.
	 */
	projectName: string;

	/**
	 * Project color for visual identification.
	 */
	projectColor: string | undefined;

	/**
	 * Root-level file tree nodes.
	 */
	files: FileTreeNode[];

	/**
	 * Total file count in this project.
	 */
	totalFiles: number;

	/**
	 * Whether files are currently loading.
	 */
	loading: boolean;

	/**
	 * Error message if loading failed.
	 */
	error: string | null;
}
