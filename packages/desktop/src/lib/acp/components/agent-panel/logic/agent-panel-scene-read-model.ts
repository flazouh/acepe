import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import {
	createGraphSceneEntryIndexReadModel,
	type GraphSceneEntryIndexReadModel,
} from "./graph-scene-entry-match.js";
import {
	createSceneDisplayRowsReadModel,
	type SceneDisplayRowsReadModel,
} from "./scene-display-row-read-model.js";
import type { SceneDisplayRow } from "./scene-display-rows.js";

export type AgentPanelSceneReadModelSnapshot = {
	readonly rows: readonly SceneDisplayRow[];
	readonly entriesById: ReadonlyMap<string, AgentPanelSceneEntryModel>;
};

export interface AgentPanelSceneReadModel {
	applySnapshot(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): AgentPanelSceneReadModelSnapshot;
	applyAppendPatch(
		appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
	): AgentPanelSceneReadModelSnapshot;
	selectSnapshot(): AgentPanelSceneReadModelSnapshot;
}

export function createAgentPanelSceneReadModel(input?: {
	readonly rows?: SceneDisplayRowsReadModel;
	readonly entryIndex?: GraphSceneEntryIndexReadModel;
}): AgentPanelSceneReadModel {
	const rows = input?.rows ?? createSceneDisplayRowsReadModel();
	const entryIndex = input?.entryIndex ?? createGraphSceneEntryIndexReadModel();
	let previousSnapshot: AgentPanelSceneReadModelSnapshot = {
		rows: rows.selectRows(),
		entriesById: entryIndex.selectIndex(),
	};

	return {
		applySnapshot(sceneEntries) {
			rows.applySnapshot(sceneEntries);
			entryIndex.applySnapshot(sceneEntries);
			return this.selectSnapshot();
		},
		applyAppendPatch(appendedSceneEntries) {
			rows.applyAppendPatch(appendedSceneEntries);
			entryIndex.applyAppendPatch(appendedSceneEntries);
			return this.selectSnapshot();
		},
		selectSnapshot() {
			const nextRows = rows.selectRows();
			const nextEntriesById = entryIndex.selectIndex();
			if (
				previousSnapshot.rows === nextRows &&
				previousSnapshot.entriesById === nextEntriesById
			) {
				return previousSnapshot;
			}

			previousSnapshot = {
				rows: nextRows,
				entriesById: nextEntriesById,
			};
			return previousSnapshot;
		},
	};
}
