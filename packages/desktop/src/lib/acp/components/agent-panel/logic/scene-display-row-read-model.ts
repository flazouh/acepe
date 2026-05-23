import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import {
	appendSceneDisplayRows,
	appendSceneDisplayRowsFromIndex,
	buildSceneDisplayRows,
	getSceneDisplayRowKey,
	getSceneDisplayRowTimestampMs,
	type SceneDisplayRow,
} from "./scene-display-rows.js";
import { isStableSceneEntryAppend } from "./scene-entry-stability.js";
import { getTokenRevealScenePatch } from "./token-reveal-scene-read-model.js";

export interface SceneDisplayRowsReadModel {
	applySnapshot(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
	applyAppendPatch(
		appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly SceneDisplayRow[];
	selectRows(): readonly SceneDisplayRow[];
	selectLatestTimestampMs(): number | null;
	getRows(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
}

export function createSceneDisplayRowsReadModel(): SceneDisplayRowsReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousRows: readonly SceneDisplayRow[] = [];
	let baseRowsBeforeTokenReveal: readonly SceneDisplayRow[] | null = null;
	let rowIndexBySceneEntryId: Map<string, number> = new Map();
	let latestTimestampMs: number | null = null;

	return {
		applySnapshot(sceneEntries) {
			const tokenRevealPatch = getTokenRevealScenePatch(sceneEntries);
			if (
				tokenRevealPatch !== undefined &&
				tokenRevealPatch.baseSceneEntries === previousSceneEntries
			) {
				const rowIndex = rowIndexBySceneEntryId.get(tokenRevealPatch.entry.id);
				if (rowIndex !== undefined) {
					const patchedRows = buildSceneDisplayRows([tokenRevealPatch.entry]);
					const patchedRow = patchedRows[0];
					if (patchedRow !== undefined) {
						baseRowsBeforeTokenReveal ??= previousRows;
						const nextRows = baseRowsBeforeTokenReveal.slice();
						nextRows[rowIndex] = patchedRow;
						previousRows = nextRows;
						latestTimestampMs = selectLatestTimestampMsFrom(
							previousRows,
							rowIndex,
							latestTimestampMs
						);
						return previousRows;
					}
				}
			}

			if (sceneEntries === previousSceneEntries) {
				if (baseRowsBeforeTokenReveal !== null) {
					previousRows = baseRowsBeforeTokenReveal;
					baseRowsBeforeTokenReveal = null;
				}
				return previousRows;
			}

			baseRowsBeforeTokenReveal = null;
			if (
				previousSceneEntries !== null &&
				isStableSceneEntryAppend(previousSceneEntries, sceneEntries)
			) {
				const firstChangedRowIndex = Math.max(0, previousRows.length - 1);
				previousRows = appendSceneDisplayRowsFromIndex(
					previousRows,
					sceneEntries,
					previousSceneEntries.length
				);
				latestTimestampMs = selectLatestTimestampMsFrom(
					previousRows,
					firstChangedRowIndex,
					latestTimestampMs
				);
				previousSceneEntries = sceneEntries;
				indexRowsBySceneEntryId(rowIndexBySceneEntryId, previousRows, firstChangedRowIndex);
				return previousRows;
			}

			previousRows = buildSceneDisplayRows(sceneEntries);
			latestTimestampMs = selectLatestTimestampMsFrom(previousRows, 0);
			rowIndexBySceneEntryId = buildRowIndexBySceneEntryId(previousRows);
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
			indexRowsBySceneEntryId(rowIndexBySceneEntryId, previousRows, firstChangedRowIndex);
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

function buildRowIndexBySceneEntryId(
	rows: readonly SceneDisplayRow[]
): Map<string, number> {
	const rowIndexBySceneEntryId = new Map<string, number>();
	indexRowsBySceneEntryId(rowIndexBySceneEntryId, rows, 0);
	return rowIndexBySceneEntryId;
}

function indexRowsBySceneEntryId(
	rowIndexBySceneEntryId: Map<string, number>,
	rows: readonly SceneDisplayRow[],
	startIndex: number
): void {
	for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
		const row = rows[rowIndex];
		if (row === undefined || row.type === "thinking" || row.type === "missing") {
			continue;
		}
		if (row.type === "assistant_merged") {
			for (const memberId of row.memberIds) {
				rowIndexBySceneEntryId.set(memberId, rowIndex);
			}
			continue;
		}
		rowIndexBySceneEntryId.set(getSceneDisplayRowKey(row), rowIndex);
	}
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
