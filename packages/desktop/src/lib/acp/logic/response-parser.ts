import { err, ok, type Result } from "neverthrow";

import { ProtocolError } from "../errors/protocol-error.js";
import { safeJsonParse } from "./json-utils.js";

/**
 * JSON-RPC response structure.
 */
type JsonRpcResponse = {
	jsonrpc: string;
	id?: number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
};

/**
 * Parses a JSON-RPC response string.
 *
 * @param responseStr - The JSON-RPC response string
 * @returns Result containing the parsed response object or an error
 *
 * @example
 * ```typescript
 * const result = parseResponse('{"jsonrpc":"2.0","id":1,"result":{}}');
 * result.map(response => console.log(response));
 * ```
 */
export function parseResponse(responseStr: string): Result<JsonRpcResponse, ProtocolError> {
	return safeJsonParse<JsonRpcResponse>(responseStr).andThen((parsed: JsonRpcResponse) => {
		// Validate JSON-RPC version
		if (parsed.jsonrpc !== "2.0") {
			return err(new ProtocolError(`Invalid JSON-RPC version: ${parsed.jsonrpc}`));
		}

		return ok(parsed);
	});
}

/**
 * Extracts the result from a JSON-RPC response.
 *
 * @param response - The parsed JSON-RPC response
 * @returns Result containing the response result or an error
 *
 * @example
 * ```typescript
 * const result = extractResult(response);
 * result.map(data => console.log(data));
 * ```
 */
export function extractResult(response: JsonRpcResponse): Result<unknown, ProtocolError> {
	// Check for JSON-RPC error
	if (response.error) {
		return err(
			new ProtocolError(
				`JSON-RPC error: ${response.error.message} (code: ${response.error.code})`,
				response.error
			)
		);
	}

	// Check for result
	if (response.result === undefined) {
		return err(new ProtocolError("No result in JSON-RPC response"));
	}

	return ok(response.result);
}

/**
 * Validates that a response matches a specific request ID.
 *
 * @param response - The parsed JSON-RPC response
 * @param requestId - The expected request ID
 * @returns Result containing the response if valid, or an error
 *
 * @example
 * ```typescript
 * const result = validateResponseId(response, 1);
 * result.map(res => console.log('Valid response'));
 * ```
 */
export function validateResponseId(
	response: JsonRpcResponse,
	requestId: number
): Result<JsonRpcResponse, ProtocolError> {
	if (response.id === undefined) {
		return err(new ProtocolError("Response missing ID (may be a notification)"));
	}

	if (response.id !== requestId) {
		return err(
			new ProtocolError(`Response ID mismatch: expected ${requestId}, got ${response.id}`)
		);
	}

	return ok(response);
}
