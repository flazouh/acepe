<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";

	import type { KanbanSceneCardData, KanbanScenePlacement } from "./kanban-scene-types.js";

	interface Props {
		card: KanbanSceneCardData;
		placement: KanbanScenePlacement;
		renderer: Snippet<[KanbanSceneCardData]>;
		isGhost?: boolean;
		isInert?: boolean;
		registerHost?: (
			card: KanbanSceneCardData,
			node: HTMLDivElement,
			placement: KanbanScenePlacement
		) => (() => void) | void;
	}

	let { card, placement, renderer, isGhost = false, isInert = false, registerHost }: Props = $props();
	let hostElement = $state<HTMLDivElement | null>(null);

	onMount(() => {
		if (!hostElement || !registerHost) {
			return;
		}

		const cleanup = registerHost(card, hostElement, placement);
		return () => {
			if (cleanup) {
				cleanup();
			}
		};
	});
</script>

<div
	bind:this={hostElement}
	class="min-w-0"
	aria-hidden={isGhost ? true : undefined}
	data-card-id={card.id}
	data-column-id={placement.columnId}
	data-placement-index={placement.index}
	data-placement-order={placement.orderKey}
	data-placement-source={placement.source}
	inert={isInert}
>
	{@render renderer(card)}
</div>
