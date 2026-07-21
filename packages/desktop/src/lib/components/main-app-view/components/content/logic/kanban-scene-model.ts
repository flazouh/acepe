import type { KanbanSceneCardData, KanbanSceneColumnData, KanbanSceneModel } from "@acepe/ui";

import type {
	ThreadBoardGroup,
	ThreadBoardItem,
} from "$lib/acp/store/thread-board/thread-board-item.js";
import type { ThreadBoardStatus } from "$lib/acp/store/thread-board/thread-board-status.js";

import { buildDesktopKanbanScene, type DesktopKanbanSceneEntry } from "../desktop-kanban-scene.js";
import type { OptimisticKanbanCard } from "./kanban-card-model.js";

export const KANBAN_SECTION_ORDER: readonly ThreadBoardStatus[] = [
	"answer_needed",
	"planning",
	"needs_review",
	"idle",
];

const KANBAN_SECTION_LABELS: Record<ThreadBoardStatus, string> = {
	answer_needed: "Input needed",
	planning: "Planning",
	working: "Planning",
	needs_review: "Needs Review",
	idle: "Done",
	error: "Error",
};

export function buildKanbanSceneColumns(): readonly KanbanSceneColumnData[] {
	return KANBAN_SECTION_ORDER.map((sectionId) => ({
		id: sectionId,
		label: KANBAN_SECTION_LABELS[sectionId],
	}));
}

export interface BuildKanbanSceneModelInput {
	readonly columns: readonly KanbanSceneColumnData[];
	readonly optimisticCards: readonly OptimisticKanbanCard[];
	readonly threadBoard: readonly ThreadBoardGroup[];
	readonly buildOptimisticSceneCard: (card: OptimisticKanbanCard) => KanbanSceneCardData;
	readonly buildSessionSceneCard: (item: ThreadBoardItem) => KanbanSceneCardData;
}

export function buildKanbanSceneModel(input: BuildKanbanSceneModelInput): KanbanSceneModel {
	const entries: DesktopKanbanSceneEntry[] = [];

	for (let index = 0; index < input.optimisticCards.length; index += 1) {
		const optimisticCard = input.optimisticCards[index];
		if (!optimisticCard) {
			continue;
		}
		entries.push({
			columnId: "planning",
			card: input.buildOptimisticSceneCard(optimisticCard),
			orderKey: `optimistic:${index}:${optimisticCard.panelId}`,
			source: "optimistic",
		});
	}

	for (const sectionId of KANBAN_SECTION_ORDER) {
		const boardSections =
			sectionId === "planning"
				? input.threadBoard.filter(
						(group) => group.status === "planning" || group.status === "working"
					)
				: input.threadBoard.filter((group) => group.status === sectionId);

		for (const section of boardSections) {
			for (const item of section.items) {
				entries.push({
					columnId: sectionId,
					card: input.buildSessionSceneCard(item),
					orderKey: `session:${section.status}:${item.lastActivityAt}:${item.sessionId}`,
					source: "session",
				});
			}
		}
	}

	return buildDesktopKanbanScene({
		columns: input.columns,
		entries,
	});
}
