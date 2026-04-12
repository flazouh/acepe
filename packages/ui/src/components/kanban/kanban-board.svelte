<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";

	import type { KanbanSceneCardData, KanbanScenePlacement } from "./kanban-scene-types.js";
	import type { KanbanBoardColumnLayout } from "./kanban-board-layout.js";
	import {
		buildKanbanBoardMotionPlan,
		upsertKanbanBoardMotionOverlay,
		type KanbanBoardMotionPlan,
		type KanbanBoardMotionOverlay,
		type KanbanBoardRect,
	} from "./kanban-board-motion.js";

	import KanbanBoardCardHost from "./kanban-board-card-host.svelte";
	import KanbanBoardMotionOverlay from "./kanban-board-motion-overlay.svelte";
	import KanbanColumn from "./kanban-column.svelte";

interface Props {
	layout: readonly KanbanBoardColumnLayout[];
	cardRenderer: Snippet<[KanbanSceneCardData]>;
	emptyHint?: string;
	ghostRenderer?: Snippet<[KanbanSceneCardData]>;
}

let { layout, cardRenderer, emptyHint, ghostRenderer }: Props = $props();

let scrollElement = $state<HTMLDivElement | null>(null);
let boardElement = $state<HTMLDivElement | null>(null);
let overlays = $state<readonly KanbanBoardMotionOverlay[]>([]);
let reducedMotion = $state(false);

const pendingOrigins = new Map<string, { placement: KanbanScenePlacement; rect: KanbanBoardRect }>();
const overlayTimeouts = new Map<string, number>();
const overlayAnimationFrames = new Map<string, number>();
const columnScrollElements = new Map<KanbanBoardColumnLayout["columnId"], HTMLDivElement>();

function measureHostRect(node: HTMLDivElement): KanbanBoardRect | null {
	if (!boardElement || !scrollElement) {
		return null;
	}

	const boardRect = boardElement.getBoundingClientRect();
	const nodeRect = node.getBoundingClientRect();
	return {
		left: nodeRect.left - boardRect.left + scrollElement.scrollLeft,
		top: nodeRect.top - boardRect.top + scrollElement.scrollTop,
		width: nodeRect.width,
		height: nodeRect.height,
	};
}

function cancelOverlay(cardId: string): void {
	const timeoutId = overlayTimeouts.get(cardId);
	if (timeoutId !== undefined) {
		window.clearTimeout(timeoutId);
		overlayTimeouts.delete(cardId);
	}
	const animationFrameId = overlayAnimationFrames.get(cardId);
	if (animationFrameId !== undefined) {
		window.cancelAnimationFrame(animationFrameId);
		overlayAnimationFrames.delete(cardId);
	}

	overlays = overlays.filter((overlay) => overlay.cardId !== cardId);
}

function cancelAllOverlays(): void {
	for (const cardId of overlayTimeouts.keys()) {
		cancelOverlay(cardId);
	}
}

function intersectRects(left: KanbanBoardRect, right: KanbanBoardRect): KanbanBoardRect | null {
	const intersectionLeft = Math.max(left.left, right.left);
	const intersectionTop = Math.max(left.top, right.top);
	const intersectionRight = Math.min(left.left + left.width, right.left + right.width);
	const intersectionBottom = Math.min(left.top + left.height, right.top + right.height);

	if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) {
		return null;
	}

	return {
		left: intersectionLeft,
		top: intersectionTop,
		width: intersectionRight - intersectionLeft,
		height: intersectionBottom - intersectionTop,
	};
}

function measureElementRect(node: HTMLDivElement): KanbanBoardRect | null {
	if (!boardElement || !scrollElement) {
		return null;
	}

	const boardRect = boardElement.getBoundingClientRect();
	const nodeRect = node.getBoundingClientRect();
	return {
		left: nodeRect.left - boardRect.left + scrollElement.scrollLeft,
		top: nodeRect.top - boardRect.top + scrollElement.scrollTop,
		width: nodeRect.width,
		height: nodeRect.height,
	};
}

function measureViewportRect(columnId: KanbanScenePlacement["columnId"]): KanbanBoardRect | null {
	if (!scrollElement) {
		return null;
	}

	const boardViewportRect = {
		left: scrollElement.scrollLeft,
		top: scrollElement.scrollTop,
		width: scrollElement.clientWidth,
		height: scrollElement.clientHeight,
	};
	const columnScrollElement = columnScrollElements.get(columnId);
	if (!columnScrollElement) {
		return boardViewportRect;
	}

	const columnViewportRect = measureElementRect(columnScrollElement);
	if (!columnViewportRect) {
		return boardViewportRect;
	}

	const clippedViewport = intersectRects(boardViewportRect, columnViewportRect);
	return clippedViewport ? clippedViewport : boardViewportRect;
}

function registerHost(
	card: KanbanSceneCardData,
	node: HTMLDivElement,
	placement: KanbanScenePlacement
): () => void {
	if (!boardElement || !scrollElement) {
		return () => undefined;
	}

	const pendingOrigin = pendingOrigins.get(card.id);

	if (pendingOrigin) {
		const destinationRect = measureHostRect(node);
		const originViewportRect = measureViewportRect(pendingOrigin.placement.columnId);
		const destinationViewportRect = measureViewportRect(placement.columnId);

		const plan = buildKanbanBoardMotionPlan({
			card,
			previousPlacement: pendingOrigin.placement,
			nextPlacement: placement,
			originRect: pendingOrigin.rect,
			destinationRect,
			originViewportRect: originViewportRect
				? originViewportRect
				: {
						left: scrollElement.scrollLeft,
						top: scrollElement.scrollTop,
						width: scrollElement.clientWidth,
						height: scrollElement.clientHeight,
					},
			destinationViewportRect: destinationViewportRect
				? destinationViewportRect
				: {
						left: scrollElement.scrollLeft,
						top: scrollElement.scrollTop,
						width: scrollElement.clientWidth,
						height: scrollElement.clientHeight,
					},
			reducedMotion,
		});

		pendingOrigins.delete(card.id);

		if (plan) {
			cancelOverlay(card.id);
			overlays = upsertKanbanBoardMotionOverlay(overlays, createOverlay(plan, "start"));
			const timeoutId = window.setTimeout(() => {
				cancelOverlay(card.id);
			}, plan.durationMs + 40);
			overlayTimeouts.set(card.id, timeoutId);
			const animationFrameId = window.requestAnimationFrame(() => {
				overlayAnimationFrames.delete(card.id);
				if (!overlayTimeouts.has(card.id)) {
					return;
				}
				overlays = upsertKanbanBoardMotionOverlay(overlays, createOverlay(plan, "end"));
			});
			overlayAnimationFrames.set(card.id, animationFrameId);
		}
	}

	return () => {
		const rect = measureHostRect(node);
		if (rect) {
			pendingOrigins.set(card.id, {
				placement,
				rect,
			});
		}
	};
}

function createOverlay(
	plan: KanbanBoardMotionPlan,
	phase: KanbanBoardMotionOverlay["phase"]
): KanbanBoardMotionOverlay {
	return {
		cardId: plan.cardId,
		card: plan.card,
		previousPlacement: plan.previousPlacement,
		nextPlacement: plan.nextPlacement,
		originRect: plan.originRect,
		destinationRect: plan.destinationRect,
		mode: plan.mode,
		durationMs: plan.durationMs,
		phase,
	};
}

function registerScrollContainer(
	columnId: KanbanBoardColumnLayout["columnId"],
	node: HTMLDivElement
): () => void {
	columnScrollElements.set(columnId, node);
	return () => {
		columnScrollElements.delete(columnId);
	};
}

onMount(() => {
	if (typeof window === "undefined") {
		return;
	}

	const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
	const updateReducedMotion = (): void => {
		reducedMotion = mediaQuery.matches;
	};

	updateReducedMotion();
	mediaQuery.addEventListener("change", updateReducedMotion);

	return () => {
		cancelAllOverlays();
		mediaQuery.removeEventListener("change", updateReducedMotion);
	};
});
</script>

<div
	bind:this={scrollElement}
	class="h-full w-full min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
	data-testid="kanban-board"
	onscroll={cancelAllOverlays}
>
	<div
		bind:this={boardElement}
		class="relative flex h-full min-h-0 min-w-max gap-0.5 p-0.5"
	>
		{#each layout as column (column.columnId)}
			<KanbanColumn
				{column}
				{emptyHint}
				onScroll={cancelAllOverlays}
				registerScrollContainer={registerScrollContainer}
			>
				{#snippet content()}
					{#each column.cards as cardPlacement (cardPlacement.placement.cardId)}
						<KanbanBoardCardHost
							card={cardPlacement.card}
							placement={cardPlacement.placement}
							registerHost={registerHost}
							renderer={cardRenderer}
						/>
					{/each}
				{/snippet}
			</KanbanColumn>
		{/each}
		<KanbanBoardMotionOverlay {overlays} {ghostRenderer} />
	</div>
</div>
