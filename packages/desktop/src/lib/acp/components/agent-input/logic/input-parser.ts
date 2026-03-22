import { err, ok, type Result } from "neverthrow";

import { FILE_PICKER_TRIGGER, SLASH_COMMAND_TRIGGER } from "../constants/agent-input-constants.js";
import { ValidationError } from "../errors/agent-input-error.js";

/**
 * Fast check for whether a message contains any autocomplete trigger characters.
 * Used as a hot-path guard to skip expensive DOM measurement (cursor offset,
 * caret positioning via getBoundingClientRect) on every keystroke.
 *
 * Note: inline artefact tokens (e.g., `@[file:path]`) always contain the
 * file-picker trigger character, so messages with artefacts correctly return true.
 */
export function hasAutocompleteTrigger(message: string): boolean {
	return message.includes(FILE_PICKER_TRIGGER) || message.includes(SLASH_COMMAND_TRIGGER);
}

function isInsideInlineArtefact(message: string, index: number): boolean {
	if (index < 0 || index >= message.length) {
		return false;
	}

	const tokenStart = message.lastIndexOf("@[", index);
	if (tokenStart < 0) {
		return false;
	}

	const tokenEnd = message.lastIndexOf("]", index);
	return tokenStart > tokenEnd;
}
/**
 * Result of parsing a trigger in the input text.
 */
export interface TriggerParseResult {
	/**
	 * Start index of the trigger character in the message.
	 */
	readonly startIndex: number;

	/**
	 * Query text after the trigger character.
	 */
	readonly query: string;
}

/**
 * Parses the input text to detect if a file picker trigger (@) should be shown.
 *
 * @param message - The full message text
 * @param cursorPos - Current cursor position in the message
 * @returns Result containing trigger info if found, or null if not triggered
 *
 * @example
 * ```ts
 * const result = parseFilePickerTrigger("Hello @file", 12);
 * if (result.isOk() && result.value) {
 *   // Show file picker at result.value.startIndex with query result.value.query
 * }
 * ```
 */
export function parseFilePickerTrigger(
	message: string,
	cursorPos: number
): Result<TriggerParseResult | null, ValidationError> {
	if (cursorPos < 0 || cursorPos > message.length) {
		return err(
			new ValidationError(
				`Invalid cursor position: ${cursorPos} (message length: ${message.length})`,
				"cursorPos"
			)
		);
	}

	const textBeforeCursor = message.substring(0, cursorPos);
	const lastAtIndex = textBeforeCursor.lastIndexOf(FILE_PICKER_TRIGGER);

	if (lastAtIndex < 0) {
		return ok(null);
	}
	if (isInsideInlineArtefact(message, lastAtIndex)) {
		return ok(null);
	}

	// Check if @ is at start or after whitespace
	const charBefore = lastAtIndex === 0 ? " " : textBeforeCursor[lastAtIndex - 1];

	if (charBefore !== " " && charBefore !== "\n" && lastAtIndex !== 0) {
		return ok(null);
	}

	// Check there's no space after the @ (still typing)
	const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);

	if (textAfterAt.includes(" ")) {
		return ok(null);
	}

	const result = {
		startIndex: lastAtIndex,
		query: textAfterAt,
	};

	return ok(result);
}

/**
 * Parses the input text to detect if a slash command trigger (/) should be shown.
 *
 * @param message - The full message text
 * @param cursorPos - Current cursor position in the message
 * @returns Result containing trigger info if found, or null if not triggered
 *
 * @example
 * ```ts
 * const result = parseSlashCommandTrigger("Hello /cmd", 12);
 * if (result.isOk() && result.value) {
 *   // Show slash command dropdown at result.value.startIndex with query result.value.query
 * }
 * ```
 */
export function parseSlashCommandTrigger(
	message: string,
	cursorPos: number
): Result<TriggerParseResult | null, ValidationError> {
	if (cursorPos < 0 || cursorPos > message.length) {
		return err(
			new ValidationError(
				`Invalid cursor position: ${cursorPos} (message length: ${message.length})`,
				"cursorPos"
			)
		);
	}

	const textBeforeCursor = message.substring(0, cursorPos);
	const lastSlashIndex = textBeforeCursor.lastIndexOf(SLASH_COMMAND_TRIGGER);

	if (lastSlashIndex < 0) {
		return ok(null);
	}
	if (isInsideInlineArtefact(message, lastSlashIndex)) {
		return ok(null);
	}

	// Check if / is at start or after whitespace
	const charBefore = lastSlashIndex === 0 ? " " : textBeforeCursor[lastSlashIndex - 1];

	if (charBefore !== " " && charBefore !== "\n" && lastSlashIndex !== 0) {
		return ok(null);
	}

	// Check there's no space after the / (still typing command)
	const textAfterSlash = textBeforeCursor.substring(lastSlashIndex + 1);

	if (textAfterSlash.includes(" ")) {
		return ok(null);
	}

	const result = {
		startIndex: lastSlashIndex,
		query: textAfterSlash,
	};

	return ok(result);
}
