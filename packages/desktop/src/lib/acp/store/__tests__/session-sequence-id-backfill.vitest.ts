import { describe, expect, it } from "vitest";

import { resolveSequenceIdBackfillForExistingSession } from "../session-sequence-id-backfill.js";

describe("resolveSequenceIdBackfillForExistingSession", () => {
	it("does not overwrite an existing metadata sequence id", () => {
		expect(
			resolveSequenceIdBackfillForExistingSession({
				metadataSequenceId: 3,
				graphSequenceId: 9,
				pendingSequenceId: 12,
			})
		).toBeNull();
	});

	it("prefers the canonical graph sequence id when metadata is still empty", () => {
		expect(
			resolveSequenceIdBackfillForExistingSession({
				metadataSequenceId: null,
				graphSequenceId: 9,
				pendingSequenceId: 12,
			})
		).toBe(9);
	});

	it("falls back to pending creation sequence id when graph has not arrived yet", () => {
		expect(
			resolveSequenceIdBackfillForExistingSession({
				metadataSequenceId: undefined,
				graphSequenceId: null,
				pendingSequenceId: 12,
			})
		).toBe(12);
	});
});
