import { describe, expect, it } from "vitest";

import type {
	TranscriptDelta,
	TranscriptEntry,
	TranscriptSnapshot,
} from "../../../services/acp-types.js";
import { applyTranscriptDeltaToSnapshot } from "../session-store.svelte.js";

function textEntry(
	entryId: string,
	role: TranscriptEntry["role"],
	text: string
): TranscriptEntry {
	return {
		entryId,
		role,
		segments: [
			{
				kind: "text",
				segmentId: `${entryId}:segment-1`,
				text,
			},
		],
	};
}

function snapshot(entries: TranscriptEntry[]): TranscriptSnapshot {
	return {
		revision: 1,
		entries,
	};
}

describe("applyTranscriptDeltaToSnapshot", () => {
	it("appends a new entry without rebuilding existing transcript entry objects", () => {
		const userEntry = textEntry("user-1", "user", "Prompt");
		const assistantEntry = textEntry("assistant-1", "assistant", "Answer");
		const nextEntry = textEntry("tool-1", "tool", "Run");
		const delta: TranscriptDelta = {
			eventSeq: 2,
			sessionId: "session-1",
			snapshotRevision: 2,
			operations: [
				{
					kind: "appendEntry",
					entry: nextEntry,
				},
			],
		};

		const nextSnapshot = applyTranscriptDeltaToSnapshot(
			snapshot([userEntry, assistantEntry]),
			delta
		);

		expect(nextSnapshot.revision).toBe(2);
		expect(nextSnapshot.entries).toHaveLength(3);
		expect(nextSnapshot.entries[0]).toBe(userEntry);
		expect(nextSnapshot.entries[1]).toBe(assistantEntry);
		expect(nextSnapshot.entries[2]).toBe(nextEntry);
	});

	it("patches one segment by index without rebuilding sibling transcript entries", () => {
		const userEntry = textEntry("user-1", "user", "Prompt");
		const assistantEntry = textEntry("assistant-1", "assistant", "Answer");
		const delta: TranscriptDelta = {
			eventSeq: 2,
			sessionId: "session-1",
			snapshotRevision: 2,
			operations: [
				{
					kind: "appendSegment",
					entryId: "assistant-1",
					role: "assistant",
					segment: {
						kind: "text",
						segmentId: "assistant-1:segment-2",
						text: " More",
					},
				},
			],
		};

		const nextSnapshot = applyTranscriptDeltaToSnapshot(
			snapshot([userEntry, assistantEntry]),
			delta
		);

		expect(nextSnapshot.entries).toHaveLength(2);
		expect(nextSnapshot.entries[0]).toBe(userEntry);
		expect(nextSnapshot.entries[1]).not.toBe(assistantEntry);
		expect(nextSnapshot.entries[1]?.segments.map((segment) => segment.text)).toEqual([
			"Answer",
			" More",
		]);
	});
});
