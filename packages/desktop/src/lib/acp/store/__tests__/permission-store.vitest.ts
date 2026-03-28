import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionRequest } from "../../types/permission.js";

import { PermissionStore } from "../permission-store.svelte.js";

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

		it("should add permission with jsonRpcRequestId", () => {
			const permission: PermissionRequest = {
				id: "perm-2::123",
				sessionId: "session-2",
				jsonRpcRequestId: 123,
				permission: "Bash",
				patterns: [],
				metadata: { rawInput: { command: "ls" } },
				always: ["allow_always"],
			};

			store.add(permission);

			expect(store.pending.get("perm-2::123")?.jsonRpcRequestId).toBe(123);
		});

		it("should keep multiple ACP permissions for the same tool call", () => {
			store.add({
				id: "tool-1::100",
				sessionId: "session-1",
				jsonRpcRequestId: 100,
				permission: "Execute",
				patterns: [],
				metadata: {},
				always: [],
				tool: { messageID: "", callID: "tool-1" },
			});
			store.add({
				id: "tool-1::101",
				sessionId: "session-1",
				jsonRpcRequestId: 101,
				permission: "Execute",
				patterns: [],
				metadata: {},
				always: [],
				tool: { messageID: "", callID: "tool-1" },
			});

			expect(store.pending.size).toBe(2);
			expect(store.pending.has("tool-1::100")).toBe(true);
			expect(store.pending.has("tool-1::101")).toBe(true);
		});

		it("should resolve permission by tool call id", () => {
			store.add({
				id: "tool-1::100",
				sessionId: "session-1",
				jsonRpcRequestId: 100,
				permission: "Execute",
				patterns: [],
				metadata: {},
				always: [],
				tool: { messageID: "", callID: "tool-1" },
			});
			store.add({
				id: "tool-1::101",
				sessionId: "session-1",
				jsonRpcRequestId: 101,
				permission: "Execute",
				patterns: [],
				metadata: {},
				always: [],
				tool: { messageID: "", callID: "tool-1" },
			});

			const permission = store.getForToolCall("tool-1");

			expect(permission?.jsonRpcRequestId).toBe(101);
			expect(permission?.id).toBe("tool-1::101");
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

			const permission: PermissionRequest = {
				id: "perm-child::200",
				sessionId: "child-session",
				jsonRpcRequestId: 200,
				permission: "Bash",
				patterns: [],
				metadata: {},
				always: [],
			};

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
				id: "perm-opts::300",
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

			const permission: PermissionRequest = {
				id: "perm-jsonrpc::456",
				sessionId: "session-jsonrpc",
				jsonRpcRequestId: 456,
				permission: "Bash",
				patterns: [],
				metadata: {},
				always: [],
			};

			store.add(permission);
			await store.reply("perm-jsonrpc::456", "once");

			expect(respondToPermission).toHaveBeenCalledWith("session-jsonrpc", 456, true, "allow");
			expect(mockReplyPermission).not.toHaveBeenCalled();
			expect(store.pending.size).toBe(0);
		});

		it("should send allow_always optionId for 'always' reply", async () => {
			const { respondToPermission } = await import("../../logic/inbound-request-handler.js");

			const permission: PermissionRequest = {
				id: "perm-always::789",
				sessionId: "session-always",
				jsonRpcRequestId: 789,
				permission: "Bash",
				patterns: [],
				metadata: {},
				always: ["allow_always"],
			};

			store.add(permission);
			await store.reply("perm-always::789", "always");

			expect(respondToPermission).toHaveBeenCalledWith("session-always", 789, true, "allow_always");
		});

		it("should send reject optionId and allowed=false for 'reject' reply", async () => {
			const { respondToPermission } = await import("../../logic/inbound-request-handler.js");

			const permission: PermissionRequest = {
				id: "perm-reject::101",
				sessionId: "session-reject",
				jsonRpcRequestId: 101,
				permission: "Bash",
				patterns: [],
				metadata: {},
				always: [],
			};

			store.add(permission);
			await store.reply("perm-reject::101", "reject");

			expect(respondToPermission).toHaveBeenCalledWith("session-reject", 101, false, "reject");
		});

		it("should return error for non-existent permission", async () => {
			const result = await store.reply("non-existent", "once");

			expect(result.isErr()).toBe(true);
		});
	});
});
