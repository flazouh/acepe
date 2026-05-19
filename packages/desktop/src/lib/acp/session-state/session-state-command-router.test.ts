import { describe, expect, it } from "vitest";

import type {
	OperationSnapshot,
	SessionGraphActivity,
	SessionStateEnvelope,
} from "../../services/acp-types.js";
import { routeSessionStateEnvelope } from "./session-state-command-router.js";

const runningOperationActivity: SessionGraphActivity = {
	kind: "running_operation",
	activeOperationCount: 1,
	activeSubagentCount: 0,
	dominantOperationId: "session-1:tool-1",
	blockingInteractionId: null,
};

describe("routeSessionStateEnvelope", () => {
	it("routes operation patches before matching transcript tool rows", () => {
		const operation: OperationSnapshot = {
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

		const commands = routeSessionStateEnvelope("session-1", 7, envelope);

		expect(commands.map((command) => command.kind)).toEqual([
			"applyGraphPatches",
			"applyTranscriptDelta",
		]);
	});

	it("routes graph patch deltas with canonical activity", () => {
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

		expect(routeSessionStateEnvelope("session-1", 4, envelope)).toEqual([
			{
				kind: "applyGraphPatches",
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 9,
				},
				activity: runningOperationActivity,
				turnState: "Running",
				activeTurnFailure: null,
				lastTerminalTurnId: null,
				lastAgentMessageId: undefined,
				activeStreamingTail: undefined,
				operationPatches: [],
				interactionPatches: [],
			},
		]);
	});

	it("routes live assistant id deltas as graph patches", () => {
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
					lastAgentMessageId: "assistant-1",
					activeStreamingTail: { rowId: "assistant-1", contentKind: "message" },
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["lastAgentMessageId", "activeStreamingTail"],
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", 4, envelope)).toEqual([
			{
				kind: "applyGraphPatches",
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 9,
				},
				activity: runningOperationActivity,
				turnState: "Running",
				activeTurnFailure: null,
				lastTerminalTurnId: null,
				lastAgentMessageId: "assistant-1",
				activeStreamingTail: { rowId: "assistant-1", contentKind: "message" },
				operationPatches: [],
				interactionPatches: [],
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

		expect(routeSessionStateEnvelope("session-1", 6, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 7,
				toRevision: 8,
			},
		]);
	});
});
