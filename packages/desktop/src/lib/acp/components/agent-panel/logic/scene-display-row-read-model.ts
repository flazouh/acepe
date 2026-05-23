import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import {
	appendSceneDisplayRows,
	buildSceneDisplayRows,
	getSceneDisplayRowTimestampMs,
	type SceneDisplayRow,
} from "./scene-display-rows.js";
import { isStableSceneEntryAppend } from "./scene-entry-stability.js";

export interface SceneDisplayRowsReadModel {
	applySnapshot(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
	applyAppendPatch(appendedSceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
	selectRows(): readonly SceneDisplayRow[];
	selectLatestTimestampMs(): number | null;
	getRows(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
}

export function createSceneDisplayRowsReadModel(): SceneDisplayRowsReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousRows: readonly SceneDisplayRow[] = [];
	let latestTimestampMs: number | null = null;

	return {
		applySnapshot(sceneEntries) {
			if (sceneEntries === previousSceneEntries) {
				return previousRows;
			}

			if (
				previousSceneEntries !== null &&
				isStableSceneEntryAppend(previousSceneEntries, sceneEntries)
			) {
				const firstChangedRowIndex = Math.max(0, previousRows.length - 1);
				previousRows = appendSceneDisplayRows(
					previousRows,
					sceneEntries.slice(previousSceneEntries.length)
				);
				latestTimestampMs = selectLatestTimestampMsFrom(
					previousRows,
					firstChangedRowIndex,
					latestTimestampMs
				);
				previousSceneEntries = sceneEntries;
				return previousRows;
			}

			previousRows = buildSceneDisplayRows(sceneEntries);
			latestTimestampMs = selectLatestTimestampMsFrom(previousRows, 0);
			previousSceneEntries = sceneEntries;
			return previousRows;
		},
		applyAppendPatch(appendedSceneEntries) {
			if (appendedSceneEntries.length === 0) {
				return previousRows;
			}

			const firstChangedRowIndex = Math.max(0, previousRows.length - 1);
			previousRows = appendSceneDisplayRows(previousRows, appendedSceneEntries);
			latestTimestampMs = selectLatestTimestampMsFrom(
				previousRows,
				firstChangedRowIndex,
				latestTimestampMs
			);
			previousSceneEntries = (previousSceneEntries ?? []).concat(appendedSceneEntries);
			return previousRows;
		},
		selectRows() {
			return previousRows;
		},
		selectLatestTimestampMs() {
			return latestTimestampMs;
		},
		getRows(sceneEntries) {
			return this.applySnapshot(sceneEntries);
		},
	};
}

function selectLatestTimestampMsFrom(
	rows: readonly SceneDisplayRow[],
	startIndex: number,
	knownLatestTimestampMs: number | null = null
): number | null {
	for (let index = rows.length - 1; index >= 0; index -= 1) {
		if (index < startIndex) {
			break;
		}
		const row = rows[index];
		if (row === undefined) {
			continue;
		}
		const timestampMs = getLatestSceneDisplayRowTimestampMs(row);
		if (timestampMs !== null) {
			return timestampMs;
		}
	}

	return knownLatestTimestampMs;
}

function getLatestSceneDisplayRowTimestampMs(row: SceneDisplayRow): number | null {
	if (row.type === "assistant_merged") {
		return row.latestTimestamp?.getTime() ?? row.timestamp?.getTime() ?? null;
	}

	return getSceneDisplayRowTimestampMs(row);
}
