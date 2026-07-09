import { describe, expect, it } from "bun:test";
import {
	resolveTranscriptViewportSceneEntry,
	segmentText,
	toolStatusFromOperationState,
} from "../transcript-viewport-row-mapper.js";
import type { TranscriptViewportRow } from "../../../../../services/acp-types.js";

describe("transcript-viewport-row-mapper", () => {
	it("concatenates transcript segment text", () => {
		expect(
			segmentText([
				{ kind: "text", segmentId: "s1", text: "Hello " },
				{ kind: "text", segmentId: "s2", text: "world" },
			])
		).toBe("Hello world");
	});

	it("prefers canonical scene entries when present", () => {
		const row = {
			rowId: "assistant-1",
			sourceEntryId: "assistant-1",
			kind: "assistant",
			version: 1,
			content: { kind: "transcript", role: "assistant", segments: [] },
			operationLinks: [],
			activeStreamingTail: null,
		} as unknown as TranscriptViewportRow;
		const canonical = {
			id: "assistant-1",
			type: "assistant" as const,
			markdown: "Canonical",
			message: { chunks: [] },
		};
		const entry = resolveTranscriptViewportSceneEntry(
			row,
			new Map([["assistant-1", canonical]])
		);
		expect(entry).toBe(canonical);
	});

	it("overlays viewport planning timing onto canonical assistant entries", () => {
		const row = {
			rowId: "assistant-1",
			sourceEntryId: "assistant-1",
			kind: "assistant",
			version: 1,
			content: { kind: "transcript", role: "assistant", segments: [] },
			operationLinks: [],
			activeStreamingTail: "message",
			durationStartedAtMs: 1_700_000_000_000,
		} as unknown as TranscriptViewportRow;
		const canonical = {
			id: "assistant-1",
			type: "assistant" as const,
			markdown: "",
			message: { chunks: [] },
			isStreaming: true,
			planningStartedAtMs: null,
		};
		expect(
			resolveTranscriptViewportSceneEntry(row, new Map([["assistant-1", canonical]]))
		).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			planningStartedAtMs: 1_700_000_000_000,
		});
	});

	it("maps awaiting placeholder rows to thinking entries", () => {
		const row = {
			rowId: "awaiting-1",
			sourceEntryId: "awaiting-1",
			kind: "awaitingPlaceholder",
			version: 1,
			content: { kind: "placeholder" },
			operationLinks: [],
			activeStreamingTail: null,
			durationStartedAtMs: 1_700_000_000_000,
		} as unknown as TranscriptViewportRow;
		expect(resolveTranscriptViewportSceneEntry(row, new Map())).toEqual({
			id: "awaiting-1",
			type: "thinking",
			durationMs: null,
			startedAtMs: 1_700_000_000_000,
		});
	});

	it("maps streaming assistant rows to planning duration anchors", () => {
		const row = {
			rowId: "assistant-1",
			sourceEntryId: "assistant-1",
			kind: "assistant",
			version: 1,
			content: {
				kind: "transcript",
				role: "assistant",
				segments: [{ kind: "thought", segmentId: "s1", text: "" }],
			},
			operationLinks: [],
			activeStreamingTail: "message",
			durationStartedAtMs: 1_700_000_000_000,
		} as unknown as TranscriptViewportRow;
		expect(resolveTranscriptViewportSceneEntry(row, new Map())).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			isStreaming: true,
			planningStartedAtMs: 1_700_000_000_000,
		});
	});

	it("maps compaction rows to session activity entries", () => {
		const row = {
			rowId: "transcript:compact-entry-1",
			sourceEntryId: "compact-entry-1",
			kind: "sessionActivity",
			version: "compact-row:v1",
			anchorEligible: true,
			activeStreamingTail: null,
			operationLinks: [],
			interactionLinks: [],
			content: {
				kind: "compaction",
				event: {
					eventId: "compact-1",
					sessionId: "session-1",
					status: "completed",
					trigger: "auto",
					preCompactionTokens: 180000,
					postCompactionTokens: 42000,
					droppedTokens: 138000,
					contextWindowSize: 200000,
					durationMs: 918,
					precomputed: true,
					preservedMessageCount: 2,
					cumulativeDroppedTokens: 300000,
					timestampMs: 1770000000000,
					summary: "Compaction done",
					providerMetadata: { subtype: "compact_boundary" },
				},
			},
			durationStartedAtMs: null,
		} as TranscriptViewportRow;

		expect(resolveTranscriptViewportSceneEntry(row, new Map())).toEqual({
			id: "compact-entry-1",
			type: "session_activity",
			activityKind: "compaction",
			title: "Compaction done",
			status: "completed",
			subtitle: "138,000 tokens freed",
			metadata: [
				{ label: "Trigger", value: "Auto" },
				{ label: "Before", value: "180,000" },
				{ label: "After", value: "42,000" },
				{ label: "Window", value: "200,000" },
				{ label: "Duration", value: "918 ms" },
				{ label: "Precomputed", value: "Yes" },
				{ label: "Preserved", value: "2" },
				{ label: "Dropped total", value: "300,000" },
			],
		});
	});

	it("maps operation states to tool statuses", () => {
		expect(toolStatusFromOperationState("running")).toBe("running");
		expect(toolStatusFromOperationState("completed")).toBe("done");
		expect(toolStatusFromOperationState("failed")).toBe("error");
	});
});
