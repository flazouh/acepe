import type { ProviderBrand as ModelPickerProviderBrand } from "@acepe/ui";
import type {
	ProviderBrand as AgentProviderBrand,
	DisplayableModel,
	ModelsForDisplay,
} from "../../services/acp-types.js";
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

export function resolveModelSelectorAgentId(input: {
	capabilitiesAgentId: string | null;
	sessionAgentId: string | null;
	panelAgentId: string | null;
}): string | null {
	return input.capabilitiesAgentId ?? input.sessionAgentId ?? input.panelAgentId;
}

interface ModelSelectorDisplayNameInput {
	readonly currentModelId: ModelId | null;
	readonly modelsDisplay?: ModelsForDisplay | null;
	readonly selectedModel: Model | null;
	readonly agentId: string | null;
}

/**
 * Resolves the trigger's display name, distinguishing a genuinely known model
 * name from a fallback. `knownName` is only set when we actually know which
 * model is selected (from display groups or the live model catalog) -- never
 * a guess.
 */
function resolveModelSelectorDisplayName(
	input: ModelSelectorDisplayNameInput
): { readonly knownName: string } | { readonly knownName: null } {
	if (!input.currentModelId) return { knownName: null };

	for (const group of input.modelsDisplay?.groups ?? []) {
		const match = group.models.find((model) => model.modelId === input.currentModelId);
		if (match) return { knownName: match.displayName };
	}

	if (!input.selectedModel) return { knownName: null };

	return {
		knownName: getModelDisplayName(input.selectedModel, input.agentId, input.modelsDisplay),
	};
}

export function getModelSelectorDisplayName(
	input: ModelSelectorDisplayNameInput & {
		/**
		 * Honest last resort when no current model id is known at all (e.g.
		 * session capabilities haven't arrived yet). Must be real, already-known
		 * data (the agent's own display name) -- never a guessed or fabricated
		 * model name.
		 */
		fallbackDisplayName?: string | null;
	}
): string {
	const resolved = resolveModelSelectorDisplayName(input);
	return resolved.knownName ?? input.fallbackDisplayName ?? "Model";
}

/**
 * True when the trigger label could not be resolved to a genuinely known
 * model name and is showing a fallback (agent name or the bare "Model")
 * instead. Callers use this to surface an honest tooltip rather than let the
 * fallback silently read as if it were the real selected model.
 */
export function isModelSelectorDisplayNameFallback(input: ModelSelectorDisplayNameInput): boolean {
	return resolveModelSelectorDisplayName(input).knownName === null;
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
