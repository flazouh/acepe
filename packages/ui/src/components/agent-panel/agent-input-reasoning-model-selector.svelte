<script lang="ts">
	import { LoadingIcon, RoundedIcon } from "../icons/index.js";
	import { ProviderMark, type ProviderBrand } from "../provider-mark/index.js";
	import { Selector, SelectorItem } from "../selector/index.js";
	import { cn } from "../../lib/utils.js";
	import { COMPOSER_CHIP_LABEL_TEXT_CLASS } from "./agent-input-chip-classes.js";
	import { FusedPrimaryOverflowGroup } from "../panel-header/index.js";
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
		<Selector
			open={primaryOpen}
			onOpenChange={onPrimaryOpenChange}
			embeddedInGroup
			disabled={isLoading}
			showChevron={false}
			triggerSize="composerChipLabel"
			side="top"
			align="start"
			sideOffset={8}
			contentClass="w-fit max-w-[280px]"
			triggerAriaLabel={primarySelectorLabel}
		>
			{#snippet renderButton()}
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
					<span class={cn("max-w-24 truncate", COMPOSER_CHIP_LABEL_TEXT_CLASS)}>{primarySelectorLabel}</span>
				{/if}
			{/snippet}

			<div
				class="flex max-h-[250px] flex-col gap-0.5 overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
			>
				{#each reasoningGroups as group (group.baseModelId)}
					<SelectorItem
						label={group.baseModelName}
						selected={group.baseModelId === selectedReasoningBaseId}
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
					</SelectorItem>
				{/each}
			</div>
		</Selector>
	{/snippet}

	{#snippet reasoningOverflow()}
		<Selector
			open={variantOpen}
			onOpenChange={onVariantOpenChange}
			embeddedInGroup
			disabled={reasoningDisabled}
			showChevron={false}
			triggerSize="composerChipIcon"
			side="top"
			align="start"
			sideOffset={8}
			contentClass="w-fit max-w-[280px]"
			triggerAriaLabel={reasoningEffortTooltipLabel}
		>
			{#snippet renderButton()}
				<RoundedIcon
					name="brain"
					class={REASONING_EFFORT_BRAIN_ICON_CLASS}
					style={reasoningIconStyle}
					data-testid="reasoning-model-brain-icon"
				/>
			{/snippet}

			{#if selectedReasoningGroup}
				<div
					class="flex max-h-[250px] flex-col gap-0.5 overflow-y-auto px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
				>
					{#each selectedReasoningGroup.variants as variant (variant.id)}
						<SelectorItem
							label={variant.name}
							selected={variant.id === selectedReasoningVariantId}
							onSelect={() => onSelect(variant.id)}
						/>
					{/each}
				</div>
			{:else}
				<div class="px-2 py-1 text-xs">{noReasoningLevelsLabel}</div>
			{/if}
		</Selector>
	{/snippet}

	<FusedPrimaryOverflowGroup
		class="min-h-[23px] [&_[data-slot=button]]:min-h-[23px]"
		primary={modelPrimary}
		overflow={reasoningOverflow}
	/>
</div>
