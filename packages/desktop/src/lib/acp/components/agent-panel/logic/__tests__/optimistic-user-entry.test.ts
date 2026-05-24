import { describe, expect, it } from "bun:test";

import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import type { TranscriptEntry } from "../../../../../services/acp-types.js";
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
				pendingAttemptId: "attempt-1",
			})
		).toEqual({
			hasCanonicalUserEntry: true,
			hasCanonicalMatchingPendingUserEntry: true,
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

	it("does not keep a stale panel pending entry after the canonical user entry arrives", () => {
		const panelPending = createUserEntry("panel-pending", "Hello Claude");

		const entry = resolveOptimisticUserEntryForGraph({
			panelPendingUserEntry: panelPending,
			sessionPendingOptimisticEntry: null,
			hasCanonicalUserEntry: true,
			hasCanonicalMatchingPendingUserEntry: false,
		});

		expect(entry).toBeNull();
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

	it("shows session pending entry while canonical transcript state is unknown", () => {
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

		expect(panelEntry).toBeNull();
		expect(sessionEntry).toBe(sessionPending);
	});
});

describe("resolveVisibleEntryCount", () => {
	it("counts optimistic entry while canonical entry count is unknown", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: null,
			optimisticUserEntry: createUserEntry("pending-user", "Hello Claude"),
		});

		expect(count).toBe(1);
	});

	it("counts the optimistic user entry while canonical entries are empty", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: 0,
			optimisticUserEntry: createUserEntry("pending-user", "Hello Claude"),
		});

		expect(count).toBe(1);
	});

	it("uses canonical entry count once canonical entries exist", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: 2,
			optimisticUserEntry: createUserEntry("pending-user", "Hello Claude"),
		});

		expect(count).toBe(2);
	});

	it("returns zero when there are no canonical or optimistic entries", () => {
		const count = resolveVisibleEntryCount({
			canonicalEntryCount: 0,
			optimisticUserEntry: null,
		});

		expect(count).toBe(0);
	});
});
