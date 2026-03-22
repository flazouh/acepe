/**
 * Error types for thread list operations.
 */

/**
 * Base error class for thread list operations.
 */
export class ThreadListError extends Error {
	constructor(
		message: string,
		public readonly code: ThreadListErrorCode
	) {
		super(message);
		this.name = "ThreadListError";
	}
}

/**
 * Error codes for thread list operations.
 */
export type ThreadListErrorCode =
	| "INVALID_TIMESTAMP"
	| "LOAD_FAILED"
	| "THREAD_NOT_FOUND"
	| "DELETE_FAILED"
	| "CREATE_FAILED";

/**
 * Creates an error for invalid timestamp.
 *
 * @param timestamp - The invalid timestamp value
 * @returns ThreadListError instance
 */
export function invalidTimestampError(timestamp: unknown): ThreadListError {
	return new ThreadListError(`Invalid timestamp: ${String(timestamp)}`, "INVALID_TIMESTAMP");
}

/**
 * Creates an error for load operation failure.
 *
 * @param reason - The reason for the failure
 * @returns ThreadListError instance
 */
export function loadFailedError(reason: string): ThreadListError {
	return new ThreadListError(`Failed to load threads: ${reason}`, "LOAD_FAILED");
}

/**
 * Creates an error for thread not found.
 *
 * @param threadId - The thread ID that was not found
 * @returns ThreadListError instance
 */
export function threadNotFoundError(threadId: string): ThreadListError {
	return new ThreadListError(`Thread not found: ${threadId}`, "THREAD_NOT_FOUND");
}

/**
 * Creates an error for delete operation failure.
 *
 * @param reason - The reason for the failure
 * @returns ThreadListError instance
 */
export function deleteFailedError(reason: string): ThreadListError {
	return new ThreadListError(`Failed to delete thread: ${reason}`, "DELETE_FAILED");
}

/**
 * Creates an error for create operation failure.
 *
 * @param reason - The reason for the failure
 * @returns ThreadListError instance
 */
export function createFailedError(reason: string): ThreadListError {
	return new ThreadListError(`Failed to create thread: ${reason}`, "CREATE_FAILED");
}
