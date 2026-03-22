import { AcpError } from "./acp-error.js";

/**
 * Error thrown when ACP connection operations fail.
 *
 * This includes errors during subprocess spawning, stdio setup,
 * or connection lifecycle management.
 *
 * @example
 * ```typescript
 * throw new ConnectionError('Failed to spawn subprocess', cause);
 * ```
 */
export class ConnectionError extends AcpError {
	constructor(message: string, cause?: unknown) {
		super(message, "CONNECTION_ERROR", cause);
		this.name = "ConnectionError";
	}
}
