<script lang="ts">
	import { Brain } from "phosphor-svelte";
	import { Button } from "../button/index.js";
	import { LoadingIcon } from "../icons/index.js";
	import { ProviderMark, type ProviderBrand } from "../provider-mark/index.js";
	import { Selector } from "../selector/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Colors } from "../../lib/colors.js";
	import AgentInputModelRow from "./agent-input-model-row.svelte";
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
</script>

<div class="flex items-center h-7">
	<Selector
		open={primaryOpen}
		disabled={isLoading}
		onOpenChange={onPrimaryOpenChange}
		variant="outline"
		buttonClass="group/provider-trigger"
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
				<span class="truncate text-xs">{primarySelectorLabel}</span>
			{/if}
		{/snippet}

		<div class="flex flex-col gap-0.5 max-h-[250px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
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
	</Selector>
	<div class="h-full w-px bg-border/50"></div>
	<DropdownMenu.Root open={variantOpen} onOpenChange={onVariantOpenChange}>
		<DropdownMenu.Trigger disabled={isLoading || !selectedReasoningGroup}>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="outline"
					size="sm"
					disabled={isLoading || !selectedReasoningGroup}
					class="h-7 w-7 shrink-0 rounded-none border-0 p-0 text-muted-foreground"
					title={reasoningEffortTooltipLabel}
					aria-label={reasoningEffortTooltipLabel}
				>
					<Brain class="size-3.5 shrink-0" weight="fill" style={`color: ${Colors.purple}`} />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>

		<DropdownMenu.Content align="start" sideOffset={4} class="w-fit max-w-[280px] p-0">
			{#if selectedReasoningGroup}
				<div class="flex flex-col gap-0.5 max-h-[250px] overflow-y-auto px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
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
</div>
