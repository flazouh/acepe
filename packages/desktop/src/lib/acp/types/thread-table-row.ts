import type { SessionDisplayItem } from "./thread-display-item.js";
import type { ThreadStatistics } from "./thread-stats.js";

/**
 * A thread row for the data table, combining display info with statistics.
 *
 * This is the shape of data displayed in the project page thread table.
 * It combines thread display information with computed statistics.
 */
export type ThreadTableRow = SessionDisplayItem & {
	/**
	 * Thread statistics (may be undefined while loading).
	 */
	stats?: ThreadStatistics;

	/**
	 * Whether statistics are currently loading.
	 */
	statsLoading?: boolean;

	/**
	 * Error message if statistics failed to load.
	 */
	statsError?: string;

	/**
	 * Computed duration in milliseconds (updated - created).
	 */
	duration?: number;
};
