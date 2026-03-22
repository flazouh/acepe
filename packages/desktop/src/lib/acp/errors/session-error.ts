import { AcpError } from "./acp-error.js";

/**
 * Error thrown when session operations fail.
 *
 * This includes errors during session creation, model/mode changes,
 * prompt sending, or session cancellation.
 *
 * @example
 * ```typescript
 * throw new SessionError('Session not found', sessionId);
 * ```
 */
export class SessionError extends AcpError {
	constructor(message: string, cause?: unknown) {
		super(message, "SESSION_ERROR", cause);
		this.name = "SessionError";
	}
}
