import { describe, expect, it } from "vitest";

import { ACP_INBOUND_METHODS } from "../../constants/acp-methods.js";
import {
	normalizeInboundInteractionRequest,
	toPermissionRequest,
} from "../inbound-request-normalization.js";

describe("normalizeInboundInteractionRequest", () => {
	it("treats legacy ask-user-question metadata as a permission fallback", () => {
		const result = normalizeInboundInteractionRequest({
			id: 12,
			jsonrpc: "2.0",
			method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
			params: {
				sessionId: "session-12",
				options: [
					{ kind: "allow", name: "Allow", optionId: "allow" },
					{ kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
				],
				toolCall: {
					toolCallId: "tool-12",
					rawInput: { questions: [] },
					title: "Question",
				},
				_meta: {
					askUserQuestion: {
						questions: [
							{
								question: "Choose one?",
								options: [{ label: "Yes" }],
							},
						],
					},
				},
			},
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) {
			throw new Error(result.error.message);
		}

		const normalized = result.value;
		expect(normalized.kind).toBe("permission");
		expect(normalized.alwaysOptionIds).toEqual(["allow_always"]);
	});

	it("does not parse upstream AskUserQuestion raw input into questions in TypeScript", () => {
		const result = normalizeInboundInteractionRequest({
			id: 13,
			jsonrpc: "2.0",
			method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
			params: {
				sessionId: "session-13",
				options: [],
				toolCall: {
					toolCallId: "tool-13",
					name: "AskUserQuestion",
					rawInput: {
						questions: [
							{
								question: "Which editor?",
								header: "Editor",
								options: [
									{ label: "Zed", description: "Fast" },
									{ label: "VS Code", description: "Popular" },
								],
								multiSelect: false,
							},
						],
					},
				},
			},
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) {
			throw new Error(result.error.message);
		}

		const normalized = result.value;
		expect(normalized.kind).toBe("permission");
		expect(normalized.toolLabel).toBe("AskUserQuestion");
	});

	it("normalizes standard permission requests into a canonical permission shape", () => {
		const result = normalizeInboundInteractionRequest({
			id: 14,
			jsonrpc: "2.0",
			method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
			params: {
				sessionId: "session-14",
				options: [
					{ kind: "allow", name: "Allow", optionId: "allow" },
					{ kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
				],
				toolCall: {
					toolCallId: "tool-14",
					rawInput: { command: "bun test" },
					parsedArguments: { command: "bun test" },
					name: "Bash",
				},
			},
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) {
			throw new Error(result.error.message);
		}

		const normalized = result.value;
		expect(normalized.kind).toBe("permission");
		expect(toPermissionRequest(normalized)).toEqual({
			id: "session-14\u0000tool-14\u000014",
			sessionId: "session-14",
			jsonRpcRequestId: 14,
			replyHandler: {
				kind: "json-rpc",
				requestId: 14,
			},
			permission: "Bash",
			patterns: [],
			metadata: {
				diagnosticRawInput: { command: "bun test" },
				parsedArguments: { command: "bun test" },
				options: [
					{ kind: "allow", name: "Allow", optionId: "allow" },
					{ kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
				],
			},
			always: ["allow_always"],
			tool: {
				messageID: null,
				callID: "tool-14",
			},
		});
	});

	it("normalizes sparse permission requests from Copilot into a canonical permission shape", () => {
		const result = normalizeInboundInteractionRequest({
			id: 15,
			jsonrpc: "2.0",
			method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
			params: {
				sessionId: "session-15",
				toolCall: {
					name: "Write",
				},
			},
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) {
			throw new Error(result.error.message);
		}

		const normalized = result.value;
		expect(normalized.kind).toBe("permission");
		expect(toPermissionRequest(normalized)).toEqual({
			id: "session-15\u0000permission-request-15\u000015",
			sessionId: "session-15",
			jsonRpcRequestId: 15,
			replyHandler: {
				kind: "json-rpc",
				requestId: 15,
			},
			permission: "Write",
			patterns: [],
			metadata: {
				diagnosticRawInput: {},
			},
			always: [],
			tool: {
				messageID: null,
				callID: "permission-request-15",
			},
		});
	});
});
