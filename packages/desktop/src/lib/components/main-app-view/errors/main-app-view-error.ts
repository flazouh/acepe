/**
 * Error types for main app view operations.
 *
 * These errors are designed for:
 * 1. Type-safe error handling with ResultAsync
 * 2. Telemetry and monitoring (each has a unique code)
 * 3. User-facing error messages
 */

/**
 * Error codes for telemetry and programmatic handling.
 */
export type MainAppViewErrorCode =
	| "INITIALIZATION_ERROR"
	| "SESSION_LOAD_ERROR"
	| "SESSION_SELECTION_ERROR"
	| "SESSION_CREATION_ERROR"
	| "PANEL_OPERATION_ERROR"
	| "PROJECT_OPERATION_ERROR"
	| "KEYBINDING_ERROR";

/**
 * Base class for all main app view errors.
 */
export abstract class MainAppViewError extends Error {
	abstract readonly code: MainAppViewErrorCode;

	constructor(
		message: string,
		readonly cause?: Error
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

/**
 * Failed during app initialization.
 */
export class InitializationError extends MainAppViewError {
	readonly code = "INITIALIZATION_ERROR" as const;

	constructor(
		readonly step: string,
		cause?: Error
	) {
		super(`Initialization failed at step: ${step}`, cause);
	}
}

/**
 * Failed to load a session.
 */
export class SessionLoadError extends MainAppViewError {
	readonly code = "SESSION_LOAD_ERROR" as const;

	constructor(
		readonly sessionId: string,
		cause?: Error
	) {
		super(`Failed to load session: ${sessionId}`, cause);
	}
}

/**
 * Failed to select/open a session.
 */
export class SessionSelectionError extends MainAppViewError {
	readonly code = "SESSION_SELECTION_ERROR" as const;

	constructor(
		readonly sessionId: string,
		message: string,
		cause?: Error
	) {
		super(`Session selection failed (${sessionId}): ${message}`, cause);
	}
}

/**
 * Failed to create a new session.
 */
export class SessionCreationError extends MainAppViewError {
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
 * Failed to perform a panel operation.
 */
export class PanelOperationError extends MainAppViewError {
	readonly code = "PANEL_OPERATION_ERROR" as const;

	constructor(
		readonly panelId: string,
		readonly operation: string,
		cause?: Error
	) {
		super(`Panel operation failed (${panelId}): ${operation}`, cause);
	}
}

/**
 * Failed to perform a project operation.
 */
export class ProjectOperationError extends MainAppViewError {
	readonly code = "PROJECT_OPERATION_ERROR" as const;

	constructor(
		readonly operation: string,
		cause?: Error
	) {
		super(`Project operation failed: ${operation}`, cause);
	}
}

/**
 * Failed to register or handle a keybinding.
 */
export class KeybindingError extends MainAppViewError {
	readonly code = "KEYBINDING_ERROR" as const;

	constructor(
		readonly actionId: string,
		cause?: Error
	) {
		super(`Keybinding error for action: ${actionId}`, cause);
	}
}
