/**
 * Agent model preferences types.
 *
 * Defines types for storing default models and favorites per agent.
 */

import type { Mode } from "../application/dto/mode.js";
import type { Model } from "../application/dto/model.js";
import type { CanonicalModeId } from "./canonical-mode-id.js";

/**
 * Mode type for user-friendly preferences.
 * Uses canonical mode IDs. Maps to ACP: plan = plan, build = acceptEdits (Claude Code).
 */
export type ModeType = CanonicalModeId;

/**
 * Default models for a single agent.
 */
export type AgentDefaultModels = {
	plan?: string; // modelId for plan mode
	build?: string; // modelId for build mode (acceptEdits)
};

/**
 * Complete agent model preferences state.
 * Stored in SQLite and loaded on app startup.
 */
export type AgentModelPreferencesState = {
	/** Default models per agent: agentId → { plan?, build? } */
	defaults: Record<string, AgentDefaultModels>;

	/** Favorite models per agent: agentId → modelId[] */
	favorites: Record<string, string[]>;

	/** Cached available models per agent for settings display */
	availableModelsCache: Record<string, Model[]>;

	/** Cached available modes per agent for optimistic display */
	availableModesCache: Record<string, Mode[]>;
};

/**
 * Per-session model memory: remembers which model was selected per mode.
 * Stored in SQLite and restored when session resumes.
 * Format: sessionId → { modeId → modelId }
 */
export type SessionModelPerMode = Record<string, Record<string, string>>;
