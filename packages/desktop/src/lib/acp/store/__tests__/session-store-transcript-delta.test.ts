import { describe, expect, it } from "vitest";

import type {
	TranscriptDelta,
	TranscriptEntry,
	TranscriptSnapshot,
} from "../../../services/acp-types.js";
import { transcriptEntryIndexes } from "../transcript-entry-index.js";
import { applyTranscriptDeltaToSnapshot } from "../transcript-delta.js";
import { transcriptSegmentPrimaryText } from "../../session-state/transcript-text.js";

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

	it("appends a new entry without slicing or concatenating the whole entry list", () => {
		const userEntry = textEntry("user-1", "user", "Prompt");
		const assistantEntry = textEntry("assistant-1", "assistant", "Answer");
		const nextEntry = textEntry("tool-1", "tool", "Run");
		const currentEntries = [userEntry, assistantEntry];
		const originalSlice = currentEntries.slice;
		const originalConcat = currentEntries.concat;
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

		currentEntries.slice = () => {
			throw new Error("must not slice whole transcript entry list");
		};
		currentEntries.concat = () => {
			throw new Error("must not concatenate whole transcript entry list");
		};

		try {
			const nextSnapshot = applyTranscriptDeltaToSnapshot(snapshot(currentEntries), delta);

			expect(Array.isArray(nextSnapshot.entries)).toBe(true);
			expect(nextSnapshot.entries).toHaveLength(3);
			expect(nextSnapshot.entries[0]).toBe(userEntry);
			expect(nextSnapshot.entries[1]).toBe(assistantEntry);
			expect(nextSnapshot.entries[2]).toBe(nextEntry);
			expect(nextSnapshot.entries.map((entry) => entry.entryId)).toEqual([
				"user-1",
				"assistant-1",
				"tool-1",
			]);
		} finally {
			currentEntries.slice = originalSlice;
			currentEntries.concat = originalConcat;
		}
	});

	it("appends transcript entry indexes without cloning the current index", () => {
		const userEntry = textEntry("user-1", "user", "Prompt");
		const assistantEntry = textEntry("assistant-1", "assistant", "Answer");
		const nextEntry = textEntry("tool-1", "tool", "Run");
		const currentEntries = [userEntry, assistantEntry];
		applyTranscriptDeltaToSnapshot(snapshot(currentEntries), {
			eventSeq: 1,
			sessionId: "session-1",
			snapshotRevision: 1,
			operations: [
				{
					kind: "appendSegment",
					entryId: "assistant-1",
					role: "assistant",
					segment: {
						kind: "text",
						segmentId: "assistant-1:seed",
						text: "",
					},
				},
			],
		});
		const currentIndex = transcriptEntryIndexes.get(currentEntries) as
			| (ReadonlyMap<string, number> & Record<symbol, unknown>)
			| undefined;
		expect(currentIndex).not.toBeUndefined();
		const originalIterator = currentIndex?.[Symbol.iterator];
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
		if (currentIndex !== undefined) {
			currentIndex[Symbol.iterator] = () => {
				throw new Error("must not clone current transcript entry index for append");
			};
		}

		try {
			const nextSnapshot = applyTranscriptDeltaToSnapshot(snapshot(currentEntries), delta);
			const nextIndex = transcriptEntryIndexes.get(nextSnapshot.entries);

			expect(nextSnapshot.entries[2]).toBe(nextEntry);
			expect(nextIndex?.get("user-1")).toBe(0);
			expect(nextIndex?.get("assistant-1")).toBe(1);
			expect(nextIndex?.get("tool-1")).toBe(2);
		} finally {
			if (currentIndex !== undefined && originalIterator !== undefined) {
				currentIndex[Symbol.iterator] = originalIterator;
			}
		}
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
		expect(nextSnapshot.entries[1]?.segments.map((segment) => transcriptSegmentPrimaryText(segment))).toEqual([
			"Answer",
			" More",
		]);
	});

	it("appends one segment without slicing the whole entry list", () => {
		const userEntry = textEntry("user-1", "user", "Prompt");
		const assistantEntry = textEntry("assistant-1", "assistant", "Answer");
		const currentEntries = [userEntry, assistantEntry];
		const originalSlice = currentEntries.slice;
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

		currentEntries.slice = () => {
			throw new Error("must not slice whole transcript entry list");
		};

		try {
			const nextSnapshot = applyTranscriptDeltaToSnapshot(snapshot(currentEntries), delta);

			expect(Array.isArray(nextSnapshot.entries)).toBe(true);
			expect(nextSnapshot.entries).toHaveLength(2);
			expect(nextSnapshot.entries[0]).toBe(userEntry);
			expect(nextSnapshot.entries[1]).not.toBe(assistantEntry);
			expect([...nextSnapshot.entries][1]?.segments.map((segment) => transcriptSegmentPrimaryText(segment))).toEqual([
				"Answer",
				" More",
			]);
		} finally {
			currentEntries.slice = originalSlice;
		}
	});
});
