import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import {
	appendSceneDisplayRows,
	appendSceneDisplayRowsFromIndex,
	buildSceneDisplayRows,
	getSceneDisplayRowKey,
	getSceneDisplayRowTimestampMs,
	type SceneDisplayRow,
} from "./scene-display-rows.js";
import {
	findStableSceneEntryInsertion,
	isStableSceneEntryAppend,
	isStableSceneEntryTruncation,
} from "./scene-entry-stability.js";
import {
	getAgentPanelSceneEntryArrayAppendPatch,
	getAgentPanelSceneEntryArrayPatch,
	getAgentPanelSceneEntryArraySplicePatch,
	getAgentPanelSceneEntryArrayTruncation,
} from "../../../session-state/agent-panel-scene-entry-array-patch.js";
import { createAppendedSceneEntriesArray } from "./scene-entry-array-view.js";
import { getAgentPanelDisplayScenePatch } from "./agent-panel-display-model.js";
import { getTokenRevealScenePatch } from "./token-reveal-scene-read-model.js";

export interface SceneDisplayRowsReadModel {
	applySnapshot(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[];
	applyAppendPatch(
		appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly SceneDisplayRow[];
	applyPatch(sceneEntries: readonly AgentPanelSceneEntryModel[]): readonly SceneDisplayRow[] | null;
	selectRows(): readonly SceneDisplayRow[];
	selectLatestTimestampMs(): number | null;
}

export type SceneDisplayRowArrayPatch = {
	readonly baseRows: readonly SceneDisplayRow[];
	readonly patchedRowsByIndex: ReadonlyMap<number, SceneDisplayRow>;
};

export type SceneDisplayRowArrayAppend = {
	readonly baseRows: readonly SceneDisplayRow[];
	readonly appendedRows: readonly SceneDisplayRow[];
};

export type SceneDisplayRowArrayTruncation = {
	readonly baseRows: readonly SceneDisplayRow[];
	readonly length: number;
};

export type SceneDisplayRowArrayInsertion = {
	readonly baseRows: readonly SceneDisplayRow[];
	readonly insertedRows: readonly SceneDisplayRow[];
	readonly insertIndex: number;
};

const sceneDisplayRowArrayPatches = new WeakMap<
	readonly SceneDisplayRow[],
	SceneDisplayRowArrayPatch
>();
const sceneDisplayRowArrayAppends = new WeakMap<
	readonly SceneDisplayRow[],
	SceneDisplayRowArrayAppend
>();
const sceneDisplayRowArrayTruncations = new WeakMap<
	readonly SceneDisplayRow[],
	SceneDisplayRowArrayTruncation
>();
const sceneDisplayRowArrayInsertions = new WeakMap<
	readonly SceneDisplayRow[],
	SceneDisplayRowArrayInsertion
>();

export function getSceneDisplayRowArrayPatch(
	rows: readonly SceneDisplayRow[]
): SceneDisplayRowArrayPatch | undefined {
	return sceneDisplayRowArrayPatches.get(rows);
}

export function getSceneDisplayRowArrayAppend(
	rows: readonly SceneDisplayRow[]
): SceneDisplayRowArrayAppend | undefined {
	return sceneDisplayRowArrayAppends.get(rows);
}

export function getSceneDisplayRowArrayTruncation(
	rows: readonly SceneDisplayRow[]
): SceneDisplayRowArrayTruncation | undefined {
	return sceneDisplayRowArrayTruncations.get(rows);
}

export function getSceneDisplayRowArrayInsertion(
	rows: readonly SceneDisplayRow[]
): SceneDisplayRowArrayInsertion | undefined {
	return sceneDisplayRowArrayInsertions.get(rows);
}

export function createSceneDisplayRowsReadModel(): SceneDisplayRowsReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let previousRows: readonly SceneDisplayRow[] = [];
	let baseRowsBeforeTokenReveal: readonly SceneDisplayRow[] | null = null;
	let rowIndexBySceneEntryId: Map<string, number> = new Map();
	let latestTimestampMs: number | null = null;

	function applyGraphScenePatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly SceneDisplayRow[] | null {
		const graphScenePatch = getAgentPanelSceneEntryArrayPatch(sceneEntries);
		if (
			graphScenePatch === undefined ||
			graphScenePatch.baseSceneEntries !== previousSceneEntries
		) {
			return null;
		}
		baseRowsBeforeTokenReveal = null;
		const patchedRows = patchDisplaySceneDisplayRows(
			previousRows,
			rowIndexBySceneEntryId,
			graphScenePatch.entriesByIndex.values()
		);
		if (patchedRows === null) {
			return null;
		}
		previousRows = patchedRows.rows;
		latestTimestampMs = selectLatestTimestampMsFrom(
			previousRows,
			patchedRows.firstChangedRowIndex,
			latestTimestampMs
		);
		previousSceneEntries = sceneEntries;
		return previousRows;
	}

	function applyGraphSceneAppendPatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly SceneDisplayRow[] | null {
		const appendPatch = getAgentPanelSceneEntryArrayAppendPatch(sceneEntries);
		if (
			appendPatch === undefined ||
			appendPatch.baseSceneEntries !== previousSceneEntries
		) {
			return null;
		}
		if (appendPatch.appendedEntries.length === 0) {
			previousSceneEntries = sceneEntries;
			return previousRows;
		}

		const baseRows = previousRows;
		const firstChangedRowIndex = Math.max(0, baseRows.length - 1);
		previousRows = appendSceneDisplayRows(baseRows, appendPatch.appendedEntries);
		markSceneDisplayRowAppend(previousRows, baseRows);
		latestTimestampMs = selectLatestTimestampMsFrom(
			previousRows,
			firstChangedRowIndex,
			latestTimestampMs
		);
		previousSceneEntries = sceneEntries;
		indexRowsBySceneEntryId(rowIndexBySceneEntryId, previousRows, firstChangedRowIndex);
		return previousRows;
	}

	function applyGraphSceneTruncation(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly SceneDisplayRow[] | null {
		const truncation = getAgentPanelSceneEntryArrayTruncation(sceneEntries);
		if (
			truncation === undefined ||
			truncation.baseSceneEntries !== previousSceneEntries ||
			truncation.length !== sceneEntries.length
		) {
			return null;
		}
		baseRowsBeforeTokenReveal = null;
		const truncatedRows = truncateStableSceneDisplayRows(
			truncation.baseSceneEntries,
			sceneEntries,
			previousRows,
			rowIndexBySceneEntryId
		);
		if (truncatedRows === null) {
			return null;
		}
		previousRows = truncatedRows;
		latestTimestampMs = selectLatestTimestampMsFrom(previousRows, 0);
		previousSceneEntries = sceneEntries;
		return previousRows;
	}

	function applyGraphSceneSplice(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly SceneDisplayRow[] | null {
		const splicePatch = getAgentPanelSceneEntryArraySplicePatch(sceneEntries);
		if (
			splicePatch === undefined ||
			splicePatch.baseSceneEntries !== previousSceneEntries ||
			splicePatch.startIndex < 0 ||
			splicePatch.startIndex > splicePatch.baseSceneEntries.length ||
			sceneEntries.length !==
				splicePatch.startIndex +
					splicePatch.insertedEntries.length +
					splicePatch.trailingEntries.length
		) {
			return null;
		}
		baseRowsBeforeTokenReveal = null;
		const firstChangedRowIndex = findFirstSpliceRowIndex(
			splicePatch.baseSceneEntries,
			previousRows,
			rowIndexBySceneEntryId,
			splicePatch.startIndex
		);
		if (firstChangedRowIndex === null) {
			return null;
		}
		for (
			let index = splicePatch.startIndex;
			index < splicePatch.baseSceneEntries.length;
			index += 1
		) {
			const entry = splicePatch.baseSceneEntries[index];
			if (entry !== undefined) {
				rowIndexBySceneEntryId.delete(entry.id);
			}
		}
		const rows = appendSceneDisplayRowsFromIndex(
			createTruncatedSceneDisplayRowsArray(previousRows, firstChangedRowIndex),
			sceneEntries,
			splicePatch.startIndex
		);
		previousRows = rows;
		latestTimestampMs = selectLatestTimestampMsFrom(
			previousRows,
			firstChangedRowIndex,
			latestTimestampMs
		);
		previousSceneEntries = sceneEntries;
		indexRowsBySceneEntryId(rowIndexBySceneEntryId, previousRows, firstChangedRowIndex);
		return previousRows;
	}

	function applyDisplayScenePatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly SceneDisplayRow[] | null {
		const displayScenePatch = getAgentPanelDisplayScenePatch(sceneEntries);
		if (
			displayScenePatch === undefined ||
			displayScenePatch.baseSceneEntries !== previousSceneEntries
		) {
			return null;
		}
		baseRowsBeforeTokenReveal = null;
		const patchedRows = patchDisplaySceneDisplayRows(
			previousRows,
			rowIndexBySceneEntryId,
			displayScenePatch.entriesByIndex.values()
		);
		if (patchedRows === null) {
			return null;
		}
		previousRows = patchedRows.rows;
		latestTimestampMs = selectLatestTimestampMsFrom(
			previousRows,
			patchedRows.firstChangedRowIndex,
			latestTimestampMs
		);
		previousSceneEntries = sceneEntries;
		return previousRows;
	}

	function applyTokenRevealPatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): readonly SceneDisplayRow[] | null {
		const tokenRevealPatch = getTokenRevealScenePatch(sceneEntries);
		if (
			tokenRevealPatch === undefined ||
			tokenRevealPatch.baseSceneEntries !== previousSceneEntries
		) {
			return null;
		}
		baseRowsBeforeTokenReveal ??= previousRows;
		const effectivePatchedEntries: AgentPanelSceneEntryModel[] = [];
		for (const [sceneEntryIndex, entry] of tokenRevealPatch.entriesByIndex) {
			if (tokenRevealPatch.baseSceneEntries[sceneEntryIndex] !== entry) {
				effectivePatchedEntries.push(entry);
			}
		}
		const patchedRows = patchDisplaySceneDisplayRows(
			baseRowsBeforeTokenReveal,
			rowIndexBySceneEntryId,
			effectivePatchedEntries
		);
		if (patchedRows === null) {
			return null;
		}
		previousRows = patchedRows.rows;
		latestTimestampMs = selectLatestTimestampMsFrom(
			previousRows,
			patchedRows.firstChangedRowIndex,
			latestTimestampMs
		);
		return previousRows;
	}

	return {
		applySnapshot(sceneEntries) {
			const tokenRevealRows = applyTokenRevealPatch(sceneEntries);
			if (tokenRevealRows !== null) {
				return tokenRevealRows;
			}

			if (sceneEntries === previousSceneEntries) {
				if (baseRowsBeforeTokenReveal !== null) {
					previousRows = baseRowsBeforeTokenReveal;
					baseRowsBeforeTokenReveal = null;
				}
				return previousRows;
			}

			baseRowsBeforeTokenReveal = null;
			const graphPatchRows = applyGraphScenePatch(sceneEntries);
			if (graphPatchRows !== null) {
				return graphPatchRows;
			}

			const displayPatchRows = applyDisplayScenePatch(sceneEntries);
			if (displayPatchRows !== null) {
				return displayPatchRows;
			}

			const truncationRows = applyGraphSceneTruncation(sceneEntries);
			if (truncationRows !== null) {
				return truncationRows;
			}

			const spliceRows = applyGraphSceneSplice(sceneEntries);
			if (spliceRows !== null) {
				return spliceRows;
			}

			if (
				previousSceneEntries !== null &&
				isStableSceneEntryAppend(previousSceneEntries, sceneEntries)
			) {
				const baseRows = previousRows;
				const firstChangedRowIndex = Math.max(0, baseRows.length - 1);
				previousRows = appendSceneDisplayRowsFromIndex(
					baseRows,
					sceneEntries,
					previousSceneEntries.length
				);
				markSceneDisplayRowAppend(previousRows, baseRows);
				latestTimestampMs = selectLatestTimestampMsFrom(
					previousRows,
					firstChangedRowIndex,
					latestTimestampMs
				);
				previousSceneEntries = sceneEntries;
				indexRowsBySceneEntryId(rowIndexBySceneEntryId, previousRows, firstChangedRowIndex);
				return previousRows;
			}

			if (
				previousSceneEntries !== null &&
				isStableSceneEntryTruncation(previousSceneEntries, sceneEntries)
			) {
				const truncatedRows = truncateStableSceneDisplayRows(
					previousSceneEntries,
					sceneEntries,
					previousRows,
					rowIndexBySceneEntryId
				);
				if (truncatedRows !== null) {
					previousRows = truncatedRows;
					latestTimestampMs = selectLatestTimestampMsFrom(previousRows, 0);
					previousSceneEntries = sceneEntries;
					return previousRows;
				}
			}

			if (previousSceneEntries !== null) {
				const insertion = findStableSceneEntryInsertion(previousSceneEntries, sceneEntries);
				const insertedRows =
					insertion === null
						? null
						: patchInsertedSceneDisplayRows(
								previousSceneEntries,
								sceneEntries,
								previousRows,
								rowIndexBySceneEntryId,
								insertion.startIndex,
								insertion.insertedCount
							);
				if (insertedRows !== null) {
					previousRows = insertedRows.rows;
					latestTimestampMs = selectLatestTimestampMsFrom(
						previousRows,
						insertedRows.firstChangedRowIndex,
						latestTimestampMs
					);
					previousSceneEntries = sceneEntries;
					return previousRows;
				}
			}

			const patchedRows =
				previousSceneEntries !== null
					? patchSameLengthSceneDisplayRows(
							previousSceneEntries,
							sceneEntries,
							previousRows,
							rowIndexBySceneEntryId
						)
					: null;
			if (patchedRows !== null) {
				previousRows = patchedRows.rows;
				latestTimestampMs = selectLatestTimestampMsFrom(
					previousRows,
					patchedRows.firstChangedRowIndex,
					latestTimestampMs
				);
				previousSceneEntries = sceneEntries;
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

			const baseRows = previousRows;
			const firstChangedRowIndex = Math.max(0, baseRows.length - 1);
			previousRows = appendSceneDisplayRows(baseRows, appendedSceneEntries);
			markSceneDisplayRowAppend(previousRows, baseRows);
			latestTimestampMs = selectLatestTimestampMsFrom(
				previousRows,
				firstChangedRowIndex,
				latestTimestampMs
			);
			previousSceneEntries = createAppendedSceneEntriesArray(
				previousSceneEntries ?? [],
				appendedSceneEntries
			);
			indexRowsBySceneEntryId(rowIndexBySceneEntryId, previousRows, firstChangedRowIndex);
			return previousRows;
		},
		applyPatch(sceneEntries) {
			return (
				applyGraphScenePatch(sceneEntries) ??
				applyGraphSceneAppendPatch(sceneEntries) ??
				applyGraphSceneTruncation(sceneEntries) ??
				applyGraphSceneSplice(sceneEntries) ??
				applyDisplayScenePatch(sceneEntries) ??
				applyTokenRevealPatch(sceneEntries)
			);
		},
		selectRows() {
			return previousRows;
		},
		selectLatestTimestampMs() {
			return latestTimestampMs;
		},
	};
}

function findFirstSpliceRowIndex(
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	previousRows: readonly SceneDisplayRow[],
	rowIndexBySceneEntryId: ReadonlyMap<string, number>,
	startIndex: number
): number | null {
	if (startIndex === 0) {
		return 0;
	}
	if (startIndex >= previousSceneEntries.length) {
		return previousRows.length;
	}
	for (let index = startIndex; index < previousSceneEntries.length; index += 1) {
		const entry = previousSceneEntries[index];
		if (entry === undefined) {
			continue;
		}
		const rowIndex = rowIndexBySceneEntryId.get(entry.id);
		if (rowIndex !== undefined) {
			return rowIndex;
		}
	}
	return previousRows.length;
}

function createPatchedSceneDisplayRowArray(
	baseRows: readonly SceneDisplayRow[],
	patchedIndex: number,
	patchedRow: SceneDisplayRow
): readonly SceneDisplayRow[] {
	return createPatchedSceneDisplayRowsArray(baseRows, new Map([[patchedIndex, patchedRow]]));
}

function createPatchedSceneDisplayRowsArray(
	baseRows: readonly SceneDisplayRow[],
	patchedRowsByIndex: ReadonlyMap<number, SceneDisplayRow>
): readonly SceneDisplayRow[] {
	const target = new Array<SceneDisplayRow>(baseRows.length);
	const rows = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < baseRows.length; index += 1) {
						yield patchedRowsByIndex.get(index) ?? baseRows[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return patchedRowsByIndex.get(index) ?? baseRows[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < baseRows.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < baseRows.length) {
				return {
					configurable: true,
					enumerable: true,
					value: patchedRowsByIndex.get(index) ?? baseRows[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
	sceneDisplayRowArrayPatches.set(rows, { baseRows, patchedRowsByIndex });
	return rows;
}

function markSceneDisplayRowAppend(
	rows: readonly SceneDisplayRow[],
	baseRows: readonly SceneDisplayRow[]
): void {
	if (rows.length <= baseRows.length) {
		return;
	}
	const appendedRows = createAppendedSceneDisplayRowsPatchRows(rows, baseRows.length);
	sceneDisplayRowArrayAppends.set(rows, { baseRows, appendedRows });
}

function createAppendedSceneDisplayRowsPatchRows(
	rows: readonly SceneDisplayRow[],
	startIndex: number
): readonly SceneDisplayRow[] {
	return new Proxy(new Array<SceneDisplayRow>(rows.length - startIndex), {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield rows[startIndex + index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return rows[startIndex + index];
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
	});
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

function truncateStableSceneDisplayRows(
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	previousRows: readonly SceneDisplayRow[],
	rowIndexBySceneEntryId: Map<string, number>
): readonly SceneDisplayRow[] | null {
	const removedEntryIds = new Set<string>();
	let firstRemovedRowIndex = Number.POSITIVE_INFINITY;
	for (let index = sceneEntries.length; index < previousSceneEntries.length; index += 1) {
		const entry = previousSceneEntries[index];
		if (entry === undefined) {
			return null;
		}
		const rowIndex = rowIndexBySceneEntryId.get(entry.id);
		if (rowIndex === undefined) {
			return null;
		}
		removedEntryIds.add(entry.id);
		firstRemovedRowIndex = Math.min(firstRemovedRowIndex, rowIndex);
	}

	if (!Number.isFinite(firstRemovedRowIndex)) {
		return previousRows;
	}

	for (let rowIndex = firstRemovedRowIndex; rowIndex < previousRows.length; rowIndex += 1) {
		const row = previousRows[rowIndex];
		if (
			row === undefined ||
			row.type === "assistant_merged" ||
			row.type === "thinking" ||
			!removedEntryIds.has(getSceneDisplayRowKey(row))
		) {
			return null;
		}
	}

	for (const entryId of removedEntryIds) {
		rowIndexBySceneEntryId.delete(entryId);
	}
	return createTruncatedSceneDisplayRowsArray(previousRows, firstRemovedRowIndex);
}

function patchInsertedSceneDisplayRows(
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	previousRows: readonly SceneDisplayRow[],
	rowIndexBySceneEntryId: Map<string, number>,
	startIndex: number,
	insertedCount: number
): { readonly rows: readonly SceneDisplayRow[]; readonly firstChangedRowIndex: number } | null {
	const previousEntry = previousSceneEntries[startIndex - 1];
	const firstInsertedEntry = sceneEntries[startIndex];
	const nextExistingEntry = previousSceneEntries[startIndex];
	const canMergeWithPreviousAssistant =
		previousEntry?.type === "assistant" && firstInsertedEntry?.type === "assistant";
	const canMergeWithNextAssistant =
		firstInsertedEntry?.type === "assistant" && nextExistingEntry?.type === "assistant";
	if (!canMergeWithPreviousAssistant && !canMergeWithNextAssistant) {
		const firstInsertedRowIndex =
			startIndex >= previousSceneEntries.length
				? previousRows.length
				: rowIndexBySceneEntryId.get(nextExistingEntry?.id ?? "");
		if (firstInsertedRowIndex === undefined) {
			return null;
		}

		const insertedRows = buildInsertedSceneDisplayRows(sceneEntries, startIndex, insertedCount);
		const rows = createInsertedSceneDisplayRowsArray(
			previousRows,
			insertedRows,
			firstInsertedRowIndex
		);
		indexRowsBySceneEntryId(rowIndexBySceneEntryId, rows, firstInsertedRowIndex);
		return {
			rows,
			firstChangedRowIndex: firstInsertedRowIndex,
		};
	}

	const rebuildSceneIndex = canMergeWithPreviousAssistant ? Math.max(0, startIndex - 1) : startIndex;
	const firstRebuiltRowIndex =
		rebuildSceneIndex === 0
			? 0
			: rowIndexBySceneEntryId.get(previousSceneEntries[rebuildSceneIndex]?.id ?? "");
	if (firstRebuiltRowIndex === undefined) {
		return null;
	}

	for (let index = rebuildSceneIndex; index < previousSceneEntries.length; index += 1) {
		const entry = previousSceneEntries[index];
		if (entry !== undefined) {
			rowIndexBySceneEntryId.delete(entry.id);
		}
	}

	const rows = appendSceneDisplayRowsFromIndex(
		createTruncatedSceneDisplayRowsArray(previousRows, firstRebuiltRowIndex),
		sceneEntries,
		rebuildSceneIndex
	);
	indexRowsBySceneEntryId(rowIndexBySceneEntryId, rows, firstRebuiltRowIndex);
	return {
		rows,
		firstChangedRowIndex: firstRebuiltRowIndex,
	};
}

function buildInsertedSceneDisplayRows(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number,
	insertedCount: number
): readonly SceneDisplayRow[] {
	if (insertedCount === 1) {
		const insertedEntry = sceneEntries[startIndex];
		return insertedEntry === undefined ? [] : buildSceneDisplayRows([insertedEntry]);
	}

	const insertedEntries: AgentPanelSceneEntryModel[] = [];
	for (let index = 0; index < insertedCount; index += 1) {
		const insertedEntry = sceneEntries[startIndex + index];
		if (insertedEntry !== undefined) {
			insertedEntries.push(insertedEntry);
		}
	}
	return buildSceneDisplayRows(insertedEntries);
}

function patchSameLengthSceneDisplayRows(
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	previousRows: readonly SceneDisplayRow[],
	rowIndexBySceneEntryId: Map<string, number>
): { readonly rows: readonly SceneDisplayRow[]; readonly firstChangedRowIndex: number } | null {
	if (previousSceneEntries.length !== sceneEntries.length) {
		return null;
	}

	const patchedRowsByIndex = new Map<number, SceneDisplayRow>();
	let firstChangedRowIndex = Number.POSITIVE_INFINITY;
	for (let index = 0; index < sceneEntries.length; index += 1) {
		const previousEntry = previousSceneEntries[index];
		const nextEntry = sceneEntries[index];
		if (previousEntry === nextEntry) {
			continue;
		}
		if (previousEntry === undefined || nextEntry === undefined) {
			return null;
		}
		if (previousEntry.id !== nextEntry.id) {
			const tailReplacement = patchTailReplacementSceneDisplayRow(
				previousSceneEntries,
				sceneEntries,
				previousRows,
				rowIndexBySceneEntryId,
				index,
				previousEntry,
				nextEntry
			);
			if (tailReplacement === null) {
				return null;
			}
			return tailReplacement;
		}
		const rowIndex = rowIndexBySceneEntryId.get(nextEntry.id);
		if (rowIndex === undefined) {
			return null;
		}
		const previousRow = previousRows[rowIndex];
		if (previousRow === undefined || !canPatchSceneDisplayRow(previousRow, nextEntry.id)) {
			return null;
		}
		const patchedRow = buildSceneDisplayRows([nextEntry])[0];
		if (
			patchedRow === undefined ||
			getSceneDisplayRowKey(patchedRow) !== getSceneDisplayRowKey(previousRow)
		) {
			return null;
		}
		if (areJsonLikeValuesEquivalent(previousRow, patchedRow)) {
			continue;
		}
		patchedRowsByIndex.set(rowIndex, patchedRow);
		firstChangedRowIndex = Math.min(firstChangedRowIndex, rowIndex);
	}

	if (patchedRowsByIndex.size === 0) {
		return { rows: previousRows, firstChangedRowIndex: previousRows.length };
	}
	return {
		rows: createPatchedSceneDisplayRowsArray(previousRows, patchedRowsByIndex),
		firstChangedRowIndex,
	};
}

function patchTailReplacementSceneDisplayRow(
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	previousRows: readonly SceneDisplayRow[],
	rowIndexBySceneEntryId: Map<string, number>,
	entryIndex: number,
	previousEntry: AgentPanelSceneEntryModel,
	nextEntry: AgentPanelSceneEntryModel
): { readonly rows: readonly SceneDisplayRow[]; readonly firstChangedRowIndex: number } | null {
	if (entryIndex !== sceneEntries.length - 1 || previousSceneEntries.length !== sceneEntries.length) {
		return null;
	}
	const previousRowIndex = rowIndexBySceneEntryId.get(previousEntry.id);
	if (
		previousRowIndex === undefined ||
		previousRowIndex !== previousRows.length - 1 ||
		previousRows.length === 0
	) {
		return null;
	}
	const patchedRow = buildSceneDisplayRows([nextEntry])[0];
	if (patchedRow === undefined) {
		return null;
	}
	if (areJsonLikeValuesEquivalent(previousRows[previousRowIndex], patchedRow)) {
		rowIndexBySceneEntryId.delete(previousEntry.id);
		rowIndexBySceneEntryId.set(nextEntry.id, previousRowIndex);
		return {
			rows: previousRows,
			firstChangedRowIndex: previousRows.length,
		};
	}
	rowIndexBySceneEntryId.delete(previousEntry.id);
	rowIndexBySceneEntryId.set(nextEntry.id, previousRowIndex);
	return {
		rows: createPatchedSceneDisplayRowsArray(
			previousRows,
			new Map([[previousRowIndex, patchedRow]])
		),
		firstChangedRowIndex: previousRowIndex,
	};
}

function patchDisplaySceneDisplayRows(
	previousRows: readonly SceneDisplayRow[],
	rowIndexBySceneEntryId: ReadonlyMap<string, number>,
	patchedEntries: Iterable<AgentPanelSceneEntryModel>
): { readonly rows: readonly SceneDisplayRow[]; readonly firstChangedRowIndex: number } | null {
	const patchedRowsByIndex = new Map<number, SceneDisplayRow>();
	let firstChangedRowIndex = Number.POSITIVE_INFINITY;
	for (const patchedEntry of patchedEntries) {
		const rowIndex = rowIndexBySceneEntryId.get(patchedEntry.id);
		if (rowIndex === undefined) {
			return null;
		}
		const previousRow = previousRows[rowIndex];
		if (previousRow === undefined || !canPatchSceneDisplayRow(previousRow, patchedEntry.id)) {
			return null;
		}
		const patchedRow = buildSceneDisplayRows([patchedEntry])[0];
		if (
			patchedRow === undefined ||
			getSceneDisplayRowKey(patchedRow) !== getSceneDisplayRowKey(previousRow)
		) {
			return null;
		}
		if (areJsonLikeValuesEquivalent(previousRow, patchedRow)) {
			continue;
		}
		patchedRowsByIndex.set(rowIndex, patchedRow);
		firstChangedRowIndex = Math.min(firstChangedRowIndex, rowIndex);
	}

	if (patchedRowsByIndex.size === 0) {
		return { rows: previousRows, firstChangedRowIndex: previousRows.length };
	}

	return {
		rows: createPatchedSceneDisplayRowsArray(previousRows, patchedRowsByIndex),
		firstChangedRowIndex,
	};
}

function canPatchSceneDisplayRow(row: SceneDisplayRow, entryId: string): boolean {
	if (row.type === "assistant_merged") {
		return row.memberIds.length === 1 && row.memberIds[0] === entryId;
	}
	if (row.type === "thinking" || row.type === "missing") {
		return false;
	}
	return getSceneDisplayRowKey(row) === entryId;
}

function areJsonLikeValuesEquivalent(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (typeof left !== typeof right) {
		return false;
	}
	if (left === null || right === null) {
		return false;
	}
	if (typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}
		return left.every((item, index) => areJsonLikeValuesEquivalent(item, right[index]));
	}

	const leftEntries = Object.entries(left);
	const rightRecord = right as Record<string, unknown>;
	if (leftEntries.length !== Object.keys(rightRecord).length) {
		return false;
	}
	return leftEntries.every(([key, value]) =>
		areJsonLikeValuesEquivalent(value, rightRecord[key])
	);
}

function createInsertedSceneDisplayRowsArray(
	baseRows: readonly SceneDisplayRow[],
	insertedRows: readonly SceneDisplayRow[],
	insertIndex: number
): readonly SceneDisplayRow[] {
	if (insertedRows.length === 0) {
		return baseRows;
	}

	const target = new Array<SceneDisplayRow>(baseRows.length + insertedRows.length);
	const rows = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectInsertedSceneDisplayRow(baseRows, insertedRows, insertIndex, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectInsertedSceneDisplayRow(baseRows, insertedRows, insertIndex, index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectInsertedSceneDisplayRow(baseRows, insertedRows, insertIndex, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
	sceneDisplayRowArrayInsertions.set(rows, { baseRows, insertedRows, insertIndex });
	return rows;
}

function createTruncatedSceneDisplayRowsArray(
	baseRows: readonly SceneDisplayRow[],
	length: number
): readonly SceneDisplayRow[] {
	if (length >= baseRows.length) {
		return baseRows;
	}

	const target = new Array<SceneDisplayRow>(length);
	const rows = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield baseRows[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index < targetArray.length ? baseRows[index] : undefined;
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: baseRows[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
	sceneDisplayRowArrayTruncations.set(rows, { baseRows, length });
	return rows;
}

function selectInsertedSceneDisplayRow(
	baseRows: readonly SceneDisplayRow[],
	insertedRows: readonly SceneDisplayRow[],
	insertIndex: number,
	index: number
): SceneDisplayRow | undefined {
	if (index < insertIndex) {
		return baseRows[index];
	}
	if (index < insertIndex + insertedRows.length) {
		return insertedRows[index - insertIndex];
	}
	return baseRows[index - insertedRows.length];
}

function createArrayLikeOwnKeys(length: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < length; index += 1) {
		keys.push(String(index));
	}
	keys.push("length");
	return keys;
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
		if (row === undefined || row.type === "thinking") {
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
