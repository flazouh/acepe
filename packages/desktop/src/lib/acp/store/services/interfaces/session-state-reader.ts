/**
 * Session State Reader Interface
 *
 * Narrow interface for reading session state.
 * Extracted services use this to access session data without circular dependencies.
 */

import type { SessionCold, SessionEntry, SessionHotState } from "../../types.js";

/**
 * Interface for reading session state.
 */
export interface ISessionStateReader {
	/**
	 * Get hot state for a session.
	 */
	getHotState(sessionId: string): SessionHotState;

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
