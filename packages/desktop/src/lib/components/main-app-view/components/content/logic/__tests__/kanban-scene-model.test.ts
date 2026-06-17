import { describe, expect, it } from "bun:test";

import type { KanbanSceneCardData } from "@acepe/ui";

import type { ThreadBoardGroup, ThreadBoardItem } from "$lib/acp/store/thread-board/thread-board-item.js";

import type { OptimisticKanbanCard } from "../kanban-card-model.js";
import {
	buildKanbanSceneColumns,
	buildKanbanSceneModel,
	KANBAN_SECTION_ORDER,
} from "../kanban-scene-model.js";

function makeSceneCard(id: string): KanbanSceneCardData {
	return {
		id,
		title: id,
		agentIconSrc: "/agent.svg",
		agentLabel: "codex",
		isAutoMode: false,
		projectName: "acepe",
		projectColor: "#9858FF",
		projectIconSrc: null,
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
		isWorktreeSession: false,
		worktreeDeleted: false,
		footer: null,
		prFooter: null,
		menuActions: [],
		showCloseAction: true,
		hideBody: false,
		flushFooter: false,
		hideHeaderDiff: false,
	};
}

function makeItem(sessionId: string, lastActivityAt: number): ThreadBoardItem {
	return {
		sessionId,
		lastActivityAt,
	} as ThreadBoardItem;
}

describe("kanban-scene-model", () => {
	it("builds the public kanban columns in product order", () => {
		const columns = buildKanbanSceneColumns();

		expect(columns.map((column) => column.id)).toEqual(Array.from(KANBAN_SECTION_ORDER));
		expect(columns.map((column) => column.label)).toEqual([
			"Input needed",
			"Planning",
			"Needs Review",
			"Done",
		]);
	});

	it("places optimistic cards first in planning, then session cards by board section", () => {
		const optimisticCards: readonly OptimisticKanbanCard[] = [
			{
				panelId: "panel-1",
				projectPath: "/repo",
				card: makeSceneCard("panel-1"),
			},
		];
		const threadBoard: readonly ThreadBoardGroup[] = [
			{
				status: "planning",
				items: [makeItem("session-working", 20)],
			},
			{
				status: "idle",
				items: [makeItem("session-idle", 10)],
			},
		];

		const scene = buildKanbanSceneModel({
			columns: buildKanbanSceneColumns(),
			optimisticCards,
			threadBoard,
			buildOptimisticSceneCard: (optimisticCard) => makeSceneCard(optimisticCard.card.id),
			buildSessionSceneCard: (item) => makeSceneCard(item.sessionId),
		});

		expect(scene.cards.map((card) => card.id)).toEqual([
			"panel-1",
			"session-working",
			"session-idle",
		]);
		expect(scene.placements).toEqual([
			{
				cardId: "panel-1",
				columnId: "planning",
				index: 0,
				orderKey: "optimistic:0:panel-1",
				source: "optimistic",
			},
			{
				cardId: "session-working",
				columnId: "planning",
				index: 1,
				orderKey: "session:planning:20:session-working",
				source: "session",
			},
			{
				cardId: "session-idle",
				columnId: "idle",
				index: 0,
				orderKey: "session:idle:10:session-idle",
				source: "session",
			},
		]);
	});
});
