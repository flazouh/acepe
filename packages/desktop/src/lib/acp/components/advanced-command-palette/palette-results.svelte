<script lang="ts">
import type { PaletteItem } from "../../types/palette-item.js";

import PaletteItemComponent from "./palette-item.svelte";

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
}

let {
	items,
	query = "",
	selectedIndex,
	hasRecentSection,
	recentSectionEndIndex,
	onSelect,
	onHover,
}: Props = $props();
</script>

<div class="max-h-72 overflow-y-auto overflow-hidden rounded-b-lg">
	{#if items.length === 0}
		<div class="px-3 py-6 text-xs text-muted-foreground/60 text-center">No results found</div>
	{:else}
		{#each items as item, index (item.id)}
			{@const isSelected = index === selectedIndex}
			{@const isLast = index === items.length - 1}
			{@const isFirstNonRecent = hasRecentSection && index === recentSectionEndIndex}

			<!-- Recent section header -->
			{#if hasRecentSection && index === 0}
				<div
					class="px-3 py-1 text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider"
				>
					Recent
				</div>
			{/if}

			<!-- Separator between recent and regular results -->
			{#if isFirstNonRecent}
				<div class="border-t border-border/30 mx-2 my-0.5"></div>
			{/if}

			<PaletteItemComponent
				{item}
				{query}
				{isSelected}
				{isLast}
				onclick={onSelect}
				onmouseenter={() => onHover(index)}
			/>
		{/each}
	{/if}
</div>
