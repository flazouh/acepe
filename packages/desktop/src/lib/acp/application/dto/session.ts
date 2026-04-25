import type { Mode } from "./mode.js";
import type { Model } from "./model.js";
import type { SessionCapabilities } from "./session-capabilities.js";
import type { SessionEntry } from "./session-entry.js";
import type { SessionIdentity } from "./session-identity.js";
import type { SessionMetadata } from "./session-metadata.js";
import type { SessionStatus } from "./session-status.js";
import type { TaskProgress } from "./task-progress.js";

/**
 * Session - the unified data model for conversations.
 *
 * A Session is the unified concept that:
 * - Can be historical (idle, loaded from JSONL) or connected (ready/streaming with ACP)
 * - Has conversation entries and an optional plan
 * - Can have model/mode selection
 * - Tracks ACP connection state
 *
 * This interface composes from focused types:
 * - SessionIdentity: Immutable lookup keys (id, projectPath, agentId)
 * - SessionMetadata: Rarely changing data (title, timestamps, sourcePath)
 * - SessionCapabilities: ACP configuration (available models, modes, commands)
 * - Plus hot state fields (status, isConnected, etc.) and content (entries)
 *
 * The Session type is reconstructed at runtime by merging:
 * - Cold data (SessionCold = Identity + Metadata) from the store
 * - Hot state (SessionTransientProjection) from the hot state store
 * - Capabilities from ACP connection
 * - Entries from the entry store
 */
export interface Session extends SessionIdentity, SessionMetadata, SessionCapabilities {
	// Hot state fields (from SessionTransientProjection, merged at runtime)
	readonly status: SessionStatus;
	readonly isConnected: boolean;
	readonly isStreaming: boolean;
	/**
	 * Shortcut to get the ACP session ID from connection (null if not connected).
	 * Equivalent to `connection?.acpSessionId`.
	 */
	readonly acpSessionId: string | null;
	readonly currentModel: Model | null;
	readonly currentMode: Mode | null;

	// Content fields (from EntryStore, merged at runtime)
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly entryCount: number;
	readonly taskProgress: TaskProgress | null;
}

// Re-export all extracted types for backward compatibility
export type { Mode } from "./mode.js";
export type { Model } from "./model.js";
export type { SessionCapabilities } from "./session-capabilities.js";
export type { SessionCold } from "./session-cold.js";
export type { SessionEntry } from "./session-entry.js";
export { isToolCallEntry } from "./session-entry.js";
export type { SessionIdentity } from "./session-identity.js";
export type { SessionLinkedPr, SessionPrLinkMode } from "./session-linked-pr.js";
export type { SessionMetadata } from "./session-metadata.js";
export type { SessionStatus } from "./session-status.js";
export type { SessionSummary } from "./session-summary.js";
export type { TaskProgress } from "./task-progress.js";
