/**
 * Model Selector Logic
 *
 * Pure functions for model selector display and grouping logic.
 * Extracted for testability and reuse.
 */

import type { Model } from "../application/dto/model.js";
import {
	getProviderMetadataFromModelsDisplay,
	resolveProviderMetadataProjection,
	type ProviderMetadataProjection,
} from "../../services/acp-provider-metadata.js";
import type {
	DisplayModelGroup,
	DisplayableModel,
	ModelDisplayFamily,
	ModelsForDisplay,
	UsageMetricsPresentation,
} from "../../services/acp-types.js";
import {
	getProviderDisplayName,
} from "@acepe/ui";
import { AGENT_IDS } from "../types/agent-id.js";

/**
 * Capitalizes the first letter of each word in a string.
 */
function capitalizeName(name: string): string {
	return name
		.split(/\s+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

/**
 * Gets the display name for a model.
 *
 * For Claude Code: Extracts model name from description format "Model Name · Description text"
 * For other agents: Uses the model name directly with proper capitalization
 *
 * @param model - The model to get display name for
 * @param agentId - The agent ID, used to determine extraction behavior
 * @returns The display name for the model
 */
function findDisplayModel(
	modelId: string,
	modelsDisplay: ModelsForDisplay | null | undefined
): DisplayableModel | null {
	if (!modelsDisplay?.groups) {
		return null;
	}

	for (const group of modelsDisplay.groups) {
		const match = group.models.find((candidate) => candidate.modelId === modelId);
		if (match) {
			return match;
		}
	}

	return null;
}

export function getModelDisplayName(
	model: Model,
	agentId: string | null,
	modelsDisplay?: ModelsForDisplay | null
): string {
	const displayModel = findDisplayModel(model.id, modelsDisplay);
	if (displayModel) {
		return displayModel.displayName;
	}

	// For Claude Code, try to extract model name from description (format: "Model Name · Description")
	if (agentId === AGENT_IDS.CLAUDE_CODE && model.description) {
		const parts = model.description.split(" · ");
		if (parts.length >= 2 && parts[0].trim()) {
			const firstPart = parts[0].trim();

			// For "default" model, extract actual model name from "Use the default model (currently X)"
			if (model.id === "default") {
				const match = firstPart.match(/\(currently\s+(.+?)\)/);
				if (match?.[1]) {
					return `${match[1]} (default)`;
				}
			}

			return firstPart;
		}
	}

	// Use model name directly (capitalize first letter of each word)
	return capitalizeName(model.name);
}

/**
 * Extracts the provider from a model ID.
 *
 * Handles formats:
 * - "anthropic/claude-3" -> "Anthropic"
 * - "openai:gpt-4" -> "OpenAI"
 * - "google.gemini-pro" -> "Google"
 * - "claude-sonnet-4" -> "Anthropic"
 * - "gpt-5.3-codex" -> "OpenAI"
 * - "default" -> "Default"
 * - "opus" -> "Other" (no separator)
 *
 * @param modelId - The model ID to extract provider from
 * @returns Provider display name or "Other" if not found
 */
export function getProviderFromModelId(modelId: string): string {
	return getProviderDisplayName(modelId);
}

/**
 * Model group containing provider name and its models.
 */
export interface ModelGroup {
	provider: string;
	models: Model[];
}

/**
 * Groups models by their provider and sorts them.
 *
 * - Filters out models with undefined id
 * - Groups by provider extracted from id
 * - Sorts with "Default" first, then alphabetically
 *
 * @param models - Array of models to group
 * @returns Sorted array of model groups
 */
export function groupModelsByProvider(models: readonly Model[]): ModelGroup[] {
	// Filter out models with undefined id
	const validModels = models.filter((m) => m.id);

	// Group by provider
	const groups: Record<string, Model[]> = {};

	for (const model of validModels) {
		const provider = getProviderFromModelId(model.id);
		if (!groups[provider]) {
			groups[provider] = [];
		}
		groups[provider].push(model);
	}

	// Sort providers: Default first, then alphabetically
	const sortedKeys = Object.keys(groups).sort((a, b) => {
		if (a === "Default") return -1;
		if (b === "Default") return 1;
		return a.localeCompare(b);
	});

	// Sort models within each provider alphabetically by name
	return sortedKeys.map((provider) => ({
		provider,
		models: [...groups[provider]].sort((a, b) =>
			(a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: "base" })
		),
	}));
}

export function isDefaultModel(defaultModelId: string | undefined, modelId: string): boolean {
	return defaultModelId === modelId;
}

export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export interface CodexModelVariant {
	fullModelId: string;
	baseModelId: string;
	effort: CodexReasoningEffort;
	name: string;
	description?: string;
}

export interface CodexBaseModelGroup {
	baseModelId: string;
	baseModelName: string;
	variants: CodexModelVariant[];
}

function toEffort(value: string): CodexReasoningEffort | null {
	const match = CODEX_REASONING_EFFORTS.find((effort) => effort === value);
	return match ?? null;
}

function getEffortOrder(effort: CodexReasoningEffort): number {
	return CODEX_REASONING_EFFORTS.indexOf(effort);
}

export function parseCodexModelVariant(model: Model): CodexModelVariant | null {
	const slashIndex = model.id.lastIndexOf("/");
	if (slashIndex <= 0 || slashIndex >= model.id.length - 1) {
		return null;
	}

	const baseModelId = model.id.slice(0, slashIndex);
	const effortValue = model.id.slice(slashIndex + 1);
	const effort = toEffort(effortValue);
	if (!effort) {
		return null;
	}

	return {
		fullModelId: model.id,
		baseModelId,
		effort,
		name: model.name,
		description: model.description,
	};
}

export function groupCodexModelsByBase(models: readonly Model[]): CodexBaseModelGroup[] {
	const grouped = new Map<string, CodexModelVariant[]>();
	const displayNameByBase = new Map<string, string>();

	for (const model of models) {
		const variant = parseCodexModelVariant(model);
		if (!variant) {
			continue;
		}

		const current = grouped.get(variant.baseModelId) ?? [];
		current.push(variant);
		grouped.set(variant.baseModelId, current);
		if (!displayNameByBase.has(variant.baseModelId)) {
			displayNameByBase.set(variant.baseModelId, capitalizeName(variant.baseModelId));
		}
	}

	const baseGroups = Array.from(grouped.entries())
		.map(([baseModelId, variants]) => ({
			baseModelId,
			baseModelName: displayNameByBase.get(baseModelId) ?? capitalizeName(baseModelId),
			variants: variants.sort((a, b) => getEffortOrder(a.effort) - getEffortOrder(b.effort)),
		}))
		.sort((a, b) => a.baseModelName.localeCompare(b.baseModelName));

	return baseGroups;
}

export function getCodexCurrentVariant(
	baseGroups: readonly CodexBaseModelGroup[],
	currentModelId: string | null
): CodexModelVariant | null {
	if (baseGroups.length === 0) {
		return null;
	}

	if (currentModelId) {
		const exact = baseGroups
			.flatMap((group) => group.variants)
			.find((variant) => variant.fullModelId === currentModelId);
		if (exact) {
			return exact;
		}

		const group = baseGroups.find((candidate) => candidate.baseModelId === currentModelId);
		if (group?.variants[0]) {
			return group.variants[0];
		}
	}

	return baseGroups[0]?.variants[0] ?? null;
}

function getReasoningBaseModelId(group: DisplayModelGroup): string {
	const firstModelId = group.models[0]?.modelId ?? "";
	if (!firstModelId) {
		return "";
	}

	const slashIndex = firstModelId.lastIndexOf("/");
	return slashIndex > 0 ? firstModelId.slice(0, slashIndex) : firstModelId;
}

export function groupReasoningModelsFromDisplay(
	modelsDisplay: ModelsForDisplay | null | undefined
): readonly CodexBaseModelGroup[] {
	if (getModelDisplayFamily(modelsDisplay) !== "codexReasoningEffort" || !modelsDisplay?.groups) {
		return [];
	}

	return modelsDisplay.groups.map((group) => ({
		baseModelId: getReasoningBaseModelId(group),
		baseModelName: group.label,
		variants: group.models.map((model) => {
			const slashIndex = model.modelId.lastIndexOf("/");
			const effort = (
				slashIndex > 0 && slashIndex < model.modelId.length - 1
					? model.modelId.slice(slashIndex + 1)
					: "medium"
			) as "low" | "medium" | "high" | "xhigh";

			return {
				fullModelId: model.modelId,
				baseModelId: slashIndex > 0 ? model.modelId.slice(0, slashIndex) : model.modelId,
				effort,
				name: model.displayName,
				description: model.description ?? undefined,
			};
		}),
	}));
}

export function getModelDisplayFamily(
	modelsDisplay: ModelsForDisplay | null | undefined
): ModelDisplayFamily | null {
	return modelsDisplay?.presentation?.displayFamily ?? null;
}

export function getUsageMetricsPresentation(
	modelsDisplay: ModelsForDisplay | null | undefined
): UsageMetricsPresentation | null {
	return modelsDisplay?.presentation?.usageMetrics ?? null;
}

export function getProviderMetadata(
	modelsDisplay: ModelsForDisplay | null | undefined
): ProviderMetadataProjection | null {
	return getProviderMetadataFromModelsDisplay(modelsDisplay);
}

export interface SplitSelectorState {
	primaryOpen: boolean;
	variantOpen: boolean;
}

export function togglePrimarySelector(state: SplitSelectorState): SplitSelectorState {
	const nextPrimaryOpen = !state.primaryOpen;
	return {
		primaryOpen: nextPrimaryOpen,
		variantOpen: false,
	};
}

export function setPrimarySelectorOpen(
	state: SplitSelectorState,
	primaryOpen: boolean
): SplitSelectorState {
	return {
		primaryOpen,
		variantOpen: primaryOpen ? false : state.variantOpen,
	};
}

export function setVariantSelectorOpen(
	state: SplitSelectorState,
	variantOpen: boolean
): SplitSelectorState {
	return {
		primaryOpen: variantOpen ? false : state.primaryOpen,
		variantOpen,
	};
}

export function closeSplitSelector(_: SplitSelectorState): SplitSelectorState {
	return {
		primaryOpen: false,
		variantOpen: false,
	};
}

export function isSplitSelectorOpen(state: SplitSelectorState): boolean {
	return state.primaryOpen || state.variantOpen;
}

export function resolveSelectorProviderMetadata(
	agentId: string | null,
	modelsDisplay: ModelsForDisplay | null | undefined
): ProviderMetadataProjection | null {
	const projectedProviderMetadata = getProviderMetadata(modelsDisplay);
	if (projectedProviderMetadata) {
		return projectedProviderMetadata;
	}

	if (!agentId) {
		return null;
	}

	return resolveProviderMetadataProjection(agentId, null, agentId);
}

export function getProviderMarkSource(
	providerMetadata: ProviderMetadataProjection | null | undefined
): string {
	if (!providerMetadata) {
		return "other";
	}

	return providerMetadata.providerBrand;
}

export function supportsReasoningEffortPicker(
	models: readonly Model[],
	modelsDisplay?: ModelsForDisplay | null
): boolean {
	if (getProviderMetadata(modelsDisplay)?.reasoningEffortSupport) {
		return true;
	}

	if (getModelDisplayFamily(modelsDisplay) === "codexReasoningEffort") {
		return true;
	}

	const validModels = models.filter((model) => model.id);
	if (validModels.length === 0) {
		return false;
	}

	const parsedCount = validModels.filter((model) => parseCodexModelVariant(model) !== null).length;
	if (parsedCount !== validModels.length) {
		return false;
	}

	const groups = groupCodexModelsByBase(validModels);
	return groups.some((group) => group.variants.length > 1);
}

export function isContextWindowOnlyMetrics(
	modelsDisplay: ModelsForDisplay | null | undefined
): boolean {
	return getUsageMetricsPresentation(modelsDisplay) === "contextWindowOnly";
}
