import { describe, expect, it } from "vitest";

import {
	buildVoiceDownloadSegments,
	buildDiscreteFilledSegments,
	clampVoiceDownloadPercent,
	countFilledVoiceDownloadSegments,
	formatVoiceDownloadPercent,
	getLevelStageFillColor,
} from "./voice-download-progress.js";

describe("voice-download-progress", () => {
	it("clamps percent into the supported range", () => {
		expect(clampVoiceDownloadPercent(-10)).toBe(0);
		expect(clampVoiceDownloadPercent(42.4)).toBe(42.4);
		expect(clampVoiceDownloadPercent(120)).toBe(100);
	});

	it("fills at least one segment for non-zero progress", () => {
		expect(countFilledVoiceDownloadSegments(0, 20)).toBe(0);
		expect(countFilledVoiceDownloadSegments(1, 20)).toBe(1);
		expect(countFilledVoiceDownloadSegments(100, 20)).toBe(20);
	});

	it("builds discrete filled segments", () => {
		expect(buildDiscreteFilledSegments(0, 5)).toEqual([false, false, false, false, false]);
		expect(buildDiscreteFilledSegments(3, 5)).toEqual([true, true, true, false, false]);
		expect(buildDiscreteFilledSegments(5, 5)).toEqual([true, true, true, true, true]);
	});

	it("builds the requested number of segments", () => {
		const segments = buildVoiceDownloadSegments(50, 20);

		expect(segments).toHaveLength(20);
		expect(segments.filter(Boolean)).toHaveLength(10);
		expect(segments[9]).toBe(true);
		expect(segments[10]).toBe(false);
	});

	it("formats the visible percent label", () => {
		expect(formatVoiceDownloadPercent(48.6)).toBe("49%");
	});

	it("maps level stage fills from success through orange to destructive", () => {
		expect(getLevelStageFillColor(1, 5)).toBe("var(--success)");
		expect(getLevelStageFillColor(3, 5)).toBe(
			"color-mix(in srgb, var(--success) 33%, var(--token-download-progress) 67%)"
		);
		expect(getLevelStageFillColor(4, 5)).toBe("var(--token-download-progress)");
		expect(getLevelStageFillColor(5, 5)).toBe("var(--destructive)");
	});
});
