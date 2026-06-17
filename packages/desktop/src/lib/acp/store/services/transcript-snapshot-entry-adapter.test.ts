import { describe, expect, it } from "bun:test";

import {
	appendTranscriptSegmentToSessionEntry,
	convertTranscriptSnapshotToSessionEntries,
} from "./transcript-snapshot-entry-adapter.js";

describe("convertTranscriptSnapshotToSessionEntries", () => {
	it("converts transcript roles into session entries", () => {
		const timestamp = new Date("2026-04-16T00:00:00Z");
		const entries = convertTranscriptSnapshotToSessionEntries(
			{
				revision: 9,
				entries: [
					{
						entryId: "user-1",
						role: "user",
						segments: [{ kind: "text", segmentId: "user-1:block:0", text: "hello" }],
					},
					{
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{ kind: "thought", segmentId: "assistant-1:chunk:0", text: "thinking" },
							{ kind: "text", segmentId: "assistant-1:chunk:1", text: "hi" },
						],
					},
					{
						entryId: "tool-1",
						role: "tool",
						segments: [{ kind: "text", segmentId: "tool-1:tool", text: "Read file" }],
					},
				],
			},
			timestamp
		);

		expect(entries).toHaveLength(3);
		expect(entries[0]).toEqual({
			id: "user-1",
			type: "user",
			message: {
				id: "user-1",
				content: { type: "text", text: "hello" },
				chunks: [{ type: "text", text: "hello" }],
			},
			timestamp,
		});
		expect(entries[1]).toEqual({
			id: "assistant-1",
			type: "assistant",
			message: {
				chunks: [
					{ type: "thought", block: { type: "text", text: "thinking" } },
					{ type: "message", block: { type: "text", text: "hi" } },
				],
			},
			timestamp,
		});
		expect(entries[2]).toEqual({
			id: "tool-1",
			type: "tool_call",
			message: {
				id: "tool-1",
				name: "Read file",
				arguments: { kind: "other", raw: null },
				status: "completed",
				result: null,
				kind: "other",
				title: "Read file",
				locations: null,
				skillMeta: null,
				normalizedQuestions: null,
				normalizedTodos: null,
				parentToolUseId: null,
				taskChildren: null,
				questionAnswer: null,
				awaitingPlanApproval: false,
				planApprovalRequestId: null,
			},
			timestamp,
		});
	});

	it("converts transcript snapshots without using broad map helpers", () => {
		const timestamp = new Date("2026-04-16T00:00:00Z");
		const snapshot = {
			revision: 10,
			entries: [
				{
					entryId: "assistant-1",
					role: "assistant" as const,
					segments: [
						{ kind: "thought" as const, segmentId: "assistant-1:chunk:0", text: "thinking" },
						{ kind: "text" as const, segmentId: "assistant-1:chunk:1", text: "hi" },
					],
				},
			],
		};
		const originalEntriesMap = snapshot.entries.map;
		const originalSegmentsMap = snapshot.entries[0]!.segments.map;
		snapshot.entries.map = () => {
			throw new Error("must not map every transcript entry during snapshot conversion");
		};
		snapshot.entries[0]!.segments.map = () => {
			throw new Error("must not map every transcript segment during entry conversion");
		};

		try {
			const entries = convertTranscriptSnapshotToSessionEntries(snapshot, timestamp);

			expect(entries).toHaveLength(1);
			expect(entries[0]).toEqual({
				id: "assistant-1",
				type: "assistant",
				message: {
					chunks: [
						{ type: "thought", block: { type: "text", text: "thinking" } },
						{ type: "message", block: { type: "text", text: "hi" } },
					],
				},
				timestamp,
			});
		} finally {
			snapshot.entries.map = originalEntriesMap;
			snapshot.entries[0]!.segments.map = originalSegmentsMap;
		}
	});

	it("appends transcript segments to tool entries", () => {
		const timestamp = new Date("2026-04-16T00:00:00Z");
		const updatedEntry = appendTranscriptSegmentToSessionEntry(
			{
				id: "tool-1",
				type: "tool_call",
				message: {
					id: "tool-1",
					name: "Read file",
					arguments: { kind: "other", raw: null },
					progressiveArguments: undefined,
					status: "completed",
					result: null,
					kind: "other",
					title: "Read file",
					locations: null,
					skillMeta: null,
					normalizedQuestions: null,
					normalizedTodos: null,
					parentToolUseId: null,
					taskChildren: null,
					questionAnswer: null,
					awaitingPlanApproval: false,
					planApprovalRequestId: null,
					normalizedResult: null,
				},
				timestamp,
			},
			{ kind: "text", segmentId: "tool-1:tool:1", text: "stdout ready" }
		);

		expect(updatedEntry).toEqual({
			id: "tool-1",
			type: "tool_call",
			message: {
				id: "tool-1",
				name: "Read file\nstdout ready",
				arguments: { kind: "other", raw: null },
				progressiveArguments: undefined,
				status: "completed",
				result: null,
				kind: "other",
				title: "Read file\nstdout ready",
				locations: null,
				skillMeta: null,
				normalizedQuestions: null,
				normalizedTodos: null,
				parentToolUseId: null,
				taskChildren: null,
				questionAnswer: null,
				awaitingPlanApproval: false,
				planApprovalRequestId: null,
				normalizedResult: null,
			},
			timestamp,
			isStreaming: undefined,
		});
	});
});
