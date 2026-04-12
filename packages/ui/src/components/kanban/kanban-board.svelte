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

<div
	class="flex h-full w-full min-h-0 min-w-0 flex-1 gap-0.5 overflow-x-auto overflow-y-hidden"
	data-testid="kanban-board"
>
	{#each groups as group (group.id)}
		<KanbanColumn {group} {cardRenderer} {emptyHint} />
	{/each}
</div>
