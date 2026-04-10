<script lang="ts">
import { ProviderMark } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Input } from "$lib/components/ui/input/index.js";
import * as m from "$lib/paraglide/messages.js";

import type {
	DisplayableModel,
	DisplayModelGroup,
	ModelsForDisplay,
} from "../../services/acp-types.js";

import type { Model } from "../application/dto/model.js";
import * as preferencesStore from "../store/agent-model-preferences-store.svelte.js";
import { CanonicalModeId } from "../types/canonical-mode-id.js";
import type { ModelId } from "../types/model-id.js";
import ModelSelectorFavoriteStar from "./model-selector.favorite-star.svelte";
import ModelSelectorModeBar from "./model-selector.mode-bar.svelte";
import ModelSelectorRow from "./model-selector.row.svelte";
import {
	getCodexCurrentVariant,
	getModelDisplayFamily,
	getModelDisplayName,
	groupReasoningModelsFromDisplay,
	groupModelsByProvider,
	groupCodexModelsByBase,
	isDefaultModel,
	supportsReasoningEffortPicker,
} from "./model-selector-logic.js";

interface Props {
	availableModels: readonly Model[];
	currentModelId: ModelId | null;
	/** When present, use backend-precomputed display groups instead of client-side parsing */
	modelsDisplay?: ModelsForDisplay | null;
	agentId: string | null;
	isOpen: boolean;
	onModelChange: (modelId: ModelId) => Promise<void> | void;
}

let {
	availableModels,
	currentModelId,
	modelsDisplay = null,
	agentId,
	isOpen: _,
	onModelChange,
}: Props = $props();

const MODEL_SEARCH_THRESHOLD = 8;

let searchQuery = $state("");

const validModels = $derived(availableModels.filter((model) => model.id));

const hasModelsDisplay = $derived(
	!!modelsDisplay && modelsDisplay.groups && modelsDisplay.groups.length > 0
);

const allDisplayableModels = $derived.by(() => {
	if (!modelsDisplay?.groups) {
		return [];
	}
	return modelsDisplay.groups.flatMap((group) => group.models);
});

const totalModelCount = $derived(
	hasModelsDisplay ? allDisplayableModels.length : validModels.length
);
const showFavorites = $derived(
	hasModelsDisplay ? allDisplayableModels.length >= 5 : validModels.length >= 5
);

const favoritesList = $derived.by(() => {
	if (!agentId || !showFavorites) {
		return [];
	}
	const favoriteIds = preferencesStore.getFavorites(agentId);
	if (hasModelsDisplay) {
		return allDisplayableModels.filter((model) => favoriteIds.includes(model.modelId));
	}
	return validModels.filter((model) => favoriteIds.includes(model.id));
});

const planDefaultId = $derived(
	agentId ? preferencesStore.getDefaultModel(agentId, CanonicalModeId.PLAN) : undefined
);
const buildDefaultId = $derived(
	agentId ? preferencesStore.getDefaultModel(agentId, CanonicalModeId.BUILD) : undefined
);

function getModelId(model: Model | DisplayableModel): string {
	return "displayName" in model ? model.modelId : model.id;
}

function getDisplayName(model: Model | DisplayableModel): string {
	return "displayName" in model
		? model.displayName
		: getModelDisplayName(model, agentId, modelsDisplay);
}

function getModelProviderSource(model: Model | DisplayableModel): string {
	return `${getDisplayName(model)} ${getModelId(model)}`;
}

function matchesSearch(model: Model | DisplayableModel, query: string): boolean {
	const displayName = getDisplayName(model).toLowerCase();
	const modelId = getModelId(model).toLowerCase();
	const description = (model.description ?? "").toLowerCase();
	const providerText = getModelProviderSource(model).toLowerCase();
	return (
		displayName.includes(query) ||
		modelId.includes(query) ||
		description.includes(query) ||
		providerText.includes(query)
	);
}

const filteredGroupedModelsFromDisplay = $derived.by((): DisplayModelGroup[] => {
	if (!hasModelsDisplay || !modelsDisplay?.groups) {
		return [];
	}
	const sortByDisplayName = (left: DisplayableModel, right: DisplayableModel) =>
		left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
	if (!searchQuery.trim()) {
		return modelsDisplay.groups.map((group) => ({
			label: group.label,
			models: Array.from(group.models).sort(sortByDisplayName),
		}));
	}
	const query = searchQuery.toLowerCase().trim();
	return modelsDisplay.groups
		.map((group) => ({
			label: group.label,
			models: group.models.filter((model) => matchesSearch(model, query)).sort(sortByDisplayName),
		}))
		.filter((group) => group.models.length > 0);
});

const filteredModels = $derived.by(() => {
	if (!searchQuery.trim()) {
		return validModels;
	}
	const query = searchQuery.toLowerCase().trim();
	return validModels.filter((model) => matchesSearch(model, query));
});

const filteredGroupedModels = $derived.by(() => {
	if (hasModelsDisplay) {
		return filteredGroupedModelsFromDisplay.map((group) => ({
			provider: group.label,
			models: group.models as (Model | DisplayableModel)[],
		}));
	}

	return groupModelsByProvider(filteredModels).map((group) => ({
		provider: group.provider,
		models: group.models as (Model | DisplayableModel)[],
	}));
});

const showGroups = $derived(
	hasModelsDisplay
		? filteredGroupedModelsFromDisplay.some((group) => group.label) ||
				filteredGroupedModelsFromDisplay.length > 1
		: filteredGroupedModels.length > 1
);

const usesVariantSelector = $derived(supportsReasoningEffortPicker(availableModels, modelsDisplay));
const showSearch = $derived(!usesVariantSelector && totalModelCount > MODEL_SEARCH_THRESHOLD);

const reasoningBaseGroupsFromDisplay = $derived.by(() => {
	return groupReasoningModelsFromDisplay(modelsDisplay);
});

const reasoningBaseGroups = $derived.by(() =>
	hasModelsDisplay && usesVariantSelector
		? reasoningBaseGroupsFromDisplay
		: usesVariantSelector
			? groupCodexModelsByBase(filteredModels)
			: []
);

const selectedReasoningVariant = $derived.by(() =>
	usesVariantSelector ? getCodexCurrentVariant(reasoningBaseGroups, currentModelId) : null
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

function handlePrimarySelect(baseModelId: string): void {
	const baseGroup = reasoningBaseGroups.find((group) => group.baseModelId === baseModelId);
	if (!baseGroup || baseGroup.variants.length === 0) {
		return;
	}

	const currentEffort =
		selectedReasoningVariant && selectedReasoningVariant.baseModelId === baseModelId
			? selectedReasoningVariant.effort
			: null;
	const nextVariant =
		(currentEffort
			? baseGroup.variants.find((variant) => variant.effort === currentEffort)
			: undefined) ??
		baseGroup.variants.find((variant) => variant.effort === "medium") ??
		baseGroup.variants[0];

	if (nextVariant) {
		onModelChange(nextVariant.fullModelId);
	}
}

function handleVariantSelect(modelId: string): void {
	onModelChange(modelId);
}
</script>

{#if availableModels.length === 0}
<div class="px-2 py-1 text-xs">No models available</div>
{:else}
{#if showSearch}
<div class="sticky top-0 z-10 bg-popover px-3 py-1.5">
<Input
bind:value={searchQuery}
placeholder={m.model_selector_search_placeholder()}
class="h-8 text-xs"
/>
</div>
{/if}

{#if usesVariantSelector}
<div
class="overflow-y-auto max-h-[250px] px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
>
{#each reasoningBaseGroups as group (group.baseModelId)}
<ModelSelectorRow
modelId={group.baseModelId}
modelName={group.baseModelName}
currentModelId={selectedReasoningVariant?.baseModelId ?? null}
onSelect={() => handlePrimarySelect(group.baseModelId)}
>
{#snippet leading()}
<ProviderMark provider={`${group.baseModelName} ${group.baseModelId}`} class="size-3.5" />
{/snippet}
</ModelSelectorRow>
{/each}

{#if selectedReasoningBaseGroup}
<DropdownMenu.Separator />
{#each selectedReasoningBaseGroup.variants as variant (variant.fullModelId)}
<ModelSelectorRow
modelId={variant.fullModelId}
modelName={variant.effort}
{currentModelId}
onSelect={() => handleVariantSelect(variant.fullModelId)}
/>
{/each}
{/if}
</div>
{:else}
{#if favoritesList.length > 0 && !searchQuery}
<div class="bg-popover px-0 pb-0.5">
{#each favoritesList as model (getModelId(model))}
{@const modelId = getModelId(model)}
{@const modelName = getDisplayName(model)}
{@const isPlanDefault = isDefaultModel(planDefaultId, modelId)}
{@const isBuildDefault = isDefaultModel(buildDefaultId, modelId)}
{@const showModeBar = isPlanDefault || isBuildDefault}
<ModelSelectorRow
modelId={modelId}
{modelName}
{currentModelId}
onSelect={() => onModelChange(modelId)}
>
{#snippet leading()}
<ProviderMark provider={getModelProviderSource(model)} class="size-3.5" />
{/snippet}
{#snippet actions()}
<div class="ml-auto flex items-center gap-1">
{#if agentId}
<ModelSelectorModeBar
{showModeBar}
{isPlanDefault}
{isBuildDefault}
onSetPlan={() =>
preferencesStore.setDefaultModel(agentId, CanonicalModeId.PLAN, modelId)}
onSetBuild={() =>
preferencesStore.setDefaultModel(agentId, CanonicalModeId.BUILD, modelId)}
/>
{#if showFavorites}
<ModelSelectorFavoriteStar
isFavorite={true}
onToggle={() => {
if (agentId) {
preferencesStore.toggleFavorite(agentId, modelId);
}
}}
/>
{/if}
{/if}
</div>
{/snippet}
</ModelSelectorRow>
{/each}
</div>
{/if}

<div
class="overflow-y-auto max-h-[250px] px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
>
{#each filteredGroupedModels as group, groupIndex (group.provider)}
{#if showGroups}
<DropdownMenu.Label class="flex items-center gap-1.5 px-1.5 py-1 text-[10px] font-semibold">
<ProviderMark provider={group.provider} class="size-3" />
{group.provider}
</DropdownMenu.Label>
{/if}
{#each group.models as model (getModelId(model))}
{@const modelId = getModelId(model)}
{@const modelName = getDisplayName(model)}
{@const isFavorite = agentId ? preferencesStore.isFavorite(agentId, modelId) : false}
{@const isPlanDefault = isDefaultModel(planDefaultId, modelId)}
{@const isBuildDefault = isDefaultModel(buildDefaultId, modelId)}
{@const showModeBar = isPlanDefault || isBuildDefault}
<ModelSelectorRow
modelId={modelId}
{modelName}
{currentModelId}
onSelect={() => onModelChange(modelId)}
>
{#snippet leading()}
<ProviderMark provider={getModelProviderSource(model)} class="size-3.5" />
{/snippet}
{#snippet actions()}
<div class="ml-auto flex items-center gap-1">
{#if agentId}
<ModelSelectorModeBar
{showModeBar}
{isPlanDefault}
{isBuildDefault}
onSetPlan={() =>
preferencesStore.setDefaultModel(agentId, CanonicalModeId.PLAN, modelId)}
onSetBuild={() =>
preferencesStore.setDefaultModel(agentId, CanonicalModeId.BUILD, modelId)}
/>
{#if showFavorites}
<ModelSelectorFavoriteStar
isFavorite={isFavorite}
onToggle={() => {
if (agentId) {
preferencesStore.toggleFavorite(agentId, modelId);
}
}}
/>
{/if}
{/if}
</div>
{/snippet}
</ModelSelectorRow>
{/each}
{#if showGroups && groupIndex < filteredGroupedModels.length - 1}
<DropdownMenu.Separator />
{/if}
{/each}
</div>
{/if}
{/if}
