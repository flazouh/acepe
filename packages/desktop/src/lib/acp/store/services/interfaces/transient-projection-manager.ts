/**
 * transient projection Manager Interface
 *
 * Narrow interface for managing transient session state.
 * Extracted services use this to update streaming, connection, and mode state.
 */

import type { SessionTransientProjection } from "../../types.js";

/**
 * Interface for managing transient projection operations.
 */
export interface ITransientProjectionManager {
	/**
	 * Get transient projection for a session.
	 * Returns default transient projection if session has no transient projection.
	 */
	getHotState(sessionId: string): SessionTransientProjection;

	/**
	 * Check if a session has transient projection.
	 */
	hasHotState(sessionId: string): boolean;

	/**
	 * Update transient projection for a session (batched for performance).
	 */
	updateHotState(sessionId: string, updates: Partial<SessionTransientProjection>): void;

	/**
	 * Remove transient projection for a session.
	 */
	removeHotState(sessionId: string): void;

	/**
	 * Initialize transient projection for a session with default values.
	 */
	initializeHotState(sessionId: string, initialState?: Partial<SessionTransientProjection>): void;
}
