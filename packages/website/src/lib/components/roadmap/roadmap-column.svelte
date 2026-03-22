<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { RoadmapColumn as RoadmapColumnType } from './roadmap-state.svelte.js';
	import RoadmapCard from './roadmap-card.svelte';

	interface Props {
		title: string;
		column: RoadmapColumnType;
		isAuthenticated: boolean;
		onVote: (cardId: string, voteType: 'up' | 'down') => void;
	}

	let { title, column, isAuthenticated, onVote }: Props = $props();
</script>

<section class="flex flex-col h-full snap-center shrink-0 w-[280px] min-w-[280px] lg:w-auto lg:min-w-0 lg:shrink">
	<!-- Column header -->
	<div class="shrink-0 flex items-center justify-between pb-3 border-b border-border mb-3">
		<h2 class="text-sm font-semibold text-card-foreground">{title}</h2>
		<span class="text-[10px] font-mono text-muted-foreground tabular-nums">
			{m.roadmap_item_count({ count: column.totalCount })}
		</span>
	</div>

	<!-- Card list -->
	<div class="flex-1 min-h-0 overflow-y-auto space-y-2">
		{#if column.items.length === 0}
			<p class="text-sm text-muted-foreground/50 text-center py-8 italic">
				{m.roadmap_empty_column()}
			</p>
		{:else}
			{#each column.items as card (card.id)}
				<RoadmapCard {card} {isAuthenticated} {onVote} />
			{/each}
		{/if}
	</div>
</section>
