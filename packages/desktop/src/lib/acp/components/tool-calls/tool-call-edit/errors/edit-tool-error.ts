import { AcpError } from "../../../../errors/acp-error.js";

/**
 * Error codes for edit tool operations.
 */
export const EDIT_TOOL_ERROR_CODES = {
	HIGHLIGHTER_INIT_FAILED: "HIGHLIGHTER_INIT_FAILED",
	SYNTAX_HIGHLIGHTING_FAILED: "SYNTAX_HIGHLIGHTING_FAILED",
	THEME_LOAD_FAILED: "THEME_LOAD_FAILED",
	INVALID_ARGUMENTS: "INVALID_ARGUMENTS",
	DIFF_GENERATION_FAILED: "DIFF_GENERATION_FAILED",
} as const;

/**
 * Error type for edit tool error codes.
 */
export type EditToolErrorCode = (typeof EDIT_TOOL_ERROR_CODES)[keyof typeof EDIT_TOOL_ERROR_CODES];

/**
 * Error class for edit tool operations.
 *
 * Extends AcpError to provide consistent error handling for edit tool
 * operations like syntax highlighting, diff generation, and theme loading.
 *
 * @example
 * ```typescript
 * throw new EditToolError(
 *   'Failed to initialize highlighter',
 *   EDIT_TOOL_ERROR_CODES.HIGHLIGHTER_INIT_FAILED,
 *   cause
 * );
 * ```
 */
export class EditToolError extends AcpError {
	/**
	 * Creates a new EditToolError instance.
	 *
	 * @param message - Human-readable error message
	 * @param code - Error code from EDIT_TOOL_ERROR_CODES
	 * @param cause - Optional underlying error that caused this error
	 */
	constructor(message: string, code: EditToolErrorCode, cause?: unknown) {
		super(message, code, cause);
		this.name = "EditToolError";
	}
}
