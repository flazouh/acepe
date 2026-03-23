/**
 * Error types for the agent input component.
 *
 * These errors are used for type-safe error handling with ResultAsync
 * and provide context for debugging and user-facing messages.
 */

/**
 * Error codes for agent input operations.
 */
export type AgentInputErrorCode =
	| "FILE_LOAD_ERROR"
	| "SESSION_CREATION_ERROR"
	| "MESSAGE_SEND_ERROR"
	| "VALIDATION_ERROR";

/**
 * Base class for all agent input errors.
 */
export abstract class AgentInputError extends Error {
	abstract readonly code: AgentInputErrorCode;

	constructor(
		message: string,
		readonly cause?: Error
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

/**
 * Error thrown when project files fail to load.
 */
export class FileLoadError extends AgentInputError {
	readonly code = "FILE_LOAD_ERROR" as const;

	constructor(
		readonly projectPath: string,
		cause?: Error
	) {
		super(`Failed to load project files: ${projectPath}`, cause);
	}
}

/**
 * Error thrown when session creation fails.
 */
export class SessionCreationError extends AgentInputError {
	readonly code = "SESSION_CREATION_ERROR" as const;

	constructor(
		readonly agentId: string,
		readonly projectPath: string,
		cause?: Error
	) {
		super(`Failed to create session for agent ${agentId} in project ${projectPath}`, cause);
	}
}

/**
 * Error thrown when message sending fails.
 */
export class MessageSendError extends AgentInputError {
	readonly code = "MESSAGE_SEND_ERROR" as const;

	constructor(
		readonly sessionId: string,
		readonly message: string,
		cause?: Error
	) {
		super(`Failed to send message to session ${sessionId}`, cause);
	}
}

/**
 * Error thrown when input validation fails.
 */
export class ValidationError extends AgentInputError {
	readonly code = "VALIDATION_ERROR" as const;

	constructor(
		message: string,
		readonly field?: string
	) {
		super(message);
	}
}
