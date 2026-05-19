import { describe, expect, it } from "vitest";
import type { ModelsForDisplay } from "../../../services/acp-types.js";
import type { Model } from "../../application/dto/model.js";
import { AGENT_IDS } from "../../types/agent-id.js";
import {
	closeSplitSelector,
	getCurrentReasoningVariant,
	getModelDisplayFamily,
	getModelDisplayName,
	getUsageMetricsPresentation,
	groupModelsForFallback,
	groupReasoningModelsFromDisplay,
	hasUsableModelsDisplayGroups,
	isContextWindowOnlyMetrics,
	isDefaultChoiceModelId,
	isDefaultModel,
	isSplitSelectorOpen,
	setPrimarySelectorOpen,
	setVariantSelectorOpen,
	supportsReasoningEffortPicker,
	togglePrimarySelector,
} from "../model-selector-logic.js";

describe("model-selector-logic", () => {
	describe("isDefaultChoiceModelId", () => {
		it("treats auto and default as special default choices", () => {
			expect(isDefaultChoiceModelId("auto")).toBe(true);
			expect(isDefaultChoiceModelId("default")).toBe(true);
		});

		it("ignores regular model ids", () => {
			expect(isDefaultChoiceModelId("gpt-5.4")).toBe(false);
			expect(isDefaultChoiceModelId("claude-4.6-sonnet")).toBe(false);
			expect(isDefaultChoiceModelId(null)).toBe(false);
		});
	});

	describe("hasUsableModelsDisplayGroups", () => {
		it("returns false for empty groups arrays", () => {
			expect(
				hasUsableModelsDisplayGroups({
					groups: [],
					presentation: undefined,
				})
			).toBe(false);
		});

		it("returns true when at least one display group has models", () => {
			expect(
				hasUsableModelsDisplayGroups({
					groups: [
						{
							label: "OpenAI",
							models: [{ modelId: "gpt-5.4", displayName: "Gpt-5.4" }],
						},
					],
					presentation: undefined,
				})
			).toBe(true);
		});
	});

	describe("getModelDisplayName", () => {
		describe("when agentId is claude-code", () => {
			const agentId = AGENT_IDS.CLAUDE_CODE;

			it("uses model name instead of parsing provider-specific descriptions", () => {
				const model: Model = {
					id: "opus",
					name: "Opus",
					description: "Opus 4.5 · Most intelligent model",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Opus");
			});

			it("uses model name when description has no separator", () => {
				const model: Model = {
					id: "opus",
					name: "Opus",
					description: "Most intelligent model",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Opus");
			});

			it("uses model name when description is undefined", () => {
				const model: Model = {
					id: "opus",
					name: "Opus",
					description: undefined,
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Opus");
			});

			it("uses canonical model name for default choices unless modelsDisplay supplies a display name", () => {
				const model: Model = {
					id: "default",
					name: "Use the default model (currently Sonnet 4.5)",
					description:
						"Use the default model (currently Sonnet 4.5) · Uses the model from your Claude Code config",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Use The Default Model (currently Sonnet 4.5)");
			});

			it("does not parse provider-specific description prefixes", () => {
				const model: Model = {
					id: "default",
					name: "Default",
					description: "Default model · Some description",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Default");
			});

			it("handles description with empty first part before separator", () => {
				const model: Model = {
					id: "opus",
					name: "Opus",
					description: " · Some description",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Opus");
			});
		});

		describe("when agentId is not claude-code", () => {
			const agentId = "cursor";

			it("uses model name directly regardless of description format", () => {
				const model: Model = {
					id: "claude-3-7-sonnet-20250219",
					name: "Claude 3.7 Sonnet",
					description: "Most intelligent model",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Claude 3.7 Sonnet");
			});

			it("uses model name even when description has separator", () => {
				const model: Model = {
					id: "gpt-4",
					name: "GPT-4",
					description: "GPT-4 · Advanced reasoning",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Gpt-4");
			});

			it("capitalizes model name properly", () => {
				const model: Model = {
					id: "anthropic/claude-3",
					name: "claude 3.5 sonnet",
					description: undefined,
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Claude 3.5 Sonnet");
			});
		});

		describe("when agentId is null", () => {
			it("uses model name directly", () => {
				const model: Model = {
					id: "opus",
					name: "Opus",
					description: "Opus 4.5 · Most intelligent model",
				};

				const result = getModelDisplayName(model, null);

				expect(result).toBe("Opus");
			});
		});

		it("prefers backend-computed display names when modelsDisplay is present", () => {
			const model: Model = {
				id: "default",
				name: "Default",
				description: "Use the default model (currently Sonnet 4.5) · Uses config",
			};
			const modelsDisplay: ModelsForDisplay = {
				groups: [
					{
						label: "",
						models: [
							{
								modelId: "default",
								displayName: "claude-sonnet-4 (default)",
								description: "Uses config",
							},
						],
					},
				],
				presentation: {
					displayFamily: "claudeLike",
					usageMetrics: "contextWindowOnly",
				},
			};

			expect(getModelDisplayName(model, null, modelsDisplay)).toBe("claude-sonnet-4 (default)");
		});
	});

	describe("groupModelsForFallback", () => {
		it("uses one unbranded fallback group instead of inferring providers from model ids", () => {
			const models: Model[] = [
				{ id: "openai/gpt-4", name: "GPT-4", description: undefined },
				{ id: "anthropic/claude", name: "Claude", description: undefined },
				{ id: "google/gemini", name: "Gemini", description: undefined },
			];

			const result = groupModelsForFallback(models);

			expect(result).toEqual([
				{
					label: "",
					models: [
						{ id: "anthropic/claude", name: "Claude", description: undefined },
						{ id: "google/gemini", name: "Gemini", description: undefined },
						{ id: "openai/gpt-4", name: "GPT-4", description: undefined },
					],
				},
			]);
		});

		it("sorts fallback models alphabetically by name", () => {
			const models: Model[] = [
				{ id: "anthropic/claude-4", name: "Claude 4", description: undefined },
				{ id: "anthropic/claude-2", name: "Claude 2", description: undefined },
				{ id: "anthropic/claude-3", name: "Claude 3", description: undefined },
			];

			const result = groupModelsForFallback(models);

			expect(result).toHaveLength(1);
			expect(result[0].models.map((m) => m.name)).toEqual(["Claude 2", "Claude 3", "Claude 4"]);
		});

		it("filters out models with undefined modelId", () => {
			const models: Model[] = [
				{ id: "anthropic/claude", name: "Claude", description: undefined },
				{ id: undefined as unknown as string, name: "Invalid", description: undefined },
			];

			const result = groupModelsForFallback(models);

			expect(result).toHaveLength(1);
			expect(result[0].models).toHaveLength(1);
		});

		it("returns empty array for empty input", () => {
			const result = groupModelsForFallback([]);

			expect(result).toEqual([]);
		});
	});

	describe("isDefaultModel", () => {
		it("returns true only when ids match", () => {
			expect(isDefaultModel(undefined, "foo")).toBe(false);
			expect(isDefaultModel("bar", "foo")).toBe(false);
			expect(isDefaultModel("foo", "foo")).toBe(true);
		});
	});

	describe("groupReasoningModelsFromDisplay", () => {
		it("uses backend group labels and model display names without parsing model id suffixes", () => {
			const groups = groupReasoningModelsFromDisplay({
				groups: [
					{
						label: "GPT-5.3 Codex",
						models: [
							{ modelId: "gpt-5.3-codex/high", displayName: "High reasoning" },
							{ modelId: "gpt-5.3-codex/low", displayName: "Low reasoning" },
						],
					},
				],
				presentation: {
					displayFamily: "codexReasoningEffort",
					usageMetrics: "spendAndContext",
				},
			});

			expect(groups).toEqual([
				{
					baseModelId: "gpt-5.3-codex/high",
					baseModelName: "GPT-5.3 Codex",
					variants: [
						{
							fullModelId: "gpt-5.3-codex/high",
							baseModelId: "gpt-5.3-codex/high",
							name: "High reasoning",
							description: undefined,
						},
						{
							fullModelId: "gpt-5.3-codex/low",
							baseModelId: "gpt-5.3-codex/high",
							name: "Low reasoning",
							description: undefined,
						},
					],
				},
			]);
		});
	});

	describe("getCurrentReasoningVariant", () => {
		const groups = groupReasoningModelsFromDisplay({
			groups: [
				{
					label: "GPT-5.3 Codex",
					models: [
						{ modelId: "gpt-5.3-codex/low", displayName: "Low" },
						{ modelId: "gpt-5.3-codex/medium", displayName: "Medium" },
					],
				},
				{
					label: "GPT-5.2 Codex",
					models: [{ modelId: "gpt-5.2-codex/high", displayName: "High" }],
				},
			],
			presentation: {
				displayFamily: "codexReasoningEffort",
				usageMetrics: "spendAndContext",
			},
		});

		it("returns null when baseGroups is empty", () => {
			expect(getCurrentReasoningVariant([], "gpt-5.3-codex/medium")).toBeNull();
		});

		it("returns first available variant when currentModelId is null", () => {
			const result = getCurrentReasoningVariant(groups, null);
			expect(result?.fullModelId).toBe("gpt-5.3-codex/low");
		});

		it("returns exact current variant when present", () => {
			const result = getCurrentReasoningVariant(groups, "gpt-5.3-codex/medium");
			expect(result?.fullModelId).toBe("gpt-5.3-codex/medium");
		});

		it("falls back to first variant of current canonical group id", () => {
			const result = getCurrentReasoningVariant(groups, "gpt-5.3-codex/low");
			expect(result?.fullModelId).toBe("gpt-5.3-codex/low");
		});

		it("falls back to first available variant when current is missing", () => {
			const result = getCurrentReasoningVariant(groups, "missing");
			expect(result?.fullModelId).toBe("gpt-5.3-codex/low");
		});
	});

	describe("supportsReasoningEffortPicker", () => {
		it("returns false when models is empty", () => {
			expect(supportsReasoningEffortPicker([])).toBe(false);
		});

		it("returns false when all models have undefined modelId", () => {
			const models: Model[] = [
				{ id: undefined as unknown as string, name: "Invalid", description: undefined },
			];
			expect(supportsReasoningEffortPicker(models)).toBe(false);
		});

		it("returns false when models are mixed with non-effort ids", () => {
			const models: Model[] = [
				{ id: "gpt-5.3-codex/low", name: "low", description: undefined },
				{ id: "gpt-4o", name: "gpt-4o", description: undefined },
			];

			expect(supportsReasoningEffortPicker(models)).toBe(false);
		});

		it("returns false when all codex models have only one variant per base", () => {
			const models: Model[] = [
				{ id: "gpt-5.3-codex/low", name: "low", description: undefined },
				{ id: "gpt-5.2-codex/high", name: "high", description: undefined },
			];

			expect(supportsReasoningEffortPicker(models)).toBe(false);
		});

		it("does not infer reasoning effort picker from model ids without canonical display groups", () => {
			const models: Model[] = [
				{ id: "gpt-5.3-codex/low", name: "low", description: undefined },
				{ id: "gpt-5.3-codex/medium", name: "medium", description: undefined },
				{ id: "gpt-5.2-codex/high", name: "high", description: undefined },
			];

			expect(supportsReasoningEffortPicker(models)).toBe(false);
		});

		it("requires backend reasoning groups before enabling backend reasoning presentation", () => {
			const modelsDisplay: ModelsForDisplay = {
				groups: [],
				presentation: {
					displayFamily: "codexReasoningEffort",
					usageMetrics: "spendAndContext",
				},
			};

			expect(supportsReasoningEffortPicker([], modelsDisplay)).toBe(false);
		});

		it("trusts backend reasoning presentation when canonical groups are available", () => {
			const modelsDisplay: ModelsForDisplay = {
				groups: [
					{
						label: "GPT-5.3 Codex",
						models: [
							{ modelId: "gpt-5.3-codex/low", displayName: "low" },
							{ modelId: "gpt-5.3-codex/medium", displayName: "medium" },
						],
					},
				],
				presentation: {
					displayFamily: "codexReasoningEffort",
					usageMetrics: "spendAndContext",
				},
			};

			expect(supportsReasoningEffortPicker([], modelsDisplay)).toBe(true);
		});
	});

	describe("presentation metadata helpers", () => {
		const modelsDisplay: ModelsForDisplay = {
			groups: [],
			presentation: {
				displayFamily: "claudeLike",
				usageMetrics: "contextWindowOnly",
				provider: {
					providerBrand: "claude-code",
					displayName: "Claude Code",
					displayOrder: 10,
					supportsModelDefaults: true,
					variantGroup: "plain",
					defaultAlias: "default",
					reasoningEffortSupport: false,
					preconnectionSlashMode: "startupGlobal",
					preconnectionCapabilityMode: "startupGlobal",
					implicitSessionCreationMode: "allowed",
				},
			},
		};

		it("reads display family from backend metadata", () => {
			expect(getModelDisplayFamily(modelsDisplay)).toBe("claudeLike");
		});

		it("reads usage metrics presentation from backend metadata", () => {
			expect(getUsageMetricsPresentation(modelsDisplay)).toBe("contextWindowOnly");
			expect(isContextWindowOnlyMetrics(modelsDisplay)).toBe(true);
		});
	});

	describe("split selector helpers", () => {
		it("toggles the primary selector and closes the variant selector when opening", () => {
			expect(togglePrimarySelector({ primaryOpen: false, variantOpen: true })).toEqual({
				primaryOpen: true,
				variantOpen: false,
			});
		});

		it("keeps the variant selector closed when the primary selector closes", () => {
			expect(setPrimarySelectorOpen({ primaryOpen: true, variantOpen: false }, false)).toEqual({
				primaryOpen: false,
				variantOpen: false,
			});
		});

		it("hands off from the primary selector to the variant selector", () => {
			expect(setVariantSelectorOpen({ primaryOpen: true, variantOpen: false }, true)).toEqual({
				primaryOpen: false,
				variantOpen: true,
			});
		});

		it("reports whether either split selector control is open", () => {
			expect(isSplitSelectorOpen({ primaryOpen: false, variantOpen: false })).toBe(false);
			expect(isSplitSelectorOpen({ primaryOpen: false, variantOpen: true })).toBe(true);
		});

		it("closes both controls after a model handoff completes", () => {
			expect(closeSplitSelector({ primaryOpen: true, variantOpen: true })).toEqual({
				primaryOpen: false,
				variantOpen: false,
			});
		});
	});
});
