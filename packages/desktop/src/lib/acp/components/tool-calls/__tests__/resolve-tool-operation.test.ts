import { describe, expect, it } from "bun:test";
import type { OperationStore } from "../../../store/operation-store.svelte.js";
import type { PermissionRequest } from "../../../types/permission.js";
import type { Operation } from "../../../types/operation.js";
import type { ToolCall } from "../../../types/tool-call.js";
import { createRenderableToolCall, resolveToolOperation } from "../resolve-tool-operation.js";

function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
	const base: ToolCall = {
		id: "tool-1",
		name: "Bash",
		arguments: { kind: "execute", command: null },
		status: "pending",
		result: null,
		kind: "execute",
		title: "Bash",
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		parentToolUseId: null,
		taskChildren: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
		startedAtMs: 1,
		completedAtMs: undefined,
	};

	if (!overrides) {
		return base;
	}

	return Object.assign({}, base, overrides);
}

function createPermission(overrides?: Partial<PermissionRequest>): PermissionRequest {
	const base: PermissionRequest = {
		id: "perm-1",
		sessionId: "session-1",
		permission: "execute",
		patterns: [],
		metadata: {
			rawInput: { command: "git status" },
			parsedArguments: { kind: "execute", command: "git status" },
			options: [],
		},
		always: [],
		tool: {
			messageID: "message-1",
			callID: "tool-1",
		},
	};

	if (!overrides) {
		return base;
	}

	return Object.assign({}, base, overrides);
}

function createOperation(overrides?: Partial<Operation>): Operation {
	return {
		id: "op-1",
		sessionId: "session-1",
		toolCallId: "tool-1",
		sourceEntryId: "entry-1",
		name: "Task",
		kind: "task",
		status: "completed",
		lifecycle: "completed",
		blockedReason: null,
		title: "Task",
		arguments: { kind: "other", raw: { description: "Investigate" } },
		progressiveArguments: undefined,
		result: null,
		locations: null,
		skillMeta: null,
		normalizedQuestions: null,
		normalizedTodos: null,
		questionAnswer: null,
		awaitingPlanApproval: false,
		planApprovalRequestId: null,
		startedAtMs: 10,
		completedAtMs: 20,
		command: null,
		parentToolCallId: null,
		parentOperationId: null,
		childToolCallIds: [],
		childOperationIds: [],
		...overrides,
	};
}

function createOperationLookup(
	operations: Operation[]
): Pick<OperationStore, "getById" | "getByToolCallId" | "isBlockedByPermission"> {
	const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
	const operationsByToolCallId = new Map(
		operations.map((operation) => [`${operation.sessionId}:${operation.toolCallId}`, operation])
	);

	return {
		getById(id: string) {
			return operationsById.get(id);
		},
		getByToolCallId(sessionId: string, toolCallId: string) {
			return operationsByToolCallId.get(`${sessionId}:${toolCallId}`);
		},
		isBlockedByPermission(operation: Operation) {
			return operation.lifecycle === "blocked" && operation.blockedReason === "permission";
		},
	};
}

describe("resolveToolOperation", () => {
	it("keeps canonical tool arguments and shows inline approval", () => {
		const operation = createOperation({
			kind: "execute",
			status: "pending",
			lifecycle: "blocked",
			blockedReason: "permission",
			arguments: { kind: "execute", command: "git status" },
		});
		const operationLookup = createOperationLookup([operation]);
		const resolved = resolveToolOperation(
			createToolCall(),
			createPermission(),
			operation,
			operationLookup
		);

		expect(resolved.toolCall.arguments).toEqual({ kind: "execute", command: null });
		expect(resolved.routeKey).toBe("execute");
		expect(resolved.shouldShowInlinePermissionActionBar).toBe(true);
	});

	it("routes read lints tool calls to the read-lints component key", () => {
		const resolved = resolveToolOperation(
			createToolCall({
				name: "read_lints",
				kind: "read",
				arguments: { kind: "read", file_path: "/tmp/lints.txt" },
				title: "Read Lints",
			}),
			null
		);

		expect(resolved.routeKey).toBe("read_lints");
		expect(resolved.resolvedKind).toBe("read");
	});

	it("keeps exit-plan approvals out of the generic inline action bar", () => {
		const operation = createOperation({
			name: "ExitPlanMode",
			kind: "exit_plan_mode",
			lifecycle: "blocked",
			blockedReason: "permission",
			arguments: { kind: "planMode", mode: "build" },
		});
		const resolved = resolveToolOperation(
			createToolCall({
				name: "ExitPlanMode",
				arguments: { kind: "planMode", mode: "build" },
				kind: "exit_plan_mode",
			}),
			createPermission({
				permission: "exit_plan_mode",
				metadata: {
					rawInput: { mode: "build" },
					parsedArguments: { kind: "planMode", mode: "build" },
					options: [],
				},
			}),
			operation,
			createOperationLookup([operation])
		);

		expect(resolved.routeKey).toBe("exit_plan_mode");
		expect(resolved.shouldShowInlinePermissionActionBar).toBe(false);
	});

	it("keeps inline approval visible during the raw-permission before blocked-lifecycle gap", () => {
		const operation = createOperation({
			kind: "execute",
			status: "pending",
			lifecycle: "pending",
			blockedReason: null,
			arguments: { kind: "execute", command: null },
		});
		const resolved = resolveToolOperation(
			createToolCall(),
			createPermission(),
			operation,
			createOperationLookup([operation])
		);

		expect(resolved.shouldShowInlinePermissionActionBar).toBe(true);
	});

	it("prefers canonical operation data over transcript fallback rows", () => {
		const childOperation = createOperation({
			id: "op-2",
			toolCallId: "child-tool",
			name: "Bash",
			kind: "execute",
			title: "Bash",
			arguments: { kind: "execute", command: "git status" },
			result: "ok",
		});
		const parentOperation = createOperation({
			childOperationIds: ["op-2"],
			childToolCallIds: ["child-tool"],
		});
		const renderable = createRenderableToolCall(
			createToolCall({
				name: "apply_patch",
				kind: "other",
				title: "apply_patch",
				arguments: { kind: "other", raw: "raw transcript tool row" },
			}),
			parentOperation,
			createOperationLookup([parentOperation, childOperation])
		);

		expect(renderable.name).toBe("Task");
		expect(renderable.kind).toBe("task");
		expect(renderable.title).toBe("Task");
		expect(renderable.taskChildren).toHaveLength(1);
		expect(renderable.taskChildren?.[0]?.name).toBe("Bash");
		expect(renderable.taskChildren?.[0]?.arguments).toEqual({
			kind: "execute",
			command: "git status",
		});
	});

	it("uses the canonical display title synthesized from operation evidence", () => {
		const operation = createOperation({
			name: "Read",
			kind: "read",
			title: "Read",
			arguments: { kind: "read", file_path: "/tmp/example.txt", source_context: null },
		});

		const renderable = createRenderableToolCall(
			createToolCall({
				name: "Read",
				kind: "read",
				title: "Read",
				arguments: { kind: "read", file_path: null, source_context: null },
			}),
			operation,
			createOperationLookup([operation])
		);

		expect(renderable.title).toBe("Read /tmp/example.txt");
	});
});
