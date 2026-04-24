import { describe, expect, it } from "vitest";
import { hasToolbarCapabilityData, resolveSelectorsLoading } from "./toolbar-loading.js";

const codexModelsDisplay = {
	groups: [
		{
			label: "Gpt-5.4",
			models: [
				{
					modelId: "gpt-5.4/medium",
					displayName: "Medium",
				},
			],
		},
	],
	presentation: undefined,
};

describe("toolbar-loading", () => {
	it("treats modelsDisplay as usable toolbar data", () => {
		expect(
			hasToolbarCapabilityData({
				visibleModesCount: 0,
				availableModelsCount: 0,
				modelsDisplay: codexModelsDisplay,
			})
		).toBe(true);
	});

	it("stops selector loading when modelsDisplay is already usable", () => {
		expect(
			resolveSelectorsLoading({
				hasSession: false,
				isSessionConnecting: false,
				hasSelectedAgent: true,
				visibleModesCount: 0,
				availableModelsCount: 0,
				modelsDisplay: codexModelsDisplay,
				isCacheLoaded: false,
				isPreconnectionLoading: true,
			})
		).toBe(false);
	});

	it("keeps selector loading when no toolbar data exists and preconnection is still loading", () => {
		expect(
			resolveSelectorsLoading({
				hasSession: false,
				isSessionConnecting: false,
				hasSelectedAgent: true,
				visibleModesCount: 0,
				availableModelsCount: 0,
				modelsDisplay: null,
				isCacheLoaded: true,
				isPreconnectionLoading: true,
			})
		).toBe(true);
	});
});
