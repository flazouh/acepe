import { expect, test } from "bun:test";

import type {
	OperationSnapshot,
	OperationState,
	SessionGraphLifecycle,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";
import { deriveCanonicalAgentPanelSessionState } from "../session-status-mapper.js";
import { buildRenderedTranscriptViewportRows } from "../transcript-viewport-rendered-rows.js";
import { hasTrailingCompletedTool } from "../transcript-viewport-row-facts.js";

const READY_LIFECYCLE: SessionGraphLifecycle = {
	status: "ready",
	detachedReason: null,
	failureReason: null,
	errorMessage: null,
	actionability: {
		canSend: true,
		canResume: false,
		canRetry: false,
		canArchive: true,
		canConfigure: true,
		recommendedAction: "send",
		recoveryPhase: "none",
		compactStatus: "ready",
	},
};

function userRow(): TranscriptViewportRow {
	return {
		rowId: "transcript:user-1",
		sourceEntryId: "user-1",
		kind: "user",
		version: "user-1:v1",
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "user",
			segments: [
				{
					kind: "text",
					segmentId: "user-1:segment:0",
					text: "Run the checks",
				},
			],
		},
		durationStartedAtMs: null,
	};
}

function toolRow(state: OperationState): TranscriptViewportRow {
	return {
		rowId: "transcript:tool-1",
		sourceEntryId: "tool-1",
		kind: "tool",
		version: `tool-1:${state}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [
			{
				operationId: "operation-1",
				toolCallId: "tool-call-1",
				name: "exec_command",
				state,
				displayFacts: {
					operationId: "operation-1",
					toolCallId: "tool-call-1",
					name: "exec_command",
					title: "Run checks",
					state,
					kind: "execute",
					commandSummary: "bun test",
					resultSummary: "Tests completed",
					editDiffs: [],
					interactionIds: [],
					childToolCallIds: [],
				},
				operation: null,
			},
		],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "tool",
			segments: [
				{
					kind: "text",
					segmentId: "tool-1:segment:0",
					text: "exec_command",
				},
			],
		},
		durationStartedAtMs: null,
	};
}

function activeAssistantRow(kind: "assistantText" | "assistantThought"): TranscriptViewportRow {
	const segmentKind = kind === "assistantThought" ? "thought" : "text";
	return {
		rowId: `transcript:${kind}`,
		sourceEntryId: kind,
		kind,
		version: `${kind}:v1`,
		anchorEligible: true,
		activeStreamingTail: kind === "assistantThought" ? "thought" : "message",
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [
				{
					kind: segmentKind,
					segmentId: `${kind}:segment:0`,
					text: "Continuing the turn",
				},
			],
		},
		durationStartedAtMs: 1_700_000_000_000,
	};
}

function operationSnapshot(state: OperationState): OperationSnapshot {
	return {
		id: "operation-1",
		session_id: "session-1",
		tool_call_id: "tool-call-1",
		name: "exec_command",
		kind: "execute",
		provider_status: state === "completed" ? "completed" : "in_progress",
		title: "Run checks",
		arguments: { kind: "execute", command: "bun test" },
		progressive_arguments: null,
		result: null,
		computer_payload: null,
		command: "bun test",
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_provenance_key: "tool-call-1",
		operation_state: state,
		locations: null,
		skill_meta: null,
		normalized_questions: null,
		question_answer: null,
		awaiting_plan_approval: false,
		plan_approval_request_id: null,
		started_at_ms: null,
		completed_at_ms: state === "completed" ? 1_700_000_000_100 : null,
		source_link: {
			kind: "transcript_linked",
			entry_id: "tool-1",
		},
		degradation_reason: null,
	};
}

function awaitingModelSessionState(
	bufferRows: readonly TranscriptViewportRow[],
	operations: readonly OperationSnapshot[] | null = null,
	activityKind: "awaiting_model" | "running_operation" = "awaiting_model"
) {
	return deriveCanonicalAgentPanelSessionState({
		source: {
			kind: "canonical",
			lifecycle: READY_LIFECYCLE,
			activity: {
				kind: activityKind,
				activeOperationCount: activityKind === "running_operation" ? 1 : 0,
				activeSubagentCount: 0,
				dominantOperationId: activityKind === "running_operation" ? "tool-1" : null,
				blockingInteractionId: null,
			},
			turnState: "Running",
		},
		hasEntries: true,
	});
}

function renderAwaitingModelRows(
	bufferRows: readonly TranscriptViewportRow[],
	operations: readonly OperationSnapshot[] | null = null,
	activityKind: "awaiting_model" | "running_operation" = "awaiting_model"
) {
	const sessionState = awaitingModelSessionState(bufferRows, operations, activityKind);
	return buildRenderedTranscriptViewportRows({
		bufferRows,
		bufferStartIndex: 0,
		optimisticUserEntry: null,
		localPlaceholderMode: sessionState.localPlaceholderMode,
		planningPlaceholderPresentation: null,
	});
}

test("shows Planning next moves after a tool completes while awaiting the next model move", () => {
	const renderedRows = renderAwaitingModelRows([userRow(), toolRow("completed")]);

	expect(renderedRows.map((row) => row.entry.type)).toEqual(["user", "tool_call", "thinking"]);
	expect(renderedRows.at(-1)).toMatchObject({
		localOnly: true,
		entry: {
			type: "thinking",
			label: null,
		},
	});
});

test("uses canonical operation patches when the trailing viewport tool link is stale", () => {
	const renderedRows = renderAwaitingModelRows(
		[userRow(), toolRow("running")],
		[operationSnapshot("completed")]
	);

	expect(renderedRows.map((row) => row.entry.type)).toEqual(["user", "tool_call", "thinking"]);
	expect(renderedRows.at(-1)).toMatchObject({
		localOnly: true,
		entry: {
			type: "thinking",
		},
	});
});

// Found live: a plain first send with a long thinking phase rendered
// NOTHING after the user row for the whole model wait. The canonical
// awaiting_model + Running with no streaming tail IS the wait, and the
// working placeholder must cover it.
test("shows the working placeholder through the model wait right after send", () => {
	const renderedRows = renderAwaitingModelRows([userRow()]);

	expect(renderedRows.map((row) => row.entry.type)).toEqual(["user", "thinking"]);
});

// A genuinely running tool reports activity running_operation (see the
// bridge's tool handling), so the placeholder stays off and the tool row
// itself carries the live state.
test("does not show planning while the trailing tool is still running", () => {
	const renderedRows = renderAwaitingModelRows(
		[userRow(), toolRow("running")],
		null,
		"running_operation"
	);

	expect(renderedRows.map((row) => row.entry.type)).toEqual(["user", "tool_call"]);
});

test("does not add planning below active assistant text after a completed tool", () => {
	const renderedRows = renderAwaitingModelRows([
		userRow(),
		toolRow("completed"),
		activeAssistantRow("assistantText"),
	]);

	expect(renderedRows.map((row) => row.entry.type)).toEqual(["user", "tool_call", "assistant"]);
});

test("does not add planning below active assistant thought after a completed tool", () => {
	const renderedRows = renderAwaitingModelRows([
		userRow(),
		toolRow("completed"),
		activeAssistantRow("assistantThought"),
	]);

	expect(renderedRows.map((row) => row.entry.type)).toEqual(["user", "tool_call", "assistant"]);
	expect(renderedRows.at(-1)?.localOnly).toBe(false);
});
