/**
 * Error thrown when loading a session plan fails.
 *
 * @example
 * ```ts
 * throw new PlanLoadError("Session not found", { sessionId: "123" });
 * ```
 */
export class PlanLoadError extends Error {
	/**
	 * Additional context about the error.
	 */
	readonly context: Record<string, unknown>;

	/**
	 * Creates a new PlanLoadError.
	 *
	 * @param message - Human-readable error message
	 * @param context - Additional context (session ID, project path, etc.)
	 */
	constructor(message: string, context: Record<string, unknown> = {}) {
		super(message);
		this.name = "PlanLoadError";
		this.context = context;
	}
}
