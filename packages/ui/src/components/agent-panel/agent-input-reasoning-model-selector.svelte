<script lang="ts">
	import { Brain } from "phosphor-svelte";

	import { LoadingIcon } from "../icons/index.js";
	import { ProviderMark, type ProviderBrand } from "../provider-mark/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { cn } from "../../lib/utils.js";
	import {
		FUSED_CONTROL_GROUPED_CHIP_LABEL_BUTTON_CLASS,
		FUSED_CONTROL_OVERFLOW_BUTTON_CLASS,
		FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS,
		FusedPrimaryOverflowGroup,
	} from "../panel-header/index.js";
	import AgentInputModelRow from "./agent-input-model-row.svelte";
	import { getReasoningVariantIconColor } from "./agent-input-config-option-selector-state.js";
	import { REASONING_EFFORT_BRAIN_ICON_CLASS } from "./agent-input-reasoning-effort-trigger-props.js";
	import type { AgentInputModelSelectorReasoningGroup } from "./agent-input-model-selector-types.js";

	interface Props {
		reasoningGroups: readonly AgentInputModelSelectorReasoningGroup[];
		selectedReasoningBaseId?: string | null;
		selectedReasoningVariantId?: string | null;
		selectedReasoningGroup: AgentInputModelSelectorReasoningGroup | null;
		primarySelectorLabel?: string;
		isLoading?: boolean;
		loadingLabel?: string;
		noReasoningLevelsLabel?: string;
		reasoningEffortTooltipLabel?: string;
		hideTriggerProviderMark?: boolean;
		primaryTriggerProviderBrand?: ProviderBrand | null;
		primaryTriggerProviderLabel?: string;
		primaryOpen?: boolean;
		variantOpen?: boolean;
		onPrimaryOpenChange?: (open: boolean) => void;
		onVariantOpenChange?: (open: boolean) => void;
		onSelect: (modelId: string) => void;
	}

	let {
		reasoningGroups,
		selectedReasoningBaseId = null,
		selectedReasoningVariantId = null,
		selectedReasoningGroup,
		primarySelectorLabel = "Model",
		isLoading = false,
		loadingLabel = "Loading models...",
		noReasoningLevelsLabel = "No reasoning levels available",
		reasoningEffortTooltipLabel = "Reasoning effort",
		hideTriggerProviderMark = false,
		primaryTriggerProviderBrand = null,
		primaryTriggerProviderLabel,
		primaryOpen = false,
		variantOpen = false,
		onPrimaryOpenChange,
		onVariantOpenChange,
		onSelect,
	}: Props = $props();

	const reasoningDisabled = $derived(isLoading || !selectedReasoningGroup);
	const reasoningIconStyle = $derived(
		`color: ${getReasoningVariantIconColor({
			variants: selectedReasoningGroup?.variants ?? [],
			selectedVariantId: selectedReasoningVariantId,
		})}`
	);
</script>

<div class="model-reasoning-controls flex shrink-0 items-end">
	{#snippet modelPrimary()}
		<DropdownMenu.Root open={primaryOpen} onOpenChange={onPrimaryOpenChange} class="contents">
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						data-slot="button"
						disabled={isLoading}
						aria-label={primarySelectorLabel}
						class={FUSED_CONTROL_GROUPED_CHIP_LABEL_BUTTON_CLASS}
					>
						{#if isLoading}
							<LoadingIcon class="text-muted-foreground" size={14} aria-label={loadingLabel} />
						{:else}
							{#if !hideTriggerProviderMark && primaryTriggerProviderBrand}
								<ProviderMark
									brand={primaryTriggerProviderBrand}
									label={primaryTriggerProviderLabel ?? primarySelectorLabel}
									class="size-3.5"
								/>
							{/if}
							<span class={cn("max-w-24 truncate", FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS)}>{primarySelectorLabel}</span>
						{/if}
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="top" align="start" sideOffset={8} class="w-fit max-w-[280px]">
				<div
					class="flex max-h-[250px] flex-col gap-0.5 overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
				>
					{#each reasoningGroups as group (group.baseModelId)}
						<AgentInputModelRow
							modelId={group.baseModelId}
							modelName={group.baseModelName}
							currentModelId={selectedReasoningBaseId}
							onSelect={() =>
								onSelect(group.preferredVariantId ?? group.variants[0]?.id ?? group.baseModelId)}
						>
							{#snippet leading()}
								{#if group.providerBrand}
									<ProviderMark
										brand={group.providerBrand}
										label={group.providerLabel ?? group.baseModelName}
										class="size-3.5"
									/>
								{/if}
							{/snippet}
						</AgentInputModelRow>
					{/each}
				</div>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}

	{#snippet reasoningOverflow()}
		<DropdownMenu.Root open={variantOpen} onOpenChange={onVariantOpenChange} class="contents">
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						data-slot="button"
						disabled={reasoningDisabled}
						aria-label={reasoningEffortTooltipLabel}
						title={reasoningEffortTooltipLabel}
						class={cn(FUSED_CONTROL_OVERFLOW_BUTTON_CLASS, "px-1")}
					>
						<Brain
							class={REASONING_EFFORT_BRAIN_ICON_CLASS}
							weight="fill"
							aria-hidden="true"
							style={reasoningIconStyle}
						/>
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="top" align="start" sideOffset={8} class="w-fit max-w-[280px]">
				{#if selectedReasoningGroup}
					<div
						class="flex max-h-[250px] flex-col gap-0.5 overflow-y-auto px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
					>
						{#each selectedReasoningGroup.variants as variant (variant.id)}
							<AgentInputModelRow
								modelId={variant.id}
								modelName={variant.name}
								currentModelId={selectedReasoningVariantId}
								onSelect={() => onSelect(variant.id)}
							/>
						{/each}
					</div>
				{:else}
					<div class="px-2 py-1 text-xs">{noReasoningLevelsLabel}</div>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}

	<FusedPrimaryOverflowGroup
		class="min-h-[23px] [&_[data-slot=button]]:min-h-[23px]"
		primary={modelPrimary}
		overflow={reasoningOverflow}
	/>
</div>
