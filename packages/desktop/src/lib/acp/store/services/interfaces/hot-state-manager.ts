/**
 * Hot State Manager Interface
 *
 * Narrow interface for managing transient session state.
 * Extracted services use this to update streaming, connection, and mode state.
 */

import type { SessionHotState } from "../../types.js";

/**
 * Interface for managing hot state operations.
 */
export interface IHotStateManager {
	/**
	 * Get hot state for a session.
	 * Returns default hot state if session has no hot state.
	 */
	getHotState(sessionId: string): SessionHotState;

	/**
	 * Check if a session has hot state.
	 */
	hasHotState(sessionId: string): boolean;

	/**
	 * Update hot state for a session (batched for performance).
	 */
	updateHotState(sessionId: string, updates: Partial<SessionHotState>): void;

	/**
	 * Remove hot state for a session.
	 */
	removeHotState(sessionId: string): void;

	/**
	 * Initialize hot state for a session with default values.
	 */
	initializeHotState(sessionId: string, initialState?: Partial<SessionHotState>): void;
}
