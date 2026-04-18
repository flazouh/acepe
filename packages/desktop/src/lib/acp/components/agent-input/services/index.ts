/**
 * Composer / agent-input workflow services (side effects and mount policy live here).
 */

export { prepareWorktreePathForPendingSend } from "./agent-input-worktree-send-workflow.js";
export {
	resolvePanelDraftOnMount,
	type PanelDraftMountResolution,
} from "./agent-input-mount-workflow.js";
