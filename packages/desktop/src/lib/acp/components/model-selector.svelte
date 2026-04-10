<script lang="ts">
import { ProviderMark, Selector, TextShimmer } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { ResultAsync } from "neverthrow";
import { Brain } from "phosphor-svelte";
import { onDestroy, onMount } from "svelte";
import type { HTMLButtonAttributes } from "svelte/elements";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";

import type { ModelsForDisplay } from "../../services/acp-types.js";
import type { Model } from "../application/dto/model.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";
import { getSelectorRegistry } from "../logic/selector-registry.svelte.js";
import * as preferencesStore from "../store/agent-model-preferences-store.svelte.js";
import { getPanelStore, getSessionStore } from "../store/index.js";
import { CanonicalModeId } from "../types/canonical-mode-id.js";
import type { ModelId } from "../types/model-id.js";
import { createLogger } from "../utils/logger.js";
import ModelSelectorContent from "./model-selector.content.svelte";
import ModelSelectorModeBar from "./model-selector.mode-bar.svelte";
import ModelSelectorRow from "./model-selector.row.svelte";
import {
	closeSplitSelector,
	getCodexCurrentVariant,
	getModelDisplayName,
	groupReasoningModelsFromDisplay,
	groupCodexModelsByBase,
	isSplitSelectorOpen,
	setPrimarySelectorOpen,
	setVariantSelectorOpen,
	supportsReasoningEffortPicker,
	togglePrimarySelector,
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

let isOpen = $state(false);
let isPrimarySelectorOpen = $state(false);
let isVariantSelectorOpen = $state(false);

const panelStore = getPanelStore();
const sessionStore = getSessionStore();

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

const usesVariantSelector = $derived(supportsReasoningEffortPicker(availableModels, modelsDisplay));

const logger = createLogger({
	id: LOGGER_IDS.MODEL_SELECTOR,
	name: "Model Selector",
});
const registry = getSelectorRegistry();
let unregister: (() => void) | null = null;

onMount(() => {
	if (registry && panelId) {
		unregister = registry.register("model", panelId, { toggle });
	}
});

onDestroy(() => {
	unregister?.();
});

function applySplitSelectorState(nextState: { primaryOpen: boolean; variantOpen: boolean }): void {
	isPrimarySelectorOpen = nextState.primaryOpen;
	isVariantSelectorOpen = nextState.variantOpen;
	ontoggle?.(isSplitSelectorOpen(nextState));
}

function closeSelectors(): void {
	isOpen = false;
	applySplitSelectorState(
		closeSplitSelector({
			primaryOpen: isPrimarySelectorOpen,
			variantOpen: isVariantSelectorOpen,
		})
	);
}

export function toggle() {
	if (usesVariantSelector) {
		const nextState = togglePrimarySelector({
			primaryOpen: isPrimarySelectorOpen,
			variantOpen: isVariantSelectorOpen,
		});
		logger.debug("Toggle split model dropdown", {
			from: { primaryOpen: isPrimarySelectorOpen, variantOpen: isVariantSelectorOpen },
			to: nextState,
		});
		applySplitSelectorState(nextState);
		return;
	}

	const nextOpen = !isOpen;
	logger.debug("Toggle dropdown", { from: isOpen, to: nextOpen });
	isOpen = nextOpen;
	ontoggle?.(nextOpen);
}

async function handleModelChange(modelId: ModelId) {
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
				closeSelectors();
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
		return;
	}

	logger.debug("Model unchanged, skipping", { modelId });
	closeSelectors();
}

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
		void handleModelChange(nextVariant.fullModelId);
	}
}

function handleVariantSelect(modelId: string): void {
	void handleModelChange(modelId);
}

function handleOpenChange(open: boolean) {
	isOpen = open;
	ontoggle?.(open);
}

function handlePrimaryOpenChange(open: boolean) {
	applySplitSelectorState(
		setPrimarySelectorOpen(
			{ primaryOpen: isPrimarySelectorOpen, variantOpen: isVariantSelectorOpen },
			open
		)
	);
}

function handleVariantOpenChange(open: boolean) {
	applySplitSelectorState(
		setVariantSelectorOpen(
			{ primaryOpen: isPrimarySelectorOpen, variantOpen: isVariantSelectorOpen },
			open
		)
	);
}
</script>

{#if usesVariantSelector}
<div class="flex items-center h-7">
<Selector
open={isPrimarySelectorOpen}
disabled={isLoading}
onOpenChange={handlePrimaryOpenChange}
variant="ghost"
buttonClass="group/provider-trigger"
>
{#snippet renderButton()}
{#if isLoading}
<TextShimmer class="text-[11px] font-medium text-muted-foreground">
Loading models...
</TextShimmer>
{:else}
<ProviderMark
provider={`${primarySelectorLabel} ${selectedReasoningBaseGroup?.baseModelId ?? currentModelId ?? ""}`}
class="size-3.5"
/>
<span class="text-xs truncate">{primarySelectorLabel}</span>
{/if}
{/snippet}

<div
class="overflow-y-auto max-h-[250px] scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
>
{#each reasoningBaseGroups as group (group.baseModelId)}
<ModelSelectorRow
modelId={group.baseModelId}
modelName={group.baseModelName}
currentModelId={selectedReasoningVariant?.baseModelId ?? null}
onSelect={() => handlePrimarySelect(group.baseModelId)}
>
{#snippet leading()}
<ProviderMark provider={triggerProviderMarkSource} class="size-3.5" />
{/snippet}
{#snippet actions()}
{#if agentId}
{@const preferredVariantId = getPreferredVariantId(group.baseModelId)}
{@const isPlanDefault = isDefaultForBase(planDefaultId, group.baseModelId)}
{@const isBuildDefault = isDefaultForBase(buildDefaultId, group.baseModelId)}
{@const showModeBar = isPlanDefault || isBuildDefault}
{#if preferredVariantId}
<ModelSelectorModeBar
{showModeBar}
{isPlanDefault}
{isBuildDefault}
onSetPlan={() =>
preferencesStore.setDefaultModel(
agentId,
CanonicalModeId.PLAN,
preferredVariantId
)}
onSetBuild={() =>
preferencesStore.setDefaultModel(
agentId,
CanonicalModeId.BUILD,
preferredVariantId
)}
/>
{/if}
{/if}
{/snippet}
</ModelSelectorRow>
{/each}
</div>
</Selector>
<div class="h-full w-px bg-border/50"></div>
<DropdownMenu.Root open={isVariantSelectorOpen} onOpenChange={handleVariantOpenChange}>
<Tooltip.Root>
<Tooltip.Trigger>
{#snippet child({ props: tooltipProps })}
<div {...tooltipProps}>
<DropdownMenu.Trigger disabled={isLoading || !selectedReasoningBaseGroup}>
{#snippet child({ props: triggerProps }: { props: HTMLButtonAttributes })}
<button
{...triggerProps}
type="button"
disabled={isLoading || !selectedReasoningBaseGroup}
class="flex items-center justify-center w-7 h-7 transition-colors rounded-none
{isLoading || !selectedReasoningBaseGroup
? 'text-muted-foreground/50 cursor-not-allowed'
: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
>
<Brain
class="size-3.5 shrink-0"
weight="fill"
style="color: {Colors.purple}"
/>
</button>
{/snippet}
</DropdownMenu.Trigger>
</div>
{/snippet}
</Tooltip.Trigger>
<Tooltip.Content>{m.model_selector_reasoning_effort_tooltip()}</Tooltip.Content>
</Tooltip.Root>

<DropdownMenu.Content align="start" sideOffset={4} class="w-fit max-w-[280px] p-0">
{#if selectedReasoningBaseGroup}
<div
class="overflow-y-auto max-h-[250px] px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
>
{#each selectedReasoningBaseGroup.variants as variant (variant.fullModelId)}
<ModelSelectorRow
modelId={variant.fullModelId}
modelName={variant.effort}
currentModelId={currentModelId}
onSelect={() => handleVariantSelect(variant.fullModelId)}
/>
{/each}
</div>
{:else}
<div class="px-2 py-1 text-xs">No reasoning levels available</div>
{/if}
</DropdownMenu.Content>
</DropdownMenu.Root>
</div>
{:else}
<div class="flex items-center gap-0">
<Selector
open={isOpen}
disabled={isLoading || availableModels.length === 0}
onOpenChange={handleOpenChange}
variant="ghost"
buttonClass="group/provider-trigger"
>
{#snippet renderButton()}
{#if isLoading}
<TextShimmer class="text-[11px] font-medium text-muted-foreground">
Loading models...
</TextShimmer>
{:else}
<ProviderMark provider={triggerProviderMarkSource} class="size-3.5" />
<span class="text-xs truncate">{displayName}</span>
{/if}
{/snippet}

{#key isOpen}
<ModelSelectorContent
{availableModels}
{currentModelId}
{modelsDisplay}
{isOpen}
agentId={agentId ?? null}
onModelChange={handleModelChange}
/>
{/key}
</Selector>
</div>
{/if}
