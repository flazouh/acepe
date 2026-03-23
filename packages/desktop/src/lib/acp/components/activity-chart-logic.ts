/**
 * Pure logic for computing activity chart data.
 */

export interface DailyCount {
	date: Date;
	count: number;
}

/**
 * Computes daily thread counts for the last N days.
 * Returns array of DailyCount objects, one for each day,
 * sorted chronologically (oldest to newest).
 */
export function computeDailyCounts(
	sessions: ReadonlyArray<{ updatedAt: Date }>,
	days: number = 30
): DailyCount[] {
	// Get the current date at start of day
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	// Create map of date strings to counts
	const counts = new Map<string, number>();

	// Initialize all days with 0 count
	for (let i = days - 1; i >= 0; i--) {
		const date = new Date(today);
		date.setDate(date.getDate() - i);
		const dateKey = date.toISOString().split("T")[0]; // YYYY-MM-DD format
		counts.set(dateKey, 0);
	}

	// Count sessions per day
	for (const session of sessions) {
		const sessionDate = new Date(session.updatedAt);
		const sessionDay = new Date(
			sessionDate.getFullYear(),
			sessionDate.getMonth(),
			sessionDate.getDate()
		);

		// Only count sessions within the last N days
		const daysDiff = Math.floor((today.getTime() - sessionDay.getTime()) / (1000 * 60 * 60 * 24));
		if (daysDiff >= 0 && daysDiff < days) {
			const dateKey = sessionDay.toISOString().split("T")[0];
			const currentCount = counts.get(dateKey) || 0;
			counts.set(dateKey, currentCount + 1);
		}
	}

	// Convert to array sorted by date (oldest first)
	return Array.from(counts.entries())
		.map(([dateKey, count]) => ({
			date: new Date(`${dateKey}T00:00:00.000Z`),
			count,
		}))
		.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Gets the maximum count from daily counts for scaling bars.
 */
export function getMaxCount(dailyCounts: ReadonlyArray<DailyCount>): number {
	return Math.max(...dailyCounts.map((d) => d.count), 1); // Minimum of 1 to avoid division by zero
}
