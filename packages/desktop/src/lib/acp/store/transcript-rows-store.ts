/**
 * Version-aware ordered-rows store — the canonical row consumer for the
 * DOM-authority transcript viewport. It holds the Rust-emitted
 * {@link TranscriptViewportRow}s in canonical order, keyed on the Acepe-owned
 * `rowId` + `version`, and nothing else.
 *
 * Deliberately pixel-free: the reducer inputs ({@link RowsPush}/{@link RowsDelta})
 * carry no offset/height/mode/scrollTop fields. Those are dropped at the wire
 * boundary (the `.svelte.ts` adapter maps `ViewportBufferPush`/`Delta` → these),
 * so the dual-authority "claimed layout vs rendered rows" void is unrepresentable
 * here. Scroll geometry is owned by the DOM (see `@acepe/ui` stick-to-bottom),
 * not by this store.
 *
 * Order is canonical: it is the push/delta arrival sequence (prepend ++ surviving
 * ++ appended). This store never re-sorts by id, timestamp, or anything UI-side.
 */

import type {
	SessionGraphRevision,
	SessionOpenTranscriptRowPage,
	TranscriptViewportRow,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../services/acp-types.js";

/** Pixel-free push input — `ViewportBufferPush` narrowed to its canonical rows. */
export type RowsPush = {
	readonly sessionId: string;
	readonly graphRevision?: SessionGraphRevision;
	/** Total-order authority shared across command-reply and event channels. */
	readonly emissionSeq: number;
	readonly rows: readonly TranscriptViewportRow[];
};

export type RowsPage = {
	readonly sessionId: string;
	readonly projectionVersion: string;
	readonly startRowIndex: number;
	readonly totalRowCount: number;
	readonly transcriptRevision: number;
	readonly graphRevision: number;
	readonly lastEventSeq: number;
	readonly rows: readonly TranscriptViewportRow[];
};

/** Pixel-free delta input — `ViewportBufferDelta` narrowed to its row mutations. */
export type RowsDelta = {
	readonly graphRevision?: SessionGraphRevision;
	readonly emissionSeq: number;
	readonly prependedRows: readonly TranscriptViewportRow[];
	readonly appendedRows: readonly TranscriptViewportRow[];
	readonly removedRowIds: readonly string[];
};

export type TranscriptRowsState = {
	readonly sessionId: string | null;
	/** `emissionSeq` of the last applied push/delta; `-1` when empty. */
	readonly emissionSeq: number;
	readonly revision: SessionGraphRevision | null;
	readonly projectionVersion: string | null;
	readonly totalRowCount: number | null;
	readonly loadedStartRowIndex: number | null;
	readonly loadedEndRowIndex: number | null;
	readonly order: readonly string[];
	readonly byId: ReadonlyMap<string, TranscriptViewportRow>;
	readonly rows: readonly TranscriptViewportRow[];
};

export type RowsApplyStatus = "applied" | "stale" | "gap";

/**
 * Wire boundary: narrow a `ViewportBufferPush` to its canonical rows, dropping
 * every pixel/offset/height/mode/scrollTop field. This is where the pixels die —
 * past this point nothing in the new viewport path can read them.
 */
export function rowsPushFromBuffer(push: ViewportBufferPush): RowsPush {
	return {
		sessionId: push.sessionId,
		graphRevision: push.graphRevision,
		emissionSeq: push.emissionSeq,
		rows: push.rows,
	};
}

export function rowsPageFromInitialPage(
	sessionId: string,
	page: SessionOpenTranscriptRowPage
): RowsPage {
	return {
		sessionId,
		projectionVersion: page.projectionVersion,
		startRowIndex: page.startRowIndex,
		totalRowCount: page.totalRowCount,
		transcriptRevision: page.transcriptRevision,
		graphRevision: page.graphRevision,
		lastEventSeq: page.lastEventSeq,
		rows: page.rows,
	};
}

/** Wire boundary: narrow a `ViewportBufferDelta` to its row mutations. */
export function rowsDeltaFromBuffer(delta: ViewportBufferDelta): RowsDelta {
	return {
		graphRevision: delta.graphRevision,
		emissionSeq: delta.emissionSeq,
		prependedRows: delta.prependedRows,
		appendedRows: delta.appendedRows,
		removedRowIds: delta.removedRowIds,
	};
}

export const EMPTY_TRANSCRIPT_ROWS_STATE: TranscriptRowsState = {
	sessionId: null,
	emissionSeq: -1,
	revision: null,
	projectionVersion: null,
	totalRowCount: null,
	loadedStartRowIndex: null,
	loadedEndRowIndex: null,
	order: [],
	byId: new Map(),
	rows: [],
};

/**
 * Render identity for a row: a stable `rowId` whose `version` (or cleared
 * streaming tail) bumps when the row's content changes in place. Keying on this
 * — not `rowId` alone — is what lets a settled streaming row stop showing
 * "Planning next moves" instead of being stuck forever.
 */
export function renderKey(row: TranscriptViewportRow): string {
	return `${row.rowId}:${row.version}`;
}

/**
 * Collapse a row sequence to canonical order with last-write-wins identity:
 * the latest row object for a given `rowId` is kept, at the position the id was
 * first seen. A defensive guard against a producer re-sending an existing id
 * (e.g. an in-place content update arriving in a delta's appended rows).
 */
function normalize(
	sessionId: string,
	emissionSeq: number,
	rows: readonly TranscriptViewportRow[],
	revision: SessionGraphRevision | null,
	projectionVersion: string | null,
	totalRowCount: number | null,
	loadedStartRowIndex: number | null,
	loadedEndRowIndex: number | null
): TranscriptRowsState {
	const byId = new Map<string, TranscriptViewportRow>();
	const order: string[] = [];
	for (const row of rows) {
		if (!byId.has(row.rowId)) {
			order.push(row.rowId);
		}
		byId.set(row.rowId, row);
	}
	const finalRows = order.map((id) => byId.get(id) as TranscriptViewportRow);
	return {
		sessionId,
		emissionSeq,
		revision,
		projectionVersion,
		totalRowCount,
		loadedStartRowIndex,
		loadedEndRowIndex,
		order,
		byId,
		rows: finalRows,
	};
}

function revisionFromPage(page: RowsPage): SessionGraphRevision {
	return {
		graphRevision: page.graphRevision,
		transcriptRevision: page.transcriptRevision,
		lastEventSeq: page.lastEventSeq,
	};
}

function sameRevision(left: SessionGraphRevision | null, right: SessionGraphRevision): boolean {
	return (
		left !== null &&
		left.graphRevision === right.graphRevision &&
		left.transcriptRevision === right.transcriptRevision &&
		left.lastEventSeq === right.lastEventSeq
	);
}

function sameRowIds(
	left: readonly TranscriptViewportRow[],
	right: readonly TranscriptViewportRow[]
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((row, index) => row.rowId === right[index]?.rowId);
}

/**
 * Apply a fresh buffer push. Accepted when it opens a new session or advances
 * the `emissionSeq`; an older/equal `emissionSeq` for the same session is a
 * stale duplicate (idempotent no-op).
 */
export function applyRowsPush(
	state: TranscriptRowsState,
	push: RowsPush
): { state: TranscriptRowsState; status: RowsApplyStatus } {
	const sameSession = state.sessionId === push.sessionId;
	if (sameSession && push.emissionSeq <= state.emissionSeq) {
		return { state, status: "stale" };
	}
	const revision = push.graphRevision ?? null;
	const keepsLoadedWindow =
		sameSession &&
		revision !== null &&
		state.revision !== null &&
		sameRowIds(state.rows, push.rows);
	const nextRevision = keepsLoadedWindow ? state.revision : revision;
	return {
		state: normalize(
			push.sessionId,
			push.emissionSeq,
			push.rows,
			nextRevision,
			keepsLoadedWindow ? state.projectionVersion : null,
			keepsLoadedWindow ? state.totalRowCount : null,
			keepsLoadedWindow ? state.loadedStartRowIndex : null,
			keepsLoadedWindow ? state.loadedEndRowIndex : null
		),
		status: "applied",
	};
}

export function applyRowsPage(
	state: TranscriptRowsState,
	page: RowsPage
): { state: TranscriptRowsState; status: RowsApplyStatus } {
	if (state.sessionId !== null && state.sessionId !== page.sessionId) {
		return { state, status: "gap" };
	}

	const pageRevision = revisionFromPage(page);
	if (state.revision !== null && !sameRevision(state.revision, pageRevision)) {
		return { state, status: "stale" };
	}

	const pageEndRowIndex = page.startRowIndex + page.rows.length;
	const loadedStartRowIndex =
		state.loadedStartRowIndex === null
			? page.startRowIndex
			: Math.min(state.loadedStartRowIndex, page.startRowIndex);
	const loadedEndRowIndex =
		state.loadedEndRowIndex === null
			? pageEndRowIndex
			: Math.max(state.loadedEndRowIndex, pageEndRowIndex);
	const nextRows = page.rows.concat(state.rows);

	return {
		state: normalize(
			page.sessionId,
			state.emissionSeq,
			nextRows,
			pageRevision,
			page.projectionVersion,
			page.totalRowCount,
			loadedStartRowIndex,
			loadedEndRowIndex
		),
		status: "applied",
	};
}

/**
 * Apply a chained delta. Applies iff a base buffer exists and the delta chains
 * contiguously (`delta.emissionSeq === current.emissionSeq + 1`). An older/equal
 * `emissionSeq` is stale (no-op); a newer-than-next one is a gap that the caller
 * must resolve with a fresh push. The new buffer is
 * `prepended ++ surviving ++ appended` (removals dropped by `rowId`).
 */
export function applyRowsDelta(
	state: TranscriptRowsState,
	delta: RowsDelta
): { state: TranscriptRowsState; status: RowsApplyStatus } {
	if (state.sessionId === null) {
		return { state, status: "gap" };
	}
	if (delta.emissionSeq <= state.emissionSeq) {
		return { state, status: "stale" };
	}
	if (delta.emissionSeq !== state.emissionSeq + 1) {
		return { state, status: "gap" };
	}
	const removed = new Set(delta.removedRowIds);
	const surviving = state.rows.filter((row) => !removed.has(row.rowId));
	const nextRows = delta.prependedRows.concat(surviving, delta.appendedRows);
	const revision = delta.graphRevision ?? state.revision;
	const keepsLoadedWindow =
		delta.graphRevision === undefined || sameRevision(state.revision, delta.graphRevision);
	return {
		state: normalize(
			state.sessionId,
			delta.emissionSeq,
			nextRows,
			revision,
			keepsLoadedWindow ? state.projectionVersion : null,
			keepsLoadedWindow ? state.totalRowCount : null,
			keepsLoadedWindow ? state.loadedStartRowIndex : null,
			keepsLoadedWindow ? state.loadedEndRowIndex : null
		),
		status: "applied",
	};
}
