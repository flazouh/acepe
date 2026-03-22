import type { SessionDisplayItem } from "../types/thread-display-item.js";
import type { ThreadFilter } from "../types/thread-filter.js";

import { getTimeGroup } from "./thread-list-date-utils.js";

/**
 * Filters threads by search query.
 *
 * @param threads - Array of threads to filter
 * @param searchQuery - Search query string
 * @returns Filtered array of threads
 */
export function filterThreadsByQuery(
	threads: SessionDisplayItem[],
	searchQuery: string
): SessionDisplayItem[] {
	if (!searchQuery.trim()) {
		return threads;
	}

	const query = searchQuery.toLowerCase();
	return threads.filter(
		(thread) =>
			thread.title.toLowerCase().includes(query) ||
			thread.projectName.toLowerCase().includes(query) ||
			thread.projectPath.toLowerCase().includes(query)
	);
}

/**
 * Groups threads by time category.
 *
 * @param threads - Array of threads to group
 * @returns Record mapping time group labels to arrays of threads
 */
export function groupThreadsByTime(
	threads: SessionDisplayItem[]
): Record<string, SessionDisplayItem[]> {
	const groups: Record<string, SessionDisplayItem[]> = {};

	for (const thread of threads) {
		const groupResult = getTimeGroup(thread.createdAt);
		// Use "Older" as fallback for invalid dates
		const group = groupResult.isOk() ? groupResult.value : "Older";
		if (!groups[group]) {
			groups[group] = [];
		}
		groups[group].push(thread);
	}

	return groups;
}

export type ProjectGroup = {
	projectPath: string;
	projectName: string;
	projectColor?: string;
	threads: SessionDisplayItem[];
};

/**
 * Groups threads by project.
 *
 * @param threads - Array of threads to group
 * @returns Array of project groups, sorted by most recent thread
 */
export function groupThreadsByProject(threads: SessionDisplayItem[]): ProjectGroup[] {
	const projectMap = new Map<string, ProjectGroup>();

	for (const thread of threads) {
		const existing = projectMap.get(thread.projectPath);
		if (existing) {
			existing.threads.push(thread);
		} else {
			projectMap.set(thread.projectPath, {
				projectPath: thread.projectPath,
				projectName: thread.projectName,
				projectColor: thread.projectColor,
				threads: [thread],
			});
		}
	}

	// Convert to array and sort each project's threads by date (newest first)
	const groups = Array.from(projectMap.values());
	for (const group of groups) {
		group.threads.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	}

	// Sort projects by their most recent thread
	groups.sort((a, b) => {
		const aLatest = a.threads[0]?.createdAt.getTime() ?? 0;
		const bLatest = b.threads[0]?.createdAt.getTime() ?? 0;
		return bLatest - aLatest;
	});

	return groups;
}

/**
 * Applies a filter to a list of threads.
 *
 * All filter criteria are combined with AND logic (all must match).
 *
 * @param threads - Array of threads to filter
 * @param filter - Filter criteria to apply
 * @returns Filtered array of threads
 *
 * @example
 * ```typescript
 * const filtered = applyThreadFilter(threads, {
 *   projectPaths: ["/path/to/project"],
 *   agentIds: ["claude-code"],
 *   searchQuery: "bug fix"
 * });
 * ```
 */
export function applyThreadFilter(
	threads: SessionDisplayItem[],
	filter: ThreadFilter
): SessionDisplayItem[] {
	let filtered = threads;

	// Filter by project paths
	if (filter.projectPaths && filter.projectPaths.length > 0) {
		const projectPathSet = new Set(filter.projectPaths);
		filtered = filtered.filter((thread) => projectPathSet.has(thread.projectPath));
	}

	// Filter by agent IDs
	if (filter.agentIds && filter.agentIds.length > 0) {
		const agentIdSet = new Set(filter.agentIds);
		filtered = filtered.filter((thread) => agentIdSet.has(thread.agentId));
	}

	// Filter by date range
	if (filter.dateRange) {
		const { start, end } = filter.dateRange;
		filtered = filtered.filter((thread) => {
			const threadDate = thread.createdAt.getTime();
			return threadDate >= start.getTime() && threadDate <= end.getTime();
		});
	}

	// Filter by search query
	if (filter.searchQuery) {
		filtered = filterThreadsByQuery(filtered, filter.searchQuery);
	}

	// Filter by session IDs (thread.id IS the session ID)
	if (filter.sessionIds && filter.sessionIds.length > 0) {
		const sessionIdSet = new Set(filter.sessionIds);
		filtered = filtered.filter((thread) => sessionIdSet.has(thread.id));
	}

	return filtered;
}

/**
 * Filters threads by project path.
 *
 * @param threads - Array of threads to filter
 * @param projectPath - Project path to filter by
 * @returns Filtered array of threads
 */
export function filterThreadsByProject(
	threads: SessionDisplayItem[],
	projectPath: string
): SessionDisplayItem[] {
	return threads.filter((thread) => thread.projectPath === projectPath);
}

/**
 * Filters threads by agent ID.
 *
 * @param threads - Array of threads to filter
 * @param agentId - Agent ID to filter by
 * @returns Filtered array of threads
 */
export function filterThreadsByAgent(
	threads: SessionDisplayItem[],
	agentId: string
): SessionDisplayItem[] {
	return threads.filter((thread) => thread.agentId === agentId);
}

/**
 * Filters threads by date range.
 *
 * @param threads - Array of threads to filter
 * @param start - Start date (inclusive)
 * @param end - End date (inclusive)
 * @returns Filtered array of threads
 */
export function filterThreadsByDateRange(
	threads: SessionDisplayItem[],
	start: Date,
	end: Date
): SessionDisplayItem[] {
	return threads.filter((thread) => {
		const threadDate = thread.createdAt.getTime();
		return threadDate >= start.getTime() && threadDate <= end.getTime();
	});
}
