<script lang="ts">
	import { Input } from "../input/index.js";
	import { ProviderMark } from "../provider-mark/index.js";
	import { Selector } from "../selector/index.js";
	import { TextShimmer } from "../text-shimmer/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Colors } from "../../lib/colors.js";
	import { Brain } from "phosphor-svelte";

	import AgentInputModelFavoriteStar from "./agent-input-model-favorite-star.svelte";
	import AgentInputModelModeBar from "./agent-input-model-mode-bar.svelte";
	import AgentInputModelRow from "./agent-input-model-row.svelte";

	export interface AgentInputModelSelectorItem {
		id: string;
		name: string;
		providerSource: string;
		description?: string;
		searchText?: string;
		isFavorite?: boolean;
		isPlanDefault?: boolean;
		isBuildDefault?: boolean;
	}

	export interface AgentInputModelSelectorGroup {
		label: string;
		items: readonly AgentInputModelSelectorItem[];
	}

	export interface AgentInputModelSelectorVariant {
		id: string;
		name: string;
	}

	export interface AgentInputModelSelectorReasoningGroup {
		baseModelId: string;
		baseModelName: string;
		providerSource: string;
		preferredVariantId?: string | null;
		isPlanDefault?: boolean;
		isBuildDefault?: boolean;
		variants: readonly AgentInputModelSelectorVariant[];
	}

	interface Props {
		triggerLabel: string;
		triggerProviderSource: string;
		currentModelId: string | null;
		modelGroups: readonly AgentInputModelSelectorGroup[];
		favoriteModels?: readonly AgentInputModelSelectorItem[];
		reasoningGroups?: readonly AgentInputModelSelectorReasoningGroup[];
		selectedReasoningBaseId?: string | null;
		selectedReasoningVariantId?: string | null;
		primarySelectorLabel?: string;
		primaryTriggerProviderSource?: string;
		isLoading?: boolean;
		searchPlaceholder?: string;
		loadingLabel?: string;
		noModelsLabel?: string;
		noReasoningLevelsLabel?: string;
		reasoningEffortTooltipLabel?: string;
		planLabel?: string;
		buildLabel?: string;
		ontoggle?: (isOpen: boolean) => void;
		onModelChange: (modelId: string) => void | Promise<void>;
		onSetPlanDefault?: (modelId: string) => void;
		onSetBuildDefault?: (modelId: string) => void;
		onToggleFavorite?: (modelId: string) => void;
	}

	let {
		triggerLabel,
		triggerProviderSource,
		currentModelId,
		modelGroups,
		favoriteModels = [],
		reasoningGroups = [],
		selectedReasoningBaseId = null,
		selectedReasoningVariantId = null,
		primarySelectorLabel = "Model",
		primaryTriggerProviderSource = triggerProviderSource,
		isLoading = false,
		searchPlaceholder = "Search models",
		loadingLabel = "Loading models...",
		noModelsLabel = "No models available",
		noReasoningLevelsLabel = "No reasoning levels available",
		reasoningEffortTooltipLabel = "Reasoning effort",
		planLabel = "Plan",
		buildLabel = "Build",
		ontoggle,
		onModelChange,
		onSetPlanDefault,
		onSetBuildDefault,
		onToggleFavorite,
	}: Props = $props();

	const MODEL_SEARCH_THRESHOLD = 8;

	let isOpen = $state(false);
	let isPrimarySelectorOpen = $state(false);
	let isVariantSelectorOpen = $state(false);
	let searchQuery = $state("");

	const usesVariantSelector = $derived(reasoningGroups.length > 0);
	const totalModelCount = $derived.by(() =>
		usesVariantSelector
			? reasoningGroups.reduce((count, group) => count + group.variants.length, 0)
			: modelGroups.reduce((count, group) => count + group.items.length, 0)
	);
	const showFavorites = $derived(favoriteModels.length > 0);
	const showSearch = $derived(!usesVariantSelector && totalModelCount > MODEL_SEARCH_THRESHOLD);
	const selectedReasoningGroup = $derived.by(
		() =>
			reasoningGroups.find((group) => group.baseModelId === selectedReasoningBaseId) ??
			reasoningGroups[0] ??
			null
	);

	function toggleSplitSelector(): void {
		const nextPrimaryOpen = !isPrimarySelectorOpen;
		isPrimarySelectorOpen = nextPrimaryOpen;
		isVariantSelectorOpen = false;
		ontoggle?.(nextPrimaryOpen);
	}

	function closeSelectors(): void {
		isOpen = false;
		isPrimarySelectorOpen = false;
		isVariantSelectorOpen = false;
		ontoggle?.(false);
	}

	export function toggle(): void {
		if (usesVariantSelector) {
			toggleSplitSelector();
			return;
		}

		const nextOpen = !isOpen;
		isOpen = nextOpen;
		ontoggle?.(nextOpen);
	}

	function setPrimaryOpen(open: boolean): void {
		isPrimarySelectorOpen = open;
		if (open) {
			isVariantSelectorOpen = false;
		}
		ontoggle?.(open);
	}

	function setVariantOpen(open: boolean): void {
		isVariantSelectorOpen = open;
		if (open) {
			isPrimarySelectorOpen = false;
		}
		ontoggle?.(open);
	}

	async function handleModelSelection(modelId: string): Promise<void> {
		if (modelId !== currentModelId) {
			await onModelChange(modelId);
		}
		closeSelectors();
	}

	function resolveSearchText(item: AgentInputModelSelectorItem): string {
		return `${item.name} ${item.id} ${item.description ?? ""} ${item.providerSource} ${item.searchText ?? ""}`.toLowerCase();
	}

	const filteredGroups = $derived.by(() => {
		if (!searchQuery.trim()) {
			return modelGroups;
		}

		const query = searchQuery.toLowerCase().trim();
		return modelGroups
			.map((group) => ({
				label: group.label,
				items: group.items.filter((item) => resolveSearchText(item).includes(query)),
			}))
			.filter((group) => group.items.length > 0);
	});

	const showGroups = $derived.by(() => {
		const groups = filteredGroups;
		return groups.some((group) => group.label) || groups.length > 1;
	});
</script>

{#if usesVariantSelector}
	<div class="flex items-center h-7">
		<Selector
			open={isPrimarySelectorOpen}
			disabled={isLoading}
			onOpenChange={setPrimaryOpen}
			variant="ghost"
			buttonClass="group/provider-trigger"
		>
			{#snippet renderButton()}
				{#if isLoading}
					<TextShimmer class="text-[11px] font-medium text-muted-foreground">
						{loadingLabel}
					</TextShimmer>
				{:else}
					<ProviderMark provider={primaryTriggerProviderSource} class="size-3.5" />
					<span class="truncate text-xs">{primarySelectorLabel}</span>
				{/if}
			{/snippet}

			<div class="max-h-[250px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
				{#each reasoningGroups as group (group.baseModelId)}
					<AgentInputModelRow
						modelId={group.baseModelId}
						modelName={group.baseModelName}
						currentModelId={selectedReasoningBaseId}
						onSelect={() => {
							void handleModelSelection(group.preferredVariantId ?? group.variants[0]?.id ?? group.baseModelId);
						}}
					>
						{#snippet leading()}
							<ProviderMark provider={group.providerSource} class="size-3.5" />
						{/snippet}
						{#snippet actions()}
							{#if group.preferredVariantId && (onSetPlanDefault || onSetBuildDefault)}
								<AgentInputModelModeBar
									showModeBar={Boolean(group.isPlanDefault || group.isBuildDefault)}
									isPlanDefault={Boolean(group.isPlanDefault)}
									isBuildDefault={Boolean(group.isBuildDefault)}
									{planLabel}
									{buildLabel}
									onSetPlan={() => onSetPlanDefault?.(group.preferredVariantId!)}
									onSetBuild={() => onSetBuildDefault?.(group.preferredVariantId!)}
								/>
							{/if}
						{/snippet}
					</AgentInputModelRow>
				{/each}
			</div>
		</Selector>
		<div class="h-full w-px bg-border/50"></div>
		<DropdownMenu.Root open={isVariantSelectorOpen} onOpenChange={setVariantOpen}>
			<DropdownMenu.Trigger disabled={isLoading || !selectedReasoningGroup}>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						disabled={isLoading || !selectedReasoningGroup}
						class="flex h-7 w-7 items-center justify-center rounded-none transition-colors {isLoading || !selectedReasoningGroup ? 'cursor-not-allowed text-muted-foreground/50' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
						title={reasoningEffortTooltipLabel}
						aria-label={reasoningEffortTooltipLabel}
					>
						<Brain class="size-3.5 shrink-0" weight="fill" style={`color: ${Colors.purple}`} />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>

			<DropdownMenu.Content align="start" sideOffset={4} class="w-fit max-w-[280px] p-0">
				{#if selectedReasoningGroup}
					<div class="max-h-[250px] overflow-y-auto px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
						{#each selectedReasoningGroup.variants as variant (variant.id)}
							<AgentInputModelRow
								modelId={variant.id}
								modelName={variant.name}
								currentModelId={selectedReasoningVariantId}
								onSelect={() => {
									void handleModelSelection(variant.id);
								}}
							/>
						{/each}
					</div>
				{:else}
					<div class="px-2 py-1 text-xs">{noReasoningLevelsLabel}</div>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
{:else}
	<div class="flex items-center gap-0">
		<Selector
			open={isOpen}
			disabled={isLoading || totalModelCount === 0}
			onOpenChange={(open) => {
				isOpen = open;
				ontoggle?.(open);
			}}
			variant="ghost"
			buttonClass="group/provider-trigger"
		>
			{#snippet renderButton()}
				{#if isLoading}
					<TextShimmer class="text-[11px] font-medium text-muted-foreground">
						{loadingLabel}
					</TextShimmer>
				{:else}
					<ProviderMark provider={triggerProviderSource} class="size-3.5" />
					<span class="truncate text-xs">{triggerLabel}</span>
				{/if}
			{/snippet}

			{#if totalModelCount === 0}
				<div class="px-2 py-1 text-xs">{noModelsLabel}</div>
			{:else}
				{#if showSearch}
					<div class="sticky top-0 z-10 bg-popover px-3 py-1.5">
						<Input bind:value={searchQuery} placeholder={searchPlaceholder} class="h-8 text-xs" />
					</div>
				{/if}

				{#if showFavorites && !searchQuery}
					<div class="bg-popover px-0 pb-0.5">
						{#each favoriteModels as item (item.id)}
							<AgentInputModelRow
								modelId={item.id}
								modelName={item.name}
								currentModelId={currentModelId}
								onSelect={() => {
									void handleModelSelection(item.id);
								}}
							>
								{#snippet leading()}
									<ProviderMark provider={item.providerSource} class="size-3.5" />
								{/snippet}
								{#snippet actions()}
									<div class="ml-auto flex items-center gap-1">
										{#if onSetPlanDefault || onSetBuildDefault}
											<AgentInputModelModeBar
												showModeBar={Boolean(item.isPlanDefault || item.isBuildDefault)}
												isPlanDefault={Boolean(item.isPlanDefault)}
												isBuildDefault={Boolean(item.isBuildDefault)}
												{planLabel}
												{buildLabel}
												onSetPlan={() => onSetPlanDefault?.(item.id)}
												onSetBuild={() => onSetBuildDefault?.(item.id)}
											/>
										{/if}
										{#if onToggleFavorite}
											<AgentInputModelFavoriteStar
												isFavorite={Boolean(item.isFavorite)}
												onToggle={() => onToggleFavorite(item.id)}
											/>
										{/if}
									</div>
								{/snippet}
							</AgentInputModelRow>
						{/each}
					</div>
				{/if}

				<div class="max-h-[250px] overflow-y-auto px-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
					{#each filteredGroups as group, groupIndex (group.label)}
						{#if showGroups}
							<DropdownMenu.Label class="flex items-center gap-1.5 px-1.5 py-1 text-[10px] font-semibold">
								<ProviderMark provider={group.label} class="size-3" />
								{group.label}
							</DropdownMenu.Label>
						{/if}
						{#each group.items as item (item.id)}
							<AgentInputModelRow
								modelId={item.id}
								modelName={item.name}
								currentModelId={currentModelId}
								onSelect={() => {
									void handleModelSelection(item.id);
								}}
							>
								{#snippet leading()}
									<ProviderMark provider={item.providerSource} class="size-3.5" />
								{/snippet}
								{#snippet actions()}
									<div class="ml-auto flex items-center gap-1">
										{#if onSetPlanDefault || onSetBuildDefault}
											<AgentInputModelModeBar
												showModeBar={Boolean(item.isPlanDefault || item.isBuildDefault)}
												isPlanDefault={Boolean(item.isPlanDefault)}
												isBuildDefault={Boolean(item.isBuildDefault)}
												{planLabel}
												{buildLabel}
												onSetPlan={() => onSetPlanDefault?.(item.id)}
												onSetBuild={() => onSetBuildDefault?.(item.id)}
											/>
										{/if}
										{#if onToggleFavorite}
											<AgentInputModelFavoriteStar
												isFavorite={Boolean(item.isFavorite)}
												onToggle={() => onToggleFavorite(item.id)}
											/>
										{/if}
									</div>
								{/snippet}
							</AgentInputModelRow>
						{/each}
						{#if showGroups && groupIndex < filteredGroups.length - 1}
							<DropdownMenu.Separator />
						{/if}
					{/each}
				</div>
			{/if}
		</Selector>
	</div>
{/if}
