import { mock } from "bun:test";
import { describe, expect, it, vi } from "vitest";

mock.module("$lib/analytics.js", () => ({
	captureException: vi.fn(),
	captureContractViolation: vi.fn(),
	initAnalytics: vi.fn(),
	setAnalyticsEnabled: vi.fn(),
}));
mock.module("../../../analytics.js", () => ({
	captureException: vi.fn(),
	captureContractViolation: vi.fn(),
	initAnalytics: vi.fn(),
	setAnalyticsEnabled: vi.fn(),
}));
mock.module("@sentry/browser", () => ({
	captureException: vi.fn(),
	init: vi.fn(),
}));
mock.module("posthog-js", () => ({
	default: {
		init: vi.fn(),
		capture: vi.fn(),
		identify: vi.fn(),
		reset: vi.fn(),
	},
}));

import type { OperationSnapshot } from "../../../services/acp-types.js";
import type { ToolCallData } from "../../../services/converted-session-types.js";
import { OperationStore } from "../operation-store.svelte.js";
import { SessionEntryStore } from "../session-entry-store.svelte.js";

function createExecuteToolCall(
	id: string,
	command: string,
	overrides?: Partial<ToolCallData>
): ToolCallData {
	return {
		id: overrides?.id ?? id,
		name: overrides?.name ?? "bash",
		arguments: overrides?.arguments ?? { kind: "execute", command },
		status: overrides?.status ?? "pending",
		result: overrides?.result ?? null,
		kind: overrides?.kind ?? "execute",
		title: overrides?.title ?? "Run command",
		locations: overrides?.locations ?? null,
		skillMeta: overrides?.skillMeta ?? null,
		awaitingPlanApproval: overrides?.awaitingPlanApproval ?? false,
		parentToolUseId: overrides?.parentToolUseId,
		taskChildren: overrides?.taskChildren,
		normalizedQuestions: overrides?.normalizedQuestions,
		normalizedTodos: overrides?.normalizedTodos,
		planApprovalRequestId: overrides?.planApprovalRequestId,
		questionAnswer: overrides?.questionAnswer,
	};
}

function createToolCallEntry(toolCall: ToolCallData) {
	return {
		id: `entry-${toolCall.id}`,
		type: "tool_call" as const,
		message: toolCall,
		timestamp: new Date(),
	};
}

describe("OperationStore", () => {
	it("tracks one canonical operation for a streaming tool call lifecycle", () => {
		const operationStore = new OperationStore();

		operationStore.upsertFromToolCall(
			"session-1",
			"entry-tool-1",
			createExecuteToolCall("tool-1", "mkdir demo")
		);

		const createdOperation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(createdOperation).toBeDefined();
		expect(createdOperation?.sessionId).toBe("session-1");
		expect(createdOperation?.toolCallId).toBe("tool-1");
		expect(createdOperation?.kind).toBe("execute");
		expect(createdOperation?.status).toBe("pending");
		expect(createdOperation?.lifecycle).toBe("pending");
		expect(createdOperation?.command).toBe("mkdir demo");
		expect(operationStore.getSessionOperations("session-1")).toHaveLength(1);

		operationStore.upsertOperationSnapshot({
			id: createdOperation?.id ?? "session-1:tool-1",
			session_id: "session-1",
			tool_call_id: "tool-1",
			name: "bash",
			kind: "execute",
			status: "pending",
			lifecycle: "pending",
			blocked_reason: null,
			title: "Run command",
			arguments: { kind: "execute", command: "mkdir demo" },
			progressive_arguments: { kind: "execute", command: "mkdir demo && cd demo" },
			result: null,
			command: "mkdir demo && cd demo",
			locations: null,
			skill_meta: null,
			normalized_todos: null,
			started_at_ms: null,
			completed_at_ms: null,
			parent_tool_call_id: null,
			parent_operation_id: null,
			child_tool_call_ids: [],
			child_operation_ids: [],
		});

		const streamingOperation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(streamingOperation?.id).toBe(createdOperation?.id);
		expect(streamingOperation?.command).toBe("mkdir demo && cd demo");
		expect(operationStore.getSessionOperations("session-1")).toHaveLength(1);

		operationStore.upsertOperationSnapshot({
			id: createdOperation?.id ?? "session-1:tool-1",
			session_id: "session-1",
			tool_call_id: "tool-1",
			name: "bash",
			kind: "execute",
			status: "completed",
			lifecycle: "completed",
			blocked_reason: null,
			title: "Run command",
			arguments: { kind: "execute", command: "mkdir demo && cd demo" },
			progressive_arguments: null,
			result: "done",
			command: "mkdir demo && cd demo",
			locations: null,
			skill_meta: null,
			normalized_todos: null,
			started_at_ms: 1,
			completed_at_ms: 2,
			parent_tool_call_id: null,
			parent_operation_id: null,
			child_tool_call_ids: [],
			child_operation_ids: [],
		});

		const completedOperation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(completedOperation?.id).toBe(createdOperation?.id);
		expect(completedOperation?.status).toBe("completed");
		expect(completedOperation?.lifecycle).toBe("completed");
		expect(completedOperation?.result).toBe("done");
		expect(completedOperation?.progressiveArguments).toBeUndefined();
		expect(operationStore.getByEntryId("session-1", "entry-tool-1")?.id).toBe(createdOperation?.id);
	});

	it("preserves parent child relationships for task tool calls", () => {
		const operationStore = new OperationStore();

		operationStore.upsertFromToolCall("session-1", "entry-task-parent", {
			id: "task-parent",
			name: "task",
			arguments: { kind: "other", raw: {} },
			status: "pending",
			result: null,
			kind: "task",
			title: "Task",
			locations: null,
			skillMeta: null,
			awaitingPlanApproval: false,
			taskChildren: [
				createExecuteToolCall("task-child", "go test ./...", {
					parentToolUseId: "task-parent",
				}),
			],
		});

		const parent = operationStore.getByToolCallId("session-1", "task-parent");
		const child = operationStore.getByToolCallId("session-1", "task-child");

		expect(parent?.childOperationIds).toEqual(child ? [child.id] : []);
		expect(child?.parentOperationId).toBe(parent?.id);
		expect(child?.command).toBe("go test ./...");
	});

	it("hydrates canonical operations when preloaded entries are stored", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);

		entryStore.storeEntriesAndBuildIndex("session-1", [
			createToolCallEntry(createExecuteToolCall("tool-1", "git status")),
		]);

		const operation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(operation).toBeDefined();
		expect(operation?.sourceEntryId).toBe("entry-tool-1");
		expect(operation?.command).toBe("git status");
	});

	it("replaces snapshot operations in insertion order", () => {
		const operationStore = new OperationStore();
		const snapshots: ReadonlyArray<OperationSnapshot> = [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "bash",
				kind: "execute",
				status: "pending",
				lifecycle: "blocked",
				blocked_reason: "permission",
				title: "First",
				arguments: { kind: "execute", command: "pwd" },
				progressive_arguments: null,
				result: null,
				command: "pwd",
				locations: [{ path: "/tmp/one.ts" }],
				skill_meta: { description: "Run a command", filePath: null },
				normalized_todos: [
					{
						content: "Do thing",
						activeForm: "Do thing",
						status: "pending",
						startedAt: null,
						completedAt: null,
						duration: null,
					},
				],
				started_at_ms: 100,
				completed_at_ms: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
			{
				id: "op-2",
				session_id: "session-1",
				tool_call_id: "tool-2",
				name: "bash",
				kind: "execute",
				status: "completed",
				lifecycle: "completed",
				blocked_reason: null,
				title: "Second",
				arguments: { kind: "execute", command: "ls" },
				progressive_arguments: null,
				result: "done",
				command: "ls",
				locations: null,
				skill_meta: null,
				normalized_todos: null,
				started_at_ms: 200,
				completed_at_ms: 250,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		];

		operationStore.replaceSessionOperations("session-1", snapshots);

		expect(operationStore.getSessionOperations("session-1").map((operation) => operation.id)).toEqual([
			"op-1",
			"op-2",
		]);
		expect(operationStore.getById("op-1")).toMatchObject({
			lifecycle: "blocked",
			blockedReason: "permission",
			locations: [{ path: "/tmp/one.ts" }],
			skillMeta: { description: "Run a command", filePath: null },
			normalizedTodos: [
				{
					content: "Do thing",
					activeForm: "Do thing",
					status: "pending",
					startedAt: null,
					completedAt: null,
					duration: null,
				},
			],
			startedAtMs: 100,
		});
	});

	it("preserves richer operation evidence when a later snapshot is thinner", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "Read",
				kind: "read",
				status: "pending",
				lifecycle: "blocked",
				blocked_reason: "permission",
				title: "Read /tmp/example.txt",
				arguments: { kind: "read", file_path: "/tmp/example.txt", source_context: null },
				progressive_arguments: null,
				result: null,
				command: null,
				locations: [{ path: "/tmp/example.txt" }],
				skill_meta: null,
				normalized_todos: null,
				started_at_ms: 10,
				completed_at_ms: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "Read",
				kind: "read",
				status: "pending",
				lifecycle: "blocked",
				blocked_reason: "permission",
				title: "Read",
				arguments: { kind: "read", file_path: null, source_context: null },
				progressive_arguments: null,
				result: null,
				command: null,
				locations: null,
				skill_meta: null,
				normalized_todos: null,
				started_at_ms: null,
				completed_at_ms: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		expect(operationStore.getById("op-1")).toMatchObject({
			title: "Read /tmp/example.txt",
			arguments: { kind: "read", file_path: "/tmp/example.txt", source_context: null },
			locations: [{ path: "/tmp/example.txt" }],
			startedAtMs: 10,
			blockedReason: "permission",
		});
	});
});
