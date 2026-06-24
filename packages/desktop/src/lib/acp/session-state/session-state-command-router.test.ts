import { describe, expect, it } from "vitest";

import type {
	AssistantTextDeltaPayload,
	OperationSnapshot,
	SessionGraphActivity,
	SessionGraphRevision,
	SessionStateEnvelope,
	ViewportBufferPush,
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

const revision: SessionGraphRevision = {
	graphRevision: 8,
	transcriptRevision: 8,
	lastEventSeq: 10,
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

function createBufferPush(): ViewportBufferPush {
	return {
		sessionId: "session-1",
		graphRevision: revision,
		viewportRevision: 1,
		emissionSeq: 0,
		bufferStartIndex: 0,
		bufferEndIndex: 1,
		layoutRowCount: 1,
		totalHeightPx: 120,
		bufferEndOffsetPx: 120,
		rows: [
			{
				rowId: "transcript:assistant-1",
				sourceEntryId: "assistant-1",
				kind: "assistantText",
				version: "v1",
				anchorEligible: true,
				activeStreamingTail: null,
				operationLinks: [],
				interactionLinks: [],
				content: {
					kind: "transcript",
					role: "assistant",
					segments: [
						{
							kind: "text",
							segmentId: "assistant-1:text",
							text: "hello",
						},
					],
				},
			},
		],
		offsetsPx: [0],
		mode: {
			kind: "followingTail",
		},
		scrollTopTarget: null,
		diagnostics: [],
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

	it("refreshes when a snapshot envelope header disagrees with the graph revision", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 9,
			lastEventSeq: 11,
			payload: {
				kind: "snapshot",
				graph: {
					requestedSessionId: "session-1",
					canonicalSessionId: "session-1",
					isAlias: false,
					agentId: "codex",
					projectPath: "/tmp/project",
					worktreePath: null,
					sourcePath: null,
					revision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 10,
					},
					transcriptSnapshot: {
						revision: 8,
						entries: [],
					},
					operations: [],
					interactions: [],
					turnState: "Idle",
					messageCount: 0,
					activeStreamingTail: null,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					lifecycle: {
						status: "ready",
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
					},
					activity: {
						kind: "idle",
						activeOperationCount: 0,
						activeSubagentCount: 0,
						dominantOperationId: null,
						blockingInteractionId: null,
					},
					capabilities: {
						modes: null,
						models: null,
						configOptions: [],
						autonomousEnabled: false,
					},
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", null, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 8,
				toRevision: 9,
			},
		]);
	});

	it("refreshes when a snapshot envelope session id disagrees with the canonical graph id", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "snapshot",
				graph: {
					requestedSessionId: "session-1",
					canonicalSessionId: "session-2",
					isAlias: true,
					agentId: "codex",
					projectPath: "/tmp/project",
					worktreePath: null,
					sourcePath: null,
					revision: {
						graphRevision: 8,
						transcriptRevision: 8,
						lastEventSeq: 10,
					},
					transcriptSnapshot: {
						revision: 8,
						entries: [],
					},
					operations: [],
					interactions: [],
					turnState: "Idle",
					messageCount: 0,
					activeStreamingTail: null,
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					lifecycle: {
						status: "ready",
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
					},
					activity: {
						kind: "idle",
						activeOperationCount: 0,
						activeSubagentCount: 0,
						dominantOperationId: null,
						blockingInteractionId: null,
					},
					capabilities: {
						modes: null,
						models: null,
						configOptions: [],
						autonomousEnabled: false,
					},
				},
			},
		};

		expect(routeSessionStateEnvelope("session-1", null, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 8,
				toRevision: 8,
			},
		]);
	});

	it("routes viewport buffer pushes as canonical envelope results", () => {
		const push = createBufferPush();
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "viewportBufferPush",
				push,
			},
		};

		expect(routeSessionStateEnvelope("session-1", revision, envelope)).toEqual([
			{
				kind: "applyBufferPush",
				push,
			},
		]);
	});

	it("refreshes instead of applying stale viewport buffer pushes", () => {
		const push: ViewportBufferPush = {
			sessionId: "session-1",
			graphRevision: {
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 9,
			},
			viewportRevision: 1,
			emissionSeq: 0,
			bufferStartIndex: 0,
			bufferEndIndex: 0,
			layoutRowCount: 0,
			totalHeightPx: 0,
			bufferEndOffsetPx: 0,
			rows: [],
			offsetsPx: [],
			mode: {
				kind: "followingTail",
			},
			scrollTopTarget: null,
			diagnostics: [],
		};
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "viewportBufferPush",
				push,
			},
		};

		expect(routeSessionStateEnvelope("session-1", revision, envelope)).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 7,
				toRevision: 8,
			},
		]);
	});

	it("refreshes when a capabilities envelope header disagrees with payload revision", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 9,
			lastEventSeq: 11,
			payload: {
				kind: "capabilities",
				capabilities: {
					modes: null,
					models: null,
					configOptions: [],
					autonomousEnabled: false,
				},
				revision: {
					graphRevision: 8,
					transcriptRevision: 8,
					lastEventSeq: 10,
				},
				pending_mutation_id: null,
				preview_state: "canonical",
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 8,
					transcriptRevision: 8,
					lastEventSeq: 10,
				},
				envelope
			)
		).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 8,
				toRevision: 9,
			},
		]);
	});

	it("routes lifecycle envelopes with their canonical revision", () => {
		const lifecycle = {
			status: "reconnecting",
			actionability: {
				canSend: false,
				canResume: false,
				canRetry: true,
				canArchive: true,
				canConfigure: false,
				recommendedAction: "retry",
				recoveryPhase: "reconnecting",
				compactStatus: "reconnecting",
			},
		} as const;
		const revision = {
			graphRevision: 8,
			transcriptRevision: 7,
			lastEventSeq: 10,
		} as const;
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "lifecycle",
				lifecycle,
				revision,
			},
		};

		expect(routeSessionStateEnvelope("session-1", null, envelope)).toEqual([
			{
				kind: "applyLifecycle",
				lifecycle,
				revision,
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

	it("refreshes when transcript operations do not advance the transcript frontier", () => {
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
						transcriptRevision: 7,
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
					changedFields: ["transcriptSnapshot", "activity"],
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 7,
					transcriptRevision: 7,
					lastEventSeq: 7,
				},
				envelope
			)
		).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 7,
				toRevision: 7,
			},
		]);
	});

	it("refreshes when a delta does not advance the event frontier", () => {
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
						lastEventSeq: 8,
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
					changedFields: ["transcriptSnapshot", "activity"],
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 7,
					transcriptRevision: 7,
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

	it("refreshes when a delta event frontier does not match the current revision", () => {
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
						lastEventSeq: 8,
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
										text: "hello",
									},
								],
							},
						},
					],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot", "activity"],
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
				kind: "refreshSnapshot",
				fromRevision: 7,
				toRevision: 8,
			},
		]);
	});

	it("does not guess graph patches when transcript deltas omit changedFields", () => {
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
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 7,
					transcriptRevision: 7,
					lastEventSeq: 7,
				},
				envelope
			).map((command) => command.kind)
		).toEqual(["applyTranscriptDelta"]);
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

	it("refreshes when operations are marked changed without operation patches", () => {
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
				kind: "refreshSnapshot",
				fromRevision: 6,
				toRevision: 7,
			},
		]);
	});

	it("refreshes when activity is marked changed but omitted from the delta payload", () => {
		const envelope = {
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
		} as unknown as SessionStateEnvelope;

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
				fromRevision: 6,
				toRevision: 7,
			},
		]);
	});

	it("refreshes when a graph patch delta does not advance the graph frontier", () => {
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 7,
			lastEventSeq: 9,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: {
						graphRevision: 7,
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
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 8,
				},
				envelope
			)
		).toEqual([
			{
				kind: "refreshSnapshot",
				fromRevision: 7,
				toRevision: 7,
			},
		]);
	});

	it("refreshes mixed deltas when operations are marked changed without operation patches", () => {
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
					changedFields: ["transcriptSnapshot", "operations"],
				},
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 7,
					transcriptRevision: 7,
					lastEventSeq: 7,
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

	it("applies an assistant text delta even when the envelope frontier disagrees with the delta revision", () => {
		// Regression guard: the router must NOT refresh just because the envelope's
		// graph_revision / last_event_seq differ from delta.revision (transcript). That
		// equality gate dropped every real streaming delta and left token-reveal dormant.
		const delta = {
			turnId: "turn-1",
			rowId: "assistant-1",
			charOffset: 0,
			deltaText: "hello",
			producedAtMonotonicMs: 12,
			revision: 9,
		};
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 8,
			lastEventSeq: 10,
			payload: {
				kind: "assistantTextDelta",
				delta,
			},
		};

		expect(
			routeSessionStateEnvelope(
				"session-1",
				{
					graphRevision: 7,
					transcriptRevision: 7,
					lastEventSeq: 7,
				},
				envelope
			)
		).toEqual([{ kind: "applyAssistantTextDelta", delta }]);
	});

	// Bug #1: assistant-text-deltas must apply on transcript-revision contiguity, not
	// on the (normally divergent) equality of graph_revision / transcript_revision /
	// last_event_seq. current revision here is { graph 8, transcript 8, seq 10 }.
	function assistantTextDelta(deltaRevision: number): AssistantTextDeltaPayload {
		return {
			turnId: "turn-1",
			rowId: "assistant-1",
			charOffset: 0,
			deltaText: "Hello",
			producedAtMonotonicMs: 1_000,
			revision: deltaRevision,
		};
	}

	it("applies a contiguous assistant text delta even when graph/event revisions diverge", () => {
		const delta = assistantTextDelta(9); // transcript 8 -> 9 (contiguous)
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 12,
			lastEventSeq: 13,
			payload: { kind: "assistantTextDelta", delta },
		};

		expect(routeSessionStateEnvelope("session-1", revision, envelope)).toEqual([
			{ kind: "applyAssistantTextDelta", delta },
		]);
	});

	it("applies an additional assistant text delta at the current transcript frontier", () => {
		const delta = assistantTextDelta(8); // same transcript revision — a char-append
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 11,
			lastEventSeq: 12,
			payload: { kind: "assistantTextDelta", delta },
		};

		expect(routeSessionStateEnvelope("session-1", revision, envelope)).toEqual([
			{ kind: "applyAssistantTextDelta", delta },
		]);
	});

	it("applies an assistant text delta with a higher revision (reducer orders by charOffset, never the router by counter equality)", () => {
		const delta = assistantTextDelta(11); // higher transcript revision
		const envelope: SessionStateEnvelope = {
			sessionId: "session-1",
			graphRevision: 12,
			lastEventSeq: 13,
			payload: { kind: "assistantTextDelta", delta },
		};

		expect(routeSessionStateEnvelope("session-1", revision, envelope)).toEqual([
			{ kind: "applyAssistantTextDelta", delta },
		]);
	});
});
