import type {
	KanbanSceneCardData,
	KanbanSceneColumnGroup,
	KanbanSceneModel,
	KanbanScenePlacement,
} from "./kanban-scene-types.js";

export interface KanbanBoardCardPlacement {
	readonly card: KanbanSceneCardData;
	readonly placement: KanbanScenePlacement;
}

export interface KanbanBoardColumnLayout {
	readonly columnId: KanbanSceneColumnGroup["id"];
	readonly label: string;
	readonly cards: readonly KanbanBoardCardPlacement[];
}

function comparePlacements(left: KanbanScenePlacement, right: KanbanScenePlacement): number {
	if (left.columnId < right.columnId) {
		return -1;
	}
	if (left.columnId > right.columnId) {
		return 1;
	}
	if (left.index !== right.index) {
		return left.index - right.index;
	}
	if (left.orderKey < right.orderKey) {
		return -1;
	}
	if (left.orderKey > right.orderKey) {
		return 1;
	}
	if (left.cardId < right.cardId) {
		return -1;
	}
	if (left.cardId > right.cardId) {
		return 1;
	}
	return 0;
}

export function buildKanbanSceneModelFromGroups(
	groups: readonly KanbanSceneColumnGroup[]
): KanbanSceneModel {
	const columns: KanbanSceneModel["columns"] = [];
	const cards: KanbanSceneCardData[] = [];
	const placements: KanbanScenePlacement[] = [];

	for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
		const group = groups[groupIndex];
		columns.push({
			id: group.id,
			label: group.label,
		});

		for (let itemIndex = 0; itemIndex < group.items.length; itemIndex += 1) {
			const item = group.items[itemIndex];
			cards.push(item);
			placements.push({
				cardId: item.id,
				columnId: group.id,
				index: itemIndex,
				orderKey: `${groupIndex}:${itemIndex}:${item.id}`,
				source: "session",
			});
		}
	}

	return {
		columns,
		cards,
		placements,
	};
}

export function buildKanbanBoardLayout(model: KanbanSceneModel): readonly KanbanBoardColumnLayout[] {
	const cardsById = new Map<string, KanbanSceneCardData>();
	for (const card of model.cards) {
		cardsById.set(card.id, card);
	}

	const cardsByColumnId = new Map<KanbanBoardColumnLayout["columnId"], KanbanBoardCardPlacement[]>();
	for (const column of model.columns) {
		cardsByColumnId.set(column.id, []);
	}

	const orderedPlacements = Array.from(model.placements);
	orderedPlacements.sort(comparePlacements);

	for (const placement of orderedPlacements) {
		const card = cardsById.get(placement.cardId);
		if (!card) {
			continue;
		}

		const columnCards = cardsByColumnId.get(placement.columnId);
		if (!columnCards) {
			continue;
		}

		columnCards.push({
			card,
			placement,
		});
	}

	const layout: KanbanBoardColumnLayout[] = [];
	for (const column of model.columns) {
		const columnCards = cardsByColumnId.get(column.id);
		layout.push({
			columnId: column.id,
			label: column.label,
			cards: columnCards ? columnCards : [],
		});
	}

	return layout;
}
