import * as Result from "effect/Result";

import { ValidationError } from "../errors/agent-input-error.js";

/**
 * Validates a message before sending.
 *
 * @param message - The message text to validate
 * @returns Result containing the trimmed message if valid, or an error
 *
 * @example
 * ```ts
 * const result = validateMessage("  Hello  ");
 * if (Result.isSuccess(result)) {
 *   // Send result.success (trimmed message)
 * }
 * ```
 */
export function validateMessage(message: string): Result.Result<string, ValidationError> {
	if (typeof message !== "string") {
		return Result.fail(new ValidationError("Message must be a string", "message"));
	}

	const trimmed = message.trim();

	if (trimmed.length === 0) {
		return Result.fail(new ValidationError("Message cannot be empty", "message"));
	}

	return Result.succeed(trimmed);
}
