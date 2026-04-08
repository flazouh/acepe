import { describe, expect, it } from "vitest";

import { ACP_INBOUND_METHODS } from "../../constants/acp-methods.js";
import {
	normalizeInboundInteractionRequest,
	toPermissionRequest,
	toQuestionRequest,
} from "../inbound-request-normalization.js";

describe("normalizeInboundInteractionRequest", () => {
	it("normalizes legacy ask-user-question metadata into a canonical question shape", () => {
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
		expect(normalized.kind).toBe("question");
		if (normalized.kind !== "question") {
			throw new Error("Expected question request");
		}

		expect(normalized.alwaysOptionIds).toEqual(["allow_always"]);
		expect(normalized.questions).toEqual([
			{
				question: "Choose one?",
				header: "",
				options: [{ label: "Yes", description: "" }],
				multiSelect: false,
			},
		]);
		expect(toQuestionRequest(normalized)).toEqual({
			id: "tool-12",
			sessionId: "session-12",
			jsonRpcRequestId: 12,
			replyHandler: {
				kind: "json-rpc",
				requestId: 12,
			},
			questions: [
				{
					question: "Choose one?",
					header: "",
					options: [{ label: "Yes", description: "" }],
					multiSelect: false,
				},
			],
			tool: {
				messageID: "",
				callID: "tool-12",
			},
		});
	});

	it("normalizes upstream AskUserQuestion raw input into a canonical question shape", () => {
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
		expect(normalized.kind).toBe("question");
		if (normalized.kind !== "question") {
			throw new Error("Expected question request");
		}

		expect(normalized.questions[0].question).toBe("Which editor?");
		expect(normalized.questions[0].header).toBe("Editor");
		expect(normalized.questions[0].options).toEqual([
			{ label: "Zed", description: "Fast" },
			{ label: "VS Code", description: "Popular" },
		]);
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
				rawInput: { command: "bun test" },
				parsedArguments: { command: "bun test" },
				options: [
					{ kind: "allow", name: "Allow", optionId: "allow" },
					{ kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
				],
			},
			always: ["allow_always"],
			tool: {
				messageID: "",
				callID: "tool-14",
			},
		});
	});
});
