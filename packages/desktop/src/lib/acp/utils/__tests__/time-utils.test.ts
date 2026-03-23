import { describe, expect, it } from "bun:test";

import { formatTimeAgo } from "../time-utils.js";

describe("formatTimeAgo", () => {
	const NOW = 1_700_000_000_000; // Fixed reference time

	it("should return null for less than 1 minute", () => {
		expect(formatTimeAgo(NOW - 30_000, NOW)).toBeNull();
	});

	it("should return null for 0 difference", () => {
		expect(formatTimeAgo(NOW, NOW)).toBeNull();
	});

	it("should return minutes for 1-59 minutes", () => {
		expect(formatTimeAgo(NOW - 60_000, NOW)).toBe("1m");
		expect(formatTimeAgo(NOW - 5 * 60_000, NOW)).toBe("5m");
		expect(formatTimeAgo(NOW - 59 * 60_000, NOW)).toBe("59m");
	});

	it("should return hours for 1-23 hours", () => {
		expect(formatTimeAgo(NOW - 60 * 60_000, NOW)).toBe("1h");
		expect(formatTimeAgo(NOW - 3 * 60 * 60_000, NOW)).toBe("3h");
		expect(formatTimeAgo(NOW - 23 * 60 * 60_000, NOW)).toBe("23h");
	});

	it("should return days for 24+ hours", () => {
		expect(formatTimeAgo(NOW - 24 * 60 * 60_000, NOW)).toBe("1d");
		expect(formatTimeAgo(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe("7d");
	});

	it("should use Date.now() as default", () => {
		// Just verify it doesn't throw - actual value depends on current time
		const result = formatTimeAgo(Date.now() - 120_000);
		expect(result).toBe("2m");
	});
});
