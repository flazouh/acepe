import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError, type AppError } from "../../errors/app-error.js";
import { buildAcpPermissionId, type PermissionRequest } from "../../types/permission.js";
import { OperationStore } from "../operation-store.svelte.js";
import { PermissionStore } from "../permission-store.svelte.js";
import { SessionEntryStore } from "../session-entry-store.svelte.js";

function createAcpPermission(
	sessionId: string,
	toolCallId: string,
	jsonRpcRequestId: number
): PermissionRequest {
	return {
		id: buildAcpPermissionId(sessionId, toolCallId, jsonRpcRequestId),
		sessionId,
		jsonRpcRequestId,
		permission: "Execute",
		patterns: [],
		metadata: { options: [] },
		always: [],
		tool: { messageID: "", callID: toolCallId },
	};
}

function createExecutePermissionWithCommand(
	sessionId: string,
	toolCallId: string,
	jsonRpcRequestId: number,
	command: string
): PermissionRequest {
	return {
		id: buildAcpPermissionId(sessionId, toolCallId, jsonRpcRequestId),
		sessionId,
		jsonRpcRequestId,
		permission: "Execute",
		patterns: [],
		metadata: {
			rawInput: { command },
			parsedArguments: { kind: "execute", command },
			options: [],
		},
		always: [],
		tool: { messageID: "", callID: toolCallId },
	};
}

const mockReplyInteraction = vi.fn(
	(_request: Record<string, unknown>): ResultAsync<void, AppError> => okAsync(undefined)
);

vi.mock("../api.js", () => ({
	api: {
		replyInteraction: (request: Record<string, unknown>) => mockReplyInteraction(request),
	},
}));

describe("PermissionStore", () => {
	let store: PermissionStore;

	beforeEach(() => {
		store = new PermissionStore();
		vi.clearAllMocks();
	});

	describe("add", () => {
		it("should add a permission to the pending map", () => {
			const permission: PermissionRequest = {
				id: "perm-1",
				sessionId: "session-1",
				permission: "ReadFile",
				patterns: ["/path/to/file"],
				metadata: {},
				always: [],
			};

			store.add(permission);

			expect(store.pending.size).toBe(1);
			expect(store.pending.get("perm-1")).toEqual(permission);
		});

		it("should add ACP permission without rewriting its canonical id", () => {
			const permission = createAcpPermission("session-2", "tool-2", 123);

			store.add(permission);

			expect(store.pending.get(permission.id)?.jsonRpcRequestId).toBe(123);
		});

		it("should keep multiple ACP permissions for the same tool call", () => {
			const firstPermission = createAcpPermission("session-1", "tool-1", 100);
			const secondPermission = createAcpPermission("session-1", "tool-1", 101);

			store.add(firstPermission);
			store.add(secondPermission);

			expect(store.pending.size).toBe(2);
			expect(store.pending.has(firstPermission.id)).toBe(true);
			expect(store.pending.has(secondPermission.id)).toBe(true);
		});

		it("should resolve permission by session-scoped tool call id", () => {
			store.add(createAcpPermission("session-1", "tool-1", 100));
			store.add(createAcpPermission("session-1", "tool-1", 101));

			const permission = store.getForToolCall("session-1", "tool-1");

			expect(permission?.jsonRpcRequestId).toBe(101);
			expect(permission?.id).toBe(buildAcpPermissionId("session-1", "tool-1", 101));
		});

		it("should isolate permissions with the same tool call id across sessions", () => {
			const sessionOnePermission = createAcpPermission("session-1", "tool-1", 100);
			const sessionTwoPermission = createAcpPermission("session-2", "tool-1", 100);

			store.add(sessionOnePermission);
			store.add(sessionTwoPermission);

			expect(store.getForToolCall("session-1", "tool-1")?.id).toBe(sessionOnePermission.id);
			expect(store.getForToolCall("session-2", "tool-1")?.id).toBe(sessionTwoPermission.id);
		});

		it("should prefer the highest jsonRpcRequestId for same-session ACP siblings", () => {
			const newerPermission = createAcpPermission("session-1", "tool-1", 101);
			const olderPermission = createAcpPermission("session-1", "tool-1", 100);

			store.add(newerPermission);
			store.add(olderPermission);

			const permission = store.getForToolCall("session-1", "tool-1");

			expect(permission?.id).toBe(olderPermission.id);
			expect(permission?.jsonRpcRequestId).toBe(100);
		});

		it("matches execute permissions by command when the permission anchor id differs", () => {
			const permission = createExecutePermissionWithCommand(
				"session-1",
				"shell-permission",
				101,
				"git status"
			);

			store.add(permission);

			const matched = store.getForToolCall("session-1", {
				id: "tool-1",
				name: "Run",
				arguments: { kind: "execute", command: "git status" },
				status: "pending",
				result: null,
				kind: "execute",
				title: "Running command",
				locations: null,
				skillMeta: null,
				normalizedQuestions: null,
				normalizedTodos: null,
				parentToolUseId: null,
				taskChildren: null,
				questionAnswer: null,
				awaitingPlanApproval: false,
				planApprovalRequestId: null,
			});

			expect(matched?.id).toBe(permission.id);
			expect(matched?.tool?.callID).toBe("shell-permission");
		});

		it("returns the latest pending permission for a canonical operation", () => {
			const operationStore = new OperationStore();
			const entryStore = new SessionEntryStore(operationStore);
			entryStore.createToolCallEntry("session-1", {
				id: "tool-1",
				name: "bash",
				arguments: { kind: "execute", command: "git status" },
				status: "pending",
				result: null,
				kind: "execute",
				title: "Run command",
				locations: null,
				skillMeta: null,
				awaitingPlanApproval: false,
			});
			const operation = operationStore.getByToolCallId("session-1", "tool-1");
			store.add(createExecutePermissionWithCommand("session-1", "shell-permission", 100, "git status"));
			store.add(createExecutePermissionWithCommand("session-1", "shell-permission", 101, "git status"));

			const matched = operation ? store.getForOperation(operation, operationStore) : undefined;

			expect(matched?.jsonRpcRequestId).toBe(101);
		});

		it("fails closed when multiple execute operations share the same command", () => {
			const operationStore = new OperationStore();
			const entryStore = new SessionEntryStore(operationStore);
			entryStore.createToolCallEntry("session-1", {
				id: "tool-1",
				name: "bash",
				arguments: { kind: "execute", command: "git status" },
				status: "pending",
				result: null,
				kind: "execute",
				title: "Run command",
				locations: null,
				skillMeta: null,
				awaitingPlanApproval: false,
			});
			entryStore.createToolCallEntry("session-1", {
				id: "tool-2",
				name: "bash",
				arguments: { kind: "execute", command: "git status" },
				status: "pending",
				result: null,
				kind: "execute",
				title: "Run command",
				locations: null,
				skillMeta: null,
				awaitingPlanApproval: false,
			});
			store.add(createExecutePermissionWithCommand("session-1", "shell-permission", 101, "git status"));

			const firstOperation = operationStore.getByToolCallId("session-1", "tool-1");
			const secondOperation = operationStore.getByToolCallId("session-1", "tool-2");

			expect(firstOperation ? store.getForOperation(firstOperation, operationStore) : undefined).toBeUndefined();
			expect(
				secondOperation ? store.getForOperation(secondOperation, operationStore) : undefined
			).toBeUndefined();
		});
	});

	describe("remove", () => {
		it("should remove a permission from the pending map", () => {
			const permission: PermissionRequest = {
				id: "perm-1",
				sessionId: "session-1",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			};

			store.add(permission);
			expect(store.pending.size).toBe(1);

			store.remove("perm-1");
			expect(store.pending.size).toBe(0);
		});
	});

	describe("removeForSession", () => {
		it("should remove all permissions for a specific session", () => {
			store.add({
				id: "perm-1",
				sessionId: "session-1",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			});
			store.add({
				id: "perm-2",
				sessionId: "session-1",
				permission: "WriteFile",
				patterns: [],
				metadata: {},
				always: [],
			});
			store.add({
				id: "perm-3",
				sessionId: "session-2",
				permission: "Bash",
				patterns: [],
				metadata: {},
				always: [],
			});

			expect(store.pending.size).toBe(3);

			store.removeForSession("session-1");

			expect(store.pending.size).toBe(1);
			expect(store.pending.has("perm-3")).toBe(true);
		});

		it("should clear queued session progress when a session is removed", () => {
			store.add(createAcpPermission("session-1", "tool-1", 100));
			store.add(createAcpPermission("session-1", "tool-2", 101));

			expect(store.getSessionProgress("session-1")).toEqual({ total: 2, completed: 0 });

			store.removeForSession("session-1");

			expect(store.getSessionProgress("session-1")).toBeNull();
		});
	});

	describe("cancelForSession", () => {
		it("rejects all pending permissions for the matching session", async () => {
			const sessionOneFirst = createAcpPermission("session-1", "tool-1", 100);
			const sessionOneSecond = createAcpPermission("session-1", "tool-2", 101);
			const sessionTwoPermission = createAcpPermission("session-2", "tool-3", 102);

			store.add(sessionOneFirst);
			store.add(sessionOneSecond);
			store.add(sessionTwoPermission);

			const result = await store.cancelForSession("session-1");

			expect(result.isOk()).toBe(true);
			expect(store.pending.has(sessionOneFirst.id)).toBe(false);
			expect(store.pending.has(sessionOneSecond.id)).toBe(false);
			expect(store.pending.has(sessionTwoPermission.id)).toBe(true);
		});
	});

	describe("auto-accept", () => {
		it("should add normally when no auto-accept is configured", () => {
			const permission: PermissionRequest = {
				id: "perm-1",
				sessionId: "child-session",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			};

			store.add(permission);

			expect(store.pending.size).toBe(1);
			expect(store.pending.get("perm-1")).toEqual(permission);
		});

		it("should add normally when predicate returns false", () => {
			store.setAutoAccept(() => false);

			const permission: PermissionRequest = {
				id: "perm-1",
				sessionId: "root-session",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			};

			store.add(permission);

			expect(store.pending.size).toBe(1);
		});

		it("should auto-accept and remove from pending (ACP mode)", async () => {
			store.setAutoAccept((p) => p.sessionId === "child-session");

			const permission = createAcpPermission("child-session", "tool-child", 200);

			store.add(permission);

			expect(store.pending.size).toBe(0);
			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "child-session",
				interactionId: permission.id,
				replyHandler: {
					kind: "json-rpc",
					requestId: 200,
				},
				payload: {
					kind: "permission",
					reply: "once",
					optionId: "allow",
				},
			});
		});

		it("should auto-accept and remove from pending (OpenCode HTTP mode)", () => {
			store.setAutoAccept((p) => p.sessionId === "child-session");

			const permission: PermissionRequest = {
				id: "perm-child-http",
				sessionId: "child-session",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			};

			store.add(permission);

			expect(store.pending.size).toBe(0);
			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "child-session",
				interactionId: "perm-child-http",
				replyHandler: {
					kind: "http",
					requestId: "perm-child-http",
				},
				payload: {
					kind: "permission",
					reply: "once",
					optionId: "allow",
				},
			});
		});

		it("should resolve allow_once optionId from options when auto-accepting", async () => {
			store.setAutoAccept(() => true);

			const permission: PermissionRequest = {
				id: buildAcpPermissionId("child-session", "tool-opts", 300),
				sessionId: "child-session",
				jsonRpcRequestId: 300,
				permission: "Bash",
				patterns: [],
				metadata: {
					options: [
						{ kind: "allow_once", optionId: "custom_allow", name: "Allow" },
						{ kind: "reject_once", optionId: "custom_reject", name: "Reject" },
					],
				},
				always: [],
				tool: { messageID: "", callID: "tool-opts" },
			};

			store.add(permission);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "child-session",
				interactionId: permission.id,
				replyHandler: {
					kind: "json-rpc",
					requestId: 300,
				},
				payload: {
					kind: "permission",
					reply: "once",
					optionId: "custom_allow",
				},
			});
		});

		it("should stop auto-accepting after dispose is called", () => {
			const dispose = store.setAutoAccept(() => true);

			dispose();

			const permission: PermissionRequest = {
				id: "perm-1",
				sessionId: "child-session",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			};

			store.add(permission);

			expect(store.pending.size).toBe(1);
		});

		it("does not auto-accept exit-plan approvals even when autonomous auto-accept is enabled", async () => {
			store.setAutoAccept(() => "autonomous-live");

			const permission: PermissionRequest = {
				id: buildAcpPermissionId("session-plan", "tool-plan", 901),
				sessionId: "session-plan",
				jsonRpcRequestId: 901,
				permission: "Plan",
				patterns: [],
				metadata: {
					rawInput: {
						plan: "# Plan\n\n- [ ] Ship the fix",
						planFilePath: "docs/plans/example.md",
					},
					parsedArguments: {
						kind: "planMode",
						mode: "default",
					},
					options: [{ kind: "allow_once", optionId: "allow", name: "Allow" }],
				},
				always: [],
				tool: { messageID: "", callID: "tool-plan" },
			};

			store.add(permission);

			expect(store.pending.get(permission.id)).toEqual(permission);
			expect(mockReplyInteraction).not.toHaveBeenCalled();
		});
	});

	describe("reply", () => {
		it("should use HTTP endpoint for permissions without jsonRpcRequestId", async () => {
			const permission: PermissionRequest = {
				id: "perm-http",
				sessionId: "session-http",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
				// No jsonRpcRequestId - this is OpenCode HTTP mode
			};

			store.add(permission);
			await store.reply("perm-http", "once");

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-http",
				interactionId: "perm-http",
				replyHandler: {
					kind: "http",
					requestId: "perm-http",
				},
				payload: {
					kind: "permission",
					reply: "once",
					optionId: "allow",
				},
			});
			expect(store.pending.size).toBe(0);
		});

		it("should use JSON-RPC response for permissions with jsonRpcRequestId", async () => {
			const permission = createAcpPermission("session-jsonrpc", "tool-jsonrpc", 456);

			store.add(permission);
			await store.reply(permission.id, "once");

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-jsonrpc",
				interactionId: permission.id,
				replyHandler: {
					kind: "json-rpc",
					requestId: 456,
				},
				payload: {
					kind: "permission",
					reply: "once",
					optionId: "allow",
				},
			});
			expect(store.pending.size).toBe(0);
		});

		it("should send allow_always optionId for 'always' reply", async () => {
			const permission: PermissionRequest = {
				id: buildAcpPermissionId("session-always", "tool-always", 789),
				sessionId: "session-always",
				jsonRpcRequestId: 789,
				permission: "Bash",
				patterns: [],
				metadata: { options: [] },
				always: ["allow_always"],
				tool: { messageID: "", callID: "tool-always" },
			};

			store.add(permission);
			await store.reply(permission.id, "always");

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-always",
				interactionId: permission.id,
				replyHandler: {
					kind: "json-rpc",
					requestId: 789,
				},
				payload: {
					kind: "permission",
					reply: "always",
					optionId: "allow_always",
				},
			});
		});

		it("should send reject optionId and allowed=false for 'reject' reply", async () => {
			const permission = createAcpPermission("session-reject", "tool-reject", 101);

			store.add(permission);
			await store.reply(permission.id, "reject");

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-reject",
				interactionId: permission.id,
				replyHandler: {
					kind: "json-rpc",
					requestId: 101,
				},
				payload: {
					kind: "permission",
					reply: "reject",
					optionId: "reject",
				},
			});
		});

		it("should return error for non-existent permission", async () => {
			const result = await store.reply("non-existent", "once");

			expect(result.isErr()).toBe(true);
		});

		it("reinserts a permission when replying via HTTP fails", async () => {
			mockReplyInteraction.mockReturnValueOnce(
				errAsync(new AgentError("replyPermission", new Error("network failed")))
			);

			const permission: PermissionRequest = {
				id: "perm-http-failure",
				sessionId: "session-http",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			};

			store.add(permission);
			const result = await store.reply(permission.id, "once");

			expect(result.isErr()).toBe(true);
			expect(store.pending.get(permission.id)).toEqual(permission);
		});

			it("should keep session batch progress while later permissions remain pending", async () => {
				const firstPermission = createAcpPermission("session-batch", "tool-1", 100);
				const secondPermission = createAcpPermission("session-batch", "tool-2", 101);

				store.add(firstPermission);
				store.add(secondPermission);

				expect(store.getForSession("session-batch").map((permission) => permission.id)).toEqual([
					firstPermission.id,
					secondPermission.id,
				]);
				expect(store.getSessionProgress("session-batch")).toEqual({ total: 2, completed: 0 });

				await store.reply(firstPermission.id, "once");

				expect(store.getForSession("session-batch").map((permission) => permission.id)).toEqual([
					secondPermission.id,
				]);
				expect(store.getSessionProgress("session-batch")).toEqual({ total: 2, completed: 1 });
			});
	});

	describe("drainPendingForSession", () => {
		it("drains only the matching session after Autonomous is enabled", async () => {
			const firstPermission = createAcpPermission("session-1", "tool-1", 100);
			const secondPermission = createAcpPermission("session-1", "tool-2", 101);
			const otherSessionPermission = createAcpPermission("session-2", "tool-3", 102);

			store.add(firstPermission);
			store.add(secondPermission);
			store.add(otherSessionPermission);

			const result = await store.drainPendingForSession("session-1");
			result._unsafeUnwrap();

			expect(store.pending.has(otherSessionPermission.id)).toBe(true);
			expect(store.pending.has(firstPermission.id)).toBe(false);
			expect(store.pending.has(secondPermission.id)).toBe(false);
		});

		it("skips permissions that were already resolved before drain runs", async () => {
			const permission = createAcpPermission("session-1", "tool-1", 100);

			store.add(permission);
			store.remove(permission.id);

			const result = await store.drainPendingForSession("session-1");
			result._unsafeUnwrap();

			expect(mockReplyInteraction).not.toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: "session-1",
					interactionId: permission.id,
				})
			);
		});
	});
});
