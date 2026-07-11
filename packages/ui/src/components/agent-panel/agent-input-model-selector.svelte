<script lang="ts">
import type { ProviderBrand } from "../provider-mark/index.js";
import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";

import AgentInputReasoningModelSelector from "./agent-input-reasoning-model-selector.svelte";
import AgentInputStandardModelSelector from "./agent-input-standard-model-selector.svelte";
import {
	countSelectableModels,
	filterModelGroups,
	findSelectedReasoningGroup,
	resolveActiveModelProviderId,
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
	triggerUpstreamProviderBrand?: import("../../lib/upstream-provider-brand.js").UpstreamProviderBrand | null;
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
	embeddedInGroup?: boolean;
	primaryTriggerProviderBrand?: ProviderBrand | null;
	primaryTriggerProviderLabel?: string;
	preferredProviderId?: string | null;
	onProviderChange?: (providerId: string) => void;
}

let {
	triggerLabel,
	triggerProviderBrand = null,
	triggerProviderLabel,
	triggerUpstreamProviderBrand = null,
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
	embeddedInGroup = false,
	primaryTriggerProviderBrand = triggerProviderBrand,
	primaryTriggerProviderLabel = triggerProviderLabel,
	preferredProviderId = null,
	onProviderChange,
}: Props = $props();

let isOpen = $state(false);
let isPrimarySelectorOpen = $state(false);
let isVariantSelectorOpen = $state(false);
let searchQuery = $state("");
let requestedProviderId = $state<string | null>(null);

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

const activeProviderId = $derived(resolveActiveModelProviderId({
	modelGroups,
	requestedProviderId,
	rememberedProviderId: preferredProviderId,
	currentModelId,
}));
const providerScopedGroups = $derived(
	activeProviderId ? modelGroups.filter((group) => group.providerId === activeProviderId) : modelGroups
);
const providerScopedFavorites = $derived(
	activeProviderId
		? favoriteModels.filter((item) =>
			providerScopedGroups.some((group) => group.items.some((candidate) => candidate.id === item.id))
		)
		: favoriteModels
);
const filteredGroups = $derived(filterModelGroups({ modelGroups: providerScopedGroups, searchQuery }));
const showGroups = $derived(shouldShowModelGroups(filteredGroups));

function selectProvider(providerId: string): void {
	requestedProviderId = providerId;
	searchQuery = "";
	onProviderChange?.(providerId);
}
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
		{triggerUpstreamProviderBrand}
		{currentModelId}
		{totalModelCount}
		{filteredGroups}
		favoriteModels={providerScopedFavorites}
		providerGroups={modelGroups.filter((group) => group.providerId && group.items.length > 0)}
		{activeProviderId}
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
		{embeddedInGroup}
		onOpenChange={setStandardOpen}
		onSearchChange={setSearchQuery}
		onProviderChange={selectProvider}
		onSelect={selectModel}
		{onToggleFavorite}
	/>
{/if}
