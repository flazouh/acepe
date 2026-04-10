import { describe, expect, it } from "vitest";

import type { Model } from "../../application/dto/model.js";
import type { ModelsForDisplay } from "../../../services/acp-types.js";
import { AGENT_IDS } from "../../types/agent-id.js";
import {
	CODEX_REASONING_EFFORTS,
	closeSplitSelector,
	getCodexCurrentVariant,
	getModelDisplayFamily,
	getModelDisplayName,
	getProviderMetadata,
	getProviderFromModelId,
	getUsageMetricsPresentation,
	isContextWindowOnlyMetrics,
	groupCodexModelsByBase,
	groupModelsByProvider,
	isSplitSelectorOpen,
	isDefaultModel,
	parseCodexModelVariant,
	setPrimarySelectorOpen,
	setVariantSelectorOpen,
	supportsReasoningEffortPicker,
	togglePrimarySelector,
} from "../model-selector-logic.js";

describe("model-selector-logic", () => {
	describe("getModelDisplayName", () => {
		describe("when agentId is claude-code", () => {
			const agentId = AGENT_IDS.CLAUDE_CODE;

			it("extracts model name from description with separator", () => {
				const model: Model = {
					id: "opus",
					name: "Opus",
					description: "Opus 4.5 · Most intelligent model",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Opus 4.5");
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

			it("extracts actual model name from default model description", () => {
				const model: Model = {
					id: "default",
					name: "Use the default model (currently Sonnet 4.5)",
					description:
						"Use the default model (currently Sonnet 4.5) · Uses the model from your Claude Code config",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Sonnet 4.5 (default)");
			});

			it("falls back to full first part when default model has no currently pattern", () => {
				const model: Model = {
					id: "default",
					name: "Default",
					description: "Default model · Some description",
				};

				const result = getModelDisplayName(model, agentId);

				expect(result).toBe("Default model");
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

	describe("getProviderFromModelId", () => {
		it("returns 'Default' for 'default' modelId", () => {
			expect(getProviderFromModelId("default")).toBe("Default");
		});

		it("extracts provider from slash-separated format", () => {
			expect(getProviderFromModelId("anthropic/claude-3")).toBe("Anthropic");
		});

		it("extracts provider from colon-separated format", () => {
			expect(getProviderFromModelId("openai:gpt-4")).toBe("OpenAI");
		});

		it("extracts provider from dot-separated format", () => {
			expect(getProviderFromModelId("google.gemini-pro")).toBe("Google");
		});

		it("infers Anthropic from claude-family model ids", () => {
			expect(getProviderFromModelId("claude-sonnet-4")).toBe("Anthropic");
		});

		it("infers OpenAI from gpt-family model ids", () => {
			expect(getProviderFromModelId("gpt-5.3-codex")).toBe("OpenAI");
		});

		it("returns 'Other' for modelId without separator", () => {
			expect(getProviderFromModelId("opus")).toBe("Other");
		});

		it("returns 'Other' for empty modelId", () => {
			expect(getProviderFromModelId("")).toBe("Other");
		});

		it("capitalizes provider name", () => {
			expect(getProviderFromModelId("ANTHROPIC/claude")).toBe("Anthropic");
		});
	});

	describe("groupModelsByProvider", () => {
		it("groups models by their provider", () => {
			const models: Model[] = [
				{ id: "anthropic/claude-3", name: "Claude 3", description: undefined },
				{ id: "anthropic/claude-4", name: "Claude 4", description: undefined },
				{ id: "openai/gpt-4", name: "GPT-4", description: undefined },
			];

			const result = groupModelsByProvider(models);

			expect(result).toHaveLength(2);
			expect(result[0].provider).toBe("Anthropic");
			expect(result[0].models).toHaveLength(2);
			expect(result[1].provider).toBe("OpenAI");
			expect(result[1].models).toHaveLength(1);
		});

		it("puts 'Default' provider first", () => {
			const models: Model[] = [
				{ id: "anthropic/claude-3", name: "Claude 3", description: undefined },
				{ id: "default", name: "Default", description: undefined },
			];

			const result = groupModelsByProvider(models);

			expect(result[0].provider).toBe("Default");
			expect(result[1].provider).toBe("Anthropic");
		});

		it("sorts providers alphabetically (except Default)", () => {
			const models: Model[] = [
				{ id: "openai/gpt-4", name: "GPT-4", description: undefined },
				{ id: "anthropic/claude", name: "Claude", description: undefined },
				{ id: "google/gemini", name: "Gemini", description: undefined },
			];

			const result = groupModelsByProvider(models);

			expect(result.map((g) => g.provider)).toEqual(["Anthropic", "Google", "OpenAI"]);
		});

		it("sorts models within each provider alphabetically by name", () => {
			const models: Model[] = [
				{ id: "anthropic/claude-4", name: "Claude 4", description: undefined },
				{ id: "anthropic/claude-2", name: "Claude 2", description: undefined },
				{ id: "anthropic/claude-3", name: "Claude 3", description: undefined },
			];

			const result = groupModelsByProvider(models);

			expect(result).toHaveLength(1);
			expect(result[0].provider).toBe("Anthropic");
			expect(result[0].models.map((m) => m.name)).toEqual(["Claude 2", "Claude 3", "Claude 4"]);
		});

		it("filters out models with undefined modelId", () => {
			const models: Model[] = [
				{ id: "anthropic/claude", name: "Claude", description: undefined },
				{ id: undefined as unknown as string, name: "Invalid", description: undefined },
			];

			const result = groupModelsByProvider(models);

			expect(result).toHaveLength(1);
			expect(result[0].models).toHaveLength(1);
		});

		it("returns empty array for empty input", () => {
			const result = groupModelsByProvider([]);

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

	describe("CODEX_REASONING_EFFORTS", () => {
		it("includes low, medium, high, xhigh", () => {
			expect(CODEX_REASONING_EFFORTS).toEqual(["low", "medium", "high", "xhigh"]);
		});
	});

	describe("parseCodexModelVariant", () => {
		it("parses codex model id with reasoning suffix", () => {
			const model: Model = {
				id: "gpt-5.3-codex/medium",
				name: "gpt-5.3-codex (medium)",
				description: undefined,
			};

			expect(parseCodexModelVariant(model)).toEqual({
				fullModelId: "gpt-5.3-codex/medium",
				baseModelId: "gpt-5.3-codex",
				effort: "medium",
				name: "gpt-5.3-codex (medium)",
				description: undefined,
			});
		});

		it("parses xhigh effort and preserves description", () => {
			const model: Model = {
				id: "claude-sonnet/xhigh",
				name: "Claude Sonnet (xhigh)",
				description: "Maximum reasoning effort",
			};

			expect(parseCodexModelVariant(model)).toEqual({
				fullModelId: "claude-sonnet/xhigh",
				baseModelId: "claude-sonnet",
				effort: "xhigh",
				name: "Claude Sonnet (xhigh)",
				description: "Maximum reasoning effort",
			});
		});

		it("returns null for non-codex model ids without effort suffix", () => {
			const model: Model = {
				id: "gpt-5.3-codex",
				name: "gpt-5.3-codex",
				description: undefined,
			};

			expect(parseCodexModelVariant(model)).toBeNull();
		});

		it("returns null for invalid effort value", () => {
			const model: Model = {
				id: "gpt-5.3-codex/invalid",
				name: "Invalid",
				description: undefined,
			};

			expect(parseCodexModelVariant(model)).toBeNull();
		});

		it("returns null when slash is at start", () => {
			const model: Model = {
				id: "/medium",
				name: "Medium",
				description: undefined,
			};

			expect(parseCodexModelVariant(model)).toBeNull();
		});

		it("returns null when slash is at end", () => {
			const model: Model = {
				id: "gpt/",
				name: "GPT",
				description: undefined,
			};

			expect(parseCodexModelVariant(model)).toBeNull();
		});
	});

	describe("groupCodexModelsByBase", () => {
		it("groups variants under base model and sorts efforts", () => {
			const models: Model[] = [
				{ id: "gpt-5.3-codex/high", name: "high", description: undefined },
				{ id: "gpt-5.3-codex/low", name: "low", description: undefined },
				{ id: "gpt-5.3-codex/medium", name: "medium", description: undefined },
				{ id: "gpt-5.2-codex/xhigh", name: "xhigh", description: undefined },
				{ id: "gpt-5.2-codex/high", name: "high", description: undefined },
			];

			const result = groupCodexModelsByBase(models);
			expect(result).toHaveLength(2);
			expect(result[0]?.baseModelId).toBe("gpt-5.2-codex");
			expect(result[0]?.variants.map((variant) => variant.effort)).toEqual(["high", "xhigh"]);
			expect(result[1]?.baseModelId).toBe("gpt-5.3-codex");
			expect(result[1]?.variants.map((variant) => variant.effort)).toEqual([
				"low",
				"medium",
				"high",
			]);
		});
	});

	describe("getCodexCurrentVariant", () => {
		const groups = groupCodexModelsByBase([
			{ id: "gpt-5.3-codex/low", name: "low", description: undefined },
			{ id: "gpt-5.3-codex/medium", name: "medium", description: undefined },
			{ id: "gpt-5.2-codex/high", name: "high", description: undefined },
		]);

		it("returns null when baseGroups is empty", () => {
			expect(getCodexCurrentVariant([], "gpt-5.3-codex/medium")).toBeNull();
		});

		it("returns first available variant when currentModelId is null", () => {
			const result = getCodexCurrentVariant(groups, null);
			expect(result?.fullModelId).toBe("gpt-5.2-codex/high");
		});

		it("returns exact current variant when present", () => {
			const result = getCodexCurrentVariant(groups, "gpt-5.3-codex/medium");
			expect(result?.fullModelId).toBe("gpt-5.3-codex/medium");
		});

		it("falls back to first variant of current base model id", () => {
			const result = getCodexCurrentVariant(groups, "gpt-5.3-codex");
			expect(result?.fullModelId).toBe("gpt-5.3-codex/low");
		});

		it("falls back to first available variant when current is missing", () => {
			const result = getCodexCurrentVariant(groups, "missing");
			expect(result?.fullModelId).toBe("gpt-5.2-codex/high");
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

		it("returns true when all models are effort variants with multiple per base", () => {
			const models: Model[] = [
				{ id: "gpt-5.3-codex/low", name: "low", description: undefined },
				{ id: "gpt-5.3-codex/medium", name: "medium", description: undefined },
				{ id: "gpt-5.2-codex/high", name: "high", description: undefined },
			];

			expect(supportsReasoningEffortPicker(models)).toBe(true);
		});

		it("trusts backend presentation metadata when available", () => {
			const modelsDisplay: ModelsForDisplay = {
				groups: [],
				presentation: {
					displayFamily: "codexReasoningEffort",
					usageMetrics: "spendAndContext",
				},
			};

			expect(supportsReasoningEffortPicker([], modelsDisplay)).toBe(true);
		});

		it("trusts provider metadata reasoning support when available", () => {
			const modelsDisplay: ModelsForDisplay = {
				groups: [],
				presentation: {
					displayFamily: "providerGrouped",
					usageMetrics: "spendAndContext",
					provider: {
						providerBrand: "codex",
						displayName: "Codex",
						displayOrder: 50,
						supportsModelDefaults: true,
						variantGroup: "reasoningEffort",
						defaultAlias: undefined,
						reasoningEffortSupport: true,
						autonomousApplyStrategy: "postConnect",
						preconnectionSlashMode: "startupGlobal",
					},
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
					autonomousApplyStrategy: "launchProfile",
					preconnectionSlashMode: "startupGlobal",
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

		it("reads provider projection metadata from backend metadata", () => {
			expect(getProviderMetadata(modelsDisplay)).toEqual({
				providerBrand: "claude-code",
				displayName: "Claude Code",
				displayOrder: 10,
				supportsModelDefaults: true,
				variantGroup: "plain",
				defaultAlias: "default",
				reasoningEffortSupport: false,
				autonomousApplyStrategy: "launchProfile",
				preconnectionSlashMode: "startupGlobal",
			});
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
