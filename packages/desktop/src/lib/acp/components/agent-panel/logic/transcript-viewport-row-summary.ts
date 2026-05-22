import {
	getSceneDisplayRowKey,
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
	anchorEligibleKeys: readonly string[];
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
		anchorEligibleKeys: [],
	};
}

export interface TranscriptViewportRowsReadModel {
	applyRows(input: {
		rows: readonly SceneDisplayRow[];
		reason: TranscriptViewportRowsReason;
	}): TranscriptViewportRowSummary;
	selectSummary(): TranscriptViewportRowSummary;
}

export function createTranscriptViewportRowsReadModel(): TranscriptViewportRowsReadModel {
	let previousRows: readonly SceneDisplayRow[] | null = null;
	let previousSummary: TranscriptViewportRowSummary = createEmptyTranscriptViewportRows();

	return {
		applyRows({ rows, reason }) {
			if (rows === previousRows) {
				return previousSummary;
			}

			if (previousRows !== null && isSamePrefix(previousRows, rows, previousRows.length)) {
				previousSummary = appendTranscriptViewportRowsSummary(previousSummary, rows, reason);
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
					rows,
					reason
				);
				previousRows = rows;
				return previousSummary;
			}

			previousSummary = buildTranscriptViewportRowsSummary(rows, reason);
			previousRows = rows;
			return previousSummary;
		},
		selectSummary() {
			return previousSummary;
		},
	};
}

export function buildTranscriptViewportRowsSummary(
	rows: readonly SceneDisplayRow[],
	reason: TranscriptViewportRowsReason
): TranscriptViewportRowSummary {
	let latestUserKey: string | null = null;
	const anchorEligibleKeys: string[] = [];
	for (const row of rows) {
		const key = getSceneDisplayRowKey(row);
		if (row.type === "user") {
			latestUserKey = key;
		}
		if (row.type !== "thinking") {
			anchorEligibleKeys.push(key);
		}
	}

	const lastRow = rows.at(-1);
	return {
		version: rows.length,
		count: rows.length,
		firstKey: rows[0] === undefined ? null : getSceneDisplayRowKey(rows[0]),
		lastKey: lastRow === undefined ? null : getSceneDisplayRowKey(lastRow),
		latestUserKey,
		anchorEligibleKeys,
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
	let nextAnchorEligibleKeys: string[] | null = null;
	for (let index = previousSummary.count; index < rows.length; index += 1) {
		const row = rows[index];
		if (row === undefined) {
			continue;
		}

		const key = getSceneDisplayRowKey(row);
		if (row.type === "user") {
			latestUserKey = key;
		}
		if (row.type !== "thinking") {
			nextAnchorEligibleKeys ??= previousSummary.anchorEligibleKeys.slice();
			nextAnchorEligibleKeys.push(key);
		}
	}

	const lastRow = rows.at(-1);
	return {
		version: rows.length,
		count: rows.length,
		firstKey:
			previousSummary.firstKey ?? (rows[0] === undefined ? null : getSceneDisplayRowKey(rows[0])),
		lastKey: lastRow === undefined ? null : getSceneDisplayRowKey(lastRow),
		latestUserKey,
		anchorEligibleKeys: nextAnchorEligibleKeys ?? previousSummary.anchorEligibleKeys,
		reason,
	};
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
		anchorEligibleKeys,
		reason,
	};
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
