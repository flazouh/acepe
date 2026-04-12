import type { KanbanSceneCardData, KanbanScenePlacement } from "./kanban-scene-types.js";

export interface KanbanBoardRect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export type KanbanBoardMotionMode = "travel" | "settle";

export interface KanbanBoardMotionPlan {
	readonly cardId: string;
	readonly card: KanbanSceneCardData;
	readonly previousPlacement: KanbanScenePlacement;
	readonly nextPlacement: KanbanScenePlacement;
	readonly originRect: KanbanBoardRect;
	readonly destinationRect: KanbanBoardRect;
	readonly mode: KanbanBoardMotionMode;
	readonly durationMs: number;
}

export interface KanbanBoardMotionOverlay extends KanbanBoardMotionPlan {
	readonly phase: "start" | "end";
}

function clipRectToViewport(rect: KanbanBoardRect, viewport: KanbanBoardRect): KanbanBoardRect | null {
	const left = Math.max(rect.left, viewport.left);
	const top = Math.max(rect.top, viewport.top);
	const right = Math.min(rect.left + rect.width, viewport.left + viewport.width);
	const bottom = Math.min(rect.top + rect.height, viewport.top + viewport.height);

	if (right <= left || bottom <= top) {
		return null;
	}

	return {
		left,
		top,
		width: right - left,
		height: bottom - top,
	};
}

export function buildKanbanBoardMotionPlan(input: {
	card: KanbanSceneCardData;
	previousPlacement: KanbanScenePlacement;
	nextPlacement: KanbanScenePlacement;
	originRect: KanbanBoardRect | null;
	destinationRect: KanbanBoardRect | null;
	originViewportRect: KanbanBoardRect;
	destinationViewportRect: KanbanBoardRect;
	reducedMotion: boolean;
}): KanbanBoardMotionPlan | null {
	const {
		card,
		previousPlacement,
		nextPlacement,
		originRect,
		destinationRect,
		originViewportRect,
		destinationViewportRect,
		reducedMotion,
	} = input;

	if (previousPlacement.columnId === nextPlacement.columnId) {
		return null;
	}
	if (!originRect || !destinationRect) {
		return null;
	}

	const visibleOriginRect = clipRectToViewport(originRect, originViewportRect);
	const visibleDestinationRect = clipRectToViewport(destinationRect, destinationViewportRect);

	if (!visibleOriginRect || !visibleDestinationRect) {
		return null;
	}

	if (reducedMotion) {
		return {
			cardId: card.id,
			card,
			previousPlacement,
			nextPlacement,
			originRect: visibleDestinationRect,
			destinationRect: visibleDestinationRect,
			mode: "settle",
			durationMs: 300,
		};
	}

	if (
		visibleOriginRect.width !== originRect.width ||
		visibleOriginRect.height !== originRect.height ||
		visibleDestinationRect.width !== destinationRect.width ||
		visibleDestinationRect.height !== destinationRect.height
	) {
		return {
			cardId: card.id,
			card,
			previousPlacement,
			nextPlacement,
			originRect: visibleDestinationRect,
			destinationRect: visibleDestinationRect,
			mode: "settle",
			durationMs: 400,
		};
	}

	return {
		cardId: card.id,
		card,
		previousPlacement,
		nextPlacement,
		originRect,
		destinationRect,
		mode: "travel",
		durationMs: 800,
	};
}

export function upsertKanbanBoardMotionOverlay(
	overlays: readonly KanbanBoardMotionOverlay[],
	nextOverlay: KanbanBoardMotionOverlay
): readonly KanbanBoardMotionOverlay[] {
	const remaining = overlays.filter((overlay) => overlay.cardId !== nextOverlay.cardId);
	return remaining.concat(nextOverlay);
}
