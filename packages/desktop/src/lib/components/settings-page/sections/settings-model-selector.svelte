<script lang="ts">
import {
	AgentInputModelSelector as SharedAgentInputModelSelector,
	type AgentInputModelSelectorGroup,
	type AgentInputModelSelectorItem,
	type AgentInputModelSelectorReasoningGroup,
} from "@acepe/ui";
import type { Model } from "$lib/acp/application/dto/model.js";
import {
	getCodexCurrentVariant,
	getModelDisplayName,
	groupCodexModelsByBase,
	groupModelsByProvider,
	groupReasoningModelsFromDisplay,
	hasUsableModelsDisplayGroups,
	isDefaultChoiceModelId,
	supportsReasoningEffortPicker,
} from "$lib/acp/components/model-selector-logic.js";
import * as preferencesStore from "$lib/acp/store/agent-model-preferences-store.svelte.js";
import type { ModeType } from "$lib/acp/types/agent-model-preferences.js";
import type { DisplayableModel, ModelsForDisplay } from "$lib/services/acp-types.js";

const CLEAR_DEFAULT_ID = "__settings_clear_default__";

interface Props {
	agentId: string;
	modeType: ModeType;
	availableModels: readonly Model[];
	modelsDisplay: ModelsForDisplay | null;
	fallbackLabel: string;
	isLoading?: boolean;
}

let {
	agentId,
	modeType,
	availableModels,
	modelsDisplay,
	fallbackLabel,
	isLoading = false,
}: Props = $props();

const currentDefaultId = $derived(preferencesStore.getDefaultModel(agentId, modeType) ?? null);

const validModels = $derived(availableModels.filter((model) => model.id));
const hasDisplayGroups = $derived(hasUsableModelsDisplayGroups(modelsDisplay));
const allDisplayableModels = $derived.by<DisplayableModel[]>(() => {
	if (!hasDisplayGroups) {
		return [];
	}
	return modelsDisplay!.groups.flatMap((group) => group.models);
});

const usesVariantSelector = $derived(supportsReasoningEffortPicker(availableModels, modelsDisplay));
const reasoningBaseGroupsFromDisplay = $derived.by(() =>
	groupReasoningModelsFromDisplay(modelsDisplay)
);
const reasoningBaseGroups = $derived.by(() =>
	usesVariantSelector
		? reasoningBaseGroupsFromDisplay.length > 0
			? reasoningBaseGroupsFromDisplay
			: groupCodexModelsByBase(availableModels)
		: []
);
const selectedReasoningVariant = $derived.by(() =>
	usesVariantSelector ? getCodexCurrentVariant(reasoningBaseGroups, currentDefaultId) : null
);
const selectedReasoningBaseGroup = $derived.by(() => {
	if (!usesVariantSelector || reasoningBaseGroups.length === 0) {
		return null;
	}
	if (!selectedReasoningVariant) {
		return reasoningBaseGroups[0] ?? null;
	}
	return (
		reasoningBaseGroups.find(
			(group) => group.baseModelId === selectedReasoningVariant.baseModelId
		) ??
		reasoningBaseGroups[0] ??
		null
	);
});
const primarySelectorLabel = $derived(selectedReasoningBaseGroup?.baseModelName ?? fallbackLabel);

function getModelIdFrom(model: Model | DisplayableModel): string {
	return "displayName" in model ? model.modelId : model.id;
}

function getDisplayLabel(model: Model | DisplayableModel): string {
	return "displayName" in model
		? model.displayName
		: getModelDisplayName(model, agentId, modelsDisplay);
}

function getModelProviderSource(model: Model | DisplayableModel): string {
	return `${getDisplayLabel(model)} ${getModelIdFrom(model)}`;
}

function toSelectorItem(model: Model | DisplayableModel): AgentInputModelSelectorItem {
	const id = getModelIdFrom(model);
	const name = getDisplayLabel(model);
	return {
		id,
		name,
		providerSource: getModelProviderSource(model),
		description: model.description ?? undefined,
		searchText: `${name} ${id} ${model.description ?? ""} ${getModelProviderSource(model)}`,
		hideProviderMark: isDefaultChoiceModelId(id),
	};
}

const clearDefaultFavorite = $derived<AgentInputModelSelectorItem>({
	id: CLEAR_DEFAULT_ID,
	name: fallbackLabel,
	providerSource: `${fallbackLabel} default`,
	description: "Use the provider default when no model is chosen.",
	searchText: `${fallbackLabel} default first available`,
	hideProviderMark: true,
});

const favoriteModels = $derived<readonly AgentInputModelSelectorItem[]>([clearDefaultFavorite]);

const modelGroups = $derived.by<AgentInputModelSelectorGroup[]>(() => {
	if (hasDisplayGroups) {
		return modelsDisplay!.groups.map((group) => ({
			label: group.label,
			items: Array.from(group.models)
				.sort((left, right) =>
					left.displayName.localeCompare(right.displayName, undefined, {
						sensitivity: "base",
					})
				)
				.map(toSelectorItem),
		}));
	}

	return groupModelsByProvider(validModels).map((group) => ({
		label: group.provider,
		items: group.models.map(toSelectorItem),
	}));
});

const reasoningGroups = $derived.by<AgentInputModelSelectorReasoningGroup[]>(() =>
	reasoningBaseGroups.map((group) => {
		const preferredVariantId =
			selectedReasoningVariant && selectedReasoningVariant.baseModelId === group.baseModelId
				? (group.variants.find(
						(variant) => variant.fullModelId === selectedReasoningVariant.fullModelId
					)?.fullModelId ?? null)
				: (group.variants.find((variant) => variant.effort === "medium")?.fullModelId ??
					group.variants[0]?.fullModelId ??
					null);
		return {
			baseModelId: group.baseModelId,
			baseModelName: group.baseModelName,
			providerSource: `${group.baseModelName} ${group.baseModelId}`,
			preferredVariantId,
			variants: group.variants.map((variant) => ({
				id: variant.fullModelId,
				name: variant.effort,
			})),
		};
	})
);

const selectedModelDisplayName = $derived.by(() => {
	if (!currentDefaultId) {
		return fallbackLabel;
	}
	if (hasDisplayGroups) {
		for (const group of modelsDisplay!.groups) {
			const match = group.models.find((model) => model.modelId === currentDefaultId);
			if (match) {
				return match.displayName;
			}
		}
	}
	const match = validModels.find((model) => model.id === currentDefaultId);
	if (match) {
		return getModelDisplayName(match, agentId, modelsDisplay);
	}
	return fallbackLabel;
});

const triggerProviderMarkSource = $derived.by(() => {
	if (!currentDefaultId) {
		return `${fallbackLabel} default`;
	}
	return `${selectedModelDisplayName} ${currentDefaultId}`;
});

function handleModelChange(modelId: string): void {
	if (modelId === CLEAR_DEFAULT_ID) {
		preferencesStore.setDefaultModel(agentId, modeType, undefined);
		return;
	}
	preferencesStore.setDefaultModel(agentId, modeType, modelId);
}
</script>

<SharedAgentInputModelSelector
	triggerLabel={selectedModelDisplayName}
	triggerProviderSource={triggerProviderMarkSource}
	currentModelId={currentDefaultId ?? CLEAR_DEFAULT_ID}
	{isLoading}
	{modelGroups}
	{favoriteModels}
	hideTriggerProviderMark={!currentDefaultId || isDefaultChoiceModelId(currentDefaultId)}
	reasoningGroups={usesVariantSelector ? reasoningGroups : []}
	selectedReasoningBaseId={selectedReasoningVariant?.baseModelId ?? null}
	selectedReasoningVariantId={currentDefaultId}
	{primarySelectorLabel}
	primaryTriggerProviderSource={`${primarySelectorLabel} ${selectedReasoningBaseGroup?.baseModelId ?? currentDefaultId ?? ""}`}
	searchPlaceholder="Search models..."
	loadingLabel="Loading..."
	noModelsLabel="Unavailable"
	noReasoningLevelsLabel="No reasoning levels available"
	reasoningEffortTooltipLabel="Reasoning effort"
	onModelChange={handleModelChange}
/>
