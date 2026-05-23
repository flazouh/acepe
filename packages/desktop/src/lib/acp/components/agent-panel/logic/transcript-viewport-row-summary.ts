import {
	getSceneDisplayRowKey,
	getSceneDisplayRowTimestampMs,
	THINKING_DISPLAY_ENTRY,
	type SceneDisplayRow,
} from "./scene-display-rows.js";
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
	rowKeys?: readonly string[];
	anchorEligibleKeys: readonly string[];
	hasLiveAssistantDisplayEntry?: boolean;
	hasTokenRevealAssistantEntry?: boolean;
	hasToolCallEntry?: boolean;
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
		rowKeys: [],
		anchorEligibleKeys: [],
		hasLiveAssistantDisplayEntry: false,
		hasTokenRevealAssistantEntry: false,
		hasToolCallEntry: false,
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

			const singleAppendRows = singleAppendRowsMetadata.get(rows);
			if (previousRows !== null && singleAppendRows?.baseRows === previousRows) {
				previousSummary = appendTranscriptViewportRowsSummary(previousSummary, rows, reason);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					Math.max(0, previousRows.length - 1)
				);
				previousRows = rows;
				return previousSummary;
			}

			if (previousRows !== null && isSamePrefix(previousRows, rows, previousRows.length)) {
				previousSummary = appendTranscriptViewportRowsSummary(previousSummary, rows, reason);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					Math.max(0, previousRows.length - 1)
				);
				previousRows = rows;
				return previousSummary;
			}

			if (
				previousRows !== null &&
				rows.length === previousRows.length &&
				rows.length > 0 &&
				isSamePrefix(previousRows, rows, rows.length - 1)
			) {
				previousSummary = replaceTranscriptViewportRowsTailSummary(
					previousSummary,
					previousRows,
					rows,
					reason
				);
				thinkingDurationSources = updateThinkingDurationSources(
					thinkingDurationSources,
					rows,
					Math.max(0, rows.length - 2)
				);
				previousRows = rows;
				return previousSummary;
			}

			if (
				previousRows !== null &&
				rows.length < previousRows.length &&
				isSamePrefix(previousRows, rows, rows.length)
			) {
				previousSummary = truncateTranscriptViewportRowsSummary(
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
				previousRows = rows;
				return previousSummary;
			}

			previousSummary = buildTranscriptViewportRowsSummary(rows, reason);
			thinkingDurationSources = buildThinkingDurationSources(rows);
			previousRows = rows;
			return previousSummary;
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

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
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
	const lastRow = rows.at(-1);
	const lastKey = lastRow === undefined ? null : getSceneDisplayRowKey(lastRow);
	const previousRowKeys = previousSummary.rowKeys ?? [];
	const rowKeys = createArrayView(rows.length, (index) => previousRowKeys[index]);
	const anchorEligibleKeys = createArrayView(countAnchorEligibleRows(rows), (index) => {
		return previousSummary.anchorEligibleKeys[index];
	});

	return {
		version: rows.length,
		count: rows.length,
		firstKey: previousSummary.firstKey,
		lastKey,
		latestUserKey: didRemoveRowMatching(removedRows, (row) => row.type === "user")
			? findLatestUserKeyFromEnd(rows)
			: previousSummary.latestUserKey,
		rowKeys,
		anchorEligibleKeys,
		hasLiveAssistantDisplayEntry: truncateBooleanFact(
			previousSummary.hasLiveAssistantDisplayEntry === true,
			removedRows,
			rows,
			isLiveAssistantDisplayRow
		),
		hasTokenRevealAssistantEntry: truncateBooleanFact(
			previousSummary.hasTokenRevealAssistantEntry === true,
			removedRows,
			rows,
			isTokenRevealAssistantDisplayRow
		),
		hasToolCallEntry: truncateBooleanFact(
			previousSummary.hasToolCallEntry === true,
			removedRows,
			rows,
			(row) => row.type === "tool_call"
		),
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

function truncateBooleanFact(
	previousValue: boolean,
	removedRows: readonly SceneDisplayRow[],
	rows: readonly SceneDisplayRow[],
	predicate: (row: SceneDisplayRow) => boolean
): boolean {
	if (!previousValue || !didRemoveRowMatching(removedRows, predicate)) {
		return previousValue;
	}

	return rows.some(predicate);
}

function didRemoveRowMatching(
	removedRows: readonly SceneDisplayRow[],
	predicate: (row: SceneDisplayRow) => boolean
): boolean {
	return removedRows.some(predicate);
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
	const rowKeys: string[] = [];
	const anchorEligibleKeys: string[] = [];
	let hasLiveAssistantDisplayEntry = false;
	let hasTokenRevealAssistantEntry = false;
	let hasToolCallEntry = false;
	for (const row of rows) {
		const key = getSceneDisplayRowKey(row);
		rowKeys.push(key);
		if (row.type === "user") {
			latestUserKey = key;
		}
		if (row.type !== "thinking") {
			anchorEligibleKeys.push(key);
		}
		if (isLiveAssistantDisplayRow(row)) {
			hasLiveAssistantDisplayEntry = true;
		}
		if (isTokenRevealAssistantDisplayRow(row)) {
			hasTokenRevealAssistantEntry = true;
		}
		if (row.type === "tool_call") {
			hasToolCallEntry = true;
		}
	}

	const lastRow = rows.at(-1);
	return {
		version: rows.length,
		count: rows.length,
		firstKey: rows[0] === undefined ? null : getSceneDisplayRowKey(rows[0]),
		lastKey: lastRow === undefined ? null : getSceneDisplayRowKey(lastRow),
		latestUserKey,
		rowKeys,
		anchorEligibleKeys,
		hasLiveAssistantDisplayEntry,
		hasTokenRevealAssistantEntry,
		hasToolCallEntry,
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
	const previousRowKeys = previousSummary.rowKeys ?? [];
	for (let index = previousSummary.count; index < rows.length; index += 1) {
		const row = rows[index];
		if (row === undefined) {
			continue;
		}

		const key = getSceneDisplayRowKey(row);
		appendedRowKeys ??= [];
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
		rowKeys:
			appendedRowKeys === null
				? previousSummary.rowKeys
				: createAppendedArrayView(previousRowKeys, appendedRowKeys),
		anchorEligibleKeys:
			appendedAnchorEligibleKeys === null
				? previousSummary.anchorEligibleKeys
				: createAppendedArrayView(previousSummary.anchorEligibleKeys, appendedAnchorEligibleKeys),
		hasLiveAssistantDisplayEntry,
		hasTokenRevealAssistantEntry,
		hasToolCallEntry,
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
	previousRows: readonly SceneDisplayRow[],
	rows: readonly SceneDisplayRow[],
	reason: TranscriptViewportRowsReason
): TranscriptViewportRowSummary {
	const tailRow = rows.at(-1);
	if (tailRow === undefined) {
		return buildTranscriptViewportRowsSummary(rows, reason);
	}

	const previousTailKey = previousSummary.lastKey;
	const previousTailRow = previousRows.at(-1);
	const nextTailKey = getSceneDisplayRowKey(tailRow);
	const rowKeys = createReplacedTailArrayView(previousSummary.rowKeys ?? [], nextTailKey);
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
		latestUserKey:
			tailRow.type === "user"
				? nextTailKey
				: previousSummary.latestUserKey === previousTailKey
					? findLatestUserKeyBeforeTail(rows)
					: previousSummary.latestUserKey,
		rowKeys,
		anchorEligibleKeys,
		hasLiveAssistantDisplayEntry: replaceTailBooleanFact(
			previousSummary.hasLiveAssistantDisplayEntry === true,
			previousRows,
			previousTailRow,
			tailRow,
			isLiveAssistantDisplayRow
		),
		hasTokenRevealAssistantEntry: replaceTailBooleanFact(
			previousSummary.hasTokenRevealAssistantEntry === true,
			previousRows,
			previousTailRow,
			tailRow,
			isTokenRevealAssistantDisplayRow
		),
		hasToolCallEntry: replaceTailBooleanFact(
			previousSummary.hasToolCallEntry === true,
			previousRows,
			previousTailRow,
			tailRow,
			(row) => row.type === "tool_call"
		),
		reason,
	};
}

function replaceTailBooleanFact(
	previousValue: boolean,
	previousRows: readonly SceneDisplayRow[],
	previousTailRow: SceneDisplayRow | undefined,
	nextTailRow: SceneDisplayRow,
	predicate: (row: SceneDisplayRow) => boolean
): boolean {
	if (predicate(nextTailRow)) {
		return true;
	}

	if (previousTailRow !== undefined && predicate(previousTailRow)) {
		for (let index = 0; index < previousRows.length - 1; index += 1) {
			const row = previousRows[index];
			if (row !== undefined && predicate(row)) {
				return true;
			}
		}
		return false;
	}

	return previousValue;
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

function buildThinkingDurationSources(rows: readonly SceneDisplayRow[]): ThinkingDurationSource[] {
	const sources: ThinkingDurationSource[] = [];
	for (let index = 0; index < rows.length; index += 1) {
		sources[index] = buildThinkingDurationSource(rows, index);
	}
	return sources;
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

function findLatestUserKeyBeforeTail(rows: readonly SceneDisplayRow[]): string | null {
	for (let index = rows.length - 2; index >= 0; index -= 1) {
		const row = rows[index];
		if (row?.type === "user") {
			return getSceneDisplayRowKey(row);
		}
	}

	return null;
}

function findLatestUserKeyFromEnd(rows: readonly SceneDisplayRow[]): string | null {
	for (let index = rows.length - 1; index >= 0; index -= 1) {
		const row = rows[index];
		if (row?.type === "user") {
			return getSceneDisplayRowKey(row);
		}
	}

	return null;
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
