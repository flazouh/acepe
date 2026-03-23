import { err, ok, type Result } from "neverthrow";
import { TIME_CONSTANTS, TIME_GROUPS } from "../constants/thread-list-constants.js";
import { invalidTimestampError, type ThreadListError } from "../errors/thread-list-error.js";

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});

/**
 * Formats a date as a relative time string (e.g., "5m", "2h", "3d").
 *
 * @param date - The date to format
 * @returns Result containing formatted time string or an error if date is invalid
 */
export function formatTimeAgo(date: Date): Result<string, ThreadListError> {
	// Validate date is finite
	if (!Number.isFinite(date.getTime())) {
		return err(invalidTimestampError(date.getTime()));
	}

	const now = new Date();
	const diffMs = now.getTime() - date.getTime();

	// Handle invalid or future dates
	if (!Number.isFinite(diffMs) || diffMs < 0) {
		return err(invalidTimestampError(date.getTime()));
	}

	const diffMins = Math.floor(diffMs / TIME_CONSTANTS.MINUTE);
	const diffHours = Math.floor(diffMs / TIME_CONSTANTS.HOUR);
	const diffDays = Math.floor(diffMs / TIME_CONSTANTS.DAY);

	if (diffMins < 1) return ok("Just now");
	if (diffMins < 60) return ok(`${diffMins}m`);
	if (diffHours < 24) return ok(`${diffHours}h`);
	if (diffDays < 7) return ok(`${diffDays}d`);

	const formatted = SHORT_DATE_FORMAT.format(date);
	return ok(formatted);
}

/**
 * Groups a date into a time category (Today, Yesterday, This week, etc.).
 *
 * @param date - The date to group
 * @returns Result containing time group label or an error if date is invalid
 */
export function getTimeGroup(date: Date): Result<string, ThreadListError> {
	// Validate date is finite
	if (!Number.isFinite(date.getTime())) {
		return err(invalidTimestampError(date.getTime()));
	}

	const now = new Date();
	const diffMs = now.getTime() - date.getTime();

	// Handle invalid or future dates
	if (!Number.isFinite(diffMs) || diffMs < 0) {
		return err(invalidTimestampError(date.getTime()));
	}

	const diffDays = Math.floor(diffMs / TIME_CONSTANTS.DAY);

	if (diffDays === 0) return ok(TIME_GROUPS.TODAY);
	if (diffDays === 1) return ok(TIME_GROUPS.YESTERDAY);
	if (diffDays < 7) return ok(TIME_GROUPS.THIS_WEEK);
	if (diffDays < 30) return ok(TIME_GROUPS.THIS_MONTH);
	return ok(TIME_GROUPS.OLDER);
}

/**
 * Validates and creates a Date from a timestamp.
 *
 * @param timestamp - The timestamp to validate and convert
 * @returns Result containing valid Date object or an error if timestamp is invalid
 */
export function createValidDate(timestamp: unknown): Result<Date, ThreadListError> {
	if (
		typeof timestamp === "number" &&
		Number.isFinite(timestamp) &&
		timestamp >= 0 &&
		timestamp < Number.MAX_SAFE_INTEGER
	) {
		const date = new Date(timestamp);
		// Double-check the Date is valid
		if (Number.isFinite(date.getTime())) {
			return ok(date);
		}
	}
	// Invalid timestamp, return error
	return err(invalidTimestampError(timestamp));
}
