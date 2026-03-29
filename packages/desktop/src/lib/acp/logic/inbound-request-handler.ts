/**
 * Inbound Request Handler - Handles JSON-RPC requests FROM the ACP subprocess.
 *
 * The ACP subprocess can send requests TO the client (not just responses).
 * The most common example is `session/request_permission` where the subprocess
 * needs user approval before executing a tool.
 *
 * This handler:
 * 1. Listens to `acp-inbound-request` events from the ACP event bridge stream
 * 2. Parses the JSON-RPC request
 * 3. Dispatches to the appropriate handler (e.g., permission store)
 * 4. Sends the JSON-RPC response back via the Tauri command
 */

import { okAsync, type Result, type ResultAsync } from "neverthrow";
import { ACP_INBOUND_METHODS } from "../constants/acp-methods.js";
import type { AcpError } from "../errors/index.js";
import { ProtocolError } from "../errors/index.js";

import {
	type AskUserQuestionData,
	ErrorResponseParamsSchema,
	type JsonRpcRequest,
	parseInboundRequest,
	parseRequestPermissionParams,
	RawInputWithQuestionsSchema,
	type RequestPermissionParams,
} from "../schemas/inbound-request.schema.js";
import { api } from "../store/api.js";
import {
	buildAcpPermissionId,
	type AcpPermissionRequest,
	type PermissionRequest,
} from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import { createLogger } from "../utils/logger.js";
import { openAcpEventSource } from "./acp-event-bridge.js";

const logger = createLogger({
	id: "inbound-request-handler",
	name: "Inbound Request Handler",
});

/**
 * Callback type for permission request events.
 */
export type OnPermissionRequest = (permission: PermissionRequest) => void;

/**
 * Callback type for question request events (AskUserQuestion tool).
 */
export type OnQuestionRequest = (question: QuestionRequest) => void;

/**
 * Handler for inbound JSON-RPC requests from the ACP subprocess.
 */
export class InboundRequestHandler {
	private unlistenFn: (() => void) | null = null;
	private onPermissionRequest: OnPermissionRequest | null = null;
	private onQuestionRequest: OnQuestionRequest | null = null;

	/**
	 * Start listening for inbound requests.
	 *
	 * @param onPermissionRequest - Callback for permission requests
	 * @param onQuestionRequest - Callback for question requests (AskUserQuestion)
	 */
	start(
		onPermissionRequest: OnPermissionRequest,
		onQuestionRequest?: OnQuestionRequest
	): ResultAsync<void, AcpError> {
		logger.info("InboundRequestHandler.start() called");

		if (this.unlistenFn !== null) {
			logger.debug("Inbound request handler already running, skipping duplicate start");
			this.onPermissionRequest = onPermissionRequest;
			this.onQuestionRequest = onQuestionRequest !== undefined ? onQuestionRequest : null;
			return okAsync(undefined);
		}

		this.onPermissionRequest = onPermissionRequest;
		this.onQuestionRequest = onQuestionRequest !== undefined ? onQuestionRequest : null;

		return openAcpEventSource((envelope) => {
			if (envelope.eventName !== "acp-inbound-request") {
				return;
			}
			this.handleEvent(envelope.payload);
		})
			.map((unlisten) => {
				this.unlistenFn = unlisten;
				logger.info("Inbound request handler started successfully");
			})
			.mapErr(
				(error) => new ProtocolError(`Failed to listen for inbound requests: ${error}`, error)
			);
	}

	/**
	 * Stop listening for inbound requests.
	 */
	stop(): void {
		if (this.unlistenFn) {
			this.unlistenFn();
			this.unlistenFn = null;
			logger.info("Inbound request handler stopped");
		}
	}

	/**
	 * Handle a raw event payload.
	 */
	private handleEvent(payload: unknown): void {
		logger.debug("handleEvent entry", {
			payloadType: typeof payload,
			payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
		});

		const parseResult = this.parseRequest(payload);

		if (parseResult.isErr()) {
			logger.error("Failed to parse inbound request:", parseResult.error);
			return;
		}

		const request = parseResult.value;
		logger.debug("Received inbound request", { method: request.method, id: request.id });

		switch (request.method) {
			case ACP_INBOUND_METHODS.REQUEST_PERMISSION:
				this.handlePermissionRequest(request);
				break;
			default:
				logger.warn("Unknown inbound request method", { method: request.method });
				// Send error response for unknown methods
				this.sendErrorResponse(request, -32601, "Method not found");
		}
	}

	/**
	 * Parse a raw payload into a JSON-RPC request.
	 */
	private parseRequest(payload: unknown): Result<JsonRpcRequest, AcpError> {
		return parseInboundRequest(payload);
	}

	/**
	 * Handle a client/requestPermission request.
	 *
	 * This method detects if the request is actually a question request
	 * (AskUserQuestion tool) by checking for _meta.askUserQuestion, and
	 * routes to the appropriate callback.
	 */
	private handlePermissionRequest(request: JsonRpcRequest): void {
		const paramsResult = parseRequestPermissionParams(request.params);
		if (paramsResult.isErr()) {
			logger.error("Invalid requestPermission params", { error: paramsResult.error });
			this.sendErrorResponse(request, -32602, "Invalid params");
			return;
		}
		const params = paramsResult.value;

		// Check if this is actually a question request (AskUserQuestion tool).
		// Detection: either _meta.askUserQuestion (legacy fork) or tool name match with questions in rawInput.
		const askUserQuestionData = params._meta?.askUserQuestion;
		if (askUserQuestionData && this.onQuestionRequest) {
			this.handleQuestionRequest(request, params, askUserQuestionData);
			return;
		}

		// Upstream v0.18+: AskUserQuestion goes through canUseTool → requestPermission
		// without _meta.askUserQuestion. Detect by tool name and extract questions from rawInput.
		const toolName = params.toolCall.name !== undefined ? params.toolCall.name : params.toolCall.title;
		const rawInputResult = RawInputWithQuestionsSchema.safeParse(params.toolCall.rawInput);
		if (toolName === "AskUserQuestion" && rawInputResult.success && this.onQuestionRequest) {
			this.handleQuestionRequest(request, params, {
				questions: rawInputResult.data.questions,
			});
			return;
		}

		// Create a permission request with the JSON-RPC request ID
		const permission: AcpPermissionRequest = {
			id: buildAcpPermissionId(params.sessionId, params.toolCall.toolCallId, request.id),
			sessionId: params.sessionId,
			jsonRpcRequestId: request.id,
			permission: params.toolCall.title ? params.toolCall.title : params.toolCall.name ? params.toolCall.name : "Execute tool",
			patterns: [],
			metadata: {
				rawInput: params.toolCall.rawInput,
				parsedArguments: params.toolCall.parsedArguments,
				options: params.options,
			},
			always: params.options.filter((o) => o.kind === "allow_always").map((o) => o.optionId),
			tool: {
				messageID: "",
				callID: params.toolCall.toolCallId,
			},
		};

		logger.debug("Created permission request from inbound request", {
			permissionId: permission.id,
			jsonRpcRequestId: request.id,
		});

		// Dispatch to the registered callback
		if (this.onPermissionRequest) {
			this.onPermissionRequest(permission);
		}
	}

	/**
	 * Handle an AskUserQuestion request that was sent via requestPermission.
	 *
	 * The ACP agent's AskUserQuestion tool uses the requestPermission mechanism
	 * with _meta.askUserQuestion containing the question data.
	 */
	private handleQuestionRequest(
		request: JsonRpcRequest,
		params: RequestPermissionParams,
		questionData: AskUserQuestionData
	): void {
		// Create a question request with the JSON-RPC request ID
		const question: QuestionRequest = {
			id: params.toolCall.toolCallId,
			sessionId: params.sessionId,
			jsonRpcRequestId: request.id,
			questions: questionData.questions.map((q) => ({
				question: q.question,
				header: q.header !== undefined ? q.header : "",
				options: q.options !== undefined
					? q.options.map((opt) => ({
						label: opt.label,
						description: opt.description !== undefined ? opt.description : "",
					}))
					: [],
				multiSelect: q.multiSelect !== undefined ? q.multiSelect : false,
			})),
			tool: {
				messageID: "",
				callID: params.toolCall.toolCallId,
			},
		};

		logger.debug("Created question request from inbound request (AskUserQuestion)", {
			questionId: question.id,
			jsonRpcRequestId: request.id,
			questionCount: question.questions.length,
		});

		// Dispatch to the question callback
		if (this.onQuestionRequest) {
			this.onQuestionRequest(question);
		}
	}

	/**
	 * Send an error response for a failed request.
	 */
	private sendErrorResponse(request: JsonRpcRequest, code: number, message: string): void {
		// For errors, we need to find the sessionId from the params
		const paramsResult = ErrorResponseParamsSchema.safeParse(request.params);
		const sessionId = paramsResult.success ? paramsResult.data.sessionId : undefined;

		if (!sessionId) {
			logger.error("Cannot send error response: no sessionId", { requestId: request.id });
			return;
		}

		const errorResult = {
			error: { code, message },
		};

		api.respondInboundRequest(sessionId, request.id, errorResult).match(
			() => logger.debug("Sent error response", { requestId: request.id }),
			(err) => logger.error("Failed to send error response", { error: err })
		);
	}
}

/**
 * Helper function to respond to a permission request.
 *
 * @param sessionId - The session ID
 * @param jsonRpcRequestId - The JSON-RPC request ID
 * @param allowed - Whether the permission was granted
 * @param optionId - The option ID that was selected (e.g., "allow", "allow_always", "reject")
 */
export function respondToPermission(
	sessionId: string,
	jsonRpcRequestId: number,
	allowed: boolean,
	optionId: string = allowed ? "allow" : "reject"
): ResultAsync<void, AcpError> {
	const result = {
		outcome: {
			outcome: allowed ? "selected" : "cancelled",
			optionId,
		},
	};

	logger.debug("Sending permission response", {
		sessionId,
		jsonRpcRequestId,
		allowed,
		optionId,
	});

	return api.respondInboundRequest(sessionId, jsonRpcRequestId, result).mapErr((error) => {
		logger.error("Failed to send permission response", { error });
		return new ProtocolError(`Failed to send permission response: ${error.message}`, error);
	});
}

/**
 * Helper function to respond to a question request (AskUserQuestion tool).
 *
 * The ACP agent expects the response in a specific format with _meta.answers
 * containing the question answers keyed by question text.
 *
 * @param sessionId - The session ID
 * @param jsonRpcRequestId - The JSON-RPC request ID
 * @param answers - Map of question text to selected answer(s)
 */
export function respondToQuestion(
	sessionId: string,
	jsonRpcRequestId: number,
	answers: Record<string, string | string[]>
): ResultAsync<void, AcpError> {
	// The ACP agent expects: outcome with optionId "allow" so canUseTool accepts it,
	// plus _meta.answers so our patched canUseTool can extract the answers.
	const result = {
		outcome: {
			outcome: "selected",
			optionId: "allow",
		},
		_meta: {
			answers,
		},
	};

	logger.debug("Sending question response", {
		sessionId,
		jsonRpcRequestId,
		answerCount: Object.keys(answers).length,
	});

	return api.respondInboundRequest(sessionId, jsonRpcRequestId, result).mapErr((error) => {
		logger.error("Failed to send question response", { error });
		return new ProtocolError(`Failed to send question response: ${error.message}`, error);
	});
}

/**
 * Helper function to cancel a question request.
 *
 * @param sessionId - The session ID
 * @param jsonRpcRequestId - The JSON-RPC request ID
 */
export function cancelQuestion(
	sessionId: string,
	jsonRpcRequestId: number
): ResultAsync<void, AcpError> {
	const result = {
		outcome: {
			outcome: "cancelled",
		},
	};

	logger.debug("Cancelling question", {
		sessionId,
		jsonRpcRequestId,
	});

	return api.respondInboundRequest(sessionId, jsonRpcRequestId, result).mapErr((error) => {
		logger.error("Failed to cancel question", { error });
		return new ProtocolError(`Failed to cancel question: ${error.message}`, error);
	});
}

/**
 * Helper function to respond to a plan approval request (Cursor create_plan tool).
 *
 * The Rust CursorResponseAdapter reads `{ "approved": bool }` directly.
 *
 * @param sessionId - The session ID
 * @param jsonRpcRequestId - The JSON-RPC request ID from `toolCall.planApprovalRequestId`
 * @param approved - Whether the plan was approved or rejected
 */
export function respondToPlanApproval(
	sessionId: string,
	jsonRpcRequestId: number,
	approved: boolean
): ResultAsync<void, AcpError> {
	const result = { approved };

	logger.debug("Sending plan approval response", {
		sessionId,
		jsonRpcRequestId,
		approved,
	});

	return api.respondInboundRequest(sessionId, jsonRpcRequestId, result).mapErr((error) => {
		logger.error("Failed to send plan approval response", { error });
		return new ProtocolError(`Failed to send plan approval response: ${error.message}`, error);
	});
}
