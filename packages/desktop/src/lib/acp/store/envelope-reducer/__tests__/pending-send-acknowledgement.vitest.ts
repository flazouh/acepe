import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../../../../services/acp-types.js";
import type { SessionPendingSendIntent } from "../../types.js";
import { acknowledgedPendingSendAttemptId } from "../pending-send-acknowledgement.js";

function createPendingSendIntent(
	overrides: Partial<SessionPendingSendIntent> = {}
): SessionPendingSendIntent {
	return {
		attemptId: "attempt-1",
		startedAt: 1,
		baselineTranscriptRevision: 6,
		promptLength: 5,
		optimisticEntry: {
			type: "user",
			id: "optimistic-1",
			timestamp: new Date(1),
			message: {
				content: { type: "text", text: "hello" },
				chunks: [{ type: "text", text: "hello" }],
				sentAt: new Date(1),
			},
		},
		...overrides,
	};
}

function userEntry(input: {
	readonly entryId: string;
	readonly text: string;
	readonly attemptId?: string | null;
}): TranscriptEntry {
	return {
		entryId: input.entryId,
		role: "user",
		attemptId: input.attemptId ?? null,
		segments: [{ kind: "text", segmentId: `${input.entryId}:block:0`, text: input.text }],
	};
}

describe("acknowledgedPendingSendAttemptId", () => {
	it("acknowledges a canonical user entry carrying the pending attempt id", () => {
		expect(
			acknowledgedPendingSendAttemptId({
				pendingSendIntent: createPendingSendIntent(),
				entries: [userEntry({ entryId: "user-1", text: "hello", attemptId: "attempt-1" })],
				previousEntries: [],
				transcriptRevision: 7,
			})
		).toBe("attempt-1");
	});

	it("ignores a user entry carrying another send's attempt id", () => {
		expect(
			acknowledgedPendingSendAttemptId({
				pendingSendIntent: createPendingSendIntent(),
				entries: [userEntry({ entryId: "user-1", text: "hello", attemptId: "attempt-0" })],
				previousEntries: [],
				transcriptRevision: 7,
			})
		).toBeNull();
	});

	it("acknowledges a new attempt-id-less user entry carrying the prompt text", () => {
		expect(
			acknowledgedPendingSendAttemptId({
				pendingSendIntent: createPendingSendIntent(),
				entries: [
					userEntry({ entryId: "user-0", text: "earlier prompt" }),
					userEntry({ entryId: "user-1", text: "hello" }),
				],
				previousEntries: [userEntry({ entryId: "user-0", text: "earlier prompt" })],
				transcriptRevision: 7,
			})
		).toBe("attempt-1");
	});

	it("does not let an identical earlier prompt acknowledge a resend", () => {
		expect(
			acknowledgedPendingSendAttemptId({
				pendingSendIntent: createPendingSendIntent(),
				entries: [userEntry({ entryId: "user-0", text: "hello" })],
				previousEntries: [userEntry({ entryId: "user-0", text: "hello" })],
				transcriptRevision: 7,
			})
		).toBeNull();
	});

	it("does not acknowledge by text before the transcript passes the send baseline", () => {
		expect(
			acknowledgedPendingSendAttemptId({
				pendingSendIntent: createPendingSendIntent(),
				entries: [userEntry({ entryId: "user-1", text: "hello" })],
				previousEntries: [],
				transcriptRevision: 6,
			})
		).toBeNull();
	});

	it("returns null when no send is pending", () => {
		expect(
			acknowledgedPendingSendAttemptId({
				pendingSendIntent: null,
				entries: [userEntry({ entryId: "user-1", text: "hello", attemptId: "attempt-1" })],
				previousEntries: [],
				transcriptRevision: 7,
			})
		).toBeNull();
	});

	it("never acknowledges from an assistant entry that repeats the prompt text", () => {
		expect(
			acknowledgedPendingSendAttemptId({
				pendingSendIntent: createPendingSendIntent(),
				entries: [
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [{ kind: "text", segmentId: "assistant-1:block:0", text: "hello" }],
					},
				],
				previousEntries: [],
				transcriptRevision: 7,
			})
		).toBeNull();
	});
});
