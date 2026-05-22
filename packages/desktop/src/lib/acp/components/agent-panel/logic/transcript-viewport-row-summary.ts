import {
	getSceneDisplayRowKey,
	getSceneDisplayRowTimestampMs,
	type SceneDisplayRow,
} from "./scene-display-rows.js";

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
	applyRows(input: {
		rows: readonly SceneDisplayRow[];
		reason: TranscriptViewportRowsReason;
	}): TranscriptViewportRowSummary;
	selectSummary(): TranscriptViewportRowSummary;
	selectThinkingDurationMs(index: number, nowMs?: number): number | null;
}

type ThinkingDurationSource =
	| { readonly type: "none" }
	| { readonly type: "fixed"; readonly durationMs: number }
	| { readonly type: "elapsed"; readonly startedAtMs: number };

export function createTranscriptViewportRowsReadModel(): TranscriptViewportRowsReadModel {
	let previousRows: readonly SceneDisplayRow[] | null = null;
	let previousSummary: TranscriptViewportRowSummary = createEmptyTranscriptViewportRows();
	let thinkingDurationSources: readonly ThinkingDurationSource[] = [];

	return {
		applyRows({ rows, reason }) {
			if (rows === previousRows) {
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

			previousSummary = buildTranscriptViewportRowsSummary(rows, reason);
			thinkingDurationSources = buildThinkingDurationSources(rows);
			previousRows = rows;
			return previousSummary;
		},
		selectSummary() {
			return previousSummary;
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
	let nextRowKeys: string[] | null = null;
	let nextAnchorEligibleKeys: string[] | null = null;
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
		nextRowKeys ??= previousRowKeys.slice();
		nextRowKeys.push(key);
		if (row.type === "user") {
			latestUserKey = key;
		}
		if (row.type !== "thinking") {
			nextAnchorEligibleKeys ??= previousSummary.anchorEligibleKeys.slice();
			nextAnchorEligibleKeys.push(key);
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
		rowKeys: nextRowKeys ?? previousSummary.rowKeys,
		anchorEligibleKeys: nextAnchorEligibleKeys ?? previousSummary.anchorEligibleKeys,
		hasLiveAssistantDisplayEntry,
		hasTokenRevealAssistantEntry,
		hasToolCallEntry,
		reason,
	};
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
	const rowKeys = (previousSummary.rowKeys ?? []).slice(0, -1).concat(nextTailKey);
	let anchorEligibleKeys = previousSummary.anchorEligibleKeys;
	if (tailRow.type === "thinking") {
		anchorEligibleKeys =
			previousTailKey !== null &&
			previousSummary.anchorEligibleKeys.at(-1) === previousTailKey
				? previousSummary.anchorEligibleKeys.slice(0, -1)
				: previousSummary.anchorEligibleKeys;
	} else if (previousTailKey !== nextTailKey) {
		if (
			previousTailKey !== null &&
			previousSummary.anchorEligibleKeys.at(-1) === previousTailKey
		) {
			anchorEligibleKeys = previousSummary.anchorEligibleKeys
				.slice(0, -1)
				.concat(nextTailKey);
		} else {
			anchorEligibleKeys = previousSummary.anchorEligibleKeys.concat(nextTailKey);
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
	previousSources: readonly ThinkingDurationSource[],
	rows: readonly SceneDisplayRow[],
	startIndex: number
): readonly ThinkingDurationSource[] {
	const nextSources = previousSources.slice(0, startIndex);
	for (let index = startIndex; index < rows.length; index += 1) {
		nextSources[index] = buildThinkingDurationSource(rows, index);
	}
	return nextSources;
}

function buildThinkingDurationSources(
	rows: readonly SceneDisplayRow[]
): readonly ThinkingDurationSource[] {
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
		row.type === "assistant_merged" &&
		row.message.chunks.some((chunk) => chunk.type === "thought")
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
