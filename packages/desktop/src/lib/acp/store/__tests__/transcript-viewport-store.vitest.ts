import { describe, expect, it } from "vitest";
import type {
	TranscriptViewportRow,
	ViewportBufferPush,
} from "../../../services/acp-types.js";
import { TranscriptViewportStore } from "../transcript-viewport-store.svelte.js";

function bufferRow(index: number): TranscriptViewportRow {
	return {
		rowId: `transcript:row-${index}`,
		sourceEntryId: `row-${index}`,
		kind: "assistantText",
		version: `v-${index}`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [{ kind: "text", segmentId: `row-${index}:text`, text: `row ${index}` }],
		},
	};
}

function bufferPush(input: {
	readonly graphRevision: number;
	readonly viewportRevision: number;
	readonly bufferStartIndex?: number;
	readonly bufferEndIndex?: number;
	readonly layoutRowCount?: number;
	readonly rowHeightPx?: number;
	readonly requestGeneration?: number | null;
	readonly scrollTopTarget?: number | null;
	readonly scrollAnchorCorrectionPx?: number | null;
	readonly mode?: ViewportBufferPush["mode"];
	readonly emissionSeq?: number;
}): ViewportBufferPush {
	const start = input.bufferStartIndex ?? 0;
	const end = input.bufferEndIndex ?? 5;
	const layoutRowCount = input.layoutRowCount ?? end;
	const rowHeight = input.rowHeightPx ?? 100;
	const count = end - start;
	const rows: TranscriptViewportRow[] = [];
	const offsetsPx: number[] = [];
	for (let i = 0; i < count; i += 1) {
		rows.push(bufferRow(start + i));
		offsetsPx.push((start + i) * rowHeight);
	}
	return {
		sessionId: "session-1",
		graphRevision: {
			graphRevision: input.graphRevision,
			transcriptRevision: input.graphRevision,
			lastEventSeq: input.graphRevision,
		},
		viewportRevision: input.viewportRevision,
		emissionSeq: input.emissionSeq ?? 0,
		bufferStartIndex: start,
		bufferEndIndex: end,
		layoutRowCount,
		totalHeightPx: layoutRowCount * rowHeight,
		bufferEndOffsetPx: end * rowHeight,
		rows,
		offsetsPx,
		mode: input.mode ?? { kind: "followingTail" },
		requestGeneration: input.requestGeneration ?? null,
		scrollTopTarget: input.scrollTopTarget ?? null,
		scrollAnchorCorrectionPx: input.scrollAnchorCorrectionPx ?? null,
		diagnostics: [],
	};
}

function rangeRows(
	from: number,
	to: number,
	rowHeight: number
): { rows: TranscriptViewportRow[]; offsets: number[] } {
	const rows: TranscriptViewportRow[] = [];
	const offsets: number[] = [];
	for (let i = from; i < to; i += 1) {
		rows.push(bufferRow(i));
		offsets.push(i * rowHeight);
	}
	return { rows, offsets };
}

function bufferDelta(input: {
	readonly fromViewportRevision: number;
	readonly toViewportRevision: number;
	readonly emissionSeq?: number;
	readonly graphRevision?: number;
	readonly prepend?: readonly [number, number];
	readonly append?: readonly [number, number];
	readonly removedRowIds?: readonly string[];
	readonly layoutRowCount: number;
	readonly bufferEndIndex: number;
	readonly scrollAnchorCorrectionPx?: number | null;
	readonly scrollTopTarget?: number | null;
	readonly rowHeightPx?: number;
}): import("../../../services/acp-types.js").ViewportBufferDelta {
	const rowHeight = input.rowHeightPx ?? 100;
	const gr = input.graphRevision ?? 1;
	const prepended = input.prepend
		? rangeRows(input.prepend[0], input.prepend[1], rowHeight)
		: { rows: [], offsets: [] };
	const appended = input.append
		? rangeRows(input.append[0], input.append[1], rowHeight)
		: { rows: [], offsets: [] };
	return {
		sessionId: "session-1",
		graphRevision: { graphRevision: gr, transcriptRevision: gr, lastEventSeq: gr },
		emissionSeq: input.emissionSeq ?? 1,
		fromViewportRevision: input.fromViewportRevision,
		toViewportRevision: input.toViewportRevision,
		prependedRows: prepended.rows,
		prependedOffsetsPx: prepended.offsets,
		appendedRows: appended.rows,
		appendedOffsetsPx: appended.offsets,
		removedRowIds: [...(input.removedRowIds ?? [])],
		layoutRowCount: input.layoutRowCount,
		totalHeightPx: input.layoutRowCount * rowHeight,
		bufferEndOffsetPx: input.bufferEndIndex * rowHeight,
		scrollAnchorCorrectionPx: input.scrollAnchorCorrectionPx ?? null,
		scrollTopTarget: input.scrollTopTarget ?? null,
		diagnostics: [],
	};
}

function rowId(index: number): string {
	return `transcript:row-${index}`;
}

describe("TranscriptViewportStore", () => {
	it("clears a session without touching other sessions", () => {
		const store = new TranscriptViewportStore();
		store.applyBufferPush(bufferPush({ graphRevision: 3, viewportRevision: 4 }));

		store.removeSession("session-1");

		expect(store.getBufferProjection("session-1")).toBeNull();
	});

	it("defaults attachment status to attached for unknown sessions", () => {
		const store = new TranscriptViewportStore();
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
		expect(store.getAttachmentStatus(null)).toBe("attached");
	});

	it("markReattaching resets the projection so the next push is accepted", () => {
		const store = new TranscriptViewportStore();
		expect(
			store.applyBufferPush(bufferPush({ graphRevision: 5, viewportRevision: 9, emissionSeq: 3 }))
		).toBe(true);

		store.markReattaching("session-1");

		expect(store.getAttachmentStatus("session-1")).toBe("reattaching");
		expect(store.getBufferProjection("session-1")).toBeNull();

		// A fresh backend seeds a LOW emission seq; it must be accepted because the
		// projection was reset.
		expect(
			store.applyBufferPush(bufferPush({ graphRevision: 1, viewportRevision: 1, emissionSeq: 0 }))
		).toBe(true);
	});

	it("accepted push after reattaching flips status back to attached", () => {
		const store = new TranscriptViewportStore();
		store.markReattaching("session-1");
		expect(store.getAttachmentStatus("session-1")).toBe("reattaching");

		expect(store.applyBufferPush(bufferPush({ graphRevision: 1, viewportRevision: 1 }))).toBe(true);

		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});

	it("markReattachFailed records a terminal recovery status", () => {
		const store = new TranscriptViewportStore();
		store.markReattaching("session-1");
		store.markReattachFailed("session-1");

		expect(store.getAttachmentStatus("session-1")).toBe("reattachFailed");
	});

	it("markReattachFailed only transitions from reattaching", () => {
		const store = new TranscriptViewportStore();

		// No prior reattaching episode: must not resurrect a removed/untracked session.
		store.markReattachFailed("session-1");
		expect(store.getAttachmentStatus("session-1")).toBe("attached");

		// Already re-attached (status attached): a late failure must not clobber it.
		store.markReattaching("session-1");
		store.applyBufferPush(bufferPush({ graphRevision: 1, viewportRevision: 1 }));
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
		store.markReattachFailed("session-1");
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});

	it("a push arriving after reattachFailed still recovers to attached", () => {
		const store = new TranscriptViewportStore();
		store.markReattaching("session-1");
		store.markReattachFailed("session-1");

		expect(store.applyBufferPush(bufferPush({ graphRevision: 1, viewportRevision: 1 }))).toBe(true);

		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});

	it("does not mark already-attached sessions on accepted pushes", () => {
		const store = new TranscriptViewportStore();
		expect(store.applyBufferPush(bufferPush({ graphRevision: 1, viewportRevision: 1 }))).toBe(true);
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});

	it("removeSession clears attachment status", () => {
		const store = new TranscriptViewportStore();
		store.markReattachFailed("session-1");

		store.removeSession("session-1");

		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});
});

describe("TranscriptViewportStore buffer protocol", () => {
	it("stores the buffered slice and exposes it by session", () => {
		const store = new TranscriptViewportStore();
		const push = bufferPush({ graphRevision: 3, viewportRevision: 4, bufferStartIndex: 2, bufferEndIndex: 6, layoutRowCount: 20 });

		expect(store.applyBufferPush(push)).toBe(true);
		const projection = store.getBufferProjection("session-1");

		expect(projection?.bufferStartIndex).toBe(2);
		expect(projection?.bufferEndIndex).toBe(6);
		expect(projection?.layoutRowCount).toBe(20);
		expect(projection?.rows.map((row) => row.rowId)).toEqual([
			"transcript:row-2",
			"transcript:row-3",
			"transcript:row-4",
			"transcript:row-5",
		]);
		expect(projection?.offsetsPx).toEqual([200, 300, 400, 500]);
		expect(projection?.bufferEndOffsetPx).toBe(600);
	});

	it("ignores strictly older buffer pushes (newer-wins on revision)", () => {
		const store = new TranscriptViewportStore();
		expect(store.applyBufferPush(bufferPush({ graphRevision: 3, viewportRevision: 4 }))).toBe(true);

		expect(store.applyBufferPush(bufferPush({ graphRevision: 3, viewportRevision: 3 }))).toBe(false);
		expect(store.getBufferProjection("session-1")?.viewportRevision).toBe(4);
	});

	it("a stale refill response cannot roll back a newer live push", () => {
		const store = new TranscriptViewportStore();
		// UI requested a refill at rev 10 (generation 7) — but a live push raced ahead to rev 11 first.
		expect(store.applyBufferPush(bufferPush({ graphRevision: 11, viewportRevision: 1 }))).toBe(true);

		// The late rev-10 refill response (generation 7) arrives and must be rejected.
		expect(
			store.applyBufferPush(
				bufferPush({ graphRevision: 10, viewportRevision: 9, requestGeneration: 7 })
			)
		).toBe(false);
		expect(store.getBufferProjection("session-1")?.revision.graphRevision).toBe(11);
	});

	it("tracks the most recent request generation on accepted refill responses", () => {
		const store = new TranscriptViewportStore();
		expect(
			store.applyBufferPush(
				bufferPush({ graphRevision: 3, viewportRevision: 4, requestGeneration: 5 })
			)
		).toBe(true);
		expect(store.getBufferProjection("session-1")?.lastGeneration).toBe(5);
	});

	it("allocates command generations above the last accepted response", () => {
		const store = new TranscriptViewportStore();
		expect(
			store.applyBufferPush(
				bufferPush({ graphRevision: 3, viewportRevision: 4, requestGeneration: 5 })
			)
		).toBe(true);

		expect(store.nextRequestGeneration("session-1")).toBe(6);
		expect(store.nextRequestGeneration("session-1")).toBe(7);
	});

	it("does not reset command generations when a viewport component remounts", () => {
		const store = new TranscriptViewportStore();

		expect(store.nextRequestGeneration("session-1")).toBe(1);
		expect(store.nextRequestGeneration("session-1")).toBe(2);

		expect(
			store.applyBufferPush(
				bufferPush({
					graphRevision: 3,
					viewportRevision: 4,
					emissionSeq: 4,
					requestGeneration: 2,
				})
			)
		).toBe(true);

		expect(store.nextRequestGeneration("session-1")).toBe(3);
	});

	it("rejects older request-generation pushes even when their emission sequence is newer", () => {
		const store = new TranscriptViewportStore();
		expect(
			store.applyBufferPush(
				bufferPush({
					graphRevision: 3,
					viewportRevision: 4,
					emissionSeq: 10,
					requestGeneration: 9,
				})
			)
		).toBe(true);

		expect(
			store.applyBufferPush(
				bufferPush({
					graphRevision: 3,
					viewportRevision: 5,
					emissionSeq: 11,
					requestGeneration: 8,
				})
			)
		).toBe(false);
		expect(store.getBufferProjection("session-1")?.lastGeneration).toBe(9);
		expect(store.getBufferProjection("session-1")?.emissionSeq).toBe(10);
	});

	it("markReattaching clears the buffer protocol so a fresh push is accepted", () => {
		const store = new TranscriptViewportStore();
		expect(store.applyBufferPush(bufferPush({ graphRevision: 5, viewportRevision: 9 }))).toBe(true);

		store.markReattaching("session-1");
		expect(store.getBufferProjection("session-1")).toBeNull();

		// After reset the session can re-claim the buffer protocol from scratch.
		expect(store.applyBufferPush(bufferPush({ graphRevision: 1, viewportRevision: 1 }))).toBe(true);
	});

	it("accepted buffer push flips reattaching status back to attached", () => {
		const store = new TranscriptViewportStore();
		store.markReattaching("session-1");

		expect(store.applyBufferPush(bufferPush({ graphRevision: 1, viewportRevision: 1 }))).toBe(true);
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});

	describe("resolveVisibleSlice", () => {
		it("returns the rows intersecting the scroll window with overscan", () => {
			const store = new TranscriptViewportStore();
			// 20 rows of 100px, buffer covers [0,20).
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 20, layoutRowCount: 20 })
			);

			// scrollTop 450, height 200 → rows 4..7 visible (offsets 400..700), overscan 1 → 3..8.
			const slice = store.resolveVisibleSlice("session-1", 450, 200, 1);

			expect(slice?.startIndex).toBe(3);
			expect(slice?.endIndex).toBe(8);
			expect(slice?.rows.map((row) => row.rowId)).toEqual([
				"transcript:row-3",
				"transcript:row-4",
				"transcript:row-5",
				"transcript:row-6",
				"transcript:row-7",
			]);
			expect(slice?.offsetsPx).toEqual([300, 400, 500, 600, 700]);
		});

		it("clamps overscan to buffer bounds", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 5 })
			);

			const slice = store.resolveVisibleSlice("session-1", 0, 100, 100);

			expect(slice?.startIndex).toBe(0);
			expect(slice?.endIndex).toBe(5);
		});

		it("returns null for an unknown session", () => {
			const store = new TranscriptViewportStore();
			expect(store.resolveVisibleSlice("missing", 0, 100, 0)).toBeNull();
		});
	});

	describe("needsRefill", () => {
		it("requests a refill when nearing a non-extreme buffer top", () => {
			const store = new TranscriptViewportStore();
			// Buffer [5,15) of a 30-row layout.
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 5, bufferEndIndex: 15, layoutRowCount: 30 })
			);

			// Buffer top pixel = 500. scrollTop 540 is within 100px of it.
			expect(store.needsRefill("session-1", 540, 200, 100)).toBe(true);
		});

		it("does not request a refill at the layout top extreme", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 10, layoutRowCount: 30 })
			);

			// Near the buffer top, but the buffer top IS the layout top → no refill.
			expect(store.needsRefill("session-1", 0, 200, 100)).toBe(false);
		});

		it("requests a refill when nearing a non-extreme buffer bottom", () => {
			const store = new TranscriptViewportStore();
			// Buffer [0,10) of a 30-row layout; buffer bottom pixel = 1000.
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 10, layoutRowCount: 30 })
			);

			// Visible bottom = 950, within 100px of buffer bottom 1000.
			expect(store.needsRefill("session-1", 750, 200, 100)).toBe(true);
		});

		it("does not request a refill at the layout bottom extreme", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 20, bufferEndIndex: 30, layoutRowCount: 30 })
			);

			expect(store.needsRefill("session-1", 2800, 200, 100)).toBe(false);
		});
	});

	describe("isOutsideBuffer", () => {
		it("is true when the visible range is entirely above the buffer", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 10, bufferEndIndex: 15, layoutRowCount: 30 })
			);

			// Buffer pixel span [1000, 1500). Visible [0,200) is fully above.
			expect(store.isOutsideBuffer("session-1", 0, 200)).toBe(true);
		});

		it("is true when the visible range is entirely below the buffer", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 30 })
			);

			// Buffer pixel span [0,500). Visible [800,1000) is fully below.
			expect(store.isOutsideBuffer("session-1", 800, 200)).toBe(true);
		});

		it("is false when the visible range overlaps the buffer", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 10, layoutRowCount: 30 })
			);

			expect(store.isOutsideBuffer("session-1", 450, 200)).toBe(false);
		});
	});

	describe("applyBufferDelta", () => {
		it("slides the buffer down: drops removed top rows, appends new bottom rows", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 3, viewportRevision: 4, bufferStartIndex: 2, bufferEndIndex: 6, layoutRowCount: 20 })
			);

			const result = store.applyBufferDelta(
				bufferDelta({
					graphRevision: 3,
					fromViewportRevision: 4,
					toViewportRevision: 5,
					removedRowIds: [rowId(2), rowId(3)],
					append: [6, 8],
					layoutRowCount: 20,
					bufferEndIndex: 8,
				})
			);

			expect(result.status).toBe("applied");
			const projection = store.getBufferProjection("session-1");
			expect(projection?.viewportRevision).toBe(5);
			expect(projection?.bufferStartIndex).toBe(4);
			expect(projection?.bufferEndIndex).toBe(8);
			expect(projection?.rows.map((row) => row.rowId)).toEqual([
				rowId(4),
				rowId(5),
				rowId(6),
				rowId(7),
			]);
			expect(projection?.offsetsPx).toEqual([400, 500, 600, 700]);
			expect(projection?.bufferEndOffsetPx).toBe(800);
		});

		it("slides the buffer up: prepends new top rows, drops removed bottom rows", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 10, bufferEndIndex: 14, layoutRowCount: 30 })
			);

			const result = store.applyBufferDelta(
				bufferDelta({
					fromViewportRevision: 1,
					toViewportRevision: 2,
					prepend: [8, 10],
					removedRowIds: [rowId(12), rowId(13)],
					layoutRowCount: 30,
					bufferEndIndex: 12,
				})
			);

			expect(result.status).toBe("applied");
			const projection = store.getBufferProjection("session-1");
			expect(projection?.bufferStartIndex).toBe(8);
			expect(projection?.bufferEndIndex).toBe(12);
			expect(projection?.rows.map((row) => row.rowId)).toEqual([
				rowId(8),
				rowId(9),
				rowId(10),
				rowId(11),
			]);
			expect(projection?.offsetsPx).toEqual([800, 900, 1000, 1100]);
		});

		it("produces a strictly monotonic offset array after a slide", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 5, bufferEndIndex: 10, layoutRowCount: 40 })
			);
			store.applyBufferDelta(
				bufferDelta({
					fromViewportRevision: 1,
					toViewportRevision: 2,
					removedRowIds: [rowId(5), rowId(6)],
					append: [10, 12],
					layoutRowCount: 40,
					bufferEndIndex: 12,
				})
			);

			const offsets = store.getBufferProjection("session-1")?.offsetsPx ?? [];
			for (let i = 1; i < offsets.length; i += 1) {
				expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
			}
		});

		it("applies a tail-streaming append without removals and grows the layout count", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 5 })
			);

			const result = store.applyBufferDelta(
				bufferDelta({
					fromViewportRevision: 1,
					toViewportRevision: 2,
					append: [5, 7],
					layoutRowCount: 7,
					bufferEndIndex: 7,
					scrollTopTarget: 200,
				})
			);

			expect(result).toEqual({ status: "applied", scrollAnchorCorrectionPx: null, scrollTopTarget: 200 });
			const projection = store.getBufferProjection("session-1");
			expect(projection?.bufferStartIndex).toBe(0);
			expect(projection?.bufferEndIndex).toBe(7);
			expect(projection?.layoutRowCount).toBe(7);
			expect(projection?.scrollTopTarget).toBe(200);
		});

		it("propagates a grown layoutRowCount so needsRefill re-opens the bottom edge", () => {
			const store = new TranscriptViewportStore();
			// Buffer reaches the layout end (no content below) at first.
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 10, layoutRowCount: 10 })
			);
			expect(store.needsRefill("session-1", 800, 200, 100)).toBe(false);

			// Streaming reveals far more layout; the buffer no longer reaches the end.
			store.applyBufferDelta(
				bufferDelta({
					fromViewportRevision: 1,
					toViewportRevision: 2,
					append: [10, 12],
					layoutRowCount: 30,
					bufferEndIndex: 12,
				})
			);

			// Visible bottom 1200 within 100px of buffer bottom 1200, content below exists.
			expect(store.needsRefill("session-1", 1000, 200, 100)).toBe(true);
		});

		it("chains a second delta from the advanced revision", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 20 })
			);
			expect(
				store.applyBufferDelta(
					bufferDelta({ emissionSeq: 1, fromViewportRevision: 1, toViewportRevision: 2, append: [5, 6], layoutRowCount: 20, bufferEndIndex: 6 })
				).status
			).toBe("applied");
			expect(
				store.applyBufferDelta(
					bufferDelta({ emissionSeq: 2, fromViewportRevision: 2, toViewportRevision: 3, append: [6, 7], layoutRowCount: 20, bufferEndIndex: 7 })
				).status
			).toBe("applied");
			expect(store.getBufferProjection("session-1")?.viewportRevision).toBe(3);
			expect(store.getBufferProjection("session-1")?.bufferEndIndex).toBe(7);
		});

		it("returns a gap and leaves the projection untouched when emissionSeq skips ahead", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 4, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 20, emissionSeq: 0 })
			);
			const before = store.getBufferProjection("session-1");

			// Baseline seq is 0; the next contiguous seq is 1, but this delta is 3.
			const result = store.applyBufferDelta(
				bufferDelta({ emissionSeq: 3, fromViewportRevision: 4, toViewportRevision: 5, append: [5, 6], layoutRowCount: 20, bufferEndIndex: 6 })
			);

			expect(result).toEqual({ status: "gap" });
			const after = store.getBufferProjection("session-1");
			expect(after?.emissionSeq).toBe(0);
			expect(after?.rows.map((row) => row.rowId)).toEqual(before?.rows.map((row) => row.rowId));
		});

		it("drops a stale (reordered/duplicate) delta as a no-op without corrupting the buffer", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 20, emissionSeq: 7 })
			);
			// Advance to seq 8.
			expect(
				store.applyBufferDelta(
					bufferDelta({ emissionSeq: 8, fromViewportRevision: 1, toViewportRevision: 1, append: [5, 6], layoutRowCount: 20, bufferEndIndex: 6 })
				).status
			).toBe("applied");
			const afterApply = store.getBufferProjection("session-1");

			// A reordered older delta (seq 8 again, and seq 6) must both be dropped.
			expect(
				store.applyBufferDelta(
					bufferDelta({ emissionSeq: 8, fromViewportRevision: 1, toViewportRevision: 1, append: [99, 100], layoutRowCount: 20, bufferEndIndex: 7 })
				)
			).toEqual({ status: "stale" });
			expect(
				store.applyBufferDelta(
					bufferDelta({ emissionSeq: 6, fromViewportRevision: 1, toViewportRevision: 1, append: [99, 100], layoutRowCount: 20, bufferEndIndex: 7 })
				)
			).toEqual({ status: "stale" });

			const afterStale = store.getBufferProjection("session-1");
			expect(afterStale?.emissionSeq).toBe(8);
			expect(afterStale?.rows.map((row) => row.rowId)).toEqual(
				afterApply?.rows.map((row) => row.rowId)
			);
			expect(afterStale?.bufferEndIndex).toBe(afterApply?.bufferEndIndex);
		});

		it("ignores viewportRevision for ordering: chains pure-streaming deltas that do not advance the revision", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 5, emissionSeq: 0 })
			);
			// Two streaming appends, both with from==to==1 (revision does not move),
			// chained purely by emissionSeq 1 then 2.
			expect(
				store.applyBufferDelta(
					bufferDelta({ emissionSeq: 1, fromViewportRevision: 1, toViewportRevision: 1, append: [5, 6], layoutRowCount: 6, bufferEndIndex: 6 })
				).status
			).toBe("applied");
			expect(
				store.applyBufferDelta(
					bufferDelta({ emissionSeq: 2, fromViewportRevision: 1, toViewportRevision: 1, append: [6, 7], layoutRowCount: 7, bufferEndIndex: 7 })
				).status
			).toBe("applied");
			expect(store.getBufferProjection("session-1")?.bufferEndIndex).toBe(7);
			expect(store.getBufferProjection("session-1")?.emissionSeq).toBe(2);
		});

		it("returns a gap when no base buffer exists yet", () => {
			const store = new TranscriptViewportStore();
			const result = store.applyBufferDelta(
				bufferDelta({ fromViewportRevision: 1, toViewportRevision: 2, append: [0, 2], layoutRowCount: 20, bufferEndIndex: 2 })
			);
			expect(result).toEqual({ status: "gap" });
			expect(store.getBufferProjection("session-1")).toBeNull();
		});

		it("surfaces scrollAnchorCorrectionPx for the controller to apply", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 5, bufferEndIndex: 10, layoutRowCount: 20 })
			);
			const result = store.applyBufferDelta(
				bufferDelta({
					fromViewportRevision: 1,
					toViewportRevision: 2,
					layoutRowCount: 20,
					bufferEndIndex: 10,
					scrollAnchorCorrectionPx: -40,
				})
			);
			expect(result).toEqual({ status: "applied", scrollAnchorCorrectionPx: -40, scrollTopTarget: null });
		});
	});

	describe("pending scroll correction accumulator", () => {
		it("starts empty and stays empty for correction-free emissions", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(bufferPush({ graphRevision: 1, viewportRevision: 1, emissionSeq: 0 }));
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(0);
		});

		it("records a correction carried on a push", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, emissionSeq: 0, scrollAnchorCorrectionPx: -22 })
			);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(-22);
		});

		it("sums corrections across a coalesced burst of deltas", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 20, emissionSeq: 0 })
			);
			store.applyBufferDelta(
				bufferDelta({ emissionSeq: 1, fromViewportRevision: 1, toViewportRevision: 1, layoutRowCount: 20, bufferEndIndex: 5, scrollAnchorCorrectionPx: -10 })
			);
			store.applyBufferDelta(
				bufferDelta({ emissionSeq: 2, fromViewportRevision: 1, toViewportRevision: 1, layoutRowCount: 20, bufferEndIndex: 5, scrollAnchorCorrectionPx: -15 })
			);
			// A single coalesced flush must see the full -25, not just the last -15.
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(-25);
		});

		it("consume returns the running sum and zeroes it (idempotent thereafter)", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 20, emissionSeq: 0 })
			);
			store.applyBufferDelta(
				bufferDelta({ emissionSeq: 1, fromViewportRevision: 1, toViewportRevision: 1, layoutRowCount: 20, bufferEndIndex: 5, scrollAnchorCorrectionPx: 30 })
			);
			expect(store.consumePendingScrollCorrectionPx("session-1")).toBe(30);
			expect(store.consumePendingScrollCorrectionPx("session-1")).toBe(0);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(0);
		});

		it("an absolute reposition supersedes pending relative drift", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 20, emissionSeq: 0 })
			);
			store.applyBufferDelta(
				bufferDelta({ emissionSeq: 1, fromViewportRevision: 1, toViewportRevision: 1, layoutRowCount: 20, bufferEndIndex: 5, scrollAnchorCorrectionPx: -30 })
			);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(-30);
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 2, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 20, emissionSeq: 2, scrollTopTarget: 200 })
			);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(0);
		});

		it("does not accumulate corrections from stale/gapped deltas (projection untouched)", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 0, bufferEndIndex: 5, layoutRowCount: 20, emissionSeq: 5 })
			);
			// stale (seq <= current)
			store.applyBufferDelta(
				bufferDelta({ emissionSeq: 5, fromViewportRevision: 1, toViewportRevision: 1, layoutRowCount: 20, bufferEndIndex: 5, scrollAnchorCorrectionPx: -99 })
			);
			// gap (seq skips ahead)
			store.applyBufferDelta(
				bufferDelta({ emissionSeq: 8, fromViewportRevision: 1, toViewportRevision: 1, layoutRowCount: 20, bufferEndIndex: 5, scrollAnchorCorrectionPx: -99 })
			);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(0);
		});

		it("clears the accumulator on removeSession", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, emissionSeq: 0, scrollAnchorCorrectionPx: -40 })
			);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(-40);
			store.removeSession("session-1");
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(0);
		});

		it("returns 0 for a null session id", () => {
			const store = new TranscriptViewportStore();
			expect(store.peekPendingScrollCorrectionPx(null)).toBe(0);
			expect(store.consumePendingScrollCorrectionPx(null)).toBe(0);
		});
	});

	describe("scroll-storm regression: relative correction is the only scroll signal on non-reposition emissions", () => {
		const detached = (anchorIndex: number): ViewportBufferPush["mode"] => ({
			kind: "detached",
			anchorRowId: rowId(anchorIndex),
			offsetFromAnchorPx: 0,
		});

		it("does not yank scrollTop on refill/confirmation; corrections accumulate instead", () => {
			const store = new TranscriptViewportStore();

			// 1. Initial open: an intentional reposition carries an absolute target.
			store.applyBufferPush(
				bufferPush({
					graphRevision: 1,
					viewportRevision: 1,
					bufferStartIndex: 0,
					bufferEndIndex: 5,
					layoutRowCount: 40,
					emissionSeq: 0,
					mode: { kind: "followingTail" },
					scrollTopTarget: 0,
				})
			);
			expect(store.getBufferProjection("session-1")?.scrollTopTarget).toBe(0);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(0);

			// 2. User scrolled away → DetachAtOffset refill. The producer MUST NOT
			//    send an absolute target here (that stale request-time position is
			//    exactly the yank). No correction either: native scroll owns it.
			store.applyBufferPush(
				bufferPush({
					graphRevision: 1,
					viewportRevision: 2,
					bufferStartIndex: 5,
					bufferEndIndex: 10,
					layoutRowCount: 40,
					emissionSeq: 1,
					mode: detached(5),
					scrollTopTarget: null,
				})
			);
			expect(store.getBufferProjection("session-1")?.scrollTopTarget).toBeNull();
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(0);

			// 3. Two accepted height confirmations above the viewport, each forcing a
			//    FreshPush (B4) carrying ONLY a relative Δ_above (target stays null).
			//    Simulate them collapsing into one Svelte flush: the accumulator must
			//    sum, and neither emission may smuggle an absolute target.
			store.applyBufferPush(
				bufferPush({
					graphRevision: 1,
					viewportRevision: 2,
					bufferStartIndex: 5,
					bufferEndIndex: 10,
					layoutRowCount: 40,
					emissionSeq: 2,
					mode: detached(5),
					scrollTopTarget: null,
					scrollAnchorCorrectionPx: -12,
				})
			);
			store.applyBufferPush(
				bufferPush({
					graphRevision: 1,
					viewportRevision: 2,
					bufferStartIndex: 5,
					bufferEndIndex: 10,
					layoutRowCount: 40,
					emissionSeq: 3,
					mode: detached(5),
					scrollTopTarget: null,
					scrollAnchorCorrectionPx: -8,
				})
			);

			// The ONLY scroll signal on these non-reposition emissions is the
			// accumulated relative correction; no absolute target ever appears.
			expect(store.getBufferProjection("session-1")?.scrollTopTarget).toBeNull();
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(-20);

			// Controller drains the sum exactly once (additive nudge), then nothing.
			expect(store.consumePendingScrollCorrectionPx("session-1")).toBe(-20);
			expect(store.consumePendingScrollCorrectionPx("session-1")).toBe(0);
		});

		it("a later intentional reposition (reveal/follow-tail) cancels pending drift", () => {
			const store = new TranscriptViewportStore();
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 1, bufferStartIndex: 5, bufferEndIndex: 10, layoutRowCount: 40, emissionSeq: 0, mode: detached(5), scrollTopTarget: null, scrollAnchorCorrectionPx: -30 })
			);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(-30);
			// A reveal/follow-tail push with an absolute target supersedes the
			// pending relative drift so the two never compound.
			store.applyBufferPush(
				bufferPush({ graphRevision: 1, viewportRevision: 2, bufferStartIndex: 20, bufferEndIndex: 25, layoutRowCount: 40, emissionSeq: 1, mode: { kind: "followingTail" }, scrollTopTarget: 4000 })
			);
			expect(store.getBufferProjection("session-1")?.scrollTopTarget).toBe(4000);
			expect(store.peekPendingScrollCorrectionPx("session-1")).toBe(0);
		});
	});
});

describe("TranscriptViewportStore client scroll state", () => {
	it("stores per-session outside-buffer recovery intent", () => {
		const store = new TranscriptViewportStore();
		store.setPendingOutsideBufferScrollTopPx("session-a", 640_000, 640_000);
		expect(store.getClientScrollState("session-a").pendingOutsideBufferScrollTopPx).toBe(640_000);
		expect(store.getClientScrollState("session-a").activeOutsideBufferRequestedScrollTopPx).toBe(
			640_000
		);
	});

	it("resets outside-buffer recovery when switching sessions", () => {
		const store = new TranscriptViewportStore();
		store.setPendingOutsideBufferScrollTopPx("session-a", 9_500, 9_500);
		store.setLastOutsideBufferRecoveryDispatchMs("session-a", 1_000);

		expect(store.getClientScrollState("session-b").pendingOutsideBufferScrollTopPx).toBeNull();
		expect(store.getClientScrollState("session-b").lastOutsideBufferRecoveryDispatchMs).toBeNull();
	});

	it("clears outside-buffer recovery without dropping queued scroll intent", () => {
		const store = new TranscriptViewportStore();
		store.setPendingOutsideBufferScrollTopPx("session-a", 100, 100);
		store.setPendingQueuedScrollIntentPx("session-a", 500);
		store.clearOutsideBufferRecovery("session-a");

		expect(store.getClientScrollState("session-a").pendingOutsideBufferScrollTopPx).toBeNull();
		expect(store.getClientScrollState("session-a").pendingQueuedScrollIntentPx).toBe(500);
	});

	it("drops client scroll state on removeSession", () => {
		const store = new TranscriptViewportStore();
		store.setPendingOutsideBufferScrollTopPx("session-a", 100, 100);
		store.removeSession("session-a");
		expect(store.getClientScrollState("session-a").pendingOutsideBufferScrollTopPx).toBeNull();
	});
});
