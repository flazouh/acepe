import * as Result from "effect/Result";
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
export function formatTimeAgo(date: Date): Result.Result<string, ThreadListError> {
	// Validate date is finite
	if (!Number.isFinite(date.getTime())) {
		return Result.fail(invalidTimestampError(date.getTime()));
	}

	const now = new Date();
	const diffMs = now.getTime() - date.getTime();

	// Handle invalid or future dates
	if (!Number.isFinite(diffMs) || diffMs < 0) {
		return Result.fail(invalidTimestampError(date.getTime()));
	}

	const diffMins = Math.floor(diffMs / TIME_CONSTANTS.MINUTE);
	const diffHours = Math.floor(diffMs / TIME_CONSTANTS.HOUR);
	const diffDays = Math.floor(diffMs / TIME_CONSTANTS.DAY);

	if (diffMins < 1) return Result.succeed("Just now");
	if (diffMins < 60) return Result.succeed(`${diffMins}m`);
	if (diffHours < 24) return Result.succeed(`${diffHours}h`);
	if (diffDays < 7) return Result.succeed(`${diffDays}d`);

	const formatted = SHORT_DATE_FORMAT.format(date);
	return Result.succeed(formatted);
}

/**
 * Groups a date into a time category (Today, Yesterday, This week, etc.).
 *
 * @param date - The date to group
 * @returns Result containing time group label or an error if date is invalid
 */
export function getTimeGroup(date: Date): Result.Result<string, ThreadListError> {
	// Validate date is finite
	if (!Number.isFinite(date.getTime())) {
		return Result.fail(invalidTimestampError(date.getTime()));
	}

	const now = new Date();
	const diffMs = now.getTime() - date.getTime();

	// Handle invalid or future dates
	if (!Number.isFinite(diffMs) || diffMs < 0) {
		return Result.fail(invalidTimestampError(date.getTime()));
	}

	const diffDays = Math.floor(diffMs / TIME_CONSTANTS.DAY);

	if (diffDays === 0) return Result.succeed(TIME_GROUPS.TODAY);
	if (diffDays === 1) return Result.succeed(TIME_GROUPS.YESTERDAY);
	if (diffDays < 7) return Result.succeed(TIME_GROUPS.THIS_WEEK);
	if (diffDays < 30) return Result.succeed(TIME_GROUPS.THIS_MONTH);
	return Result.succeed(TIME_GROUPS.OLDER);
}

/**
 * Validates and creates a Date from a timestamp.
 *
 * @param timestamp - The timestamp to validate and convert
 * @returns Result containing valid Date object or an error if timestamp is invalid
 */
export function createValidDate(timestamp: unknown): Result.Result<Date, ThreadListError> {
	if (
		typeof timestamp === "number" &&
		Number.isFinite(timestamp) &&
		timestamp >= 0 &&
		timestamp < Number.MAX_SAFE_INTEGER
	) {
		const date = new Date(timestamp);
		// Double-check the Date is valid
		if (Number.isFinite(date.getTime())) {
			return Result.succeed(date);
		}
	}
	// Invalid timestamp, return error
	return Result.fail(invalidTimestampError(timestamp));
}
