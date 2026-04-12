import { describe, expect, it } from "vitest";

import {
	buildKanbanBoardMotionPlan,
	upsertKanbanBoardMotionOverlay,
	type KanbanBoardMotionOverlay,
} from "../kanban-board-motion.js";
import type { KanbanSceneCardData, KanbanScenePlacement } from "../kanban-scene-types.js";

function createCard(id: string): KanbanSceneCardData {
	return {
		id,
		title: id,
		agentIconSrc: "/agent.svg",
		agentLabel: "Agent",
		isAutoMode: false,
		projectName: "acepe",
		projectColor: "#000000",
		activityText: null,
		isStreaming: false,
		modeId: null,
		diffInsertions: 0,
		diffDeletions: 0,
		errorText: null,
		todoProgress: null,
		taskCard: null,
		latestTool: null,
		hasUnseenCompletion: false,
		sequenceId: null,
		footer: null,
		menuActions: [],
		showCloseAction: false,
		hideBody: false,
		flushFooter: false,
	};
}

function createPlacement(cardId: string, columnId: KanbanScenePlacement["columnId"]): KanbanScenePlacement {
	return {
		cardId,
		columnId,
		index: 0,
		orderKey: `${columnId}:${cardId}`,
		source: "session",
	};
}

describe("kanban-board-motion", () => {
	it("builds a travel animation for visible cross-column moves", () => {
		const plan = buildKanbanBoardMotionPlan({
			card: createCard("card-1"),
			previousPlacement: createPlacement("card-1", "working"),
			nextPlacement: createPlacement("card-1", "needs_review"),
			originRect: { left: 10, top: 20, width: 180, height: 96 },
			destinationRect: { left: 240, top: 24, width: 180, height: 96 },
			originViewportRect: { left: 0, top: 0, width: 600, height: 400 },
			destinationViewportRect: { left: 0, top: 0, width: 600, height: 400 },
			reducedMotion: false,
		});

		expect(plan?.mode).toBe("travel");
		expect(plan?.cardId).toBe("card-1");
	});

	it("ignores same-column reorders", () => {
		const plan = buildKanbanBoardMotionPlan({
			card: createCard("card-1"),
			previousPlacement: createPlacement("card-1", "working"),
			nextPlacement: {
				cardId: "card-1",
				columnId: "working",
				index: 1,
				orderKey: "working:card-1:1",
				source: "session",
			},
			originRect: { left: 10, top: 20, width: 180, height: 96 },
			destinationRect: { left: 10, top: 120, width: 180, height: 96 },
			originViewportRect: { left: 0, top: 0, width: 600, height: 400 },
			destinationViewportRect: { left: 0, top: 0, width: 600, height: 400 },
			reducedMotion: false,
		});

		expect(plan).toBeNull();
	});

	it("falls back to settle for reduced motion", () => {
		const plan = buildKanbanBoardMotionPlan({
			card: createCard("card-1"),
			previousPlacement: createPlacement("card-1", "working"),
			nextPlacement: createPlacement("card-1", "needs_review"),
			originRect: { left: 10, top: 20, width: 180, height: 96 },
			destinationRect: { left: 240, top: 24, width: 180, height: 96 },
			originViewportRect: { left: 0, top: 0, width: 600, height: 400 },
			destinationViewportRect: { left: 0, top: 0, width: 600, height: 400 },
			reducedMotion: true,
		});

		expect(plan?.mode).toBe("settle");
		expect(plan?.originRect).toEqual(plan?.destinationRect);
	});

	it("falls back to settle for clipped geometry", () => {
		const plan = buildKanbanBoardMotionPlan({
			card: createCard("card-1"),
			previousPlacement: createPlacement("card-1", "working"),
			nextPlacement: createPlacement("card-1", "needs_review"),
			originRect: { left: -40, top: 20, width: 180, height: 96 },
			destinationRect: { left: 240, top: 24, width: 180, height: 96 },
			originViewportRect: { left: 0, top: 0, width: 600, height: 400 },
			destinationViewportRect: { left: 0, top: 0, width: 600, height: 400 },
			reducedMotion: false,
		});

		expect(plan?.mode).toBe("settle");
	});

	it("replaces prior overlays for the same card instead of stacking them", () => {
		const firstOverlay: KanbanBoardMotionOverlay = {
			cardId: "card-1",
			card: createCard("card-1"),
			previousPlacement: createPlacement("card-1", "working"),
			nextPlacement: createPlacement("card-1", "needs_review"),
			originRect: { left: 10, top: 20, width: 180, height: 96 },
			destinationRect: { left: 240, top: 24, width: 180, height: 96 },
			mode: "travel",
			durationMs: 800,
			phase: "start",
		};

		const nextOverlay: KanbanBoardMotionOverlay = {
			cardId: "card-1",
			card: createCard("card-1"),
			previousPlacement: createPlacement("card-1", "needs_review"),
			nextPlacement: createPlacement("card-1", "idle"),
			originRect: { left: 240, top: 24, width: 180, height: 96 },
			destinationRect: { left: 480, top: 24, width: 180, height: 96 },
			mode: "travel",
			durationMs: 800,
			phase: "start",
		};

		const overlays = upsertKanbanBoardMotionOverlay([firstOverlay], nextOverlay);

		expect(overlays).toHaveLength(1);
		expect(overlays[0]?.nextPlacement.columnId).toBe("idle");
	});
});
