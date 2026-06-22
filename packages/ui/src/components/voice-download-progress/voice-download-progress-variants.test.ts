import { describe, expect, test } from "bun:test";

import {
	getVoiceDownloadProgressRenderMode,
	isLevelPaletteVariant,
} from "./voice-download-progress-variants.js";

describe("voice download progress variants", () => {
	test("maps each variant to a render mode", () => {
		expect(getVoiceDownloadProgressRenderMode("download")).toBe("percent");
		expect(getVoiceDownloadProgressRenderMode("downloadCompact")).toBe("percent");
		expect(getVoiceDownloadProgressRenderMode("downloadFillWidth")).toBe("percent");
		expect(getVoiceDownloadProgressRenderMode("reasoningDiscrete")).toBe("discreteFilledOnly");
		expect(getVoiceDownloadProgressRenderMode("setupReasoningBar")).toBe("discreteGroupedAll");
	});

	test("identifies level palette variants", () => {
		expect(isLevelPaletteVariant("download")).toBe(false);
		expect(isLevelPaletteVariant("downloadCompact")).toBe(false);
		expect(isLevelPaletteVariant("reasoningDiscrete")).toBe(true);
		expect(isLevelPaletteVariant("setupReasoningBar")).toBe(true);
	});
});
