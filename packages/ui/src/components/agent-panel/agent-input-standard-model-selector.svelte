<script lang="ts">
	import { LoadingIcon } from "../icons/index.js";
	import { ProviderMark, UpstreamProviderMark, type ProviderBrand } from "../provider-mark/index.js";
	import { Selector, SelectorItem, SelectorPanel } from "../selector/index.js";
	import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";
	import { getSelectorTriggerButtonVariant } from "../selector/selector-trigger-classes.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { cn } from "../../lib/utils.js";
	import AgentInputModelDefaultPin from "./agent-input-model-default-pin.svelte";
	import AgentInputModelFavoriteStar from "./agent-input-model-favorite-star.svelte";
	import type {
		AgentInputModelSelectorGroup,
		AgentInputModelSelectorItem,
	} from "./agent-input-model-selector-types.js";

	interface Props {
		open?: boolean;
		triggerLabel: string;
		triggerProviderBrand?: ProviderBrand | null;
		triggerProviderLabel?: string;
		triggerUpstreamProviderBrand?: import("../../lib/upstream-provider-brand.js").UpstreamProviderBrand | null;
		currentModelId: string | null;
		totalModelCount: number;
		filteredGroups: readonly AgentInputModelSelectorGroup[];
		favoriteModels?: readonly AgentInputModelSelectorItem[];
		providerGroups?: readonly AgentInputModelSelectorGroup[];
		activeProviderId?: string | null;
		searchQuery?: string;
		showSearch?: boolean;
		showGroups?: boolean;
		showFavoriteActions?: boolean;
		isLoading?: boolean;
		searchPlaceholder?: string;
		loadingLabel?: string;
		noModelsLabel?: string;
		hideTriggerProviderMark?: boolean;
		triggerSize?: SelectorTriggerSize;
		embeddedInGroup?: boolean;
		onOpenChange?: (open: boolean) => void;
		onSearchChange?: (query: string) => void;
		onProviderChange?: (providerId: string) => void;
		onSelect: (modelId: string) => void;
		onToggleFavorite?: (modelId: string) => void;
		onDefaultModelToggle?: (modelId: string) => void;
	}

	let {
		open = false,
		triggerLabel,
		triggerProviderBrand = null,
		triggerProviderLabel,
		triggerUpstreamProviderBrand = null,
		currentModelId,
		totalModelCount,
		filteredGroups,
		favoriteModels = [],
		providerGroups = [],
		activeProviderId = null,
		searchQuery = "",
		showSearch = false,
		showGroups = false,
		showFavoriteActions = false,
		isLoading = false,
		searchPlaceholder = "Search models",
		loadingLabel = "Loading models...",
		noModelsLabel = "No models available",
		hideTriggerProviderMark = false,
		triggerSize = "pill",
		embeddedInGroup = false,
		onOpenChange,
		onSearchChange,
		onProviderChange,
		onSelect,
		onToggleFavorite,
		onDefaultModelToggle,
	}: Props = $props();

	const selectorVariant = $derived(getSelectorTriggerButtonVariant(triggerSize));

	function handleProviderKeydown(event: KeyboardEvent): void {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const current = event.currentTarget as HTMLButtonElement;
		const tabs = Array.from(current.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
		const currentIndex = tabs.indexOf(current);
		const nextIndex = event.key === "Home"
			? 0
			: event.key === "End"
				? tabs.length - 1
				: (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
		const next = tabs[nextIndex];
		next?.focus();
		next?.click();
		next?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}
</script>

<div class={embeddedInGroup ? "contents" : "flex items-center gap-0"}>
	<Selector
		{open}
		disabled={isLoading || totalModelCount === 0}
		onOpenChange={onOpenChange}
		variant={selectorVariant}
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
				{#if !hideTriggerProviderMark && triggerUpstreamProviderBrand}
					<UpstreamProviderMark
						brand={triggerUpstreamProviderBrand}
						label={triggerProviderLabel ?? triggerLabel}
						class="size-3.5"
					/>
				{:else if !hideTriggerProviderMark && triggerProviderBrand}
					<ProviderMark
						brand={triggerProviderBrand}
						label={triggerProviderLabel ?? triggerLabel}
						class="size-3.5"
					/>
				{/if}
				<span class="truncate">{triggerLabel}</span>
			{/if}
		{/snippet}

		{#if totalModelCount === 0}
			<div class="px-2 py-1 text-xs">{noModelsLabel}</div>
		{:else}
			<SelectorPanel
				{searchQuery}
				{searchPlaceholder}
				showSearch={showSearch}
				onSearchChange={onSearchChange}
			>
			{#if providerGroups.length > 1}
				<div
					class="flex max-w-[min(32rem,calc(100vw-2rem))] items-stretch gap-0.5 overflow-x-auto border-b border-border/60 px-1 scrollbar-none"
					role="tablist"
					aria-label="Model providers"
					data-qa="model-provider-tabs"
				>
					{#each providerGroups as group (group.providerId)}
						<button
							type="button"
							role="tab"
							aria-selected={group.providerId === activeProviderId}
							tabindex={group.providerId === activeProviderId ? 0 : -1}
							data-provider-id={group.providerId}
							class={cn(
								"group/provider-tab relative flex h-7 shrink-0 items-center gap-1.5 rounded-none px-1.5 text-xs font-medium transition-colors",
								"after:pointer-events-none after:absolute after:inset-x-1 after:-bottom-px after:z-10 after:h-0.5 after:rounded-full after:transition-colors",
								group.providerId === activeProviderId
									? "text-foreground after:bg-foreground"
									: "text-muted-foreground after:bg-transparent hover:text-foreground"
							)}
							onclick={() => group.providerId && onProviderChange?.(group.providerId)}
							onkeydown={handleProviderKeydown}
						>
							<UpstreamProviderMark
								brand={group.upstreamProviderBrand}
								label={group.providerLabel ?? group.label}
								class={cn(
									"size-3.5 shrink-0 transition-opacity",
									group.providerId === activeProviderId
										? ""
										: "opacity-55 group-hover/provider-tab:opacity-100"
								)}
							/>
							<span class="truncate">{group.providerLabel ?? group.label}</span>
						</button>
					{/each}
				</div>
			{/if}
			{#if showFavoriteActions && favoriteModels.length > 0 && !searchQuery}
				<div class="flex flex-col gap-0.5 bg-popover px-0 pb-0.5">
					{#each favoriteModels as item (item.id)}
						<SelectorItem
							label={item.name}
							selected={item.id === currentModelId}
							onSelect={() => onSelect(item.id)}
						>
							{#snippet leading()}
								{#if !item.hideProviderMark && item.providerBrand}
									<ProviderMark
										brand={item.providerBrand}
										label={item.providerLabel ?? item.name}
										class="size-3.5"
									/>
								{/if}
							{/snippet}
							{#snippet trailing()}
								<div class="flex shrink-0 items-center gap-1">
									{#if onDefaultModelToggle}
										<AgentInputModelDefaultPin
											isDefault={Boolean(item.isDefault)}
											label={item.name}
											onToggle={() => onDefaultModelToggle(item.id)}
										/>
									{/if}
									{#if onToggleFavorite}
										<AgentInputModelFavoriteStar
											isFavorite={Boolean(item.isFavorite)}
											label={item.name}
											onToggle={() => onToggleFavorite(item.id)}
										/>
									{/if}
								</div>
							{/snippet}
						</SelectorItem>
					{/each}
				</div>
			{/if}
			<div class="flex flex-col gap-0.5 max-h-[250px] overflow-y-auto px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
				{#if filteredGroups.length === 0}
					<div class="px-2 py-4 text-center text-xs text-muted-foreground" data-qa="model-provider-empty">
						{searchQuery
							? `No matching models from ${providerGroups.find((group) => group.providerId === activeProviderId)?.providerLabel ?? "this provider"}`
							: `No models from ${providerGroups.find((group) => group.providerId === activeProviderId)?.providerLabel ?? "this provider"}`}
					</div>
				{/if}
				{#each filteredGroups as group, groupIndex (group.label)}
					{#if showGroups && providerGroups.length <= 1}
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
						<SelectorItem
							label={item.name}
							selected={item.id === currentModelId}
							onSelect={() => onSelect(item.id)}
						>
							{#snippet leading()}
								{#if !item.hideProviderMark && item.providerBrand}
									<ProviderMark
										brand={item.providerBrand}
										label={item.providerLabel ?? item.name}
										class="size-3.5"
									/>
								{/if}
							{/snippet}
							{#snippet trailing()}
								<div class="flex shrink-0 items-center gap-1">
									{#if onDefaultModelToggle}
										<AgentInputModelDefaultPin
											isDefault={Boolean(item.isDefault)}
											label={item.name}
											onToggle={() => onDefaultModelToggle(item.id)}
										/>
									{/if}
									{#if showFavoriteActions && onToggleFavorite}
										<AgentInputModelFavoriteStar
											isFavorite={Boolean(item.isFavorite)}
											label={item.name}
											onToggle={() => onToggleFavorite(item.id)}
										/>
									{/if}
								</div>
							{/snippet}
						</SelectorItem>
					{/each}
					{#if showGroups && providerGroups.length <= 1 && groupIndex < filteredGroups.length - 1}
						<DropdownMenu.Separator />
					{/if}
				{/each}
			</div>
			</SelectorPanel>
		{/if}
	</Selector>
</div>
