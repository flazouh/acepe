import { AcpError } from "../../../../errors/acp-error.js";

/**
 * Error codes for execute tool operations.
 */
export const EXECUTE_TOOL_ERROR_CODES = {
	HIGHLIGHTER_INIT_FAILED: "HIGHLIGHTER_INIT_FAILED",
	SYNTAX_HIGHLIGHTING_FAILED: "SYNTAX_HIGHLIGHTING_FAILED",
	THEME_LOAD_FAILED: "THEME_LOAD_FAILED",
	INVALID_ARGUMENTS: "INVALID_ARGUMENTS",
	PARSE_RESULT_FAILED: "PARSE_RESULT_FAILED",
} as const;

/**
 * Error type for execute tool error codes.
 */
export type ExecuteToolErrorCode =
	(typeof EXECUTE_TOOL_ERROR_CODES)[keyof typeof EXECUTE_TOOL_ERROR_CODES];

/**
 * Error class for execute tool operations.
 *
 * Extends AcpError to provide consistent error handling for execute tool
 * operations like syntax highlighting and theme loading.
 *
 * @example
 * ```typescript
 * throw new ExecuteToolError(
 *   'Failed to initialize highlighter',
 *   EXECUTE_TOOL_ERROR_CODES.HIGHLIGHTER_INIT_FAILED,
 *   cause
 * );
 * ```
 */
export class ExecuteToolError extends AcpError {
	/**
	 * Creates a new ExecuteToolError instance.
	 *
	 * @param message - Human-readable error message
	 * @param code - Error code from EXECUTE_TOOL_ERROR_CODES
	 * @param cause - Optional underlying error that caused this error
	 */
	constructor(message: string, code: ExecuteToolErrorCode, cause?: unknown) {
		super(message, code, cause);
		this.name = "ExecuteToolError";
	}
}
