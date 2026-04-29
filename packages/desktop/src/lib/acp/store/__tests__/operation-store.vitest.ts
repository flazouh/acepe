import { describe, expect, it } from "vitest";

import type { OperationSnapshot } from "../../../services/acp-types.js";
import type { ToolCallData } from "../../../services/converted-session-types.js";
import {
	buildCanonicalOperationId,
	buildOperationId,
	OperationStore,
} from "../operation-store.svelte.js";
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
		const entryStore = new SessionEntryStore(operationStore);

		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-1", "mkdir demo"));

		const createdOperation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(createdOperation).toBeDefined();
		expect(createdOperation?.sessionId).toBe("session-1");
		expect(createdOperation?.toolCallId).toBe("tool-1");
		expect(createdOperation?.kind).toBe("execute");
		expect(createdOperation?.status).toBe("pending");
		expect(createdOperation?.operationState).toBe("pending");
		expect(createdOperation?.operationProvenanceKey).toBe("tool-1");
		expect(createdOperation?.command).toBe("mkdir demo");
		expect(operationStore.getSessionOperations("session-1")).toHaveLength(1);

		entryStore.updateToolCallEntry("session-1", {
			toolCallId: "tool-1",
			status: null,
			result: null,
			content: null,
			rawOutput: null,
			title: null,
			locations: null,
			normalizedTodos: null,
			normalizedQuestions: null,
			streamingArguments: { kind: "execute", command: "mkdir demo && cd demo" },
		});

		const streamingOperation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(streamingOperation?.id).toBe(createdOperation?.id);
		expect(streamingOperation?.command).toBe("mkdir demo && cd demo");
		expect(operationStore.getSessionOperations("session-1")).toHaveLength(1);

		entryStore.updateToolCallEntry("session-1", {
			toolCallId: "tool-1",
			status: "completed",
			result: "done",
			content: null,
			rawOutput: null,
			title: null,
			locations: null,
			normalizedTodos: null,
			normalizedQuestions: null,
			arguments: { kind: "execute", command: "mkdir demo && cd demo" },
		});

		const completedOperation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(completedOperation?.id).toBe(createdOperation?.id);
		expect(completedOperation?.status).toBe("completed");
		expect(completedOperation?.operationState).toBe("completed");
		expect(completedOperation?.result).toBe("done");
		expect(completedOperation?.progressiveArguments).toBeUndefined();
		expect(operationStore.getByEntryId("session-1", "tool-1")?.id).toBe(createdOperation?.id);
	});

	it("preserves parent child relationships for task tool calls", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);

		entryStore.createToolCallEntry("session-1", {
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

	it("does not hydrate canonical operations from preloaded transcript entries", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);

		entryStore.storeEntriesAndBuildIndex("session-1", [
			createToolCallEntry(createExecuteToolCall("tool-1", "git status")),
		]);

		expect(operationStore.getByToolCallId("session-1", "tool-1")).toBeUndefined();
		expect(operationStore.getSessionOperations("session-1")).toHaveLength(0);
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
				provider_status: "pending",
				title: "First",
				arguments: { kind: "execute", command: "pwd" },
				progressive_arguments: null,
				result: null,
				command: "pwd",
				normalized_todos: null,
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
				provider_status: "completed",
				title: "Second",
				arguments: { kind: "execute", command: "ls" },
				progressive_arguments: null,
				result: "done",
				command: "ls",
				normalized_todos: [
					{
						content: "Ship snapshot-backed todo progress",
						status: "in_progress",
						activeForm: "Shipping snapshot-backed todo progress",
					},
				],
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		];

		operationStore.replaceSessionOperations("session-1", snapshots);

		expect(
			operationStore.getSessionOperations("session-1").map((operation) => operation.id)
		).toEqual(["op-1", "op-2"]);
	});

	it("materializes current and last tool-call views from canonical operations", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "completed",
				title: "First",
				arguments: { kind: "execute", command: "pwd" },
				progressive_arguments: null,
				result: "done",
				command: "pwd",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
			{
				id: "op-2",
				session_id: "session-1",
				tool_call_id: "tool-2",
				name: "grep",
				kind: null,
				provider_status: "in_progress",
				title: "Second",
				arguments: { kind: "execute", command: "grep needle" },
				progressive_arguments: null,
				result: null,
				command: null,
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		expect(operationStore.getLastToolCall("session-1")?.id).toBe("tool-2");
		expect(operationStore.getCurrentStreamingToolCall("session-1")?.id).toBe("tool-2");
		expect(operationStore.getCurrentToolKind("session-1")).toBe("other");
	});

	it("materializes normalized results from canonical operations", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "completed",
				title: "Run command",
				arguments: { kind: "execute", command: "printf hello" },
				progressive_arguments: null,
				result: "hello",
				command: "printf hello",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		expect(operationStore.getToolCallById("session-1", "tool-1")?.normalizedResult).toEqual({
			kind: "execute",
			stdout: "hello",
			stderr: null,
			exitCode: undefined,
		});
	});

	it("hydrates canonical normalized todos from operation snapshots", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "TodoWrite",
				kind: null,
				provider_status: "in_progress",
				title: "Todo list",
				arguments: { kind: "other", raw: {} },
				progressive_arguments: null,
				result: null,
				command: null,
				normalized_todos: [
					{
						content: "Audit remaining consumers",
						status: "completed",
						activeForm: "Auditing remaining consumers",
					},
					{
						content: "Migrate queue summaries",
						status: "in_progress",
						activeForm: "Migrating queue summaries",
					},
				],
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		expect(operationStore.getLastTodoToolCall("session-1")?.normalizedTodos).toEqual([
			{
				content: "Audit remaining consumers",
				status: "completed",
				activeForm: "Auditing remaining consumers",
			},
			{
				content: "Migrate queue summaries",
				status: "in_progress",
				activeForm: "Migrating queue summaries",
			},
		]);
	});

	it("maps operation_state and operation_provenance_key from snapshot", () => {
		const operationStore = new OperationStore();
		const snapshots: ReadonlyArray<OperationSnapshot> = [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "completed",
				operation_state: "completed",
				operation_provenance_key: "tool-1",
				title: "First",
				arguments: { kind: "execute", command: "pwd" },
				progressive_arguments: null,
				result: null,
				command: "pwd",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		];
		operationStore.replaceSessionOperations("session-1", snapshots);
		const op = operationStore.getByToolCallId("session-1", "tool-1");
		expect(op?.operationState).toBe("completed");
		expect(op?.operationProvenanceKey).toBe("tool-1");
	});

	it("ignores stale operation patches that would regress terminal state", () => {
		const operationStore = new OperationStore();
		operationStore.applySessionOperationPatches("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "completed",
				operation_state: "completed",
				operation_provenance_key: "tool-1",
				title: "Run command",
				arguments: { kind: "execute", command: "pwd" },
				progressive_arguments: null,
				result: "done",
				command: "pwd",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "in_progress",
				operation_state: "running",
				operation_provenance_key: "tool-1",
				title: "Run command",
				arguments: { kind: "execute", command: "pwd" },
				progressive_arguments: null,
				result: null,
				command: "pwd",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		const operation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(operation?.operationState).toBe("completed");
		expect(operation?.status).toBe("completed");
		expect(operation?.result).toBe("done");
	});

	it("buildCanonicalOperationId produces stable id matching buildOperationId", () => {
		expect(buildCanonicalOperationId("session-1", "tool-abc")).toBe("op:9:session-1:8:tool-abc");
		expect(buildOperationId("session-1", "tool-abc")).toBe("op:9:session-1:8:tool-abc");
		expect(buildCanonicalOperationId("a:b", "c")).not.toBe(buildCanonicalOperationId("a", "b:c"));
	});

	it("upsertFromToolCall does not overwrite canonical blocked state when ToolCall lane fires", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);

		// Canonical patch sets operation to "blocked"
		operationStore.applySessionOperationPatches("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "in_progress",
				operation_state: "blocked",
				operation_provenance_key: "tool-1",
				title: "Run command",
				arguments: { kind: "execute", command: "pwd" },
				progressive_arguments: null,
				result: null,
				command: "pwd",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);

		expect(operationStore.getByToolCallId("session-1", "tool-1")?.operationState).toBe("blocked");

		// ToolCall lane upsert fires with "in_progress" — must not overwrite blocked
		entryStore.updateToolCallEntry("session-1", {
			toolCallId: "tool-1",
			status: "in_progress",
			result: null,
			content: null,
			rawOutput: null,
			title: null,
			locations: null,
			normalizedTodos: null,
			normalizedQuestions: null,
		});

		const operation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(operation?.operationState).toBe("blocked");
	});
});
