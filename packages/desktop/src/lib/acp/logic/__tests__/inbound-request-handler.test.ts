import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { JsonValue } from "../../../services/converted-session-types.js";
import { ACP_INBOUND_METHODS } from "../../constants/acp-methods.js";
import { buildAcpPermissionId, type PermissionRequest } from "../../types/permission.js";
import type { QuestionRequest } from "../../types/question.js";
import type { AcpEventEnvelope } from "../acp-event-bridge.js";

const mockOpenAcpEventSource = vi.fn();

// Mock the ACP event bridge listener
const mockUnlisten = vi.fn();
let eventCallback: ((event: { payload: JsonValue }) => void) | null = null;

vi.mock("../acp-event-bridge.js", () => ({
	openAcpEventSource: (...args: Parameters<typeof mockOpenAcpEventSource>) =>
		mockOpenAcpEventSource(...args),
}));

// Mock the API
vi.mock("../../store/api.js", () => ({
	api: {
		respondInboundRequest: vi.fn(() => ({
			match: vi.fn((onOk: () => void) => onOk()),
			mapErr: vi.fn(() => ({
				match: vi.fn((onOk: () => void) => onOk()),
			})),
		})),
	},
}));

const { cancelQuestion, InboundRequestHandler, respondToPermission, respondToQuestion } =
	await import("../inbound-request-handler.js");

describe("InboundRequestHandler", () => {
	let handler: InstanceType<typeof InboundRequestHandler>;
	let permissionCallback: Mock;
	let questionCallback: Mock;

	beforeEach(() => {
		handler = new InboundRequestHandler();
		permissionCallback = vi.fn();
		questionCallback = vi.fn();
		eventCallback = null;
		vi.clearAllMocks();
		mockOpenAcpEventSource.mockImplementation(
			(onEnvelope: (envelope: AcpEventEnvelope) => void) => {
				eventCallback = (event) =>
					onEnvelope({
						seq: 1,
						eventName: "acp-inbound-request",
						sessionId: null,
						payload: event.payload,
						priority: "high",
						droppable: false,
						emittedAtMs: Date.now(),
					});
				return okAsync(mockUnlisten);
			}
		);
	});

	afterEach(() => {
		handler.stop();
	});

	describe("start", () => {
		it("should register event listener on start", async () => {
			const result = await handler.start(permissionCallback);

			expect(result.isOk()).toBe(true);
			expect(eventCallback).not.toBeNull();
		});

		it("should call unlisten on stop", async () => {
			await handler.start(permissionCallback);
			handler.stop();

			expect(mockUnlisten).toHaveBeenCalled();
		});
	});

	describe("parseRequest", () => {
		it("should parse valid JSON-RPC request", async () => {
			await handler.start(permissionCallback);

			const validRequest = {
				id: 123,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "test-session",
					options: [
						{ kind: "allow", name: "Allow", optionId: "allow" },
						{ kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
						{ kind: "reject", name: "Reject", optionId: "reject" },
					],
					toolCall: {
						toolCallId: "tool-123",
						rawInput: { command: "bun test" },
						title: "Run tests",
					},
				},
			};

			eventCallback?.({ payload: validRequest });

			expect(permissionCallback).toHaveBeenCalledTimes(1);
			const permission: PermissionRequest = permissionCallback.mock.calls[0][0];
			expect(permission.id).toBe(buildAcpPermissionId("test-session", "tool-123", 123));
			expect(permission.sessionId).toBe("test-session");
			expect(permission.jsonRpcRequestId).toBe(123);
			expect(permission.permission).toBe("Run tests");
			expect(permission.always).toEqual(["allow_always"]);
			expect(permission.tool).toEqual({
				messageID: "",
				callID: "tool-123",
			});
		});

		it("should reject request without id", async () => {
			await handler.start(permissionCallback);

			const invalidRequest = {
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {},
			};

			eventCallback?.({ payload: invalidRequest });

			expect(permissionCallback).not.toHaveBeenCalled();
		});

		it("should reject request without method", async () => {
			await handler.start(permissionCallback);

			const invalidRequest = {
				id: 123,
				jsonrpc: "2.0",
				params: {},
			};

			eventCallback?.({ payload: invalidRequest });

			expect(permissionCallback).not.toHaveBeenCalled();
		});

		it("should reject non-object payload", async () => {
			await handler.start(permissionCallback);

			eventCallback?.({ payload: "not an object" });

			expect(permissionCallback).not.toHaveBeenCalled();
		});

		it("should reject null payload", async () => {
			await handler.start(permissionCallback);

			eventCallback?.({ payload: null });

			expect(permissionCallback).not.toHaveBeenCalled();
		});
	});

	describe("handlePermissionRequest", () => {
		it("should extract always options correctly", async () => {
			await handler.start(permissionCallback);

			const request = {
				id: 1,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-1",
					options: [
						{ kind: "allow", name: "Allow Once", optionId: "allow" },
						{ kind: "allow_always", name: "Always Allow Bash", optionId: "allow_bash_always" },
						{ kind: "allow_always", name: "Always Allow Read", optionId: "allow_read_always" },
						{ kind: "reject", name: "Reject", optionId: "reject" },
					],
					toolCall: {
						toolCallId: "tc-1",
						rawInput: {},
						name: "Bash",
					},
				},
			};

			eventCallback?.({ payload: request });

			const permission: PermissionRequest = permissionCallback.mock.calls[0][0];
			expect(permission.always).toEqual(["allow_bash_always", "allow_read_always"]);
		});

		it("should use name as fallback when title is missing", async () => {
			await handler.start(permissionCallback);

			const request = {
				id: 1,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-1",
					options: [],
					toolCall: {
						toolCallId: "tc-1",
						rawInput: {},
						name: "ReadFile",
					},
				},
			};

			eventCallback?.({ payload: request });

			const permission: PermissionRequest = permissionCallback.mock.calls[0][0];
			expect(permission.permission).toBe("ReadFile");
		});

		it("should use default message when both title and name are missing", async () => {
			await handler.start(permissionCallback);

			const request = {
				id: 1,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-1",
					options: [],
					toolCall: {
						toolCallId: "tc-1",
						rawInput: {},
					},
				},
			};

			eventCallback?.({ payload: request });

			const permission: PermissionRequest = permissionCallback.mock.calls[0][0];
			expect(permission.permission).toBe("Execute tool");
		});

		it("should store rawInput in metadata", async () => {
			await handler.start(permissionCallback);

			const rawInput = { command: "rm -rf /", dangerous: true };
			const request = {
				id: 1,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-1",
					options: [],
					toolCall: {
						toolCallId: "tc-1",
						rawInput,
						title: "Dangerous Command",
					},
				},
			};

			eventCallback?.({ payload: request });

			const permission: PermissionRequest = permissionCallback.mock.calls[0][0];
			expect(permission.metadata).toEqual({ rawInput, options: [] });
		});
	});

	describe("unknown methods", () => {
		it("should not call permission callback for unknown methods", async () => {
			await handler.start(permissionCallback);

			const request = {
				id: 1,
				jsonrpc: "2.0",
				method: "client/unknownMethod",
				params: {},
			};

			eventCallback?.({ payload: request });

			expect(permissionCallback).not.toHaveBeenCalled();
		});
	});

	describe("handleQuestionRequest (AskUserQuestion)", () => {
		it("should route request with _meta.askUserQuestion to question callback", async () => {
			await handler.start(permissionCallback, questionCallback);

			const request = {
				id: 1,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-1",
					options: [{ kind: "allow", name: "Continue", optionId: "continue" }],
					toolCall: {
						toolCallId: "tc-question-1",
						rawInput: { questions: [] },
						title: "Question",
					},
					_meta: {
						askUserQuestion: {
							questions: [
								{
									question: "Which framework do you prefer?",
									header: "Framework",
									options: [
										{ label: "React", description: "A popular library" },
										{ label: "Svelte", description: "A compiler-based framework" },
									],
									multiSelect: false,
								},
							],
						},
					},
				},
			};

			eventCallback?.({ payload: request });

			// Should call question callback, NOT permission callback
			expect(questionCallback).toHaveBeenCalledTimes(1);
			expect(permissionCallback).not.toHaveBeenCalled();

			const question: QuestionRequest = questionCallback.mock.calls[0][0];
			expect(question.id).toBe("tc-question-1");
			expect(question.sessionId).toBe("session-1");
			expect(question.jsonRpcRequestId).toBe(1);
			expect(question.questions).toHaveLength(1);
			expect(question.questions[0].question).toBe("Which framework do you prefer?");
			expect(question.questions[0].header).toBe("Framework");
			expect(question.questions[0].options).toHaveLength(2);
			expect(question.questions[0].multiSelect).toBe(false);
		});

		it("should route upstream AskUserQuestion requests to question callback", async () => {
			await handler.start(permissionCallback, questionCallback);

			const request = {
				id: 7,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-7",
					options: [],
					toolCall: {
						toolCallId: "tc-question-7",
						name: "AskUserQuestion",
						rawInput: {
							questions: [
								{
									question: "Which editor?",
									header: "Editor",
									options: [
										{ label: "Zed", description: "Fast editor" },
										{ label: "VS Code", description: "Popular editor" },
									],
									multiSelect: false,
								},
							],
						},
					},
				},
			};

			eventCallback?.({ payload: request });

			expect(questionCallback).toHaveBeenCalledTimes(1);
			expect(permissionCallback).not.toHaveBeenCalled();

			const question: QuestionRequest = questionCallback.mock.calls[0][0];
			expect(question.id).toBe("tc-question-7");
			expect(question.sessionId).toBe("session-7");
			expect(question.jsonRpcRequestId).toBe(7);
			expect(question.questions).toHaveLength(1);
			expect(question.questions[0].question).toBe("Which editor?");
		});

		it("should fall back to permission flow for upstream AskUserQuestion without callback", async () => {
			await handler.start(permissionCallback);

			const request = {
				id: 8,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-8",
					options: [],
					toolCall: {
						toolCallId: "tc-question-8",
						title: "AskUserQuestion",
						rawInput: {
							questions: [
								{
									question: "Continue?",
									header: "Confirm",
									options: [{ label: "Yes", description: "Continue" }],
									multiSelect: false,
								},
							],
						},
					},
				},
			};

			eventCallback?.({ payload: request });

			expect(permissionCallback).toHaveBeenCalledTimes(1);
			const permission: PermissionRequest = permissionCallback.mock.calls[0][0];
			expect(permission.id).toBe(buildAcpPermissionId("session-8", "tc-question-8", 8));
			expect(permission.tool?.callID).toBe("tc-question-8");
			expect(permission.jsonRpcRequestId).toBe(8);
		});

		it("should handle multiSelect questions", async () => {
			await handler.start(permissionCallback, questionCallback);

			const request = {
				id: 2,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-2",
					options: [],
					toolCall: {
						toolCallId: "tc-question-2",
						rawInput: {},
						title: "Multi-select",
					},
					_meta: {
						askUserQuestion: {
							questions: [
								{
									question: "Select features to enable:",
									header: "Features",
									options: [
										{ label: "TypeScript", description: "Type safety" },
										{ label: "ESLint", description: "Code linting" },
										{ label: "Prettier", description: "Code formatting" },
									],
									multiSelect: true,
								},
							],
						},
					},
				},
			};

			eventCallback?.({ payload: request });

			const question: QuestionRequest = questionCallback.mock.calls[0][0];
			expect(question.questions[0].multiSelect).toBe(true);
		});

		it("should handle multiple questions in a single request", async () => {
			await handler.start(permissionCallback, questionCallback);

			const request = {
				id: 3,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-3",
					options: [],
					toolCall: {
						toolCallId: "tc-question-3",
						rawInput: {},
						title: "Multiple Questions",
					},
					_meta: {
						askUserQuestion: {
							questions: [
								{
									question: "First question?",
									header: "Q1",
									options: [{ label: "A", description: "Option A" }],
								},
								{
									question: "Second question?",
									header: "Q2",
									options: [{ label: "B", description: "Option B" }],
								},
							],
						},
					},
				},
			};

			eventCallback?.({ payload: request });

			const question: QuestionRequest = questionCallback.mock.calls[0][0];
			expect(question.questions).toHaveLength(2);
			expect(question.questions[0].question).toBe("First question?");
			expect(question.questions[1].question).toBe("Second question?");
		});

		it("should treat as permission request when no question callback provided", async () => {
			// Start WITHOUT question callback
			await handler.start(permissionCallback);

			const request = {
				id: 4,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-4",
					options: [],
					toolCall: {
						toolCallId: "tc-4",
						rawInput: {},
						title: "Question",
					},
					_meta: {
						askUserQuestion: {
							questions: [
								{
									question: "Test?",
									header: "Test",
									options: [{ label: "Yes", description: "Confirm" }],
								},
							],
						},
					},
				},
			};

			eventCallback?.({ payload: request });

			// Should fall back to permission callback
			expect(permissionCallback).toHaveBeenCalledTimes(1);
		});

		it("should treat as permission request when _meta.askUserQuestion is missing", async () => {
			await handler.start(permissionCallback, questionCallback);

			const request = {
				id: 5,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-5",
					options: [],
					toolCall: {
						toolCallId: "tc-5",
						rawInput: {},
						title: "Regular Permission",
					},
				},
			};

			eventCallback?.({ payload: request });

			// Should use permission callback
			expect(permissionCallback).toHaveBeenCalledTimes(1);
			expect(questionCallback).not.toHaveBeenCalled();
		});

		it("should set tool reference on question request", async () => {
			await handler.start(permissionCallback, questionCallback);

			const request = {
				id: 6,
				jsonrpc: "2.0",
				method: ACP_INBOUND_METHODS.REQUEST_PERMISSION,
				params: {
					sessionId: "session-6",
					options: [],
					toolCall: {
						toolCallId: "tc-question-6",
						rawInput: {},
						title: "Question",
					},
					_meta: {
						askUserQuestion: {
							questions: [
								{
									question: "Test?",
									header: "Test",
									options: [{ label: "Yes", description: "Yes" }],
								},
							],
						},
					},
				},
			};

			eventCallback?.({ payload: request });

			const question: QuestionRequest = questionCallback.mock.calls[0][0];
			expect(question.tool).toEqual({
				messageID: "",
				callID: "tc-question-6",
			});
		});
	});
});

describe("respondToPermission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should send correct response for allow", async () => {
		const { api } = await import("../../store/api.js");

		await respondToPermission("session-1", 123, true, "allow");

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-1", 123, {
			outcome: {
				outcome: "selected",
				optionId: "allow",
			},
		});
	});

	it("should send correct response for allow_always", async () => {
		const { api } = await import("../../store/api.js");

		await respondToPermission("session-1", 456, true, "allow_always");

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-1", 456, {
			outcome: {
				outcome: "selected",
				optionId: "allow_always",
			},
		});
	});

	it("should send correct response for reject", async () => {
		const { api } = await import("../../store/api.js");

		await respondToPermission("session-1", 789, false, "reject");

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-1", 789, {
			outcome: {
				outcome: "cancelled",
				optionId: "reject",
			},
		});
	});

	it("should use default optionId based on allowed flag", async () => {
		const { api } = await import("../../store/api.js");

		await respondToPermission("session-2", 100, true);

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-2", 100, {
			outcome: {
				outcome: "selected",
				optionId: "allow",
			},
		});

		await respondToPermission("session-2", 101, false);

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-2", 101, {
			outcome: {
				outcome: "cancelled",
				optionId: "reject",
			},
		});
	});
});

describe("respondToQuestion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should send answers in the correct format", async () => {
		const { api } = await import("../../store/api.js");

		const answers = {
			"Which framework do you prefer?": "Svelte",
		};

		await respondToQuestion("session-1", 123, answers);

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-1", 123, {
			outcome: {
				outcome: "selected",
				optionId: "allow",
			},
			_meta: {
				answers: {
					"Which framework do you prefer?": "Svelte",
				},
			},
		});
	});

	it("should handle multiple answers for multi-select questions", async () => {
		const { api } = await import("../../store/api.js");

		const answers = {
			"Select features:": ["TypeScript", "ESLint", "Prettier"],
		};

		await respondToQuestion("session-2", 456, answers);

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-2", 456, {
			outcome: {
				outcome: "selected",
				optionId: "allow",
			},
			_meta: {
				answers: {
					"Select features:": ["TypeScript", "ESLint", "Prettier"],
				},
			},
		});
	});

	it("should handle multiple questions with mixed answer types", async () => {
		const { api } = await import("../../store/api.js");

		const answers = {
			"Single choice question?": "Option A",
			"Multi choice question?": ["Option B", "Option C"],
		};

		await respondToQuestion("session-3", 789, answers);

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-3", 789, {
			outcome: {
				outcome: "selected",
				optionId: "allow",
			},
			_meta: {
				answers,
			},
		});
	});
});

describe("cancelQuestion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should send cancellation response", async () => {
		const { api } = await import("../../store/api.js");

		await cancelQuestion("session-1", 100);

		expect(api.respondInboundRequest).toHaveBeenCalledWith("session-1", 100, {
			outcome: {
				outcome: "cancelled",
			},
		});
	});
});
