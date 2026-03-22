/**
 * Types for the chunk aggregation pure function layer.
 *
 * These types model the explicit state, inputs, and decisions
 * for the merge-vs-create logic, enabling fully deterministic
 * testing without store infrastructure.
 */

import type { ContentBlock } from "../../services/converted-session-types.js";

/**
 * Per-session aggregation state.
 * Replaces the three private fields: missingMessageIdTracker,
 * pendingAssistantBoundaries, and postBoundaryMessageIdMap.
 */
export interface AggregationState {
	readonly lastKnownMessageId: string | null;
	readonly pendingBoundaries: ReadonlySet<string>;
	readonly postBoundaryMap: ReadonlyMap<string, string>;
}

/**
 * Validated chunk input for the pure decision function.
 */
export interface ChunkInput {
	readonly messageId: string | undefined;
	readonly content: ContentBlock;
	readonly isThought: boolean;
}

/**
 * Normalized chunk with thought-prefix handling already applied.
 */
export interface NormalizedChunk {
	readonly type: "thought" | "message";
	readonly block: ContentBlock;
}

/**
 * Discriminated union for the aggregation decision.
 *
 * - merge: append chunk to existing entry identified by entryId
 * - create: create a new assistant entry with the given entryId
 */
export type ChunkDecision =
	| { readonly action: "merge"; readonly entryId: string }
	| { readonly action: "create"; readonly entryId: string; readonly boundaryConsumed: boolean };
