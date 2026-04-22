import type {
	KanbanSceneCardData,
	KanbanSceneColumnData,
	KanbanSceneColumnGroup,
	KanbanSceneModel,
	KanbanScenePlacement,
	KanbanScenePlacementSource,
} from "@acepe/ui";

export interface DesktopKanbanSceneEntry {
	readonly columnId: KanbanSceneColumnData["id"];
	readonly card: KanbanSceneCardData;
	readonly orderKey: string;
	readonly source: KanbanScenePlacementSource;
}

export interface BuildDesktopKanbanSceneOptions {
	readonly columns: readonly KanbanSceneColumnData[];
	readonly entries: readonly DesktopKanbanSceneEntry[];
}

export function buildDesktopKanbanScene(options: BuildDesktopKanbanSceneOptions): KanbanSceneModel {
	const cards: KanbanSceneCardData[] = [];
	const placements: KanbanScenePlacement[] = [];
	const cardIds = new Set<string>();
	const placementIndexes = new Map<KanbanSceneColumnData["id"], number>();

	for (const column of options.columns) {
		placementIndexes.set(column.id, 0);
	}

	for (const entry of options.entries) {
		if (!placementIndexes.has(entry.columnId)) {
			continue;
		}

		if (!cardIds.has(entry.card.id)) {
			cardIds.add(entry.card.id);
			cards.push(entry.card);
		}

		const nextIndex = placementIndexes.get(entry.columnId);
		if (nextIndex === undefined) {
			continue;
		}

		placements.push({
			cardId: entry.card.id,
			columnId: entry.columnId,
			index: nextIndex,
			orderKey: entry.orderKey,
			source: entry.source,
		});
		placementIndexes.set(entry.columnId, nextIndex + 1);
	}

	return {
		columns: options.columns,
		cards,
		placements,
	};
}

export function buildKanbanSceneGroups(scene: KanbanSceneModel): readonly KanbanSceneColumnGroup[] {
	const cardsById = new Map<string, KanbanSceneCardData>();
	for (const card of scene.cards) {
		cardsById.set(card.id, card);
	}

	const placementsByColumn = new Map<KanbanSceneColumnData["id"], KanbanScenePlacement[]>();
	for (const placement of scene.placements) {
		const existing = placementsByColumn.get(placement.columnId);
		if (existing) {
			existing.push(placement);
			continue;
		}
		placementsByColumn.set(placement.columnId, [placement]);
	}

	const groups: KanbanSceneColumnGroup[] = [];
	for (const column of scene.columns) {
		const columnPlacements = placementsByColumn.get(column.id);
		const items: KanbanSceneCardData[] = [];
		if (columnPlacements) {
			for (const placement of columnPlacements) {
				const card = cardsById.get(placement.cardId);
				if (card) {
					items.push(card);
				}
			}
		}
		groups.push({
			id: column.id,
			label: column.label,
			items,
		});
	}

	return groups;
}
