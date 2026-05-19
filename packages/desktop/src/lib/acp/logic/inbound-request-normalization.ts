import { err, ok, type Result } from "neverthrow";

import type { JsonValue, ToolArguments } from "../../services/converted-session-types.js";
import type { AcpError } from "../errors/index.js";
import {
	type JsonRpcRequest,
	parseRequestPermissionParams,
	type RequestPermissionParams,
} from "../schemas/inbound-request.schema.js";
import {
	buildAcpPermissionId,
	createPermissionRequest,
	type PermissionRequest,
} from "../types/permission.js";
import { createLegacyInteractionReplyHandler } from "../types/reply-handler.js";

interface NormalizedInboundInteractionBase {
	sessionId: string;
	jsonRpcRequestId: number;
	toolCallId: string;
	toolLabel: string;
	diagnosticRawInput: JsonValue;
	parsedArguments: ToolArguments | undefined;
	options: RequestPermissionParams["options"];
	alwaysOptionIds: string[];
}

export interface NormalizedInboundPermissionRequest extends NormalizedInboundInteractionBase {
	kind: "permission";
}

export type NormalizedInboundInteractionRequest = NormalizedInboundPermissionRequest;

function getNormalizedToolLabel(toolCall: RequestPermissionParams["toolCall"]): string {
	if (toolCall.title !== undefined) {
		return toolCall.title;
	}

	if (toolCall.name !== undefined) {
		return toolCall.name;
	}

	return "Execute tool";
}

function getNormalizedToolCallId(
	request: JsonRpcRequest,
	toolCall: RequestPermissionParams["toolCall"]
): string {
	if (toolCall.toolCallId !== undefined) {
		return toolCall.toolCallId;
	}

	return `permission-request-${request.id}`;
}

function buildNormalizedBase(
	request: JsonRpcRequest,
	params: RequestPermissionParams
): NormalizedInboundInteractionBase {
	return {
		sessionId: params.sessionId,
		jsonRpcRequestId: request.id,
		toolCallId: getNormalizedToolCallId(request, params.toolCall),
		toolLabel: getNormalizedToolLabel(params.toolCall),
		diagnosticRawInput: params.toolCall.rawInput,
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

	return ok({
		kind: "permission",
		sessionId: base.sessionId,
		jsonRpcRequestId: base.jsonRpcRequestId,
		toolCallId: base.toolCallId,
		toolLabel: base.toolLabel,
		diagnosticRawInput: base.diagnosticRawInput,
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
			diagnosticRawInput: request.diagnosticRawInput,
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
