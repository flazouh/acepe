/**
 * Entry Manager Interface
 *
 * Narrow interface for lifecycle-facing entry operations.
 * Services may clear or finalize compatibility rows, but they must not create,
 * remove, or update transcript rows directly.
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
	 * Mark session as preloaded.
	 */
	markPreloaded(sessionId: string): void;

	/**
	 * Clear entries for a session.
	 */
	clearEntries(sessionId: string): void;

	/**
	 * Clear any in-progress assistant aggregation state for a session.
	 */
	clearStreamingAssistantEntry(sessionId: string): void;

	/**
	 * Start a fresh assistant turn. The next assistant chunks must not merge into
	 * a prior assistant entry, even when a provider reuses or omits message IDs.
	 */
	startNewAssistantTurn(sessionId: string): void;

	/**
	 * Mark all still-streaming tool call entries as not streaming.
	 * Called on turn completion so pending tools stop shimmering.
	 */
	finalizeStreamingEntries(sessionId: string): void;
}
