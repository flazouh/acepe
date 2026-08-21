import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ProtocolError } from "../errors/protocol-error.js";

/**
 * Safely parses a JSON string without throwing.
 *
 * Uses Effect fromThrowable to wrap JSON.parse and convert
 * exceptions to Results.
 *
 * @param jsonStr - The JSON string to parse
 * @returns Result containing the parsed object or an error
 */
export function safeJsonParse<T = unknown>(jsonStr: string): Result.Result<T, ProtocolError> {
	const parseFn = fromThrowable(
		(str: string): T => JSON.parse(str) as T,
		(error) => new ProtocolError(`Failed to parse JSON: ${error}`, error)
	);

	return Effect.runSync(Effect.result(parseFn(jsonStr)));
}

/**
 * Safely stringifies an object without throwing.
 *
 * Uses Effect fromThrowable to wrap JSON.stringify and convert
 * exceptions to Results.
 *
 * @param value - The value to stringify
 * @returns Result containing the JSON string or an error
 */
export function safeJsonStringify(value: unknown): Result.Result<string, ProtocolError> {
	const stringifyFn = fromThrowable(
		(val: unknown): string => JSON.stringify(val),
		(error) => new ProtocolError(`Failed to stringify JSON: ${error}`, error)
	);

	return Effect.runSync(Effect.result(stringifyFn(value)));
}
