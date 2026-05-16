/**
 * Agent Panel Business Logic
 *
 * Pure functions for agent panel operations.
 * All functions use neverthrow Result types for error handling.
 */

export { mapCanonicalTurnStateToHotTurnState } from "../../../store/canonical-turn-state-mapping";
export { copySessionToClipboard, copyTextToClipboard } from "./clipboard-manager";
export { derivePanelErrorInfo } from "./connection-ui";
export { resolveEffectiveProjectPath } from "./effective-project-path";
export { calculateLoadingProgress, isLoadingComplete } from "./loading-animator";
export { loadSessionPlan } from "./plan-loader";
export {
	createInitialTranscriptViewportState,
	reduceTranscriptViewportBatch,
	reduceTranscriptViewportEvent,
	type TranscriptViewportState,
} from "./transcript-viewport-controller.js";
export {
	orderTranscriptViewportEvents,
	type TranscriptViewportEvent,
	type TranscriptViewportMeasurement,
} from "./transcript-viewport-events.js";
export {
	getTranscriptViewportEffectName,
	type TranscriptViewportEffect,
} from "./transcript-viewport-effects.js";
export type { TranscriptViewportRowSummary } from "./transcript-viewport-row-summary.js";
export {
	createNativeTranscriptRendererAdapter,
	createVirtuaTranscriptRendererAdapter,
	type TranscriptRendererAdapter,
} from "./transcript-renderer-adapter.js";
export {
	createTranscriptViewportDiagnostics,
	recordTranscriptViewportDiagnostic,
	type TranscriptViewportDiagnosticRecord,
	type TranscriptViewportDiagnostics,
} from "./transcript-viewport-diagnostics.js";
export { replayTranscriptViewportEvents } from "./transcript-viewport-replay.js";
export {
	resolveOptimisticUserEntryForGraph,
	resolveVisibleEntryCount,
} from "./optimistic-user-entry.js";
export {
	applyAgentPanelDisplayMemory,
	applyAgentPanelDisplayModelToSceneEntries,
	buildAgentPanelBaseModel,
	createAgentPanelDisplayMemory,
	type AgentPanelBaseModel,
	type AgentPanelDisplayInput,
	type AgentPanelDisplayMemory,
	type AgentPanelDisplayModel,
	type AgentPanelDisplayResult,
	type AgentPanelDisplayRow,
} from "./agent-panel-display-model.js";
export { backfillSceneEntryTimestamps } from "./backfill-scene-entry-timestamps.js";
export {
	deriveCanonicalAgentPanelSessionState,
	mapCanonicalSessionToPanelStatus,
	mapSessionStatusToUI,
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
