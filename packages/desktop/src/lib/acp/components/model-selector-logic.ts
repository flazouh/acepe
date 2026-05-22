/**
 * Model Selector Logic
 *
 * Pure functions for model selector display and grouping logic.
 * Extracted for testability and reuse.
 */

import type {
	DisplayableModel,
	DisplayModelGroup,
	ModelDisplayFamily,
	ModelsForDisplay,
	UsageMetricsPresentation,
} from "../../services/acp-types.js";
import type { Model } from "../application/dto/model.js";

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
 * Uses canonical display metadata when provided, otherwise falls back to model name.
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

export function hasUsableModelsDisplayGroups(
	modelsDisplay: ModelsForDisplay | null | undefined
): boolean {
	return modelsDisplay?.groups.some((group) => group.models.length > 0) ?? false;
}

export function getModelDisplayName(
	model: Model,
	_agentId: string | null,
	modelsDisplay?: ModelsForDisplay | null
): string {
	const displayModel = findDisplayModel(model.id, modelsDisplay);
	if (displayModel) {
		return displayModel.displayName;
	}

	return capitalizeName(model.name);
}

/**
 * Model group containing provider name and its models.
 */
export interface ModelGroup {
	label: string;
	models: Model[];
}

/**
 * Fallback grouping when backend display groups are unavailable.
 * Keeps the UI usable without inferring provider/product meaning from raw IDs.
 */
export function groupModelsForFallback(models: readonly Model[]): ModelGroup[] {
	const validModels = models.filter((m) => m.id);
	if (validModels.length === 0) {
		return [];
	}

	return [
		{
			label: "",
			models: Array.from(validModels).sort((a, b) =>
				(a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: "base" })
			),
		},
	];
}

export function isDefaultChoiceModelId(modelId: string | null | undefined): boolean {
	return modelId === "default" || modelId === "auto";
}

export interface ReasoningModelVariant {
	fullModelId: string;
	baseModelId: string;
	name: string;
	description?: string;
}

export interface ReasoningBaseModelGroup {
	baseModelId: string;
	baseModelName: string;
	variants: ReasoningModelVariant[];
}

export function getCurrentReasoningVariant(
	baseGroups: readonly ReasoningBaseModelGroup[],
	currentModelId: string | null
): ReasoningModelVariant | null {
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

	if (currentModelId) {
		return null;
	}

	return baseGroups[0]?.variants[0] ?? null;
}

function getReasoningBaseModelId(group: DisplayModelGroup): string {
	return group.models[0]?.modelId ?? group.label;
}

export function groupReasoningModelsFromDisplay(
	modelsDisplay: ModelsForDisplay | null | undefined
): readonly ReasoningBaseModelGroup[] {
	if (getModelDisplayFamily(modelsDisplay) !== "codexReasoningEffort" || !modelsDisplay?.groups) {
		return [];
	}

	return modelsDisplay.groups.map((group) => {
		const baseModelId = getReasoningBaseModelId(group);
		return {
			baseModelId,
			baseModelName: group.label,
			variants: group.models.map((model) => {
				return {
					fullModelId: model.modelId,
					baseModelId,
					name: model.displayName,
					description: model.description ?? undefined,
				};
			}),
		};
	});
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

export function supportsReasoningEffortPicker(
	_models: readonly Model[],
	modelsDisplay?: ModelsForDisplay | null
): boolean {
	return groupReasoningModelsFromDisplay(modelsDisplay).some((group) => group.variants.length > 1);
}

export function isContextWindowOnlyMetrics(
	modelsDisplay: ModelsForDisplay | null | undefined
): boolean {
	return getUsageMetricsPresentation(modelsDisplay) === "contextWindowOnly";
}
