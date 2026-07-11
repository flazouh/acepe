import { describe, expect, it } from "bun:test";

import {
	countSelectableModels,
	filterModelGroups,
	findSelectedReasoningGroup,
	getModelSearchText,
	resolveActiveModelProviderId,
	shouldShowModelGroups,
	shouldShowModelSearch,
} from "./agent-input-model-selector-state.js";
import type {
	AgentInputModelSelectorGroup,
	AgentInputModelSelectorReasoningGroup,
} from "./agent-input-model-selector-types.js";

const groups: readonly AgentInputModelSelectorGroup[] = [
	{
		label: "OpenAI",
		providerLabel: "OpenAI",
		items: [
			{ id: "gpt-5", name: "GPT-5", description: "general model" },
			{ id: "mini", name: "Mini", searchText: "cheap quick" },
		],
	},
	{
		label: "",
		items: [{ id: "claude", name: "Claude", providerLabel: "Anthropic" }],
	},
];

const reasoningGroups: readonly AgentInputModelSelectorReasoningGroup[] = [
	{
		baseModelId: "base-a",
		baseModelName: "Base A",
		variants: [
			{ id: "base-a-low", name: "Low" },
			{ id: "base-a-high", name: "High" },
		],
	},
	{
		baseModelId: "base-b",
		baseModelName: "Base B",
		variants: [{ id: "base-b-low", name: "Low" }],
	},
];

describe("agent input model selector state", () => {
	it("counts models for normal and reasoning selectors", () => {
		expect(
			countSelectableModels({
				usesVariantSelector: false,
				modelGroups: groups,
				reasoningGroups,
			})
		).toBe(3);
		expect(
			countSelectableModels({
				usesVariantSelector: true,
				modelGroups: groups,
				reasoningGroups,
			})
		).toBe(3);
	});

	it("shows search only for large normal selectors", () => {
		expect(shouldShowModelSearch({ usesVariantSelector: true, totalModelCount: 99 })).toBe(
			false
		);
		expect(
			shouldShowModelSearch({
				usesVariantSelector: false,
				totalModelCount: 12,
				threshold: 12,
			})
		).toBe(false);
		expect(
			shouldShowModelSearch({
				usesVariantSelector: false,
				totalModelCount: 13,
				threshold: 12,
			})
		).toBe(true);
	});

	it("finds the selected reasoning group with fallback", () => {
		expect(
			findSelectedReasoningGroup({
				reasoningGroups,
				selectedReasoningBaseId: "base-b",
			})?.baseModelId
		).toBe("base-b");
		expect(
			findSelectedReasoningGroup({
				reasoningGroups,
				selectedReasoningBaseId: "missing",
			})?.baseModelId
		).toBe("base-a");
	});

	it("filters model groups by combined search text", () => {
		expect(getModelSearchText(groups[0].items[1])).toContain("cheap quick");
		expect(filterModelGroups({ modelGroups: groups, searchQuery: "anthropic" })).toEqual([
			{
				label: "",
				providerId: undefined,
				upstreamProviderBrand: null,
				providerBrand: null,
				providerLabel: undefined,
				items: [{ id: "claude", name: "Claude", providerLabel: "Anthropic" }],
			},
		]);
	});

	it("shows group labels when labels exist or there are multiple groups", () => {
		expect(shouldShowModelGroups([{ label: "", items: [] }])).toBe(false);
		expect(shouldShowModelGroups([{ label: "OpenAI", items: [] }])).toBe(true);
		expect(
			shouldShowModelGroups([
				{ label: "", items: [] },
				{ label: "", items: [] },
			])
		).toBe(true);
	});

	it("uses a requested provider and recovers from stale provider preferences", () => {
		const providerGroups: readonly AgentInputModelSelectorGroup[] = [
			{ label: "OpenRouter", providerId: "openrouter", items: [{ id: "or/model", name: "OR" }] },
			{ label: "GitHub Copilot", providerId: "github-copilot", items: [{ id: "gh/model", name: "GH" }] },
		];
		expect(resolveActiveModelProviderId({ modelGroups: providerGroups, requestedProviderId: "openrouter", rememberedProviderId: null, currentModelId: "gh/model" })).toBe("openrouter");
		expect(resolveActiveModelProviderId({ modelGroups: providerGroups, requestedProviderId: null, rememberedProviderId: "openrouter", currentModelId: "gh/model" })).toBe("github-copilot");
		expect(resolveActiveModelProviderId({ modelGroups: providerGroups, requestedProviderId: null, rememberedProviderId: "gone", currentModelId: null })).toBe("openrouter");
	});
});
