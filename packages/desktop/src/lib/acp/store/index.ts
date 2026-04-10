/**
 * Store exports.
 *
 * This module re-exports all stores and their types for convenient importing.
 */

export type {
	AgentDefaultModels,
	AgentModelPreferencesState,
	ModeType,
	SessionModelPerMode,
} from "../types/agent-model-preferences.js";
// Agent model preferences store (module-level, not context-based)
export * as agentModelPreferencesStore from "./agent-model-preferences-store.svelte.js";
export {
	type AgentPreferencesInitializationInput,
	type AgentPreferencesInitializationState,
	AgentPreferencesStore,
	createAgentPreferencesStore,
	deriveAgentPreferencesInitializationState,
	filterItemsBySelectedAgentIds,
	getAgentPreferencesStore,
	intersectSelectedAgentIds,
	upsertCustomAgentConfigs,
	validateAndNormalizeSelectedAgentIds,
} from "./agent-preferences-store.svelte.js";
// New stores (Context Composition pattern)
export { AgentStore, createAgentStore, getAgentStore } from "./agent-store.svelte.js";
// API
export { api } from "./api";
export {
	ChatPreferencesStore,
	createChatPreferencesStore,
	getChatPreferencesStore,
} from "./chat-preferences-store.svelte.js";
export {
	ConnectionStore,
	createConnectionStore,
	getConnectionStore,
} from "./connection-store.svelte.js";
export {
	type GitHubDiffViewerReference,
	GitHubDiffViewerStore,
	gitHubDiffViewerStore,
	type OpenGitHubDiffViewerInput,
} from "./github-diff-viewer-store.svelte.js";
export {
	createInteractionStore,
	getInteractionStore,
	InteractionStore,
} from "./interaction-store.svelte.js";
// Message queue store (per-session message stacking)
export {
	createMessageQueueStore,
	getMessageQueueStore,
	type MessageQueueStore,
	type QueuedMessage,
	serializeWithAttachments,
} from "./message-queue/index.js";
export {
	createOperationStore,
	getOperationStore,
	OperationStore,
} from "./operation-store.svelte.js";
export { createPanelStore, getPanelStore, PanelStore } from "./panel-store.svelte.js";
export {
	createPermissionStore,
	getPermissionStore,
	PermissionStore,
} from "./permission-store.svelte.js";
export {
	createPlanPreferenceStore,
	getPlanPreferenceStore,
	PlanPreferenceStore,
} from "./plan-preference-store.svelte.js";
export { createPlanStore, getPlanStore, PlanStore } from "./plan-store.svelte.js";
export { createQuestionStore, getQuestionStore, QuestionStore } from "./question-store.svelte.js";
export type { QueueItem } from "./queue/index.js";
// Queue store
export {
	createQueueStore,
	getQueueStore,
	type QueueStore,
	type QueueUpdateInput,
} from "./queue/index.js";
export {
	createReviewPreferenceStore,
	getReviewPreferenceStore,
	ReviewPreferenceStore,
} from "./review-preference-store.svelte.js";
export { LiveInteractionProjectionSync } from "./services/live-interaction-projection-sync.js";
export { SessionProjectionHydrator } from "./services/session-projection-hydrator.js";
// Session state model
export type {
	ActivityState,
	AttentionMeta,
	ConnectionPhase,
	DeriveSessionStateInput,
	PendingInput,
	SessionState,
} from "./session-state.js";
export {
	assertValidSessionState,
	createAttentionMeta,
	createConnectedIdleState,
	createConnectingState,
	createDisconnectedState,
	createErrorState,
	// Factory functions
	createIdleActivity,
	createNoPendingInput,
	createPausedActivity,
	createPendingPermission,
	createPendingQuestion,
	createStreamingActivity,
	createThinkingActivity,
	// State derivation
	deriveSessionState,
	hasAnyPendingInput,
	hasNoPendingInput,
	hasPendingPermission,
	hasPendingQuestion,
	IMPOSSIBLE_STATES,
	isActiveWork,
	// Type guards
	isIdleActivity,
	isPausedActivity,
	isStreamingActivity,
	isThinkingActivity,
	// Validation
	isValidSessionState,
} from "./session-state.js";
export {
	createSessionStore,
	getSessionStore,
	SessionStore,
	type SessionStoreCallbacks,
} from "./session-store.svelte.js";
export {
	createTabBarStore,
	getTabBarStore,
	TabBarStore,
	type TabBarTab,
} from "./tab-bar-store.svelte.js";
// Types
export type {
	Agent,
	HistoryEntry,
	Mode,
	Model,
	Panel,
	PanelHotState,
	PanelLayout,
	PersistedFilePanelState,
	PersistedWorkspaceState,
	ResumeSessionResult,
	Session,
	SessionEntry,
	SessionStatus,
	TaskProgress,
} from "./types";
// Constants
export { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH } from "./types";
export { createUnseenStore, getUnseenStore, UnseenStore } from "./unseen-store.svelte.js";
// Urgency types
export type { UrgencyInfo, UrgencyLevel } from "./urgency.js";
export { compareUrgency, deriveUrgency, getUrgencyPriority } from "./urgency.js";
export {
	createUrgencyTabsStore,
	getUrgencyTabsStore,
	UrgencyTabsStore,
} from "./urgency-tabs-store.svelte.js";
export {
	createWorkspaceStore,
	getWorkspaceStore,
	WorkspaceStore,
} from "./workspace-store.svelte.js";
