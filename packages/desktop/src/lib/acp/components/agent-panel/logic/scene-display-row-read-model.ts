import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import {
	appendSceneDisplayRows,
	buildSceneDisplayRows,
	type SceneDisplayRow,
} from "./scene-display-rows.js";
import { isStableSceneEntryAppend } from "./scene-entry-stability.js";

export interface SceneDisplayRowsReadModel {
	applySnapshot(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
	applyAppendPatch(appendedSceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
	selectRows(): readonly SceneDisplayRow[];
	getRows(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
}

export function createSceneDisplayRowsReadModel(): SceneDisplayRowsReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousRows: readonly SceneDisplayRow[] = [];

	return {
		applySnapshot(sceneEntries) {
			if (sceneEntries === previousSceneEntries) {
				return previousRows;
			}

			if (
				previousSceneEntries !== null &&
				isStableSceneEntryAppend(previousSceneEntries, sceneEntries)
			) {
				previousRows = appendSceneDisplayRows(
					previousRows,
					sceneEntries.slice(previousSceneEntries.length)
				);
				previousSceneEntries = sceneEntries;
				return previousRows;
			}

			previousRows = buildSceneDisplayRows(sceneEntries);
			previousSceneEntries = sceneEntries;
			return previousRows;
		},
		applyAppendPatch(appendedSceneEntries) {
			if (appendedSceneEntries.length === 0) {
				return previousRows;
			}

			previousRows = appendSceneDisplayRows(previousRows, appendedSceneEntries);
			previousSceneEntries = (previousSceneEntries ?? []).concat(appendedSceneEntries);
			return previousRows;
		},
		selectRows() {
			return previousRows;
		},
		getRows(sceneEntries) {
			return this.applySnapshot(sceneEntries);
		},
	};
}
