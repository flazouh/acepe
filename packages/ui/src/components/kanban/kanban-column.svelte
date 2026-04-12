<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import { sectionAccentColor } from "../attention-queue/section-color.js";
	import FeedSectionHeader from "../attention-queue/feed-section-header.svelte";
	import type { KanbanBoardColumnLayout } from "./kanban-board-layout.js";

interface Props {
	column: KanbanBoardColumnLayout;
	emptyHint?: string;
	content?: Snippet;
	onScroll?: () => void;
	registerScrollContainer?: (
		columnId: KanbanBoardColumnLayout["columnId"],
		node: HTMLDivElement
	) => (() => void) | void;
}

let { column, emptyHint, content, onScroll, registerScrollContainer }: Props = $props();
let scrollContainer = $state<HTMLDivElement | null>(null);

onMount(() => {
	if (!scrollContainer || !registerScrollContainer) {
		return;
	}

	const cleanup = registerScrollContainer(column.columnId, scrollContainer);
	return () => {
		if (cleanup) {
			cleanup();
		}
	};
});
</script>

<div
	class="flex min-h-0 min-w-[200px] flex-1 flex-col overflow-hidden rounded-lg bg-card/50"
	data-testid="kanban-column-{column.columnId}"
>
	<FeedSectionHeader
		sectionId={column.columnId}
		label={column.label}
		count={column.cards.length}
		color={sectionAccentColor(column.columnId)}
		needsReviewIcon="file-code"
	/>
	<div
		bind:this={scrollContainer}
		class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-y-contain p-0.5"
		data-kanban-column-scroll={column.columnId}
		onscroll={onScroll}
	>
		{#if column.cards.length === 0}
			{#if emptyHint}
				<div class="py-4 text-center text-[10px] text-muted-foreground/50">{emptyHint}</div>
			{/if}
		{/if}
		{#if content}
			{@render content()}
		{/if}
	</div>
</div>
