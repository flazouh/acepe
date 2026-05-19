/**
 * Schemas for inbound JSON-RPC requests from the ACP subprocess.
 *
 * Validates JSON-RPC envelope and method-specific params (e.g., requestPermission).
 * Used by inbound-request-handler to parse unknown payloads without type assertions.
 */

import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import type { JsonValue, ToolArguments } from "../../services/converted-session-types.js";
import type { AcpError } from "../errors/index.js";
import { ProtocolError } from "../errors/index.js";

/**
 * Maps a Zod parse error to ProtocolError for neverthrow Result types.
 */
export function zodErrorToProtocolError(zodError: z.ZodError, context?: string): ProtocolError {
	const message = context ? `${context}: ${zodError.message}` : zodError.message;
	return new ProtocolError(message, zodError);
}

/**
 * JSON-RPC 2.0 request envelope from the ACP subprocess.
 */
export const JsonRpcRequestSchema = z.object({
	id: z.number(),
	jsonrpc: z.string().default("2.0"),
	method: z.string(),
	params: z.unknown(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

const PermissionOptionSchema = z.object({
	kind: z.string(),
	name: z.string(),
	optionId: z.string(),
});

const SparseToolCallSchema = z.object({
	toolCallId: z.string().optional(),
	rawInput: z.custom<JsonValue>().optional(),
	/** Rust-parsed ToolArguments from rawInput — agent-agnostic. */
	parsedArguments: z.custom<ToolArguments>().optional(),
	title: z.string().optional(),
	name: z.string().optional(),
});

const ToolCallSchema = SparseToolCallSchema.optional().transform((toolCall) => ({
	toolCallId: toolCall?.toolCallId,
	rawInput: toolCall?.rawInput ?? {},
	parsedArguments: toolCall?.parsedArguments,
	title: toolCall?.title,
	name: toolCall?.name,
}));

/**
 * Parameters for client/requestPermission method.
 */
export const RequestPermissionParamsSchema = z
	.object({
		sessionId: z.string(),
		options: z.array(PermissionOptionSchema).optional().default([]),
		toolCall: ToolCallSchema,
	})
	.passthrough();
export type RequestPermissionParams = z.infer<typeof RequestPermissionParamsSchema>;

/**
 * Minimal schema for sendErrorResponse - only need sessionId from params.
 */
export const ErrorResponseParamsSchema = z.object({
	sessionId: z.string().optional(),
});

/**
 * Parses unknown payload into a validated JSON-RPC request.
 */
export function parseInboundRequest(payload: unknown): Result<JsonRpcRequest, AcpError> {
	const result = JsonRpcRequestSchema.safeParse(payload);
	return result.success
		? ok(result.data)
		: err(zodErrorToProtocolError(result.error, "Invalid JSON-RPC request"));
}

/**
 * Parses unknown params into validated RequestPermissionParams.
 */
export function parseRequestPermissionParams(
	params: unknown
): Result<RequestPermissionParams, AcpError> {
	const result = RequestPermissionParamsSchema.safeParse(params);
	return result.success
		? ok(result.data)
		: err(zodErrorToProtocolError(result.error, "Invalid requestPermission params"));
}
