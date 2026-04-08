import { describe, expect, it } from "vitest";

import { buildAcpPermissionId, createPermissionRequest } from "./permission.js";

describe("createPermissionRequest", () => {
	it("normalizes session-update permission data for the store", () => {
		const permission = createPermissionRequest({
			id: "permission-1",
			sessionId: "session-1",
			jsonRpcRequestId: null,
			permission: "ReadFile",
			patterns: ["/Users/alex/Documents/acepe/packages/desktop/src"],
			metadata: {
				rawInput: { path: "/Users/alex/Documents/acepe/packages/desktop/src" },
				options: [{ kind: "allow", name: "Allow Once", optionId: "allow" }],
				extra: "value",
			},
			always: ["allow_always"],
			tool: { messageId: "message-1", callId: "call-1" },
		});

		expect(permission).toEqual({
			id: "permission-1",
			sessionId: "session-1",
			jsonRpcRequestId: undefined,
			replyHandler: { kind: "http", requestId: "permission-1" },
			permission: "ReadFile",
			patterns: ["/Users/alex/Documents/acepe/packages/desktop/src"],
			metadata: {
				rawInput: { path: "/Users/alex/Documents/acepe/packages/desktop/src" },
				options: [{ kind: "allow", name: "Allow Once", optionId: "allow" }],
				extra: "value",
			},
			always: ["allow_always"],
			tool: { messageID: "message-1", callID: "call-1" },
		});
	});

	it("preserves inbound-request permission data", () => {
		const permission = createPermissionRequest({
			id: buildAcpPermissionId("session-2", "tool-2", 42),
			sessionId: "session-2",
			jsonRpcRequestId: 42,
			permission: "Execute tool",
			patterns: [],
			metadata: {
				rawInput: { command: "ls" },
				parsedArguments: null,
				options: [{ kind: "allow_always", name: "Always Allow", optionId: "allow_always" }],
			},
			always: ["allow_always"],
			tool: { messageID: "", callID: "tool-2" },
		});

		expect(permission).toEqual({
			id: buildAcpPermissionId("session-2", "tool-2", 42),
			sessionId: "session-2",
			jsonRpcRequestId: 42,
			replyHandler: { kind: "json-rpc", requestId: 42 },
			permission: "Execute tool",
			patterns: [],
			metadata: {
				rawInput: { command: "ls" },
				parsedArguments: null,
				options: [{ kind: "allow_always", name: "Always Allow", optionId: "allow_always" }],
			},
			always: ["allow_always"],
			tool: { messageID: "", callID: "tool-2" },
		});
	});
});
