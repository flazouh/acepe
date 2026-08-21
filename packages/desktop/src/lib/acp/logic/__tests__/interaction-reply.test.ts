import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionRequest } from "../../types/permission.js";
import type { QuestionAnswer, QuestionRequest } from "../../types/question.js";
import {
	cancelQuestionRequest,
	replyToComputerPermissionRequest,
	replyToPermissionRequest,
	replyToPlanApprovalRequest,
	replyToQuestionRequest,
} from "../interaction-reply.js";

const mockReplyInteraction = vi.fn((_request: unknown) => Effect.succeed(undefined));

const mockRespondToPermission = vi.fn(
	(_sessionId: string, _requestId: number, _allowed: boolean, _optionId: string) =>
		Effect.succeed(undefined)
);

const mockRespondToQuestion = vi.fn(
	(_sessionId: string, _requestId: number, _answers: Record<string, string | string[]>) =>
		Effect.succeed(undefined)
);

const mockCancelQuestion = vi.fn((_sessionId: string, _requestId: number) =>
	Effect.succeed(undefined)
);
const mockRespondToPlanApproval = vi.fn(
	(_sessionId: string, _requestId: number, _approved: boolean) => Effect.succeed(undefined)
);

vi.mock("../../store/api.js", () => ({
	api: {
		replyInteraction: (request: unknown) => mockReplyInteraction(request),
	},
}));

describe("interaction reply", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("replyToPermissionRequest", () => {
		it("prefers explicit reply-handler metadata over legacy request-id inference", async () => {
			const permission: PermissionRequest & {
				replyHandler: { kind: "json-rpc"; requestId: number };
			} = {
				id: "permission-override-jsonrpc",
				sessionId: "session-jsonrpc",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
				replyHandler: {
					kind: "json-rpc",
					requestId: 64,
				},
			};

			await Effect.runPromise(replyToPermissionRequest(permission, "once", "allow"));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-jsonrpc",
				interactionId: "permission-override-jsonrpc",
				replyHandler: {
					kind: "json-rpc",
					requestId: 64,
				},
				payload: {
					kind: "permission",
					reply: "once",
					optionId: "allow",
				},
			});
			expect(mockRespondToPermission).not.toHaveBeenCalled();
		});

		it("routes ACP permissions through JSON-RPC responders", async () => {
			const permission: PermissionRequest = {
				id: "permission-1",
				sessionId: "session-jsonrpc",
				jsonRpcRequestId: 42,
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			};

			await Effect.runPromise(replyToPermissionRequest(permission, "once", "allow"));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-jsonrpc",
				interactionId: "permission-1",
				replyHandler: {
					kind: "json-rpc",
					requestId: 42,
				},
				payload: {
					kind: "permission",
					reply: "once",
					optionId: "allow",
				},
			});
			expect(mockRespondToPermission).not.toHaveBeenCalled();
		});

		it("routes stream permissions through the HTTP reply endpoint", async () => {
			const permission: PermissionRequest = {
				id: "permission-2",
				sessionId: "session-http",
				permission: "ReadFile",
				patterns: [],
				metadata: {},
				always: [],
			};

			await Effect.runPromise(replyToPermissionRequest(permission, "reject", "reject"));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-http",
				interactionId: "permission-2",
				replyHandler: {
					kind: "http",
					requestId: "permission-2",
				},
				payload: {
					kind: "permission",
					reply: "reject",
					optionId: "reject",
				},
			});
			expect(mockRespondToPermission).not.toHaveBeenCalled();
		});
	});

	describe("replyToQuestionRequest", () => {
		it("prefers explicit reply-handler metadata over legacy request-id inference", async () => {
			const question: QuestionRequest & {
				replyHandler: { kind: "http"; requestId: string };
			} = {
				id: "question-override-http",
				sessionId: "session-http",
				jsonRpcRequestId: 91,
				questions: [],
				replyHandler: {
					kind: "http",
					requestId: "question-http-route",
				},
			};
			const answers: QuestionAnswer[] = [{ questionIndex: 0, answers: ["Bun"] }];
			const answerMap = { Runtime: "Bun" };

			await Effect.runPromise(replyToQuestionRequest(question, answers, answerMap));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-http",
				interactionId: "question-override-http",
				replyHandler: {
					kind: "http",
					requestId: "question-http-route",
				},
				payload: {
					kind: "question",
					answers,
					answerMap,
				},
			});
			expect(mockRespondToQuestion).not.toHaveBeenCalled();
		});

		it("routes ACP questions through JSON-RPC responders", async () => {
			const question: QuestionRequest = {
				id: "question-1",
				sessionId: "session-jsonrpc",
				jsonRpcRequestId: 99,
				questions: [],
			};
			const answers: QuestionAnswer[] = [{ questionIndex: 0, answers: ["Svelte"] }];
			const answerMap = { Framework: "Svelte" };

			await Effect.runPromise(replyToQuestionRequest(question, answers, answerMap));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-jsonrpc",
				interactionId: "question-1",
				replyHandler: {
					kind: "json-rpc",
					requestId: 99,
				},
				payload: {
					kind: "question",
					answers,
					answerMap,
				},
			});
			expect(mockRespondToQuestion).not.toHaveBeenCalled();
		});

		it("routes stream questions through the HTTP reply endpoint", async () => {
			const question: QuestionRequest = {
				id: "question-2",
				sessionId: "session-http",
				questions: [],
			};
			const answers: QuestionAnswer[] = [{ questionIndex: 0, answers: ["Bun"] }];
			const answerMap = { Runtime: "Bun" };

			await Effect.runPromise(replyToQuestionRequest(question, answers, answerMap));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-http",
				interactionId: "question-2",
				replyHandler: {
					kind: "http",
					requestId: "question-2",
				},
				payload: {
					kind: "question",
					answers,
					answerMap,
				},
			});
			expect(mockRespondToQuestion).not.toHaveBeenCalled();
		});
	});

	describe("cancelQuestionRequest", () => {
		it("prefers explicit reply-handler metadata for cancellations", async () => {
			const question: QuestionRequest & {
				replyHandler: { kind: "http"; requestId: string };
			} = {
				id: "question-cancel-http",
				sessionId: "session-http",
				jsonRpcRequestId: 123,
				questions: [],
				replyHandler: {
					kind: "http",
					requestId: "question-http-cancel",
				},
			};

			await Effect.runPromise(cancelQuestionRequest(question));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-http",
				interactionId: "question-cancel-http",
				replyHandler: {
					kind: "http",
					requestId: "question-http-cancel",
				},
				payload: {
					kind: "question_cancel",
				},
			});
			expect(mockCancelQuestion).not.toHaveBeenCalled();
		});

		it("routes ACP cancellations through JSON-RPC responders", async () => {
			const question: QuestionRequest = {
				id: "question-3",
				sessionId: "session-jsonrpc",
				jsonRpcRequestId: 123,
				questions: [],
			};

			await Effect.runPromise(cancelQuestionRequest(question));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-jsonrpc",
				interactionId: "question-3",
				replyHandler: {
					kind: "json-rpc",
					requestId: 123,
				},
				payload: {
					kind: "question_cancel",
				},
			});
			expect(mockCancelQuestion).not.toHaveBeenCalled();
		});

		it("routes stream cancellations through the HTTP reply endpoint", async () => {
			const question: QuestionRequest = {
				id: "question-4",
				sessionId: "session-http",
				questions: [],
			};

			await Effect.runPromise(cancelQuestionRequest(question));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-http",
				interactionId: "question-4",
				replyHandler: {
					kind: "http",
					requestId: "question-4",
				},
				payload: {
					kind: "question_cancel",
				},
			});
			expect(mockCancelQuestion).not.toHaveBeenCalled();
		});
	});

	describe("replyToPlanApprovalRequest", () => {
		it("routes plan approval replies through the canonical interaction reply command", async () => {
			await Effect.runPromise(replyToPlanApprovalRequest("session-plan", 77, true));

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-plan",
				interactionId: undefined,
				replyHandler: {
					kind: "json-rpc",
					requestId: 77,
				},
				payload: {
					kind: "plan_approval",
					approved: true,
				},
			});
			expect(mockRespondToPlanApproval).not.toHaveBeenCalled();
		});

		it("routes plan approval replies through explicit reply handlers when provided", async () => {
			await Effect.runPromise(
				replyToPlanApprovalRequest(
					{
						id: "plan-http",
						kind: "plan_approval",
						source: "create_plan",
						sessionId: "session-plan",
						tool: {
							messageID: "message-plan",
							callID: "tool-plan",
						},
						replyHandler: {
							kind: "http",
							requestId: "plan-http-route",
						},
						status: "pending",
					},
					true,
					false
				)
			);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-plan",
				interactionId: "plan-http",
				replyHandler: {
					kind: "http",
					requestId: "plan-http-route",
				},
				payload: {
					kind: "plan_approval",
					approved: true,
				},
			});
			expect(mockRespondToPlanApproval).not.toHaveBeenCalled();
		});
	});

	describe("replyToComputerPermissionRequest", () => {
		it("routes local computer permission approvals through the canonical interaction command", async () => {
			await Effect.runPromise(
				replyToComputerPermissionRequest(
					{
						id: "computer-permission-1",
						kind: "computer_permission",
						sessionId: "session-computer",
						permissionKind: "app_window_scope",
						reason: "Allow computer use for Safari / GitHub?",
						app: "Safari",
						window: "GitHub",
						status: "pending",
					},
					true
				)
			);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-computer",
				interactionId: "computer-permission-1",
				replyHandler: {
					kind: "http",
					requestId: "computer-permission-1",
				},
				payload: {
					kind: "computer_permission",
					accepted: true,
					scope: "once",
				},
			});
		});

		it("routes persistent computer permission approvals with always scope", async () => {
			await Effect.runPromise(
				replyToComputerPermissionRequest(
					{
						id: "computer-permission-3",
						kind: "computer_permission",
						sessionId: "session-computer",
						permissionKind: "app_window_scope",
						reason: "Allow computer use for Safari / GitHub?",
						app: "Safari",
						window: "GitHub",
						status: "pending",
					},
					true,
					"always"
				)
			);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-computer",
				interactionId: "computer-permission-3",
				replyHandler: {
					kind: "http",
					requestId: "computer-permission-3",
				},
				payload: {
					kind: "computer_permission",
					accepted: true,
					scope: "always",
				},
			});
		});

		it("routes local computer permission rejections through the canonical interaction command", async () => {
			await Effect.runPromise(
				replyToComputerPermissionRequest(
					{
						id: "computer-permission-2",
						kind: "computer_permission",
						sessionId: "session-computer",
						permissionKind: "screen_recording",
						reason: "Acepe needs Screen Recording.",
						status: "pending",
					},
					false
				)
			);

			expect(mockReplyInteraction).toHaveBeenCalledWith({
				sessionId: "session-computer",
				interactionId: "computer-permission-2",
				replyHandler: {
					kind: "http",
					requestId: "computer-permission-2",
				},
				payload: {
					kind: "computer_permission",
					accepted: false,
					scope: "once",
				},
			});
		});
	});
});
