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
	getModelSelectorProviderBrand,
	getModelSelectorSearchText,
	getPreferredReasoningVariantId,
	resolveModelSelectorAgentId,
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
	/** Compact chip sizing for the new-thread setup row. */
	compactSetup?: boolean;
	/** Primary segment styling inside a fused model + reasoning button group. */
	embeddedInGroup?: boolean;
	/** Canonical agent that produced the current capability catalog. */
	agentId?: string | null;
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
	compactSetup = false,
	embeddedInGroup = false,
	agentId: capabilitiesAgentId = null,
}: ModelSelectorProps = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const registry = getSelectorRegistry();
const logger = createLogger({
	id: LOGGER_IDS.MODEL_SELECTOR,
	name: "Model Selector",
});

const MODEL_FAVORITES_THRESHOLD = 12;

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
		const sessionAgentId = panel?.sessionId
			? (sessionStore.read.getSessionIdentity(panel.sessionId)?.agentId ?? null)
			: null;
		return resolveModelSelectorAgentId({
			capabilitiesAgentId,
			sessionAgentId,
			panelAgentId: panel?.selectedAgentId ?? null,
		});
	}
	return capabilitiesAgentId;
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

const modelProviderBrand = $derived<ProviderBrand | null>(
	getModelSelectorProviderBrand(providerMetadata?.providerBrand)
);
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
const selectedDisplayGroup = $derived(
	displayGroups.find((group) => group.models.some((model) => model.modelId === currentModelId)) ??
		null
);
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
const showFavoriteActions = $derived(totalModelCount > MODEL_FAVORITES_THRESHOLD);

function toSelectorItem(
	model: Model | DisplayableModel,
	upstreamProviderLabel?: string,
	providerScopeId?: string | null
): AgentInputModelSelectorItem {
	const id = getModelSelectorItemId(model);
	const name = getModelSelectorItemLabel({
		model,
		agentId: agentId ?? null,
		modelsDisplay,
	});
	return {
		id,
		name,
		providerBrand: upstreamProviderLabel ? null : modelProviderBrand,
		providerLabel: upstreamProviderLabel ?? providerLabel,
		description: model.description ?? undefined,
		searchText: getModelSelectorSearchText({
			name,
			id,
			description: model.description,
			providerLabel,
		}),
		hideProviderMark: isDefaultChoiceModelId(id),
		isFavorite: agentId ? preferencesStore.isFavorite(agentId, id) : false,
		isDefault: agentId
			? preferencesStore.isDefaultModel(agentId, providerScopeId ?? null, id)
			: false,
	};
}

const favoriteModels = $derived.by(() => {
	if (!agentId || !showFavoriteActions) {
		return [] as AgentInputModelSelectorItem[];
	}
	const favoriteIds = preferencesStore.getFavorites(agentId);
	if (hasDisplayGroups) {
		return allDisplayableModels
			.filter((model) => favoriteIds.includes(model.modelId))
			.map((model) => {
				const group = displayGroups.find((candidate) =>
					candidate.models.some((item) => item.modelId === model.modelId)
				);
				return toSelectorItem(
					model,
					group?.providerLabel ?? group?.label,
					group?.providerId ?? null
				);
			});
	}
	return validModels
		.filter((model) => favoriteIds.includes(model.id))
		.map((model) => toSelectorItem(model));
});

const modelGroups = $derived.by<AgentInputModelSelectorGroup[]>(() => {
	if (hasDisplayGroups) {
		return displayGroups.map((group) => ({
			label: group.label,
			providerId: group.providerId ?? undefined,
			upstreamProviderBrand: group.providerBrand ?? null,
			providerBrand: group.providerId ? null : modelProviderBrand,
			providerLabel: group.providerLabel ?? providerLabel,
			items: group.models.map((model) =>
				toSelectorItem(model, group.providerLabel ?? group.label, group.providerId ?? null)
			),
		}));
	}

	return groupModelsForFallback(validModels).map((group) => ({
		label: group.label,
		providerBrand: modelProviderBrand,
		providerLabel,
		items: group.models.map((model) => toSelectorItem(model)),
	}));
});

const reasoningGroups = $derived.by<AgentInputModelSelectorReasoningGroup[]>(() =>
	reasoningBaseGroups.map((group) => ({
		baseModelId: group.baseModelId,
		baseModelName: group.baseModelName,
		providerBrand: modelProviderBrand,
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

function handleDefaultModelToggle(modelId: string): void {
	if (!agentId) {
		return;
	}

	const providerScopeId =
		displayGroups.find((group) => group.models.some((model) => model.modelId === modelId))
			?.providerId ?? null;
	const currentDefaultModelId = preferencesStore.getDefaultModel(agentId, providerScopeId);
	preferencesStore.setDefaultModel(
		agentId,
		providerScopeId,
		currentDefaultModelId === modelId ? null : modelId
	);
}
</script>

<SharedAgentInputModelSelector
	bind:this={sharedSelectorRef}
	triggerLabel={displayName}
	triggerProviderBrand={modelProviderBrand}
	triggerProviderLabel={providerLabel}
	triggerUpstreamProviderBrand={selectedDisplayGroup?.providerBrand ?? null}
	currentModelId={currentModelId}
	{isLoading}
	{ontoggle}
	triggerSize={compactSetup ? "composerChipLabel" : "pill"}
	{embeddedInGroup}
	{modelGroups}
	preferredProviderId={agentId ? preferencesStore.getModelProvider(agentId) : null}
	onProviderChange={agentId
		? (providerId) => preferencesStore.setModelProvider(agentId, providerId)
		: undefined}
	{favoriteModels}
	hideTriggerProviderMark={isDefaultChoiceModelId(currentModelId)}
	reasoningGroups={usesVariantSelector ? reasoningGroups : []}
	selectedReasoningBaseId={selectedReasoningVariant?.baseModelId ?? null}
	selectedReasoningVariantId={currentModelId}
	primarySelectorLabel={primarySelectorLabel}
	primaryTriggerProviderBrand={modelProviderBrand}
	primaryTriggerProviderLabel={providerLabel}
	searchPlaceholder={"Search models..."}
	loadingLabel="Loading models..."
	noModelsLabel="No models available"
	noReasoningLevelsLabel="No reasoning levels available"
	reasoningEffortTooltipLabel={"Reasoning effort"}
	onModelChange={handleSharedModelChange}
	{showFavoriteActions}
	onToggleFavorite={agentId && showFavoriteActions
		? (modelId) => preferencesStore.toggleFavorite(agentId, modelId)
		: undefined}
	onDefaultModelToggle={agentId ? handleDefaultModelToggle : undefined}
/>
