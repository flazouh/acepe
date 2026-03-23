<script lang="ts">
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
import { AGENT_IDS } from "../types/agent-id.js";
import { CanonicalModeId } from "../types/canonical-mode-id.js";
import type { ModelId } from "../types/model-id.js";
import ModelSelectorFavoriteStar from "./model-selector.favorite-star.svelte";
import ModelSelectorModeBar from "./model-selector.mode-bar.svelte";
import ModelSelectorRow from "./model-selector.row.svelte";
import {
	getCodexCurrentVariant,
	getModelDisplayName,
	getProviderFromModelId,
	groupCodexModelsByBase,
	groupModelsByProvider,
	isDefaultModel,
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
	isOpen,
	onModelChange,
}: Props = $props();

/** Show search bar when model count exceeds this (reduces clutter for small lists). */
const MODEL_SEARCH_THRESHOLD = 8;

let searchQuery = $state("");

$effect(() => {
	if (!isOpen) {
		searchQuery = "";
	}
});

const validModels = $derived(availableModels.filter((m) => m.id));

const hasModelsDisplay = $derived(
	!!modelsDisplay && modelsDisplay.groups && modelsDisplay.groups.length > 0
);

const allDisplayableModels = $derived.by(() => {
	if (!modelsDisplay?.groups) return [];
	return modelsDisplay.groups.flatMap((g) => g.models);
});

const totalModelCount = $derived(
	hasModelsDisplay ? allDisplayableModels.length : validModels.length
);

const showFavorites = $derived(
	hasModelsDisplay ? allDisplayableModels.length >= 5 : validModels.length >= 5
);

const favoritesList = $derived.by(() => {
	if (!agentId || !showFavorites) return [];
	const favoriteIds = preferencesStore.getFavorites(agentId);
	if (hasModelsDisplay) {
		return allDisplayableModels.filter((m) => favoriteIds.includes(m.modelId));
	}
	return validModels.filter((m) => favoriteIds.includes(m.id));
});

const planDefaultId = $derived(
	agentId ? preferencesStore.getDefaultModel(agentId, CanonicalModeId.PLAN) : undefined
);
const buildDefaultId = $derived(
	agentId ? preferencesStore.getDefaultModel(agentId, CanonicalModeId.BUILD) : undefined
);

/**
 * Gets the model identifier from either a Model (id) or DisplayableModel (modelId).
 */
function getModelId(model: Model | DisplayableModel): string {
	return "displayName" in model ? model.modelId : model.id;
}

function getDisplayName(model: Model | DisplayableModel): string {
	return "displayName" in model ? model.displayName : getModelDisplayName(model, agentId);
}

function matchesSearch(model: Model | DisplayableModel, query: string): boolean {
	const d = "displayName" in model ? model.displayName : getModelDisplayName(model, agentId);
	const mid = getModelId(model).toLowerCase();
	const desc = (model.description ?? "").toLowerCase();
	const prov = "displayName" in model ? "" : getProviderFromModelId(model.id).toLowerCase();
	return (
		d.toLowerCase().includes(query) ||
		mid.includes(query) ||
		desc.includes(query) ||
		prov.includes(query)
	);
}

const filteredGroupedModelsFromDisplay = $derived.by((): DisplayModelGroup[] => {
	if (!hasModelsDisplay || !modelsDisplay?.groups) return [];
	const sortByDisplayName = (a: DisplayableModel, b: DisplayableModel) =>
		a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
	if (!searchQuery.trim()) {
		return modelsDisplay.groups.map((g) => ({
			label: g.label,
			models: [...g.models].sort(sortByDisplayName),
		}));
	}
	const query = searchQuery.toLowerCase().trim();
	return modelsDisplay.groups
		.map((g) => ({
			label: g.label,
			models: g.models.filter((m) => matchesSearch(m, query)).sort(sortByDisplayName),
		}))
		.filter((g) => g.models.length > 0);
});

const filteredModels = $derived.by(() => {
	if (!searchQuery.trim()) return validModels;
	const query = searchQuery.toLowerCase().trim();
	return validModels.filter((model) => matchesSearch(model, query));
});

const filteredGroupedModels = $derived(
	hasModelsDisplay
		? filteredGroupedModelsFromDisplay.map((g) => ({
				provider: g.label,
				models: g.models as (Model | DisplayableModel)[],
			}))
		: groupModelsByProvider(filteredModels).map((g) => ({
				provider: g.provider,
				models: g.models as (Model | DisplayableModel)[],
			}))
);
const showGroups = $derived(
	hasModelsDisplay
		? filteredGroupedModelsFromDisplay.some((g) => g.label) ||
				filteredGroupedModelsFromDisplay.length > 1
		: filteredGroupedModels.length > 1 && filteredModels.length >= 5
);

const isCodexAgent = $derived(agentId === AGENT_IDS.CODEX);
const showSearch = $derived(!isCodexAgent && totalModelCount > MODEL_SEARCH_THRESHOLD);

const codexBaseGroupsFromDisplay = $derived.by(() => {
	if (!hasModelsDisplay || !isCodexAgent || !modelsDisplay?.groups) return [];
	return modelsDisplay.groups.map((g) => {
		const firstModelId = g.models[0]?.modelId ?? "";
		const baseModelId = firstModelId.includes("/")
			? firstModelId.slice(0, firstModelId.lastIndexOf("/"))
			: firstModelId;
		return {
			baseModelId,
			baseModelName: g.label,
			variants: g.models.map((m) => {
				const slashIdx = m.modelId.lastIndexOf("/");
				const effort = (
					slashIdx > 0 && slashIdx < m.modelId.length - 1 ? m.modelId.slice(slashIdx + 1) : "medium"
				) as "low" | "medium" | "high" | "xhigh";
				return {
					fullModelId: m.modelId,
					baseModelId: slashIdx > 0 ? m.modelId.slice(0, slashIdx) : m.modelId,
					effort,
					name: m.displayName,
					description: m.description ?? undefined,
				};
			}),
		};
	});
});

const codexBaseGroups = $derived.by(() =>
	hasModelsDisplay && isCodexAgent
		? codexBaseGroupsFromDisplay
		: isCodexAgent
			? groupCodexModelsByBase(filteredModels)
			: []
);

const selectedCodexVariant = $derived.by(() =>
	isCodexAgent ? getCodexCurrentVariant(codexBaseGroups, currentModelId) : null
);
const selectedCodexBaseGroup = $derived.by(() => {
	if (!isCodexAgent || codexBaseGroups.length === 0) {
		return null;
	}

	if (!selectedCodexVariant) {
		return codexBaseGroups[0] ?? null;
	}

	return (
		codexBaseGroups.find((group) => group.baseModelId === selectedCodexVariant.baseModelId) ??
		codexBaseGroups[0] ??
		null
	);
});

function handleCodexBaseSelect(baseModelId: string): void {
	const baseGroup = codexBaseGroups.find((group) => group.baseModelId === baseModelId);
	if (!baseGroup || baseGroup.variants.length === 0) {
		return;
	}

	const currentEffort =
		selectedCodexVariant && selectedCodexVariant.baseModelId === baseModelId
			? selectedCodexVariant.effort
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

function handleCodexEffortSelect(modelId: string): void {
	onModelChange(modelId);
}
</script>

{#if availableModels.length === 0}
	<div class="px-2 py-1 text-xs">No models available</div>
{:else}
	<div class="sticky top-0 z-10 bg-popover px-3 py-1.5">
		{#if showSearch}
			<Input
				bind:value={searchQuery}
				placeholder={m.model_selector_search_placeholder()}
				class="h-8 text-xs"
			/>
		{/if}
	</div>

	{#if isCodexAgent}
		<div
			class="overflow-y-auto max-h-[250px] px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
		>
			{#each codexBaseGroups as group (group.baseModelId)}
				<ModelSelectorRow
					modelId={group.baseModelId}
					modelName={group.baseModelName}
					currentModelId={selectedCodexVariant?.baseModelId ?? null}
					onSelect={() => handleCodexBaseSelect(group.baseModelId)}
				/>
			{/each}

			{#if selectedCodexBaseGroup}
				<DropdownMenu.Separator />
				{#each selectedCodexBaseGroup.variants as variant (variant.fullModelId)}
					<ModelSelectorRow
						modelId={variant.fullModelId}
						modelName={variant.effort}
						{currentModelId}
						onSelect={() => handleCodexEffortSelect(variant.fullModelId)}
					/>
				{/each}
			{/if}
		</div>
	{:else}
		{#if favoritesList.length > 0 && !searchQuery}
			<div class="bg-popover px-0 pb-0.5">
				{#each favoritesList as model (getModelId(model))}
					{@const mid = getModelId(model)}
					{@const modelName = getDisplayName(model)}
					{@const isPlanDefault = isDefaultModel(planDefaultId, mid)}
					{@const isBuildDefault = isDefaultModel(buildDefaultId, mid)}
					{@const showModeBar = isPlanDefault || isBuildDefault}
					<ModelSelectorRow
						modelId={mid}
						{modelName}
						{currentModelId}
						onSelect={() => onModelChange(mid)}
					>
						{#snippet actions()}
							<div class="ml-auto flex items-center gap-1">
								{#if agentId}
									<ModelSelectorModeBar
										{showModeBar}
										{isPlanDefault}
										{isBuildDefault}
										onSetPlan={() =>
											preferencesStore.setDefaultModel(agentId, CanonicalModeId.PLAN, mid)}
										onSetBuild={() =>
											preferencesStore.setDefaultModel(agentId, CanonicalModeId.BUILD, mid)}
									/>
									{#if showFavorites}
										<ModelSelectorFavoriteStar
											isFavorite={true}
											onToggle={() => {
												if (agentId) {
													preferencesStore.toggleFavorite(agentId, mid);
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
			{#each filteredGroupedModels as group, i (group.provider)}
				{#if showGroups}
					<DropdownMenu.Label class="px-1.5 py-1 text-[10px] font-semibold ">
						{group.provider}
					</DropdownMenu.Label>
				{/if}
				{#each group.models as model (getModelId(model))}
					{@const mid = getModelId(model)}
					{@const modelName = getDisplayName(model)}
					{@const isFav = agentId ? preferencesStore.isFavorite(agentId, mid) : false}
					{@const isPlanDefault = isDefaultModel(planDefaultId, mid)}
					{@const isBuildDefault = isDefaultModel(buildDefaultId, mid)}
					{@const showModeBar = isPlanDefault || isBuildDefault}
					<ModelSelectorRow
						modelId={mid}
						{modelName}
						{currentModelId}
						onSelect={() => onModelChange(mid)}
					>
						{#snippet actions()}
							<div class="ml-auto flex items-center gap-1">
								{#if agentId}
									<ModelSelectorModeBar
										{showModeBar}
										{isPlanDefault}
										{isBuildDefault}
										onSetPlan={() =>
											preferencesStore.setDefaultModel(agentId, CanonicalModeId.PLAN, mid)}
										onSetBuild={() =>
											preferencesStore.setDefaultModel(agentId, CanonicalModeId.BUILD, mid)}
									/>
									{#if showFavorites}
										<ModelSelectorFavoriteStar
											isFavorite={isFav}
											onToggle={() => {
												if (agentId) {
													preferencesStore.toggleFavorite(agentId, mid);
												}
											}}
										/>
									{/if}
								{/if}
							</div>
						{/snippet}
					</ModelSelectorRow>
				{/each}
				{#if showGroups && i < filteredGroupedModels.length - 1}
					<DropdownMenu.Separator />
				{/if}
			{/each}
		</div>
	{/if}
{/if}
