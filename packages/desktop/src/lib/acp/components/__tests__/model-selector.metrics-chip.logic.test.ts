import { describe, expect, it } from "bun:test";

import {
	formatTokenCountCompact,
	formatTokenUsageCompact,
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
