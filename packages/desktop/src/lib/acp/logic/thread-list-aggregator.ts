import { err, ok, type Result } from "neverthrow";

import type { SessionDisplayItem } from "../types/thread-display-item.js";
import type { ThreadFilter } from "../types/thread-filter.js";

import { mergeAndSortSessions } from "./thread-list-converter.js";
import { applyThreadFilter } from "./thread-list-filter.js";

/**
 * Aggregates threads from multiple sources into a unified list.
 *
 * Combines active threads and historical conversations, applies filters,
 * and returns a sorted, deduplicated list.
 *
 * @param activeThreads - Array of active thread display items
 * @param historicalConversations - Array of historical conversation display items
 * @param filter - Optional filter to apply
 * @returns Result containing the aggregated and filtered threads
 *
 * @example
 * ```typescript
 * const result = aggregateThreads(activeThreads, historicalConversations, {
 *   projectPaths: ["/path/to/project"],
 *   searchQuery: "bug"
 * });
 * result
 *   .map(threads => console.log('Filtered threads:', threads))
 *   .mapErr(error => console.error('Error:', error));
 * ```
 */
export function aggregateThreads(
	activeThreads: SessionDisplayItem[],
	historicalConversations: SessionDisplayItem[],
	filter?: ThreadFilter
): Result<SessionDisplayItem[], Error> {
	// Merge active threads and historical conversations
	const merged = mergeAndSortSessions(activeThreads, historicalConversations);

	// Apply filter if provided
	const filtered = filter ? applyThreadFilter(merged, filter) : merged;

	return ok(filtered);
}

/**
 * Validates that a filter is well-formed.
 *
 * @param filter - The filter to validate
 * @returns Result containing void on success or an error if invalid
 */
export function validateFilter(filter: ThreadFilter): Result<void, Error> {
	// Validate date range if provided
	if (filter.dateRange) {
		const { start, end } = filter.dateRange;
		if (start.getTime() > end.getTime()) {
			return err(new Error("Date range start must be before or equal to end"));
		}
	}

	// Validate arrays are not empty (empty arrays mean "no matches")
	if (filter.projectPaths && filter.projectPaths.length === 0) {
		return err(new Error("projectPaths array cannot be empty"));
	}
	if (filter.agentIds && filter.agentIds.length === 0) {
		return err(new Error("agentIds array cannot be empty"));
	}
	if (filter.sessionIds && filter.sessionIds.length === 0) {
		return err(new Error("sessionIds array cannot be empty"));
	}

	return ok(undefined);
}
