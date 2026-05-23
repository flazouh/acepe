/**
 * Entry Manager Interface
 *
 * Narrow interface for lifecycle-facing entry operations.
 * Services may finalize tool rows, but they must not create, remove, or update
 * transcript rows directly.
 */

/**
 * Interface for managing session entries.
 */
export interface IEntryManager {
	/**
	 * Check if session is preloaded.
	 */
	isPreloaded(sessionId: string): boolean;

	/**
	 * Clear entries for a session.
	 */
	clearEntries(sessionId: string): void;

	/**
	 * Mark all still-streaming tool call entries as not streaming.
	 * Called on turn completion so pending tools stop shimmering.
	 */
	finalizeStreamingEntries(sessionId: string): void;
}
