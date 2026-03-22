import type { DomainError } from "../../domain/errors/DomainError";

/**
 * Application error codes for categorizing errors.
 */
export type ApplicationErrorCode =
	| "NOT_FOUND"
	| "VALIDATION"
	| "CONFLICT"
	| "UNAUTHORIZED"
	| "INTERNAL"
	| "DOMAIN_ERROR";

/**
 * Base application error class.
 *
 * Application errors are user-facing errors that:
 * - Have a clear error code for programmatic handling
 * - Have a human-readable message
 * - Can wrap domain errors
 * - Are suitable for logging and monitoring
 */
export class ApplicationError extends Error {
	constructor(
		readonly code: ApplicationErrorCode,
		message: string,
		readonly cause?: Error | DomainError
	) {
		super(message);
		this.name = "ApplicationError";
	}

	/**
	 * Create an ApplicationError from a DomainError.
	 */
	static fromDomain(error: DomainError): ApplicationError {
		return new ApplicationError("DOMAIN_ERROR", error.message, error);
	}

	/**
	 * Create a "not found" error.
	 */
	static notFound(entity: string, id: string): ApplicationError {
		return new ApplicationError("NOT_FOUND", `${entity} not found: ${id}`);
	}

	/**
	 * Create a validation error.
	 */
	static validation(message: string): ApplicationError {
		return new ApplicationError("VALIDATION", message);
	}

	/**
	 * Create a conflict error.
	 */
	static conflict(message: string): ApplicationError {
		return new ApplicationError("CONFLICT", message);
	}

	/**
	 * Create an internal error.
	 */
	static internal(message: string, cause?: Error): ApplicationError {
		return new ApplicationError("INTERNAL", message, cause);
	}
}

/**
 * Thread-specific application errors.
 */
export class ThreadNotFoundError extends ApplicationError {
	constructor(threadId: string) {
		super("NOT_FOUND", `Thread not found: ${threadId}`);
		this.name = "ThreadNotFoundError";
	}
}

/**
 * Session-specific application errors.
 */
export class SessionNotFoundError extends ApplicationError {
	constructor(sessionId: string) {
		super("NOT_FOUND", `Session not found: ${sessionId}`);
		this.name = "SessionNotFoundError";
	}
}

export class SessionAlreadyExistsError extends ApplicationError {
	constructor(projectPath: string) {
		super("CONFLICT", `Session already exists for project: ${projectPath}`);
		this.name = "SessionAlreadyExistsError";
	}
}

export class SessionNotReadyError extends ApplicationError {
	constructor(sessionId: string) {
		super("VALIDATION", `Session not ready: ${sessionId}`);
		this.name = "SessionNotReadyError";
	}
}

/**
 * Panel-specific application errors.
 */
export class PanelNotFoundError extends ApplicationError {
	constructor(panelId: string) {
		super("NOT_FOUND", `Panel not found: ${panelId}`);
		this.name = "PanelNotFoundError";
	}
}

export class PanelClosedError extends ApplicationError {
	constructor(panelId: string) {
		super("VALIDATION", `Panel is closed: ${panelId}`);
		this.name = "PanelClosedError";
	}
}
