<script lang="ts">
	import type { Snippet } from "svelte";
	import { sectionAccentColor } from "../attention-queue/section-color.js";
	import FeedSectionHeader from "../attention-queue/feed-section-header.svelte";
import type { KanbanCardData, KanbanColumnGroup } from "./types.js";

interface Props {
	group: KanbanColumnGroup;
	cardRenderer: Snippet<[KanbanCardData]>;
	emptyHint?: string;
}

let { group, cardRenderer, emptyHint }: Props = $props();
</script>

<div
	class="flex min-h-0 min-w-[200px] flex-1 flex-col overflow-hidden rounded-lg bg-card/50"
	data-testid="kanban-column-{group.id}"
>
	<FeedSectionHeader
		sectionId={group.id}
		label={group.label}
		count={group.items.length}
		color={sectionAccentColor(group.id)}
		needsReviewIcon="file-code"
	/>
	<div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-y-contain p-0.5">
		{#if group.items.length === 0}
			{#if emptyHint}
				<div class="py-4 text-center text-[10px] text-muted-foreground/50">{emptyHint}</div>
			{/if}
		{:else}
			{#each group.items as item (item.id)}
				{@render cardRenderer(item)}
			{/each}
		{/if}
	</div>
</div>
