import { describe, expect, it } from "bun:test";

import {
	createContextUsageSegments,
	formatTokenCountCompact,
	formatTokenUsageCompact,
	getContextUsagePercent,
} from "../model-selector.metrics-chip.logic.js";

describe("formatTokenCountCompact", () => {
	it("formats small values without suffix", () => {
		expect(formatTokenCountCompact(999)).toBe("999");
	});

	it("formats thousands with lowercase k suffix", () => {
		expect(formatTokenCountCompact(40_000)).toBe("40k");
	});

	it("formats millions with lowercase m suffix", () => {
		expect(formatTokenCountCompact(1_200_000)).toBe("1.2m");
	});
});

describe("formatTokenUsageCompact", () => {
	it("formats usage as current/context window", () => {
		expect(formatTokenUsageCompact(40_000, 250_000)).toBe("40k/250k");
	});

	it("returns null when context window is missing", () => {
		expect(formatTokenUsageCompact(40_000, null)).toBeNull();
	});
});

describe("getContextUsagePercent", () => {
	it("returns a clamped percentage for valid token usage", () => {
		expect(getContextUsagePercent(50_000, 200_000)).toBe(25);
	});

	it("clamps overflow usage at 100 percent", () => {
		expect(getContextUsagePercent(300_000, 200_000)).toBe(100);
	});

	it("returns null when context window is unavailable", () => {
		expect(getContextUsagePercent(50_000, null)).toBeNull();
	});
});

describe("createContextUsageSegments", () => {
	it("fills segments according to the usage percentage", () => {
		expect(createContextUsageSegments(25, 8)).toEqual([true, true, false, false, false, false, false, false]);
	});

	it("returns an empty list for invalid segment counts", () => {
		expect(createContextUsageSegments(50, 0)).toEqual([]);
	});
});
