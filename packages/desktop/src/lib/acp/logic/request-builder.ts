import { ok, type Result } from "neverthrow";
import type { AcpMethod } from "../constants/methods.js";
import { JSON_RPC_VERSION } from "../constants/protocol.js";
import type { ProtocolError } from "../errors/protocol-error.js";
import { safeJsonStringify } from "./json-utils.js";

/**
 * JSON-RPC request structure.
 */
type JsonRpcRequest = {
	jsonrpc: string;
	id: number;
	method: string;
	params: unknown;
};

/**
 * Builds a JSON-RPC request.
 *
 * @param method - The ACP method name
 * @param params - The method parameters
 * @param requestId - Unique request identifier
 * @returns Result containing the JSON-RPC request object or an error
 *
 * @example
 * ```typescript
 * const result = buildRequest('initialize', { protocolVersion: 1 }, 1);
 * result.map(request => console.log(JSON.stringify(request)));
 * ```
 */
export function buildRequest(
	method: AcpMethod,
	params: unknown,
	requestId: number
): Result<JsonRpcRequest, ProtocolError> {
	const request: JsonRpcRequest = {
		jsonrpc: JSON_RPC_VERSION,
		id: requestId,
		method,
		params,
	};

	return ok(request);
}

/**
 * Serializes a JSON-RPC request to a string.
 *
 * @param request - The JSON-RPC request object
 * @returns Result containing the serialized request string or an error
 *
 * @example
 * ```typescript
 * const result = serializeRequest(request);
 * result.map(str => console.log(str));
 * ```
 */
export function serializeRequest(request: JsonRpcRequest): Result<string, ProtocolError> {
	return safeJsonStringify(request);
}
