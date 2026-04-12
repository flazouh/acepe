<script lang="ts">
	import type { Snippet } from "svelte";

	import type { KanbanSceneCardData, KanbanScenePlacement } from "./kanban-scene-types.js";

	interface Props {
		card: KanbanSceneCardData;
		placement: KanbanScenePlacement;
		renderer: Snippet<[KanbanSceneCardData]>;
		isGhost?: boolean;
		isInert?: boolean;
		isAnimating?: boolean;
		registerHost?: (
			card: KanbanSceneCardData,
			node: HTMLDivElement,
			placement: KanbanScenePlacement
		) => (() => void) | void;
	}

	let { card, placement, renderer, isGhost = false, isInert = false, isAnimating = false, registerHost }: Props = $props();
	let hostElement = $state<HTMLDivElement | null>(null);

	function buildRegistrationKey(nextPlacement: KanbanScenePlacement): string {
		return `${nextPlacement.columnId}:${nextPlacement.index}:${nextPlacement.orderKey}:${nextPlacement.source}`;
	}

	function registerCardHost(
		node: HTMLDivElement,
		params: {
			card: KanbanSceneCardData;
			placement: KanbanScenePlacement;
			registerHost?: (
				card: KanbanSceneCardData,
				hostNode: HTMLDivElement,
				hostPlacement: KanbanScenePlacement
			) => (() => void) | void;
		}
	): { update: (nextParams: typeof params) => void; destroy: () => void } {
		let registrationKey: string | null = null;
		let cleanup: (() => void) | null = null;

		const sync = (nextParams: typeof params): void => {
			if (!nextParams.registerHost) {
				return;
			}

			const nextKey = buildRegistrationKey(nextParams.placement);
			console.log(`[kanban-motion] host sync card=${nextParams.card.id} key=${nextKey} prevKey=${registrationKey}`);
			if (registrationKey === nextKey) {
				return;
			}

			cleanup = nextParams.registerHost(nextParams.card, node, nextParams.placement) ?? cleanup;
			registrationKey = nextKey;
		};

		sync(params);

		return {
			update(nextParams) {
				console.log(`[kanban-motion] host action UPDATE card=${nextParams.card.id} col=${nextParams.placement.columnId}`);
				sync(nextParams);
			},
			destroy() {
				cleanup?.();
				cleanup = null;
				registrationKey = null;
			},
		}
	}
</script>

<div
	bind:this={hostElement}
	use:registerCardHost={{ card, placement, registerHost }}
	class="min-w-0"
	class:invisible={isAnimating}
	aria-hidden={isGhost || isAnimating ? true : undefined}
	data-card-id={card.id}
	data-column-id={placement.columnId}
	data-placement-index={placement.index}
	data-placement-order={placement.orderKey}
	data-placement-source={placement.source}
	inert={isInert}
>
	{@render renderer(card)}
</div>
