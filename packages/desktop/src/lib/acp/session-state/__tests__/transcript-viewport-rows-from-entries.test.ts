import { describe, expect, it } from "bun:test";
import type {
	OperationSnapshot,
	SessionCompactionEvent,
	TranscriptEntry,
} from "../../../services/acp-types.js";
import { transcriptViewportRowsFromEntries } from "../transcript-viewport-rows-from-entries.js";

const baseOperation: OperationSnapshot = {
	id: "op-1",
	session_id: "session-1",
	tool_call_id: "tool-1",
	name: "Read package.json",
	kind: null,
	provider_status: "in_progress",
	title: "Read package.json",
	arguments: { kind: "other", raw: null },
	progressive_arguments: null,
	result: null,
	command: null,
	normalized_todos: null,
	parent_tool_call_id: null,
	parent_operation_id: null,
	child_tool_call_ids: [],
	child_operation_ids: [],
	operation_state: "running",
	awaiting_plan_approval: false,
	source_link: { kind: "transcript_linked", entry_id: "entry-tool-1" },
};

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

	// Reproduces the live defect: every row hardcoded activeStreamingTail to
	// null, so the row mapper's `isStreaming: row.activeStreamingTail !== null`
	// was permanently false and every streaming reveal mode (fade + reveal
	// included) rendered as "instant" -- measured live: a full reply streamed
	// with data-native-markdown-mode="static" throughout.
	it("marks the graph's live tail row with the tail's content kind", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-user",
				role: "user",
				segments: [{ kind: "text", segmentId: "seg-u", text: "why?" }],
			},
			{
				entryId: "entry-assistant-1",
				role: "assistant",
				segments: [{ kind: "text", segmentId: "seg-a", text: "Because" }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries, [], {
			rowId: "entry-assistant-1",
			contentKind: "message",
		});

		expect(rows.map((row) => row.activeStreamingTail)).toEqual([null, "message"]);
	});

	it("marks a thought tail with the thought content kind", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-assistant-1",
				role: "assistant",
				segments: [{ kind: "thought", segmentId: "seg-t", text: "Weighing." }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries, [], {
			rowId: "entry-assistant-1",
			contentKind: "thought",
		});

		expect(rows[0]?.activeStreamingTail).toBe("thought");
	});

	it("leaves every row untailed when no live tail is given", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-assistant-1",
				role: "assistant",
				segments: [{ kind: "text", segmentId: "seg-a", text: "Done." }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries, []);

		expect(rows[0]?.activeStreamingTail).toBeNull();
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

	it("maps a tool-role entry to a tool row, linked to its canonical operation", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-tool-1",
				role: "tool",
				segments: [{ kind: "text", segmentId: "seg-tool-1", text: "Read package.json" }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries, [baseOperation]);

		expect(rows[0]?.kind).toBe("tool");
		expect(rows[0]?.operationLinks).toEqual([
			{
				operationId: "op-1",
				toolCallId: "tool-1",
				name: "Read package.json",
				state: "running",
				operation: baseOperation,
			},
		]);
	});

	it("leaves operationLinks empty for a tool entry with no matching canonical operation", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-tool-2",
				role: "tool",
				segments: [{ kind: "text", segmentId: "seg-tool-2", text: "Read other.json" }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries, [baseOperation]);

		expect(rows[0]?.kind).toBe("tool");
		expect(rows[0]?.operationLinks).toEqual([]);
	});

	it("re-resolves operationLinks to the current operation state (status transitions render)", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-tool-1",
				role: "tool",
				segments: [{ kind: "text", segmentId: "seg-tool-1", text: "Read package.json" }],
			},
		];
		const completedOperation: OperationSnapshot = {
			...baseOperation,
			operation_state: "completed",
		};

		const rows = transcriptViewportRowsFromEntries(entries, [completedOperation]);

		expect(rows[0]?.operationLinks[0]?.state).toBe("completed");
	});

	it("defaults operations to empty when omitted, so existing non-tool callers are unaffected", () => {
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-1",
				role: "user",
				segments: [{ kind: "text", segmentId: "s", text: "hi" }],
			},
		];

		const rows = transcriptViewportRowsFromEntries(entries);

		expect(rows[0]?.operationLinks).toEqual([]);
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
