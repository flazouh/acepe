/**
 * Canonical mode IDs used in the UI.
 *
 * These are the normalized IDs after mapping agent-specific mode names
 * (e.g. "default", "acceptEdits", "ask") to a consistent representation.
 */
export const CanonicalModeId = {
	BUILD: "build",
	PLAN: "plan",
} as const;

export type CanonicalModeId = (typeof CanonicalModeId)[keyof typeof CanonicalModeId];

/**
 * Agent-specific build-mode aliases used by ACP agents.
 *
 * Each agent may use different mode IDs that map to the canonical "build" mode.
 * @see client.rs normalize_mode_id for Rust-side normalization
 */
export const BuildModeAlias = {
	DEFAULT: "default",
	ACCEPT_EDITS: "acceptEdits",
	ASK: "ask",
	AGENT: "agent",
} as const;

export type BuildModeAlias = (typeof BuildModeAlias)[keyof typeof BuildModeAlias];
