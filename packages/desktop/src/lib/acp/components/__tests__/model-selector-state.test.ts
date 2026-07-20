import { describe, expect, it } from "bun:test";
import type { ModelsForDisplay } from "$lib/services/acp-types.js";
import type { Model } from "../../application/dto/model.js";
import type { ReasoningBaseModelGroup } from "../model-selector-logic.js";

import {
	getModelSelectorDisplayName,
	getModelSelectorItemId,
	getModelSelectorItemLabel,
	getModelSelectorProviderBrand,
	getModelSelectorSearchText,
	getPreferredReasoningVariantId,
	getSelectedModel,
	getSelectedReasoningBaseGroup,
	resolveModelSelectorAgentId,
} from "../model-selector-state.js";

const models: Model[] = [
	{ id: "default", name: "default" },
	{ id: "gpt-5", name: "gpt five", description: "Fast" },
];

const modelsDisplay: ModelsForDisplay = {
	groups: [
		{
			label: "OpenAI",
			models: [{ modelId: "gpt-5", displayName: "GPT-5", description: "Fast" }],
		},
	],
};

const reasoningGroups: ReasoningBaseModelGroup[] = [
	{
		baseModelId: "codex",
		baseModelName: "Codex",
		variants: [
			{ fullModelId: "codex-low", baseModelId: "codex", name: "Low" },
			{ fullModelId: "codex-high", baseModelId: "codex", name: "High" },
		],
	},
	{
		baseModelId: "gpt",
		baseModelName: "GPT",
		variants: [{ fullModelId: "gpt-low", baseModelId: "gpt", name: "Low" }],
	},
];

describe("model selector state", () => {
	it("selects the current model from available models", () => {
		expect(getSelectedModel({ currentModelId: "gpt-5", availableModels: models })).toBe(models[1]);
		expect(getSelectedModel({ currentModelId: null, availableModels: models })).toBeNull();
		expect(getSelectedModel({ currentModelId: "missing", availableModels: models })).toBeNull();
	});

	it("resolves the trigger label from display groups, fallback model, or default", () => {
		expect(
			getModelSelectorDisplayName({
				currentModelId: "gpt-5",
				modelsDisplay,
				selectedModel: models[1]!,
				agentId: "codex",
			})
		).toBe("GPT-5");
		expect(
			getModelSelectorDisplayName({
				currentModelId: "gpt-5",
				modelsDisplay: null,
				selectedModel: models[1]!,
				agentId: "codex",
			})
		).toBe("GPT Five");
		expect(
			getModelSelectorDisplayName({
				currentModelId: "missing",
				modelsDisplay: null,
				selectedModel: null,
				agentId: "codex",
			})
		).toBe("Model");
	});

	it("selects the reasoning base group from current variant or fallback", () => {
		expect(
			getSelectedReasoningBaseGroup({
				usesVariantSelector: true,
				reasoningBaseGroups: reasoningGroups,
				selectedReasoningVariant: reasoningGroups[1]!.variants[0]!,
				currentModelId: "gpt-low",
			})
		).toBe(reasoningGroups[1]);
		expect(
			getSelectedReasoningBaseGroup({
				usesVariantSelector: true,
				reasoningBaseGroups: reasoningGroups,
				selectedReasoningVariant: null,
				currentModelId: null,
			})
		).toBe(reasoningGroups[0]);
		expect(
			getSelectedReasoningBaseGroup({
				usesVariantSelector: false,
				reasoningBaseGroups: reasoningGroups,
				selectedReasoningVariant: null,
				currentModelId: null,
			})
		).toBeNull();
	});

	it("prefers the matching reasoning variant before the first variant", () => {
		expect(
			getPreferredReasoningVariantId({
				baseModelId: "codex",
				reasoningBaseGroups: reasoningGroups,
				selectedReasoningVariant: reasoningGroups[0]!.variants[1]!,
			})
		).toBe("codex-high");
		expect(
			getPreferredReasoningVariantId({
				baseModelId: "codex",
				reasoningBaseGroups: reasoningGroups,
				selectedReasoningVariant: reasoningGroups[1]!.variants[0]!,
			})
		).toBe("codex-low");
		expect(
			getPreferredReasoningVariantId({
				baseModelId: "missing",
				reasoningBaseGroups: reasoningGroups,
				selectedReasoningVariant: null,
			})
		).toBeNull();
	});

	it("builds selector item display values", () => {
		expect(getModelSelectorItemId(models[1]!)).toBe("gpt-5");
		expect(getModelSelectorItemId({ modelId: "display-id", displayName: "Display" })).toBe(
			"display-id"
		);
		expect(
			getModelSelectorItemLabel({
				model: models[1]!,
				agentId: "codex",
				modelsDisplay: null,
			})
		).toBe("GPT Five");
		expect(
			getModelSelectorItemLabel({
				model: { modelId: "display-id", displayName: "Display" },
				agentId: "codex",
			})
		).toBe("Display");
		expect(
			getModelSelectorSearchText({
				name: "GPT-5",
				id: "gpt-5",
				description: "Fast",
				providerLabel: "OpenAI",
			})
		).toBe("GPT-5 gpt-5 Fast OpenAI");
	});

	it("uses the Anthropic mark for Claude Code models", () => {
		expect(getModelSelectorProviderBrand("claude-code")).toBe("anthropic");
		expect(getModelSelectorProviderBrand("codex")).toBe("codex");
		expect(getModelSelectorProviderBrand(null)).toBeNull();
	});

	it("uses the canonical capabilities agent before indirect panel state", () => {
		expect(
			resolveModelSelectorAgentId({
				capabilitiesAgentId: "opencode",
				sessionAgentId: null,
				panelAgentId: null,
			})
		).toBe("opencode");
		expect(
			resolveModelSelectorAgentId({
				capabilitiesAgentId: null,
				sessionAgentId: "codex",
				panelAgentId: "claude-code",
			})
		).toBe("codex");
	});
});
