/**
 * Queue section utilities - Pure functions for grouping queue items into sections.
 *
 * This file is intentionally kept free of Svelte runtime imports ($state, etc.)
 * so it can be tested in plain .ts test files.
 */

import type { QueueItem } from "./types.js";
import {
	deriveSessionWorkProjection,
	selectQueueWorkBucket,
	selectSessionWorkBucket,
} from "../session-work-projection.js";

/**
 * Section IDs for the queue display.
 * Order matches display order in the UI.
 */
export type QueueSectionId = "answer_needed" | "planning" | "working" | "needs_review" | "error";

/**
 * A grouped section of queue items for display.
 */
export interface QueueSectionGroup {
	readonly id: QueueSectionId;
	readonly items: readonly QueueItem[];
}

/** Ordered section IDs for consistent rendering. */
const SECTION_ORDER: readonly QueueSectionId[] = [
	"answer_needed",
	"planning",
	"working",
	"needs_review",
	"error",
];

/**
 * A session needs review only when:
 * - The LLM turn has reached ready state
 * - The completion is still unseen by the user
 */
export function isNeedsReview(
	item: Pick<QueueItem, "status" | "state" | "connectionError" | "activeTurnFailure">
): boolean {
	return (
		selectSessionWorkBucket(
			deriveSessionWorkProjection({
				state: item.state,
				currentModeId: null,
				connectionError: item.connectionError,
				activeTurnFailure: item.activeTurnFailure ?? null,
			})
		) === "needs_review"
	);
}

/**
 * Classify a queue item into a section using the unified session state model.
 */
export function classifyItem(item: QueueItem): QueueSectionId | null {
	return selectQueueWorkBucket(
		deriveSessionWorkProjection({
			state: item.state,
			currentModeId: item.currentModeId,
			connectionError: item.connectionError,
			activeTurnFailure: item.activeTurnFailure ?? null,
		})
	);
}

/**
 * Group active items into ordered sections, omitting empty ones.
 */
export function groupIntoSections(activeItems: readonly QueueItem[]): QueueSectionGroup[] {
	const buckets = new Map<QueueSectionId, QueueItem[]>();
	for (const item of activeItems) {
		const sectionId = classifyItem(item);
		if (sectionId === null) {
			continue;
		}
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
