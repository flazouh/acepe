<script lang="ts">
	import type { Snippet } from "svelte";
	import type { KanbanCardData, KanbanColumnGroup } from "./types.js";
	import KanbanColumn from "./kanban-column.svelte";

	interface Props {
		groups: readonly KanbanColumnGroup[];
		cardRenderer: Snippet<[KanbanCardData]>;
		emptyHint?: string;
	}

	let { groups, cardRenderer, emptyHint }: Props = $props();
</script>

<div class="flex h-full gap-2 overflow-x-auto p-2" data-testid="kanban-board">
	{#each groups as group (group.id)}
		<KanbanColumn {group} {cardRenderer} {emptyHint} />
	{/each}
</div>