import type { ProviderBrand as ModelPickerProviderBrand } from "@acepe/ui";
import type { DisplayableModel, ModelsForDisplay } from "../../services/acp-types.js";
import type { ProviderBrand as AgentProviderBrand } from "../../services/acp-types.js";
import type { Model } from "../application/dto/model.js";
import type { ModelId } from "../types/model-id.js";
import {
	getModelDisplayName,
	type ReasoningBaseModelGroup,
	type ReasoningModelVariant,
} from "./model-selector-logic.js";

export function getSelectedModel(input: {
	currentModelId: ModelId | null;
	availableModels: readonly Model[];
}): Model | null {
	if (!input.currentModelId || input.availableModels.length === 0) return null;
	return input.availableModels.find((model) => model.id === input.currentModelId) ?? null;
}

export function getModelSelectorDisplayName(input: {
	currentModelId: ModelId | null;
	modelsDisplay?: ModelsForDisplay | null;
	selectedModel: Model | null;
	agentId: string | null;
}): string {
	if (!input.currentModelId) return "Model";

	for (const group of input.modelsDisplay?.groups ?? []) {
		const match = group.models.find((model) => model.modelId === input.currentModelId);
		if (match) return match.displayName;
	}

	if (!input.selectedModel) return "Model";

	return getModelDisplayName(input.selectedModel, input.agentId, input.modelsDisplay);
}

export function getSelectedReasoningBaseGroup(input: {
	usesVariantSelector: boolean;
	reasoningBaseGroups: readonly ReasoningBaseModelGroup[];
	selectedReasoningVariant: ReasoningModelVariant | null;
	currentModelId: ModelId | null;
}): ReasoningBaseModelGroup | null {
	if (!input.usesVariantSelector || input.reasoningBaseGroups.length === 0) return null;

	if (!input.selectedReasoningVariant) {
		return input.currentModelId ? null : (input.reasoningBaseGroups[0] ?? null);
	}

	return (
		input.reasoningBaseGroups.find(
			(group) => group.baseModelId === input.selectedReasoningVariant?.baseModelId
		) ??
		input.reasoningBaseGroups[0] ??
		null
	);
}

export function getPreferredReasoningVariantId(input: {
	baseModelId: string;
	reasoningBaseGroups: readonly ReasoningBaseModelGroup[];
	selectedReasoningVariant: ReasoningModelVariant | null;
}): string | null {
	const baseGroup = input.reasoningBaseGroups.find(
		(group) => group.baseModelId === input.baseModelId
	);
	if (!baseGroup) return null;

	const matchingCurrent =
		input.selectedReasoningVariant?.baseModelId === input.baseModelId
			? baseGroup.variants.find(
					(variant) => variant.fullModelId === input.selectedReasoningVariant?.fullModelId
				)
			: undefined;

	return matchingCurrent?.fullModelId ?? baseGroup.variants[0]?.fullModelId ?? null;
}

export function getModelSelectorItemId(model: Model | DisplayableModel): string {
	return "displayName" in model ? model.modelId : model.id;
}

export function getModelSelectorItemLabel(input: {
	model: Model | DisplayableModel;
	agentId: string | null;
	modelsDisplay?: ModelsForDisplay | null;
}): string {
	return "displayName" in input.model
		? input.model.displayName
		: getModelDisplayName(input.model, input.agentId, input.modelsDisplay);
}

export function getModelSelectorSearchText(input: {
	name: string;
	id: string;
	description?: string | null;
	providerLabel?: string | null;
}): string {
	return `${input.name} ${input.id} ${input.description ?? ""} ${input.providerLabel ?? ""}`;
}

export function getModelSelectorProviderBrand(
	providerBrand: AgentProviderBrand | null | undefined
): ModelPickerProviderBrand | null {
	if (!providerBrand) {
		return null;
	}

	return providerBrand === "claude-code" ? "anthropic" : providerBrand;
}
