import { describe, expect, it } from "vitest";

import type { ToolCallData } from "../../../services/converted-session-types.js";
import {
	createExecuteCommandIdentityProof,
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

	it("preserves terminal state and structured result when later text-only updates arrive", () => {
		const operationStore = new OperationStore();

		operationStore.upsertFromToolCall("session-1", "tool-1", {
			id: "tool-1",
			name: "bash",
			rawInput: { command: "git status" },
			arguments: { kind: "execute", command: "git status" },
			status: "completed",
			result: { numFiles: 4 },
			kind: "execute",
			title: "`git status`",
			locations: null,
			skillMeta: null,
			normalizedQuestions: null,
			normalizedTodos: null,
			parentToolUseId: null,
			taskChildren: null,
			questionAnswer: null,
			awaitingPlanApproval: false,
			planApprovalRequestId: null,
			progressiveArguments: undefined,
			startedAtMs: 10,
			completedAtMs: 20,
		});

		operationStore.upsertFromToolCallUpdate("session-1", "tool-1", {
			toolCallId: "tool-1",
			status: "pending",
			result: null,
			content: [{ type: "text", text: "text fallback" }],
			rawOutput: null,
			title: null,
			locations: null,
			normalizedTodos: null,
			normalizedQuestions: null,
			streamingArguments: { kind: "execute", command: "git status --short" },
		});

		const operation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(operation?.status).toBe("completed");
		expect(operation?.result).toEqual({ numFiles: 4 });
		expect(operation?.command).toBe("git status --short");
	});

	it("merges sparse edit payloads into richer canonical edit arguments", () => {
		const operationStore = new OperationStore();

		operationStore.upsertFromToolCall("session-1", "tool-1", {
			id: "tool-1",
			name: "Edit",
			rawInput: null,
			arguments: {
				kind: "edit",
				edits: [
					{
						type: "replaceText",
						file_path: "/tmp/example.rs",
						move_from: undefined,
						old_text: "before",
						new_text: "after",
					},
				],
			},
			status: "pending",
			result: null,
			kind: "edit",
			title: "Edit file",
			locations: null,
			skillMeta: null,
			normalizedQuestions: null,
			normalizedTodos: null,
			parentToolUseId: null,
			taskChildren: null,
			questionAnswer: null,
			awaitingPlanApproval: false,
			planApprovalRequestId: null,
			progressiveArguments: undefined,
			startedAtMs: 10,
			completedAtMs: undefined,
		});

		operationStore.upsertFromToolCall("session-1", "tool-1", {
			id: "tool-1",
			name: "Edit",
			rawInput: null,
			arguments: {
				kind: "edit",
				edits: [{ type: "replaceText", file_path: null, old_text: null, new_text: null }],
			},
			status: "completed",
			result: null,
			kind: "edit",
			title: "Edit file",
			locations: null,
			skillMeta: null,
			normalizedQuestions: null,
			normalizedTodos: null,
			parentToolUseId: null,
			taskChildren: null,
			questionAnswer: null,
			awaitingPlanApproval: false,
			planApprovalRequestId: null,
			progressiveArguments: undefined,
			startedAtMs: 10,
			completedAtMs: 20,
		});

		const operation = operationStore.getByToolCallId("session-1", "tool-1");
		expect(operation?.arguments).toEqual({
			kind: "edit",
			edits: [
				{
					type: "replaceText",
					file_path: "/tmp/example.rs",
					move_from: undefined,
					old_text: "before",
					new_text: "after",
				},
			],
		});
		expect(operation?.status).toBe("completed");
	});

	it("indexes canonical execute-command identity when the proof is unique", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);

		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-1", "git status"));

		const commandProof = createExecuteCommandIdentityProof("git status");
		expect(commandProof).not.toBeNull();
		const operation = commandProof
			? operationStore.findByIdentity("session-1", commandProof)
			: null;

		expect(operation?.toolCallId).toBe("tool-1");
		expect(operation?.identity.aliases).toContainEqual({
			kind: "execute-command",
			proof: "canonical-execute-command",
			value: "git status",
		});
	});

	it("fails closed when execute-command identity would be ambiguous", () => {
		const operationStore = new OperationStore();
		const entryStore = new SessionEntryStore(operationStore);

		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-1", "npm test"));
		entryStore.createToolCallEntry("session-1", createExecuteToolCall("tool-2", "npm test"));

		const commandProof = createExecuteCommandIdentityProof("npm test");
		expect(commandProof).not.toBeNull();
		const operation = commandProof
			? operationStore.findByIdentity("session-1", commandProof)
			: null;

		expect(operation).toBeNull();
	});
});
