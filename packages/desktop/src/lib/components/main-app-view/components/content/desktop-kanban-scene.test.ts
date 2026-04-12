import { describe, expect, it } from "bun:test";

import type {
	KanbanSceneCardData,
	KanbanSceneColumnData,
	KanbanSceneFooterData,
	KanbanSceneMenuAction,
} from "@acepe/ui";

import {
	buildDesktopKanbanScene,
	buildKanbanSceneGroups,
	type DesktopKanbanSceneEntry,
} from "./desktop-kanban-scene.js";

function makeCard(id: string, title: string): KanbanSceneCardData {
	const menuActions: readonly KanbanSceneMenuAction[] = [];
	const footer: KanbanSceneFooterData | null = null;

	return {
		id,
		title,
		agentIconSrc: "/agent.svg",
		agentLabel: "Agent",
		isAutoMode: false,
		projectName: "acepe",
		projectColor: "#9858FF",
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
		footer,
		menuActions,
		showCloseAction: false,
		hideBody: false,
		flushFooter: false,
	};
}

describe("buildDesktopKanbanScene", () => {
	const columns: readonly KanbanSceneColumnData[] = [
		{ id: "answer_needed", label: "Answer Needed" },
		{ id: "planning", label: "Planning" },
		{ id: "working", label: "Working" },
		{ id: "needs_review", label: "Finished" },
		{ id: "idle", label: "Idle" },
		{ id: "error", label: "Error" },
	];

	it("builds a normalized scene with stable placements and empty columns", () => {
		const optimisticCard = makeCard("panel-1", "Starting thread");
		const sessionCard = makeCard("session-1", "Build motion layer");
		const idleCard = makeCard("session-2", "Review docs");

		const entries: readonly DesktopKanbanSceneEntry[] = [
			{
				columnId: "working",
				card: optimisticCard,
				orderKey: "optimistic:0:panel-1",
				source: "optimistic",
			},
			{
				columnId: "working",
				card: sessionCard,
				orderKey: "session:working:1000:session-1",
				source: "session",
			},
			{
				columnId: "idle",
				card: idleCard,
				orderKey: "session:idle:900:session-2",
				source: "session",
			},
		];

		const scene = buildDesktopKanbanScene({
			columns,
			entries,
		});

		expect(scene.columns).toEqual(columns);
		expect(scene.cards.map((card) => card.id)).toEqual(["panel-1", "session-1", "session-2"]);
		expect(scene.placements).toEqual([
			{
				cardId: "panel-1",
				columnId: "working",
				index: 0,
				orderKey: "optimistic:0:panel-1",
				source: "optimistic",
			},
			{
				cardId: "session-1",
				columnId: "working",
				index: 1,
				orderKey: "session:working:1000:session-1",
				source: "session",
			},
			{
				cardId: "session-2",
				columnId: "idle",
				index: 0,
				orderKey: "session:idle:900:session-2",
				source: "session",
			},
		]);
		expect(scene.columns[0]?.id).toBe("answer_needed");
		expect(scene.columns[5]?.id).toBe("error");
	});

	it("builds compatibility groups from the normalized scene", () => {
		const scene = buildDesktopKanbanScene({
			columns,
			entries: [
				{
					columnId: "working",
					card: makeCard("panel-1", "Starting thread"),
					orderKey: "optimistic:0:panel-1",
					source: "optimistic",
				},
				{
					columnId: "working",
					card: makeCard("session-1", "Build motion layer"),
					orderKey: "session:working:1000:session-1",
					source: "session",
				},
			],
		});

		const groups = buildKanbanSceneGroups(scene);

		expect(groups.map((group) => group.id)).toEqual([
			"answer_needed",
			"planning",
			"working",
			"needs_review",
			"idle",
			"error",
		]);
		expect(groups.find((group) => group.id === "working")?.items.map((card) => card.id)).toEqual([
			"panel-1",
			"session-1",
		]);
		expect(groups.find((group) => group.id === "planning")?.items).toEqual([]);
	});
});
