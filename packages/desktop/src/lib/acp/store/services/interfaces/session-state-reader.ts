/**
 * Session State Reader Interface
 *
 * Narrow interface for reading session state.
 * Extracted services use this to access session data without circular dependencies.
 */

import type { SessionGraphLifecycle } from "../../../../services/acp-types.js";
import type { CanonicalSessionProjection } from "../../canonical-session-projection.js";
import type {
	SessionCapabilities,
	SessionCold,
	SessionEntry,
	SessionTransientProjection,
} from "../../types.js";

/**
 * Interface for reading session state.
 */
export interface ISessionStateReader {
	/**
	 * Get hot state for a session.
	 */
	getHotState(sessionId: string): SessionTransientProjection;

	/**
	 * Canonical actionability gate. Returns null when no canonical graph has
	 * materialized yet and callers must use their compatibility fallback.
	 */
	getSessionCanSend?(sessionId: string): boolean | null;

	/**
	 * Canonical lifecycle status. Used when a caller needs to distinguish
	 * reserved first-send activation from a detached historical reconnect.
	 */
	getSessionLifecycleStatus?(sessionId: string): SessionGraphLifecycle["status"] | null;

	/**
	 * Canonical autonomous setting. Returns false when no canonical projection has materialized.
	 */
	getSessionAutonomousEnabled?(sessionId: string): boolean;

	/**
	 * Canonical current mode id. Returns null when no canonical projection or selected mode exists.
	 */
	getSessionCurrentModeId?(sessionId: string): string | null;

	/**
	 * Canonical capabilities projection. Returns empty capabilities when no
	 * canonical projection has materialized.
	 */
	getSessionCapabilities?(sessionId: string): SessionCapabilities;

	/**
	 * Canonical session projection (lifecycle + activity + turn state + active
	 * failure). Returns null before the first canonical envelope arrives;
	 * callers must treat that as the only legitimate hot-state fallback window.
	 */
	getCanonicalSessionProjection?(sessionId: string): CanonicalSessionProjection | null;

	/**
	 * Get entries for a session.
	 */
	getEntries(sessionId: string): SessionEntry[];

	/**
	 * Check if a session's entries have been preloaded.
	 */
	isPreloaded(sessionId: string): boolean;

	/**
	 * Get all sessions for a project path.
	 */
	getSessionsForProject(projectPath: string): SessionCold[];

	/**
	 * Get session cold data by ID from the lookup map (O(1)).
	 */
	getSessionCold(id: string): SessionCold | undefined;

	/**
	 * Get all sessions (cold data only).
	 */
	getAllSessions(): SessionCold[];
}
