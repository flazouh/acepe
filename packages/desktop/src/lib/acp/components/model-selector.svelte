<script lang="ts">
import { Selector, TextShimmer } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { ResultAsync } from "neverthrow";
import Brain from "phosphor-svelte/lib/Brain";
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
	getCodexCurrentVariant,
	getModelDisplayName,
	groupCodexModelsByBase,
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

let isOpen = $state(false);
let isCodexModelOpen = $state(false);
let isCodexEffortOpen = $state(false);

const panelStore = getPanelStore();
const sessionStore = getSessionStore();

const agentId = $derived.by(() => {
	if (panelId) {
		const panel = panelStore.panels.find((p) => p.id === panelId);
		if (panel?.sessionId) {
			const session = sessionStore.getSessionCold(panel.sessionId);
			return session?.agentId ?? panel.selectedAgentId;
		}
		return panel?.selectedAgentId;
	}
	return null;
});

const usesReasoningEffortPicker = $derived(supportsReasoningEffortPicker(availableModels));

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

$effect(() => {
	if (usesReasoningEffortPicker && isCodexModelOpen) {
		isCodexEffortOpen = false;
	}
});

$effect(() => {
	if (usesReasoningEffortPicker && isCodexEffortOpen) {
		isCodexModelOpen = false;
	}
});

export function toggle() {
	if (usesReasoningEffortPicker) {
		const newState = !isCodexModelOpen;
		logger.debug("Toggle codex model dropdown", { from: isCodexModelOpen, to: newState });
		isCodexModelOpen = newState;
		if (newState) {
			isCodexEffortOpen = false;
		}
		ontoggle?.(isCodexModelOpen || isCodexEffortOpen);
		return;
	}

	const newState = !isOpen;
	logger.debug("Toggle dropdown", { from: isOpen, to: newState });
	isOpen = newState;
	ontoggle?.(isOpen);
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
				isOpen = false;
				isCodexModelOpen = false;
				isCodexEffortOpen = false;
				ontoggle?.(false);
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
	} else {
		logger.debug("Model unchanged, skipping", { modelId });
		isOpen = false;
		isCodexModelOpen = false;
		isCodexEffortOpen = false;
		ontoggle?.(false);
	}
}

const selectedModel = $derived(
	currentModelId && availableModels.length > 0
		? (availableModels.find((m) => m.id === currentModelId) ?? null)
		: null
);

const displayName = $derived.by(() => {
	if (!currentModelId) return "Model";

	// Prefer backend-precomputed display name (matches what dropdown items show)
	if (modelsDisplay?.groups) {
		for (const group of modelsDisplay.groups) {
			const match = group.models.find((m) => m.modelId === currentModelId);
			if (match) return match.displayName;
		}
	}

	if (!selectedModel) return "Model";
	return getModelDisplayName(selectedModel, agentId ?? null);
});

const codexBaseGroups = $derived.by(() =>
	usesReasoningEffortPicker ? groupCodexModelsByBase(availableModels) : []
);
const selectedCodexVariant = $derived.by(() =>
	usesReasoningEffortPicker ? getCodexCurrentVariant(codexBaseGroups, currentModelId) : null
);
const selectedCodexBaseGroup = $derived.by(() => {
	if (!usesReasoningEffortPicker || codexBaseGroups.length === 0) {
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
const codexModelDisplayName = $derived(selectedCodexBaseGroup?.baseModelName ?? "Model");

const planDefaultId = $derived(
	agentId ? preferencesStore.getDefaultModel(agentId, CanonicalModeId.PLAN) : undefined
);
const buildDefaultId = $derived(
	agentId ? preferencesStore.getDefaultModel(agentId, CanonicalModeId.BUILD) : undefined
);

function getPreferredVariantId(baseModelId: string): string | null {
	const baseGroup = codexBaseGroups.find((group) => group.baseModelId === baseModelId);
	if (!baseGroup) {
		return null;
	}
	const matchingCurrent =
		selectedCodexVariant && selectedCodexVariant.baseModelId === baseModelId
			? baseGroup.variants.find(
					(variant) => variant.fullModelId === selectedCodexVariant.fullModelId
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
		void handleModelChange(nextVariant.fullModelId);
	}
}

function handleCodexEffortSelect(modelId: string): void {
	void handleModelChange(modelId);
}

function handleOpenChange(open: boolean) {
	ontoggle?.(open);
}

function handleCodexModelOpenChange(open: boolean) {
	ontoggle?.(open || isCodexEffortOpen);
}

function handleCodexEffortOpenChange(open: boolean) {
	ontoggle?.(open || isCodexModelOpen);
}
</script>

{#if usesReasoningEffortPicker}
	<div class="flex items-center h-7">
		<Selector
			bind:open={isCodexModelOpen}
			disabled={isLoading}
			onOpenChange={handleCodexModelOpenChange}
			variant="ghost"
		>
			{#snippet renderButton()}
				{#if isLoading}
					<TextShimmer class="text-[11px] font-medium text-muted-foreground">
						Loading models...
					</TextShimmer>
				{:else}
					<span class="text-xs truncate">{codexModelDisplayName}</span>
				{/if}
			{/snippet}

			<div
				class="overflow-y-auto max-h-[250px] scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
			>
				{#each codexBaseGroups as group (group.baseModelId)}
					<ModelSelectorRow
						modelId={group.baseModelId}
						modelName={group.baseModelName}
						currentModelId={selectedCodexVariant?.baseModelId ?? null}
						onSelect={() => handleCodexBaseSelect(group.baseModelId)}
					>
						{#snippet actions()}
							{#if agentId}
								{@const preferredVariantId = getPreferredVariantId(group.baseModelId)}
								{@const isPlanDefault = isDefaultForBase(planDefaultId, group.baseModelId)}
								{@const isBuildDefault = isDefaultForBase(
									buildDefaultId,
									group.baseModelId
								)}
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
											)
										}
										onSetBuild={() =>
											preferencesStore.setDefaultModel(
												agentId,
												CanonicalModeId.BUILD,
												preferredVariantId
											)
										}
									/>
								{/if}
							{/if}
						{/snippet}
					</ModelSelectorRow>
				{/each}
			</div>
		</Selector>
		<div class="h-full w-px bg-border/50"></div>
		<DropdownMenu.Root bind:open={isCodexEffortOpen} onOpenChange={handleCodexEffortOpenChange}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props: tooltipProps })}
						<div {...tooltipProps}>
							<DropdownMenu.Trigger disabled={isLoading || !selectedCodexBaseGroup}>
								{#snippet child({ props: triggerProps }: { props: HTMLButtonAttributes })}
									<button
										{...triggerProps}
										type="button"
										disabled={isLoading || !selectedCodexBaseGroup}
										class="flex items-center justify-center w-7 h-7 transition-colors rounded-none
											{isLoading || !selectedCodexBaseGroup
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
				{#if selectedCodexBaseGroup}
					<div
						class="overflow-y-auto max-h-[250px] px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
					>
						{#each selectedCodexBaseGroup.variants as variant (variant.fullModelId)}
							<ModelSelectorRow
								modelId={variant.fullModelId}
								modelName={variant.effort}
								currentModelId={currentModelId}
								onSelect={() => handleCodexEffortSelect(variant.fullModelId)}
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
			bind:open={isOpen}
			disabled={isLoading || availableModels.length === 0}
			onOpenChange={handleOpenChange}
			variant="ghost"
		>
			{#snippet renderButton()}
				{#if isLoading}
					<TextShimmer class="text-[11px] font-medium text-muted-foreground">
						Loading models...
					</TextShimmer>
				{:else}
					<span class="text-xs truncate">{displayName}</span>
				{/if}
			{/snippet}

			<ModelSelectorContent
				{availableModels}
				{currentModelId}
				{modelsDisplay}
				{isOpen}
				agentId={agentId ?? null}
				onModelChange={handleModelChange}
			/>
		</Selector>
	</div>
{/if}
