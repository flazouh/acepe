import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAcpPermissionId, type PermissionRequest } from "../../types/permission.js";

import { PermissionStore } from "../permission-store.svelte.js";

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

/** Builds a chainable mock matching the ResultAsync interface subset used by PermissionStore. */
function mockResultAsync() {
	const terminal = { map: vi.fn(), mapErr: vi.fn(), match: vi.fn((ok: () => void) => ok()) };
	return {
		map: vi.fn((fn: () => void) => {
			fn();
			return { mapErr: vi.fn(() => terminal), match: vi.fn((ok: () => void) => ok()) };
		}),
		mapErr: vi.fn(() => ({
			map: vi.fn((fn: () => void) => {
				fn();
				return { mapErr: vi.fn(), match: vi.fn((ok: () => void) => ok()) };
			}),
			match: vi.fn((ok: () => void) => ok()),
		})),
		match: vi.fn((ok: () => void) => ok()),
	};
}

// Mock the API module
const mockReplyPermission = vi.fn((..._args: [string, string, "once" | "always" | "reject"]) =>
	mockResultAsync()
);

const mockRespondInboundRequest = vi.fn((_sessionId: string, _requestId: number, _result: object) =>
	mockResultAsync()
);

vi.mock("../api.js", () => ({
	api: {
		replyPermission: (
			sessionId: string,
			permissionId: string,
			reply: "once" | "always" | "reject"
		) => mockReplyPermission(sessionId, permissionId, reply),
		respondInboundRequest: (sessionId: string, requestId: number, result: object) =>
			mockRespondInboundRequest(sessionId, requestId, result),
	},
}));

// Mock the inbound request handler's respondToPermission
vi.mock("../../logic/inbound-request-handler.js", () => ({
	respondToPermission: vi.fn(
		(_sessionId: string, _requestId: number, _allowed: boolean, _optionId: string) =>
			mockResultAsync()
	),
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

			expect(permission?.id).toBe(newerPermission.id);
			expect(permission?.jsonRpcRequestId).toBe(101);
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
			const { respondToPermission } = await import("../../logic/inbound-request-handler.js");

			store.setAutoAccept((p) => p.sessionId === "child-session");

			const permission = createAcpPermission("child-session", "tool-child", 200);

			store.add(permission);

			expect(store.pending.size).toBe(0);
			expect(respondToPermission).toHaveBeenCalledWith("child-session", 200, true, "allow");
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
			expect(mockReplyPermission).toHaveBeenCalledWith("child-session", "perm-child-http", "once");
		});

		it("should resolve allow_once optionId from options when auto-accepting", async () => {
			const { respondToPermission } = await import("../../logic/inbound-request-handler.js");

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

			expect(respondToPermission).toHaveBeenCalledWith("child-session", 300, true, "custom_allow");
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

			expect(mockReplyPermission).toHaveBeenCalledWith("session-http", "perm-http", "once");
			expect(store.pending.size).toBe(0);
		});

		it("should use JSON-RPC response for permissions with jsonRpcRequestId", async () => {
			const { respondToPermission } = await import("../../logic/inbound-request-handler.js");

			const permission = createAcpPermission("session-jsonrpc", "tool-jsonrpc", 456);

			store.add(permission);
			await store.reply(permission.id, "once");

			expect(respondToPermission).toHaveBeenCalledWith("session-jsonrpc", 456, true, "allow");
			expect(mockReplyPermission).not.toHaveBeenCalled();
			expect(store.pending.size).toBe(0);
		});

		it("should send allow_always optionId for 'always' reply", async () => {
			const { respondToPermission } = await import("../../logic/inbound-request-handler.js");

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

			expect(respondToPermission).toHaveBeenCalledWith("session-always", 789, true, "allow_always");
		});

		it("should send reject optionId and allowed=false for 'reject' reply", async () => {
			const { respondToPermission } = await import("../../logic/inbound-request-handler.js");

			const permission = createAcpPermission("session-reject", "tool-reject", 101);

			store.add(permission);
			await store.reply(permission.id, "reject");

			expect(respondToPermission).toHaveBeenCalledWith("session-reject", 101, false, "reject");
		});

		it("should return error for non-existent permission", async () => {
			const result = await store.reply("non-existent", "once");

			expect(result.isErr()).toBe(true);
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
});
