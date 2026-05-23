import { describe, expect, it } from "vitest";

import type {
	OperationSnapshot,
	SessionGraphActivity,
	SessionStateEnvelope,
} from "../../services/acp-types.js";
import { routeSessionStateEnvelope } from "./session-state-command-router.js";
import { getSessionStateEnvelopeByteBudget } from "./session-state-envelope-budget.js";

const runningOperationActivity: SessionGraphActivity = {
	kind: "running_operation",
	activeOperationCount: 1,
	activeSubagentCount: 0,
	dominantOperationId: "session-1:tool-1",
	blockingInteractionId: null,
};

function createTestOperationSnapshot(): OperationSnapshot {
	return {
		id: "op:session-1:tool-1",
		session_id: "session-1",
		tool_call_id: "tool-1",
		name: "Bash",
		kind: "execute",
		provider_status: "in_progress",
		title: "Run",
		arguments: {
			kind: "execute",
			command: "pwd",
		},
		progressive_arguments: null,
		result: null,
		command: "pwd",
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_provenance_key: "tool-1",
		operation_state: "running",
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
			entry_id: "tool-1",
		},
		degradation_reason: null,
	};
}

describe("routeSessionStateEnvelope", () => {
	it("rejects envelopes for a different session before routing patches", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-2",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 9,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 10,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-1:block:0",
										text: "wrong session",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 7,
					transcriptRevision: 7,
					lastEventSeq: 9,
				},
				envelope
			)
		).toEqual([
			{
				kind: "rejectSessionMismatch",
				expectedSessionId: "session-1",
				envelopeSessionId: "session-2",
			},
		]);
	});

	it("routes operation patches before matching transcript tool rows", () => {
		const operation = createTestOperationSnapshot();
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 8,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "tool-1",
								role: "tool",
								segments: [
									{
										kind: "text",
										segmentId: "tool-1:tool",
										text: "Run",
									},
								],
							},
						},
					],
					operationPatches: [operation],
					interactionPatches: [],
					changedFields: [
						"transcriptSnapshot",
						"operations",
						"activity",
						"turnState",
						"activeTurnFailure",
						"lastTerminalTurnId",
					],
				},
			},
		};

		const commands = routeSessionStateEnvelope(
			"session-1",
			{
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 7,
			},
			envelope
		);

		expect(commands.map((command) => command.kind)).toEqual([
			"applyTranscriptDelta",
			"applyGraphPatches",
		]);
	});

	it("routes transcript deltas before graph patches from the same canonical envelope", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 8,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 7,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 8,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "user-1",
								role: "user",
								segments: [
									{
										kind: "text",
										segmentId: "user-1:block:0",
										text: "hello",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot", "activity", "turnState"],
				},
			},
		};

		const [first, second] = routeSessionStateEnvelope(
			"session-1",
			{
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 7,
			},
			envelope
		);

		expect(first?.kind).toBe("applyTranscriptDelta");
		expect(second?.kind).toBe("applyGraphPatches");
	});

	it("refreshes graph patch deltas when only a transcript frontier is available", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 6,
						transcriptRevision: 4,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 7,
						transcriptRevision: 4,
						lastEventSeq: 9,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity"],
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", null, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 6,
				toRevision: 7,
			},
		]);
	});

	it("refreshes graph patch deltas when no graph frontier exists yet", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 6,
						transcriptRevision: 4,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 7,
						transcriptRevision: 4,
						lastEventSeq: 9,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity"],
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", null, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 6,
				toRevision: 7,
			},
		]);
	});

	it("routes graph patch deltas when the graph frontier matches", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 6,
						transcriptRevision: 4,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 7,
						transcriptRevision: 4,
						lastEventSeq: 9,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity"],
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 6,
					transcriptRevision: 4,
					lastEventSeq: 8,
				},
				envelope
			).map((command) => command.kind)
		).toEqual(["applyGraphPatches"]);
	});

	it("refreshes instead of applying graph patches on top of a skipped graph revision", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 4,
						lastEventSeq: 9,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 4,
						lastEventSeq: 10,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activity"],
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 6,
					transcriptRevision: 4,
					lastEventSeq: 8,
				},
				envelope
			)
		).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 7,
				toRevision: 8,
			},
		]);
	});

	it("routes active streaming tail deltas as graph patches", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 6,
						transcriptRevision: 4,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 7,
						transcriptRevision: 4,
						lastEventSeq: 9,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: { rowId: "assistant-1", contentKind: "message" },
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["activeStreamingTail"],
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 6,
					transcriptRevision: 4,
					lastEventSeq: 8,
				},
				envelope
			)
		).toEqual([
			{
				kind: "applyGraphPatches",
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 9,
				},
				activity: undefined,
				turnState: undefined,
				activeTurnFailure: undefined,
				lastTerminalTurnId: undefined,
				activeStreamingTail: { rowId: "assistant-1", contentKind: "message" },
				operationPatches: [],
				interactionPatches: [],
			},
		]);
	});

	it("keeps unchanged graph scalars out of operation-only patch commands", () => {
		const operation = createTestOperationSnapshot();
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 6,
						transcriptRevision: 4,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 7,
						transcriptRevision: 4,
						lastEventSeq: 9,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [operation],
					interactionPatches: [],
					changedFields: ["operations"],
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 6,
					transcriptRevision: 4,
					lastEventSeq: 8,
				},
				envelope
			)
		).toEqual([
			{
				kind: "applyGraphPatches",
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 9,
				},
				activity: undefined,
				turnState: undefined,
				activeTurnFailure: undefined,
				lastTerminalTurnId: undefined,
				activeStreamingTail: undefined,
				operationPatches: [operation],
				interactionPatches: [],
			},
		]);
	});

	it("refreshes transcript-only deltas when no canonical graph frontier exists", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 6,
						transcriptRevision: 4,
						lastEventSeq: 8,
					},
					toRevision: {
						graphRevision: 7,
						transcriptRevision: 5,
						lastEventSeq: 9,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-1:block:0",
										text: "hello",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", null, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 4,
				toRevision: 5,
			},
		]);
	});

	it("does not apply graph patches from a transcript delta with a stale frontier", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
						transcriptRevision: 7,
						lastEventSeq: 9,
					},
					toRevision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 10,
					},
					activity: runningOperationActivity,
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: { rowId: "assistant-1", contentKind: "message" },
					transcriptOperations: [
						{
							kind: "appendEntry",
							entry: {
								entryId: "assistant-1",
								role: "assistant",
								segments: [
									{
										kind: "text",
										segmentId: "assistant-1:block:0",
										text: "hello",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: [
						"transcriptSnapshot",
						"activity",
						"turnState",
						"activeTurnFailure",
						"lastTerminalTurnId",
					],
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", null, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 7,
				toRevision: 8,
			},
		]);
	});

	it("rejects oversized assistant text deltas before routing work", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "assistantTextDelta",
				delta: {
					turnId: "turn-1",
					rowId: "assistant-1",
					charOffset: 0,
					deltaText: "x".repeat(getSessionStateEnvelopeByteBudget("assistantTextDelta")),
					producedAtMonotonicMs: 12,
					revision: 1,
				},
			},
		};

		const commands = routeSessionStateEnvelope(
			"session-1",
			{
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 7,
			},
			envelope
		);

		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({
			kind: "rejectOversizedEnvelope",
			budget: {
				ok: false,
				kind: "assistantTextDelta",
				maxBytes: getSessionStateEnvelopeByteBudget("assistantTextDelta"),
			},
		});
	});
});
