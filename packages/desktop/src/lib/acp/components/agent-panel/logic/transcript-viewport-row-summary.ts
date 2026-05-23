import {
	getSceneDisplayRowKey,
	getSceneDisplayRowTimestampMs,
	THINKING_DISPLAY_ENTRY,
	type SceneDisplayRow,
} from "./scene-display-rows.js";
import {
	getSceneDisplayRowArrayAppend,
	getSceneDisplayRowArrayPatch,
	getSceneDisplayRowArrayInsertion,
	getSceneDisplayRowArrayTruncation,
} from "./scene-display-row-read-model.js";
import {
	buildNativeFallbackWindow,
	type IndexedViewportEntry,
} from "./viewport-fallback-controller.svelte.js";

export type TranscriptViewportChangedRange = {
	startIndex: number;
	endIndex: number;
};

export type TranscriptViewportRowsReason =
	| "initial"
	| "waiting-row-appended"
	| "streaming-growth"
	| "session-switch"
	| "rows-updated";

export type TranscriptViewportRowSummary = {
	version: number;
	count: number;
	firstKey: string | null;
	lastKey: string | null;
	latestUserKey: string | null;
	lastUserRowIndex?: number | null;
	userRowIndexes?: readonly number[];
	rowKeys?: readonly string[];
	rowIndexByKey?: ReadonlyMap<string, number>;
	anchorEligibleKeys: readonly string[];
	hasLiveAssistantDisplayEntry?: boolean;
	hasTokenRevealAssistantEntry?: boolean;
	hasToolCallEntry?: boolean;
	lastLiveAssistantDisplayEntryIndex?: number | null;
	lastTokenRevealAssistantEntryIndex?: number | null;
	lastToolCallEntryIndex?: number | null;
	liveAssistantDisplayEntryIndexes?: readonly number[];
	tokenRevealAssistantEntryIndexes?: readonly number[];
	toolCallEntryIndexes?: readonly number[];
	changedRange?: TranscriptViewportChangedRange;
	reason?: TranscriptViewportRowsReason;
};

export type TranscriptViewportNearbyRowDiagnostic = {
	readonly type: string;
	readonly key?: string;
};

export function createEmptyTranscriptViewportRows(): TranscriptViewportRowSummary {
	return {
		version: 0,
		count: 0,
		firstKey: null,
		lastKey: null,
		latestUserKey: null,
		lastUserRowIndex: null,
		userRowIndexes: [],
		rowKeys: [],
		rowIndexByKey: new Map(),
		anchorEligibleKeys: [],
		hasLiveAssistantDisplayEntry: false,
		hasTokenRevealAssistantEntry: false,
		hasToolCallEntry: false,
		lastLiveAssistantDisplayEntryIndex: null,
		lastTokenRevealAssistantEntryIndex: null,
		lastToolCallEntryIndex: null,
		liveAssistantDisplayEntryIndexes: [],
		tokenRevealAssistantEntryIndexes: [],
		toolCallEntryIndexes: [],
	};
}

export interface TranscriptViewportRowsReadModel {
	selectRows(input: {
		readonly rows: readonly SceneDisplayRow[];
		readonly waiting:
			| {
					readonly show: true;
					readonly startedAtMs: number | null;
					readonly label: string | null;
			  }
			| { readonly show: false };
	}): readonly SceneDisplayRow[];
	applyRows(input: {
		rows: readonly SceneDisplayRow[];
		reason: TranscriptViewportRowsReason;
	}): TranscriptViewportRowSummary;
	selectSummary(): TranscriptViewportRowSummary;
	selectNativeFallbackWindow(limit: number): readonly IndexedViewportEntry<SceneDisplayRow>[];
	selectNearbyRowDiagnostics(
		index: number | undefined,
		radius: number
	): readonly TranscriptViewportNearbyRowDiagnostic[];
	selectThinkingDurationMs(index: number, nowMs?: number): number | null;
}

type ThinkingDurationSource =
	| { readonly type: "none" }
	| { readonly type: "fixed"; readonly durationMs: number }
	| { readonly type: "elapsed"; readonly startedAtMs: number };

type SingleAppendRowsMetadata = {
	readonly baseRows: readonly SceneDisplayRow[];
	readonly appendedRow: SceneDisplayRow;
};

const singleAppendRowsMetadata = new WeakMap<
	readonly SceneDisplayRow[],
	SingleAppendRowsMetadata
>();

export function createTranscriptViewportRowsReadModel(): TranscriptViewportRowsReadModel {
	let previousRows: readonly SceneDisplayRow[] | null = null;
	let previousSummary: TranscriptViewportRowSummary = createEmptyTranscriptViewportRows();
	let thinkingDurationSources: ThinkingDurationSource[] = [];
	let nativeFallbackWindowCache: {
		readonly rows: readonly SceneDisplayRow[];
		readonly limit: number;
		readonly window: readonly IndexedViewportEntry<SceneDisplayRow>[];
	} | null = null;
	let selectedRowsCache: {
		readonly rows: readonly SceneDisplayRow[];
		readonly startedAtMs: number | null;
		readonly label: string | null;
		readonly selectedRows: readonly SceneDisplayRow[];
	} | null = null;

	return {
		selectRows({ rows, waiting }) {
			if (!waiting.show) {
				return rows;
			}

			if (
				selectedRowsCache !== null &&
				selectedRowsCache.rows === rows &&
				selectedRowsCache.startedAtMs === waiting.startedAtMs &&
				selectedRowsCache.label === waiting.label
			) {
				return selectedRowsCache.selectedRows;
			}

			const waitingRow = {
				type: THINKING_DISPLAY_ENTRY.type,
				id: THINKING_DISPLAY_ENTRY.id,
				startedAtMs: waiting.startedAtMs,
				label: waiting.label,
			} satisfies SceneDisplayRow;
			const selectedRows = createSingleAppendRows(rows, waitingRow);
			selectedRowsCache = {
				rows,
				startedAtMs: waiting.startedAtMs,
				label: waiting.label,
				selectedRows,
			};
			return selectedRows;
		},
		applyRows({ rows, reason }) {
			if (rows === previousRows) {
				return previousSummary;
			}
			const commitSummary = (summary: TranscriptViewportRowSummary) => {
				previousSummary = withNextTranscriptViewportRowsRevision(previousSummary, summary);
				previousRows = rows;
				return previousSummary;
			};

			const patchedRows = getSceneDisplayRowArrayPatch(rows);
			if (previousRows !== null && patchedRows?.baseRows === previousRows) {
				const patchedSummary = patchTranscriptViewportRowsSummary(
					previousSummary,
					previousRows,
					rows,
					patchedRows.patchedRowsByIndex,
					reason
				);
				if (patchedSummary !== null) {
					const firstPatchedIndex = selectFirstPatchedRowIndex(
						patchedRows.patchedRowsByIndex
					);
					thinkingDurationSources = updateThinkingDurationSources(
						thinkingDurationSources,
						rows,
						Math.max(0, firstPatchedIndex - 1)
					);
					return commitSummary(patchedSummary);
				}
				if (canApplyTailReplacementPatch(previousRows, rows, patchedRows.patchedRowsByIndex)) {
					const nextSummary = replaceTranscriptViewportRowsTailSummary(
						previousSummary,
						rows,
						reason
					);
					thinkingDurationSources = updateThinkingDurationSources(
						thinkingDurationSources,
						rows,
						Math.max(0, rows.length - 2)
					);
					return commitSummary(nextSummary);
				}
			}

			const singleAppendRows = singleAppendRowsMetadata.get(rows);
			if (previousRows !== null && singleAppendRows?.baseRows === previousRows) {
				const nextSummary = appendTranscriptViewportRowsSummary(previousSummary, rows, reason);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					Math.max(0, previousRows.length - 1)
				);
				return commitSummary(nextSummary);
			}

			const appendedRows = getSceneDisplayRowArrayAppend(rows);
			if (previousRows !== null && appendedRows?.baseRows === previousRows) {
				const nextSummary = appendTranscriptViewportRowsSummary(previousSummary, rows, reason);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					Math.max(0, previousRows.length - 1)
				);
				return commitSummary(nextSummary);
			}

			const truncatedRows = getSceneDisplayRowArrayTruncation(rows);
			if (previousRows !== null && truncatedRows?.baseRows === previousRows) {
				const nextSummary = truncateTranscriptViewportRowsSummary(
					previousSummary,
					previousRows,
					rows,
					reason
				);
				thinkingDurationSources = truncateThinkingDurationSources(
					thinkingDurationSources,
					rows.length
				);
				return commitSummary(nextSummary);
			}

			const insertedRows = getSceneDisplayRowArrayInsertion(rows);
			if (previousRows !== null && insertedRows?.baseRows === previousRows) {
				const durationStartIndex =
					insertedRows.insertIndex > 0 &&
					thinkingDurationSources[insertedRows.insertIndex - 1]?.type !== "none"
						? insertedRows.insertIndex - 1
						: insertedRows.insertIndex;
				const nextSummary = insertTranscriptViewportRowsSummary(
					previousSummary,
					rows,
					insertedRows.insertedRows,
					insertedRows.insertIndex,
					reason
				);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					durationStartIndex
				);
				return commitSummary(nextSummary);
			}

			if (previousRows !== null && isSamePrefix(previousRows, rows, previousRows.length)) {
				const nextSummary = appendTranscriptViewportRowsSummary(previousSummary, rows, reason);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					Math.max(0, previousRows.length - 1)
				);
				return commitSummary(nextSummary);
			}

			if (
				previousRows !== null &&
				rows.length === previousRows.length &&
				rows.length > 0 &&
				isSamePrefix(previousRows, rows, rows.length - 1)
			) {
			const nextSummary = replaceTranscriptViewportRowsTailSummary(previousSummary, rows, reason);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					Math.max(0, rows.length - 2)
				);
				return commitSummary(nextSummary);
			}

			if (
				previousRows !== null &&
				rows.length < previousRows.length &&
				isSamePrefix(previousRows, rows, rows.length)
			) {
				const nextSummary = truncateTranscriptViewportRowsSummary(
					previousSummary,
					previousRows,
					rows,
					reason
				);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					Math.max(0, rows.length - 1)
				);
				return commitSummary(nextSummary);
			}

			const nextSummary = buildTranscriptViewportRowsSummary(rows, reason);
			thinkingDurationSources = buildThinkingDurationSources(rows);
			return commitSummary(nextSummary);
		},
		selectSummary() {
			return previousSummary;
		},
		selectNativeFallbackWindow(limit) {
			if (previousRows === null) {
				return [];
			}
			if (
				nativeFallbackWindowCache !== null &&
				nativeFallbackWindowCache.rows === previousRows &&
				nativeFallbackWindowCache.limit === limit
			) {
				return nativeFallbackWindowCache.window;
			}

			const window = buildNativeFallbackWindow(previousRows, limit);
			nativeFallbackWindowCache = {
				rows: previousRows,
				limit,
				window,
			};
			return window;
		},
		selectNearbyRowDiagnostics(index, radius) {
			return selectNearbyRowDiagnostics(previousRows ?? [], index, radius);
		},
		selectThinkingDurationMs(index, nowMs = Date.now()) {
			const source = thinkingDurationSources[index];
			if (source === undefined || source.type === "none") {
				return null;
			}
			if (source.type === "fixed") {
				return source.durationMs;
			}
			return Math.max(0, nowMs - source.startedAtMs);
		},
	};
}

function createSingleAppendRows(
	baseRows: readonly SceneDisplayRow[],
	appendedRow: SceneDisplayRow
): readonly SceneDisplayRow[] {
	const target = new Array<SceneDisplayRow>(baseRows.length + 1);
	const rows = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < baseRows.length; index += 1) {
						yield baseRows[index];
					}
					yield appendedRow;
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index === baseRows.length ? appendedRow : baseRows[index];
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
					value: index === baseRows.length ? appendedRow : baseRows[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
	singleAppendRowsMetadata.set(rows, { baseRows, appendedRow });
	return rows;
}

function withNextTranscriptViewportRowsRevision(
	previousSummary: TranscriptViewportRowSummary,
	nextSummary: TranscriptViewportRowSummary
): TranscriptViewportRowSummary {
	const nextVersion = previousSummary.version + 1;
	return nextSummary.version === nextVersion
		? nextSummary
		: {
				...nextSummary,
				version: nextVersion,
			};
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

function patchTranscriptViewportRowsSummary(
	previousSummary: TranscriptViewportRowSummary,
	previousRows: readonly SceneDisplayRow[],
	rows: readonly SceneDisplayRow[],
	patchedRowsByIndex: ReadonlyMap<number, SceneDisplayRow>,
	reason: TranscriptViewportRowsReason
): TranscriptViewportRowSummary | null {
	if (patchedRowsByIndex.size === 0) {
		return previousSummary;
	}

	let firstChangedIndex = Number.POSITIVE_INFINITY;
	let lastChangedIndex = -1;
	for (const [index, nextRow] of patchedRowsByIndex) {
		const previousRow = previousRows[index];
		if (previousRow === undefined || index < 0 || index >= rows.length) {
			return null;
		}

		if (!canPatchTranscriptViewportRowSummary(previousRow, nextRow)) {
			return null;
		}

		firstChangedIndex = Math.min(firstChangedIndex, index);
		lastChangedIndex = Math.max(lastChangedIndex, index);
	}

	return {
		...previousSummary,
		version: rows.length,
		count: rows.length,
		changedRange: {
			startIndex: firstChangedIndex,
			endIndex: lastChangedIndex + 1,
		},
		reason,
	};
}

function canPatchTranscriptViewportRowSummary(
	previousRow: SceneDisplayRow,
	nextRow: SceneDisplayRow
): boolean {
	return (
		getSceneDisplayRowKey(previousRow) === getSceneDisplayRowKey(nextRow) &&
		previousRow.type === nextRow.type &&
		(previousRow.type !== "thinking") === (nextRow.type !== "thinking") &&
		isLiveAssistantDisplayRow(previousRow) === isLiveAssistantDisplayRow(nextRow) &&
		isTokenRevealAssistantDisplayRow(previousRow) === isTokenRevealAssistantDisplayRow(nextRow) &&
		(previousRow.type === "tool_call") === (nextRow.type === "tool_call")
	);
}

function selectFirstPatchedRowIndex(
	patchedRowsByIndex: ReadonlyMap<number, SceneDisplayRow>
): number {
	let firstIndex = Number.POSITIVE_INFINITY;
	for (const index of patchedRowsByIndex.keys()) {
		firstIndex = Math.min(firstIndex, index);
	}
	return Number.isFinite(firstIndex) ? firstIndex : 0;
}

function canApplyTailReplacementPatch(
	previousRows: readonly SceneDisplayRow[],
	rows: readonly SceneDisplayRow[],
	patchedRowsByIndex: ReadonlyMap<number, SceneDisplayRow>
): boolean {
	return (
		rows.length === previousRows.length &&
		rows.length > 0 &&
		patchedRowsByIndex.size === 1 &&
		patchedRowsByIndex.has(rows.length - 1)
	);
}

function truncateTranscriptViewportRowsSummary(
	previousSummary: TranscriptViewportRowSummary,
	previousRows: readonly SceneDisplayRow[],
	rows: readonly SceneDisplayRow[],
	reason: TranscriptViewportRowsReason
): TranscriptViewportRowSummary {
	if (rows.length === 0) {
		return buildTranscriptViewportRowsSummary(rows, reason);
	}

	const removedRows = createArrayView(previousRows.length - rows.length, (index) => {
		return previousRows[rows.length + index];
	});
	const previousRowKeys = previousSummary.rowKeys ?? [];
	const lastKey = previousRowKeys[rows.length - 1] ?? null;
	const rowKeys = createArrayView(rows.length, (index) => previousRowKeys[index]);
	const rowIndexByKey = createTruncatedRowIndexByKey(
		previousSummary.rowIndexByKey,
		rows.length
	);
	const userRowIndexes = truncateMatchingIndexes(previousSummary.userRowIndexes ?? [], rows.length);
	const liveAssistantDisplayEntryIndexes = truncateMatchingIndexes(
		previousSummary.liveAssistantDisplayEntryIndexes ?? [],
		rows.length
	);
	const tokenRevealAssistantEntryIndexes = truncateMatchingIndexes(
		previousSummary.tokenRevealAssistantEntryIndexes ?? [],
		rows.length
	);
	const toolCallEntryIndexes = truncateMatchingIndexes(
		previousSummary.toolCallEntryIndexes ?? [],
		rows.length
	);
	const removedAnchorEligibleCount = countAnchorEligibleRows(removedRows);
	const anchorEligibleKeys = createArrayView(
		Math.max(0, previousSummary.anchorEligibleKeys.length - removedAnchorEligibleCount),
		(index) => previousSummary.anchorEligibleKeys[index]
	);

	return {
		version: rows.length,
		count: rows.length,
		firstKey: previousSummary.firstKey,
		lastKey,
		latestUserKey: selectLatestKeyFromIndexes(previousRowKeys, userRowIndexes),
		lastUserRowIndex: selectLastMatchingIndex(userRowIndexes),
		userRowIndexes,
		rowKeys,
		rowIndexByKey,
		anchorEligibleKeys,
		hasLiveAssistantDisplayEntry: liveAssistantDisplayEntryIndexes.length > 0,
		hasTokenRevealAssistantEntry: tokenRevealAssistantEntryIndexes.length > 0,
		hasToolCallEntry: toolCallEntryIndexes.length > 0,
		lastLiveAssistantDisplayEntryIndex: selectLastMatchingIndex(liveAssistantDisplayEntryIndexes),
		lastTokenRevealAssistantEntryIndex: selectLastMatchingIndex(
			tokenRevealAssistantEntryIndexes
		),
		lastToolCallEntryIndex: selectLastMatchingIndex(toolCallEntryIndexes),
		liveAssistantDisplayEntryIndexes,
		tokenRevealAssistantEntryIndexes,
		toolCallEntryIndexes,
		reason,
	};
}

function countAnchorEligibleRows(rows: readonly SceneDisplayRow[]): number {
	let count = 0;
	for (const row of rows) {
		if (row.type !== "thinking") {
			count += 1;
		}
	}
	return count;
}

function selectNearbyRowDiagnostics(
	rows: readonly SceneDisplayRow[],
	index: number | undefined,
	radius: number
): readonly TranscriptViewportNearbyRowDiagnostic[] {
	const safeIndex = index ?? 0;
	const safeRadius = Math.max(0, radius);
	const startIndex = Math.max(0, safeIndex - safeRadius);
	const endIndex = Math.min(rows.length, safeIndex + safeRadius + 1);
	const diagnostics: TranscriptViewportNearbyRowDiagnostic[] = [];
	for (let rowIndex = startIndex; rowIndex < endIndex; rowIndex += 1) {
		const row = rows[rowIndex];
		if (row === undefined) {
			diagnostics.push({ type: "missing" });
			continue;
		}

		diagnostics.push({
			type: row.type,
			key: getSceneDisplayRowKey(row),
		});
	}
	return diagnostics;
}

export function buildTranscriptViewportRowsSummary(
	rows: readonly SceneDisplayRow[],
	reason: TranscriptViewportRowsReason
): TranscriptViewportRowSummary {
	let latestUserKey: string | null = null;
	const userRowIndexes: number[] = [];
	const rowKeys: string[] = [];
	const rowIndexByKey = new Map<string, number>();
	const anchorEligibleKeys: string[] = [];
	let hasLiveAssistantDisplayEntry = false;
	let hasTokenRevealAssistantEntry = false;
	let hasToolCallEntry = false;
	const liveAssistantDisplayEntryIndexes: number[] = [];
	const tokenRevealAssistantEntryIndexes: number[] = [];
	const toolCallEntryIndexes: number[] = [];
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (row === undefined) {
			continue;
		}
		const key = getSceneDisplayRowKey(row);
		rowIndexByKey.set(key, rowKeys.length);
		rowKeys.push(key);
		if (row.type === "user") {
			latestUserKey = key;
			userRowIndexes.push(index);
		}
		if (row.type !== "thinking") {
			anchorEligibleKeys.push(key);
		}
		if (isLiveAssistantDisplayRow(row)) {
			hasLiveAssistantDisplayEntry = true;
			liveAssistantDisplayEntryIndexes.push(index);
		}
		if (isTokenRevealAssistantDisplayRow(row)) {
			hasTokenRevealAssistantEntry = true;
			tokenRevealAssistantEntryIndexes.push(index);
		}
		if (row.type === "tool_call") {
			hasToolCallEntry = true;
			toolCallEntryIndexes.push(index);
		}
	}

	const lastRow = rows.at(-1);
	return {
		version: rows.length,
		count: rows.length,
		firstKey: rows[0] === undefined ? null : getSceneDisplayRowKey(rows[0]),
		lastKey: lastRow === undefined ? null : getSceneDisplayRowKey(lastRow),
		latestUserKey,
		lastUserRowIndex: selectLastMatchingIndex(userRowIndexes),
		userRowIndexes,
		rowKeys,
		rowIndexByKey,
		anchorEligibleKeys,
		hasLiveAssistantDisplayEntry,
		hasTokenRevealAssistantEntry,
		hasToolCallEntry,
		lastLiveAssistantDisplayEntryIndex: selectLastMatchingIndex(liveAssistantDisplayEntryIndexes),
		lastTokenRevealAssistantEntryIndex: selectLastMatchingIndex(
			tokenRevealAssistantEntryIndexes
		),
		lastToolCallEntryIndex: selectLastMatchingIndex(toolCallEntryIndexes),
		liveAssistantDisplayEntryIndexes,
		tokenRevealAssistantEntryIndexes,
		toolCallEntryIndexes,
		reason,
	};
}

function appendTranscriptViewportRowsSummary(
	previousSummary: TranscriptViewportRowSummary,
	rows: readonly SceneDisplayRow[],
	reason: TranscriptViewportRowsReason
): TranscriptViewportRowSummary {
	if (rows.length === previousSummary.count) {
		return previousSummary;
	}

	let latestUserKey = previousSummary.latestUserKey;
	let appendedRowKeys: string[] | null = null;
	let appendedAnchorEligibleKeys: string[] | null = null;
	let hasLiveAssistantDisplayEntry = previousSummary.hasLiveAssistantDisplayEntry === true;
	let hasTokenRevealAssistantEntry = previousSummary.hasTokenRevealAssistantEntry === true;
	let hasToolCallEntry = previousSummary.hasToolCallEntry === true;
	const userRowIndexes = appendMatchingIndexes(
		previousSummary.userRowIndexes ?? [],
		rows,
		previousSummary.count,
		(row) => row.type === "user"
	);
	const liveAssistantDisplayEntryIndexes = appendMatchingIndexes(
		previousSummary.liveAssistantDisplayEntryIndexes ?? [],
		rows,
		previousSummary.count,
		isLiveAssistantDisplayRow
	);
	const tokenRevealAssistantEntryIndexes = appendMatchingIndexes(
		previousSummary.tokenRevealAssistantEntryIndexes ?? [],
		rows,
		previousSummary.count,
		isTokenRevealAssistantDisplayRow
	);
	const toolCallEntryIndexes = appendMatchingIndexes(
		previousSummary.toolCallEntryIndexes ?? [],
		rows,
		previousSummary.count,
		(row) => row.type === "tool_call"
	);
	const previousRowKeys = previousSummary.rowKeys ?? [];
	let appendedRowIndexByKey: Map<string, number> | null = null;
	for (let index = previousSummary.count; index < rows.length; index += 1) {
		const row = rows[index];
		if (row === undefined) {
			continue;
		}

		const key = getSceneDisplayRowKey(row);
		appendedRowKeys ??= [];
		appendedRowIndexByKey ??= new Map();
		appendedRowIndexByKey.set(key, index);
		appendedRowKeys.push(key);
		if (row.type === "user") {
			latestUserKey = key;
		}
		if (row.type !== "thinking") {
			appendedAnchorEligibleKeys ??= [];
			appendedAnchorEligibleKeys.push(key);
		}
		hasLiveAssistantDisplayEntry ||= isLiveAssistantDisplayRow(row);
		hasTokenRevealAssistantEntry ||= isTokenRevealAssistantDisplayRow(row);
		hasToolCallEntry ||= row.type === "tool_call";
	}

	const lastRow = rows.at(-1);
	return {
		version: rows.length,
		count: rows.length,
		firstKey:
			previousSummary.firstKey ?? (rows[0] === undefined ? null : getSceneDisplayRowKey(rows[0])),
		lastKey: lastRow === undefined ? null : getSceneDisplayRowKey(lastRow),
		latestUserKey,
		lastUserRowIndex: selectLastMatchingIndex(userRowIndexes),
		userRowIndexes,
		rowKeys:
			appendedRowKeys === null
				? previousSummary.rowKeys
				: createAppendedArrayView(previousRowKeys, appendedRowKeys),
		rowIndexByKey:
			appendedRowIndexByKey === null
				? previousSummary.rowIndexByKey
				: createAppendedRowIndexByKey(previousSummary.rowIndexByKey, appendedRowIndexByKey),
		anchorEligibleKeys:
			appendedAnchorEligibleKeys === null
				? previousSummary.anchorEligibleKeys
				: createAppendedArrayView(previousSummary.anchorEligibleKeys, appendedAnchorEligibleKeys),
		hasLiveAssistantDisplayEntry,
		hasTokenRevealAssistantEntry,
		hasToolCallEntry,
		lastLiveAssistantDisplayEntryIndex: selectLastMatchingIndex(liveAssistantDisplayEntryIndexes),
		lastTokenRevealAssistantEntryIndex: selectLastMatchingIndex(
			tokenRevealAssistantEntryIndexes
		),
		lastToolCallEntryIndex: selectLastMatchingIndex(toolCallEntryIndexes),
		liveAssistantDisplayEntryIndexes,
		tokenRevealAssistantEntryIndexes,
		toolCallEntryIndexes,
		reason,
	};
}

function createAppendedArrayView<T>(
	baseItems: readonly T[],
	appendedItems: readonly T[]
): readonly T[] {
	return createArrayView(baseItems.length + appendedItems.length, (index) => {
		return index < baseItems.length ? baseItems[index] : appendedItems[index - baseItems.length];
	});
}

function createAppendedRowIndexByKey(
	baseIndexByKey: ReadonlyMap<string, number> | undefined,
	appendedIndexByKey: ReadonlyMap<string, number>
): ReadonlyMap<string, number> {
	if (baseIndexByKey === undefined) {
		return appendedIndexByKey;
	}
	return new AppendedRowIndexByKeyMap(baseIndexByKey, appendedIndexByKey);
}

function insertTranscriptViewportRowsSummary(
	previousSummary: TranscriptViewportRowSummary,
	rows: readonly SceneDisplayRow[],
	insertedRows: readonly SceneDisplayRow[],
	insertIndex: number,
	reason: TranscriptViewportRowsReason
): TranscriptViewportRowSummary {
	if (insertedRows.length === 0) {
		return previousSummary;
	}

	let latestUserKey = previousSummary.latestUserKey;
	let lastInsertedUserRowIndex: number | null = null;
	const previousUserRowIndexes = previousSummary.userRowIndexes ?? [];
	let hasLiveAssistantDisplayEntry = previousSummary.hasLiveAssistantDisplayEntry === true;
	let hasTokenRevealAssistantEntry = previousSummary.hasTokenRevealAssistantEntry === true;
	let hasToolCallEntry = previousSummary.hasToolCallEntry === true;
	const previousLiveAssistantDisplayEntryIndexes =
		previousSummary.liveAssistantDisplayEntryIndexes ?? [];
	const previousTokenRevealAssistantEntryIndexes =
		previousSummary.tokenRevealAssistantEntryIndexes ?? [];
	const previousToolCallEntryIndexes = previousSummary.toolCallEntryIndexes ?? [];
	let lastInsertedLiveAssistantDisplayEntryIndex: number | null = null;
	let lastInsertedTokenRevealAssistantEntryIndex: number | null = null;
	let lastInsertedToolCallEntryIndex: number | null = null;
	const insertedRowKeys: string[] = [];
	const insertedAnchorEligibleKeys: string[] = [];
	const insertedRowIndexByKey = new Map<string, number>();
	for (let index = 0; index < insertedRows.length; index += 1) {
		const row = insertedRows[index];
		if (row === undefined) {
			continue;
		}
		const key = getSceneDisplayRowKey(row);
		insertedRowKeys.push(key);
		insertedRowIndexByKey.set(key, insertIndex + index);
		if (row.type === "user") {
			latestUserKey = key;
			lastInsertedUserRowIndex = insertIndex + index;
		}
		if (row.type !== "thinking") {
			insertedAnchorEligibleKeys.push(key);
		}
		if (isLiveAssistantDisplayRow(row)) {
			hasLiveAssistantDisplayEntry = true;
			lastInsertedLiveAssistantDisplayEntryIndex = insertIndex + index;
		}
		if (isTokenRevealAssistantDisplayRow(row)) {
			hasTokenRevealAssistantEntry = true;
			lastInsertedTokenRevealAssistantEntryIndex = insertIndex + index;
		}
		if (row.type === "tool_call") {
			hasToolCallEntry = true;
			lastInsertedToolCallEntryIndex = insertIndex + index;
		}
	}

	const previousRowKeys = previousSummary.rowKeys ?? [];
	const userRowIndexes = createInsertedMatchingIndexes(
		previousUserRowIndexes,
		lastInsertedUserRowIndex === null ? [] : [lastInsertedUserRowIndex],
		insertIndex,
		insertedRows.length
	);
	const liveAssistantDisplayEntryIndexes = createInsertedMatchingIndexes(
		previousLiveAssistantDisplayEntryIndexes,
		lastInsertedLiveAssistantDisplayEntryIndex === null
			? []
			: [lastInsertedLiveAssistantDisplayEntryIndex],
		insertIndex,
		insertedRows.length
	);
	const tokenRevealAssistantEntryIndexes = createInsertedMatchingIndexes(
		previousTokenRevealAssistantEntryIndexes,
		lastInsertedTokenRevealAssistantEntryIndex === null
			? []
			: [lastInsertedTokenRevealAssistantEntryIndex],
		insertIndex,
		insertedRows.length
	);
	const toolCallEntryIndexes = createInsertedMatchingIndexes(
		previousToolCallEntryIndexes,
		lastInsertedToolCallEntryIndex === null ? [] : [lastInsertedToolCallEntryIndex],
		insertIndex,
		insertedRows.length
	);
	const rowKeys = createInsertedArrayView(previousRowKeys, insertedRowKeys, insertIndex);
	const anchorEligibleKeys =
		insertedAnchorEligibleKeys.length === 0
			? previousSummary.anchorEligibleKeys
			: createInsertedArrayView(
					previousSummary.anchorEligibleKeys,
					insertedAnchorEligibleKeys,
					Math.min(insertIndex, previousSummary.anchorEligibleKeys.length)
				);
	const lastKey =
		insertIndex >= previousSummary.count
			? (insertedRowKeys.at(-1) ?? previousSummary.lastKey)
			: previousSummary.lastKey;

	return {
		version: rows.length,
		count: rows.length,
		firstKey: rowKeys[0] ?? null,
		lastKey,
		latestUserKey,
		lastUserRowIndex: selectLastMatchingIndex(userRowIndexes),
		userRowIndexes,
		rowKeys,
		rowIndexByKey: createInsertedRowIndexByKey(
			previousSummary.rowIndexByKey,
			insertedRowIndexByKey,
			insertIndex,
			insertedRows.length
		),
		anchorEligibleKeys,
		hasLiveAssistantDisplayEntry,
		hasTokenRevealAssistantEntry,
		hasToolCallEntry,
		lastLiveAssistantDisplayEntryIndex: selectLastMatchingIndex(liveAssistantDisplayEntryIndexes),
		lastTokenRevealAssistantEntryIndex: selectLastMatchingIndex(
			tokenRevealAssistantEntryIndexes
		),
		lastToolCallEntryIndex: selectLastMatchingIndex(toolCallEntryIndexes),
		liveAssistantDisplayEntryIndexes,
		tokenRevealAssistantEntryIndexes,
		toolCallEntryIndexes,
		changedRange: {
			startIndex: insertIndex,
			endIndex: insertIndex + insertedRows.length,
		},
		reason,
	};
}

function createInsertedArrayView<T>(
	baseItems: readonly T[],
	insertedItems: readonly T[],
	insertIndex: number
): readonly T[] {
	return createArrayView(baseItems.length + insertedItems.length, (index) => {
		if (index < insertIndex) {
			return baseItems[index];
		}
		if (index < insertIndex + insertedItems.length) {
			return insertedItems[index - insertIndex];
		}
		return baseItems[index - insertedItems.length];
	});
}

function createInsertedRowIndexByKey(
	baseIndexByKey: ReadonlyMap<string, number> | undefined,
	insertedIndexByKey: ReadonlyMap<string, number>,
	insertIndex: number,
	insertedCount: number
): ReadonlyMap<string, number> {
	if (baseIndexByKey === undefined) {
		return insertedIndexByKey;
	}
	return new InsertedRowIndexByKeyMap(
		baseIndexByKey,
		insertedIndexByKey,
		insertIndex,
		insertedCount
	);
}

class InsertedRowIndexByKeyMap implements ReadonlyMap<string, number> {
	readonly [Symbol.toStringTag] = "InsertedRowIndexByKeyMap";

	constructor(
		private readonly base: ReadonlyMap<string, number>,
		private readonly inserted: ReadonlyMap<string, number>,
		private readonly insertIndex: number,
		private readonly insertedCount: number
	) {}

	get size(): number {
		let size = this.base.size;
		for (const key of this.inserted.keys()) {
			if (!this.base.has(key)) {
				size += 1;
			}
		}
		return size;
	}

	get(key: string): number | undefined {
		const insertedIndex = this.inserted.get(key);
		if (insertedIndex !== undefined) {
			return insertedIndex;
		}
		const baseIndex = this.base.get(key);
		if (baseIndex === undefined) {
			return undefined;
		}
		return baseIndex >= this.insertIndex ? baseIndex + this.insertedCount : baseIndex;
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	forEach(
		callbackfn: (value: number, key: string, map: ReadonlyMap<string, number>) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, number]> {
		for (const [key] of this.base.entries()) {
			const value = this.get(key);
			if (value !== undefined) {
				yield [key, value];
			}
		}
		for (const [key, value] of this.inserted.entries()) {
			if (!this.base.has(key)) {
				yield [key, value];
			}
		}
	}

	entries(): MapIterator<[string, number]> {
		return this.entryIterator() as unknown as MapIterator<[string, number]>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<number> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<number> {
		return this.valueIterator() as unknown as MapIterator<number>;
	}

	[Symbol.iterator](): MapIterator<[string, number]> {
		return this.entries();
	}
}

class AppendedRowIndexByKeyMap implements ReadonlyMap<string, number> {
	readonly [Symbol.toStringTag] = "AppendedRowIndexByKeyMap";

	constructor(
		private readonly base: ReadonlyMap<string, number>,
		private readonly appended: ReadonlyMap<string, number>
	) {}

	get size(): number {
		let size = this.base.size;
		for (const key of this.appended.keys()) {
			if (!this.base.has(key)) {
				size += 1;
			}
		}
		return size;
	}

	get(key: string): number | undefined {
		return this.appended.get(key) ?? this.base.get(key);
	}

	has(key: string): boolean {
		return this.appended.has(key) || this.base.has(key);
	}

	forEach(
		callbackfn: (value: number, key: string, map: ReadonlyMap<string, number>) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, number]> {
		const yieldedAppendedKeys = new Set<string>();
		for (const [key, value] of this.base.entries()) {
			const appendedValue = this.appended.get(key);
			if (appendedValue !== undefined) {
				yield [key, appendedValue];
				yieldedAppendedKeys.add(key);
				continue;
			}
			yield [key, value];
		}
		for (const [key, value] of this.appended.entries()) {
			if (!yieldedAppendedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	entries(): MapIterator<[string, number]> {
		return this.entryIterator() as unknown as MapIterator<[string, number]>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<number> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<number> {
		return this.valueIterator() as unknown as MapIterator<number>;
	}

	[Symbol.iterator](): MapIterator<[string, number]> {
		return this.entries();
	}
}

function replaceTailRowIndexByKey(
	baseIndexByKey: ReadonlyMap<string, number> | undefined,
	previousTailKey: string | null,
	nextTailKey: string,
	tailIndex: number
): ReadonlyMap<string, number> {
	if (previousTailKey === nextTailKey && baseIndexByKey !== undefined) {
		return baseIndexByKey;
	}
	if (baseIndexByKey === undefined) {
		return new Map([[nextTailKey, tailIndex]]);
	}
	return new ReplacedTailRowIndexByKeyMap(
		baseIndexByKey,
		previousTailKey,
		nextTailKey,
		tailIndex
	);
}

class ReplacedTailRowIndexByKeyMap implements ReadonlyMap<string, number> {
	readonly [Symbol.toStringTag] = "ReplacedTailRowIndexByKeyMap";

	constructor(
		private readonly base: ReadonlyMap<string, number>,
		private readonly previousTailKey: string | null,
		private readonly nextTailKey: string,
		private readonly tailIndex: number
	) {}

	get size(): number {
		let size = this.base.size;
		if (
			this.previousTailKey !== null &&
			this.previousTailKey !== this.nextTailKey &&
			this.base.has(this.previousTailKey)
		) {
			size -= 1;
		}
		if (!this.base.has(this.nextTailKey)) {
			size += 1;
		}
		return size;
	}

	get(key: string): number | undefined {
		if (key === this.nextTailKey) {
			return this.tailIndex;
		}
		if (this.previousTailKey !== null && key === this.previousTailKey) {
			return undefined;
		}
		return this.base.get(key);
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	forEach(
		callbackfn: (value: number, key: string, map: ReadonlyMap<string, number>) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, number]> {
		let yieldedNextTailKey = false;
		for (const [key, value] of this.base.entries()) {
			if (this.previousTailKey !== null && key === this.previousTailKey) {
				continue;
			}
			if (key === this.nextTailKey) {
				yield [key, this.tailIndex];
				yieldedNextTailKey = true;
				continue;
			}
			yield [key, value];
		}
		if (!yieldedNextTailKey) {
			yield [this.nextTailKey, this.tailIndex];
		}
	}

	entries(): MapIterator<[string, number]> {
		return this.entryIterator() as unknown as MapIterator<[string, number]>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<number> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<number> {
		return this.valueIterator() as unknown as MapIterator<number>;
	}

	[Symbol.iterator](): MapIterator<[string, number]> {
		return this.entries();
	}
}

function createTruncatedRowIndexByKey(
	baseIndexByKey: ReadonlyMap<string, number> | undefined,
	length: number
): ReadonlyMap<string, number> {
	if (baseIndexByKey === undefined) {
		return new Map();
	}
	return new TruncatedRowIndexByKeyMap(baseIndexByKey, length);
}

class TruncatedRowIndexByKeyMap implements ReadonlyMap<string, number> {
	readonly [Symbol.toStringTag] = "TruncatedRowIndexByKeyMap";

	constructor(
		private readonly base: ReadonlyMap<string, number>,
		private readonly length: number
	) {}

	get size(): number {
		return Math.min(this.base.size, this.length);
	}

	get(key: string): number | undefined {
		const index = this.base.get(key);
		return index !== undefined && index < this.length ? index : undefined;
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	forEach(
		callbackfn: (value: number, key: string, map: ReadonlyMap<string, number>) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, number]> {
		for (const [key, index] of this.base.entries()) {
			if (index < this.length) {
				yield [key, index];
			}
		}
	}

	entries(): MapIterator<[string, number]> {
		return this.entryIterator() as unknown as MapIterator<[string, number]>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<number> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<number> {
		return this.valueIterator() as unknown as MapIterator<number>;
	}

	[Symbol.iterator](): MapIterator<[string, number]> {
		return this.entries();
	}
}

function createReplacedTailArrayView<T>(baseItems: readonly T[], tailItem: T): readonly T[] {
	return createArrayView(baseItems.length, (index) => {
		return index === baseItems.length - 1 ? tailItem : baseItems[index];
	});
}

function createArrayView<T>(length: number, getItem: (index: number) => T | undefined): readonly T[] {
	const target = new Array<T>(length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield getItem(index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return getItem(index);
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
					value: getItem(index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	});
}

function createArrayLikeOwnKeys(length: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < length; index += 1) {
		keys.push(String(index));
	}
	keys.push("length");
	return keys;
}

function replaceTranscriptViewportRowsTailSummary(
	previousSummary: TranscriptViewportRowSummary,
	rows: readonly SceneDisplayRow[],
	reason: TranscriptViewportRowsReason
): TranscriptViewportRowSummary {
	const tailRow = rows.at(-1);
	if (tailRow === undefined) {
		return buildTranscriptViewportRowsSummary(rows, reason);
	}

	const previousTailKey = previousSummary.lastKey;
	const nextTailKey = getSceneDisplayRowKey(tailRow);
	const nextUserRowIndexes = replaceTailMatchingIndexes(
		previousSummary.userRowIndexes ?? [],
		rows.length,
		(row) => row.type === "user",
		tailRow
	);
	const nextLiveAssistantDisplayEntryIndexes = replaceTailMatchingIndexes(
		previousSummary.liveAssistantDisplayEntryIndexes ?? [],
		rows.length,
		isLiveAssistantDisplayRow,
		tailRow
	);
	const nextTokenRevealAssistantEntryIndexes = replaceTailMatchingIndexes(
		previousSummary.tokenRevealAssistantEntryIndexes ?? [],
		rows.length,
		isTokenRevealAssistantDisplayRow,
		tailRow
	);
	const nextToolCallEntryIndexes = replaceTailMatchingIndexes(
		previousSummary.toolCallEntryIndexes ?? [],
		rows.length,
		(row) => row.type === "tool_call",
		tailRow
	);
	const rowKeys = createReplacedTailArrayView(previousSummary.rowKeys ?? [], nextTailKey);
	const rowIndexByKey = replaceTailRowIndexByKey(
		previousSummary.rowIndexByKey,
		previousTailKey,
		nextTailKey,
		rows.length - 1
	);
	let anchorEligibleKeys = previousSummary.anchorEligibleKeys;
	if (tailRow.type === "thinking") {
		anchorEligibleKeys =
			previousTailKey !== null && previousSummary.anchorEligibleKeys.at(-1) === previousTailKey
				? createArrayView(previousSummary.anchorEligibleKeys.length - 1, (index) => {
						return previousSummary.anchorEligibleKeys[index];
					})
				: previousSummary.anchorEligibleKeys;
	} else if (previousTailKey !== nextTailKey) {
		if (previousTailKey !== null && previousSummary.anchorEligibleKeys.at(-1) === previousTailKey) {
			anchorEligibleKeys = createReplacedTailArrayView(
				previousSummary.anchorEligibleKeys,
				nextTailKey
			);
		} else {
			anchorEligibleKeys = createAppendedArrayView(previousSummary.anchorEligibleKeys, [
				nextTailKey,
			]);
		}
	}

	return {
		version: rows.length,
		count: rows.length,
		firstKey: previousSummary.firstKey,
		lastKey: nextTailKey,
		latestUserKey: selectLatestKeyFromIndexes(rowKeys, nextUserRowIndexes),
		lastUserRowIndex: selectLastMatchingIndex(nextUserRowIndexes),
		userRowIndexes: nextUserRowIndexes,
		rowKeys,
		rowIndexByKey,
		anchorEligibleKeys,
		hasLiveAssistantDisplayEntry: nextLiveAssistantDisplayEntryIndexes.length > 0,
		hasTokenRevealAssistantEntry: nextTokenRevealAssistantEntryIndexes.length > 0,
		hasToolCallEntry: nextToolCallEntryIndexes.length > 0,
		lastLiveAssistantDisplayEntryIndex: selectLastMatchingIndex(
			nextLiveAssistantDisplayEntryIndexes
		),
		lastTokenRevealAssistantEntryIndex: selectLastMatchingIndex(
			nextTokenRevealAssistantEntryIndexes
		),
		lastToolCallEntryIndex: selectLastMatchingIndex(nextToolCallEntryIndexes),
		liveAssistantDisplayEntryIndexes: nextLiveAssistantDisplayEntryIndexes,
		tokenRevealAssistantEntryIndexes: nextTokenRevealAssistantEntryIndexes,
		toolCallEntryIndexes: nextToolCallEntryIndexes,
		reason,
	};
}

function truncateMatchingIndexes(
	indexes: readonly number[],
	nextLength: number
): readonly number[] {
	let keepCount = 0;
	while (keepCount < indexes.length && indexes[keepCount]! < nextLength) {
		keepCount += 1;
	}
	return keepCount === indexes.length ? indexes : indexes.slice(0, keepCount);
}

function appendMatchingIndexes(
	baseIndexes: readonly number[],
	rows: readonly SceneDisplayRow[],
	startIndex: number,
	predicate: (row: SceneDisplayRow) => boolean
): readonly number[] {
	const appendedIndexes: number[] = [];
	for (let index = startIndex; index < rows.length; index += 1) {
		const row = rows[index];
		if (row !== undefined && predicate(row)) {
			appendedIndexes.push(index);
		}
	}
	return appendedIndexes.length === 0 ? baseIndexes : baseIndexes.concat(appendedIndexes);
}

function createInsertedMatchingIndexes(
	baseIndexes: readonly number[],
	insertedIndexes: readonly number[],
	insertIndex: number,
	insertedCount: number
): readonly number[] {
	if (insertedCount === 0) {
		return baseIndexes;
	}
	const nextIndexes: number[] = [];
	for (const index of baseIndexes) {
		nextIndexes.push(index >= insertIndex ? index + insertedCount : index);
	}
	for (const insertedIndex of insertedIndexes) {
		nextIndexes.push(insertedIndex);
	}
	nextIndexes.sort((left, right) => left - right);
	return nextIndexes;
}

function replaceTailMatchingIndexes(
	baseIndexes: readonly number[],
	length: number,
	predicate: (row: SceneDisplayRow) => boolean,
	tailRow: SceneDisplayRow
): readonly number[] {
	const tailIndex = length - 1;
	const hadTailMatch = baseIndexes.length > 0 && baseIndexes[baseIndexes.length - 1] === tailIndex;
	const nextTailMatch = predicate(tailRow);
	if (hadTailMatch === nextTailMatch) {
		return baseIndexes;
	}
	if (nextTailMatch) {
		return baseIndexes.concat([tailIndex]);
	}
	return baseIndexes.slice(0, -1);
}

function selectLastMatchingIndex(indexes: readonly number[]): number | null {
	return indexes.length > 0 ? (indexes[indexes.length - 1] ?? null) : null;
}

function selectLatestKeyFromIndexes(
	rowKeys: readonly string[],
	indexes: readonly number[]
): string | null {
	const lastIndex = selectLastMatchingIndex(indexes);
	return lastIndex === null ? null : (rowKeys[lastIndex] ?? null);
}

function isLiveAssistantDisplayRow(row: SceneDisplayRow): boolean {
	return (
		row.type === "assistant_merged" &&
		(row.isStreaming === true || row.tokenRevealCss !== undefined)
	);
}

function isTokenRevealAssistantDisplayRow(row: SceneDisplayRow): boolean {
	return row.type === "assistant_merged" && row.tokenRevealCss !== undefined;
}

function updateThinkingDurationSources(
	previousSources: ThinkingDurationSource[],
	rows: readonly SceneDisplayRow[],
	startIndex: number
): ThinkingDurationSource[] {
	previousSources.length = startIndex;
	for (let index = startIndex; index < rows.length; index += 1) {
		previousSources[index] = buildThinkingDurationSource(rows, index);
	}
	return previousSources;
}

function truncateThinkingDurationSources(
	previousSources: ThinkingDurationSource[],
	length: number
): ThinkingDurationSource[] {
	previousSources.length = length;
	return previousSources;
}

function buildThinkingDurationSources(rows: readonly SceneDisplayRow[]): ThinkingDurationSource[] {
	const sources: ThinkingDurationSource[] = [];
	let nextDurationBoundary:
		| { readonly type: "thinking" }
		| { readonly type: "timestamp"; readonly timestampMs: number }
		| null = null;

	for (let index = rows.length - 1; index >= 0; index -= 1) {
		const row = rows[index];
		sources[index] = buildThinkingDurationSourceFromBoundary(row, nextDurationBoundary);

		if (row === undefined) {
			continue;
		}
		if (row.type === "thinking") {
			nextDurationBoundary = { type: "thinking" };
			continue;
		}
		const timestampMs = getSceneDisplayRowTimestampMs(row);
		if (timestampMs !== null) {
			nextDurationBoundary = { type: "timestamp", timestampMs };
		}
	}
	return sources;
}

function buildThinkingDurationSourceFromBoundary(
	row: SceneDisplayRow | undefined,
	nextDurationBoundary:
		| { readonly type: "thinking" }
		| { readonly type: "timestamp"; readonly timestampMs: number }
		| null
): ThinkingDurationSource {
	if (row === undefined) {
		return { type: "none" };
	}

	if (row.type === "thinking") {
		return row.startedAtMs === null || row.startedAtMs === undefined
			? { type: "none" }
			: { type: "elapsed", startedAtMs: row.startedAtMs };
	}

	if (row.type !== "assistant_merged" || !hasThoughtChunks(row)) {
		return { type: "none" };
	}

	const startedAtMs = row.timestamp?.getTime();
	if (startedAtMs === undefined) {
		return { type: "none" };
	}

	if (nextDurationBoundary?.type === "thinking") {
		return { type: "elapsed", startedAtMs };
	}
	if (nextDurationBoundary?.type === "timestamp") {
		return {
			type: "fixed",
			durationMs: Math.max(0, nextDurationBoundary.timestampMs - startedAtMs),
		};
	}

	const endedAtMs = row.latestTimestamp?.getTime();
	if (endedAtMs !== undefined && endedAtMs > startedAtMs) {
		return {
			type: "fixed",
			durationMs: Math.max(0, endedAtMs - startedAtMs),
		};
	}

	if (row.isStreaming === true) {
		return { type: "elapsed", startedAtMs };
	}

	return { type: "none" };
}

function buildThinkingDurationSource(
	rows: readonly SceneDisplayRow[],
	index: number
): ThinkingDurationSource {
	const row = rows[index];
	if (row === undefined) {
		return { type: "none" };
	}

	if (row.type === "thinking") {
		return row.startedAtMs === null || row.startedAtMs === undefined
			? { type: "none" }
			: { type: "elapsed", startedAtMs: row.startedAtMs };
	}

	if (row.type !== "assistant_merged" || !hasThoughtChunks(row)) {
		return { type: "none" };
	}

	const startedAtMs = row.timestamp?.getTime();
	if (startedAtMs === undefined) {
		return { type: "none" };
	}

	for (let offset = index + 1; offset < rows.length; offset += 1) {
		const nextRow = rows[offset];
		if (nextRow === undefined) {
			continue;
		}

		if (nextRow.type === "thinking") {
			return { type: "elapsed", startedAtMs };
		}

		const nextTimestampMs = getSceneDisplayRowTimestampMs(nextRow);
		if (nextTimestampMs !== null) {
			return {
				type: "fixed",
				durationMs: Math.max(0, nextTimestampMs - startedAtMs),
			};
		}
	}

	const endedAtMs = row.latestTimestamp?.getTime();
	if (endedAtMs !== undefined && endedAtMs > startedAtMs) {
		return {
			type: "fixed",
			durationMs: Math.max(0, endedAtMs - startedAtMs),
		};
	}

	if (row.isStreaming === true) {
		return { type: "elapsed", startedAtMs };
	}

	return { type: "none" };
}

function hasThoughtChunks(row: SceneDisplayRow): boolean {
	return (
		row.type === "assistant_merged" && row.message.chunks.some((chunk) => chunk.type === "thought")
	);
}

function isSamePrefix(
	previous: readonly SceneDisplayRow[],
	next: readonly SceneDisplayRow[],
	length: number
): boolean {
	if (next.length < length || previous.length < length) {
		return false;
	}

	for (let index = 0; index < length; index += 1) {
		if (previous[index] !== next[index]) {
			return false;
		}
	}

	return true;
}
