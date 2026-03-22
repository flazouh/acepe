/**
 * Queue section utilities - Pure functions for grouping queue items into sections.
 *
 * This file is intentionally kept free of Svelte runtime imports ($state, etc.)
 * so it can be tested in plain .ts test files.
 */

import type { QueueItem } from "./types.js";

/**
 * Section IDs for the queue display.
 * Order matches display order in the UI.
 */
export type QueueSectionId = "answer_needed" | "working" | "finished" | "error";

/**
 * A grouped section of queue items for display.
 */
export interface QueueSectionGroup {
	readonly id: QueueSectionId;
	readonly items: readonly QueueItem[];
}

/** Ordered section IDs for consistent rendering. */
const SECTION_ORDER: readonly QueueSectionId[] = ["answer_needed", "working", "finished", "error"];

/**
 * A session is "finished attention" only when:
 * - The LLM turn has reached ready state
 * - The completion is still unseen by the user
 */
export function isFinishedAttention(item: Pick<QueueItem, "status" | "state">): boolean {
	return item.status === "ready" && item.state.attention.hasUnseenCompletion;
}

/**
 * Classify a queue item into a section using the unified session state model.
 */
export function classifyItem(item: QueueItem): QueueSectionId {
	const { state } = item;

	// Priority 1: Pending input — user must respond before agent can continue.
	// The SSE connection stays open (activity = streaming) while waiting for
	// permission/question responses, so pending input must be checked first.
	if (state.pendingInput.kind !== "none") return "answer_needed";

	// Priority 2: Active work (streaming or thinking with no pending input)
	if (state.activity.kind === "streaming" || state.activity.kind === "thinking") {
		return "working";
	}

	// Priority 3: Errors
	if (state.connection === "error") return "error";

	// Priority 4: Unseen completions (only when idle)
	if (state.activity.kind === "idle" && state.attention.hasUnseenCompletion) {
		return "finished";
	}

	// Priority 5: Paused treated as working
	if (state.activity.kind === "paused") return "working";

	// Default: idle sessions not in queue (but if we get here, treat as finished)
	return "finished";
}

/**
 * Group active items into ordered sections, omitting empty ones.
 */
export function groupIntoSections(activeItems: readonly QueueItem[]): QueueSectionGroup[] {
	const buckets = new Map<QueueSectionId, QueueItem[]>();
	for (const item of activeItems) {
		const sectionId = classifyItem(item);
		const bucket = buckets.get(sectionId);
		if (bucket) {
			bucket.push(item);
		} else {
			buckets.set(sectionId, [item]);
		}
	}

	// Sort items within each bucket by last activity (most recent first)
	for (const bucket of buckets.values()) {
		bucket.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}

	// Return sections in display order, skipping empty ones
	return SECTION_ORDER.filter((id) => buckets.has(id)).map((id) => ({
		id,
		items: buckets.get(id)!,
	}));
}
