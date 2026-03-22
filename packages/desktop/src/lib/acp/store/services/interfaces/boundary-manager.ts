/**
 * Boundary Manager Interface
 *
 * Narrow interface for tool call boundary splitting.
 * ChunkAggregator implements this; ToolCallManager consumes it
 * to split assistant aggregation at tool call boundaries.
 */

export interface IBoundaryManager {
	/** Force subsequent assistant chunks to start a new entry. */
	splitAssistantAggregationBoundary(sessionId: string): void;
}
