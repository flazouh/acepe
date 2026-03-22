import { AcpError } from "./acp-error.js";

/**
 * Error thrown when JSON-RPC protocol operations fail.
 *
 * This includes errors during request construction, response parsing,
 * or protocol-level errors from the ACP server.
 *
 * @example
 * ```typescript
 * throw new ProtocolError('Invalid JSON-RPC response', cause);
 * ```
 */
export class ProtocolError extends AcpError {
	constructor(message: string, cause?: unknown) {
		super(message, "PROTOCOL_ERROR", cause);
		this.name = "ProtocolError";
	}
}
