/**
 * Base error class for all ACP-related errors.
 *
 * All ACP errors extend this class to provide consistent error handling
 * and enable proper error type checking with neverthrow.
 *
 * @example
 * ```typescript
 * throw new AcpError('Connection failed', 'CONNECTION_ERROR', cause);
 * ```
 */
export class AcpError extends Error {
	/**
	 * Creates a new AcpError instance.
	 *
	 * @param message - Human-readable error message
	 * @param code - Error code for programmatic error handling
	 * @param cause - Optional underlying error that caused this error
	 */
	constructor(
		message: string,
		public readonly code: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = "AcpError";

		// Maintains proper stack trace for where our error was thrown (only available on V8)
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, AcpError);
		}
	}

	/**
	 * Returns a string representation of the error.
	 *
	 * @returns Formatted error string with code and message
	 */
	override toString(): string {
		return `[${this.code}] ${this.message}`;
	}
}
