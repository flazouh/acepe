import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { PrGenerationConfig } from "../../modified-files/modified-files-header.svelte";
import type { MergeStrategy } from "$lib/utils/tauri-client/git.js";

/**
 * Named product intents the thin `agent-panel` controller exposes.
 * Handlers in `agent-panel.svelte` implement these; workflow services own side effects.
 */
export type AgentPanelSurfaceIntents = {
	readonly requestClose: () => void | Promise<void>;
	readonly requestCreatePr: (config?: PrGenerationConfig) => void | Promise<void>;
	readonly requestMergePr: (strategy: MergeStrategy) => void | Promise<void>;
	readonly requestCopyThread: () => void | Promise<void>;
	readonly requestOpenInFinder: () => void | Promise<void>;
	readonly requestRetryConnection: () => void;
	readonly requestToggleCheckpointTimeline: () => void | Promise<void>;
	readonly requestEnterReviewMode: (filesState: ModifiedFilesState) => void;
};
