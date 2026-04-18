import type { ComposerSurfaceIntents } from "./composer-intents.js";

/**
 * Stable scene contracts for the composer / agent-input controller (incremental adoption).
 */
export type ComposerSceneModel = {
	readonly panelId: string | undefined;
	readonly sessionId: string | null;
	readonly intents?: ComposerSurfaceIntents;
};
