/**
 * Agent Panel Business Logic
 *
 * Pure functions for agent panel operations.
 * All functions use neverthrow Result types for error handling.
 */

export { mapCanonicalTurnStateToPresentationStatus } from "../../../store/canonical-turn-state-mapping";
export { copyTextToClipboard } from "./clipboard-manager";
export { derivePanelErrorInfo, shouldShowInlinePanelError } from "./connection-ui";
export { resolveEffectiveProjectPath } from "./effective-project-path";
export { calculateLoadingProgress, isLoadingComplete } from "./loading-animator";
export { shouldShowNewThreadSetupContext } from "./new-thread-setup-context.js";
export {
	deriveCanonicalUserEntryPresence,
	resolveOptimisticUserEntryForGraph,
	resolveVisibleEntryCount,
} from "./optimistic-user-entry.js";
export { loadSessionPlan } from "./plan-loader";
export { resolvePlanningPlaceholderPresentation } from "./planning-placeholder-presentation.js";
export {
	resolveOptimisticHeaderTitle,
	shouldShowClaudeWorkingSpark,
} from "./pre-session-optimistic-identity.js";
export {
	deriveCanonicalAgentPanelSessionState,
	mapCanonicalSessionToPanelStatus,
	mapSessionStatusToUI,
	resolveCanonicalAgentPanelSessionSource,
	resolveCanonicalAgentPanelTurnState,
} from "./session-status-mapper";
export {
	createWorktreeCreationState,
	createWorktreeSetupMatchContext,
	matchesWorktreeSetupContext,
	reduceWorktreeSetupEvent,
} from "./worktree-setup-events";
