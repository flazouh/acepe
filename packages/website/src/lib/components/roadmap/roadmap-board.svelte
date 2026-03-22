<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import type { RoadmapState } from './roadmap-state.svelte.js';
	import RoadmapColumn from './roadmap-column.svelte';

	interface Props {
		state: RoadmapState;
	}

	let { state }: Props = $props();

	const COLUMNS = [
		{ key: 'open', label: () => m.roadmap_column_open() },
		{ key: 'planned', label: () => m.roadmap_column_planned() },
		{ key: 'in_progress', label: () => m.roadmap_column_in_progress() },
		{ key: 'completed', label: () => m.roadmap_column_completed() }
	] as const;

	function handleVote(cardId: string, voteType: 'up' | 'down') {
		if (!state.isAuthenticated) return;
		state.castVote(cardId, voteType);
	}
</script>

<div
	class="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth overscroll-x-contain px-4 [scroll-padding-inline:1rem]
		lg:grid lg:grid-cols-4 lg:overflow-x-visible lg:snap-none lg:px-0"
	role="region"
	aria-label="Roadmap board"
>
	{#each COLUMNS as col (col.key)}
		{@const column = state.columns[col.key]}
		{#if column}
			<RoadmapColumn
				title={col.label()}
				{column}
				isAuthenticated={state.isAuthenticated}
				onVote={handleVote}
			/>
		{/if}
	{/each}
</div>
