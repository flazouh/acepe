/**
 * Agent Panel Business Logic
 *
 * Pure functions for agent panel operations.
 * All functions use neverthrow Result types for error handling.
 */

export { copySessionToClipboard, copyTextToClipboard } from "./clipboard-manager";
export { derivePanelErrorInfo } from "./connection-ui";
export { createAutoScroll } from "./create-auto-scroll.svelte.js";
export { resolveEffectiveProjectPath } from "./effective-project-path";
export { calculateLoadingProgress, isLoadingComplete } from "./loading-animator";
export { loadSessionPlan } from "./plan-loader";
export { mapSessionStatusToUI } from "./session-status-mapper";
export { removeWorktreeAndMarkSessionWorktreeDeleted } from "./worktree-removal";
export {
	createPendingWorktreeCloseConfirmationState,
	createResolvedWorktreeCloseConfirmationState,
	shouldConfirmWorktreeClose,
} from "./worktree-close-confirmation";
export {
	createWorktreeSetupMatchContext,
	createWorktreeCreationState,
	matchesWorktreeSetupContext,
	reduceWorktreeSetupEvent,
} from "./worktree-setup-events";
