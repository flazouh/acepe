import type { Mode } from "./mode.js";
import type { Model } from "./model.js";
import type { SessionCapabilities } from "./session-capabilities.js";
import type { SessionEntry } from "./session-entry.js";
import type { SessionIdentity } from "./session-identity.js";
import type { SessionMetadata } from "./session-metadata.js";
import type { SessionStatus } from "./session-status.js";
import type { TaskProgress } from "./task-progress.js";

/**
 * Session - legacy full conversation DTO.
 *
 * Prefer focused selectors and canonical projections for new code:
 * - cold identity and metadata come from SessionCold
 * - lifecycle/activity/failure/capability truth comes from the Rust-owned
 *   SessionStateGraph projection
 * - transcript rows come from canonical transcript snapshot/delta projection
 * - operation details come from the canonical operation graph
 *
 * This type remains for component boundaries that still consume a combined
 * shape. Do not treat it as a source of truth or add repair/fallback logic here.
 */
export interface Session extends SessionIdentity, SessionMetadata, SessionCapabilities {
	// Canonical-derived presentation fields.
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

	// Projected transcript content.
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly entryCount: number;
	readonly taskProgress: TaskProgress | null;
}
