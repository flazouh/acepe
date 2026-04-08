import { err, ok, type Result } from "neverthrow";

import type { JsonValue, ToolArguments } from "../../services/converted-session-types.js";
import type { AcpError } from "../errors/index.js";
import {
	type AskUserQuestionData,
	type JsonRpcRequest,
	parseRequestPermissionParams,
	RawInputWithQuestionsSchema,
	type RequestPermissionParams,
} from "../schemas/inbound-request.schema.js";
import {
	buildAcpPermissionId,
	createPermissionRequest,
	type PermissionRequest,
} from "../types/permission.js";
import type { QuestionRequest } from "../types/question.js";
import { createLegacyInteractionReplyHandler } from "../types/reply-handler.js";

interface NormalizedInboundInteractionBase {
	sessionId: string;
	jsonRpcRequestId: number;
	toolCallId: string;
	toolLabel: string;
	rawInput: JsonValue;
	parsedArguments: ToolArguments | undefined;
	options: RequestPermissionParams["options"];
	alwaysOptionIds: string[];
}

export interface NormalizedInboundPermissionRequest extends NormalizedInboundInteractionBase {
	kind: "permission";
}

export interface NormalizedInboundQuestionRequest extends NormalizedInboundInteractionBase {
	kind: "question";
	questions: QuestionRequest["questions"];
}

export type NormalizedInboundInteractionRequest =
	| NormalizedInboundPermissionRequest
	| NormalizedInboundQuestionRequest;

function getNormalizedToolLabel(toolCall: RequestPermissionParams["toolCall"]): string {
	if (toolCall.title !== undefined) {
		return toolCall.title;
	}

	if (toolCall.name !== undefined) {
		return toolCall.name;
	}

	return "Execute tool";
}

function normalizeQuestionItems(
	questions: AskUserQuestionData["questions"]
): QuestionRequest["questions"] {
	return questions.map((question) => ({
		question: question.question,
		header: question.header !== undefined ? question.header : "",
		options:
			question.options !== undefined
				? question.options.map((option) => ({
						label: option.label,
						description: option.description !== undefined ? option.description : "",
					}))
				: [],
		multiSelect: question.multiSelect !== undefined ? question.multiSelect : false,
	}));
}

function extractNormalizedQuestions(
	params: RequestPermissionParams
): QuestionRequest["questions"] | null {
	const askUserQuestion = params._meta?.askUserQuestion;
	if (askUserQuestion !== undefined) {
		return normalizeQuestionItems(askUserQuestion.questions);
	}

	const toolName =
		params.toolCall.name !== undefined ? params.toolCall.name : params.toolCall.title;
	const rawInputResult = RawInputWithQuestionsSchema.safeParse(params.toolCall.rawInput);
	if (toolName === "AskUserQuestion" && rawInputResult.success) {
		return normalizeQuestionItems(rawInputResult.data.questions);
	}

	return null;
}

function buildNormalizedBase(
	request: JsonRpcRequest,
	params: RequestPermissionParams
): NormalizedInboundInteractionBase {
	return {
		sessionId: params.sessionId,
		jsonRpcRequestId: request.id,
		toolCallId: params.toolCall.toolCallId,
		toolLabel: getNormalizedToolLabel(params.toolCall),
		rawInput: params.toolCall.rawInput,
		parsedArguments: params.toolCall.parsedArguments,
		options: params.options,
		alwaysOptionIds: params.options
			.filter((option) => option.kind === "allow_always")
			.map((option) => option.optionId),
	};
}

export function normalizeInboundInteractionRequest(
	request: JsonRpcRequest
): Result<NormalizedInboundInteractionRequest, AcpError> {
	const paramsResult = parseRequestPermissionParams(request.params);
	if (paramsResult.isErr()) {
		return err(paramsResult.error);
	}

	const params = paramsResult.value;
	const base = buildNormalizedBase(request, params);
	const questions = extractNormalizedQuestions(params);

	if (questions !== null) {
		return ok({
			kind: "question",
			sessionId: base.sessionId,
			jsonRpcRequestId: base.jsonRpcRequestId,
			toolCallId: base.toolCallId,
			toolLabel: base.toolLabel,
			rawInput: base.rawInput,
			parsedArguments: base.parsedArguments,
			options: base.options,
			alwaysOptionIds: base.alwaysOptionIds,
			questions,
		});
	}

	return ok({
		kind: "permission",
		sessionId: base.sessionId,
		jsonRpcRequestId: base.jsonRpcRequestId,
		toolCallId: base.toolCallId,
		toolLabel: base.toolLabel,
		rawInput: base.rawInput,
		parsedArguments: base.parsedArguments,
		options: base.options,
		alwaysOptionIds: base.alwaysOptionIds,
	});
}

export function toPermissionRequest(
	request: NormalizedInboundInteractionRequest
): PermissionRequest {
	return createPermissionRequest({
		id: buildAcpPermissionId(request.sessionId, request.toolCallId, request.jsonRpcRequestId),
		sessionId: request.sessionId,
		jsonRpcRequestId: request.jsonRpcRequestId,
		replyHandler: createLegacyInteractionReplyHandler(
			buildAcpPermissionId(request.sessionId, request.toolCallId, request.jsonRpcRequestId),
			request.jsonRpcRequestId
		),
		permission: request.toolLabel,
		patterns: [],
		metadata: {
			rawInput: request.rawInput,
			parsedArguments: request.parsedArguments,
			options: request.options,
		},
		always: request.alwaysOptionIds,
		tool: {
			messageID: "",
			callID: request.toolCallId,
		},
	});
}

export function toQuestionRequest(request: NormalizedInboundQuestionRequest): QuestionRequest {
	return {
		id: request.toolCallId,
		sessionId: request.sessionId,
		jsonRpcRequestId: request.jsonRpcRequestId,
		replyHandler: createLegacyInteractionReplyHandler(request.toolCallId, request.jsonRpcRequestId),
		questions: request.questions,
		tool: {
			messageID: "",
			callID: request.toolCallId,
		},
	};
}
