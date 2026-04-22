/**
 * Agent panel workflow services — async orchestration and Tauri boundaries for the thin panel shell.
 */

export {
	type AgentInputQueueRestore,
	cancelQueuedMessageAndRestoreInput,
	clearMessageQueue,
	removeAttachmentFromQueuedMessage,
	sendQueuedMessageNow,
} from "../logic/queue-strip-handlers.js";
export {
	loadCheckpointsBeforeTimelineOpen,
	scheduleCheckpointReloadAfterRevert,
} from "./agent-panel-checkpoint-timeline-service.js";
export { runPanelConnectionRetry } from "./agent-panel-connection-retry-service.js";
export {
	fetchPanelGitBranch,
	fetchWorktreeHasUncommittedChanges,
	fetchWorktreePathListedForProject,
	removeWorktreeFromDisk,
} from "./agent-panel-git-worktree-service.js";
export {
	persistSessionPrNumber,
	persistSessionWorktreePathAfterRename,
} from "./agent-panel-session-history-service.js";
export {
	copyStreamingLogPathToClipboard,
	copyThreadContentToClipboard,
	exportSessionJsonToClipboard,
	exportSessionMarkdownToClipboard,
	openSessionFileInAcepePanel,
	openSessionInFinder,
	openSessionRawFileInEditor,
	openStreamingLog,
} from "./agent-panel-session-menu-workflow.js";
export type { CreatePrWorkflowDeps } from "./agent-panel-ship-workflow.js";
export { runCreatePrWorkflow, runMergePrWorkflow } from "./agent-panel-ship-workflow.js";
export { subscribeGitWorktreeSetupChannel } from "./agent-panel-worktree-setup-channel.js";
export { discardPreparedWorktreeSessionLaunch } from "./prepared-worktree-launch-service.js";
