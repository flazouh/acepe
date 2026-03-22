import { fromThrowable, type Result } from "neverthrow";

import { ProtocolError } from "../errors/protocol-error.js";

/**
 * Safely parses a JSON string without throwing.
 *
 * Uses neverthrow's fromThrowable to wrap JSON.parse and convert
 * exceptions to Results.
 *
 * @param jsonStr - The JSON string to parse
 * @returns Result containing the parsed object or an error
 */
export function safeJsonParse<T = unknown>(jsonStr: string): Result<T, ProtocolError> {
	const parseFn = fromThrowable(
		(str: string): T => JSON.parse(str) as T,
		(error) => new ProtocolError(`Failed to parse JSON: ${error}`, error)
	);

	return parseFn(jsonStr);
}

/**
 * Safely stringifies an object without throwing.
 *
 * Uses neverthrow's fromThrowable to wrap JSON.stringify and convert
 * exceptions to Results.
 *
 * @param value - The value to stringify
 * @returns Result containing the JSON string or an error
 */
export function safeJsonStringify(value: unknown): Result<string, ProtocolError> {
	const stringifyFn = fromThrowable(
		(val: unknown): string => JSON.stringify(val),
		(error) => new ProtocolError(`Failed to stringify JSON: ${error}`, error)
	);

	return stringifyFn(value);
}
