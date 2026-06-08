/**
 * Shared types for the agent-panel review-content surface. Extracted from
 * agent-panel-review-content.svelte into a .ts module so non-component code
 * (e.g. ReviewDialogController) can import the type — a `.svelte`-exported
 * type is not importable from plain .ts under the type checker.
 */

/** Snapshot of the review-content control state surfaced to the host shell. */
export interface ReviewControlsSnapshot {
	hasPendingHunks: boolean;
	hasPrevPendingFile: boolean;
	hasNextPendingFile: boolean;
	fileCurrent: number;
	fileTotal: number;
	onPrevFile: () => void;
	onNextFile: () => void;
	onAcceptFile: () => void;
	onRejectFile: () => void;
}
