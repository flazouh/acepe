<script lang="ts">
	import type { PaletteItem } from "./types.js";
	import CommandPaletteItem from "./command-palette-item.svelte";

	interface Props {
		/** Items to display */
		items: PaletteItem[];
		/** Current search query for highlighting */
		query?: string;
		/** Currently selected index */
		selectedIndex: number;
		/** Whether to show recent section header */
		hasRecentSection: boolean;
		/** Index where recent section ends */
		recentSectionEndIndex: number;
		/** Callback when item is selected */
		onSelect: () => void;
		/** Callback when hovering over an item */
		onHover: (index: number) => void;
		/** Optional resolver for session agent icons */
		getAgentIconSrc?: (agentId: string) => string | undefined;
	}

	let {
		items,
		query = "",
		selectedIndex,
		hasRecentSection,
		recentSectionEndIndex,
		onSelect,
		onHover,
		getAgentIconSrc,
	}: Props = $props();
</script>

<div class="max-h-72 overflow-hidden overflow-y-auto rounded-b-lg">
	{#if items.length === 0}
		<div class="px-3 py-6 text-center text-xs text-muted-foreground/60">No results found</div>
	{:else}
		{#each items as item, index (item.id)}
			{@const isSelected = index === selectedIndex}
			{@const isLast = index === items.length - 1}
			{@const isFirstNonRecent = hasRecentSection && index === recentSectionEndIndex}

			{#if hasRecentSection && index === 0}
				<div class="px-3 py-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50">
					Recent
				</div>
			{/if}

			{#if isFirstNonRecent}
				<div class="mx-2 my-0.5 border-t border-border/30"></div>
			{/if}

			<CommandPaletteItem
				{item}
				{query}
				{isSelected}
				{isLast}
				{getAgentIconSrc}
				onclick={onSelect}
				onmouseenter={() => onHover(index)}
			/>
		{/each}
	{/if}
</div>
