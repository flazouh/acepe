import { CanonicalModeId, type CanonicalModeId as CanonicalModeIdType } from "../types/canonical-mode-id.js";

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

const CANONICAL_IDS = new Set<string>(Object.values(CanonicalModeId));

/** Normalize backend-provided mode ID to canonical CanonicalModeId. */
export function normalizeModeIdForUI(modeId: string, _agentId?: string): CanonicalModeIdType {
	if (CANONICAL_IDS.has(modeId)) {
		return modeId as CanonicalModeIdType;
	}
	return CanonicalModeId.BUILD;
}
