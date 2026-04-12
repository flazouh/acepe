import { describe, expect, it } from "bun:test";

import type {
	KanbanSceneCardData,
	KanbanSceneColumnData,
	KanbanSceneFooterData,
	KanbanSceneMenuAction,
} from "@acepe/ui";

import { buildDesktopKanbanScene, buildKanbanSceneGroups } from "./desktop-kanban-scene.js";

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

describe("kanban view scene contract", () => {
	const columns: readonly KanbanSceneColumnData[] = [
		{ id: "answer_needed", label: "Answer Needed" },
		{ id: "planning", label: "Planning" },
		{ id: "working", label: "Working" },
		{ id: "needs_review", label: "Finished" },
		{ id: "idle", label: "Idle" },
		{ id: "error", label: "Error" },
	];

	it("retains the fixed board order even when most columns are empty", () => {
		const scene = buildDesktopKanbanScene({
			columns,
			entries: [
				{
					columnId: "working",
					card: makeCard("session-1", "Build motion layer"),
					orderKey: "session:working:1000:session-1",
					source: "session",
				},
			],
		});

		expect(scene.columns.map((column) => column.id)).toEqual([
			"answer_needed",
			"planning",
			"working",
			"needs_review",
			"idle",
			"error",
		]);
		expect(buildKanbanSceneGroups(scene).find((group) => group.id === "planning")?.items).toEqual([]);
	});

	it("keeps optimistic cards ahead of live session cards in the same column", () => {
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

		expect(scene.placements.map((placement) => placement.cardId)).toEqual(["panel-1", "session-1"]);
		expect(buildKanbanSceneGroups(scene).find((group) => group.id === "working")?.items.map((card) => card.id)).toEqual([
			"panel-1",
			"session-1",
		]);
	});
});
