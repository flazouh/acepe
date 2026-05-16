/**
 * Canonical mode IDs used in the UI.
 *
 * These are the normalized IDs emitted by backend session capabilities.
 */
export const CanonicalModeId = {
	BUILD: "build",
	PLAN: "plan",
} as const;

export type CanonicalModeId = (typeof CanonicalModeId)[keyof typeof CanonicalModeId];
