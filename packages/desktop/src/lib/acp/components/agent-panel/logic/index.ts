/**
 * Agent Panel Business Logic
 *
 * Pure functions for agent panel operations.
 * All functions use neverthrow Result types for error handling.
 */

export { mapCanonicalTurnStateToPresentationStatus } from "../../../store/canonical-turn-state-mapping";
export { copyTextToClipboard } from "./clipboard-manager";
export { derivePanelErrorInfo } from "./connection-ui";
export { resolveEffectiveProjectPath } from "./effective-project-path";
export { calculateLoadingProgress, isLoadingComplete } from "./loading-animator";
export { loadSessionPlan } from "./plan-loader";
export {
	deriveCanonicalUserEntryPresence,
	resolveOptimisticUserEntryForGraph,
	resolveVisibleEntryCount,
} from "./optimistic-user-entry.js";
export {
	applyAgentPanelDisplayMemory,
	buildAgentPanelBaseModel,
	createAgentPanelDisplayMemory,
	createAgentPanelDisplaySceneEntriesReadModel,
	createAgentPanelDisplayRowsReadModel,
	type AgentPanelBaseModel,
	type AgentPanelDisplaySceneEntriesReadModel,
	type AgentPanelDisplayInput,
	type AgentPanelDisplayMemory,
	type AgentPanelDisplayModel,
	type AgentPanelDisplayResult,
	type AgentPanelDisplayRow,
	type AgentPanelDisplayRowsProjection,
	type AgentPanelDisplayRowsReadModel,
} from "./agent-panel-display-model.js";
export {
	deriveCanonicalAgentPanelSessionState,
	mapCanonicalSessionToPanelStatus,
	mapSessionStatusToUI,
	resolveCanonicalAgentPanelSessionSource,
	resolveCanonicalAgentPanelTurnState,
} from "./session-status-mapper";
export { resolveVisibleSessionEntries } from "./visible-session-entries";
export {
	createPendingWorktreeCloseConfirmationState,
	createResolvedWorktreeCloseConfirmationState,
	shouldConfirmWorktreeClose,
} from "./worktree-close-confirmation";
export { removeWorktreeAndMarkSessionWorktreeDeleted } from "./worktree-removal";
export {
	createWorktreeCreationState,
	createWorktreeSetupMatchContext,
	matchesWorktreeSetupContext,
	reduceWorktreeSetupEvent,
} from "./worktree-setup-events";
