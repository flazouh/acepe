import { DomainError } from "./DomainError";

/**
 * Error when agent initialization fails.
 */
export class AgentInitializationError extends DomainError {
	readonly code = "AGENT_INITIALIZATION";

	constructor(
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

/**
 * Error when agent connection fails.
 */
export class AgentConnectionError extends DomainError {
	readonly code = "AGENT_CONNECTION";

	constructor(
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

/**
 * Error when session creation fails.
 */
export class SessionCreationError extends DomainError {
	readonly code = "SESSION_CREATION";

	constructor(
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

/**
 * Error when session operation fails.
 */
export class SessionOperationError extends DomainError {
	readonly code = "SESSION_OPERATION";

	constructor(
		message: string,
		public readonly sessionId?: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

/**
 * Error when prompt sending fails.
 */
export class PromptError extends DomainError {
	readonly code = "PROMPT";

	constructor(
		message: string,
		public readonly sessionId?: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

/**
 * Error when agent is not initialized.
 */
export class AgentNotInitializedError extends DomainError {
	readonly code = "AGENT_NOT_INITIALIZED";

	constructor() {
		super("Agent service is not initialized. Call initialize() first.");
	}
}
