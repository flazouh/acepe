import type { ModifiedFilesState } from "../components/modified-files/types/modified-files-state.js";

/**
 * Review panel for reviewing and accepting/rejecting file modifications.
 */
export interface ReviewPanel {
	/**
	 * Unique panel identifier.
	 */
	id: string;

	/**
	 * Absolute path to the project root.
	 */
	projectPath: string;

	/**
	 * Panel width in pixels.
	 */
	width: number;

	/**
	 * The aggregated modified files state from the session.
	 */
	modifiedFilesState: ModifiedFilesState;

	/**
	 * Index of the currently selected file in the files array.
	 */
	selectedFileIndex: number;
}

/**
 * Default width for review panels.
 */
export const DEFAULT_REVIEW_PANEL_WIDTH = 600;

/**
 * Minimum width for review panels.
 */
export const MIN_REVIEW_PANEL_WIDTH = 400;
