import { describe, expect, test } from "bun:test";
import type {
	ActiveStreamingTailContentKind,
	TranscriptViewportRow,
} from "../../../services/acp-types.js";
import {
	EMPTY_TRANSCRIPT_ROWS_STATE,
	applyRowsDelta,
	applyRowsPage,
	applyRowsPush,
	renderKey,
} from "../transcript-rows-store.js";

// Unit 3 — version-aware ordered-rows store (pure reducers). Canonical rows in,
// canonical order out, keyed on Acepe-owned rowId + version. NO pixels: the
// reducer inputs carry no offset/height/mode fields by construction (dropped at
// the wire boundary), so the store cannot reintroduce the dual-authority void.

function row(
	rowId: string,
	version: string,
	tail: ActiveStreamingTailContentKind | null = null
): TranscriptViewportRow {
	return {
		rowId,
		sourceEntryId: rowId,
		kind: "assistantText",
		version,
		anchorEligible: true,
		activeStreamingTail: tail,
		operationLinks: [],
		interactionLinks: [],
		content: { kind: "transcript", role: "assistant", segments: [] },
	};
}

function push(sessionId: string, emissionSeq: number, rows: TranscriptViewportRow[]) {
	return { sessionId, emissionSeq, rows };
}

function revisionPush(sessionId: string, emissionSeq: number, rows: TranscriptViewportRow[]) {
	return {
		sessionId,
		emissionSeq,
		graphRevision: {
			graphRevision: 11,
			transcriptRevision: 7,
			lastEventSeq: 13,
		},
		rows,
	};
}

function page(
	sessionId: string,
	startRowIndex: number,
	rows: TranscriptViewportRow[],
	revision = { graphRevision: 11, transcriptRevision: 7, lastEventSeq: 13 }
) {
	return {
		sessionId,
		projectionVersion: "transcript_viewport_row:v5",
		startRowIndex,
		totalRowCount: 4,
		transcriptRevision: revision.transcriptRevision,
		graphRevision: revision.graphRevision,
		lastEventSeq: revision.lastEventSeq,
		rows,
	};
}

function delta(
	emissionSeq: number,
	parts: {
		prependedRows?: TranscriptViewportRow[];
		appendedRows?: TranscriptViewportRow[];
		removedRowIds?: string[];
	},
	graphRevision?: { graphRevision: number; transcriptRevision: number; lastEventSeq: number }
) {
	return {
		graphRevision,
		emissionSeq,
		prependedRows: parts.prependedRows ?? [],
		appendedRows: parts.appendedRows ?? [],
		removedRowIds: parts.removedRowIds ?? [],
	};
}

describe("applyRowsPush", () => {
	test("a push establishes rows in canonical order keyed by id", () => {
		const { state, status } = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, push("s", 5, [
			row("r1", "v1"),
			row("r2", "v1"),
			row("r3", "v1"),
		]));
		expect(status).toBe("applied");
		expect(state.order).toEqual(["r1", "r2", "r3"]);
		expect(state.rows.map((r) => r.rowId)).toEqual(["r1", "r2", "r3"]);
		expect(state.byId.get("r2")?.version).toBe("v1");
		expect(state.emissionSeq).toBe(5);
	});

	test("a stale push (emissionSeq <= current) is ignored", () => {
		const base = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, push("s", 5, [row("r1", "v1")])).state;
		const { state, status } = applyRowsPush(base, push("s", 5, [row("zzz", "v9")]));
		expect(status).toBe("stale");
		expect(state).toBe(base);
	});

	test("a push for a different session replaces the baseline", () => {
		const base = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, push("s", 9, [row("r1", "v1")])).state;
		const { state, status } = applyRowsPush(base, push("other", 1, [row("x", "v1")]));
		expect(status).toBe("applied");
		expect(state.sessionId).toBe("other");
		expect(state.order).toEqual(["x"]);
	});

	test("duplicate id within a push is last-write-wins at first-seen position", () => {
		const { state } = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, push("s", 1, [
			row("r1", "v1"),
			row("r2", "v1"),
			row("r1", "v2"),
		]));
		expect(state.order).toEqual(["r1", "r2"]);
		expect(state.byId.get("r1")?.version).toBe("v2");
	});

	test("empty session yields an empty list", () => {
		const { state } = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, push("s", 1, []));
		expect(state.rows).toEqual([]);
		expect(state.order).toEqual([]);
	});

	test("an initial row page can recover an empty pushed state from a different revision", () => {
		const emptyLiveState = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, {
			sessionId: "s",
			emissionSeq: 2,
			graphRevision: {
				graphRevision: 99,
				transcriptRevision: 88,
				lastEventSeq: 77,
			},
			rows: [],
		}).state;

		const { state, status } = applyRowsPage(
			emptyLiveState,
			page("s", 2, [row("tail-row", "v1")], {
				graphRevision: 11,
				transcriptRevision: 7,
				lastEventSeq: 13,
			})
		);

		expect(status).toBe("applied");
		expect(state.rows.map((value) => value.rowId)).toEqual(["tail-row"]);
		expect(state.loadedStartRowIndex).toBe(2);
		expect(state.loadedEndRowIndex).toBe(3);
		expect(state.revision).toEqual({
			graphRevision: 11,
			transcriptRevision: 7,
			lastEventSeq: 13,
		});
	});

	test("a same-revision push with the same rows keeps loaded row-page metadata", () => {
		const pushed = applyRowsPush(
			EMPTY_TRANSCRIPT_ROWS_STATE,
			revisionPush("s", 10, [row("r2", "v1"), row("r3", "v1")])
		).state;
		const paged = applyRowsPage(pushed, page("s", 2, [row("r2", "v1"), row("r3", "v1")])).state;

		const { state, status } = applyRowsPush(
			paged,
			revisionPush("s", 11, [row("r2", "v1"), row("r3", "v1")])
		);

		expect(status).toBe("applied");
		expect(state.loadedStartRowIndex).toBe(2);
		expect(state.loadedEndRowIndex).toBe(4);
		expect(state.totalRowCount).toBe(4);
		expect(state.projectionVersion).toBe("transcript_viewport_row:v5");
	});

	test("a later push with the same row ids keeps the row-page revision for paging", () => {
		const pushed = applyRowsPush(
			EMPTY_TRANSCRIPT_ROWS_STATE,
			revisionPush("s", 10, [row("r2", "v1"), row("r3", "v1")])
		).state;
		const paged = applyRowsPage(pushed, page("s", 2, [row("r2", "v1"), row("r3", "v1")])).state;

		const { state, status } = applyRowsPush(paged, {
			sessionId: "s",
			emissionSeq: 11,
			graphRevision: {
				graphRevision: 12,
				transcriptRevision: 8,
				lastEventSeq: 14,
			},
			rows: [row("r2", "v2"), row("r3", "v2")],
		});

		expect(status).toBe("applied");
		expect(state.loadedStartRowIndex).toBe(2);
		expect(state.loadedEndRowIndex).toBe(4);
		expect(state.totalRowCount).toBe(4);
		expect(state.revision).toEqual({
			graphRevision: 11,
			transcriptRevision: 7,
			lastEventSeq: 13,
		});
	});
});

describe("applyRowsDelta (canonical chain)", () => {
	const base = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, push("s", 10, [
		row("r1", "v1"),
		row("r2", "v1"),
		row("r3", "v1"),
	])).state;

	test("append + prepend + remove preserves canonical order", () => {
		const { state, status } = applyRowsDelta(
			base,
			delta(11, { prependedRows: [row("r0", "v1")], appendedRows: [row("r4", "v1")], removedRowIds: ["r2"] })
		);
		expect(status).toBe("applied");
		expect(state.order).toEqual(["r0", "r1", "r3", "r4"]);
		expect(state.emissionSeq).toBe(11);
	});

	test("a non-contiguous delta is a gap (forces a fresh push)", () => {
		const { state, status } = applyRowsDelta(base, delta(13, { appendedRows: [row("r9", "v1")] }));
		expect(status).toBe("gap");
		expect(state).toBe(base);
	});

	test("a stale delta (emissionSeq <= current) is an idempotent no-op", () => {
		const { state, status } = applyRowsDelta(base, delta(10, { appendedRows: [row("r9", "v1")] }));
		expect(status).toBe("stale");
		expect(state).toBe(base);
	});

	test("a delta with no base buffer is a gap", () => {
		const { status } = applyRowsDelta(EMPTY_TRANSCRIPT_ROWS_STATE, delta(1, { appendedRows: [row("r1", "v1")] }));
		expect(status).toBe("gap");
	});

	test("a revision-advancing delta clears loaded row-page metadata", () => {
		const pushed = applyRowsPush(
			EMPTY_TRANSCRIPT_ROWS_STATE,
			revisionPush("s", 10, [row("r2", "v1"), row("r3", "v1")])
		).state;
		const paged = applyRowsPage(pushed, page("s", 2, [row("r2", "v1"), row("r3", "v1")])).state;

		const { state, status } = applyRowsDelta(
			paged,
			delta(
				11,
				{ appendedRows: [row("r4", "v1")] },
				{ graphRevision: 12, transcriptRevision: 8, lastEventSeq: 14 }
			)
		);

		expect(status).toBe("applied");
		expect(state.revision).toEqual({ graphRevision: 12, transcriptRevision: 8, lastEventSeq: 14 });
		expect(state.loadedStartRowIndex).toBeNull();
		expect(state.totalRowCount).toBeNull();
	});
});

describe("applyRowsPage", () => {
	test("prepends an older canonical page and records the loaded row window", () => {
		const base = applyRowsPush(
			EMPTY_TRANSCRIPT_ROWS_STATE,
			revisionPush("s", 10, [row("r2", "v1"), row("r3", "v1")])
		).state;
		const withTailWindow = applyRowsPage(base, page("s", 2, [row("r2", "v1"), row("r3", "v1")])).state;

		const { state, status } = applyRowsPage(
			withTailWindow,
			page("s", 0, [row("r0", "v1"), row("r1", "v1")])
		);

		expect(status).toBe("applied");
		expect(state.rows.map((r) => r.rowId)).toEqual(["r0", "r1", "r2", "r3"]);
		expect(state.loadedStartRowIndex).toBe(0);
		expect(state.loadedEndRowIndex).toBe(4);
		expect(state.totalRowCount).toBe(4);
	});

	test("rejects a row page from a stale revision", () => {
		const base = applyRowsPush(
			EMPTY_TRANSCRIPT_ROWS_STATE,
			revisionPush("s", 10, [row("r2", "v1")])
		).state;

		const { state, status } = applyRowsPage(
			base,
			page("s", 0, [row("r0", "v1")], {
				graphRevision: 12,
				transcriptRevision: 7,
				lastEventSeq: 14,
			})
		);

		expect(status).toBe("stale");
		expect(state).toBe(base);
	});
});

describe("B1 — stuck streaming-tail clears via a version bump", () => {
	test("renderKey changes when a survivor row's tail clears with a bumped version", () => {
		const streaming = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, push("s", 1, [
			row("assistant-1", "v1", "message"),
		])).state;
		const before = streaming.byId.get("assistant-1");
		expect(before?.activeStreamingTail).toBe("message");

		// Canonical producer re-emits the same row, tail cleared, version bumped.
		const settled = applyRowsPush(streaming, push("s", 2, [row("assistant-1", "v2", null)])).state;
		const after = settled.byId.get("assistant-1");

		expect(after?.activeStreamingTail).toBeNull();
		expect(after?.version).toBe("v2");
		// The render key MUST change so the row remounts/updates — keying on id
		// alone is exactly what leaves "Planning next moves" stuck forever.
		expect(renderKey(before!)).not.toBe(renderKey(after!));
	});

	test("the same in-place clear also resolves through a delta (last-write-wins)", () => {
		const streaming = applyRowsPush(EMPTY_TRANSCRIPT_ROWS_STATE, push("s", 1, [
			row("assistant-1", "v1", "message"),
			row("tool-1", "v1"),
		])).state;
		const settled = applyRowsDelta(streaming, delta(2, { appendedRows: [row("assistant-1", "v2", null)] })).state;
		expect(settled.order).toEqual(["assistant-1", "tool-1"]); // position held
		expect(settled.byId.get("assistant-1")?.version).toBe("v2");
		expect(settled.byId.get("assistant-1")?.activeStreamingTail).toBeNull();
	});
});
