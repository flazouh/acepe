import { describe, expect, it } from "bun:test";

import {
	mergeSessionGraphActivityTiming,
	seedSessionGraphActivityTimingIfNeeded,
} from "../merge-session-graph-activity-timing.js";

describe("mergeSessionGraphActivityTiming", () => {
	it("preserves the anchor when activity kind is unchanged", () => {
		const merged = mergeSessionGraphActivityTiming(
			{
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
				kindStartedAtMs: 1_000,
			},
			{
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
				kindStartedAtMs: null,
			},
			9_000
		);

		expect(merged.kindStartedAtMs).toBe(1_000);
	});

	it("resets the anchor when activity kind changes", () => {
		const merged = mergeSessionGraphActivityTiming(
			{
				kind: "running_operation",
				activeOperationCount: 1,
				activeSubagentCount: 0,
				dominantOperationId: "op-1",
				blockingInteractionId: null,
				kindStartedAtMs: 1_000,
			},
			{
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
				kindStartedAtMs: null,
			},
			4_000
		);

		expect(merged.kindStartedAtMs).toBe(4_000);
	});
});

describe("seedSessionGraphActivityTimingIfNeeded", () => {
	it("seeds awaiting-model timing when missing", () => {
		const seeded = seedSessionGraphActivityTimingIfNeeded(
			{
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
				kindStartedAtMs: null,
			},
			5_000
		);

		expect(seeded.kindStartedAtMs).toBe(5_000);
	});
});
