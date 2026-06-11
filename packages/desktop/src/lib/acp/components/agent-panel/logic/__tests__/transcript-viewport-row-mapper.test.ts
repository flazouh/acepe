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

	it("maps awaiting placeholder rows to thinking entries", () => {
		const row = {
			rowId: "awaiting-1",
			sourceEntryId: "awaiting-1",
			kind: "awaitingPlaceholder",
			version: 1,
			content: { kind: "placeholder" },
			operationLinks: [],
			activeStreamingTail: null,
		} as unknown as TranscriptViewportRow;
		expect(resolveTranscriptViewportSceneEntry(row, new Map())).toEqual({
			id: "awaiting-1",
			type: "thinking",
			durationMs: null,
		});
	});

	it("maps operation states to tool statuses", () => {
		expect(toolStatusFromOperationState("running")).toBe("running");
		expect(toolStatusFromOperationState("completed")).toBe("done");
		expect(toolStatusFromOperationState("failed")).toBe("error");
	});
});
