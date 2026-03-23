import { describe, expect, it } from "bun:test";

import { formatToolElapsedLabel } from "../tool-state-utils.js";

describe("formatToolElapsedLabel", () => {
	const START = 1_700_000_000_000;

	it("returns running label while tool is active", () => {
		expect(
			formatToolElapsedLabel({
				startedAtMs: START,
				isRunning: true,
				nowMs: START + 2_400,
			})
		).toBe("2s");
	});

	it("returns completed label when completedAtMs is present", () => {
		expect(
			formatToolElapsedLabel({
				startedAtMs: START,
				completedAtMs: START + 2_400,
				isRunning: false,
			})
		).toBe("2.40s");
	});

	it("returns null when timing is unavailable for completed tools", () => {
		expect(
			formatToolElapsedLabel({
				startedAtMs: START,
				isRunning: false,
			})
		).toBeNull();
	});

	it("clamps negative elapsed durations to zero seconds", () => {
		expect(
			formatToolElapsedLabel({
				startedAtMs: START,
				completedAtMs: START - 100,
				isRunning: false,
			})
		).toBe("0.00s");
	});
});
