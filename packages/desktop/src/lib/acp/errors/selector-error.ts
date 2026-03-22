import { AcpError } from "./acp-error.js";

/**
 * Error codes for selector operations.
 */
export type SelectorErrorCode =
	| "INVALID_ITEM"
	| "ITEM_NOT_FOUND"
	| "INVALID_GROUP"
	| "SELECTION_FAILED";

/**
 * Error class for selector-related operations.
 *
 * @example
 * ```typescript
 * throw new SelectorError('Item not found', 'ITEM_NOT_FOUND');
 * ```
 */
export class SelectorError extends AcpError {
	/**
	 * Creates a new SelectorError instance.
	 *
	 * @param message - Human-readable error message
	 * @param code - Error code for programmatic error handling
	 * @param cause - Optional underlying error that caused this error
	 */
	constructor(message: string, code: SelectorErrorCode, cause?: unknown) {
		super(message, code, cause);
		this.name = "SelectorError";
	}
}
