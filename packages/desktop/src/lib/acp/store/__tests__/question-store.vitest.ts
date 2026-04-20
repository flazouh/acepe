import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QuestionRequest } from "../../types/question.js";

import { OperationStore } from "../operation-store.svelte.js";
import { QuestionStore } from "../question-store.svelte.js";

const mockReplyInteraction = vi.fn((_request: Record<string, unknown>) => okAsync(undefined));

vi.mock("../api.js", () => ({
	api: {
		replyInteraction: (request: Record<string, unknown>) => mockReplyInteraction(request),
	},
}));

describe("QuestionStore", () => {
	let store: QuestionStore;

	beforeEach(() => {
		store = new QuestionStore();
		vi.clearAllMocks();
	});

	describe("add", () => {
		it("should add a question to the pending map", () => {
			const question: QuestionRequest = {
				id: "q-1",
				sessionId: "session-1",
				questions: [
					{
						question: "Which option?",
						header: "Choice",
						options: [{ label: "A", description: "Option A" }],
						multiSelect: false,
					},
				],
			};

			store.add(question);

			expect(store.pending.size).toBe(1);
			expect(store.pending.get("q-1")).toEqual(question);
		});

		it("should add question with jsonRpcRequestId", () => {
			const question: QuestionRequest = {
				id: "q-2",
				sessionId: "session-2",
				jsonRpcRequestId: 123,
				questions: [
					{
						question: "Framework preference?",
						header: "Framework",
						options: [
							{ label: "React", description: "A library" },
							{ label: "Svelte", description: "A compiler" },
						],
						multiSelect: false,
					},
				],
			};

			store.add(question);

			expect(store.pending.get("q-2")?.jsonRpcRequestId).toBe(123);
		});

		it("returns the pending question for a canonical operation", () => {
			const operationStore = new OperationStore();
			operationStore.upsertOperationSnapshot({
				id: "op-question",
				session_id: "session-1",
				tool_call_id: "tool-question",
				name: "question_tool",
				kind: "question",
				status: "pending",
				lifecycle: "blocked",
				blocked_reason: "question",
				title: null,
				arguments: { kind: "other", raw: {} },
				progressive_arguments: null,
				result: null,
				command: null,
				locations: null,
				skill_meta: null,
				normalized_todos: null,
				started_at_ms: null,
				completed_at_ms: null,
				parent_tool_call_id: null,
				parent_operation_id: null,
				child_tool_call_ids: [],
				child_operation_ids: [],
			});

			store.add({
				id: "q-tool",
				sessionId: "session-1",
				questions: [],
				tool: {
					messageID: "",
					callID: "tool-question",
				},
			});

			const operation = operationStore.getByToolCallId("session-1", "tool-question");
			const matched = operation ? store.getForOperation(operation) : undefined;

			expect(matched?.id).toBe("q-tool");
		});

		it("returns the pending question for a direct tool-call lookup", () => {
			store.add({
				id: "q-tool-direct",
				sessionId: "session-1",
				questions: [],
				tool: {
					messageID: "",
					callID: "tool-question",
				},
			});

			expect(store.getForToolCall("session-1", "tool-question")?.id).toBe("q-tool-direct");
		});
	});

	describe("remove", () => {
		it("should remove a question from the pending map", () => {
			const question: QuestionRequest = {
				id: "q-1",
				sessionId: "session-1",
				questions: [],
			};

			store.add(question);
			expect(store.pending.size).toBe(1);

			store.remove("q-1");
			expect(store.pending.size).toBe(0);
		});
	});

	describe("removeForSession", () => {
		it("should remove all questions for a specific session", () => {
			store.add({
				id: "q-1",
				sessionId: "session-1",
				questions: [],
			});
			store.add({
				id: "q-2",
				sessionId: "session-1",
				questions: [],
			});
			store.add({
				id: "q-3",
				sessionId: "session-2",
				questions: [],
			});

			expect(store.pending.size).toBe(3);

			store.removeForSession("session-1");

			expect(store.pending.size).toBe(1);
			expect(store.pending.has("q-3")).toBe(true);
		});
	});

	describe("reply", () => {
		it("preserves JSON-RPC reply routing when a duplicate question update omits transport metadata", async () => {
			const initialQuestion: QuestionRequest = {
				id: "q-duplicate-routing",
				sessionId: "session-duplicate-routing",
				jsonRpcRequestId: 654,
				questions: [
					{
						question: "Which feature should I prioritize?",
						header: "Priority",
						options: [{ label: "Streaming", description: "Improve live updates" }],
						multiSelect: false,
					},
				],
				tool: {
					messageID: "",
					callID: "tool-question-routing",
				},
			};

			const refreshedQuestion: QuestionRequest = {
				id: "q-duplicate-routing",
				sessionId: "session-duplicate-routing",
				questions: initialQuestion.questions,
				tool: initialQuestion.tool,
			};

			store.add(initialQuestion);
			store.add(refreshedQuestion);

			await store.reply(
				"q-duplicate-routing",
				[{ questionIndex: 0, answers: ["Streaming"] }],
				initialQuestion.questions
			);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-duplicate-routing",
				interactionId: "q-duplicate-routing",
				replyHandler: {
					kind: "json-rpc",
					requestId: 654,
				},
				payload: {
					kind: "question",
					answers: [{ questionIndex: 0, answers: ["Streaming"] }],
					answerMap: {
						"Which feature should I prioritize?": "Streaming",
					},
				},
			});
		});

		it("should use HTTP endpoint for questions without jsonRpcRequestId", async () => {
			const question: QuestionRequest = {
				id: "q-http",
				sessionId: "session-http",
				questions: [
					{
						question: "Which option?",
						header: "Choice",
						options: [{ label: "A", description: "Option A" }],
						multiSelect: false,
					},
				],
				// No jsonRpcRequestId - this is OpenCode HTTP mode
			};

			store.add(question);
			const answers = [{ questionIndex: 0, answers: ["A"] }];
			await store.reply("q-http", answers, question.questions);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-http",
				interactionId: "q-http",
				replyHandler: {
					kind: "http",
					requestId: "q-http",
				},
				payload: {
					kind: "question",
					answers,
					answerMap: {
						"Which option?": "A",
					},
				},
			});
			expect(store.pending.size).toBe(0);
		});

		it("should use JSON-RPC response for questions with jsonRpcRequestId", async () => {
			const question: QuestionRequest = {
				id: "q-jsonrpc",
				sessionId: "session-jsonrpc",
				jsonRpcRequestId: 456,
				questions: [
					{
						question: "Which framework?",
						header: "Framework",
						options: [
							{ label: "React", description: "A library" },
							{ label: "Svelte", description: "A compiler" },
						],
						multiSelect: false,
					},
				],
			};

			store.add(question);
			const answers = [{ questionIndex: 0, answers: ["Svelte"] }];
			await store.reply("q-jsonrpc", answers, question.questions);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-jsonrpc",
				interactionId: "q-jsonrpc",
				replyHandler: {
					kind: "json-rpc",
					requestId: 456,
				},
				payload: {
					kind: "question",
					answers,
					answerMap: {
						"Which framework?": "Svelte",
					},
				},
			});
			expect(store.pending.size).toBe(0);
		});

		it("should convert multiple answers to array for multiSelect questions", async () => {
			const question: QuestionRequest = {
				id: "q-multi",
				sessionId: "session-multi",
				jsonRpcRequestId: 789,
				questions: [
					{
						question: "Select features:",
						header: "Features",
						options: [
							{ label: "TypeScript", description: "Types" },
							{ label: "ESLint", description: "Linting" },
							{ label: "Prettier", description: "Formatting" },
						],
						multiSelect: true,
					},
				],
			};

			store.add(question);
			const answers = [{ questionIndex: 0, answers: ["TypeScript", "ESLint"] }];
			await store.reply("q-multi", answers, question.questions);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-multi",
				interactionId: "q-multi",
				replyHandler: {
					kind: "json-rpc",
					requestId: 789,
				},
				payload: {
					kind: "question",
					answers,
					answerMap: {
						"Select features:": ["TypeScript", "ESLint"],
					},
				},
			});
		});

		it("should preserve multiple answers when multiple values are submitted", async () => {
			const question: QuestionRequest = {
				id: "q-multi-values",
				sessionId: "session-multi-values",
				jsonRpcRequestId: 790,
				questions: [
					{
						question: "Select features:",
						header: "Features",
						options: [
							{ label: "TypeScript", description: "Types" },
							{ label: "ESLint", description: "Linting" },
							{ label: "Prettier", description: "Formatting" },
						],
						multiSelect: false,
					},
				],
			};

			store.add(question);
			const answers = [{ questionIndex: 0, answers: ["TypeScript", "ESLint"] }];
			await store.reply("q-multi-values", answers, question.questions);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-multi-values",
				interactionId: "q-multi-values",
				replyHandler: {
					kind: "json-rpc",
					requestId: 790,
				},
				payload: {
					kind: "question",
					answers,
					answerMap: {
						"Select features:": ["TypeScript", "ESLint"],
					},
				},
			});
		});

		it("should handle multiple questions in a single request", async () => {
			const question: QuestionRequest = {
				id: "q-multiple-qs",
				sessionId: "session-multiple",
				jsonRpcRequestId: 101,
				questions: [
					{
						question: "First question?",
						header: "Q1",
						options: [{ label: "A", description: "Option A" }],
						multiSelect: false,
					},
					{
						question: "Second question?",
						header: "Q2",
						options: [{ label: "B", description: "Option B" }],
						multiSelect: true,
					},
				],
			};

			store.add(question);
			const answers = [
				{ questionIndex: 0, answers: ["A"] },
				{ questionIndex: 1, answers: ["B"] },
			];
			await store.reply("q-multiple-qs", answers, question.questions);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-multiple",
				interactionId: "q-multiple-qs",
				replyHandler: {
					kind: "json-rpc",
					requestId: 101,
				},
				payload: {
					kind: "question",
					answers,
					answerMap: {
						"First question?": "A",
						"Second question?": ["B"],
					},
				},
			});
		});

		it("should return error for non-existent question", async () => {
			const result = await store.reply("non-existent", [], []);

			expect(result.isErr()).toBe(true);
		});
	});

	describe("cancel", () => {
		it("should use JSON-RPC cancellation for questions with jsonRpcRequestId", async () => {
			const question: QuestionRequest = {
				id: "q-cancel-jsonrpc",
				sessionId: "session-cancel",
				jsonRpcRequestId: 200,
				questions: [],
			};

			store.add(question);
			await store.cancel("q-cancel-jsonrpc");

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-cancel",
				interactionId: "q-cancel-jsonrpc",
				replyHandler: {
					kind: "json-rpc",
					requestId: 200,
				},
				payload: {
					kind: "question_cancel",
				},
			});
			expect(store.pending.size).toBe(0);
		});

		it("should use replyQuestion fallback for questions without jsonRpcRequestId", async () => {
			const question: QuestionRequest = {
				id: "q-cancel-http",
				sessionId: "session-cancel-http",
				questions: [],
				// No jsonRpcRequestId - OpenCode HTTP mode
			};

			store.add(question);
			await store.cancel("q-cancel-http");

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-cancel-http",
				interactionId: "q-cancel-http",
				replyHandler: {
					kind: "http",
					requestId: "q-cancel-http",
				},
				payload: {
					kind: "question_cancel",
				},
			});
			expect(store.pending.size).toBe(0);
		});

		it("should return error for non-existent question", async () => {
			const result = await store.cancel("non-existent");

			expect(result.isErr()).toBe(true);
		});
	});

	describe("cancelForSession", () => {
		it("cancels all pending questions for the matching session", async () => {
			const sessionOneFirst: QuestionRequest = {
				id: "q-session-1-a",
				sessionId: "session-1",
				jsonRpcRequestId: 201,
				questions: [],
			};
			const sessionOneSecond: QuestionRequest = {
				id: "q-session-1-b",
				sessionId: "session-1",
				questions: [],
			};
			const sessionTwoQuestion: QuestionRequest = {
				id: "q-session-2",
				sessionId: "session-2",
				jsonRpcRequestId: 202,
				questions: [],
			};

			store.add(sessionOneFirst);
			store.add(sessionOneSecond);
			store.add(sessionTwoQuestion);

			const result = await store.cancelForSession("session-1");

			expect(result.isOk()).toBe(true);
			expect(store.pending.has("q-session-1-a")).toBe(false);
			expect(store.pending.has("q-session-1-b")).toBe(false);
			expect(store.pending.has("q-session-2")).toBe(true);
			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-1",
				interactionId: "q-session-1-a",
				replyHandler: {
					kind: "json-rpc",
					requestId: 201,
				},
				payload: {
					kind: "question_cancel",
				},
			});
			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-1",
				interactionId: "q-session-1-b",
				replyHandler: {
					kind: "http",
					requestId: "q-session-1-b",
				},
				payload: {
					kind: "question_cancel",
				},
			});
		});
	});
});
