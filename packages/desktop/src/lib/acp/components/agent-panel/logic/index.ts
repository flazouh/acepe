/**
 * Agent Panel Business Logic
 *
 * Pure functions for agent panel operations.
 * All functions use neverthrow Result types for error handling.
 */

export { mapCanonicalTurnStateToHotTurnState } from "../../../store/canonical-turn-state-mapping";
export {
	type AgentPanelBaseModel,
	type AgentPanelDisplayInput,
	type AgentPanelDisplayMemory,
	type AgentPanelDisplayModel,
	type AgentPanelDisplayResult,
	type AgentPanelDisplayRow,
	applyAgentPanelDisplayMemory,
	applyAgentPanelDisplayModelToSceneEntries,
	buildAgentPanelBaseModel,
	createAgentPanelDisplayMemory,
} from "./agent-panel-display-model.js";
export { copyCanonicalSessionToClipboard, copyTextToClipboard } from "./clipboard-manager";
export { derivePanelErrorInfo } from "./connection-ui";
export { resolveEffectiveProjectPath } from "./effective-project-path";
export { calculateLoadingProgress, isLoadingComplete } from "./loading-animator";
export {
	deriveCanonicalUserEntryPresence,
	resolveOptimisticUserEntryForGraph,
	resolveVisibleEntryCount,
} from "./optimistic-user-entry.js";
export { loadSessionPlan } from "./plan-loader";
export {
	deriveCanonicalAgentPanelSessionState,
	mapCanonicalSessionToPanelStatus,
	mapSessionStatusToUI,
} from "./session-status-mapper";
export {
	createNativeTranscriptRendererAdapter,
	createVirtuaTranscriptRendererAdapter,
	type TranscriptRendererAdapter,
} from "./transcript-renderer-adapter.js";
export {
	createInitialTranscriptViewportState,
	reduceTranscriptViewportBatch,
	reduceTranscriptViewportEvent,
	type TranscriptViewportState,
} from "./transcript-viewport-controller.js";
export {
	createTranscriptViewportDiagnostics,
	recordTranscriptViewportDiagnostic,
	type TranscriptViewportDiagnosticRecord,
	type TranscriptViewportDiagnostics,
} from "./transcript-viewport-diagnostics.js";
export {
	getTranscriptViewportEffectName,
	type TranscriptViewportEffect,
} from "./transcript-viewport-effects.js";
export {
	orderTranscriptViewportEvents,
	type TranscriptViewportEvent,
	type TranscriptViewportMeasurement,
} from "./transcript-viewport-events.js";
export { replayTranscriptViewportEvents } from "./transcript-viewport-replay.js";
export type { TranscriptViewportRowSummary } from "./transcript-viewport-row-summary.js";
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
