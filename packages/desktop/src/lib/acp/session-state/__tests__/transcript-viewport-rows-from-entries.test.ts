import { describe, expect, it } from "bun:test";
import type { SessionCompactionEvent, TranscriptEntry } from "../../../services/acp-types.js";
import { transcriptViewportRowsFromEntries } from "../transcript-viewport-rows-from-entries.js";

describe("transcriptViewportRowsFromEntries", () => {
	it("maps a user entry to a user row with real segment content", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-1",
				role: "user",
				segments: [{ kind: "text", segmentId: "seg-1", text: "hello" }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries);

		expect(rows).toEqual([
			{
				rowId: "entry-1",
				sourceEntryId: "entry-1",
				scope: undefined,
				kind: "user",
				version: "1",
				anchorEligible: true,
				activeStreamingTail: null,
				operationLinks: [],
				interactionLinks: [],
				content: {
					kind: "transcript",
					role: "user",
					segments: [{ kind: "text", segmentId: "seg-1", text: "hello" }],
				},
				timestampMs: null,
			},
		]);
	});

	it("classifies an assistant entry with only thought segments as assistantThought", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-2",
				role: "assistant",
				segments: [{ kind: "thought", segmentId: "seg-2", text: "thinking" }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries);

		expect(rows[0]?.kind).toBe("assistantThought");
	});

	it("classifies an assistant entry with text segments as assistantText", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-3",
				role: "assistant",
				segments: [{ kind: "text", segmentId: "seg-3", text: "the answer" }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries);

		expect(rows[0]?.kind).toBe("assistantText");
	});

	it("bumps version as segments accumulate on the same entryId (streamed tokens)", () => {
		const before = transcriptViewportRowsFromEntries([
			{
				entryId: "entry-4",
				role: "assistant",
				segments: [{ kind: "text", segmentId: "seg-4-0", text: "he" }],
			},
		]);
		const after = transcriptViewportRowsFromEntries([
			{
				entryId: "entry-4",
				role: "assistant",
				segments: [
					{ kind: "text", segmentId: "seg-4-0", text: "he" },
					{ kind: "text", segmentId: "seg-4-1", text: "llo" },
				],
			},
		]);

		expect(before[0]?.version).not.toBe(after[0]?.version);
	});

	it("preserves entry scope for operation-scoped rows", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-5",
				scope: { kind: "operation", operationId: "op-1" },
				role: "assistant",
				segments: [{ kind: "text", segmentId: "seg-5", text: "subagent reply" }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries);

		expect(rows[0]?.scope).toEqual({ kind: "operation", operationId: "op-1" });
	});

	it("maps a compaction segment to compaction content", () => {
		const compactionEvent: SessionCompactionEvent = {
			eventId: "compaction-1",
			sessionId: "session-1",
			status: "completed",
			trigger: "auto",
			providerMetadata: null,
		};
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-6",
				role: "sessionActivity",
				segments: [{ kind: "compaction", segmentId: "seg-6", event: compactionEvent }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries);

		expect(rows[0]?.content).toEqual({ kind: "compaction", event: compactionEvent });
	});

	it("preserves real entry order (never re-sorts)", () => {
		const entries: TranscriptEntry[] = [
			{ entryId: "b", role: "user", segments: [{ kind: "text", segmentId: "s-b", text: "b" }] },
			{ entryId: "a", role: "user", segments: [{ kind: "text", segmentId: "s-a", text: "a" }] },
		];

		const rows = transcriptViewportRowsFromEntries(entries);

		expect(rows.map((row) => row.rowId)).toEqual(["b", "a"]);
	});
});
