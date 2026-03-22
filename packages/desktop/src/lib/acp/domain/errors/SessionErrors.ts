import { DomainError } from "./DomainError";

export class InvalidSessionIdError extends DomainError {
	readonly code = "INVALID_SESSION_ID";
}

export class SessionNotFoundError extends DomainError {
	readonly code = "SESSION_NOT_FOUND";

	constructor(sessionId: string) {
		super(`Session not found: ${sessionId}`);
	}
}

export class InvalidModelError extends DomainError {
	readonly code = "INVALID_MODEL";

	constructor(modelId: string) {
		super(`Invalid model: ${modelId}`);
	}
}

export class InvalidModeError extends DomainError {
	readonly code = "INVALID_MODE";

	constructor(modeId: string) {
		super(`Invalid mode: ${modeId}`);
	}
}
