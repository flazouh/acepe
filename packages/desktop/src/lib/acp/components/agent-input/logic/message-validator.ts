import { err, ok, type Result } from "neverthrow";

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
 * if (result.isOk()) {
 *   // Send result.value (trimmed message)
 * }
 * ```
 */
export function validateMessage(message: string): Result<string, ValidationError> {
	if (typeof message !== "string") {
		return err(new ValidationError("Message must be a string", "message"));
	}

	const trimmed = message.trim();

	if (trimmed.length === 0) {
		return err(new ValidationError("Message cannot be empty", "message"));
	}

	return ok(trimmed);
}
