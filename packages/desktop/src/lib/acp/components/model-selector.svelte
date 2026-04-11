<script lang="ts">
import {
	AgentInputModelSelector as SharedAgentInputModelSelector,
	type AgentInputModelSelectorGroup,
	type AgentInputModelSelectorItem,
	type AgentInputModelSelectorReasoningGroup,
} from "@acepe/ui";
import { ResultAsync } from "neverthrow";
import { onDestroy, onMount } from "svelte";
import * as m from "$lib/paraglide/messages.js";

import type {
	DisplayableModel,
	ModelsForDisplay,
} from "../../services/acp-types.js";
import type { Model } from "../application/dto/model.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { getSelectorRegistry } from "../logic/selector-registry.svelte.js";
import * as preferencesStore from "../store/agent-model-preferences-store.svelte.js";
import { getPanelStore, getSessionStore } from "../store/index.js";
import { CanonicalModeId } from "../types/canonical-mode-id.js";
import type { ModelId } from "../types/model-id.js";
import { createLogger } from "../utils/logger.js";
import {
	getCodexCurrentVariant,
	getModelDisplayName,
	groupModelsByProvider,
	groupReasoningModelsFromDisplay,
	groupCodexModelsByBase,
	isDefaultModel,
	supportsReasoningEffortPicker,
} from "./model-selector-logic.js";

interface ModelSelectorProps {
	availableModels: readonly Model[];
	currentModelId: ModelId | null;
	/** When present, use backend-precomputed display groups instead of client-side parsing */
	modelsDisplay?: ModelsForDisplay | null;
	onModelChange: (modelId: ModelId) => Promise<void>;
	isLoading?: boolean;
	panelId?: string;
	ontoggle?: (isOpen: boolean) => void;
}

let {
	availableModels,
	currentModelId,
	modelsDisplay = null,
	onModelChange,
	isLoading = false,
	panelId,
	ontoggle,
}: ModelSelectorProps = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const registry = getSelectorRegistry();
const logger = createLogger({
	id: LOGGER_IDS.MODEL_SELECTOR,
	name: "Model Selector",
});

let sharedSelectorRef: { toggle: () => void } | null = $state(null);
let unregister: (() => void) | null = null;

onMount(() => {
	if (registry && panelId) {
		unregister = registry.register("model", panelId, { toggle });
	}
});

onDestroy(() => {
	unregister?.();
});

const agentId = $derived.by(() => {
	if (panelId) {
		const panel = panelStore.panels.find((candidatePanel) => candidatePanel.id === panelId);
		if (panel?.sessionId) {
			const session = sessionStore.getSessionCold(panel.sessionId);
			return session?.agentId ?? panel.selectedAgentId;
		}
		return panel?.selectedAgentId;
	}
	return null;
});

const selectedModel = $derived(
	currentModelId && availableModels.length > 0
		? (availableModels.find((model) => model.id === currentModelId) ?? null)
		: null
);

const displayName = $derived.by(() => {
	if (!currentModelId) return "Model";

	if (modelsDisplay?.groups) {
		for (const group of modelsDisplay.groups) {
			const match = group.models.find((model) => model.modelId === currentModelId);
			if (match) {
				return match.displayName;
			}
		}
	}

	if (!selectedModel) {
		return "Model";
	}

	return getModelDisplayName(selectedModel, agentId ?? null, modelsDisplay);
});

const triggerProviderMarkSource = $derived.by(() => {
	if (!currentModelId) {
		return agentId ?? "other";
	}

	return `${displayName} ${currentModelId}`;
});

const usesVariantSelector = $derived(
	supportsReasoningEffortPicker(availableModels, modelsDisplay)
);
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
const primarySelectorLabel = $derived(selectedReasoningBaseGroup?.baseModelName ?? "Model");

const validModels = $derived(availableModels.filter((model) => model.id));
const allDisplayableModels = $derived.by(() => {
	if (!modelsDisplay?.groups) {
		return [] as DisplayableModel[];
	}
	return modelsDisplay.groups.flatMap((group) => group.models);
});
const totalModelCount = $derived.by(() =>
	modelsDisplay?.groups ? allDisplayableModels.length : validModels.length
);
const showFavorites = $derived(totalModelCount >= 5);
const planDefaultId = $derived(
	agentId ? preferencesStore.getDefaultModel(agentId, CanonicalModeId.PLAN) : undefined
);
const buildDefaultId = $derived(
	agentId ? preferencesStore.getDefaultModel(agentId, CanonicalModeId.BUILD) : undefined
);

function getPreferredVariantId(baseModelId: string): string | null {
	const baseGroup = reasoningBaseGroups.find((group) => group.baseModelId === baseModelId);
	if (!baseGroup) {
		return null;
	}
	const matchingCurrent =
		selectedReasoningVariant && selectedReasoningVariant.baseModelId === baseModelId
			? baseGroup.variants.find(
					(variant) => variant.fullModelId === selectedReasoningVariant.fullModelId
				)
			: undefined;
	return (
		matchingCurrent?.fullModelId ??
		baseGroup.variants.find((variant) => variant.effort === "medium")?.fullModelId ??
		baseGroup.variants[0]?.fullModelId ??
		null
	);
}

function isDefaultForBase(defaultModelId: string | undefined, baseModelId: string): boolean {
	if (!defaultModelId) {
		return false;
	}
	return defaultModelId.startsWith(`${baseModelId}/`);
}

function getModelId(model: Model | DisplayableModel): string {
	return "displayName" in model ? model.modelId : model.id;
}

function getDisplayLabel(model: Model | DisplayableModel): string {
	return "displayName" in model
		? model.displayName
		: getModelDisplayName(model, agentId ?? null, modelsDisplay);
}

function getModelProviderSource(model: Model | DisplayableModel): string {
	return `${getDisplayLabel(model)} ${getModelId(model)}`;
}

function toSelectorItem(model: Model | DisplayableModel): AgentInputModelSelectorItem {
	const id = getModelId(model);
	const name = getDisplayLabel(model);
	return {
		id,
		name,
		providerSource: getModelProviderSource(model),
		description: model.description ?? undefined,
		searchText: `${name} ${id} ${model.description ?? ""} ${getModelProviderSource(model)}`,
		isFavorite: agentId ? preferencesStore.isFavorite(agentId, id) : false,
		isPlanDefault: isDefaultModel(planDefaultId, id),
		isBuildDefault: isDefaultModel(buildDefaultId, id),
	};
}

const favoriteModels = $derived.by(() => {
	if (!agentId || !showFavorites) {
		return [] as AgentInputModelSelectorItem[];
	}
	const favoriteIds = preferencesStore.getFavorites(agentId);
	if (modelsDisplay?.groups) {
		return allDisplayableModels
			.filter((model) => favoriteIds.includes(model.modelId))
			.map(toSelectorItem);
	}
	return validModels.filter((model) => favoriteIds.includes(model.id)).map(toSelectorItem);
});

const modelGroups = $derived.by<AgentInputModelSelectorGroup[]>(() => {
	if (modelsDisplay?.groups) {
		return modelsDisplay.groups.map((group) => ({
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
	reasoningBaseGroups.map((group) => ({
		baseModelId: group.baseModelId,
		baseModelName: group.baseModelName,
		providerSource: `${group.baseModelName} ${group.baseModelId}`,
		preferredVariantId: getPreferredVariantId(group.baseModelId),
		isPlanDefault: isDefaultForBase(planDefaultId, group.baseModelId),
		isBuildDefault: isDefaultForBase(buildDefaultId, group.baseModelId),
		variants: group.variants.map((variant) => ({
			id: variant.fullModelId,
			name: variant.effort,
		})),
	}))
);

export function toggle(): void {
	sharedSelectorRef?.toggle();
}

async function handleSharedModelChange(modelId: string): Promise<void> {
	logger.debug("handleModelChange() called", {
		modelId,
		currentModelId,
		isDifferent: modelId !== currentModelId,
	});

	if (modelId !== currentModelId) {
		logger.info("Changing model", { from: currentModelId, to: modelId });

		const result = await ResultAsync.fromPromise(
			onModelChange(modelId),
			(error) => error as Error
		)
			.map(() => {
				logger.info("Model change completed", { modelId });
				return undefined;
			})
			.mapErr((error) => {
				logger.error("Model change failed", {
					modelId,
					error: error instanceof Error ? error.message : String(error),
				});
				return error;
			});

		if (result.isErr()) {
			throw result.error;
		}
	}
}
</script>

<SharedAgentInputModelSelector
	bind:this={sharedSelectorRef}
	triggerLabel={displayName}
	triggerProviderSource={triggerProviderMarkSource}
	currentModelId={currentModelId}
	{isLoading}
	{ontoggle}
	{modelGroups}
	{favoriteModels}
	reasoningGroups={usesVariantSelector ? reasoningGroups : []}
	selectedReasoningBaseId={selectedReasoningVariant?.baseModelId ?? null}
	selectedReasoningVariantId={currentModelId}
	primarySelectorLabel={primarySelectorLabel}
	primaryTriggerProviderSource={`${primarySelectorLabel} ${selectedReasoningBaseGroup?.baseModelId ?? currentModelId ?? ""}`}
	searchPlaceholder={m.model_selector_search_placeholder()}
	loadingLabel="Loading models..."
	noModelsLabel="No models available"
	noReasoningLevelsLabel="No reasoning levels available"
	reasoningEffortTooltipLabel={m.model_selector_reasoning_effort_tooltip()}
	planLabel={m.plan_heading()}
	buildLabel={m.plan_sidebar_build()}
	onModelChange={handleSharedModelChange}
	onSetPlanDefault={agentId
		? (modelId) => preferencesStore.setDefaultModel(agentId, CanonicalModeId.PLAN, modelId)
		: undefined}
	onSetBuildDefault={agentId
		? (modelId) => preferencesStore.setDefaultModel(agentId, CanonicalModeId.BUILD, modelId)
		: undefined}
	onToggleFavorite={agentId
		? (modelId) => preferencesStore.toggleFavorite(agentId, modelId)
		: undefined}
/>
