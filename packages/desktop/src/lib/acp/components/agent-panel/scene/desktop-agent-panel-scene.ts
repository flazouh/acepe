// Re-export hub for the desktop agent-panel scene projection modules.
// Production scene assembly runs through createAgentPanelGraphMaterializerReadModel
// in session-state/agent-panel-graph-materializer.ts; this barrel keeps the
// historical module surface for activity-entry-projection, permission-bar,
// agent-panel-graph-materializer, virtual-session-list, and scene tests.

export {
	buildDesktopErrorCard,
	buildDesktopInstallCard,
	buildDesktopPrCard,
	buildDesktopWorktreeCard,
} from "./cards.js";
export { buildDesktopComposerModel } from "./composer-model.js";
export {
	mapSessionEntriesToConversationModel,
	mapSessionEntryToConversationEntry,
	mapSessionStatusToSceneStatus,
	mapVirtualizedDisplayEntryToConversationEntry,
} from "./conversation-model.js";
export { buildDesktopPlanSidebar } from "./plan-sidebar.js";
export type {
	DesktopAgentPanelHeaderInput,
	DesktopComposerInput,
	DesktopErrorCardInput,
	DesktopInstallCardInput,
	DesktopPrCardInput,
	DesktopWorktreeCardInput,
} from "./scene-input-types.js";
export { buildModifiedFilesStrip, buildPlanHeaderStrip } from "./strips.js";
export { mapToolCallToSceneEntry } from "./tool/tool-call-entry.js";
