<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";

	import type { KanbanSceneCardData, KanbanScenePlacement } from "./kanban-scene-types.js";
	import type { KanbanBoardColumnLayout } from "./kanban-board-layout.js";
	import {
		buildKanbanBoardMotionPlan,
		upsertKanbanBoardMotionOverlay,
		type KanbanBoardMotionPlan,
		type KanbanBoardMotionOverlay as KanbanBoardMotionOverlayState,
		type KanbanBoardRect,
	} from "./kanban-board-motion.js";

	import KanbanBoardCardHost from "./kanban-board-card-host.svelte";
	import KanbanBoardMotionOverlayLayer from "./kanban-board-motion-overlay.svelte";
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
let overlays = $state<readonly KanbanBoardMotionOverlayState[]>([]);
let reducedMotion = $state(false);

const lastKnownPositions = new Map<string, { placement: KanbanScenePlacement; rect: KanbanBoardRect }>();
const activeHostNodes = new Map<string, HTMLDivElement>();
const overlayTimeouts = new Map<string, number>();
const overlayAnimationFrames = new Map<string, number>();
const deferredMeasurementFrames = new Map<string, number>();
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

function cancelDeferredMeasurement(cardId: string): void {
	const frameId = deferredMeasurementFrames.get(cardId);
	if (frameId !== undefined) {
		window.cancelAnimationFrame(frameId);
		deferredMeasurementFrames.delete(cardId);
	}
}

function cancelAllOverlays(): void {
	for (const cardId of overlayTimeouts.keys()) {
		cancelOverlay(cardId);
	}
}

function seedLastKnownPosition(
	card: KanbanSceneCardData,
	node: HTMLDivElement,
	placement: KanbanScenePlacement
): void {
	const rect = measureHostRect(node);
	if (!rect) {
		return;
	}

	lastKnownPositions.set(card.id, {
		placement,
		rect,
	});
}

function findCardPlacement(cardId: string): { card: KanbanSceneCardData; placement: KanbanScenePlacement } | null {
	for (const column of layout) {
		for (const cardPlacement of column.cards) {
			if (cardPlacement.card.id === cardId) {
				return {
					card: cardPlacement.card,
					placement: cardPlacement.placement,
				};
			}
		}
	}

	return null;
}

function maybeAnimatePlacementChange(
	card: KanbanSceneCardData,
	previousPlacement: KanbanScenePlacement,
	nextPlacement: KanbanScenePlacement,
	currentRect: KanbanBoardRect
): void {
	if (!scrollElement) {
		return;
	}

	const previousPosition = lastKnownPositions.get(card.id);
	if (!previousPosition) {
		return;
	}

	const originViewportRect = measureViewportRect(previousPlacement.columnId);
	const destinationViewportRect = measureViewportRect(nextPlacement.columnId);

	const plan = buildKanbanBoardMotionPlan({
		card,
		previousPlacement,
		nextPlacement,
		originRect: previousPosition.rect,
		destinationRect: currentRect,
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

	if (!plan) {
		return;
	}

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
		cancelDeferredMeasurement(card.id);
		const frameId = window.requestAnimationFrame(() => {
			deferredMeasurementFrames.delete(card.id);
			if (!boardElement || !scrollElement) {
				return;
			}

			activeHostNodes.set(card.id, node);
			seedLastKnownPosition(card, node, placement);
		});
		deferredMeasurementFrames.set(card.id, frameId);

		return () => undefined;
	}

	cancelDeferredMeasurement(card.id);
	activeHostNodes.set(card.id, node);

	const previousPosition = lastKnownPositions.get(card.id);
	const currentRect = measureHostRect(node);

	if (previousPosition && currentRect) {
		maybeAnimatePlacementChange(card, previousPosition.placement, placement, currentRect);
	}

	if (currentRect) {
		lastKnownPositions.set(card.id, {
			placement,
			rect: currentRect,
		});
	}

	return () => {
		cancelDeferredMeasurement(card.id);

		if (activeHostNodes.get(card.id) === node) {
			activeHostNodes.delete(card.id);
		}

		const rect = measureHostRect(node);
		if (rect && !activeHostNodes.has(card.id)) {
			lastKnownPositions.set(card.id, {
				placement,
				rect,
			});
		}
	};
}

function createOverlay(
	plan: KanbanBoardMotionPlan,
	phase: KanbanBoardMotionOverlayState["phase"]
): KanbanBoardMotionOverlayState {
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
	const hostMutationObserver = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type !== "attributes" || mutation.attributeName !== "data-column-id") {
				continue;
			}
			if (!(mutation.target instanceof HTMLDivElement)) {
				continue;
			}

			const cardId = mutation.target.getAttribute("data-card-id");
			if (!cardId || !mutation.oldValue) {
				continue;
			}

			const lookup = findCardPlacement(cardId);
			if (!lookup) {
				continue;
			}

			const currentRect = measureHostRect(mutation.target);
			if (!currentRect) {
				continue;
			}

			const previousPosition = lastKnownPositions.get(cardId);
			const previousPlacement = previousPosition
				? previousPosition.placement
				: {
						cardId,
						columnId: mutation.oldValue,
						index: lookup.placement.index,
						orderKey: lookup.placement.orderKey,
						source: lookup.placement.source,
					};

			maybeAnimatePlacementChange(lookup.card, previousPlacement, lookup.placement, currentRect);
			lastKnownPositions.set(cardId, {
				placement: lookup.placement,
				rect: currentRect,
			});
		}
	});
	const updateReducedMotion = (): void => {
		reducedMotion = mediaQuery.matches;
	};

	updateReducedMotion();
	mediaQuery.addEventListener("change", updateReducedMotion);
	if (boardElement) {
		hostMutationObserver.observe(boardElement, {
			subtree: true,
			attributes: true,
			attributeFilter: ["data-column-id"],
			attributeOldValue: true,
		});
	}

	return () => {
		cancelAllOverlays();
		for (const cardId of deferredMeasurementFrames.keys()) {
			cancelDeferredMeasurement(cardId);
		}
		hostMutationObserver.disconnect();
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
		<KanbanBoardMotionOverlayLayer {overlays} {ghostRenderer} />
	</div>
</div>
