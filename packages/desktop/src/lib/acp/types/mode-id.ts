/**
 * Mode ID type.
 *
 * Represents a unique identifier for a session mode.
 * For canonical UI modes, prefer CanonicalModeId from canonical-mode-id.ts.
 *
 * @see https://agentclientprotocol.com/protocol/#sessionmodeid
 */
export type ModeId = string;

export {
	BuildModeAlias,
	type CanonicalModeId as CanonicalModeIdType,
	CanonicalModeId,
} from "./canonical-mode-id.js";
