import { AGENT_IDS } from "../types/agent-id.js";
import {
	BuildModeAlias,
	CanonicalModeId,
	type CanonicalModeId as CanonicalModeIdType,
} from "../types/canonical-mode-id.js";

/**
 * UI mode name to backend mode ID mapping.
 *
 * Maps user-friendly UI mode names to their corresponding backend mode IDs.
 * Note: The Rust backend normalizes all agent-specific IDs (e.g., "acceptEdits") to standard IDs.
 */
export const UI_TO_BACKEND_MODE_MAP: Record<string, string> = {
	[CanonicalModeId.BUILD]: CanonicalModeId.BUILD,
	[CanonicalModeId.PLAN]: CanonicalModeId.PLAN,
} as const;

/**
 * Backend mode ID to UI mode name mapping.
 *
 * Converts backend IDs to user-friendly display names.
 * Note: The Rust backend normalizes IDs, so we only need to handle "build" and "plan".
 */
export const BACKEND_TO_UI_MODE_MAP: Record<string, string> = {
	[CanonicalModeId.BUILD]: "Build",
	[CanonicalModeId.PLAN]: "Plan",
} as const;

/**
 * Backend mode IDs that should be visible in the UI.
 *
 * Only these modes will be shown in the mode selector.
 * Note: The Rust backend normalizes all agent-specific IDs to these standard IDs.
 */
export const VISIBLE_BACKEND_MODE_IDS: readonly [string, string] = [
	CanonicalModeId.BUILD,
	CanonicalModeId.PLAN,
] as const;

/**
 * Per-agent mode aliases → canonical UI mode.
 *
 * Each agent may use different mode IDs that map to canonical "build" or "plan".
 * Mirrors Rust client.rs normalize_mode_id and map_outbound_mode_id.
 */
export const MODE_ALIASES_BY_AGENT: Record<string, Record<string, CanonicalModeIdType>> = {
	[AGENT_IDS.CLAUDE_CODE]: {
		[BuildModeAlias.DEFAULT]: CanonicalModeId.BUILD,
		[BuildModeAlias.ACCEPT_EDITS]: CanonicalModeId.BUILD,
	},
	[AGENT_IDS.CURSOR]: {
		[BuildModeAlias.ASK]: CanonicalModeId.BUILD,
		[BuildModeAlias.AGENT]: CanonicalModeId.BUILD,
	},
	[AGENT_IDS.CODEX]: {
		// Codex typically uses build/plan directly
	},
	[AGENT_IDS.OPENCODE]: {
		// OpenCode typically uses build/plan directly
	},
};

/** Fallback map when agent is unknown or not in MODE_ALIASES_BY_AGENT. */
const FALLBACK_MODE_ALIASES: Record<string, CanonicalModeIdType> = {
	[BuildModeAlias.DEFAULT]: CanonicalModeId.BUILD,
	[BuildModeAlias.ACCEPT_EDITS]: CanonicalModeId.BUILD,
	[BuildModeAlias.ASK]: CanonicalModeId.BUILD,
	[BuildModeAlias.AGENT]: CanonicalModeId.BUILD,
};

const CANONICAL_IDS = new Set<string>(Object.values(CanonicalModeId));

/** Normalize any agent mode ID to canonical CanonicalModeId. */
export function normalizeModeIdForUI(modeId: string, agentId?: string): CanonicalModeIdType {
	if (CANONICAL_IDS.has(modeId)) {
		return modeId as CanonicalModeIdType;
	}
	if (agentId) {
		const agentMap = MODE_ALIASES_BY_AGENT[agentId];
		if (agentMap?.[modeId]) {
			return agentMap[modeId];
		}
	}
	return FALLBACK_MODE_ALIASES[modeId] ?? CanonicalModeId.BUILD;
}
