import { describe, expect, it } from "vitest";

import {
	buildPercentFilledSegments,
	buildDiscreteFilledSegments,
	clampSegmentedPercent,
	countFilledSegments,
	formatSegmentedPercent,
	getCompletenessRampFillColor,
	getIntensityRampFillColor,
	getLevelStageFillColor,
} from "./segmented-progress-bar.js";

describe("segmented-progress-bar", () => {
	it("clamps percent into the supported range", () => {
		expect(clampSegmentedPercent(-10)).toBe(0);
		expect(clampSegmentedPercent(42.4)).toBe(42.4);
		expect(clampSegmentedPercent(120)).toBe(100);
	});

	it("fills at least one segment for non-zero progress", () => {
		expect(countFilledSegments(0, 20)).toBe(0);
		expect(countFilledSegments(1, 20)).toBe(1);
		expect(countFilledSegments(100, 20)).toBe(20);
	});

	it("builds discrete filled segments", () => {
		expect(buildDiscreteFilledSegments(0, 5)).toEqual([false, false, false, false, false]);
		expect(buildDiscreteFilledSegments(3, 5)).toEqual([true, true, true, false, false]);
		expect(buildDiscreteFilledSegments(5, 5)).toEqual([true, true, true, true, true]);
	});

	it("builds the requested number of segments", () => {
		const segments = buildPercentFilledSegments(50, 20);

		expect(segments).toHaveLength(20);
		expect(segments.filter(Boolean)).toHaveLength(10);
		expect(segments[9]).toBe(true);
		expect(segments[10]).toBe(false);
	});

	it("formats the visible percent label", () => {
		expect(formatSegmentedPercent(48.6)).toBe("49%");
	});

	it("maps level stage fills from success through orange to destructive", () => {
		expect(getLevelStageFillColor(1, 5)).toBe("var(--success)");
		expect(getLevelStageFillColor(3, 5)).toBe(
			"color-mix(in srgb, var(--success) 33%, var(--token-download-progress) 67%)"
		);
		expect(getLevelStageFillColor(4, 5)).toBe("var(--token-download-progress)");
		expect(getLevelStageFillColor(5, 5)).toBe("var(--destructive)");
	});

	it("maps completeness ramp fills from success through orange to destructive", () => {
		expect(getCompletenessRampFillColor(1, 5)).toBe("var(--success)");
		expect(getCompletenessRampFillColor(3, 5)).toBe(
			"color-mix(in srgb, var(--success) 33%, var(--token-completeness-mid) 67%)"
		);
		expect(getCompletenessRampFillColor(4, 5)).toBe("var(--token-completeness-mid)");
		expect(getCompletenessRampFillColor(5, 5)).toBe("var(--destructive)");
	});

	it("maps live intensity levels onto the completeness ramp", () => {
		expect(getIntensityRampFillColor(0)).toContain("var(--border)");
		expect(getIntensityRampFillColor(0.2, 5)).toBe("var(--success)");
		expect(getIntensityRampFillColor(0.8, 5)).toBe("var(--token-completeness-mid)");
		expect(getIntensityRampFillColor(1, 5)).toBe("var(--destructive)");
	});
});
