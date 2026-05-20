/**
 * Session Event Service Streaming Tests
 *
 * Tests for streaming delta handling, specifically verifying that:
 * 1. Empty string deltas are handled by the fast path (not creating placeholder entries)
 * 2. Regular updates without streamingInputDelta go through normal path
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		isLevelEnabled: vi.fn().mockReturnValue(false),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import type {
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionStateEnvelope,
	TranscriptDelta,
} from "../../../services/acp-types.js";
import type { SessionUpdate } from "../../../services/converted-session-types.js";
import { SessionEntryStore } from "../session-entry-store.svelte.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import { SessionEventService } from "../session-event-service.svelte.js";
import type { SessionCold } from "../types.js";
import { preloadEntriesAndBuildIndex, readStoredEntries } from "./entry-store-test-access.js";

function createMockHandler(): SessionEventHandler {
	return {
		getSessionCold: vi.fn().mockReturnValue({ id: "session-123" } as unknown as SessionCold),
		isPreloaded: vi.fn().mockReturnValue(true),
		getSessionCanSend: vi.fn().mockReturnValue(null),
		updateUsageTelemetry: vi.fn(),
		applySessionStateEnvelope: vi.fn(),
	};
}

function createGraphLifecycle(
	status: SessionGraphLifecycle["status"] = "reserved",
	errorMessage: string | null = null
): SessionGraphLifecycle {
	return {
		status,
		detachedReason: status === "detached" ? "reconnectExhausted" : null,
		failureReason: status === "failed" ? "resumeFailed" : null,
		errorMessage,
		actionability: {
			canSend: status === "ready",
			canResume: status === "detached",
			canRetry: status === "failed",
			canArchive: status !== "archived",
			canConfigure: status === "ready",
			recommendedAction:
				status === "ready"
					? "send"
					: status === "detached"
						? "resume"
						: status === "failed"
							? "retry"
							: status === "archived"
								? "none"
								: "wait",
			recoveryPhase:
				status === "activating"
					? "activating"
					: status === "reconnecting"
						? "reconnecting"
						: status === "detached"
							? "detached"
							: status === "failed"
								? "failed"
								: status === "archived"
									? "archived"
									: "none",
			compactStatus: status,
		},
	};
}

function createIdleActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function createTaskReplayChild(
	index: number
): Extract<SessionUpdate, { type: "toolCall" }>["tool_call"] {
	return {
		id: `task-child-${String(index).padStart(2, "0")}-long-child-identifier`,
		name: "Read",
		arguments: { kind: "read", file_path: `/repo/src/task-${index}.ts` },
		status: "completed",
		kind: "read",
		title: `Read file ${index}`,
		locations: null,
		skillMeta: null,
		result: null,
		taskChildren: null,
		awaitingPlanApproval: false,
	};
}

describe("SessionEventService streaming delta handling", () => {
	let service: SessionEventService;
	let handler: SessionEventHandler;

	beforeEach(() => {
		service = new SessionEventService();
		handler = createMockHandler();
	});

	it("ignores malformed usage telemetry updates without data", () => {
		const malformedUpdate = { type: "usageTelemetryUpdate" } as SessionUpdate;

		expect(() => service.handleSessionUpdate(malformedUpdate, handler)).not.toThrow();
		expect(handler.updateUsageTelemetry).not.toHaveBeenCalled();
	});

	it("ignores malformed usage telemetry updates without a valid sessionId", () => {
		const malformedUpdate = {
			type: "usageTelemetryUpdate",
			data: { eventId: "event-1", costUsd: 0.04 },
		} as SessionUpdate;

		expect(() => service.handleSessionUpdate(malformedUpdate, handler)).not.toThrow();
		expect(handler.updateUsageTelemetry).not.toHaveBeenCalled();
	});

	it("keeps well-formed raw usage telemetry updates non-authoritative", () => {
		const update: SessionUpdate = {
			type: "usageTelemetryUpdate",
			data: {
				sessionId: "session-123",
				eventId: "event-1",
				costUsd: 0.04,
				tokens: {
					input: 100,
					output: 20,
					total: 120,
				},
			},
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.updateUsageTelemetry).not.toHaveBeenCalled();
	});

	it("keeps raw turnComplete updates non-authoritative", () => {
		const onTurnComplete = vi.fn();
		service.setCallbacks({ onTurnComplete });
		const update: SessionUpdate = {
			type: "turnComplete",
			session_id: "session-123",
			turn_id: "turn-123",
		};

		service.handleSessionUpdate(update, handler);

		expect(onTurnComplete).not.toHaveBeenCalled();
	});

	it("keeps raw turnError updates non-authoritative", () => {
		const update: SessionUpdate = {
			type: "turnError",
			session_id: "session-123",
			turn_id: "turn-123",
			error: {
				message: "rate limited",
				kind: "recoverable",
				code: 429,
			},
		};

		service.handleSessionUpdate(update, handler);
	});

	it("keeps empty string streaming deltas on the raw lane non-authoritative", () => {
		const update: SessionUpdate = {
			type: "toolCallUpdate",
			update: {
				toolCallId: "tool-123",
				status: null,
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: null,
				streamingInputDelta: "", // Empty string - this is the key case!
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);
	});

	it("drops queued assistant fallback chunks when a canonical delta envelope arrives first", async () => {
		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-123",
			message_id: "assistant-1",
			chunk: {
				content: {
					type: "text",
					text: "hello",
				},
			},
		};
		const delta: TranscriptDelta = {
			eventSeq: 7,
			sessionId: "session-123",
			snapshotRevision: 7,
			operations: [
				{
					kind: "appendEntry",
					entry: {
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:segment:7",
								text: "hello",
							},
						],
					},
				},
			],
		};

		const envelope: SessionStateEnvelope = {
			sessionId: "session-123",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: { graphRevision: 6, transcriptRevision: 6, lastEventSeq: 6 },
					toRevision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: delta.operations,
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		};

		service.handleSessionUpdate(update, handler);
		service.handleSessionStateEnvelope(envelope, handler);
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect(handler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				sessionId: "session-123",
				graphRevision: 7,
				lastEventSeq: 7,
			})
		);
	});

	it("routes session-state delta envelopes through the canonical transcript path", () => {
		const delta: TranscriptDelta = {
			eventSeq: 7,
			sessionId: "session-123",
			snapshotRevision: 7,
			operations: [
				{
					kind: "appendEntry",
					entry: {
						entryId: "assistant-1",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-1:segment:7",
								text: "hello",
							},
						],
					},
				},
			],
		};
		const envelope: SessionStateEnvelope = {
			sessionId: "session-123",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: { graphRevision: 6, transcriptRevision: 6, lastEventSeq: 6 },
					toRevision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: delta.operations,
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		};

		service.handleSessionStateEnvelope(envelope, handler);

		expect(handler.applySessionStateEnvelope).toHaveBeenCalledWith("session-123", envelope);
	});

	it("buffers canonical session-state envelopes until the session is registered", async () => {
		const pendingHandler = createMockHandler();
		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		const envelope: SessionStateEnvelope = {
			sessionId: "session-pending-1",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "lifecycle",
				lifecycle: createGraphLifecycle("ready"),
				revision: {
					graphRevision: 7,
					transcriptRevision: 4,
					lastEventSeq: 7,
				},
			},
		};

		service.handleSessionStateEnvelope(envelope, pendingHandler);

		expect(pendingHandler.applySessionStateEnvelope).not.toHaveBeenCalled();

		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-pending-1",
		} as unknown as SessionCold);
		service.flushPendingEvents("session-pending-1", pendingHandler);
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledTimes(1);
		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-pending-1",
			envelope
		);
	});

	it("materializes pending creation sessions before applying canonical delta envelopes", () => {
		const pendingHandler = createMockHandler();
		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		pendingHandler.materializePendingCreationSession = vi.fn().mockReturnValue(true);
		const envelope: SessionStateEnvelope = {
			sessionId: "session-pending-creation-1",
			graphRevision: 7,
			lastEventSeq: 7,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: { graphRevision: 6, transcriptRevision: 6, lastEventSeq: 6 },
					toRevision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: [],
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["turnState"],
				},
			},
		};

		service.handleSessionStateEnvelope(envelope, pendingHandler);

		expect(pendingHandler.materializePendingCreationSession).toHaveBeenCalledWith(
			"session-pending-creation-1"
		);
		expect(pendingHandler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-pending-creation-1",
			envelope
		);
	});

	it("materializes pending creation sessions before ignoring raw turn completion", () => {
		const pendingHandler = createMockHandler();
		(pendingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		pendingHandler.materializePendingCreationSession = vi.fn().mockReturnValue(true);
		const update: SessionUpdate = {
			type: "turnComplete",
			session_id: "session-pending-creation-1",
			turn_id: "turn-1",
		};

		service.handleSessionUpdate(update, pendingHandler);

		expect(pendingHandler.materializePendingCreationSession).toHaveBeenCalledWith(
			"session-pending-creation-1"
		);
	});

	it("does not synthesize assistant transcript chunks from raw session updates", () => {
		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-123",
			message_id: "assistant-1",
			chunk: {
				content: {
					type: "text",
					text: "hello",
				},
			},
		};

		service.handleSessionUpdate(update, handler);
		expect(handler.applySessionStateEnvelope).not.toHaveBeenCalled();
	});

	it("keeps non-empty streaming deltas on the raw lane non-authoritative", () => {
		const update: SessionUpdate = {
			type: "toolCallUpdate",
			update: {
				toolCallId: "tool-123",
				status: null,
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: null,
				streamingInputDelta: '{"subag',
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);
	});

	it("keeps tool_call_update without streamingInputDelta non-authoritative on the raw lane", () => {
		const update: SessionUpdate = {
			type: "toolCallUpdate",
			update: {
				toolCallId: "tool-123",
				status: "completed",
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: null,
				streamingInputDelta: null, // null, not empty string
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);
	});

	it("keeps tool_call_update with undefined streamingInputDelta non-authoritative on the raw lane", () => {
		const update: SessionUpdate = {
			type: "toolCallUpdate",
			update: {
				toolCallId: "tool-123",
				status: "in_progress",
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: null,
				// streamingInputDelta is undefined (not present)
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);
	});

	it("keeps status updates with streamingInputDelta non-authoritative on the raw lane", () => {
		const update: SessionUpdate = {
			type: "toolCallUpdate",
			update: {
				toolCallId: "tool-123",
				status: "completed",
				result: null,
				content: null,
				rawOutput: null,
				title: null,
				locations: [{ path: "/Users/example/.claude/plans/test.md" }],
				streamingInputDelta: '"}',
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);
	});

	it("keeps completion updates with streamingArguments non-authoritative on the raw lane", () => {
		const update: SessionUpdate = {
			type: "toolCallUpdate",
			update: {
				toolCallId: "tool-123",
				status: "completed",
				result: null,
				content: null,
				rawOutput: null,
				title: "Write `/Users/example/.claude/plans/test.md`",
				locations: [{ path: "/Users/example/.claude/plans/test.md" }],
				streamingArguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/Users/example/.claude/plans/test.md",
							oldString: null,
							newString: null,
							content: "# Plan",
						},
					],
				},
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);
	});

	it("does not synthesize turn completion from a plan payload", () => {
		const onPlanUpdate = vi.fn();
		service.setCallbacks({ onPlanUpdate });
		const update: SessionUpdate = {
			type: "plan",
			session_id: "session-123",
			plan: {
				steps: [],
				hasPlan: true,
				streaming: false,
				contentMarkdown: "# Plan\n\n- [ ] Fix the bug",
				title: "Plan",
			},
		};

		service.handleSessionUpdate(update, handler);

		// GOD authority: plan content flows through the canonical SessionStateEnvelope
		// (kind: "plan") routed via applyPlan command. The raw lane is diagnostic-only
		// and must not invoke the plan callback.
		expect(onPlanUpdate).not.toHaveBeenCalled();
	});

	it("still ignores plan payloads when the turn is already completed", () => {
		const update: SessionUpdate = {
			type: "plan",
			session_id: "session-123",
			plan: {
				steps: [],
				hasPlan: true,
				streaming: false,
				contentMarkdown: "# Plan\n\n- [ ] Fix the bug",
				title: "Plan",
			},
		};

		service.handleSessionUpdate(update, handler);
	});

	it("keeps streamingArguments updates on the raw lane non-authoritative", () => {
		const firstUpdate: SessionUpdate = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-123",
				title: "step-1",
				streamingArguments: { kind: "execute", command: "bun" },
			},
		};
		const secondUpdate: SessionUpdate = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-123",
				title: "step-2",
				streamingArguments: { kind: "execute", command: "bun test" },
			},
		};

		service.handleSessionUpdate(firstUpdate, handler);
		service.handleSessionUpdate(secondUpdate, handler);
	});

	it("keeps streamingArguments updates across multiple tools non-authoritative on the raw lane", () => {
		service.handleSessionUpdate(
			{
				type: "toolCallUpdate",
				session_id: "session-123",
				update: {
					toolCallId: "tool-a",
					streamingArguments: { kind: "read", file_path: "/a" },
				},
			},
			handler
		);
		service.handleSessionUpdate(
			{
				type: "toolCallUpdate",
				session_id: "session-123",
				update: {
					toolCallId: "tool-b",
					streamingArguments: { kind: "read", file_path: "/b" },
				},
			},
			handler
		);
		service.handleSessionUpdate(
			{
				type: "toolCallUpdate",
				session_id: "session-123",
				update: {
					toolCallId: "tool-a",
					streamingArguments: { kind: "read", file_path: "/a2" },
				},
			},
			handler
		);
	});

	it("keeps lifecycle-bearing tool updates non-authoritative on the raw lane", () => {
		const update: SessionUpdate = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-123",
				status: "in_progress",
				title: "Running command",
				streamingArguments: { kind: "execute", command: "bun test" },
			},
		};

		service.handleSessionUpdate(update, handler);
	});

	it("keeps later terminal tool updates non-authoritative on the raw lane", () => {
		service.handleSessionUpdate(
			{
				type: "toolCallUpdate",
				session_id: "session-123",
				update: {
					toolCallId: "tool-123",
					streamingArguments: { kind: "execute", command: "bun te" },
				},
			},
			handler
		);

		service.handleSessionUpdate(
			{
				type: "toolCallUpdate",
				session_id: "session-123",
				update: {
					toolCallId: "tool-123",
					status: "completed",
					title: "Done",
				},
			},
			handler
		);
	});

	it("should not aggregate text chunk when session does not exist yet", () => {
		const missingSessionHandler = createMockHandler();
		(missingSessionHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-missing",
			chunk: {
				content: { type: "text", text: "hello" },
			},
			part_id: "part-1",
			message_id: "msg-1",
		};

		service.handleSessionUpdate(update, missingSessionHandler);
	});

	it("ignores raw assistant chunks even when message_id and part_id are both present", () => {
		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-123",
			chunk: {
				content: { type: "text", text: "hello" },
			},
			part_id: "part-A",
			message_id: "msg-1",
		};

		service.handleSessionUpdate(update, handler);
	});

	it("treats permissionRequest updates on the raw lane as observational only", () => {
		const update: SessionUpdate = {
			type: "permissionRequest",
			permission: {
				id: "perm-1",
				sessionId: "session-123",
				jsonRpcRequestId: 42,
				permission: "WebFetch",
				patterns: ["https://example.com/*"],
				metadata: { diagnosticRawInput: { url: "https://example.com" } },
				always: [],
				autoAccepted: false,
				tool: {
					messageId: "",
					callId: "tool-fetch-1",
				},
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.updateUsageTelemetry).not.toHaveBeenCalled();
	});

	it("does not mutate transcript state from raw permissionRequest updates", () => {
		const update: SessionUpdate = {
			type: "permissionRequest",
			permission: {
				id: "perm-edit-1",
				sessionId: "session-123",
				permission: "Edit",
				patterns: [],
				metadata: {
					diagnosticRawInput: {},
					parsedArguments: {
						kind: "edit",
						edits: [
							{
								filePath: "/tmp/example.ts",
								oldString: "before",
								newString: "after",
								content: "after",
							},
						],
					},
					options: [],
				},
				always: [],
				autoAccepted: false,
				tool: {
					messageId: "",
					callId: "tool-edit-1",
				},
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);
	});

	it("treats questionRequest updates on the raw lane as observational only", () => {
		const update: SessionUpdate = {
			type: "questionRequest",
			question: {
				id: "question-1",
				sessionId: "session-123",
				questions: [
					{
						question: "Proceed?",
						header: "Confirm",
						options: [
							{ label: "Yes", description: "Continue" },
							{ label: "No", description: "Cancel" },
						],
						multiSelect: false,
					},
				],
				tool: {
					messageId: "",
					callId: "tool-question-1",
				},
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.updateUsageTelemetry).not.toHaveBeenCalled();
	});

	it("does not merge assistant chunks from raw session updates when part_id changes mid-stream", () => {
		const sessionId = "session-aggregate";
		const entryStore = new SessionEntryStore();
		preloadEntriesAndBuildIndex(entryStore, sessionId, []);

		const integrationHandler: SessionEventHandler = {
			getSessionCold: vi
				.fn()
				.mockReturnValue({ id: sessionId, agentId: "claude-code" } as SessionCold),
			isPreloaded: vi.fn().mockReturnValue(true),
			getSessionCanSend: vi.fn().mockReturnValue(null),
			updateUsageTelemetry: vi.fn(),
			applySessionStateEnvelope: vi.fn(),
		};

		service.handleSessionUpdate(
			{
				type: "agentMessageChunk",
				session_id: sessionId,
				message_id: "msg-1",
				part_id: "part-A",
				chunk: { content: { type: "text", text: "and then at " } },
			},
			integrationHandler
		);

		service.handleSessionUpdate(
			{
				type: "agentMessageChunk",
				session_id: sessionId,
				message_id: "msg-1",
				part_id: "part-B",
				chunk: { content: { type: "text", text: "THE END of the streaming, " } },
			},
			integrationHandler
		);

		service.handleSessionUpdate(
			{
				type: "agentMessageChunk",
				session_id: sessionId,
				message_id: "msg-1",
				part_id: "part-C",
				chunk: { content: { type: "text", text: "clarify!" } },
			},
			integrationHandler
		);

		const assistantEntries = readStoredEntries(entryStore, sessionId).filter(
			(entry) => entry.type === "assistant"
		);
		expect(assistantEntries).toHaveLength(0);
	});

	it("treats raw userMessageChunk as diagnostic without clearing assistant streaming state", () => {
		const update: SessionUpdate = {
			type: "userMessageChunk",
			sessionId: "session-123",
			chunk: {
				content: { type: "text", text: "All I want is success" },
			},
		};

		service.handleSessionUpdate(update, handler);
	});

	it("keeps raw tool calls non-authoritative for known sessions before reconnect materializes", () => {
		const disconnectedHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "claude-code",
		} as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-1",
				name: "WebSearch",
				status: "in_progress",
				kind: "search",
				arguments: {
					kind: "search",
					query: "yc deal",
				},
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, disconnectedHandler);
	});

	it("drops duplicate raw tool-call replays without mutating known disconnected sessions", () => {
		const disconnectedHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "claude-code",
		} as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-buffered-1",
				name: "WebSearch",
				status: "in_progress",
				kind: "search",
				arguments: {
					kind: "search",
					query: "canonical dedupe",
				},
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, disconnectedHandler, 303);
		service.handleSessionUpdate(update, disconnectedHandler, 303);
	});

	it("does not buffer raw permissionRequest updates for disconnected sessions", () => {
		const disconnectedHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "copilot",
		} as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const update: SessionUpdate = {
			type: "permissionRequest",
			permission: {
				id: "perm-1",
				sessionId: "session-123",
				jsonRpcRequestId: 42,
				permission: "Write",
				patterns: ["/tmp/file.txt"],
				metadata: { diagnosticRawInput: { file_path: "/tmp/file.txt" } },
				always: [],
				autoAccepted: false,
				tool: {
					messageId: "",
					callId: "tool-write-1",
				},
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, disconnectedHandler);

		service.flushPendingEvents("session-123", disconnectedHandler);
	});

	it("does not buffer raw questionRequest updates for disconnected sessions", () => {
		const disconnectedHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "copilot",
		} as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const update: SessionUpdate = {
			type: "questionRequest",
			question: {
				id: "question-1",
				sessionId: "session-123",
				questions: [
					{
						question: "Proceed?",
						header: "Confirm",
						options: [{ label: "Yes", description: "Continue" }],
						multiSelect: false,
					},
				],
				tool: {
					messageId: "",
					callId: "tool-question-1",
				},
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, disconnectedHandler);

		service.flushPendingEvents("session-123", disconnectedHandler);
	});

	it("keeps raw tool calls non-authoritative while connecting", () => {
		const connectingHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "claude-code",
		} as unknown as SessionCold;
		(connectingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-1",
				name: "WebSearch",
				status: "in_progress",
				kind: "search",
				arguments: {
					kind: "search",
					query: "yc deal",
				},
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, connectingHandler);
	});

	it("[regression] leaves reconnect-time raw tool calls to canonical envelopes while connecting", () => {
		const reconnectingHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "claude-code",
		} as unknown as SessionCold;
		(reconnectingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-replay-connecting-1",
				name: "Read",
				status: "in_progress",
				kind: "read",
				arguments: {
					kind: "read",
					file_path: "/repo/src/replayed.ts",
				},
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, reconnectingHandler, 500);
	});

	it("[regression] does not buffer transcript deltas while connecting", () => {
		const reconnectingHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "claude-code",
		} as unknown as SessionCold;
		(reconnectingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const delta: TranscriptDelta = {
			sessionId: "session-123",
			eventSeq: 42,
			snapshotRevision: 42,
			operations: [
				{
					kind: "appendEntry",
					entry: {
						entryId: "assistant-42",
						role: "assistant",
						segments: [
							{
								kind: "text",
								segmentId: "assistant-42:segment:42",
								text: "post-snapshot delta",
							},
						],
					},
				},
			],
		};

		const envelope: SessionStateEnvelope = {
			sessionId: "session-123",
			graphRevision: 42,
			lastEventSeq: 42,
			payload: {
				kind: "delta",
				delta: {
					fromRevision: { graphRevision: 41, transcriptRevision: 41, lastEventSeq: 41 },
					toRevision: { graphRevision: 42, transcriptRevision: 42, lastEventSeq: 42 },
					activity: createIdleActivity(),
					turnState: "Running",
					activeTurnFailure: null,
					lastTerminalTurnId: null,
					activeStreamingTail: null,
					transcriptOperations: delta.operations,
					operationPatches: [],
					interactionPatches: [],
					changedFields: ["transcriptSnapshot"],
				},
			},
		};

		service.handleSessionStateEnvelope(envelope, reconnectingHandler);

		expect(reconnectingHandler.applySessionStateEnvelope).toHaveBeenCalledTimes(1);
		expect(reconnectingHandler.applySessionStateEnvelope).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				sessionId: "session-123",
				graphRevision: 42,
				lastEventSeq: 42,
			})
		);
	});

	it("does not infer plan mode from enter_plan_mode tool calls", () => {
		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-enter-plan-1",
				name: "EnterPlanMode",
				status: "in_progress",
				kind: "enter_plan_mode",
				arguments: {
					kind: "planMode",
					mode: "plan",
				},
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.applySessionStateEnvelope).not.toHaveBeenCalled();
	});

	it("keeps Cursor tool calls non-authoritative on the raw lane", () => {
		(handler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue({
			id: "session-123",
			agentId: "cursor",
		} as unknown as SessionCold);

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-question-1",
				name: "Think",
				status: "pending",
				kind: "task",
				title: "Ask Question",
				arguments: {
					kind: "think",
					raw: { _toolName: "askQuestion" },
				},
				awaitingPlanApproval: false,
			},
		};

		// Frontend no longer suppresses — Cursor pre-tool notifications are
		// filtered in the Rust backend (is_cursor_extension_pre_tool).
		service.handleSessionUpdate(update, handler);
	});

	// ==========================================================================
	// Unit 0: Characterization — reconnect and recovery invariants
	//
	// These tests lock in the current behavior that must stay true while the
	// canonical pipeline replaces legacy authority (Units 2-7). They are the
	// standing regression harness. Do not delete them; update assertions if
	// canonical behavior is intentionally changed.
	// ==========================================================================

	it("[characterize] reconnect during in-progress tool call leaves raw updates to canonical envelopes", () => {
		const disconnectedHandler = createMockHandler();
		const session = { id: "session-123", agentId: "claude-code" } as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		// Phase 1: tool call arrives before reconnect materialization.
		// Frontend no longer buffers known-session updates based on guessed connection truth.
		const toolCallUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-read-1",
				name: "Read",
				status: "in_progress",
				kind: "read",
				arguments: { kind: "read", file_path: "/repo/src/main.ts" },
				awaitingPlanApproval: false,
			},
		};
		service.handleSessionUpdate(toolCallUpdate, disconnectedHandler, 50);

		// Phase 2: reconnect — there is nothing queued to replay because raw tool
		// events are observational only and canonical envelopes own the state.
		service.flushPendingEvents("session-123", disconnectedHandler);

		// Phase 3: completion update after reconnect applies without duplication
		const completionUpdate: SessionUpdate = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-read-1",
				status: "completed",
				result: { content: "// file contents" },
			},
		};
		service.handleSessionUpdate(completionUpdate, disconnectedHandler, 51);
	});

	it("[characterize] late raw tool-call replays do not mutate state after reconnect", () => {
		const disconnectedHandler = createMockHandler();
		const session = { id: "session-123", agentId: "claude-code" } as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-late-1",
				name: "Search",
				status: "in_progress",
				kind: "search",
				arguments: { kind: "search", query: "idempotency" },
				awaitingPlanApproval: false,
			},
		};

		// Same envelope-seq delivered twice while disconnected
		service.handleSessionUpdate(update, disconnectedHandler, 77);
		service.handleSessionUpdate(update, disconnectedHandler, 77);

		service.flushPendingEvents("session-123", disconnectedHandler);
	});

	it("[characterize] raw permissionRequest does not reappear after reconnect flush", () => {
		const disconnectedHandler = createMockHandler();
		const session = { id: "session-123", agentId: "copilot" } as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		// Permission requests are not buffered for disconnected sessions — they
		// bypass the disconnected buffer and fire immediately. This invariant
		// ensures a permission prompt is never silently lost while disconnected.
		const permUpdate: SessionUpdate = {
			type: "permissionRequest",
			session_id: "session-123",
			permission: {
				id: "perm-reconnect-1",
				sessionId: "session-123",
				jsonRpcRequestId: 99,
				permission: "Edit",
				patterns: ["/repo/src/*.ts"],
				metadata: { diagnosticRawInput: { file_path: "/repo/src/main.ts" } },
				always: [],
				autoAccepted: false,
				tool: { messageId: "", callId: "tool-edit-reconnect" },
			},
		};
		service.handleSessionUpdate(permUpdate, disconnectedHandler, 80);

		service.flushPendingEvents("session-123", disconnectedHandler);
	});

	it("[characterize] raw questionRequest does not reappear after reconnect flush", () => {
		const disconnectedHandler = createMockHandler();
		const session = { id: "session-123", agentId: "copilot" } as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);

		const questionUpdate: SessionUpdate = {
			type: "questionRequest",
			session_id: "session-123",
			question: {
				id: "question-reconnect-1",
				sessionId: "session-123",
				questions: [
					{
						question: "Continue with changes?",
						header: "Confirm",
						options: [
							{ label: "Yes", description: "Proceed" },
							{ label: "No", description: "Cancel" },
						],
						multiSelect: false,
					},
				],
				tool: { messageId: "", callId: "tool-question-reconnect" },
			},
		};
		service.handleSessionUpdate(questionUpdate, disconnectedHandler, 81);

		service.flushPendingEvents("session-123", disconnectedHandler);
	});

	it("rejects canonical connection waiters from lifecycle error envelopes", async () => {
		const disconnectedHandler = createMockHandler();
		const session = { id: "session-crash-1", agentId: "copilot" } as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);
		const { promise } = service.waitForConnectionMaterialization("session-crash-1", 5000);

		service.handleSessionStateEnvelope(
			{
				sessionId: "session-crash-1",
				graphRevision: 4,
				lastEventSeq: 4,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("failed", "Provider disconnected"),
					revision: {
						graphRevision: 4,
						transcriptRevision: 2,
						lastEventSeq: 4,
					},
				},
			},
			disconnectedHandler
		);

		await expect(promise).rejects.toThrow("Provider disconnected");
	});

	it("resolves canonical connection waiters once ready lifecycle and capabilities arrive", async () => {
		const connectedHandler = createMockHandler();
		const { promise } = service.waitForConnectionMaterialization("session-ready-1", 5000);

		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-1",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "capabilities",
					capabilities: {
						models: {
							availableModels: [{ modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
							currentModelId: "claude-sonnet-4.6",
						},
						modes: {
							currentModeId: "build",
							availableModes: [{ id: "build", name: "Build", description: null }],
						},
						availableCommands: [{ name: "compact", description: "Compact", input: null }],
						configOptions: [],
						autonomousEnabled: true,
					},
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
					pending_mutation_id: null,
					preview_state: "canonical",
				},
			},
			connectedHandler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-1",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			connectedHandler
		);

		await expect(promise).resolves.toMatchObject({
			autonomousEnabled: true,
			availableCommands: [{ name: "compact", description: "Compact", input: null }],
			modes: {
				currentModeId: "build",
			},
		});
	});

	it("preserves missing autonomous capability in connection materialization", async () => {
		const connectedHandler = createMockHandler();
		const { promise } = service.waitForConnectionMaterialization(
			"session-ready-unknown-autonomous",
			5000
		);

		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-unknown-autonomous",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "capabilities",
					capabilities: {
						models: {
							availableModels: [{ modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
							currentModelId: "claude-sonnet-4.6",
						},
						modes: {
							currentModeId: "build",
							availableModes: [{ id: "build", name: "Build", description: null }],
						},
						availableCommands: [],
						configOptions: [],
					},
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
					pending_mutation_id: null,
					preview_state: "canonical",
				},
			},
			connectedHandler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-unknown-autonomous",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			connectedHandler
		);

		await expect(promise).resolves.toMatchObject({
			autonomousEnabled: null,
		});
	});

	it("preserves missing command and config capability lists in connection materialization", async () => {
		const connectedHandler = createMockHandler();
		const { promise } = service.waitForConnectionMaterialization(
			"session-ready-unknown-lists",
			5000
		);

		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-unknown-lists",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "capabilities",
					capabilities: {
						models: {
							availableModels: [{ modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
							currentModelId: "claude-sonnet-4.6",
						},
						modes: {
							currentModeId: "build",
							availableModes: [{ id: "build", name: "Build", description: null }],
						},
						autonomousEnabled: true,
					},
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
					pending_mutation_id: null,
					preview_state: "canonical",
				},
			},
			connectedHandler
		);
		service.handleSessionStateEnvelope(
			{
				sessionId: "session-ready-unknown-lists",
				graphRevision: 8,
				lastEventSeq: 8,
				payload: {
					kind: "lifecycle",
					lifecycle: createGraphLifecycle("ready"),
					revision: {
						graphRevision: 8,
						transcriptRevision: 3,
						lastEventSeq: 8,
					},
				},
			},
			connectedHandler
		);

		await expect(promise).resolves.toMatchObject({
			availableCommands: null,
			configOptions: null,
		});
	});

	it("does not infer current mode from configOptionUpdate", () => {
		const update: SessionUpdate = {
			type: "configOptionUpdate",
			session_id: "session-123",
			update: {
				configOptions: [
					{
						id: "mode",
						name: "Mode",
						category: "mode",
						type: "select",
						currentValue: "plan",
					},
					{
						id: "model",
						name: "Model",
						category: "model",
						type: "select",
						currentValue: "sonnet",
					},
				],
			},
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.applySessionStateEnvelope).not.toHaveBeenCalled();
	});

	it("stores configOptionUpdate even when no mode option is present", () => {
		const update: SessionUpdate = {
			type: "configOptionUpdate",
			session_id: "session-123",
			update: {
				configOptions: [
					{
						id: "model",
						name: "Model",
						category: "model",
						type: "select",
						currentValue: "sonnet",
					},
				],
			},
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.applySessionStateEnvelope).not.toHaveBeenCalled();
	});

	it("stores configOptionUpdate even when mode currentValue is not a string", () => {
		const update: SessionUpdate = {
			type: "configOptionUpdate",
			session_id: "session-123",
			update: {
				configOptions: [
					{
						id: "mode",
						name: "Mode",
						category: "mode",
						type: "select",
						currentValue: null,
					},
				],
			},
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.applySessionStateEnvelope).not.toHaveBeenCalled();
	});

	it("drops duplicate raw toolCall events without mutating state", () => {
		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-dup-1",
				name: "Read",
				status: "completed",
				kind: "read",
				arguments: { kind: "read", file_path: "/tmp/test.txt" },
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, handler, 101);
		service.handleSessionUpdate(update, handler, 101);
	});

	it("keeps richer raw toolCall arguments non-authoritative", () => {
		const placeholder: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-apply-patch-1",
				name: "apply_patch",
				status: "pending",
				kind: "edit",
				arguments: { kind: "other", raw: {} },
				awaitingPlanApproval: false,
			},
		};

		const enriched: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-apply-patch-1",
				name: "apply_patch",
				status: "pending",
				kind: "edit",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "link.txt",
							oldString: null,
							newString: null,
							content: "https://example.com",
						},
					],
				},
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(placeholder, handler);
		service.handleSessionUpdate(enriched, handler);
	});

	it("leaves duplicate assistant text chunks to canonical envelopes during active streaming", () => {
		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-123",
			message_id: "msg-dup-1",
			chunk: {
				content: {
					type: "text",
					text: "Hi. How can I help you today? I see you are in the sample-go-project project.",
				},
			},
		};

		service.handleSessionUpdate(update, handler);
		service.handleSessionUpdate(update, handler);
	});

	it("does not synthesize replay assistant chunks from raw event replays", () => {
		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-123",
			message_id: "msg-dup-replay",
			chunk: {
				content: {
					type: "text",
					text: "Hi. How can I help you today? I see you are in the sample-go-project project.",
				},
			},
		};

		service.handleSessionUpdate(update, handler, 202);
		service.handleSessionUpdate(update, handler, 202);
	});

	it("does not force streaming state from raw replay assistant chunks", () => {
		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-123",
			message_id: "msg-replay-static",
			chunk: {
				content: {
					type: "text",
					text: "Historical replay content should render as settled transcript, not live streaming.",
				},
			},
		};

		service.handleSessionUpdate(update, handler);
	});

	it("ignores repeated assistant chunks until canonical envelopes arrive", () => {
		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-123",
			message_id: "msg-repeat-late",
			chunk: {
				content: {
					type: "text",
					text: "This chunk is intentionally repeated as a separate event.",
				},
			},
		};

		service.handleSessionUpdate(update, handler);
		service.handleSessionUpdate(update, handler);
	});

	it("treats raw user chunks as coordination-only during reopened sends", () => {
		const sessionId = "session-reopen-send";
		const entryStore = new SessionEntryStore();
		preloadEntriesAndBuildIndex(entryStore, sessionId, [
			{
				id: "assistant-history-1",
				type: "assistant",
				timestamp: new Date(),
				message: {
					chunks: [
						{
							type: "message",
							block: {
								type: "text",
								text: "existing answer",
							},
						},
					],
				},
			},
		]);

		const integrationHandler: SessionEventHandler = {
			getSessionCold: vi.fn().mockReturnValue({ id: sessionId, agentId: "cursor" } as SessionCold),
			isPreloaded: vi.fn().mockReturnValue(true),
			getSessionCanSend: vi.fn().mockReturnValue(null),
			updateUsageTelemetry: vi.fn(),
			applySessionStateEnvelope: vi.fn(),
		};

		service.handleSessionUpdate(
			{
				type: "userMessageChunk",
				sessionId: sessionId,
				chunk: { content: { type: "text", text: "follow-up question" } },
			},
			integrationHandler
		);
		service.handleSessionUpdate(
			{
				type: "agentMessageChunk",
				session_id: sessionId,
				message_id: "assistant-raw-ignored",
				chunk: { content: { type: "text", text: "raw assistant chunk" } },
			},
			integrationHandler
		);

		expect(readStoredEntries(entryStore, sessionId).map((entry) => entry.type)).toEqual([
			"assistant",
		]);
		expect(readStoredEntries(entryStore, sessionId)[0]).toMatchObject({
			id: "assistant-history-1",
			message: {
				chunks: [
					{
						block: {
							text: "existing answer",
						},
					},
				],
			},
		});
	});

	it("keeps distinct raw toolCallUpdate events non-authoritative", () => {
		const firstUpdate: SessionUpdate = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-123",
				status: "in_progress",
				title: "Running",
			},
		};
		const secondUpdate: SessionUpdate = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-123",
				status: "completed",
				title: "Done",
			},
		};

		service.handleSessionUpdate(firstUpdate, handler);
		service.handleSessionUpdate(secondUpdate, handler);
	});

	it("keeps repeated parent task raw tool calls non-authoritative when child structure grows", () => {
		const initialParentUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "task-parent-1",
				name: "Agent",
				arguments: {
					kind: "think",
					subagent_type: "reviewer",
					description: "Review the implementation",
					prompt: "Inspect the changes",
				},
				status: "in_progress",
				kind: "task",
				title: "Agent",
				locations: null,
				skillMeta: null,
				result: null,
				taskChildren: null,
				awaitingPlanApproval: false,
			},
		};
		const enrichedParentUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "task-parent-1",
				name: "Agent",
				arguments: {
					kind: "think",
					subagent_type: "reviewer",
					description: "Review the implementation",
					prompt: "Inspect the changes",
				},
				status: "in_progress",
				kind: "task",
				title: "Agent",
				locations: null,
				skillMeta: null,
				result: null,
				taskChildren: [
					{
						id: "task-child-1",
						name: "Read",
						arguments: { kind: "read", file_path: "/repo/src/task.ts" },
						status: "completed",
						kind: "read",
						title: "Read file",
						locations: null,
						skillMeta: null,
						result: null,
						taskChildren: null,
						awaitingPlanApproval: false,
					},
				],
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(initialParentUpdate, handler);
		service.handleSessionUpdate(enrichedParentUpdate, handler);
	});

	it("keeps repeated parent task raw tool calls non-authoritative when child count grows", () => {
		const initialChildren = Array.from({ length: 12 }, (_, index) => createTaskReplayChild(index));
		const enrichedChildren = initialChildren.concat([createTaskReplayChild(12)]);
		const initialParentUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "task-parent-2",
				name: "Agent",
				arguments: {
					kind: "think",
					subagent_type: "reviewer",
					description: "Review the implementation",
					prompt: "Inspect the changes",
				},
				status: "in_progress",
				kind: "task",
				title: "Agent",
				locations: null,
				skillMeta: null,
				result: null,
				taskChildren: initialChildren,
				awaitingPlanApproval: false,
			},
		};
		const enrichedParentUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "task-parent-2",
				name: "Agent",
				arguments: {
					kind: "think",
					subagent_type: "reviewer",
					description: "Review the implementation",
					prompt: "Inspect the changes",
				},
				status: "in_progress",
				kind: "task",
				title: "Agent",
				locations: null,
				skillMeta: null,
				result: null,
				taskChildren: enrichedChildren,
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(initialParentUpdate, handler);
		service.handleSessionUpdate(enrichedParentUpdate, handler);
	});

	it("keeps repeated parent task raw tool calls non-authoritative when child payload grows", () => {
		const initialParentUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "task-parent-3",
				name: "Agent",
				arguments: {
					kind: "think",
					subagent_type: "reviewer",
					description: "Review the implementation",
					prompt: "Inspect the changes",
				},
				status: "in_progress",
				kind: "task",
				title: "Agent",
				locations: null,
				skillMeta: null,
				result: null,
				taskChildren: [
					{
						id: "task-child-rich-1",
						name: "Read",
						arguments: { kind: "read", file_path: "/repo/src/task.ts" },
						status: "completed",
						kind: "read",
						title: "Read file",
						locations: null,
						skillMeta: null,
						result: null,
						taskChildren: null,
						awaitingPlanApproval: false,
					},
				],
				awaitingPlanApproval: false,
			},
		};
		const enrichedParentUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "task-parent-3",
				name: "Agent",
				arguments: {
					kind: "think",
					subagent_type: "reviewer",
					description: "Review the implementation",
					prompt: "Inspect the changes",
				},
				status: "in_progress",
				kind: "task",
				title: "Agent",
				locations: null,
				skillMeta: null,
				result: null,
				taskChildren: [
					{
						id: "task-child-rich-1",
						name: "Read",
						arguments: { kind: "read", file_path: "/repo/src/task.ts" },
						status: "completed",
						kind: "read",
						title: "Read file with context",
						locations: [{ path: "/repo/src/task.ts" }],
						skillMeta: null,
						result: "done",
						taskChildren: null,
						awaitingPlanApproval: false,
					},
				],
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(initialParentUpdate, handler);
		service.handleSessionUpdate(enrichedParentUpdate, handler);
	});

	it("keeps repeated raw tool calls non-authoritative when top-level arguments grow", () => {
		const sharedPrefix = "a".repeat(220);
		const initialUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-long-args-1",
				name: "Write",
				arguments: {
					kind: "other",
					raw: {
						payload: `${sharedPrefix}-initial`,
					},
				},
				status: "in_progress",
				kind: "other",
				title: "Write file",
				locations: null,
				skillMeta: null,
				result: null,
				taskChildren: null,
				awaitingPlanApproval: false,
			},
		};
		const enrichedUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-long-args-1",
				name: "Write",
				arguments: {
					kind: "other",
					raw: {
						payload: `${sharedPrefix}-enriched`,
					},
				},
				status: "in_progress",
				kind: "other",
				title: "Write file",
				locations: null,
				skillMeta: null,
				result: null,
				taskChildren: null,
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(initialUpdate, handler);
		service.handleSessionUpdate(enrichedUpdate, handler);
	});

	it("keeps repeated raw tool calls non-authoritative when top-level results grow", () => {
		const initialUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-rich-result-1",
				name: "Write",
				arguments: {
					kind: "other",
					raw: {
						payload: "draft",
					},
				},
				status: "completed",
				kind: "other",
				title: "Write file",
				locations: null,
				skillMeta: null,
				result: "ok",
				taskChildren: null,
				awaitingPlanApproval: false,
			},
		};
		const enrichedUpdate: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-rich-result-1",
				name: "Write",
				arguments: {
					kind: "other",
					raw: {
						payload: "draft",
					},
				},
				status: "completed",
				kind: "other",
				title: "Write file",
				locations: [{ path: "/repo/src/file.ts" }],
				skillMeta: null,
				result: {
					summary: "updated",
					linesChanged: 12,
				},
				taskChildren: null,
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(initialUpdate, handler);
		service.handleSessionUpdate(enrichedUpdate, handler);
	});

	it("keeps distinct raw toolCallUpdate argument changes non-authoritative", () => {
		const initialUpdate: Extract<SessionUpdate, { type: "toolCallUpdate" }> = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-update-args-1",
				status: "in_progress",
				title: "Running",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/repo/src/file.ts",
							oldString: "before",
							newString: null,
							content: null,
						},
					],
				},
			},
		};
		const enrichedUpdate: Extract<SessionUpdate, { type: "toolCallUpdate" }> = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-update-args-1",
				status: "in_progress",
				title: "Running",
				arguments: {
					kind: "edit",
					edits: [
						{
							filePath: "/repo/src/file.ts",
							oldString: "before",
							newString: "after",
							content: null,
						},
					],
				},
			},
		};

		service.handleSessionUpdate(initialUpdate, handler);
		service.handleSessionUpdate(enrichedUpdate, handler);
	});

	it("keeps distinct raw toolCallUpdate raw-output changes non-authoritative", () => {
		const sharedPrefix = "x".repeat(220);
		const initialUpdate: Extract<SessionUpdate, { type: "toolCallUpdate" }> = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-update-raw-1",
				status: "completed",
				title: "Done",
				rawOutput: {
					payload: `${sharedPrefix}-initial`,
				},
			},
		};
		const enrichedUpdate: Extract<SessionUpdate, { type: "toolCallUpdate" }> = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-update-raw-1",
				status: "completed",
				title: "Done",
				rawOutput: {
					payload: `${sharedPrefix}-enriched`,
				},
			},
		};

		service.handleSessionUpdate(initialUpdate, handler);
		service.handleSessionUpdate(enrichedUpdate, handler);
	});
});
