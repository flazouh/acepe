/**
 * Consolidated application error types for the unified store.
 *
 * These errors are designed for:
 * 1. Type-safe error handling with ResultAsync
 * 2. Telemetry and monitoring (each has a unique code)
 * 3. User-facing error messages
 *
 * Keep this list minimal - only add errors that are:
 * - Telemetry-worthy (you want to track them)
 * - Recoverable (user can take action)
 * - Distinct (not duplicates of other errors)
 */

/**
 * Error codes for telemetry and programmatic handling.
 */
export type AppErrorCode =
	| "SESSION_NOT_FOUND"
	| "CONNECTION_ERROR"
	| "AGENT_ERROR"
	| "VALIDATION_ERROR"
	| "PANEL_ERROR"
	| "WORKTREE_ERROR";

/**
 * Base class for all application errors.
 */
export abstract class AppError extends Error {
	abstract readonly code: AppErrorCode;

	constructor(
		message: string,
		readonly cause?: Error
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

/**
 * Session was not found in the store.
 */
export class SessionNotFoundError extends AppError {
	readonly code = "SESSION_NOT_FOUND" as const;

	constructor(readonly sessionId: string) {
		super(`Session not found: ${sessionId}`);
	}
}

/**
 * Failed to connect to or communicate with a session.
 */
export class ConnectionError extends AppError {
	readonly code = "CONNECTION_ERROR" as const;

	constructor(
		readonly sessionId: string,
		cause?: Error
	) {
		super(`Failed to connect session: ${sessionId}`, cause);
	}
}

/**
 * Agent operation failed (send prompt, set model, set mode, etc.)
 */
export class AgentError extends AppError {
	readonly code = "AGENT_ERROR" as const;

	constructor(
		readonly operation: string,
		cause?: Error
	) {
		super(`Agent operation failed: ${operation}`, cause);
	}
}

/**
 * Validation error for invalid input data.
 * Can optionally hold a ZodError for schema validation failures.
 */
export class ValidationError extends AppError {
	readonly code = "VALIDATION_ERROR" as const;
	readonly zodError: import("zod").ZodError | undefined;

	constructor(
		message: string,
		readonly field?: string,
		zodError?: import("zod").ZodError
	) {
		super(message);
		this.zodError = zodError;
	}
}

/**
 * Panel operation failed.
 */
export class PanelError extends AppError {
	readonly code = "PANEL_ERROR" as const;

	constructor(
		readonly panelId: string,
		message: string
	) {
		super(`Panel error (${panelId}): ${message}`);
	}
}

/**
 * Worktree operation failed.
 */
export class WorktreeError extends AppError {
	readonly code = "WORKTREE_ERROR" as const;

	constructor(
		readonly operation: string,
		cause?: Error
	) {
		super(`Worktree operation failed: ${operation}`, cause);
	}
}
