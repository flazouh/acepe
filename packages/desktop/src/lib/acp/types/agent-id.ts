import type { CanonicalAgentId } from "../../services/claude-history-types.js";

/**
 * Agent identifier type.
 *
 * Represents which ACP agent a thread belongs to.
 * This is a branded string type for type safety.
 */
export type AgentId = string & { readonly __brand: "AgentId" };

/**
 * Built-in agent ID constants.
 *
 * Derived from Specta-generated CanonicalAgentId (Rust source of truth).
 * Must stay in sync with claude-history-types.ts.
 */
export const AGENT_IDS = {
	CLAUDE_CODE: "claude-code",
	CURSOR: "cursor",
	OPENCODE: "opencode",
	CODEX: "codex",
} as const satisfies Record<string, Extract<CanonicalAgentId, string>>;

/**
 * Create an AgentId from a string.
 */
export function agentId(id: string): AgentId {
	return id as AgentId;
}

/**
 * Check if a string is a valid agent ID.
 */
export function isValidAgentId(id: string): id is AgentId {
	return typeof id === "string" && id.length > 0;
}
