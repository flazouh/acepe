<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import IconCheck from "@tabler/icons-svelte/icons/check";
import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";
import IconClock from "@tabler/icons-svelte/icons/clock";
import IconSearch from "@tabler/icons-svelte/icons/search";
import IconStar from "@tabler/icons-svelte/icons/star";
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { cn } from "$lib/utils.js";

import { getProviderStore } from "../store/provider-store.svelte.js";
import ProviderLogo from "./provider-logo.svelte";

interface Props {
	class?: string;
}

let { class: className }: Props = $props();

const store = getProviderStore();

let isOpen = $state(false);
let searchQuery = $state("");

// Filtered providers based on search
const filteredProviders = $derived.by(() => {
	if (!searchQuery.trim()) return store.providers;

	const query = searchQuery.toLowerCase();
	return store.providers
		.map((provider) => ({
			...provider,
			models: provider.models.filter(
				(m) => m.name.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query)
			),
		}))
		.filter((p) => p.models.length > 0);
});

// Favorites list with resolved model data
const favoritesList = $derived.by(() => {
	const result = [];
	for (const { providerId, modelId } of store.favoriteModels) {
		const provider = store.providers.find((p) => p.id === providerId);
		const model = provider?.models.find((m) => m.id === modelId);
		if (model && provider) {
			result.push({ provider, model, providerId, modelId });
		}
	}
	return result;
});

// Recents list with resolved model data
const recentsList = $derived.by(() => {
	const result = [];
	for (const { providerId, modelId } of store.recentModels) {
		const provider = store.providers.find((p) => p.id === providerId);
		const model = provider?.models.find((m) => m.id === modelId);
		if (model && provider) {
			result.push({ provider, model, providerId, modelId });
		}
	}
	return result;
});

function handleModelSelect(providerId: string, modelId: string) {
	if (providerId !== store.currentProviderId) {
		store.setProvider(providerId);
	}
	store.setModel(modelId);
	isOpen = false;
}

// Reset search when dropdown closes
$effect(() => {
	if (!isOpen) {
		searchQuery = "";
	}
});
</script>

<DropdownMenu.Root bind:open={isOpen}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" class={cn("h-8 gap-2 px-2", className)}>
				{#if store.currentProviderId}
					<ProviderLogo providerId={store.currentProviderId} class="h-4 w-4" />
				{/if}
				<span class="text-xs truncate max-w-[120px]">
					{store.currentModel?.name ?? "Select model"}
				</span>
				<IconChevronDown class="h-4 w-4 opacity-50" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content class="w-[320px] p-0">
		<!-- Search Input -->
		<div class="p-2 border-b">
			<div class="relative">
				<IconSearch
					class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
				/>
				<Input
					type="text"
					placeholder="Search models..."
					bind:value={searchQuery}
					class="pl-8 h-8 text-sm dark:bg-[#1f1f1f] dark:border-[#3a3a3a] dark:text-foreground dark:placeholder:text-muted-foreground/80"
					autofocus
				/>
			</div>
		</div>

		<!-- Scrollable Content -->
		<div class="max-h-[400px] overflow-y-auto p-1">
			<!-- Favorites Section -->
			{#if favoritesList.length > 0 && !searchQuery}
				<DropdownMenu.Label class="flex items-center gap-2 px-2 py-1.5">
					<IconStar class="h-4 w-4 text-yellow-500" />
					Favorites
				</DropdownMenu.Label>
				{#each favoritesList as item (item.modelId)}
					<DropdownMenu.Item
						class="flex items-center gap-2"
						onSelect={() => handleModelSelect(item.providerId, item.modelId)}
					>
						<ProviderLogo providerId={item.providerId} class="h-4 w-4" />
						<span class="flex-1 truncate">{item.model.name}</span>
						{#if item.providerId === store.currentProviderId && item.modelId === store.currentModelId}
							<IconCheck class="h-4 w-4 text-primary" />
						{/if}
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
			{/if}

			<!-- Recents Section -->
			{#if recentsList.length > 0 && !searchQuery}
				<DropdownMenu.Label class="flex items-center gap-2 px-2 py-1.5">
					<IconClock class="h-4 w-4" />
					Recent
				</DropdownMenu.Label>
				{#each recentsList as item (item.modelId)}
					<DropdownMenu.Item
						class="flex items-center gap-2"
						onSelect={() => handleModelSelect(item.providerId, item.modelId)}
					>
						<ProviderLogo providerId={item.providerId} class="h-4 w-4" />
						<span class="flex-1 truncate">{item.model.name}</span>
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
			{/if}

			<!-- All Providers -->
			{#each filteredProviders as provider (provider.id)}
				<DropdownMenu.Label class="flex items-center gap-2 px-2 py-1.5">
					<ProviderLogo providerId={provider.id} class="h-4 w-4" />
					{provider.name}
				</DropdownMenu.Label>
				{#each provider.models as model (model.id)}
					<DropdownMenu.Item
						class="group flex items-center gap-2 pl-8"
						onSelect={() => handleModelSelect(provider.id, model.id)}
					>
						<span class="flex-1 truncate">{model.name}</span>
						<button
							onclick={(e) => {
								e.stopPropagation();
								store.toggleFavoriteModel(provider.id, model.id);
							}}
							class={cn(
								"h-4 w-4",
								store.isFavoriteModel(provider.id, model.id)
									? "text-yellow-500"
									: "text-muted-foreground opacity-0 group-hover:opacity-100"
							)}
						>
							<IconStar class="h-3.5 w-3.5" />
						</button>
						{#if provider.id === store.currentProviderId && model.id === store.currentModelId}
							<IconCheck class="h-4 w-4 text-primary" />
						{/if}
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
			{/each}

			{#if filteredProviders.length === 0}
				<div class="px-2 py-4 text-center text-sm text-muted-foreground">No models found</div>
			{/if}
		</div>

		<!-- Keyboard hints -->
		<div class="px-3 py-1.5 border-t text-xs text-muted-foreground">
			↑↓ navigate • Enter select • Esc close
		</div>
	</DropdownMenu.Content>
</DropdownMenu.Root>
