import { describe, expect, it } from "bun:test";

import { formatMessageLatency, formatMessageTimestamp } from "./message-timestamp-state.js";

describe("message-timestamp-state", () => {
	it("formats dates as 24-hour time", () => {
		expect(formatMessageTimestamp(new Date("2026-05-23T09:08:07Z"))).toMatch(/09:08:07|12:08:07/);
	});

	it("formats numeric string timestamps", () => {
		const timestamp = Date.UTC(2026, 4, 23, 9, 8, 7).toString();

		expect(formatMessageTimestamp(timestamp)).toMatch(/09:08:07|12:08:07/);
	});

	it("formats sub-second latency in milliseconds", () => {
		expect(formatMessageLatency(42.4)).toBe("42ms");
	});

	it("formats longer latency in seconds", () => {
		expect(formatMessageLatency(1250)).toBe("1.3s");
	});
});
