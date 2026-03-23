/**
 * Schemas for inbound JSON-RPC requests from the ACP subprocess.
 *
 * Validates JSON-RPC envelope and method-specific params (e.g., requestPermission).
 * Used by inbound-request-handler to parse unknown payloads without type assertions.
 */

import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import type { AcpError } from "../errors/index.js";
import { ProtocolError } from "../errors/index.js";
import { QuestionItemSchema } from "./tool-call-content.schema.js";

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

/**
 * Question data for AskUserQuestion tool (from _meta.askUserQuestion or rawInput.questions).
 */
export const AskUserQuestionDataSchema = z.object({
	questions: z.array(QuestionItemSchema),
});
export type AskUserQuestionData = z.infer<typeof AskUserQuestionDataSchema>;

/**
 * rawInput shape when tool is AskUserQuestion (upstream v0.18+).
 * Questions come from rawInput.questions instead of _meta.askUserQuestion.
 */
export const RawInputWithQuestionsSchema = z.object({
	questions: z.array(QuestionItemSchema),
});

const PermissionOptionSchema = z.object({
	kind: z.string(),
	name: z.string(),
	optionId: z.string(),
});

const ToolCallSchema = z.object({
	toolCallId: z.string(),
	rawInput: z.unknown(),
	/** Rust-parsed ToolArguments from rawInput — agent-agnostic. */
	parsedArguments: z.unknown().optional(),
	title: z.string().optional(),
	name: z.string().optional(),
});

/**
 * Parameters for client/requestPermission method.
 */
export const RequestPermissionParamsSchema = z
	.object({
		sessionId: z.string(),
		options: z.array(PermissionOptionSchema),
		toolCall: ToolCallSchema,
		_meta: z
			.object({
				askUserQuestion: AskUserQuestionDataSchema.optional(),
			})
			.optional(),
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
