import { errAsync, ok, type ResultAsync } from "neverthrow";
import { tauriClient } from "../../utils/tauri-client.js";
import type { AcpMethod } from "../constants/methods.js";
import { ProtocolError } from "../errors/protocol-error.js";
import { buildRequest, serializeRequest } from "./request-builder.js";

/**
 * Request ID generator.
 *
 * Generates unique request IDs for JSON-RPC requests.
 */
class RequestIdGenerator {
	private nextId = 1;

	/**
	 * Gets the next request ID.
	 *
	 * @returns The next unique request ID
	 */
	next(): number {
		return this.nextId++;
	}

	/**
	 * Resets the request ID counter.
	 */
	reset(): void {
		this.nextId = 1;
	}
}

/**
 * JSON-RPC client for communicating with Tauri backend.
 *
 * This client handles JSON-RPC protocol communication by:
 * 1. Building requests with proper formatting
 * 2. Sending requests via Tauri invoke
 * 3. Parsing and validating responses
 * 4. Extracting results or errors
 *
 * All operations use neverthrow Result types for error handling.
 */
export class JsonRpcClient {
	private readonly requestIdGenerator: RequestIdGenerator;

	/**
	 * Creates a new JSON-RPC client.
	 */
	constructor() {
		this.requestIdGenerator = new RequestIdGenerator();
	}

	/**
	 * Sends a JSON-RPC request to the Tauri backend.
	 *
	 * @param method - The ACP method name
	 * @param params - The method parameters
	 * @returns ResultAsync containing the response result or an error
	 *
	 * @example
	 * ```typescript
	 * const result = await client.sendRequest('initialize', { protocolVersion: 1 });
	 * result.map(data => console.log('Success:', data));
	 * ```
	 */
	sendRequest(method: AcpMethod, params: unknown): ResultAsync<unknown, ProtocolError> {
		const requestId = this.requestIdGenerator.next();

		// Build the request
		const requestResult = buildRequest(method, params, requestId);

		if (requestResult.isErr()) {
			return errAsync(requestResult.error);
		}

		const request = requestResult.value;

		// Serialize the request
		const serializedResult = serializeRequest(request);

		if (serializedResult.isErr()) {
			return errAsync(serializedResult.error);
		}

		return tauriClient.acp
			.rpcCall(method.replace("/", "_"), params as Record<string, unknown>)
			.mapErr((error) => new ProtocolError(`Failed to invoke Tauri command: ${error}`, error))
			.andThen((response) => ok(response));
	}

	/**
	 * Resets the request ID generator.
	 *
	 * Useful for testing or when restarting the connection.
	 */
	reset(): void {
		this.requestIdGenerator.reset();
	}
}
