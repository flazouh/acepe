/**
 * Shared types for the agent-panel review-content surface. Extracted from
 * agent-panel-review-content.svelte into a .ts module so non-component code
 * (e.g. ReviewDialogController) can import the type — a `.svelte`-exported
 * type is not importable from plain .ts under the type checker.
 */

/** Snapshot of the review-content control state surfaced to the host shell. */
export interface ReviewControlsSnapshot {
	fileCurrent: number;
	fileTotal: number;
	/** Whether the CURRENT file is marked reviewed. */
	isReviewed: boolean;
	/**
	 * Toggle the current file's reviewed status. When it BECOMES reviewed, the
	 * review content auto-advances to the next unreviewed file if one exists;
	 * otherwise it stays on the current file (never closes the modal).
	 */
	onToggleReviewed: () => void;
	/** Revert the current file's working-tree changes. The caller shows the confirm. */
	onRevertFile: () => void;
	hasPrevFile: boolean;
	hasNextFile: boolean;
	onPrevFile: () => void;
	onNextFile: () => void;
}
