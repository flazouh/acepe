import { describe, expect, it } from "vitest";
import type { VisibleTranscriptWindowPayload } from "../../../services/acp-types.js";
import { TranscriptViewportStore } from "../transcript-viewport-store.svelte.js";

function visibleWindow(input: {
	readonly graphRevision: number;
	readonly viewportRevision: number;
	readonly text?: string;
}): VisibleTranscriptWindowPayload {
	const text = input.text ?? "hello";
	return {
		sessionId: "session-1",
		graphRevision: {
			graphRevision: input.graphRevision,
			transcriptRevision: input.graphRevision,
			lastEventSeq: input.graphRevision,
		},
		viewportRevision: input.viewportRevision,
		totalHeightPx: 240,
		viewportOffsetPx: 120,
		visibleStartIndex: 1,
		visibleEndIndex: 2,
		rows: [
			{
				rowId: "transcript:assistant-1",
				sourceEntryId: "assistant-1",
				kind: "assistantText",
				version: `v-${input.viewportRevision}`,
				anchorEligible: true,
				activeStreamingTail: null,
				operationLinks: [],
				interactionLinks: [],
				content: {
					kind: "transcript",
					role: "assistant",
					segments: [
						{
							kind: "text",
							segmentId: "assistant-1:text",
							text,
						},
					],
				},
			},
		],
		rowOffsetsPx: [120],
		mode: {
			kind: "followingTail",
		},
		diagnostics: [],
	};
}

describe("TranscriptViewportStore", () => {
	it("stores exact Rust-provided row order and offsets", () => {
		const store = new TranscriptViewportStore();
		const window = visibleWindow({ graphRevision: 3, viewportRevision: 4 });

		expect(store.applyVisibleWindow(window)).toBe(true);
		const projection = store.getProjection("session-1");

		expect(projection?.rows.map((row) => row.rowId)).toEqual(["transcript:assistant-1"]);
		expect(projection?.rowOffsetsPx).toEqual([120]);
		expect(projection?.viewportOffsetPx).toBe(120);
		expect(projection?.mode).toEqual({ kind: "followingTail" });
	});

	it("ignores older visible-window revisions", () => {
		const store = new TranscriptViewportStore();
		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 3, viewportRevision: 4 }))).toBe(
			true
		);

		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 3, viewportRevision: 3 }))).toBe(
			false
		);

		expect(store.getProjection("session-1")?.viewportRevision).toBe(4);
	});

	it("accepts newer graph revisions even when viewport revision restarts", () => {
		const store = new TranscriptViewportStore();
		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 3, viewportRevision: 4 }))).toBe(
			true
		);

		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 4, viewportRevision: 1 }))).toBe(
			true
		);

		expect(store.getProjection("session-1")?.revision.graphRevision).toBe(4);
		expect(store.getProjection("session-1")?.viewportRevision).toBe(1);
	});

	it("clears a session without touching other sessions", () => {
		const store = new TranscriptViewportStore();
		store.applyVisibleWindow(visibleWindow({ graphRevision: 3, viewportRevision: 4 }));

		store.removeSession("session-1");

		expect(store.getProjection("session-1")).toBeNull();
	});

	it("defaults attachment status to attached for unknown sessions", () => {
		const store = new TranscriptViewportStore();
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
		expect(store.getAttachmentStatus(null)).toBe("attached");
	});

	it("markReattaching resets the projection so the next window is accepted", () => {
		const store = new TranscriptViewportStore();
		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 5, viewportRevision: 9 }))).toBe(
			true
		);

		store.markReattaching("session-1");

		expect(store.getAttachmentStatus("session-1")).toBe("reattaching");
		expect(store.getProjection("session-1")).toBeNull();

		// A fresh backend seeds a LOW revision; it must be accepted because the
		// projection was reset.
		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 1, viewportRevision: 1 }))).toBe(
			true
		);
	});

	it("accepted window after reattaching flips status back to attached", () => {
		const store = new TranscriptViewportStore();
		store.markReattaching("session-1");
		expect(store.getAttachmentStatus("session-1")).toBe("reattaching");

		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 1, viewportRevision: 1 }))).toBe(
			true
		);

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
		store.applyVisibleWindow(visibleWindow({ graphRevision: 1, viewportRevision: 1 }));
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
		store.markReattachFailed("session-1");
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});

	it("a window arriving after reattachFailed still recovers to attached", () => {
		const store = new TranscriptViewportStore();
		store.markReattaching("session-1");
		store.markReattachFailed("session-1");

		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 1, viewportRevision: 1 }))).toBe(
			true
		);

		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});

	it("does not mark already-attached sessions on accepted windows", () => {
		const store = new TranscriptViewportStore();
		expect(store.applyVisibleWindow(visibleWindow({ graphRevision: 1, viewportRevision: 1 }))).toBe(
			true
		);
		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});

	it("removeSession clears attachment status", () => {
		const store = new TranscriptViewportStore();
		store.markReattachFailed("session-1");

		store.removeSession("session-1");

		expect(store.getAttachmentStatus("session-1")).toBe("attached");
	});
});
