/**
 * Time formatting utilities.
 */

/**
 * Format a timestamp as a relative time string (e.g. "2m", "1h", "3d").
 * Returns null if the timestamp is in the future or less than 1 minute ago.
 */
export function formatTimeAgo(timestampMs: number, nowMs: number = Date.now()): string | null {
	const diffMs = nowMs - timestampMs;
	if (diffMs < 60_000) return null; // Less than 1 minute

	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;

	const days = Math.floor(hours / 24);
	return `${days}d`;
}
