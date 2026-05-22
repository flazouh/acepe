<script lang="ts">
	import { ProviderMark } from "../provider-mark/index.js";
	import AgentInputModelFavoriteStar from "./agent-input-model-favorite-star.svelte";
	import AgentInputModelRow from "./agent-input-model-row.svelte";
	import type { AgentInputModelSelectorItem } from "./agent-input-model-selector-types.js";

	interface Props {
		item: AgentInputModelSelectorItem;
		currentModelId: string | null;
		onSelect: (modelId: string) => void;
		onToggleFavorite?: (modelId: string) => void;
	}

	let { item, currentModelId, onSelect, onToggleFavorite }: Props = $props();
</script>

<AgentInputModelRow
	modelId={item.id}
	modelName={item.name}
	{currentModelId}
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
	{#snippet actions()}
		{#if onToggleFavorite}
			<AgentInputModelFavoriteStar
				isFavorite={Boolean(item.isFavorite)}
				onToggle={() => onToggleFavorite(item.id)}
			/>
		{/if}
	{/snippet}
</AgentInputModelRow>
