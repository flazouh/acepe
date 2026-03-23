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

	const firstEdit = arguments_.edits[0];

	// Extract newString or content (content is fallback)
	let newString: string | null = firstEdit?.newString ?? null;
	if (!newString && firstEdit?.content) {
		newString = firstEdit.content;
	}

	return ok({
		filePath: firstEdit?.filePath ?? null,
		oldString: firstEdit?.oldString ?? null,
		newString,
	});
}
