<script lang="ts">
import {
	AgentInputModelSelector as SharedAgentInputModelSelector,
	type AgentInputModelSelectorGroup,
	type AgentInputModelSelectorItem,
	type AgentInputModelSelectorReasoningGroup,
	type ProviderBrand,
} from "@acepe/ui";
import { ResultAsync } from "neverthrow";
import { onDestroy, onMount } from "svelte";
import type { DisplayableModel, ModelsForDisplay } from "../../services/acp-types.js";
import type { ProviderMetadataProjection } from "../../services/acp-provider-metadata.js";
import type { Model } from "../application/dto/model.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { getSelectorRegistry } from "../logic/selector-registry.svelte.js";
import * as preferencesStore from "../store/agent-model-preferences-store.svelte.js";
import { getPanelStore, getSessionStore } from "../store/index.js";
import type { ModelId } from "../types/model-id.js";
import { createLogger } from "../utils/logger.js";
import {
	getCurrentReasoningVariant,
	groupModelsForFallback,
	groupReasoningModelsFromDisplay,
	hasUsableModelsDisplayGroups,
	isDefaultChoiceModelId,
	supportsReasoningEffortPicker,
} from "./model-selector-logic.js";
import {
	getModelSelectorDisplayName,
	getModelSelectorItemId,
	getModelSelectorItemLabel,
	getModelSelectorSearchText,
	getPreferredReasoningVariantId,
	getSelectedModel,
	getSelectedReasoningBaseGroup,
} from "./model-selector-state.js";

interface ModelSelectorProps {
	availableModels: readonly Model[];
	currentModelId: ModelId | null;
	/** When present, use backend-precomputed display groups instead of client-side parsing */
	modelsDisplay?: ModelsForDisplay | null;
	providerMetadata?: ProviderMetadataProjection | null;
	onModelChange: (modelId: ModelId) => Promise<void>;
	isLoading?: boolean;
	panelId?: string;
	ontoggle?: (isOpen: boolean) => void;
}

let {
	availableModels,
	currentModelId,
	modelsDisplay = null,
	providerMetadata = null,
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
		const panel = panelStore.getTopLevelAgentPanel(panelId);
		if (panel?.sessionId) {
			const identity = sessionStore.getSessionIdentity(panel.sessionId);
			return identity?.agentId ?? null;
		}
		return panel?.selectedAgentId;
	}
	return null;
});

const selectedModel = $derived(getSelectedModel({ currentModelId, availableModels }));
const displayName = $derived(
	getModelSelectorDisplayName({
		currentModelId,
		modelsDisplay,
		selectedModel,
		agentId: agentId ?? null,
	})
);

const providerBrand = $derived<ProviderBrand | null>(providerMetadata?.providerBrand ?? null);
const providerLabel = $derived(providerMetadata?.displayName);

const usesVariantSelector = $derived(supportsReasoningEffortPicker(availableModels, modelsDisplay));
const reasoningBaseGroupsFromDisplay = $derived.by(() =>
	groupReasoningModelsFromDisplay(modelsDisplay)
);
const reasoningBaseGroups = $derived.by(() =>
	usesVariantSelector ? reasoningBaseGroupsFromDisplay : []
);
const selectedReasoningVariant = $derived.by(() =>
	usesVariantSelector ? getCurrentReasoningVariant(reasoningBaseGroups, currentModelId) : null
);
const selectedReasoningBaseGroup = $derived(
	getSelectedReasoningBaseGroup({
		usesVariantSelector,
		reasoningBaseGroups,
		selectedReasoningVariant,
		currentModelId,
	})
);
const primarySelectorLabel = $derived(selectedReasoningBaseGroup?.baseModelName ?? "Model");

const validModels = $derived(availableModels.filter((model) => model.id));
const displayGroups = $derived.by(() => modelsDisplay?.groups ?? []);
const hasDisplayGroups = $derived(hasUsableModelsDisplayGroups(modelsDisplay));
const allDisplayableModels = $derived.by(() => {
	if (!hasDisplayGroups) {
		return [] as DisplayableModel[];
	}
	return displayGroups.flatMap((group) => group.models);
});
const totalModelCount = $derived.by(() =>
	hasDisplayGroups ? allDisplayableModels.length : validModels.length
);
const showFavorites = $derived(totalModelCount >= 5);

function toSelectorItem(model: Model | DisplayableModel): AgentInputModelSelectorItem {
	const id = getModelSelectorItemId(model);
	const name = getModelSelectorItemLabel({
		model,
		agentId: agentId ?? null,
		modelsDisplay,
	});
	return {
		id,
		name,
		providerBrand,
		providerLabel,
		description: model.description ?? undefined,
		searchText: getModelSelectorSearchText({
			name,
			id,
			description: model.description,
			providerLabel,
		}),
		hideProviderMark: isDefaultChoiceModelId(id),
		isFavorite: agentId ? preferencesStore.isFavorite(agentId, id) : false,
	};
}

const favoriteModels = $derived.by(() => {
	if (!agentId || !showFavorites) {
		return [] as AgentInputModelSelectorItem[];
	}
	const favoriteIds = preferencesStore.getFavorites(agentId);
	if (hasDisplayGroups) {
		return allDisplayableModels
			.filter((model) => favoriteIds.includes(model.modelId))
			.map(toSelectorItem);
	}
	return validModels.filter((model) => favoriteIds.includes(model.id)).map(toSelectorItem);
});

const modelGroups = $derived.by<AgentInputModelSelectorGroup[]>(() => {
	if (hasDisplayGroups) {
		return displayGroups.map((group) => ({
			label: group.label,
			providerBrand,
			providerLabel,
			items: Array.from(group.models)
				.sort((left, right) =>
					left.displayName.localeCompare(right.displayName, undefined, {
						sensitivity: "base",
					})
				)
				.map(toSelectorItem),
		}));
	}

	return groupModelsForFallback(validModels).map((group) => ({
		label: group.label,
		providerBrand,
		providerLabel,
		items: group.models.map(toSelectorItem),
	}));
});

const reasoningGroups = $derived.by<AgentInputModelSelectorReasoningGroup[]>(() =>
	reasoningBaseGroups.map((group) => ({
		baseModelId: group.baseModelId,
		baseModelName: group.baseModelName,
		providerBrand,
		providerLabel,
		preferredVariantId: getPreferredReasoningVariantId({
			baseModelId: group.baseModelId,
			reasoningBaseGroups,
			selectedReasoningVariant,
		}),
		variants: group.variants.map((variant) => ({
			id: variant.fullModelId,
			name: variant.name,
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

		const result = await ResultAsync.fromPromise(onModelChange(modelId), (error) => error as Error)
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
	triggerProviderBrand={providerBrand}
	triggerProviderLabel={providerLabel}
	currentModelId={currentModelId}
	{isLoading}
	{ontoggle}
	{modelGroups}
	{favoriteModels}
	hideTriggerProviderMark={isDefaultChoiceModelId(currentModelId)}
	reasoningGroups={usesVariantSelector ? reasoningGroups : []}
	selectedReasoningBaseId={selectedReasoningVariant?.baseModelId ?? null}
	selectedReasoningVariantId={currentModelId}
	primarySelectorLabel={primarySelectorLabel}
	primaryTriggerProviderBrand={providerBrand}
	primaryTriggerProviderLabel={providerLabel}
	searchPlaceholder={"Search models..."}
	loadingLabel="Loading models..."
	noModelsLabel="No models available"
	noReasoningLevelsLabel="No reasoning levels available"
	reasoningEffortTooltipLabel={"Reasoning effort"}
	onModelChange={handleSharedModelChange}
	onToggleFavorite={agentId
		? (modelId) => preferencesStore.toggleFavorite(agentId, modelId)
		: undefined}
/>
