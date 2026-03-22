/**
 * Checkpoint-specific error types.
 *
 * These errors are used for checkpoint operations like create, revert, and rewind.
 */

import { AcpError } from "./acp-error.js";

/**
 * Error codes for checkpoint operations.
 */
export type CheckpointErrorCode =
	| "CHECKPOINT_NOT_FOUND"
	| "FILE_NOT_FOUND"
	| "REVERT_FAILED"
	| "CREATE_FAILED"
	| "STORAGE_ERROR";

/**
 * Error class for checkpoint operations.
 *
 * Extends AcpError to integrate with the common error hierarchy.
 */
export class CheckpointError extends AcpError {
	constructor(message: string, code: CheckpointErrorCode, cause?: unknown) {
		super(message, code, cause);
		this.name = "CheckpointError";
	}
}
