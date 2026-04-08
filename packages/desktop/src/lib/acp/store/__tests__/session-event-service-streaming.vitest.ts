/**
 * Session Event Service Streaming Tests
 *
 * Tests for streaming delta handling, specifically verifying that:
 * 1. Empty string deltas are handled by the fast path (not creating placeholder entries)
 * 2. Regular updates without streamingInputDelta go through normal path
 */

import { okAsync } from "neverthrow";
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

import type { SessionUpdate } from "../../../services/converted-session-types.js";
import type { SessionEntry } from "../../application/dto/session.js";
import { SessionEntryStore } from "../session-entry-store.svelte.js";
import type { SessionEventHandler } from "../session-event-handler.js";
import { SessionEventService } from "../session-event-service.svelte.js";
import type { SessionCold } from "../types.js";

function createMockHandler(): SessionEventHandler {
	return {
		getSessionCold: vi.fn().mockReturnValue({ id: "session-123" } as unknown as SessionCold),
		isPreloaded: vi.fn().mockReturnValue(true),
		getEntries: vi.fn().mockReturnValue([]),
		getHotState: vi.fn(),
		aggregateAssistantChunk: vi.fn().mockReturnValue(okAsync(undefined)),
		aggregateUserChunk: vi.fn().mockReturnValue(okAsync(undefined)),
		createToolCallEntry: vi.fn(),
		updateToolCallEntry: vi.fn(),
		updateAvailableCommands: vi.fn(),
		ensureStreamingState: vi.fn(),
		handleStreamEntry: vi.fn(),
		handleStreamComplete: vi.fn(),
		handleTurnError: vi.fn(),
		clearStreamingAssistantEntry: vi.fn(),
		updateCurrentMode: vi.fn(),
		updateConfigOptions: vi.fn(),
		updateUsageTelemetry: vi.fn(),
	};
}

function markHandlerTurnAsStreaming(handler: SessionEventHandler): void {
	(handler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
		turnState: "streaming",
	});
}

function markHandlerTurnAsCompleted(handler: SessionEventHandler): void {
	(handler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
		turnState: "completed",
	});
}

function createTaskReplayEntry(toolCallId: string): SessionEntry {
	return {
		id: `entry-${toolCallId}`,
		type: "tool_call",
		timestamp: new Date(),
		message: {
			id: toolCallId,
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

	it("resolves an explicit provider context budget from usage telemetry updates", () => {
		(handler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			currentModel: { id: "claude-sonnet-4-5-20250929" },
			usageTelemetry: null,
		});

		const update: SessionUpdate = {
			type: "usageTelemetryUpdate",
			data: {
				sessionId: "session-123",
				scope: "turn",
				contextWindowSize: 200000,
				sourceModelId: "claude-sonnet-4-5-20250929",
				tokens: { total: 50000 },
			},
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.updateUsageTelemetry).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				contextBudget: expect.objectContaining({
					maxTokens: 200000,
					source: "provider-explicit",
					scope: "turn",
				}),
			})
		);
	});

	it("does not guess a Claude context budget when telemetry omits context size", () => {
		(handler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			currentModel: { id: "claude-sonnet-4-5-20250929" },
			usageTelemetry: null,
		});

		const update: SessionUpdate = {
			type: "usageTelemetryUpdate",
			data: {
				sessionId: "session-123",
				scope: "step",
				sourceModelId: "claude-sonnet-4-5-20250929",
				tokens: { total: 50000 },
			},
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.updateUsageTelemetry).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				contextBudget: null,
			})
		);
	});

	it("routes empty string streaming deltas through canonical tool updates", () => {
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

		expect(handler.updateToolCallEntry).toHaveBeenCalledWith("session-123", update.update);
	});

	it("routes non-empty streaming deltas through canonical tool updates", () => {
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

		expect(handler.updateToolCallEntry).toHaveBeenCalledWith("session-123", update.update);
	});

	it("should call updateToolCallEntry for tool_call_update without streamingInputDelta", () => {
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

		// Should call updateToolCallEntry for regular updates (no streaming delta)
		expect(handler.updateToolCallEntry).toHaveBeenCalledWith("session-123", update.update);
	});

	it("should call updateToolCallEntry when streamingInputDelta is undefined", () => {
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

		// Should call updateToolCallEntry for regular updates
		expect(handler.updateToolCallEntry).toHaveBeenCalled();
	});

	it("should forward status updates even when streamingInputDelta is present", () => {
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

		expect(handler.updateToolCallEntry).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				toolCallId: "tool-123",
				status: "completed",
			})
		);
	});

	it("should forward completion update when streamingArguments and status arrive together", () => {
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

		expect(handler.updateToolCallEntry).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				toolCallId: "tool-123",
				status: "completed",
				title: "Write `/Users/example/.claude/plans/test.md`",
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
			})
		);
	});

	it("treats a completed plan event as the end of an active turn", () => {
		markHandlerTurnAsStreaming(handler);
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

		expect(handler.handleStreamComplete).toHaveBeenCalledWith("session-123");
	});

	it("does not complete the turn again for a completed plan when the turn is already done", () => {
		markHandlerTurnAsCompleted(handler);
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

		expect(handler.handleStreamComplete).not.toHaveBeenCalled();
	});

	it("routes streamingArguments updates through the canonical tool update path", () => {
		markHandlerTurnAsStreaming(handler);
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

		expect(handler.updateToolCallEntry).toHaveBeenCalledTimes(2);
		expect(handler.updateToolCallEntry).toHaveBeenNthCalledWith(
			1,
			"session-123",
			firstUpdate.update
		);
		expect(handler.updateToolCallEntry).toHaveBeenNthCalledWith(
			2,
			"session-123",
			secondUpdate.update
		);
	});

	it("routes streamingArguments updates uniformly across multiple tools", () => {
		markHandlerTurnAsStreaming(handler);

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

		expect(handler.updateToolCallEntry).toHaveBeenCalledTimes(3);
		expect(handler.updateToolCallEntry).toHaveBeenNthCalledWith(
			1,
			"session-123",
			expect.objectContaining({
				toolCallId: "tool-a",
				streamingArguments: { kind: "read", file_path: "/a" },
			})
		);
		expect(handler.updateToolCallEntry).toHaveBeenNthCalledWith(
			2,
			"session-123",
			expect.objectContaining({
				toolCallId: "tool-b",
				streamingArguments: { kind: "read", file_path: "/b" },
			})
		);
		expect(handler.updateToolCallEntry).toHaveBeenNthCalledWith(
			3,
			"session-123",
			expect.objectContaining({
				toolCallId: "tool-a",
				streamingArguments: { kind: "read", file_path: "/a2" },
			})
		);
	});

	it("forwards lifecycle fields through canonical tool updates when streamingArguments are present", () => {
		markHandlerTurnAsStreaming(handler);
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

		expect(handler.updateToolCallEntry).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				toolCallId: "tool-123",
				status: "in_progress",
				title: "Running command",
			})
		);
	});

	it("keeps later terminal updates on the same canonical tool update path", () => {
		markHandlerTurnAsStreaming(handler);
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

		expect(handler.updateToolCallEntry).toHaveBeenCalledWith(
			"session-123",
			expect.objectContaining({
				toolCallId: "tool-123",
				status: "completed",
			})
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

		expect(missingSessionHandler.aggregateAssistantChunk).not.toHaveBeenCalled();
	});

	it("uses message_id for assistant aggregation even when part_id is present", () => {
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

		expect(handler.aggregateAssistantChunk).toHaveBeenCalledWith(
			"session-123",
			update.chunk,
			"msg-1",
			false
		);
	});

	it("routes permissionRequest updates to the permission callback", () => {
		const onPermissionRequest = vi.fn();
		service.setCallbacks({ onPermissionRequest });

		const update: SessionUpdate = {
			type: "permissionRequest",
			permission: {
				id: "perm-1",
				sessionId: "session-123",
				jsonRpcRequestId: 42,
				permission: "WebFetch",
				patterns: ["https://example.com/*"],
				metadata: { rawInput: { url: "https://example.com" } },
				always: [],
				tool: {
					messageId: "",
					callId: "tool-fetch-1",
				},
			},
			session_id: "session-123",
		};

		service.handleSessionUpdate(update, handler);

		expect(onPermissionRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "perm-1",
				sessionId: "session-123",
				jsonRpcRequestId: 42,
				permission: "WebFetch",
			})
		);
	});

	it("routes questionRequest updates to the question callback", () => {
		const onQuestionRequest = vi.fn();
		service.setCallbacks({ onQuestionRequest });

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

		expect(onQuestionRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "question-1",
				sessionId: "session-123",
			})
		);
	});

	it("merges chunks into one assistant entry when part_id changes mid-stream", () => {
		const sessionId = "session-aggregate";
		const entryStore = new SessionEntryStore();
		entryStore.storeEntriesAndBuildIndex(sessionId, []);

		const integrationHandler: SessionEventHandler = {
			getSessionCold: vi
				.fn()
				.mockReturnValue({ id: sessionId, agentId: "claude-code" } as SessionCold),
			isPreloaded: vi.fn().mockReturnValue(true),
			getEntries: vi.fn().mockImplementation((id: string) => entryStore.getEntries(id)),
			getHotState: vi.fn().mockReturnValue({ isConnected: true, status: "streaming" }),
			aggregateAssistantChunk: vi
				.fn()
				.mockImplementation(
					(id: string, chunk, messageId: string | undefined, isThought: boolean) =>
						entryStore.aggregateAssistantChunk(id, chunk, messageId, isThought)
				),
			aggregateUserChunk: vi
				.fn()
				.mockImplementation((id: string, chunk) => entryStore.aggregateUserChunk(id, chunk)),
			createToolCallEntry: vi.fn(),
			updateToolCallEntry: vi.fn(),
			updateAvailableCommands: vi.fn(),
			ensureStreamingState: vi.fn(),
			handleStreamEntry: vi.fn(),
			handleStreamComplete: vi.fn(),
			handleTurnError: vi.fn(),
			clearStreamingAssistantEntry: vi.fn(),
			updateCurrentMode: vi.fn(),
			updateConfigOptions: vi.fn(),
			updateUsageTelemetry: vi.fn(),
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

		const assistantEntries = entryStore
			.getEntries(sessionId)
			.filter((entry) => entry.type === "assistant");
		expect(assistantEntries).toHaveLength(1);

		const assistantEntry = assistantEntries[0];
		if (assistantEntry.type === "assistant") {
			const text = assistantEntry.message.chunks
				.map((chunk) => (chunk.block.type === "text" ? chunk.block.text : ""))
				.join("");
			expect(text).toBe("and then at THE END of the streaming, clarify!");
		}
	});

	it("clears assistant streaming state when userMessageChunk arrives", () => {
		const update: SessionUpdate = {
			type: "userMessageChunk",
			session_id: "session-123",
			chunk: {
				content: { type: "text", text: "All I want is success" },
			},
		};

		service.handleSessionUpdate(update, handler);

		expect(handler.clearStreamingAssistantEntry).toHaveBeenCalledWith("session-123");
		expect(handler.aggregateUserChunk).toHaveBeenCalledWith("session-123", update.chunk);
	});

	it("buffers updates for disconnected sessions when not connecting", () => {
		const disconnectedHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "claude-code",
		} as unknown as SessionCold;
		(disconnectedHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);
		// Hot state drives the disconnected guard — cold state isConnected is stale
		(disconnectedHandler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			status: "idle",
		});

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

		expect(disconnectedHandler.createToolCallEntry).not.toHaveBeenCalled();
	});

	it("accepts updates for disconnected sessions while connecting", () => {
		const connectingHandler = createMockHandler();
		const session = {
			id: "session-123",
			agentId: "claude-code",
		} as unknown as SessionCold;
		(connectingHandler.getSessionCold as ReturnType<typeof vi.fn>).mockReturnValue(session);
		// Hot state drives the disconnected guard
		(connectingHandler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: false,
			status: "connecting",
		});

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

		expect(connectingHandler.createToolCallEntry).toHaveBeenCalledWith(
			"session-123",
			update.tool_call
		);
	});

	it("drops replay content updates when replay suppression is enabled", () => {
		const suppressedHandler = createMockHandler();
		(suppressedHandler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "ready",
			turnState: "idle",
		});
		service.suppressReplayForSession("session-123");

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-replay-1",
				name: "Read",
				status: "completed",
				kind: "read",
				arguments: { kind: "read", file_path: "/tmp/test.txt" },
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, suppressedHandler);

		expect(suppressedHandler.createToolCallEntry).not.toHaveBeenCalled();
	});

	it("still processes non-content updates while replay suppression is enabled", () => {
		const suppressedHandler = createMockHandler();
		(suppressedHandler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "ready",
			turnState: "idle",
		});
		service.suppressReplayForSession("session-123");

		const update: SessionUpdate = {
			type: "currentModeUpdate",
			session_id: "session-123",
			update: { currentModeId: "plan" },
		};

		service.handleSessionUpdate(update, suppressedHandler);

		expect(suppressedHandler.updateCurrentMode).toHaveBeenCalledWith("session-123", "plan");
	});

	it("keeps replay suppression armed and only bypasses it during active turns", () => {
		const suppressedHandler = createMockHandler();
		const hotState = {
			isConnected: true,
			status: "ready",
			turnState: "idle",
		};
		(suppressedHandler.getHotState as ReturnType<typeof vi.fn>).mockImplementation(() => hotState);
		service.suppressReplayForSession("session-123");

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-live-1",
				name: "Read",
				status: "completed",
				kind: "read",
				arguments: { kind: "read", file_path: "/tmp/live.txt" },
				awaitingPlanApproval: false,
			},
		};

		// While idle, replay content is dropped.
		service.handleSessionUpdate(update, suppressedHandler);
		expect(suppressedHandler.createToolCallEntry).not.toHaveBeenCalled();

		// Once a real turn starts, suppression is removed and updates flow through.
		hotState.status = "streaming";
		hotState.turnState = "streaming";
		service.handleSessionUpdate(update, suppressedHandler);

		// Suppression re-applies while idle after the active turn ends.
		hotState.status = "ready";
		hotState.turnState = "idle";
		service.handleSessionUpdate(update, suppressedHandler);

		expect(suppressedHandler.createToolCallEntry).toHaveBeenCalledTimes(1);
	});

	it("allows pending tool calls through replay suppression while idle", () => {
		const suppressedHandler = createMockHandler();
		(suppressedHandler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "ready",
			turnState: "idle",
		});
		service.suppressReplayForSession("session-123");

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-exit-plan-1",
				name: "ExitPlanMode",
				status: "pending",
				kind: "exit_plan_mode",
				arguments: { kind: "planMode" },
				title: "Ready to code?",
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, suppressedHandler);

		expect(suppressedHandler.createToolCallEntry).toHaveBeenCalledWith(
			"session-123",
			update.tool_call
		);
	});

	it("drops replayed pending tool calls when the preloaded session already has that tool id", () => {
		const suppressedHandler = createMockHandler();
		(suppressedHandler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "ready",
			turnState: "idle",
		});
		(suppressedHandler.getEntries as ReturnType<typeof vi.fn>).mockReturnValue([
			{
				id: "tool-exit-plan-1",
				type: "tool_call",
				message: {
					id: "tool-exit-plan-1",
				},
			},
		]);
		service.suppressReplayForSession("session-123");

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-exit-plan-1",
				name: "Edit",
				status: "pending",
				kind: "edit",
				arguments: { kind: "edit", edits: [{}] },
				title: "apply_patch",
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, suppressedHandler);

		expect(suppressedHandler.createToolCallEntry).not.toHaveBeenCalled();
	});

	it("allows pending tool call updates through replay suppression while idle", () => {
		const suppressedHandler = createMockHandler();
		(suppressedHandler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "ready",
			turnState: "idle",
		});
		service.suppressReplayForSession("session-123");

		const update: SessionUpdate = {
			type: "toolCallUpdate",
			session_id: "session-123",
			update: {
				toolCallId: "tool-exit-plan-1",
				status: "pending",
				title: "Ready to code?",
			},
		};

		service.handleSessionUpdate(update, suppressedHandler);

		expect(suppressedHandler.updateToolCallEntry).toHaveBeenCalledWith(
			"session-123",
			update.update
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

		expect(handler.updateCurrentMode).not.toHaveBeenCalled();
	});

	it("creates Cursor tool calls without frontend suppression (backend handles pre-tool dedup)", () => {
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

		expect(handler.createToolCallEntry).toHaveBeenCalledWith("session-123", update.tool_call);
		expect(handler.ensureStreamingState).toHaveBeenCalledWith("session-123");
	});

	it("syncs mode from configOptionUpdate when a mode option is present", () => {
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

		expect(handler.updateCurrentMode).toHaveBeenCalledWith("session-123", "plan");
	});

	it("ignores configOptionUpdate when no mode option is present", () => {
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

		expect(handler.updateCurrentMode).not.toHaveBeenCalled();
	});

	it("ignores configOptionUpdate when mode currentValue is not a string", () => {
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

		expect(handler.updateCurrentMode).not.toHaveBeenCalled();
	});

	it("drops duplicate toolCall events with the same fingerprint", () => {
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

		service.handleSessionUpdate(update, handler);
		service.handleSessionUpdate(update, handler);

		expect(handler.createToolCallEntry).toHaveBeenCalledTimes(1);
	});

	it("does not drop toolCall events when arguments become richer for the same id", () => {
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

		expect(handler.createToolCallEntry).toHaveBeenCalledTimes(2);
		expect(handler.createToolCallEntry).toHaveBeenLastCalledWith(
			"session-123",
			expect.objectContaining({
				id: "tool-apply-patch-1",
				arguments: {
					kind: "edit",
					edits: [
						expect.objectContaining({
							filePath: "link.txt",
						}),
					],
				},
			})
		);
	});

	it("drops duplicate long assistant text chunks during streaming turns", () => {
		(handler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "streaming",
			turnState: "streaming",
		});

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

		expect(handler.aggregateAssistantChunk).toHaveBeenCalledTimes(1);
	});

	it("does not drop assistant chunks repeated outside the replay duplicate window", () => {
		(handler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "streaming",
			turnState: "streaming",
		});
		const nowSpy = vi.spyOn(service as unknown as { nowMs: () => number }, "nowMs");
		nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(6_500).mockReturnValue(6_500);

		const update: SessionUpdate = {
			type: "agentMessageChunk",
			session_id: "session-123",
			message_id: "msg-repeat-late",
			chunk: {
				content: {
					type: "text",
					text: "This chunk is intentionally repeated after the duplicate replay window.",
				},
			},
		};

		service.handleSessionUpdate(update, handler);
		service.handleSessionUpdate(update, handler);

		expect(handler.aggregateAssistantChunk).toHaveBeenCalledTimes(2);
	});

	it("does not drop distinct toolCallUpdate events for the same tool", () => {
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

		expect(handler.updateToolCallEntry).toHaveBeenCalledTimes(2);
	});

	it("applies repeated parent task tool calls when child structure grows", () => {
		markHandlerTurnAsStreaming(handler);
		(handler.getEntries as ReturnType<typeof vi.fn>).mockReturnValue([
			createTaskReplayEntry("task-parent-1"),
		]);

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

		expect(handler.createToolCallEntry).toHaveBeenCalledTimes(2);
		expect(handler.createToolCallEntry).toHaveBeenLastCalledWith(
			"session-123",
			enrichedParentUpdate.tool_call
		);
	});

	it("applies repeated parent task tool calls when later child growth happens beyond the fingerprint prefix", () => {
		markHandlerTurnAsStreaming(handler);
		(handler.getEntries as ReturnType<typeof vi.fn>).mockReturnValue([
			createTaskReplayEntry("task-parent-2"),
		]);

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

		expect(handler.createToolCallEntry).toHaveBeenCalledTimes(2);
		expect(handler.createToolCallEntry).toHaveBeenLastCalledWith(
			"session-123",
			enrichedParentUpdate.tool_call
		);
	});

	it("applies repeated parent task tool calls when an existing child gets richer payload", () => {
		markHandlerTurnAsStreaming(handler);
		(handler.getEntries as ReturnType<typeof vi.fn>).mockReturnValue([
			createTaskReplayEntry("task-parent-3"),
		]);

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

		expect(handler.createToolCallEntry).toHaveBeenCalledTimes(2);
		expect(handler.createToolCallEntry).toHaveBeenLastCalledWith(
			"session-123",
			enrichedParentUpdate.tool_call
		);
	});

	it("applies repeated tool calls when top-level arguments only change after the preview cutoff", () => {
		markHandlerTurnAsStreaming(handler);
		(handler.getEntries as ReturnType<typeof vi.fn>).mockReturnValue([
			createTaskReplayEntry("tool-long-args-1"),
		]);

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

		expect(handler.createToolCallEntry).toHaveBeenCalledTimes(2);
		expect(handler.createToolCallEntry).toHaveBeenLastCalledWith(
			"session-123",
			enrichedUpdate.tool_call
		);
	});

	it("drops replayed identical pending toolCall events once the tool already exists", () => {
		const liveHandler = createMockHandler();
		const entriesBySession = new Map<string, SessionEntry[]>();
		(liveHandler.getHotState as ReturnType<typeof vi.fn>).mockReturnValue({
			isConnected: true,
			status: "streaming",
			turnState: "streaming",
		});
		(liveHandler.getEntries as ReturnType<typeof vi.fn>).mockImplementation((sessionId: string) => {
			return entriesBySession.get(sessionId) ?? [];
		});
		(liveHandler.createToolCallEntry as ReturnType<typeof vi.fn>).mockImplementation(
			(
				sessionId: string,
				toolCallData: Extract<SessionUpdate, { type: "toolCall" }>["tool_call"]
			) => {
				const nextEntries = entriesBySession.get(sessionId)?.slice() ?? [];
				nextEntries.push({
					id: toolCallData.id,
					type: "tool_call",
					message: toolCallData,
					timestamp: new Date(),
				});
				entriesBySession.set(sessionId, nextEntries);
			}
		);

		const update: SessionUpdate = {
			type: "toolCall",
			session_id: "session-123",
			tool_call: {
				id: "tool-replay-1",
				name: "Run",
				status: "pending",
				kind: "execute",
				arguments: { kind: "execute", command: "git status" },
				title: "Check status",
				awaitingPlanApproval: false,
			},
		};

		service.handleSessionUpdate(update, liveHandler);
		service.handleSessionUpdate(update, liveHandler);

		expect(liveHandler.createToolCallEntry).toHaveBeenCalledTimes(1);
	});
});
