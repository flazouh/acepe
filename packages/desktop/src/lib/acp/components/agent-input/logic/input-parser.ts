import * as Result from "effect/Result";

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
 */
export function parseFilePickerTrigger(
	message: string,
	cursorPos: number
): Result.Result<TriggerParseResult | null, ValidationError> {
	if (cursorPos < 0 || cursorPos > message.length) {
		return Result.fail(
			new ValidationError(
				`Invalid cursor position: ${cursorPos} (message length: ${message.length})`,
				"cursorPos"
			)
		);
	}

	const textBeforeCursor = message.substring(0, cursorPos);
	const lastAtIndex = textBeforeCursor.lastIndexOf(FILE_PICKER_TRIGGER);

	if (lastAtIndex < 0) {
		return Result.succeed(null);
	}
	if (isInsideInlineArtefact(message, lastAtIndex)) {
		return Result.succeed(null);
	}

	// Check if @ is at start or after whitespace
	const charBefore = lastAtIndex === 0 ? " " : textBeforeCursor[lastAtIndex - 1];

	if (charBefore !== " " && charBefore !== "\n" && lastAtIndex !== 0) {
		return Result.succeed(null);
	}

	// Check there's no space after the @ (still typing)
	const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);

	if (textAfterAt.includes(" ")) {
		return Result.succeed(null);
	}

	const result = {
		startIndex: lastAtIndex,
		query: textAfterAt,
	};

	return Result.succeed(result);
}

/**
 * Parses the input text to detect if a slash command trigger (/) should be shown.
 *
 * @param message - The full message text
 * @param cursorPos - Current cursor position in the message
 * @returns Result containing trigger info if found, or null if not triggered
 */
export function parseSlashCommandTrigger(
	message: string,
	cursorPos: number
): Result.Result<TriggerParseResult | null, ValidationError> {
	if (cursorPos < 0 || cursorPos > message.length) {
		return Result.fail(
			new ValidationError(
				`Invalid cursor position: ${cursorPos} (message length: ${message.length})`,
				"cursorPos"
			)
		);
	}

	const textBeforeCursor = message.substring(0, cursorPos);
	const lastSlashIndex = textBeforeCursor.lastIndexOf(SLASH_COMMAND_TRIGGER);

	if (lastSlashIndex < 0) {
		return Result.succeed(null);
	}
	if (isInsideInlineArtefact(message, lastSlashIndex)) {
		return Result.succeed(null);
	}

	// Check if / is at start or after whitespace
	const charBefore = lastSlashIndex === 0 ? " " : textBeforeCursor[lastSlashIndex - 1];

	if (charBefore !== " " && charBefore !== "\n" && lastSlashIndex !== 0) {
		return Result.succeed(null);
	}

	// Check there's no space after the / (still typing command)
	const textAfterSlash = textBeforeCursor.substring(lastSlashIndex + 1);

	if (textAfterSlash.includes(" ")) {
		return Result.succeed(null);
	}

	const result = {
		startIndex: lastSlashIndex,
		query: textAfterSlash,
	};

	return Result.succeed(result);
}

export function replaceActiveSlashTrigger(input: {
	message: string;
	cursorPos: number;
	replacement: string;
}): { message: string; cursor: number } | null {
	const triggerResult = parseSlashCommandTrigger(input.message, input.cursorPos);
	if (!Result.isSuccess(triggerResult) || triggerResult.success === null) {
		return null;
	}

	const start = triggerResult.success.startIndex;
	const before = input.message.substring(0, start);
	const after = input.message.substring(input.cursorPos);
	const message =
		input.replacement.length > 0 ? `${before}${input.replacement}${after}` : `${before}${after}`;
	const cursor = before.length + input.replacement.length;

	return { message, cursor };
}
