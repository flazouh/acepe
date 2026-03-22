import { err, ok, type Result } from "neverthrow";

import type { ToolArguments } from "../../../../../services/converted-session-types.js";
import { EDIT_TOOL_ERROR_CODES, EditToolError } from "../errors/index.js";
import type { EditArguments } from "../types/index.js";

/**
 * Extracts edit arguments from tool call arguments.
 *
 * Validates and extracts file path, old_string, and new_string from the
 * tool call arguments discriminated union.
 *
 * @param arguments_ - Tool call arguments discriminated union
 * @returns Result containing EditArguments or an error
 */
export function extractEditArguments(
	arguments_: ToolArguments | null | undefined
): Result<EditArguments, EditToolError> {
	if (!arguments_ || arguments_.kind !== "edit") {
		return err(
			new EditToolError(
				"Invalid arguments: expected edit tool arguments",
				EDIT_TOOL_ERROR_CODES.INVALID_ARGUMENTS
			)
		);
	}

	const { file_path, old_string, new_string, content } = arguments_;

	// Extract new_string or content (content is fallback)
	let newString: string | null = new_string ?? null;
	if (!newString && content) {
		newString = content;
	}

	return ok({
		filePath: file_path ?? null,
		oldString: old_string ?? null,
		newString,
	});
}
