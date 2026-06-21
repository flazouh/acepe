<script lang="ts">
import type { ProviderBrand } from "../provider-mark/index.js";
import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";

import AgentInputReasoningModelSelector from "./agent-input-reasoning-model-selector.svelte";
import AgentInputStandardModelSelector from "./agent-input-standard-model-selector.svelte";
import {
	countSelectableModels,
	filterModelGroups,
	findSelectedReasoningGroup,
	shouldShowModelGroups,
	shouldShowModelSearch,
} from "./agent-input-model-selector-state.js";

import type {
	AgentInputModelSelectorGroup,
	AgentInputModelSelectorItem,
	AgentInputModelSelectorReasoningGroup,
	AgentInputModelSelectorVariant,
} from "./agent-input-model-selector-types.js";

export type {
	AgentInputModelSelectorGroup,
	AgentInputModelSelectorItem,
	AgentInputModelSelectorReasoningGroup,
	AgentInputModelSelectorVariant,
};

interface Props {
	triggerLabel: string;
	triggerProviderBrand?: ProviderBrand | null;
	triggerProviderLabel?: string;
	currentModelId: string | null;
	modelGroups: readonly AgentInputModelSelectorGroup[];
	favoriteModels?: readonly AgentInputModelSelectorItem[];
	reasoningGroups?: readonly AgentInputModelSelectorReasoningGroup[];
	selectedReasoningBaseId?: string | null;
	selectedReasoningVariantId?: string | null;
	primarySelectorLabel?: string;
	isLoading?: boolean;
	searchPlaceholder?: string;
	loadingLabel?: string;
	noModelsLabel?: string;
	noReasoningLevelsLabel?: string;
	reasoningEffortTooltipLabel?: string;
	ontoggle?: (isOpen: boolean) => void;
	onModelChange: (modelId: string) => void | Promise<void>;
	onToggleFavorite?: (modelId: string) => void;
	hideTriggerProviderMark?: boolean;
	triggerSize?: SelectorTriggerSize;
	primaryTriggerProviderBrand?: ProviderBrand | null;
	primaryTriggerProviderLabel?: string;
}

let {
	triggerLabel,
	triggerProviderBrand = null,
	triggerProviderLabel,
	currentModelId,
	modelGroups,
	favoriteModels = [],
	reasoningGroups = [],
	selectedReasoningBaseId = null,
	selectedReasoningVariantId = null,
	primarySelectorLabel = "Model",
	isLoading = false,
	searchPlaceholder = "Search models",
	loadingLabel = "Loading models...",
	noModelsLabel = "No models available",
	noReasoningLevelsLabel = "No reasoning levels available",
	reasoningEffortTooltipLabel = "Reasoning effort",
	ontoggle,
	onModelChange,
	onToggleFavorite,
	hideTriggerProviderMark = false,
	triggerSize = "pill",
	primaryTriggerProviderBrand = triggerProviderBrand,
	primaryTriggerProviderLabel = triggerProviderLabel,
}: Props = $props();

let isOpen = $state(false);
let isPrimarySelectorOpen = $state(false);
let isVariantSelectorOpen = $state(false);
let searchQuery = $state("");

const usesVariantSelector = $derived(reasoningGroups.length > 0);
const totalModelCount = $derived(
	countSelectableModels({
		usesVariantSelector,
		modelGroups,
		reasoningGroups,
	})
);
const showFavorites = $derived(favoriteModels.length > 0);
const showSearch = $derived(
	shouldShowModelSearch({
		usesVariantSelector,
		totalModelCount,
	})
);
const selectedReasoningGroup = $derived(
	findSelectedReasoningGroup({
		reasoningGroups,
		selectedReasoningBaseId,
	})
);

function toggleSplitSelector(): void {
	const nextPrimaryOpen = !isPrimarySelectorOpen;
	isPrimarySelectorOpen = nextPrimaryOpen;
	isVariantSelectorOpen = false;
	ontoggle?.(nextPrimaryOpen);
}

function closeSelectors(): void {
	isOpen = false;
	isPrimarySelectorOpen = false;
	isVariantSelectorOpen = false;
	ontoggle?.(false);
}

export function toggle(): void {
	if (usesVariantSelector) {
		toggleSplitSelector();
		return;
	}

	const nextOpen = !isOpen;
	isOpen = nextOpen;
	ontoggle?.(nextOpen);
}

function setPrimaryOpen(open: boolean): void {
	isPrimarySelectorOpen = open;
	if (open) {
		isVariantSelectorOpen = false;
	}
	ontoggle?.(open);
}

function setVariantOpen(open: boolean): void {
	isVariantSelectorOpen = open;
	if (open) {
		isPrimarySelectorOpen = false;
	}
	ontoggle?.(open);
}

function setStandardOpen(open: boolean): void {
	isOpen = open;
	ontoggle?.(open);
}

function setSearchQuery(query: string): void {
	searchQuery = query;
}

async function handleModelSelection(modelId: string): Promise<void> {
	if (modelId !== currentModelId) {
		await onModelChange(modelId);
	}
	closeSelectors();
}

function selectModel(modelId: string): void {
	void handleModelSelection(modelId);
}

const filteredGroups = $derived(filterModelGroups({ modelGroups, searchQuery }));
const showGroups = $derived(shouldShowModelGroups(filteredGroups));
</script>

{#if usesVariantSelector}
	<AgentInputReasoningModelSelector
		{reasoningGroups}
		{selectedReasoningBaseId}
		{selectedReasoningVariantId}
		{selectedReasoningGroup}
		{primarySelectorLabel}
		{isLoading}
		{loadingLabel}
		{noReasoningLevelsLabel}
		{reasoningEffortTooltipLabel}
		{hideTriggerProviderMark}
		{primaryTriggerProviderBrand}
		{primaryTriggerProviderLabel}
		primaryOpen={isPrimarySelectorOpen}
		variantOpen={isVariantSelectorOpen}
		onPrimaryOpenChange={setPrimaryOpen}
		onVariantOpenChange={setVariantOpen}
		onSelect={selectModel}
	/>
{:else}
	<AgentInputStandardModelSelector
		open={isOpen}
		{triggerLabel}
		{triggerProviderBrand}
		{triggerProviderLabel}
		{currentModelId}
		{totalModelCount}
		{filteredGroups}
		{favoriteModels}
		{searchQuery}
		{showSearch}
		{showGroups}
		{showFavorites}
		{isLoading}
		{searchPlaceholder}
		{loadingLabel}
		{noModelsLabel}
		{hideTriggerProviderMark}
		{triggerSize}
		onOpenChange={setStandardOpen}
		onSearchChange={setSearchQuery}
		onSelect={selectModel}
		{onToggleFavorite}
	/>
{/if}
