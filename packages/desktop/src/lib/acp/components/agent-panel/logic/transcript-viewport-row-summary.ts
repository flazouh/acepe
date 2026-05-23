import {
	getSceneDisplayRowKey,
	getSceneDisplayRowTimestampMs,
	THINKING_DISPLAY_ENTRY,
	type SceneDisplayRow,
} from "./scene-display-rows.js";
import {
	getSceneDisplayRowArrayPatch,
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
	rowKeys?: readonly string[];
	rowIndexByKey?: ReadonlyMap<string, number>;
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
		rowIndexByKey: new Map(),
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
					previousSummary = patchedSummary;
					thinkingDurationSources = updateThinkingDurationSources(
						thinkingDurationSources,
						rows,
						Math.max(0, firstPatchedIndex - 1)
					);
					previousRows = rows;
					return previousSummary;
				}
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

			const truncatedRows = getSceneDisplayRowArrayTruncation(rows);
			if (previousRows !== null && truncatedRows?.baseRows === previousRows) {
				previousSummary = truncateTranscriptViewportRowsSummary(
					previousSummary,
					previousRows,
					rows,
					reason
				);
				thinkingDurationSources = truncateThinkingDurationSources(
					thinkingDurationSources,
					rows.length
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
		latestUserKey: didRemoveRowMatching(removedRows, (row) => row.type === "user")
			? findLatestUserKeyFromEnd(rows)
			: previousSummary.latestUserKey,
		rowKeys,
		rowIndexByKey,
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
	const rowIndexByKey = new Map<string, number>();
	const anchorEligibleKeys: string[] = [];
	let hasLiveAssistantDisplayEntry = false;
	let hasTokenRevealAssistantEntry = false;
	let hasToolCallEntry = false;
	for (const row of rows) {
		const key = getSceneDisplayRowKey(row);
		rowIndexByKey.set(key, rowKeys.length);
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
		rowIndexByKey,
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
		latestUserKey:
			tailRow.type === "user"
				? nextTailKey
				: previousSummary.latestUserKey === previousTailKey
					? findLatestUserKeyBeforeTail(rows)
					: previousSummary.latestUserKey,
		rowKeys,
		rowIndexByKey,
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

function truncateThinkingDurationSources(
	previousSources: ThinkingDurationSource[],
	length: number
): ThinkingDurationSource[] {
	previousSources.length = length;
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
