import { describe, expect, it } from "vitest";

import {
	buildVoiceDownloadSegments,
	clampVoiceDownloadPercent,
	countFilledVoiceDownloadSegments,
	formatVoiceDownloadPercent,
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
});
