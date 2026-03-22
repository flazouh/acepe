/**
 * Filter criteria for thread lists.
 *
 * All filters are optional. If a filter is not provided, it doesn't apply.
 * Multiple filters are combined with AND logic (all must match).
 */
export interface ThreadFilter {
	/**
	 * Filter by project paths.
	 * If provided, only threads from these projects will be shown.
	 */
	projectPaths?: string[];

	/**
	 * Filter by agent IDs.
	 * If provided, only threads from these agents will be shown.
	 */
	agentIds?: string[];

	/**
	 * Filter by date range.
	 * If provided, only threads created within this range will be shown.
	 */
	dateRange?: {
		start: Date;
		end: Date;
	};

	/**
	 * Search query for filtering by title, project name, or project path.
	 * Case-insensitive partial matching.
	 */
	searchQuery?: string;

	/**
	 * Filter by session IDs.
	 * If provided, only threads from these sessions will be shown.
	 */
	sessionIds?: string[];
}

/**
 * Default empty filter (shows all threads).
 */
export const EMPTY_FILTER: ThreadFilter = {};
