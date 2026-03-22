/**
 * File panel representing an open file in the workspace.
 */
export interface FilePanel {
	/**
	 * Unique panel identifier.
	 */
	id: string;

	/**
	 * Relative file path within the project.
	 */
	filePath: string;

	/**
	 * Absolute path to the project root.
	 */
	projectPath: string;

	/**
	 * Owning agent panel ID when file was opened from an agent panel.
	 * Null means this is a global/non-attached file panel.
	 */
	ownerPanelId: string | null;

	/**
	 * Panel width in pixels.
	 */
	width: number;

	/**
	 * Optional 1-based line to focus when opening the file.
	 */
	targetLine?: number;

	/**
	 * Optional 1-based column to focus when opening the file.
	 */
	targetColumn?: number;
}

/**
 * Default width for file panels.
 */
export const DEFAULT_FILE_PANEL_WIDTH = 500;

/**
 * Minimum width for file panels.
 */
export const MIN_FILE_PANEL_WIDTH = 300;
