import { describe, expect, it } from "bun:test";

import {
	compactionUsagePercent,
	formatCompactTokens,
	gaugeFillHeightPx,
	resolveComparableUsage,
	resolveSessionActivityGauge,
	sessionActivityAriaLabel,
	sessionActivityDetailText,
	usageFillClass,
} from "./agent-session-activity-entry-state.js";

describe("formatCompactTokens", () => {
	it("keeps small counts verbatim", () => {
		expect(formatCompactTokens(0)).toBe("0");
		expect(formatCompactTokens(950)).toBe("950");
	});

	it("uses one decimal below 10k and drops trailing zero", () => {
		expect(formatCompactTokens(9_410)).toBe("9.4k");
		expect(formatCompactTokens(1_000)).toBe("1k");
	});

	it("rounds to whole k below 1m", () => {
		expect(formatCompactTokens(142_010)).toBe("142k");
		expect(formatCompactTokens(200_000)).toBe("200k");
	});

	it("uses m above 1m", () => {
		expect(formatCompactTokens(1_204_000)).toBe("1.2m");
		expect(formatCompactTokens(2_000_000)).toBe("2m");
	});
});

describe("compactionUsagePercent", () => {
	it("computes a clamped percentage of the window", () => {
		expect(compactionUsagePercent(142_010, 200_000)).toBeCloseTo(71.005);
		expect(compactionUsagePercent(300_000, 200_000)).toBe(100);
		expect(compactionUsagePercent(0, 200_000)).toBe(0);
	});

	it("returns null without a usable window or count", () => {
		expect(compactionUsagePercent(null, 200_000)).toBeNull();
		expect(compactionUsagePercent(142_010, null)).toBeNull();
		expect(compactionUsagePercent(142_010, 0)).toBeNull();
		expect(compactionUsagePercent(-5, 200_000)).toBeNull();
	});
});

describe("usageFillClass", () => {
	it("escalates neutral, watch, critical at 60 and 80", () => {
		expect(usageFillClass(30)).toContain("bg-foreground");
		expect(usageFillClass(60)).toContain("ff9500");
		expect(usageFillClass(79.9)).toContain("ff9500");
		expect(usageFillClass(80)).toContain("ff3b30");
	});
});

describe("gaugeFillHeightPx", () => {
	it("scales into the inner track and never collapses to zero", () => {
		expect(gaugeFillHeightPx(100, 10)).toBe(10);
		expect(gaugeFillHeightPx(50, 10)).toBe(5);
		expect(gaugeFillHeightPx(0, 10)).toBe(1);
	});
});

describe("resolveComparableUsage", () => {
	it("returns before and after when both counts are valid", () => {
		expect(
			resolveComparableUsage({
				preCompactionTokens: 142_010,
				postCompactionTokens: 18_400,
				contextWindowSize: null,
			})
		).toEqual({ before: 142_010, after: 18_400 });
	});

	it("returns null when either count is missing or invalid", () => {
		expect(
			resolveComparableUsage({
				preCompactionTokens: 142_010,
				postCompactionTokens: null,
				contextWindowSize: 200_000,
			})
		).toBeNull();
		expect(
			resolveComparableUsage({
				preCompactionTokens: -1,
				postCompactionTokens: 18_400,
				contextWindowSize: 200_000,
			})
		).toBeNull();
		expect(resolveComparableUsage(null)).toBeNull();
		expect(resolveComparableUsage(undefined)).toBeNull();
	});
});

describe("resolveSessionActivityGauge", () => {
	it("builds before and after gauge fills from the window", () => {
		const gauge = resolveSessionActivityGauge({
			preCompactionTokens: 160_000,
			postCompactionTokens: 20_000,
			contextWindowSize: 200_000,
		});
		expect(gauge).not.toBeNull();
		expect(gauge?.beforePercent).toBe(80);
		expect(gauge?.afterPercent).toBe(10);
		expect(gauge?.beforeFillClass).toContain("ff3b30");
		expect(gauge?.afterFillClass).toContain("bg-foreground");
	});

	it("returns null without a window size", () => {
		expect(
			resolveSessionActivityGauge({
				preCompactionTokens: 160_000,
				postCompactionTokens: 20_000,
				contextWindowSize: null,
			})
		).toBeNull();
	});
});

describe("sessionActivityDetailText", () => {
	it("joins subtitle and metadata pairs with middots", () => {
		expect(
			sessionActivityDetailText("123,610 tokens freed", [
				{ label: "Trigger", value: "Auto" },
				{ label: "Duration", value: "1.2 s" },
			])
		).toBe("123,610 tokens freed · Trigger: Auto · Duration: 1.2 s");
	});

	it("returns null when nothing is present", () => {
		expect(sessionActivityDetailText(null, [])).toBeNull();
		expect(sessionActivityDetailText(null, undefined)).toBeNull();
	});

	it("works with metadata only", () => {
		expect(sessionActivityDetailText(null, [{ label: "Trigger", value: "Manual" }])).toBe(
			"Trigger: Manual"
		);
	});
});

describe("sessionActivityAriaLabel", () => {
	it("describes completed compaction with full token counts", () => {
		const label = sessionActivityAriaLabel({
			title: "Compaction done",
			status: "completed",
			subtitle: "123,610 tokens freed",
			contextUsage: {
				preCompactionTokens: 142_010,
				postCompactionTokens: 18_400,
				contextWindowSize: 200_000,
			},
			metadata: [{ label: "Trigger", value: "Auto" }],
		});
		expect(label).toContain("Compaction done");
		expect(label).toContain("142,010");
		expect(label).toContain("18,400");
		expect(label).toContain("200,000");
		expect(label).toContain("123,610 tokens freed");
	});

	it("keeps preparing labels free of numbers", () => {
		const label = sessionActivityAriaLabel({
			title: "Compaction preparing",
			status: "preparing",
			subtitle: null,
			contextUsage: null,
			metadata: undefined,
		});
		expect(label).toBe("Compaction preparing");
	});
});
