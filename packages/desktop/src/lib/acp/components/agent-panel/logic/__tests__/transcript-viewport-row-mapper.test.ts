import { describe, expect, it } from "bun:test";
import {
	resolveTranscriptViewportSceneEntry,
	segmentText,
	toolStatusFromOperationState,
} from "../transcript-viewport-row-mapper.js";
import type {
	OperationSnapshot,
	TranscriptViewportOperationDisplayFacts,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";

function toolRowWithText(input: {
	readonly text: string;
	readonly operationLinks: TranscriptViewportRow["operationLinks"];
}): TranscriptViewportRow {
	return {
		rowId: "transcript:assistant-1:tool:call-1",
		sourceEntryId: "assistant-1",
		kind: "tool",
		version: "tool-row:v1",
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: input.operationLinks,
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "tool",
			segments: [{ kind: "text", segmentId: "tool-segment-1", text: input.text }],
		},
		durationStartedAtMs: null,
	};
}

function executeDisplayFacts(input: {
	readonly operationId: string;
	readonly toolCallId: string;
	readonly commandSummary: string;
	readonly resultSummary: string;
}): TranscriptViewportOperationDisplayFacts {
	return {
		operationId: input.operationId,
		toolCallId: input.toolCallId,
		name: "exec_command",
		title: "exec_command",
		state: "completed",
		kind: "execute",
		commandSummary: input.commandSummary,
		targetPathSummary: null,
		resultSummary: input.resultSummary,
		errorSummary: null,
		interactionIds: [],
		parentToolCallId: null,
		childToolCallIds: [],
	};
}

function embeddedExecuteOperation(input: {
	readonly entryId: string;
	readonly operationId: string;
	readonly toolCallId: string;
	readonly command: string;
	readonly result: string;
}): OperationSnapshot {
	return {
		id: input.operationId,
		session_id: "session-1",
		tool_call_id: input.toolCallId,
		name: "exec_command",
		kind: "execute",
		provider_status: "completed",
		title: "exec_command",
		arguments: { kind: "execute", command: input.command },
		progressive_arguments: null,
		result: input.result,
		computer_payload: null,
		command: input.command,
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_provenance_key: input.toolCallId,
		operation_state: "completed",
		locations: null,
		skill_meta: null,
		normalized_questions: null,
		question_answer: null,
		awaiting_plan_approval: false,
		plan_approval_request_id: null,
		started_at_ms: null,
		completed_at_ms: null,
		source_link: {
			kind: "transcript_linked",
			entry_id: input.entryId,
		},
		degradation_reason: null,
	};
}

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
		const entry = resolveTranscriptViewportSceneEntry(row, new Map([["assistant-1", canonical]]));
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

	it("maps operation states to tool statuses", () => {
		expect(toolStatusFromOperationState("running")).toBe("running");
		expect(toolStatusFromOperationState("completed")).toBe("done");
		expect(toolStatusFromOperationState("failed")).toBe("error");
	});

	it("uses viewport operation display facts instead of the generic tool fallback", () => {
		const row = toolRowWithText({
			text: "exec_command",
			operationLinks: [
				{
					operationId: "operation-1",
					toolCallId: "call-1",
					name: "exec_command",
					state: "completed",
					displayFacts: executeDisplayFacts({
						operationId: "operation-1",
						toolCallId: "call-1",
						commandSummary: "bun test",
						resultSummary: "ok",
					}),
				},
			],
		});

		const entry = resolveTranscriptViewportSceneEntry(row, new Map());

		if (entry.type !== "tool_call") {
			throw new Error("expected a tool call entry");
		}
		expect(entry).toMatchObject({
			id: "assistant-1",
			type: "tool_call",
			toolCallId: "call-1",
			operationId: "operation-1",
			kind: "execute",
			title: "Run",
			status: "done",
			command: "bun test",
			stdout: "ok",
			presentationState: "resolved",
			degradedReason: null,
		});
		expect(entry.title).not.toBe("Tool");
		expect(entry.command).not.toBe("exec_command");
	});

	it("uses embedded operation data when stale viewport rows have no display facts", () => {
		const row = toolRowWithText({
			text: "exec_command",
			operationLinks: [
				{
					operationId: "operation-1",
					toolCallId: "call-1",
					name: "exec_command",
					state: "completed",
					displayFacts: null,
					operation: embeddedExecuteOperation({
						entryId: "assistant-1",
						operationId: "operation-1",
						toolCallId: "call-1",
						command: "bun run check",
						result: "ok",
					}),
				},
			],
		});

		const entry = resolveTranscriptViewportSceneEntry(row, new Map());

		if (entry.type !== "tool_call") {
			throw new Error("expected a tool call entry");
		}
		expect(entry).toMatchObject({
			id: "assistant-1",
			type: "tool_call",
			toolCallId: "call-1",
			operationId: "operation-1",
			kind: "execute",
			title: "Run",
			status: "done",
			command: "bun run check",
			stdout: "ok",
			presentationState: "resolved",
			degradedReason: null,
		});
		expect(entry.title).not.toBe("Tool");
		expect(entry.command).not.toBe("exec_command");
	});
});
