import { describe, expect, it } from "vitest";

import type { OperationSnapshot } from "../../../services/acp-types.js";
import type { ToolCallData } from "../../../services/converted-session-types.js";
import { createLongSessionFixture } from "../../testing/long-session-fixture.js";
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

function createOperationSnapshot(overrides?: Partial<OperationSnapshot>): OperationSnapshot {
	return {
		id: overrides?.id ?? "op-1",
		session_id: overrides?.session_id ?? "session-1",
		tool_call_id: overrides?.tool_call_id ?? "tool-1",
		name: overrides?.name ?? "bash",
		kind: overrides?.kind ?? "execute",
		provider_status: overrides?.provider_status ?? "in_progress",
		operation_state: overrides?.operation_state ?? "running",
		source_link: overrides?.source_link ?? {
			kind: "transcript_linked",
			entry_id: "tool-1",
		},
		operation_provenance_key: overrides?.operation_provenance_key ?? "tool-1",
		title: overrides?.title ?? "Run command",
		arguments: overrides?.arguments ?? { kind: "execute", command: "pwd" },
		progressive_arguments: overrides?.progressive_arguments ?? null,
		result: overrides?.result ?? null,
		command: overrides?.command ?? "pwd",
		normalized_todos: overrides?.normalized_todos ?? null,
		parent_tool_call_id: overrides?.parent_tool_call_id ?? null,
		parent_operation_id: overrides?.parent_operation_id ?? null,
		child_tool_call_ids: overrides?.child_tool_call_ids ?? [],
		child_operation_ids: overrides?.child_operation_ids ?? [],
	};
}

describe("OperationStore", () => {
	it("tracks one canonical operation for a streaming tool call lifecycle", () => {
		const operationStore = new OperationStore();

		operationStore.replaceSessionOperations("session-1", [
			createOperationSnapshot({
				id: buildCanonicalOperationId("session-1", "tool-1"),
				tool_call_id: "tool-1",
				provider_status: "pending",
				operation_state: "pending",
				arguments: { kind: "execute", command: "mkdir demo" },
				command: "mkdir demo",
			}),
		]);

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

		operationStore.applySessionOperationPatches("session-1", [
			createOperationSnapshot({
				id: buildCanonicalOperationId("session-1", "tool-1"),
				tool_call_id: "tool-1",
				provider_status: "in_progress",
				operation_state: "running",
				arguments: { kind: "execute", command: "mkdir demo" },
				progressive_arguments: { kind: "execute", command: "mkdir demo && cd demo" },
				command: "mkdir demo && cd demo",
			}),
		]);

		const streamingOperation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(streamingOperation?.id).toBe(createdOperation?.id);
		expect(streamingOperation?.command).toBe("mkdir demo && cd demo");
		expect(operationStore.getSessionOperations("session-1")).toHaveLength(1);

		operationStore.applySessionOperationPatches("session-1", [
			createOperationSnapshot({
				id: buildCanonicalOperationId("session-1", "tool-1"),
				tool_call_id: "tool-1",
				provider_status: "completed",
				operation_state: "completed",
				arguments: { kind: "execute", command: "mkdir demo && cd demo" },
				progressive_arguments: null,
				result: "done",
				command: "mkdir demo && cd demo",
			}),
		]);

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
		const parentId = buildCanonicalOperationId("session-1", "task-parent");
		const childId = buildCanonicalOperationId("session-1", "task-child");

		operationStore.replaceSessionOperations("session-1", [
			createOperationSnapshot({
				id: parentId,
				tool_call_id: "task-parent",
				name: "task",
				kind: "task",
				title: "Task",
				arguments: { kind: "other", raw: {} },
				command: null,
				child_tool_call_ids: ["task-child"],
				child_operation_ids: [childId],
			}),
			createOperationSnapshot({
				id: childId,
				tool_call_id: "task-child",
				arguments: { kind: "execute", command: "go test ./..." },
				command: "go test ./...",
				parent_tool_call_id: "task-parent",
				parent_operation_id: parentId,
				source_link: {
					kind: "synthetic",
					reason: "task_child_operation",
				},
			}),
		]);

		const parent = operationStore.getByToolCallId("session-1", "task-parent");
		const child = operationStore.getByToolCallId("session-1", "task-child");

		expect(parent?.childOperationIds).toEqual(child ? [child.id] : []);
		expect(child?.parentOperationId).toBe(parent?.id);
		expect(child?.command).toBe("go test ./...");
	});

	it("materializes root session tool calls with nested children for operation-backed projections", () => {
		const operationStore = new OperationStore();
		const parentId = buildCanonicalOperationId("session-1", "task-parent");
		const childId = buildCanonicalOperationId("session-1", "task-child");

		operationStore.replaceSessionOperations("session-1", [
			createOperationSnapshot({
				id: parentId,
				tool_call_id: "task-parent",
				name: "task",
				kind: "task",
				provider_status: "completed",
				operation_state: "completed",
				title: "Task",
				arguments: { kind: "other", raw: {} },
				result: null,
				command: null,
				child_tool_call_ids: ["task-child"],
				child_operation_ids: [childId],
			}),
			createOperationSnapshot({
				id: childId,
				tool_call_id: "task-child",
				provider_status: "completed",
				operation_state: "completed",
				arguments: { kind: "execute", command: "go test ./..." },
				command: "go test ./...",
				parent_tool_call_id: "task-parent",
				parent_operation_id: parentId,
				source_link: {
					kind: "synthetic",
					reason: "task_child_operation",
				},
			}),
		]);

		const toolCalls = operationStore.getSessionToolCalls("session-1");

		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0]?.id).toBe("task-parent");
		expect(toolCalls[0]?.taskChildren?.[0]?.id).toBe("task-child");
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
				operation_state: "pending",
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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
				operation_state: "completed",
				source_link: { kind: "transcript_linked", entry_id: "tool-2" },
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
				operation_state: "completed",
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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
				operation_state: "running",
				source_link: { kind: "transcript_linked", entry_id: "tool-2" },
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

	it("resolves the current streaming operation without materializing the full session operation list", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			{
				id: "op-1",
				session_id: "session-1",
				tool_call_id: "tool-1",
				name: "bash",
				kind: "execute",
				provider_status: "completed",
				operation_state: "completed",
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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
				name: "bash",
				kind: "execute",
				provider_status: "in_progress",
				operation_state: "running",
				source_link: { kind: "transcript_linked", entry_id: "tool-2" },
				title: "Second",
				arguments: { kind: "execute", command: "bun test" },
				progressive_arguments: null,
				result: null,
				command: "bun test",
				normalized_todos: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			},
		]);
		operationStore.getSessionOperations = () => {
			throw new Error("current streaming lookup must not materialize every operation");
		};

		expect(operationStore.getCurrentStreamingOperation("session-1")?.id).toBe("op-2");
		expect(operationStore.getCurrentStreamingToolCall("session-1")?.id).toBe("tool-2");
	});

	it("feeds long-session fixture operations into current-streaming lookup without materialization", () => {
		const fixture = createLongSessionFixture({
			scale: "long",
			sessionId: "session-1",
		});
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", fixture.operationSnapshots);
		operationStore.getSessionOperations = () => {
			throw new Error("fixture-backed current streaming lookup must not materialize every operation");
		};

		expect(operationStore.getCurrentStreamingOperation("session-1")?.id).toBe(
			fixture.activeStreamingOperationId
		);
		expect(operationStore.getCurrentStreamingToolCall("session-1")?.id).toBe("active-tool-call");
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
				operation_state: "completed",
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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
				operation_state: "running",
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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
				provider_status: "in_progress",
				operation_state: "blocked",
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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
		expect(op?.operationState).toBe("blocked");
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
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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

	it("applies canonical blocked resume patches because blocked is not terminal", () => {
		const operationStore = new OperationStore();
		operationStore.applySessionOperationPatches("session-1", [
			createOperationSnapshot({
				operation_state: "blocked",
				provider_status: "in_progress",
			}),
			createOperationSnapshot({
				operation_state: "running",
				provider_status: "in_progress",
			}),
		]);
		expect(operationStore.getByToolCallId("session-1", "tool-1")?.operationState).toBe("running");

		operationStore.applySessionOperationPatches("session-1", [
			createOperationSnapshot({
				operation_state: "completed",
				provider_status: "completed",
				result: "done",
			}),
		]);

		const operation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(operation?.operationState).toBe("completed");
		expect(operation?.status).toBe("completed");
		expect(operation?.result).toBe("done");
	});

	it("applies canonical blocked terminal patches after user rejection or degradation", () => {
		const operationStore = new OperationStore();
		operationStore.applySessionOperationPatches("session-1", [
			createOperationSnapshot({
				id: "op-cancelled",
				tool_call_id: "tool-cancelled",
				operation_provenance_key: "tool-cancelled",
				operation_state: "blocked",
			}),
			createOperationSnapshot({
				id: "op-cancelled",
				tool_call_id: "tool-cancelled",
				operation_provenance_key: "tool-cancelled",
				operation_state: "cancelled",
				provider_status: "in_progress",
			}),
			createOperationSnapshot({
				id: "op-degraded",
				tool_call_id: "tool-degraded",
				operation_provenance_key: "tool-degraded",
				operation_state: "blocked",
			}),
			createOperationSnapshot({
				id: "op-degraded",
				tool_call_id: "tool-degraded",
				operation_provenance_key: "tool-degraded",
				operation_state: "degraded",
				provider_status: "failed",
			}),
		]);

		expect(operationStore.getByToolCallId("session-1", "tool-cancelled")?.operationState).toBe(
			"cancelled"
		);
		expect(operationStore.getByToolCallId("session-1", "tool-degraded")?.operationState).toBe(
			"degraded"
		);
	});

	it("keeps blocked operations addressable as the current active operation", () => {
		const operationStore = new OperationStore();
		operationStore.replaceSessionOperations("session-1", [
			createOperationSnapshot({
				operation_state: "blocked",
				provider_status: "in_progress",
			}),
		]);

		expect(operationStore.getCurrentStreamingOperation("session-1")?.id).toBe("op-1");
		expect(operationStore.getCurrentStreamingToolCall("session-1")?.id).toBe("tool-1");
	});

	it("keeps terminal states protected from stale non-terminal operation patches", () => {
		const cases = [
			{
				operationId: "op-completed",
				toolCallId: "tool-completed",
				terminalState: "completed" as const,
				providerStatus: "completed" as const,
			},
			{
				operationId: "op-failed",
				toolCallId: "tool-failed",
				terminalState: "failed" as const,
				providerStatus: "failed" as const,
			},
			{
				operationId: "op-cancelled",
				toolCallId: "tool-cancelled",
				terminalState: "cancelled" as const,
				providerStatus: "in_progress" as const,
			},
			{
				operationId: "op-degraded",
				toolCallId: "tool-degraded",
				terminalState: "degraded" as const,
				providerStatus: "failed" as const,
			},
		];
		const operationStore = new OperationStore();
		for (const testCase of cases) {
			operationStore.applySessionOperationPatches("session-1", [
				createOperationSnapshot({
					id: testCase.operationId,
					tool_call_id: testCase.toolCallId,
					operation_provenance_key: testCase.toolCallId,
					operation_state: testCase.terminalState,
					provider_status: testCase.providerStatus,
				}),
				createOperationSnapshot({
					id: testCase.operationId,
					tool_call_id: testCase.toolCallId,
					operation_provenance_key: testCase.toolCallId,
					operation_state: "running",
					provider_status: "in_progress",
				}),
			]);
		}

		for (const testCase of cases) {
			expect(operationStore.getByToolCallId("session-1", testCase.toolCallId)?.operationState).toBe(
				testCase.terminalState
			);
		}
	});

	it("buildCanonicalOperationId produces stable id matching buildOperationId", () => {
		expect(buildCanonicalOperationId("session-1", "tool-abc")).toBe("op:9:session-1:8:tool-abc");
		expect(buildOperationId("session-1", "tool-abc")).toBe("op:9:session-1:8:tool-abc");
		expect(buildCanonicalOperationId("a:b", "c")).not.toBe(buildCanonicalOperationId("a", "b:c"));
	});

	it("transcript-only tool updates do not overwrite canonical operation state", () => {
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
				source_link: { kind: "transcript_linked", entry_id: "tool-1" },
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

		entryStore.recordToolCallTranscriptEntry(
			"session-1",
			createExecuteToolCall("tool-1", "pwd", { status: "in_progress" })
		);
		entryStore.updateToolCallTranscriptEntry("session-1", {
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
		expect(operationStore.getSessionOperations("session-1")).toHaveLength(1);
	});
});
