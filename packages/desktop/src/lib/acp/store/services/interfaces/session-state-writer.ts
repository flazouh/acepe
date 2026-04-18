/**
 * Session State Writer Interface
 *
 * Narrow interface for writing session state.
 * Extracted services use this to modify session data.
 */

import type { SessionOpenFound } from "../../../../services/acp-types.js";
import type { SessionCold } from "../../types.js";

/**
 * Interface for writing session state.
 */
export interface ISessionStateWriter {
	/**
	 * Add a session to the store.
	 */
	addSession(session: SessionCold): void;

	/**
	 * Update a session's cold metadata.
	 */
	updateSession(id: string, updates: Partial<SessionCold>): void;

	/**
	 * Apply a canonical session-open snapshot to the store.
	 */
	replaceSessionOpenSnapshot(snapshot: SessionOpenFound): void;

	/**
	 * Remove a session from the store.
	 */
	removeSession(sessionId: string): void;

	/**
	 * Set sessions array (for bulk operations like loadSessions).
	 */
	setSessions(sessions: SessionCold[]): void;

	/**
	 * Set loading state.
	 */
	setLoading(loading: boolean): void;

	/**
	 * Mark project paths as currently being scanned.
	 */
	addScanningProjects(paths: string[]): void;

	/**
	 * Clear scanning state for project paths.
	 */
	removeScanningProjects(paths: string[]): void;
}
