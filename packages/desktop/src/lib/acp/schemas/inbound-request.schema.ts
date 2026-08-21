/**
 * Schemas for inbound JSON-RPC requests from the ACP subprocess.
 *
 * Validates JSON-RPC envelope and method-specific params (e.g., requestPermission).
 * Used by inbound-request-handler to parse unknown payloads without type assertions.
 */

import { decodeUnknown } from "@acepe/effect-result/decodeUnknown";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { JsonValue, ToolArguments } from "../../services/converted-session-types.js";
import type { AcpError } from "../errors/index.js";
import { ProtocolError } from "../errors/index.js";

function schemaErrorToProtocolError(error: { readonly message: string }, context?: string): ProtocolError {
	const message = context ? `${context}: ${error.message}` : error.message;
	return new ProtocolError(message, error);
}

/**
 * JSON-RPC 2.0 request envelope from the ACP subprocess.
 */
const JsonRpcRequestFieldsSchema = Schema.Struct({
	id: Schema.Number,
	jsonrpc: Schema.optionalKey(Schema.String),
	method: Schema.String,
	params: Schema.Unknown,
});

export type JsonRpcRequest = {
	readonly id: number;
	readonly jsonrpc: string;
	readonly method: string;
	readonly params: unknown;
};

const PermissionOptionSchema = Schema.Struct({
	kind: Schema.String,
	name: Schema.String,
	optionId: Schema.String,
});

const SparseToolCallSchema = Schema.Struct({
	toolCallId: Schema.optionalKey(Schema.String),
	rawInput: Schema.optionalKey(Schema.Unknown),
	/** Rust-parsed ToolArguments from rawInput — agent-agnostic. */
	parsedArguments: Schema.optionalKey(Schema.Unknown),
	title: Schema.optionalKey(Schema.String),
	name: Schema.optionalKey(Schema.String),
});

type SparseToolCall = typeof SparseToolCallSchema.Type;

export type RequestPermissionParams = {
	readonly sessionId: string;
	readonly options: ReadonlyArray<typeof PermissionOptionSchema.Type>;
	readonly toolCall: {
		readonly toolCallId: string | undefined;
		readonly rawInput: JsonValue;
		readonly parsedArguments: ToolArguments | undefined;
		readonly title: string | undefined;
		readonly name: string | undefined;
	};
};

const RequestPermissionParamsFieldsSchema = Schema.Struct({
	sessionId: Schema.String,
	options: Schema.optionalKey(Schema.Array(PermissionOptionSchema)),
	toolCall: Schema.optionalKey(SparseToolCallSchema),
});

/**
 * Minimal schema for sendErrorResponse - only need sessionId from params.
 */
export const ErrorResponseParamsSchema = Schema.Struct({
	sessionId: Schema.optionalKey(Schema.String),
});

export type ErrorResponseParams = typeof ErrorResponseParamsSchema.Type;

const decodeJsonRpcRequestFields = decodeUnknown(JsonRpcRequestFieldsSchema, (error) =>
	schemaErrorToProtocolError(error, "Invalid JSON-RPC request")
);

const decodeRequestPermissionParamsFields = decodeUnknown(
	RequestPermissionParamsFieldsSchema,
	(error) => schemaErrorToProtocolError(error, "Invalid requestPermission params")
);

const decodeErrorResponseParams = decodeUnknown(ErrorResponseParamsSchema, (error) =>
	schemaErrorToProtocolError(error)
);

function normalizeToolCall(toolCall: SparseToolCall | undefined): RequestPermissionParams["toolCall"] {
	return {
		toolCallId: toolCall?.toolCallId,
		rawInput: (toolCall?.rawInput ?? {}) as JsonValue,
		parsedArguments: toolCall?.parsedArguments as ToolArguments | undefined,
		title: toolCall?.title,
		name: toolCall?.name,
	};
}

/**
 * Parses unknown payload into a validated JSON-RPC request.
 */
export function parseInboundRequest(payload: unknown): Result.Result<JsonRpcRequest, AcpError> {
	const decoded = decodeJsonRpcRequestFields(payload);
	if (Result.isFailure(decoded)) {
		return Result.fail(decoded.failure);
	}

	return Result.succeed({
		id: decoded.success.id,
		jsonrpc: decoded.success.jsonrpc ?? "2.0",
		method: decoded.success.method,
		params: decoded.success.params,
	});
}

/**
 * Parses unknown params into validated RequestPermissionParams.
 */
export function parseRequestPermissionParams(
	params: unknown
): Result.Result<RequestPermissionParams, AcpError> {
	const decoded = decodeRequestPermissionParamsFields(params);
	if (Result.isFailure(decoded)) {
		return Result.fail(decoded.failure);
	}

	return Result.succeed({
		sessionId: decoded.success.sessionId,
		options: decoded.success.options ?? [],
		toolCall: normalizeToolCall(decoded.success.toolCall),
	});
}

export function parseErrorResponseParams(params: unknown): ErrorResponseParams | undefined {
	const decoded = decodeErrorResponseParams(params);
	if (Result.isFailure(decoded)) {
		return undefined;
	}
	return decoded.success;
}
