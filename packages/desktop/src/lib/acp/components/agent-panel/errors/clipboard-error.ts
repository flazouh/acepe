/**
 * Error thrown when clipboard operations fail.
 *
 * @example
 * ```ts
 * throw new ClipboardError("Failed to copy to clipboard", { content: "..." });
 * ```
 */
export class ClipboardError extends Error {
	/**
	 * Additional context about the error.
	 */
	readonly context: Record<string, unknown>;

	/**
	 * Creates a new ClipboardError.
	 *
	 * @param message - Human-readable error message
	 * @param context - Additional context (content length, etc.)
	 */
	constructor(message: string, context: Record<string, unknown> = {}) {
		super(message);
		this.name = "ClipboardError";
		this.context = context;
	}
}
