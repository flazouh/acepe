import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import {
	appendSceneDisplayRows,
	buildSceneDisplayRows,
	type SceneDisplayRow,
} from "./scene-display-rows.js";

export interface SceneDisplayRowsReadModel {
	getRows(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
}

export function createSceneDisplayRowsReadModel(): SceneDisplayRowsReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousRows: readonly SceneDisplayRow[] = [];

	return {
		getRows(sceneEntries) {
			if (sceneEntries === previousSceneEntries) {
				return previousRows;
			}

			if (
				previousSceneEntries !== null &&
				isReferenceStableAppend(previousSceneEntries, sceneEntries)
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
	};
}

function isReferenceStableAppend(
	previous: readonly AgentPanelSceneEntryModel[],
	next: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (next.length < previous.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		if (next[index] !== previous[index]) {
			return false;
		}
	}

	return true;
}
