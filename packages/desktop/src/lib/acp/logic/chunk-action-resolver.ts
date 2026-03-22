/**
 * Pure functions for chunk aggregation decisions.
 *
 * The core logic: given current state + chunk input, determine
 * whether to merge, create, or replace, and return the next state.
 *
 * No side effects. No store access. Fully deterministic and testable.
 *
 * Replaces and extends the previous resolveChunkAggregation function
 * by incorporating state transitions that were previously scattered
 * across processChunkForSession and createNewAssistantEntry.
 */

import type { AggregationState, ChunkDecision, ChunkInput } from "./chunk-aggregation-types.js";

/**
 * Create an empty initial aggregation state for a new session.
 */
export function createInitialState(): AggregationState {
	return {
		lastKnownMessageId: null,
		pendingBoundaries: new Set(),
		postBoundaryMap: new Map(),
	};
}

/**
 * Resolve the effective message ID from the input, falling back to the
 * last known message ID from state (replaces MissingMessageIdTracker.resolve).
 */
function resolveMessageId(
	state: AggregationState,
	inputMessageId: string | undefined
): string | null {
	if (typeof inputMessageId === "string" && inputMessageId.length > 0) {
		return inputMessageId;
	}
	return state.lastKnownMessageId;
}

/**
 * Resolve the source message ID to the effective entry ID.
 * Before boundary split this is identity; after split it resolves to remapped id.
 * (Replaces SessionEntryStore.resolveAssistantEntryId)
 */
function resolveEntryId(state: AggregationState, sourceMessageId: string | null): string | null {
	if (!sourceMessageId) {
		return null;
	}
	const mapped = state.postBoundaryMap.get(sourceMessageId);
	return mapped ?? sourceMessageId;
}

function isPunctuationCarryoverChunk(input: ChunkInput): boolean {
	if (input.content.type !== "text") {
		return false;
	}

	const text = input.content.text;
	if (text.trim().length === 0) {
		return false;
	}

	// Boundary carryover chunks can arrive as punctuation-only deltas (e.g., ".")
	// immediately before/after tool events. Keep them attached to the pre-tool sentence.
	return /^[\s.,!?;:)\]}>"'`-]+$/.test(text);
}

function resolveSinglePendingBoundaryTarget(
	state: AggregationState,
	entryExists: (id: string) => boolean
): string | null {
	if (state.pendingBoundaries.size !== 1) {
		return null;
	}
	const [boundaryId] = state.pendingBoundaries;
	if (!boundaryId) {
		return null;
	}
	return entryExists(boundaryId) ? boundaryId : null;
}

/**
 * Core aggregation decision: given current state and a chunk,
 * determine whether to merge or create, and compute next state.
 *
 * The decision chain:
 * 1. Resolve messageId (input or fallback to last known)
 * 2. Check for pending boundary (tool call split)
 * 3. If no boundary, resolve effective entry ID (via postBoundaryMap)
 * 4. If entry ID exists → merge
 * 5. Otherwise → create new entry (with boundary consumption if applicable)
 *
 * @param state - Current per-session aggregation state
 * @param input - Validated chunk input
 * @param entryExists - Callback: does an assistant entry with this ID exist?
 * @param generateId - ID generator for new entries (injectable for testing)
 */
export function resolveChunkAction(
	state: AggregationState,
	input: ChunkInput,
	entryExists: (id: string) => boolean,
	generateId: () => string = () => crypto.randomUUID()
): { decision: ChunkDecision; nextState: AggregationState } {
	// Step 1: Resolve messageId
	const sourceMessageId = resolveMessageId(state, input.messageId);

	// Step 2: Check boundary
	const hasPendingBoundary =
		sourceMessageId !== null && state.pendingBoundaries.has(sourceMessageId);

	// Step 3: Resolve effective entry ID (skip if boundary active)
	const effectiveEntryId = hasPendingBoundary ? null : resolveEntryId(state, sourceMessageId);

	// Step 4: If we have an effective entry ID AND the entry exists, merge
	if (effectiveEntryId !== null && entryExists(effectiveEntryId)) {
		return {
			decision: { action: "merge", entryId: effectiveEntryId },
			nextState: {
				...state,
				lastKnownMessageId: sourceMessageId,
			},
		};
	}

	// Special case: keep punctuation-only carryover chunks on the pre-boundary entry.
	// Do not consume the boundary so the next semantic chunk still starts a new entry.
	if (
		hasPendingBoundary &&
		sourceMessageId !== null &&
		entryExists(sourceMessageId) &&
		isPunctuationCarryoverChunk(input)
	) {
		return {
			decision: { action: "merge", entryId: sourceMessageId },
			nextState: {
				...state,
				lastKnownMessageId: sourceMessageId,
			},
		};
	}

	// Codex often omits message IDs on token chunks. If a punctuation-only
	// carryover chunk arrives while exactly one boundary is pending, keep it on
	// the pre-tool entry rather than starting a post-tool message with ".".
	if (
		sourceMessageId === null &&
		isPunctuationCarryoverChunk(input) &&
		state.pendingBoundaries.size > 0
	) {
		const boundaryTarget = resolveSinglePendingBoundaryTarget(state, entryExists);
		if (boundaryTarget) {
			return {
				decision: { action: "merge", entryId: boundaryTarget },
				nextState: {
					...state,
					lastKnownMessageId: boundaryTarget,
				},
			};
		}
	}

	// Step 6: Create new entry
	// Determine entry ID: use sourceMessageId if available and not colliding
	let entryId: string;
	const shouldConsumeBoundary = hasPendingBoundary && sourceMessageId !== null;

	if (sourceMessageId !== null && !hasPendingBoundary && !entryExists(sourceMessageId)) {
		entryId = sourceMessageId;
	} else {
		entryId = generateId();
	}

	// Compute next state
	let nextPendingBoundaries = state.pendingBoundaries;
	let nextPostBoundaryMap = state.postBoundaryMap;

	if (shouldConsumeBoundary) {
		// Consume the boundary: remove from pending, add to postBoundaryMap
		const newBoundaries = new Set(state.pendingBoundaries);
		newBoundaries.delete(sourceMessageId);
		nextPendingBoundaries = newBoundaries;

		const newMap = new Map(state.postBoundaryMap);
		newMap.set(sourceMessageId, entryId);
		nextPostBoundaryMap = newMap;
	}

	return {
		decision: { action: "create", entryId, boundaryConsumed: shouldConsumeBoundary },
		nextState: {
			lastKnownMessageId: sourceMessageId ?? entryId,
			pendingBoundaries: nextPendingBoundaries,
			postBoundaryMap: nextPostBoundaryMap,
		},
	};
}

/**
 * Split aggregation boundary when a tool call appears.
 *
 * Marks the current active message ID as a boundary, so the next
 * chunk with that source message ID creates a new entry instead
 * of merging into the existing one.
 *
 * @param state - Current per-session aggregation state
 * @returns New state with boundary flags set, or unchanged state if no active message
 */
export function splitBoundary(state: AggregationState): AggregationState {
	const activeMessageId = state.lastKnownMessageId;

	if (!activeMessageId) {
		return state;
	}

	const newBoundaries = new Set(state.pendingBoundaries);
	newBoundaries.add(activeMessageId);

	// Remove stale postBoundary mapping for this message ID
	let newPostBoundaryMap: ReadonlyMap<string, string> = state.postBoundaryMap;
	if (state.postBoundaryMap.has(activeMessageId)) {
		const mutableMap = new Map(state.postBoundaryMap);
		mutableMap.delete(activeMessageId);
		newPostBoundaryMap = mutableMap;
	}

	return {
		lastKnownMessageId: null,
		pendingBoundaries: newBoundaries,
		postBoundaryMap: newPostBoundaryMap,
	};
}
