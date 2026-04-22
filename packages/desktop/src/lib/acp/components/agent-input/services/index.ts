/**
 * Composer / agent-input workflow services (side effects and mount policy live here).
 */

export {
	type PanelDraftMountResolution,
	resolvePanelDraftOnMount,
} from "./agent-input-mount-workflow.js";
export { prepareWorktreePathForPendingSend } from "./agent-input-worktree-send-workflow.js";
