import { err, ok, type Result } from "neverthrow";

import type { ToolArguments } from "../../../../../services/converted-session-types.js";
import { EXECUTE_TOOL_ERROR_CODES, ExecuteToolError } from "../errors/index.js";
import type { ExecuteArguments } from "../types/index.js";

/**
 * Extracts execute arguments from tool call arguments.
 *
 * Validates and extracts command from the tool call arguments discriminated union.
 *
 * @param arguments_ - Tool call arguments discriminated union
 * @returns Result containing ExecuteArguments or an error
 */
export function extractExecuteArguments(
	arguments_: ToolArguments | null | undefined
): Result<ExecuteArguments, ExecuteToolError> {
	if (!arguments_ || arguments_.kind !== "execute") {
		return err(
			new ExecuteToolError(
				"Invalid arguments: expected execute tool arguments",
				EXECUTE_TOOL_ERROR_CODES.INVALID_ARGUMENTS
			)
		);
	}

	return ok({
		command: arguments_.command ?? null,
	});
}
