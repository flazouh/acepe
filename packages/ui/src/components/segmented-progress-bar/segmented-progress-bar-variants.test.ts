import { describe, expect, it } from "vitest";

import {
	getSegmentedProgressBarRenderMode,
	isCompletenessRampVariant,
	isLevelPaletteVariant,
} from "./segmented-progress-bar-variants.js";

describe("segmented-progress-bar-variants", () => {
	it("maps variants to render modes", () => {
		expect(getSegmentedProgressBarRenderMode("download")).toBe("percent");
		expect(getSegmentedProgressBarRenderMode("downloadCompact")).toBe("percent");
		expect(getSegmentedProgressBarRenderMode("downloadFillWidth")).toBe("percent");
		expect(getSegmentedProgressBarRenderMode("usageCompact")).toBe("percent");
		expect(getSegmentedProgressBarRenderMode("usageFillWidth")).toBe("percent");
		expect(getSegmentedProgressBarRenderMode("reasoningDiscrete")).toBe("discreteFilledOnly");
		expect(getSegmentedProgressBarRenderMode("setupReasoningBar")).toBe("discreteGroupedAll");
	});

	it("identifies palette variants", () => {
		expect(isLevelPaletteVariant("downloadCompact")).toBe(false);
		expect(isLevelPaletteVariant("reasoningDiscrete")).toBe(true);
		expect(isCompletenessRampVariant("usageCompact")).toBe(true);
		expect(isCompletenessRampVariant("usageFillWidth")).toBe(true);
		expect(isCompletenessRampVariant("downloadCompact")).toBe(false);
	});
});
