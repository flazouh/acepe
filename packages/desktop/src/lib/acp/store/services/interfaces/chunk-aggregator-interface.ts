/**
 * Chunk Aggregator Interface
 *
 * Product-facing boundary/cleanup interface for assistant streaming state.
 * Compatibility row aggregation is a concrete legacy helper, not a service
 * contract.
 */

import type { IBoundaryManager } from "./boundary-manager.js";

export interface IChunkAggregator extends IBoundaryManager {
	clearStreamingAssistantEntry(sessionId: string): void;
	clearSession(sessionId: string): void;
}
