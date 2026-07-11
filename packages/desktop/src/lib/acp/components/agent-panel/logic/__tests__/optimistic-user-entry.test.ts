import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import type {
	TranscriptEntry,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";
import {
	deriveCanonicalUserEntryPresence,
	resolveOptimisticUserEntryForGraph,
	resolveVisibleEntryCount,
} from "../optimistic-user-entry.js";

function createUserEntry(id: string, text: string): SessionEntry {
	return {
		id,
		type: "user",
		message: {
			content: { type: "text", text },
			chunks: [{ type: "text", text }],
		},
	};
}

function transcriptEntry(input: {
	readonly entryId: string;
	readonly role: "user" | "assistant";
	readonly attemptId: string | null;
}): TranscriptEntry {
	return {
		entryId: input.entryId,
		role: input.role,
		segments: [],
		attemptId: input.attemptId,
	};
}

function viewportUserRow(sourceEntryId: string): TranscriptViewportRow {
	return {
		rowId: `transcript:${sourceEntryId}`,
		sourceEntryId,
		kind: "user",
		version: "00000000000000000000000000000001",
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: { kind: "transcript", role: "user", segments: [] },
	};
}

describe("deriveCanonicalUserEntryPresence", () => {
	it("keeps missing canonical transcript distinct from empty canonical transcript", () => {
		expect(
			deriveCanonicalUserEntryPresence({
				transcriptEntries: null,
				pendingAttemptId: "attempt-1",
			})
		).toEqual({
			hasCanonicalUserEntry: null,
			hasCanonicalMatchingPendingUserEntry: null,
		});

		expect(
			deriveCanonicalUserEntryPresence({
				transcriptEntries: [],
				pendingAttemptId: "attempt-1",
			})
		).toEqual({
			hasCanonicalUserEntry: false,
			hasCanonicalMatchingPendingUserEntry: false,
		});
	});

	it("detects canonical user entries and matching pending attempts", () => {
		expect(
			deriveCanonicalUserEntryPresence({
				transcriptEntries: [
					transcriptEntry({
						entryId: "assistant-1",
						role: "assistant",
						attemptId: null,
					}),
					transcriptEntry({
						entryId: "user-1",
						role: "user",
						attemptId: "attempt-1",
					}),
				],
				viewportRows: [viewportUserRow("user-1")],
				pendingAttemptId: "attempt-1",
			})
		).toEqual({
			hasCanonicalUserEntry: true,
			hasCanonicalMatchingPendingUserEntry: true,
		});
	});

	it("keeps the optimistic row until the matching canonical viewport row is renderable", () => {
		expect(
			deriveCanonicalUserEntryPresence({
				transcriptEntries: [
					transcriptEntry({
						entryId: "user-1",
						role: "user",
						attemptId: "attempt-1",
					}),
				],
				viewportRows: [],
				pendingAttemptId: "attempt-1",
			})
		).toEqual({
			hasCanonicalUserEntry: true,
			hasCanonicalMatchingPendingUserEntry: false,
		});
	});
});

describe("resolveOptimisticUserEntryForGraph", () => {
	it("keeps the panel pending entry during the first-send session handoff", () => {
		const panelPending = createUserEntry("panel-pending", "Hello Claude");

		const entry = resolveOptimisticUserEntryForGraph({
			panelPendingUserEntry: panelPending,
			sessionPendingOptimisticEntry: null,
			hasCanonicalUserEntry: false,
			hasCanonicalMatchingPendingUserEntry: false,
		});

		expect(entry).toBe(panelPending);
	});

	it("uses the session pending entry once sendMessage has taken over", () => {
		const panelPending = createUserEntry("panel-pending", "Hello Claude");
		const sessionPending = createUserEntry("session-pending", "Hello Claude");

		const entry = resolveOptimisticUserEntryForGraph({
			panelPendingUserEntry: panelPending,
			sessionPendingOptimisticEntry: sessionPending,
			hasCanonicalUserEntry: false,
			hasCanonicalMatchingPendingUserEntry: false,
		});

		expect(entry).toBe(sessionPending);
	});

	it("shows a new panel-local send immediately even when the session already has user rows", () => {
		const panelPending = createUserEntry("panel-pending", "Hello Claude");

		const entry = resolveOptimisticUserEntryForGraph({
			panelPendingUserEntry: panelPending,
			sessionPendingOptimisticEntry: null,
			hasCanonicalUserEntry: true,
			hasCanonicalMatchingPendingUserEntry: false,
		});

		expect(entry).toBe(panelPending);
	});

	it("does not keep a session pending entry after its canonical user entry arrives", () => {
		const sessionPending = createUserEntry("session-pending", "Hello Claude");

		const entry = resolveOptimisticUserEntryForGraph({
			panelPendingUserEntry: null,
			sessionPendingOptimisticEntry: sessionPending,
			hasCanonicalUserEntry: true,
			hasCanonicalMatchingPendingUserEntry: true,
		});

		expect(entry).toBeNull();
	});

	it("shows the immediate panel or session pending entry while canonical state is unknown", () => {
		const panelPending = createUserEntry("panel-pending", "Hello Claude");
		const sessionPending = createUserEntry("session-pending", "Hello Claude");

		const panelEntry = resolveOptimisticUserEntryForGraph({
			panelPendingUserEntry: panelPending,
			sessionPendingOptimisticEntry: null,
			hasCanonicalUserEntry: null,
			hasCanonicalMatchingPendingUserEntry: null,
		});
		const sessionEntry = resolveOptimisticUserEntryForGraph({
			panelPendingUserEntry: null,
			sessionPendingOptimisticEntry: sessionPending,
			hasCanonicalUserEntry: null,
			hasCanonicalMatchingPendingUserEntry: null,
		});

		expect(panelEntry).toBe(panelPending);
		expect(sessionEntry).toBe(sessionPending);
	});
});

describe("resolveVisibleEntryCount", () => {
	it("counts optimistic entry while canonical entry count is unknown", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: null,
			canonicalMessageCount: null,
			optimisticUserEntry: createUserEntry("pending-user", "Hello Claude"),
		});

		expect(count).toBe(1);
	});

	it("counts the optimistic user entry while canonical entries are empty", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: 0,
			canonicalMessageCount: 0,
			optimisticUserEntry: createUserEntry("pending-user", "Hello Claude"),
		});

		expect(count).toBe(1);
	});

	it("uses canonical entry count once canonical entries exist", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: 2,
			canonicalMessageCount: 2,
			optimisticUserEntry: createUserEntry("pending-user", "Hello Claude"),
		});

		expect(count).toBe(2);
	});

	it("uses canonical message count when the transcript body was compacted away", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: 0,
			canonicalMessageCount: 5349,
			optimisticUserEntry: null,
		});

		expect(count).toBe(5349);
	});

	it("uses cached canonical viewport rows while the full transcript count is not materialized yet", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: null,
			canonicalMessageCount: null,
			canonicalViewportRowCount: 16,
			optimisticUserEntry: null,
		});

		expect(count).toBe(16);
	});

	it("returns zero when there are no canonical or optimistic entries", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: 0,
			canonicalMessageCount: 0,
			optimisticUserEntry: null,
		});

		expect(count).toBe(0);
	});
});
