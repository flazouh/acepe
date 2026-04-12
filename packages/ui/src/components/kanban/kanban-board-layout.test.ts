import { describe, expect, it } from "vitest";

import {
	buildKanbanBoardLayout,
	buildKanbanSceneModelFromGroups,
} from "./kanban-board-layout.js";
import type { KanbanSceneCardData, KanbanSceneColumnGroup } from "./kanban-scene-types.js";

function createCard(id: string, title: string): KanbanSceneCardData {
	return {
		id,
		title,
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

describe("kanban-board-layout", () => {
	it("builds a model from grouped compatibility input", () => {
		const groups: readonly KanbanSceneColumnGroup[] = [
			{
				id: "planning",
				label: "Planning",
				items: [createCard("card-2", "Plan"), createCard("card-1", "Scope")],
			},
			{
				id: "idle",
				label: "Idle",
				items: [],
			},
		];

		const sceneModel = buildKanbanSceneModelFromGroups(groups);

		expect(sceneModel.columns).toEqual([
			{ id: "planning", label: "Planning" },
			{ id: "idle", label: "Idle" },
		]);
		expect(sceneModel.cards.map((card) => card.id)).toEqual(["card-2", "card-1"]);
		expect(sceneModel.placements.map((placement) => placement.cardId)).toEqual([
			"card-2",
			"card-1",
		]);
	});

	it("derives stable per-column layout from normalized placements", () => {
		const cardA = createCard("card-a", "Answer");
		const cardB = createCard("card-b", "Build");
		const cardC = createCard("card-c", "Review");

		const layout = buildKanbanBoardLayout({
			columns: [
				{ id: "answer_needed", label: "Input Needed" },
				{ id: "working", label: "Working" },
				{ id: "needs_review", label: "Needs Review" },
			],
			cards: [cardA, cardB, cardC],
			placements: [
				{
					cardId: "card-c",
					columnId: "needs_review",
					index: 0,
					orderKey: "review",
					source: "session",
				},
				{
					cardId: "card-b",
					columnId: "working",
					index: 1,
					orderKey: "z-last",
					source: "session",
				},
				{
					cardId: "card-a",
					columnId: "working",
					index: 0,
					orderKey: "a-first",
					source: "optimistic",
				},
			],
		});

		expect(layout.map((column) => column.columnId)).toEqual([
			"answer_needed",
			"working",
			"needs_review",
		]);
		expect(layout[0]?.cards).toEqual([]);
		expect(layout[1]?.cards.map((entry) => entry.card.id)).toEqual(["card-a", "card-b"]);
		expect(layout[1]?.cards.map((entry) => entry.placement.source)).toEqual([
			"optimistic",
			"session",
		]);
		expect(layout[2]?.cards.map((entry) => entry.card.id)).toEqual(["card-c"]);
	});
});
