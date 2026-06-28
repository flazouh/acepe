<script lang="ts">
	import { Input } from "../input/index.js";
	import { LoadingIcon } from "../icons/index.js";
	import { ProviderMark, type ProviderBrand } from "../provider-mark/index.js";
	import { FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS } from "../panel-header/project-card-action-button-class.js";
	import { Selector } from "../selector/index.js";
	import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { cn } from "../../lib/utils.js";
	import AgentInputModelSelectorItemRow from "./agent-input-model-selector-item-row.svelte";
	import type {
		AgentInputModelSelectorGroup,
		AgentInputModelSelectorItem,
	} from "./agent-input-model-selector-types.js";

	interface Props {
		open?: boolean;
		triggerLabel: string;
		triggerProviderBrand?: ProviderBrand | null;
		triggerProviderLabel?: string;
		currentModelId: string | null;
		totalModelCount: number;
		filteredGroups: readonly AgentInputModelSelectorGroup[];
		favoriteModels?: readonly AgentInputModelSelectorItem[];
		searchQuery?: string;
		showSearch?: boolean;
		showGroups?: boolean;
		showFavorites?: boolean;
		isLoading?: boolean;
		searchPlaceholder?: string;
		loadingLabel?: string;
		noModelsLabel?: string;
		hideTriggerProviderMark?: boolean;
		triggerSize?: SelectorTriggerSize;
		embeddedInGroup?: boolean;
		onOpenChange?: (open: boolean) => void;
		onSearchChange?: (query: string) => void;
		onSelect: (modelId: string) => void;
		onToggleFavorite?: (modelId: string) => void;
	}

	let {
		open = false,
		triggerLabel,
		triggerProviderBrand = null,
		triggerProviderLabel,
		currentModelId,
		totalModelCount,
		filteredGroups,
		favoriteModels = [],
		searchQuery = "",
		showSearch = false,
		showGroups = false,
		showFavorites = false,
		isLoading = false,
		searchPlaceholder = "Search models",
		loadingLabel = "Loading models...",
		noModelsLabel = "No models available",
		hideTriggerProviderMark = false,
		triggerSize = "pill",
		embeddedInGroup = false,
		onOpenChange,
		onSearchChange,
		onSelect,
		onToggleFavorite,
	}: Props = $props();
</script>

<div class={embeddedInGroup ? "contents" : "flex items-center gap-0"}>
	<Selector
		{open}
		disabled={isLoading || totalModelCount === 0}
		onOpenChange={onOpenChange}
		variant="ghost"
		{triggerSize}
		{embeddedInGroup}
		showChevron={false}
		side="top"
		sideOffset={8}
	>
		{#snippet renderButton()}
			{#if isLoading}
				<LoadingIcon class="text-muted-foreground" size={14} aria-label={loadingLabel} />
			{:else}
				{#if !hideTriggerProviderMark && triggerProviderBrand}
					<ProviderMark
						brand={triggerProviderBrand}
						label={triggerProviderLabel ?? triggerLabel}
						class="size-3.5"
					/>
				{/if}
				<span class={cn("truncate", FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS)}>{triggerLabel}</span>
			{/if}
		{/snippet}

		{#if totalModelCount === 0}
			<div class="px-2 py-1 text-xs">{noModelsLabel}</div>
		{:else}
			{#if showSearch}
				<div class="sticky top-0 z-10 bg-popover px-2 py-1">
					<Input
						value={searchQuery}
						oninput={(event) => onSearchChange?.(event.currentTarget.value)}
						placeholder={searchPlaceholder}
						class="h-7 text-xs"
					/>
				</div>
			{/if}

			{#if showFavorites && !searchQuery}
				<div class="flex flex-col gap-0.5 bg-popover px-0 pb-0.5">
					{#each favoriteModels as item (item.id)}
						<AgentInputModelSelectorItemRow
							{item}
							{currentModelId}
							{onSelect}
							{onToggleFavorite}
						/>
					{/each}
				</div>
			{/if}

			<div class="flex flex-col gap-0.5 max-h-[250px] overflow-y-auto px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
				{#each filteredGroups as group, groupIndex (group.label)}
					{#if showGroups}
						<DropdownMenu.Label class="flex items-center gap-1.5 px-1.5 py-1">
							{#if group.providerBrand}
								<ProviderMark
									brand={group.providerBrand}
									label={group.providerLabel ?? group.label}
									class="size-3"
								/>
							{/if}
							{group.label}
						</DropdownMenu.Label>
					{/if}
					{#each group.items as item (item.id)}
						<AgentInputModelSelectorItemRow
							{item}
							{currentModelId}
							{onSelect}
							{onToggleFavorite}
						/>
					{/each}
					{#if showGroups && groupIndex < filteredGroups.length - 1}
						<DropdownMenu.Separator />
					{/if}
				{/each}
			</div>
		{/if}
	</Selector>
</div>
