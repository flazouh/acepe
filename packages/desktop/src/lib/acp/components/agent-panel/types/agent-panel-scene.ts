import type { AgentPanelSurfaceIntents } from "./agent-panel-intents.js";

/**
 * Stable scene contracts for thin agent-panel controllers (incremental adoption).
 * `intents` is populated by the shell as callbacks toward workflow services.
 */
export type AgentPanelSceneModel = {
	readonly panelId: string | undefined;
	readonly sessionId: string | null;
	readonly intents?: AgentPanelSurfaceIntents;
};
