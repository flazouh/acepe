import { describe, expect, it } from "bun:test";

import {
	createContextUsageSegments,
	formatTokenCountCompact,
	formatTokenUsageCompact,
	getContextUsagePercent,
	hasVisibleModelSelectorMetrics,
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
		expect(createContextUsageSegments(25, 8)).toEqual([
			true,
			true,
			false,
			false,
			false,
			false,
			false,
			false,
		]);
	});

	it("returns an empty list for invalid segment counts", () => {
		expect(createContextUsageSegments(50, 0)).toEqual([]);
	});
});

describe("hasVisibleModelSelectorMetrics", () => {
	it("returns false when telemetry is missing", () => {
		expect(hasVisibleModelSelectorMetrics(null, false)).toBe(false);
	});

	it("keeps claude code metrics visible when telemetry exists", () => {
		expect(
			hasVisibleModelSelectorMetrics(
				{
					contextBudget: null,
					lastTelemetryEventId: null,
					latestStepCostUsd: null,
					latestTokensCacheRead: null,
					latestTokensCacheWrite: null,
					latestTokensInput: null,
					latestTokensOutput: null,
					latestTokensReasoning: null,
					latestTokensTotal: null,
					sessionSpendUsd: 0,
					updatedAt: 0,
				},
				true
			)
		).toBe(true);
	});

	it("returns false for non-claude telemetry with no visible spend or context", () => {
		expect(
			hasVisibleModelSelectorMetrics(
				{
					contextBudget: null,
					lastTelemetryEventId: null,
					latestStepCostUsd: 0,
					latestTokensCacheRead: null,
					latestTokensCacheWrite: null,
					latestTokensInput: null,
					latestTokensOutput: null,
					latestTokensReasoning: null,
					latestTokensTotal: null,
					sessionSpendUsd: 0,
					updatedAt: 0,
				},
				false
			)
		).toBe(false);
	});

	it("returns true for non-claude telemetry with context usage", () => {
		expect(
			hasVisibleModelSelectorMetrics(
				{
					contextBudget: {
						maxTokens: 200000,
						source: "provider-explicit",
						scope: "turn",
						updatedAt: 0,
					},
					lastTelemetryEventId: null,
					latestStepCostUsd: null,
					latestTokensCacheRead: null,
					latestTokensCacheWrite: null,
					latestTokensInput: null,
					latestTokensOutput: null,
					latestTokensReasoning: null,
					latestTokensTotal: 50000,
					sessionSpendUsd: 0,
					updatedAt: 0,
				},
				false
			)
		).toBe(true);
	});

	it("uses resolved context budget when deciding whether context usage is visible", () => {
		const telemetry = {
			contextBudget: {
				maxTokens: 200000,
				source: "provider-explicit" as const,
				scope: "turn" as const,
				updatedAt: 0,
			},
			lastTelemetryEventId: null,
			latestStepCostUsd: null,
			latestTokensCacheRead: null,
			latestTokensCacheWrite: null,
			latestTokensInput: null,
			latestTokensOutput: null,
			latestTokensReasoning: null,
			latestTokensTotal: 50000,
			sessionSpendUsd: 0,
			updatedAt: 0,
		};

		expect(hasVisibleModelSelectorMetrics(telemetry, false)).toBe(true);
	});
});
