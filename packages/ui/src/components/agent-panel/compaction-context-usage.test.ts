import { describe, expect, it } from "bun:test";

import { buildCompactionContextUsageViewModel } from "./compaction-context-usage.js";

describe("compaction context usage", () => {
	it("builds remaining, reclaimed, and unused context segments", () => {
		expect(
			buildCompactionContextUsageViewModel({
				preCompactionTokens: 182_000,
				postCompactionTokens: 44_000,
				contextWindowSize: 200_000,
			})
		).toEqual({
			beforeTokens: 182_000,
			afterTokens: 44_000,
			scaleTokens: 200_000,
			beforePercent: 91,
			afterPercent: 22,
			reclaimedPercent: 69,
			unusedPercent: 9,
			hasKnownWindow: true,
		});
	});

	it("uses the largest observed value when the context window is missing", () => {
		const model = buildCompactionContextUsageViewModel({
			preCompactionTokens: 100_000,
			postCompactionTokens: 25_000,
			contextWindowSize: null,
		});

		expect(model?.scaleTokens).toBe(100_000);
		expect(model?.beforePercent).toBe(100);
		expect(model?.afterPercent).toBe(25);
		expect(model?.hasKnownWindow).toBe(false);
	});

	it("does not imply reclaimed context when after exceeds before", () => {
		const model = buildCompactionContextUsageViewModel({
			preCompactionTokens: 50_000,
			postCompactionTokens: 100_000,
			contextWindowSize: 200_000,
		});

		expect(model?.beforePercent).toBe(25);
		expect(model?.afterPercent).toBe(50);
		expect(model?.reclaimedPercent).toBe(0);
		expect(model?.unusedPercent).toBe(50);
	});

	it("rejects incomplete, negative, and non-finite comparisons", () => {
		expect(
			buildCompactionContextUsageViewModel({
				preCompactionTokens: null,
				postCompactionTokens: 10,
				contextWindowSize: 100,
			})
		).toBeNull();
		expect(
			buildCompactionContextUsageViewModel({
				preCompactionTokens: -1,
				postCompactionTokens: 10,
				contextWindowSize: 100,
			})
		).toBeNull();
		expect(
			buildCompactionContextUsageViewModel({
				preCompactionTokens: Number.POSITIVE_INFINITY,
				postCompactionTokens: 10,
				contextWindowSize: 100,
			})
		).toBeNull();
	});
});
