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
				resolvableModelId: null,
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
				resolvableModelId: null,
			})
		).toBe(true);
	});

	it("stops selector loading while connecting when a resolvable model id is present", () => {
		expect(
			resolveSelectorsLoading({
				hasSession: true,
				isSessionConnecting: true,
				hasSelectedAgent: true,
				visibleModesCount: 0,
				availableModelsCount: 0,
				modelsDisplay: null,
				isCacheLoaded: false,
				isPreconnectionLoading: false,
				resolvableModelId: "claude-sonnet-4-6",
			})
		).toBe(false);
	});

	it("stops selector loading while connecting when cache has models", () => {
		expect(
			resolveSelectorsLoading({
				hasSession: true,
				isSessionConnecting: true,
				hasSelectedAgent: true,
				visibleModesCount: 0,
				availableModelsCount: 2,
				modelsDisplay: null,
				isCacheLoaded: true,
				isPreconnectionLoading: false,
				resolvableModelId: null,
			})
		).toBe(false);
	});

	it("keeps selector loading while connecting when nothing is resolvable", () => {
		expect(
			resolveSelectorsLoading({
				hasSession: true,
				isSessionConnecting: true,
				hasSelectedAgent: true,
				visibleModesCount: 0,
				availableModelsCount: 0,
				modelsDisplay: null,
				isCacheLoaded: false,
				isPreconnectionLoading: false,
				resolvableModelId: null,
			})
		).toBe(true);
	});
});
